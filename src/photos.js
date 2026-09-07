/* =========================================================
   实景影像
   ---------------------------------------------------------
   数据源全部为真实在线影像瓦片, 按 Web Mercator (EPSG:3857)
   标准 XYZ 方案在浏览器端实时拼接:
     · Esri World Imagery  — 全球高分辨率正射影像 (最高 z19)
     · 高德卫星影像 style=6 — 中国境内影像, 更新较快 (最高 z18)
     · 高德注记图层 ltype=11 — 带透明通道的中文地名/路名叠加
     · 高德路网图 style=8    — 街区路网 + 注记
   不做任何本地缓存, 每次打开都是当下的线上影像。
   ========================================================= */

const TILE = 256;

/** 经纬度 -> 指定层级下的世界像素坐标 */
export function lonLatToPixel(lon, lat, z) {
  const n = TILE * Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)));
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

/** 每像素对应的地面距离 (米) */
export function metersPerPixel(lat, z) {
  return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}

function tileURL(kind, z, x, y) {
  const n = 1 << z;
  if (y < 0 || y >= n) return null;
  x = ((x % n) + n) % n;
  const s = (x + y) % 4 + 1;
  switch (kind) {
    case 'esri':
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    case 'amapSat':
      return `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&style=6&ltype=0`;
    case 'amapLabel':
      return `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&style=8&ltype=11&lang=zh_cn`;
    case 'amapRoad':
      return `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&style=8&lang=zh_cn`;
    default:
      return null;
  }
}

/* ---------------- 视图组 ----------------
   每处地点提供 5 张不同尺度/来源的真实影像, 灯箱里左右切换
   ------------------------------------------------------- */
export const PHOTO_VIEWS = [
  {
    id: 'close', name: '建筑特写', z: 19, layers: ['esri'],
    src: 'Esri World Imagery · 正射影像 z19', bg: '#0b1220',
  },
  {
    id: 'block', name: '街区实景', z: 18, layers: ['amapSat', 'amapLabel'],
    src: '高德卫星影像 + 中文注记 · z18', bg: '#0b1220',
  },
  {
    id: 'area', name: '片区俯瞰', z: 16, layers: ['esri', 'amapLabel'],
    src: 'Esri World Imagery + 高德注记 · z16', bg: '#0b1220',
  },
  {
    id: 'street', name: '路网街区', z: 16, layers: ['amapRoad'],
    src: '高德路网图 · z16', bg: '#eef2f7',
  },
  {
    id: 'city', name: '城市区位', z: 13, layers: ['esri', 'amapLabel'],
    src: 'Esri World Imagery + 高德注记 · z13', bg: '#0b1220',
  },
];

export const viewById = (id) => PHOTO_VIEWS.find(v => v.id === id) || PHOTO_VIEWS[0];

/* ---------------- 比例尺 ---------------- */
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
function scaleBar(lat, z, maxPx) {
  const mpp = metersPerPixel(lat, z);
  let best = NICE[0];
  for (const m of NICE) if (m / mpp <= maxPx) best = m;
  return { px: Math.round(best / mpp), txt: best >= 1000 ? (best / 1000) + ' km' : best + ' m' };
}

/**
 * 在 host 元素内拼出一幅影像
 * @param host  容器 (需已有确定尺寸, position:relative, overflow:hidden)
 * @param lon,lat 中心点
 * @param view  PHOTO_VIEWS 中的一项
 * @param opt   { mark:true 显示中心标记, bar:true 显示比例尺, onProgress(loaded,total) }
 */
export function renderMosaic(host, lon, lat, view, opt = {}) {
  const w = Math.max(80, host.clientWidth || opt.w || 360);
  const h = Math.max(60, host.clientHeight || opt.h || 200);
  const z = view.z;

  host.textContent = '';
  host.style.background = view.bg || '#0b1220';

  const [px, py] = lonLatToPixel(lon, lat, z);
  const left = px - w / 2, top = py - h / 2;
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + w - 1) / TILE);
  const y0 = Math.floor(top / TILE), y1 = Math.floor((top + h - 1) / TILE);

  let total = 0, loaded = 0;
  const tick = () => { loaded++; opt.onProgress && opt.onProgress(loaded, total); };

  view.layers.forEach((kind, li) => {
    const layer = document.createElement('div');
    layer.style.cssText = `position:absolute;inset:0;z-index:${li + 1}`;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const u = tileURL(kind, z, tx, ty);
        if (!u) continue;
        const im = document.createElement('img');
        im.decoding = 'async';
        im.draggable = false;
        im.alt = '';
        im.style.cssText = `position:absolute;left:${Math.round(tx * TILE - left)}px;` +
          `top:${Math.round(ty * TILE - top)}px;width:${TILE}px;height:${TILE}px;` +
          `image-rendering:auto;user-select:none`;
        total++;
        im.addEventListener('load', tick, { once: true });
        im.addEventListener('error', () => { im.style.visibility = 'hidden'; tick(); }, { once: true });
        im.src = u;
        layer.appendChild(im);
      }
    }
    host.appendChild(layer);
  });

  // 中心十字标记: 指出这处地点的准确位置
  if (opt.mark !== false) {
    const mk = document.createElement('div');
    mk.style.cssText = 'position:absolute;left:50%;top:50%;z-index:9;pointer-events:none;' +
      'transform:translate(-50%,-50%)';
    mk.innerHTML =
      `<svg width="54" height="54" viewBox="0 0 54 54">
         <circle cx="27" cy="27" r="15" fill="none" stroke="#4fd6ff" stroke-width="1.6" opacity=".95"/>
         <circle cx="27" cy="27" r="22" fill="none" stroke="#4fd6ff" stroke-width="1" opacity=".38"/>
         <circle cx="27" cy="27" r="2.6" fill="#ff4d94"/>
         <path d="M27 2v9M27 43v9M2 27h9M43 27h9" stroke="#4fd6ff" stroke-width="1.3" opacity=".8"/>
       </svg>`;
    host.appendChild(mk);
  }

  // 比例尺
  if (opt.bar !== false) {
    const sb = scaleBar(lat, z, Math.min(150, w * 0.35));
    const bar = document.createElement('div');
    const dark = (view.bg || '#0b1220').startsWith('#0');
    bar.style.cssText = 'position:absolute;left:9px;top:8px;z-index:10;pointer-events:none;' +
      `font-size:9.5px;letter-spacing:.5px;color:${dark ? '#dbe6f7' : '#33475f'};` +
      'text-shadow:0 1px 3px rgba(0,0,0,.65)';
    bar.innerHTML =
      `<div style="display:flex;align-items:flex-end;gap:5px">
         <div style="width:${sb.px}px;height:5px;border:1px solid currentColor;border-top:none"></div>
         <span>${sb.txt}</span>
       </div>`;
    host.appendChild(bar);
  }

  return { total, view };
}

/** 缩略图: 单张瓦片即可, 用于抽屉里的横向选择条 */
export function thumbURL(lon, lat, view) {
  const kind = view.layers[0];
  const z = Math.min(view.z, 18);
  const [px, py] = lonLatToPixel(lon, lat, z);
  return tileURL(kind, z, Math.floor(px / TILE), Math.floor(py / TILE));
}
