/**
 * 上海三维城市数字沙盘 · 静态服务器
 *
 * 纯 Node 内置模块实现, 零依赖。
 *   node server.js          # 默认 http://127.0.0.1:8080
 *   node server.js 3000     # 指定端口
 *   set PORT=3000 && node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// 需要压缩的文本类型
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|map)$/i;
const gzipCache = new Map();

function send(res, code, headers, body) {
  res.writeHead(code, headers);
  if (res.method === 'HEAD') return res.end();
  res.end(body);
}

function serveFile(res, filePath, acceptGzip) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 Not Found');

    const base = {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Last-Modified': st.mtime.toUTCString(),
    };

    // 大文本文件走 gzip, 结果缓存, 显著降低首屏加载时间
    const canZip = acceptGzip && COMPRESSIBLE.test(filePath) && st.size > 1024;
    if (canZip) {
      const cached = gzipCache.get(filePath);
      if (cached && cached.mtime === st.mtimeMs) {
        return send(res, 200, { ...base, 'Content-Encoding': 'gzip', 'Content-Length': cached.buf.length }, cached.buf);
      }
      return fs.readFile(filePath, (e, buf) => {
        if (e) return send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, '500 Read Error');
        zlib.gzip(buf, { level: 6 }, (ze, zbuf) => {
          if (ze) return send(res, 200, base, buf);
          gzipCache.set(filePath, { mtime: st.mtimeMs, buf: zbuf });
          send(res, 200, { ...base, 'Content-Encoding': 'gzip', 'Content-Length': zbuf.length }, zbuf);
        });
      });
    }

    fs.createReadStream(filePath)
      .on('error', () => send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, '500 Read Error'))
      .pipe(res);
    res.writeHead(200, base);
  });
}

/* =========================================================
   v=53: 多源真实照片 API —— 部署后观众(无 VPN)也能看到真实照片
   ---------------------------------------------------------
   GET /api/photo?q=<名称>&lon=&lat=
     服务端并发聚合 4 个来源, 按优先级合并(最多 6 张):
       1) 维基百科中继 (服务器可达维基时; 大陆服务器 3.5s 快速失败跳过)
       2) 高德 POI 实景图   (需 AMAP_KEY, 可选)
       3) 百度百科          (免 Key, 部署默认主力)
       4) 搜狗百科          (免 Key, 补充)
     返回结构与前端 getPlaceMedia 一致:
       { photos:[{url,title}], extract, source, title }
     结果按名称缓存 10 分钟。
   GET /api/img?u=<图片URL>
     同源图片代理: 域名白名单校验(防 SSRF), 服务端拉取后回传,
     解决 bkimg/amap 等图床的防盗链与混排问题。
   Key 配置(可选): 环境变量 AMAP_KEY 或 data/amap_key.txt 文件。
   ========================================================= */
const AMAP_KEY = (process.env.AMAP_KEY || readKeyFile('data/amap_key.txt') || '').trim();

function readKeyFile(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').trim(); } catch (e) { return ''; }
}

// 图片代理域名白名单(后缀匹配)
const IMG_ALLOW = ['wikipedia.org', 'wikimedia.org', 'wikidata.org', 'wikivoyage.org',
  'amap.com', 'bcebos.com', 'sogoucdn.com', 'sogou.com', 'qhimg.com', 'so.com',
  'baidu.com', 'bdstatic.com', 'gtimg.com', 'qq.com',
  'douyinpic.com', 'byteimg.com', 'zjcdn.com',    // v=53: 快懂百科图床
  'bing.net', 'bing.com',                         // v=53: 必应缩略图 CDN
  'autonavi.com'];                                // v=57: 高德 POI 实景图床

/* v=57: 静态服�?务拒绝敏感文件(Key/配置), 防�?data/ 目录被当静态资源下载 */
const DENY_EXT = /\.(txt|key|pem|env|ini|conf|log)$/i;

function hostAllowed(h) {
  h = String(h || '').toLowerCase();
  return IMG_ALLOW.some(d => h === d || h.endsWith('.' + d));
}

function pimg(u) { return '/api/img?u=' + encodeURIComponent(u); }

function fetchT(url, ms = 6000, headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, {
    signal: ctl.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...headers,
    },
  }).finally(() => clearTimeout(t));
}

async function jget(url, ms) {
  const r = await fetchT(url, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* --- 来源 1: 服务端维基中继 --- */
async function wikiSrc(name) {
  const s = await jget('https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
    encodeURIComponent(name) + '&format=json&srlimit=1', 3500);
  const hit = s.query && s.query.search && s.query.search[0];
  if (!hit) return null;
  const title = hit.title;
  const [sum, pis] = await Promise.all([
    jget('https://zh.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), 3500).catch(() => null),
    jget('https://zh.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(title) +
      '&prop=pageimages&piprop=original%7Cthumbnail&pithumbsize=800&format=json', 3500).catch(() => null),
  ]);
  const photos = [];
  let extract = '';
  if (sum && sum.extract) extract = sum.extract;
  if (sum && sum.thumbnail && sum.thumbnail.source) photos.push({ url: pimg(sum.thumbnail.source), title });
  if (pis && pis.query && pis.query.pages) {
    for (const k in pis.query.pages) {
      const p = pis.query.pages[k];
      const u = (p.original && p.original.source) || (p.thumbnail && p.thumbnail.source);
      if (u) photos.push({ url: pimg(u), title });
    }
  }
  return photos.length ? { photos, extract, title, source: '维基百科 (服务器中继)' } : (extract ? { photos: [], extract, title, source: '维基百科 (服务器中继)' } : null);
}

/* --- 来源 2: 高德 POI 实景图 (可选, 需 Key; 按 POI 检索, 相关性最强) ---
   v=57: 名称校验 —— 高德按关键词可能匹配到"XX停车场/XX分店"等噪声 POI,
   只取与查询名互为子串(去空白/符号后)的 POI, 否则整源放弃(宁缺毋滥)。 */
async function amapSrc(name /* , lon, lat */) {
  if (!AMAP_KEY) return null;
  const qs = new URLSearchParams({ key: AMAP_KEY, keywords: name, city: '上海', citylimit: 'true', offset: '5', extensions: 'all' });
  const d = await jget('https://restapi.amap.com/v3/place/text?' + qs.toString(), 6000);
  if (d.status !== '1' || !Array.isArray(d.pois)) return null;
  const norm = (s) => String(s || '').replace(/[\s·・\-—_（）()]/g, '').toLowerCase();
  const k = norm(name);
  const hit = (d.pois || []).find((p) => {
    const n = norm(p.name);
    return n && (n.includes(k) || k.includes(n));
  });
  if (!hit) return null;
  const photos = [];
  for (const p of (hit.photos || []).slice(0, 6)) {
    const u = p.url || p.photo;
    if (!u) continue;
    /* v=61: 高德 photos[].title 是数组(常为空数组), 空数组 truthy 会让
       `p.title || 地名` 拿到 [] —— 必须判非空字符串再回退。 */
    const t = (typeof p.title === 'string' && p.title.trim()) ? p.title.trim() : (hit.name || name);
    photos.push({ url: pimg(u), title: t });
  }
  return photos.length ? { photos, extract: '', title: hit.name || name, source: '高德地图 POI' } : null;
}

function stripTags(h) { return String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

/* --- 来源 3: 必应图片 (免 Key, cn.bing.com 大陆直连; 用必应自有缩略图 CDN, 最稳)
   v=55: 引号精确搜索 + 标题相关性过滤 —— 修复"中华艺术宫"被分词成"中华"搜出
   香烟图的噪声问题; 不相关的卡片整张丢弃(宁缺毋滥)。 --- */
async function bingSrc(name) {
  const r = await fetchT('https://cn.bing.com/images/search?q=' + encodeURIComponent('"' + name + '"') + '&form=HDRSC2',
    7000, { Referer: 'https://cn.bing.com/' });
  if (!r.ok) return null;
  const html = await r.text();
  const key = name.replace(/^上海市?/, '');   // 宽松键: 去掉"上海/上海市"前缀后 ≥3 字也可判相关
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
      if (!relevant(String(j.t || '') + ' ' + String(j.desc || ''))) continue;   // 标题/描述不含地名 → 丢弃
      seen.add(t);
      photos.push({ url: pimg(t.replace(/^http:/, 'https:')), title: name });
    } catch (e) { /* 单卡解析失败跳过 */ }
  }
  return photos.length ? { photos, extract: '', title: name, source: '必应图片' } : null;
}

/* --- 来源 4: 快懂百科 (免 Key; 字节系, 国内直连稳定) --- */
async function kuaidongSrc(name) {
  const r = await fetchT('https://www.baike.com/wiki/' + encodeURIComponent(name), 7000);
  if (!r.ok) return null;
  const html = await r.text();
  // 图片是带签名的临时 URL(douyinpic), 藏在页面 JSON 里, 可能带 \/ 转义
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
    photos.push({ url: pimg(u), title: name });
  }
  let extract = '';
  const dm = html.match(/<meta\s+name="description"\s+content="([^"]{30,600})"/);
  if (dm) extract = stripTags(dm[1]);
  if (!photos.length && !extract) return null;
  return { photos: photos.slice(0, 6), extract, title: name, source: '快懂百科' };
}

/* --- 来源 4: 百度百科 (免 Key, 尽力而为: 部分网络/指纹下会 403) --- */
async function baikeSrc(name) {
  const r = await fetchT('https://baike.baidu.com/item/' + encodeURIComponent(name), 6000);
  if (!r.ok) return null;
  const html = await r.text();
  const photos = [];
  const seen = new Set();
  const re = /(?:https?:)?\/\/bkimg\.cdn\.bcebos\.com\/[A-Za-z0-9/_+=?&.%-]+/g;
  let m;
  while ((m = re.exec(html)) && photos.length < 6) {
    let u = m[0];
    if (u.startsWith('//')) u = 'https:' + u;
    const base = u.split('?')[0];
    if (base.length < 40 || seen.has(base)) continue;   // 过滤过短的噪声串
    seen.add(base);
    photos.push({ url: pimg(base), title: name });
  }
  let extract = '';
  const dm = html.match(/<meta\s+name="description"\s+content="([^"]{30,600})"/);
  if (dm) extract = stripTags(dm[1]);
  return photos.length ? { photos, extract, title: name, source: '百度百科' } : (extract ? { photos: [], extract, title: name, source: '百度百科' } : null);
}

/* --- 来源 4: 搜狗百科 (免 Key, 补充) --- */
async function sogouSrc(name) {
  const r = await fetchT('https://baike.sogou.com/m/fullLemma?key=' + encodeURIComponent(name), 6000);
  if (!r.ok) return null;
  const html = await r.text();
  const photos = [];
  const seen = new Set();
  const re = /(?:https?:)?\/\/img\w*\.sogoucdn\.com\/[A-Za-z0-9/_+=?&.%-]+\.(?:jpg|jpeg|png|webp)/gi;
  let m;
  while ((m = re.exec(html)) && photos.length < 6) {
    let u = m[0];
    if (u.startsWith('//')) u = 'https:' + u;
    const base = u.split('?')[0];
    if (seen.has(base)) continue;
    seen.add(base);
    photos.push({ url: pimg(base), title: name });
  }
  let extract = '';
  const dm = html.match(/<meta\s+name="description"\s+content="([^"]{30,600})"/);
  if (dm) extract = stripTags(dm[1]);
  return photos.length ? { photos, extract, title: name, source: '搜狗百科' } : null;
}

const photoCache = new Map();

async function aggregatePhotos(qs) {
  const name = qs.get('q') || '';
  if (!name) return { photos: [], extract: '', source: '缺少参数 q', title: '' };
  const c = photoCache.get(name);
  if (c && Date.now() - c.at < 600000) return c.data;

  const want = f => f().catch(() => null);
  /* v=55: 百科条目图(准)优先于图片搜索(准但少) —— kuaidong 提到 bing 前 */
  const results = await Promise.all([
    want(() => wikiSrc(name)),
    want(() => amapSrc(name)),
    want(() => kuaidongSrc(name)),
    want(() => bingSrc(name)),
    want(() => baikeSrc(name)),
    want(() => sogouSrc(name)),
  ]);
  const out = { photos: [], extract: '', title: '', source: '' };
  const seen = new Set();
  let srcPhoto = '', srcExtract = '';
  for (const r of results) {
    if (!r) continue;
    /* v=55: 来源标签只认真正出图的源(只贡献简介的不冒领) */
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
  const data = { photos: out.photos, extract: out.extract, source: out.source, title: out.title };
  if (photoCache.size > 200) photoCache.delete(photoCache.keys().next().value);
  photoCache.set(name, { at: Date.now(), data });
  return data;
}

function apiSendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function handleApi(req, res, url) {
  if (url.pathname === '/api/photo') {
    aggregatePhotos(url.searchParams)
      .then(d => apiSendJson(res, d))
      .catch(() => apiSendJson(res, { photos: [], extract: '', source: 'aggregate error', title: '' }));
    return true;
  }
  if (url.pathname === '/api/img') {
    const u = url.searchParams.get('u') || '';
    let target;
    /* 守卫必须返回 true(已响应), 否则外层会误判未处理而二次发送 404 → 崩溃 */
    try { target = new URL(u); } catch (e) { send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, '400 bad url'); return true; }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') { send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, '400 bad protocol'); return true; }
    if (!hostAllowed(target.hostname)) { send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403 host not allowed'); return true; }
    fetchT(target.href, 9000, { Referer: target.origin + '/' })
      .then(async up => {
        if (!up.ok) return send(res, 502, { 'Content-Type': 'text/plain; charset=utf-8' }, '502 upstream ' + up.status);
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': up.headers.get('content-type') || 'image/jpeg',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buf);
      })
      /* v=53: 上游拉取失败时回退 302 —— 让浏览器自己加载(浏览器网络/代理可能与服务器不同) */
      .catch(() => {
        res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' });
        res.end();
      });
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, '400 Bad Request');
  }

  /* v=53: API 路由优先于静态文件 */
  if (urlPath.startsWith('/api/')) {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, '400 Bad Request'); }
    if (handleApi(req, res, u)) return;
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 Unknown API');
  }

  if (urlPath === '/') urlPath = '/index.html';

  /* v=57: 敏感文件守卫 —— Key/配置文件默认目录 data/ 是可静态访问的,
     这里拦掉 .txt/.key/.env 等, 避免密钥被直接下载 */
  if (DENY_EXT.test(urlPath)) return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403 Forbidden');

  // 目录穿越防护
  const resolved = path.resolve(ROOT, '.' + urlPath);
  if (!resolved.startsWith(ROOT)) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403 Forbidden');
  }

  serveFile(res, resolved, /gzip/.test(req.headers['accept-encoding'] || ''));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。`);
    console.error(`  换一个端口:  node server.js ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }
  console.log('');
  console.log('  上海 · 三维城市数字沙盘');
  console.log('  ────────────────────────────────────────');
  console.log(`  本机访问:   http://127.0.0.1:${PORT}`);
  if (lan.length) console.log(`  局域网访问: http://${lan[0]}:${PORT}`);
  console.log('  停止服务:   Ctrl + C');
  console.log('');
});
