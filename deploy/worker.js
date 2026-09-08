/**
 * 上海三维城市沙盘 · 照片服务 (Cloudflare Worker 版)
 * ------------------------------------------------------------
 * GitHub Pages 是纯静态托管, 跑不了 server.js, 这个 Worker 就是它的"服务端"。
 * 部署后把地址填给前端 window.__PHOTO_API, 线上观众也能看到国内源照片,
 * 高德 Key 只存在 Worker 的环境变量里, 浏览器永远看不到。
 *
 * 接口:
 *   GET /api/photo?q=<地标名>   → { photos:[{url,title}], extract, source, title }
 *   GET /                       → 自检信息
 *
 * 环境变量 (Cloudflare Dashboard → Settings → Variables):
 *   AMAP_KEY       高德 Web 服务 Key (可选, 配了才有高德 POI 实景图)
 *   ALLOW_ORIGIN   允许调用的来源, 默认 "*", 建议改成自己的 Pages 域名
 *
 * 说明: 图片 URL 直接返回原始地址, 浏览器 <img> 加载不受 CORS 限制,
 *       因此 Worker 不需要做图片代理, 省一层流量。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchT(url, ms = 6000, headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
    });
  } finally {
    clearTimeout(t);
  }
}

async function jget(url, ms) {
  const r = await fetchT(url, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---------- 来源 1: 高德 POI 实景图 (需 AMAP_KEY) ----------
   v=60: Worker 出口在海外, 跨境请求高德延迟高 -> 超时提到 10s 并重试一次;
   同时把命中情况写进 debug, 便于远程诊断。 */
async function amapSrc(name, key, dbg) {
  if (!key) { dbg.amap = 'no-key'; return null; }
  const qs = new URLSearchParams({ key, keywords: name, city: '上海', citylimit: 'true', offset: '5', extensions: 'all' });
  const url = 'https://restapi.amap.com/v3/place/text?' + qs.toString();
  let d = null, err = 'unknown';
  for (let attempt = 0; attempt < 2 && !d; attempt++) {
    try {
      const r = await fetchT(url, 10000);
      if (!r.ok) { err = 'http' + r.status; continue; }
      const j = await r.json();
      if (j.status === '1') { d = j; break; }
      err = 'api:' + (j.info || j.status);
    } catch (e) {
      err = 'fetch:' + String(e && e.name || e).slice(0, 30);   // 超时通常是 AbortError
    }
  }
  if (!d || !Array.isArray(d.pois)) { dbg.amap = 'error:' + err; return null; }
  const norm = (s) => String(s || '').replace(/[\s·・\-—_（）()]/g, '').toLowerCase();
  const k = norm(name);
  const hit = d.pois.find((p) => {
    const n = norm(p.name);
    return n && (n.includes(k) || k.includes(n));
  });
  if (!hit) { dbg.amap = 'no-match:' + (d.pois[0] && d.pois[0].name || 'none'); return null; }
  const photos = [];
  for (const p of (hit.photos || []).slice(0, 6)) {
    const u = p.url || p.photo;
    if (u) photos.push({ url: u.replace(/^http:/, 'https:'), title: p.title || hit.name || name });
  }
  if (!photos.length) { dbg.amap = 'no-photos:' + hit.name; return null; }
  dbg.amap = 'ok:' + photos.length + ':' + hit.name;
  return { photos, extract: '', title: hit.name || name, source: '高德地图 POI' };
}

/* ---------- 来源 2: 快懂百科 (免 Key) ---------- */
async function kuaidongSrc(name, dbg) {
  const r = await fetchT('https://www.baike.com/wiki/' + encodeURIComponent(name), 7000);
  if (!r.ok) return null;
  const html = await r.text();
  const cleaned = html.replace(/\\\//g, '/');
  const photos = [];
  const seen = new Set();
  const re = /https?:\/\/p\d+-sign\.douyinpic\.com\/[A-Za-z0-9/_~=-]+\.(?:jpeg|jpg|png|webp)[?A-Za-z0-9&=_-]*/g;
  let m;
  while ((m = re.exec(cleaned)) && photos.length < 8) {
    const u = m[0].replace(/[",)\]]+$/, '');
    const pathKey = u.split('?')[0];
    if (seen.has(pathKey)) continue;
    seen.add(pathKey);
    photos.push({ url: u, title: name });
  }
  let extract = '';
  const dm = html.match(/<meta\s+name="description"\s+content="([^"]{30,600})"/);
  if (dm) extract = dm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!photos.length && !extract) { dbg.kuaidong = 'empty'; return null; }
  dbg.kuaidong = photos.length ? 'photos:' + photos.length : 'text-only';
  return { photos: photos.slice(0, 6), extract, title: name, source: '快懂百科' };
}

/* ---------- 来源 3: 必应图片 (免 Key, 引号精确搜索 + 相关性过滤) ---------- */
async function bingSrc(name, dbg) {
  const r = await fetchT('https://cn.bing.com/images/search?q=' + encodeURIComponent('"' + name + '"') + '&form=HDRSC2',
    7000, { Referer: 'https://cn.bing.com/' });
  if (!r.ok) return null;
  const html = await r.text();
  const key = name.replace(/^上海市?/, '');
  const relevant = (s) => {
    s = String(s || '');
    return s.indexOf(name) >= 0 || (key.length >= 3 && s.indexOf(key) >= 0);
  };
  const photos = [];
  const seen = new Set();
  for (const cd of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
    if (photos.length >= 4) break;
    try {
      const j = JSON.parse(cd[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      const t = j.turl || '';
      if (!t || seen.has(t)) continue;
      if (!relevant(String(j.t || '') + ' ' + String(j.desc || ''))) continue;
      seen.add(t);
      photos.push({ url: t.replace(/^http:/, 'https:'), title: name });
    } catch (e) { /* 单卡解析失败跳过 */ }
  }
  if (!photos.length) { dbg.bing = 'no-relevant'; return null; }
  dbg.bing = 'ok:' + photos.length;
  return { photos, extract: '', title: name, source: '必应图片' };
}

const cache = new Map();

async function aggregate(q, key) {
  if (!q) return { photos: [], extract: '', source: '缺少参数 q', title: '' };
  const c = cache.get(q);
  if (c && Date.now() - c.at < 600000) return c.data;

  const dbg = { amap: 'n/a', kuaidong: 'n/a', bing: 'n/a' };
  const want = (f) => f().catch((e) => { return null; });
  const results = await Promise.all([
    want(() => amapSrc(q, key, dbg)),
    want(() => kuaidongSrc(q, dbg)),
    want(() => bingSrc(q, dbg)),
  ]);
  const out = { photos: [], extract: '', title: '', source: '' };
  const seen = new Set();
  let srcPhoto = '', srcExtract = '';
  for (const r of results) {
    if (!r) continue;
    if (!srcPhoto && r.photos && r.photos.length && r.source) srcPhoto = r.source;
    if (!srcExtract && r.extract && r.source) srcExtract = r.source;
    if (!out.title && r.title) out.title = r.title;
    if (!out.extract && r.extract) out.extract = r.extract;
    for (const p of (r.photos || [])) {
      if (out.photos.length >= 6) break;
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      out.photos.push(p);
    }
  }
  out.source = srcPhoto || srcExtract || '无可用来源';
  /* debug 字段仅用于远程诊断(各源命中情况), 前端不使用 */
  const data = { photos: out.photos, extract: out.extract, source: out.source, title: out.title, debug: dbg };
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(q, { at: Date.now(), data });
  return data;
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Cache-Control': 'public, max-age=600',
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname === '/api/photo') {
      const data = await aggregate(url.searchParams.get('q') || '', env.AMAP_KEY || '');
      return json(data, origin);
    }

    return json({
      service: 'shanghai-3d photo api',
      ok: true,
      amap: env.AMAP_KEY ? 'configured' : 'missing',
      usage: '/api/photo?q=静安雕塑公园',
    }, origin);
  },
};
