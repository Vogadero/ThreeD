/* =========================================================
   真实照片与百科简介
   ---------------------------------------------------------
   多源链式获取:
     1) 用户配置的地图服务代理 (高德/百度/腾讯 POI 照片)
     2) Wikidata + 中文维基百科 REST 摘要 + P18
     3) 多语言维基百科 REST 摘要 (en/de/fr/ja) 补图
     4) Wikimedia Commons 按关键词搜索
     5) 中文维基百科按名称搜索兜底
   全部为客户端 fetch, Wikimedia 服务支持跨域 (CORS)。
   结果按地点缓存, 避免重复请求。
   ========================================================= */

const cache = new Map();

const HEADERS = {};

// 可选: 地图服务照片代理 (高德 / 百度 / 腾讯 均需 API Key 且浏览器直连会被 CORS 拦截,
// 所以必须经本地/服务端代理转发)。在前端注入 window.__PHOTO_PROXY = 'http://127.0.0.1:8787/photo'
// 即可启用; 未配置时仍走 Wikimedia。代理返回结构需与下方一致:
//   { photos:[{url,title}], extract, source, title }
const PHOTO_PROXY = (typeof window !== 'undefined' && window.__PHOTO_PROXY) || '';

// 带超时与中断的 fetch: 无外网/网络缓慢时, 8s 后主动失败, 避免界面卡在"获取中"。
async function fetchT(url, ms = 8000, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function wikidataEntity(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const r = await fetchT(url);
  if (!r.ok) throw new Error('wikidata ' + r.status);
  const j = await r.json();
  return j.entities[qid];
}

function fileURL(name, w = 720) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${w}`;
}

async function wikiSummary(title, lang = 'zh') {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetchT(url);
  if (!r.ok) return null;
  return r.json();
}

async function wikiSearch(q, lang = 'zh') {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1&origin=*`;
  const r = await fetchT(url);
  if (!r.ok) return null;
  const j = await r.json();
  return j.query && j.query.search && j.query.search[0] ? j.query.search[0].title : null;
}

async function wikiPageImages(title, lang = 'zh') {
  // 取条目关联的图片 (比 summary 缩略图更全面, 含信息框大图, 命中率更高)
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=original|thumbnail&pithumbsize=800&format=json&origin=*`;
  try {
    const r = await fetchT(url, 7000);
    if (!r.ok) return [];
    const j = await r.json();
    const pages = j.query && j.query.pages;
    if (!pages) return [];
    const out = [];
    for (const k in pages) {
      const p = pages[k];
      if (p.original && p.original.source) out.push({ url: p.original.source, title });
      else if (p.thumbnail && p.thumbnail.source) out.push({ url: p.thumbnail.source, title });
    }
    return out;
  } catch (e) { return []; }
}

async function wikivoyageSummary(title, lang = 'zh') {
  const url = `https://${lang}.wikivoyage.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const r = await fetchT(url, 7000);
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function commonsSearch(q) {
  // 在 Wikimedia Commons 搜索关键词, 取前 6 张图
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=6&srlimit=6&format=json&origin=*`;
  try {
    const r = await fetchT(url, 7000);
    if (!r.ok) return [];
    const j = await r.json();
    const arr = (j.query && j.query.search) || [];
    return arr.map(x => {
      const name = x.title.replace(/^File:/, '');
      return { url: fileURL(name, 720), title: name };
    });
  } catch (e) { return []; }
}

/**
 * @param place { name, en?, wiki?, lon, lat }
 * @returns Promise<{ photos:[{url,title}], extract:string, source:string, title:string }>
 */

/**
 * 探测 Wikimedia 连通性 —— 用于区分"网络不可达"与"该地点确实没有自由版权照片"。
 * 国内网络通常无法直连 *.wikimedia.org, 此时应提示用户改用代理/VPN, 而不是无意义地反复重试。
 */
export async function probeWikimedia() {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  try {
    const r = await fetchT(
      'https://commons.wikimedia.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*', 6000);
    return { ok: r.ok, status: r.status, ms: Math.round(now() - t0) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e || 'network error'), ms: Math.round(now() - t0) };
  }
}

/* v=53: 维基可达性门控(带 10 分钟缓存) —— 大陆网络下整条维基链快速跳过,
   不再逐请求空等 6~8s 超时; 国内源由服务器 /api/photo 并行补图。 */
let _wikiState = null;
function wikiReachable() {
  if (_wikiState && Date.now() - _wikiState.at < 600000) return Promise.resolve(_wikiState.ok);
  return probeWikimedia().then(pr => {
    _wikiState = { ok: !!pr.ok, at: Date.now() };
    return _wikiState.ok;
  });
}

/**
 * 并行取图: 一次性并发所有候选来源, 谁先回来用谁。
 * 旧实现是串行 await (无 wiki 的 POI 最多 60 次串行网络请求), 必然超过 UI 的 12s 兜底,
 * 表现为永远"正在获取真实照片"。这里改成两波并发, 正常情况下 1~2s 内出图。
 */
export async function getPlaceMedia(place) {
  const key = place.wiki || place.name;
  if (cache.has(key)) return cache.get(key);

  const job = (async () => {
    const seen = new Set();
    const photos = [];
    let extract = '';
    let title = '';

    /** 去重后塞入照片, 上限 6 张 */
    const add = (list) => {
      if (!list) return;
      for (const p of list) {
        if (!p || !p.url || seen.has(p.url) || photos.length >= 6) continue;
        seen.add(p.url);
        photos.push(p);
      }
    };
    const takeExtract = (s, t) => {
      if (s && s.extract && !extract) { extract = s.extract; if (t && !title) title = t; }
    };

    /* v=53: 国内多源并行波 —— 立即开跑, 不等维基探测。
       部署版(带 server.js)由服务端并发聚合 维基中继/高德/百度百科/搜狗百科;
       纯静态部署或本地无该 API 时 404, 静默忽略(v=54: 记录 apiMissing 供诊断)。 */
    let apiMissing = false;
    /* v=58: 纯静态部署(如 GitHub Pages)没有本地 /api/photo, 可在页面注入
       window.__PHOTO_API = 'https://<你的-worker>/api/photo' 指向外部照片服务,
       未配置时仍走同源 /api/photo。 */
    const PHOTO_API = (typeof window !== 'undefined' && window.__PHOTO_API) || '/api/photo';
    const qs = `q=${encodeURIComponent(place.wiki || place.name)}&lon=${place.lon || ''}&lat=${place.lat || ''}`;
    const domP = (async () => {
      try {
        let r = await fetchT(`${PHOTO_API}?${qs}`, 9000);
        /* v=61: 配了外部服务(Worker)但取不到时, 回退同源 /api/photo,
           本地开发(有 server.js)照常出图, 两边互不阻塞。 */
        if (!r.ok && window.__PHOTO_API) {
          const r2 = await fetchT(`/api/photo?${qs}`, 9000);
          if (r2.ok) return await r2.json();
          return { __status: r2.status };
        }
        if (!r.ok) return { __status: r.status };
        return await r.json();
      } catch (e) { return null; }
    })();
    const mergeDom = async () => {
      try {
        const j = await domP;
        if (j) {
          if (j.__status === 404) { apiMissing = true; return; }   // 服务器没有照片 API(旧版/纯静态)
          /* v=53: 注意 takeExtract 接收的是 summary 对象, 这里 j 是最终结构, 直接取字段 */
          if (j.extract && !extract) extract = j.extract;
          if (j.title && !title) title = j.title;
          add(j.photos);
        }
      } catch (e) { /* ignore */ }
    };

    const wikiOK = await wikiReachable();

    // 1) 地图服务照片代理 (配置了就优先, 成功直接返回)
    if (PHOTO_PROXY) {
      try {
        const q = encodeURIComponent(place.wiki || place.name);
        const r = await fetchT(`${PHOTO_PROXY}?q=${q}&lon=${place.lon}&lat=${place.lat}`, 9000);
        if (r.ok) {
          const j = await r.json();
          if (j && j.photos && j.photos.length) {
            return {
              photos: j.photos.slice(0, 6),
              extract: j.extract || '',
              source: j.source || '地图服务代理',
              title: j.title || (place.wiki || place.name),
            };
          }
        }
      } catch (e) { /* 回退 Wikimedia */ }
    }

    /* ---------- 第一波: 并发命中率最高的几个来源 (维基可达时才跑) ---------- */
    if (wikiOK) {
    const wave1 = [];

    // A. Wikidata (有 QID 时): 中文条目摘要 + 条目配图 + P18 实景图
    if (place.wiki) {
      wave1.push((async () => {
        const e = await wikidataEntity(place.wiki);
        const zh = e.sitelinks && e.sitelinks.zhwiki && e.sitelinks.zhwiki.title;
        if (zh) {
          title = zh;
          const [sum, pis] = await Promise.all([wikiSummary(zh, 'zh'), wikiPageImages(zh, 'zh')]);
          takeExtract(sum, zh);
          if (sum && sum.thumbnail && sum.thumbnail.source) add([{ url: sum.thumbnail.source, title: zh }]);
          add(pis);
        }
        const p18 = e.claims && e.claims.P18;
        if (p18) {
          add(p18.slice(0, 6).map(c => {
            const f = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
            return f ? { url: fileURL(f), title: f } : null;
          }).filter(Boolean));
        }
      })().catch(() => { }));
    }

    // B. 中文维基: 按名称搜索 -> 摘要 + 条目配图
    wave1.push((async () => {
      const t = await wikiSearch(place.name, 'zh');
      if (!t) return;
      const [s, pis] = await Promise.all([wikiSummary(t, 'zh'), wikiPageImages(t, 'zh')]);
      takeExtract(s, t);
      if (s && s.thumbnail && s.thumbnail.source) add([{ url: s.thumbnail.source, title: t }]);
      add(pis);
    })().catch(() => { }));

    // C. Commons 直接按名称搜图 (命中率最高, 中文名也能搜到)
    wave1.push((async () => { add(await commonsSearch(place.name)); })().catch(() => { }));

    // D. Wikivoyage 中文旅行指南
    wave1.push((async () => {
      const vs = await wikivoyageSummary(place.name, 'zh');
      takeExtract(vs, place.name);
      if (vs && vs.thumbnail && vs.thumbnail.source) add([{ url: vs.thumbnail.source, title: place.name }]);
    })().catch(() => { }));

    await Promise.allSettled(wave1);
    }
    await mergeDom();   // v=53: 合并国内源结果(与维基图 URL 去重)
    if (photos.length >= 4) {
      return { photos: photos.slice(0, 6), extract,
        source: wikiOK ? 'Wikimedia · 维基百科 · 国内多源' : '国内多源 (高德/百科)',
        apiMissing, title };
    }

    /* ---------- 第二波: 还不够就再并发一批补充来源 ---------- */
    if (wikiOK) {
    const wave2 = [];
    const base = place.en || place.name;

    // E. 英文名 / 其它语言维基
    for (const lang of ['en', 'de', 'fr', 'ja']) {
      wave2.push((async () => {
        const t = await wikiSearch(base, lang);
        if (!t) return;
        const [s, pis] = await Promise.all([wikiSummary(t, lang), wikiPageImages(t, lang)]);
        takeExtract(s, t);
        if (s && s.thumbnail && s.thumbnail.source) add([{ url: s.thumbnail.source, title: t }]);
        add(pis);
      })().catch(() => { }));
    }

    // F. Commons 用 "名称 + 上海/Shanghai" 再搜一轮
    for (const q of [place.name + ' Shanghai', place.name + ' 上海', base + ' Shanghai']) {
      wave2.push((async () => { add(await commonsSearch(q)); })().catch(() => { }));
    }

    // G. Wikivoyage 英文
    if (place.en) {
      wave2.push((async () => {
        const ve = await wikivoyageSummary(place.en, 'en');
        takeExtract(ve, place.en);
        if (ve && ve.thumbnail && ve.thumbnail.source) add([{ url: ve.thumbnail.source, title: place.en }]);
      })().catch(() => { }));
    }

    await Promise.allSettled(wave2);
    }
    await mergeDom();   // v=53: 幂等合并(已取过则去重跳过)

    const srcLabel = photos.length
      ? (wikiOK ? 'Wikimedia Commons · 维基百科 · 国内多源' : '国内多源 (高德/百科)')
      : '';
    return { photos: photos.slice(0, 6), extract, source: srcLabel, title, apiMissing };
  })();

  cache.set(key, job.catch(err => { cache.delete(key); throw err; }));
  return job;
}
