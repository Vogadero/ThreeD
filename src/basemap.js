import * as THREE from 'three';

/* =========================================================
   真实地表底图
   将 Esri World Imagery 卫星瓦片拼接为单张纹理, 铺在场景最底层,
   使城市具备可辨认的真实地貌。支持日间 / 夜景两种色调。
   ========================================================= */

export const Y = {
  basemap: 0.015,      // 底图平面
  districtBase: 0.040, // 行政区地块底
  districtTop: 0.090,  // 行政区地块顶
  ground: 0.095,       // 建筑 / 地标底面
  water: 0.098,        // 水面
  road: 0.102,         // 道路
  poi: 0.20,           // 景点标记
  bus: 0.17,           // 公交站
  metro: 0.62,         // 地铁站与线路
};

const LON0 = 121.4737, LAT0 = 31.2304;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const M_LAT = 110957;
const proj = (lon, lat) => [(lon - LON0) * M_LON / 1000, -(lat - LAT0) * M_LAT / 1000];

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * @param meta  assets/tiles/meta.json
 * @param root  瓦片根路径
 */
export async function buildBasemap(meta, root = 'assets/tiles') {
  const { zoom, x0, y0, cols, rows, tile } = meta;

  // 目标纹理宽度: 控制在 4096 以内, 兼容各档 GPU
  const MAXW = 3072;
  const fullW = cols * tile, fullH = rows * tile;
  const scale = Math.min(1, MAXW / fullW);
  const W = Math.round(fullW * scale);
  const H = Math.round(fullH * scale);
  const tw = tile * scale;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a1420';
  ctx.fillRect(0, 0, W, H);

  // 并发加载瓦片 (分批, 避免一次性建太多连接)
  const jobs = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      jobs.push({ i, j, x: x0 + i, y: y0 + j });
    }
  }

  const BATCH = 24;
  let done = 0, missed = 0;
  for (let b = 0; b < jobs.length; b += BATCH) {
    const part = jobs.slice(b, b + BATCH);
    const imgs = await Promise.all(
      part.map(p => loadImage(`${root}/${zoom}/${p.x}/${p.y}.jpg`))
    );
    imgs.forEach((img, k) => {
      const p = part[k];
      if (img) {
        // 多画 1px 消除瓦片间的缝隙
        ctx.drawImage(img, p.i * tw, p.j * tw, tw + 1, tw + 1);
      } else {
        missed++;
      }
      done++;
    });
  }

  // 原图缓存, 用于日间/夜景切换
  const raw = document.createElement('canvas');
  raw.width = W; raw.height = H;
  raw.getContext('2d').drawImage(cv, 0, 0);

  const out = document.createElement('canvas');
  out.width = W; out.height = H;

  function paint(mode) {
    const c = out.getContext('2d');
    c.clearRect(0, 0, W, H);
    c.drawImage(raw, 0, 0);
    if (mode === 'night') {
      // 冷色染色, 压暗, 得到夜间卫星观感
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = '#6f8fc0';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = 'rgba(4,10,22,0.46)';
      c.fillRect(0, 0, W, H);
      // 提亮一点暖色, 模拟城市灯光
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(90,60,25,0.10)';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }
  }

  paint('day');

  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  // ---- 计算底图在场景中的摆放 ----
  const [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX] = meta.bounds;
  const [xa, za] = proj(LON_MIN, LAT_MAX);   // 西北角
  const [xb, zb] = proj(LON_MAX, LAT_MIN);   // 东南角
  const w = xb - xa, h = zb - za;
  const cx = (xa + xb) / 2, cz = (za + zb) / 2;

  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, Y.basemap, cz);
  mesh.name = 'basemap';
  mesh.renderOrder = -10;

  return {
    mesh,
    texture: tex,
    canvas: out,
    missed,
    tileCount: jobs.length,
    size: [W, H],
    /** mode: 'day' | 'night' */
    setMode(mode) {
      paint(mode);
      tex.needsUpdate = true;
    },
  };
}
