import * as THREE from 'three';
import { Y } from './basemap.js?v=32';

/* =========================================================
   1687 处网红景点 —— "真实建模形状"
   ---------------------------------------------------------
   1) 有 OSM 真实建筑 footprint 的: 直接按真实多边形挤出成体,
      并抬高 5% + 顶冠, 完整包住原有城市体块, 变成"景点本体"。
   2) 没有 footprint 的: 按 kind(博物馆/塔/教堂/公园/主题乐园…)
      生成对应的真实结构体(台基+主体+坡顶+立柱+塔楼+树木…),
      而不是一个图钉或八边形色块。
   全部合并成单个 BufferGeometry, 一次 draw call。
   ========================================================= */

const MH = 0.001;                 // 1 米 水平 -> 场景单位 (1 单位 = 1 km)
const MV = 0.0016;                // 1 米 垂直 (与 buildings.js 一致)
const G = Y.ground;               // 建筑底面

const KIND_COLOR = {
  attraction: '#4fd6ff', museum: '#ffb703', artwork: '#c77dff', gallery: '#c77dff',
  viewpoint: '#5ef2a0', theme_park: '#ff6b6b', zoo: '#ffb703', nature_reserve: '#5ef2a0',
  park: '#5ef2a0', monument: '#ffd166', memorial: '#ffd166', landmark: '#ff8ec7',
  apartments: '#e8d5a8', building: '#e8d5a8', statue: '#c77dff', palace: '#ffd166',
  place_of_worship: '#ffe08a', theatre: '#ff8ec7', cinema: '#ff8ec7', arts_centre: '#c77dff',
  archaeological_site: '#ffd166', historic: '#ffd166', ruins: '#ffd166', castle: '#ffd166',
  communications_tower: '#ff6b6b', tower: '#ff8ec7', hotel: '#9fd8ff', resort: '#9fd8ff',
  water_park: '#4fd6ff', garden: '#5ef2a0', observatory: '#ffb703', sports_centre: '#5ef2a0',
};
const FALLBACK = '#4fd6ff';

const _c = new THREE.Color();
function rgb(hex, mul) {
  _c.set(hex);
  return [_c.r * mul, _c.g * mul, _c.b * mul];
}

/* ---------------- 几何累加器 ---------------- */
function push(B, p, n, col) {
  B.pos.push(p[0], p[1], p[2]);
  B.nrm.push(n[0], n[1], n[2]);
  B.col.push(col[0], col[1], col[2]);
}
function quad(B, a, b, c, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / l, ny / l, nz / l];
  const base = B.pos.length / 3;
  // 顶点色: 顶面更亮, 越靠下越暗 (简易 AO)
  const shade = (p) => {
    const k = 0.74 + 0.26 * Math.min(1, Math.max(0, n[1] * 0.5 + 0.5));
    return [p[0] * k, p[1] * k, p[2] * k];
  };
  push(B, a, n, shade(B.cur)); push(B, b, n, shade(B.cur));
  push(B, c, n, shade(B.cur)); push(B, d, n, shade(B.cur));
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function tri(B, a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / l, ny / l, nz / l];
  const base = B.pos.length / 3;
  const k = 0.78 + 0.22 * Math.min(1, Math.max(0, n[1]));
  const cc = [B.cur[0] * k, B.cur[1] * k, B.cur[2] * k];
  push(B, a, n, cc); push(B, b, n, cc); push(B, c, n, cc);
  B.idx.push(base, base + 1, base + 2);
}

function useColor(B, c) { B.cur = c; }

/* 长方体 (cy = 底面) */
function box(B, cx, cy, cz, w, h, d, side, top) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy, y1 = cy + h, z0 = cz - d / 2, z1 = cz + d / 2;
  useColor(B, side);
  quad(B, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad(B, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  quad(B, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  quad(B, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  useColor(B, top);
  quad(B, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
}

/* 棱柱 / 圆台 / 圆锥 (cy = 底面) */
function prism(B, cx, cy, cz, rB, rT, h, seg, side, top, rot = 0) {
  const y0 = cy, y1 = cy + h;
  const bx = [], bz = [], tx = [], tz = [];
  for (let i = 0; i <= seg; i++) {
    const a = rot + (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    bx.push(cx + rB * ca); bz.push(cz + rB * sa);
    tx.push(cx + rT * ca); tz.push(cz + rT * sa);
  }
  useColor(B, side);
  for (let i = 0; i < seg; i++) {
    quad(B, [bx[i], y0, bz[i]], [tx[i], y1, tz[i]], [tx[i + 1], y1, tz[i + 1]], [bx[i + 1], y0, bz[i + 1]]);
  }
  useColor(B, top);
  if (rT > 1e-6) {
    const ctr = [cx, y1, cz];
    for (let i = 0; i < seg; i++) tri(B, ctr, [tx[i + 1], y1, tz[i + 1]], [tx[i], y1, tz[i]]);
  } else {
    // 圆锥: 直接收到顶点
    for (let i = 0; i < seg; i++) tri(B, [bx[i], y0, bz[i]], [bx[i + 1], y0, bz[i + 1]], [cx, y1, cz]);
  }
}

/* 四坡屋顶 */
function hipRoof(B, cx, cy, cz, w, d, h, col) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const ap = [cx, cy + h, cz];
  useColor(B, col);
  tri(B, [x0, cy, z1], [x1, cy, z1], ap);
  tri(B, [x1, cy, z0], [x0, cy, z0], ap);
  tri(B, [x1, cy, z1], [x1, cy, z0], ap);
  tri(B, [x0, cy, z0], [x0, cy, z1], ap);
}

/* 穹顶 (多层收分近似) */
function dome(B, cx, cy, cz, R, side, top, tiers = 4, seg = 14) {
  let y = cy, prev = R;
  for (let i = 1; i <= tiers; i++) {
    const a = (i / tiers) * (Math.PI / 2);
    const r = R * Math.cos(a);
    const hh = R * (Math.sin(a) - Math.sin(((i - 1) / tiers) * (Math.PI / 2)));
    prism(B, cx, y, cz, prev, r, hh, seg, side, i === tiers ? top : side);
    y += hh; prev = r;
  }
}

/* 树 */
function tree(B, x, z, trunkC, leafC, s = 1) {
  prism(B, x, G, z, MH * 1.1 * s, MH * 0.9 * s, MV * 5 * s, 5, trunkC, trunkC);
  prism(B, x, G + MV * 4 * s, z, MH * 5.4 * s, 0, MV * 11 * s, 7, leafC, leafC);
}

/* ---------------- 按类型生成结构体 ---------------- */
/* 参数: B 累加器, x/z 场景坐标, k 热度缩放, side/top 颜色, D 精细度(0简/1中/2精) */
const BUILD = {
  /* 博物馆 / 美术馆: 大台基 + 主体 + 坡顶 + 柱廊 */
  museum(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 96 * k, MV * 4, MH * 74 * k, s, t);
    box(B, x, G + MV * 4, z, MH * 72 * k, MV * 27 * k, MH * 52 * k, s, t);
    hipRoof(B, x, G + MV * (4 + 27 * k), z, MH * 76 * k, MH * 56 * k, MV * 11 * k, t);
    if (D >= 1) {
      for (let i = -2; i <= 2; i++) {
        prism(B, x + MH * i * 13 * k, G + MV * 4, z + MH * 27 * k,
          MH * 2.0 * k, MH * 1.8 * k, MV * 27 * k, 8, s, t);
      }
      box(B, x, G, z + MH * 40 * k, MH * 60 * k, MV * 2, MH * 12 * k, s, t);
    }
  },
  gallery(B, x, z, k, s, t, D) { BUILD.museum(B, x, z, k * 0.8, s, t, D); },
  arts_centre(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 84 * k, MV * 3, MH * 64 * k, s, t);
    box(B, x, G + MV * 3, z, MH * 62 * k, MV * 24 * k, MH * 44 * k, s, t);
    dome(B, x, G + MV * (3 + 24 * k), z, MH * 20 * k, s, t, 3, 14);
    if (D >= 1) box(B, x, G, z + MH * 34 * k, MH * 34 * k, MV * 13, MH * 10 * k, s, t);
  },

  /* 塔 / 观光塔: 台基 + 收分塔身 + 观光层 + 天线 */
  tower(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 30 * k, MV * 6, MH * 30 * k, s, t);
    prism(B, x, G + MV * 6, z, MH * 10 * k, MH * 4.2 * k, MV * 105 * k, 10, s, t);
    if (D >= 1) {
      prism(B, x, G + MV * (6 + 74 * k), z, MH * 13 * k, MH * 13 * k, MV * 9, 16, s, t);
      prism(B, x, G + MV * (6 + 83 * k), z, MH * 11 * k, MH * 6 * k, MV * 14 * k, 16, s, t);
      prism(B, x, G + MV * (6 + 105 * k), z, MH * 1.4 * k, MH * 0.7 * k, MV * 34 * k, 6, s, t);
    }
  },
  communications_tower(B, x, z, k, s, t, D) { BUILD.tower(B, x, z, k * 1.15, s, t, D); },
  observatory(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 40 * k, MV * 5, MH * 40 * k, s, t);
    prism(B, x, G + MV * 5, z, MH * 14 * k, MH * 13 * k, MV * 40 * k, 14, s, t);
    dome(B, x, G + MV * (5 + 40 * k), z, MH * 14 * k, s, t, 4, 14);
  },

  /* 酒店 / 高层: 裙楼 + 塔楼 + 顶部造型 */
  hotel(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 62 * k, MV * 12, MH * 46 * k, s, t);
    box(B, x, G + MV * 12, z, MH * 38 * k, MV * 96 * k, MH * 28 * k, s, t);
    if (D >= 1) {
      box(B, x, G + MV * (12 + 96 * k), z, MH * 24 * k, MV * 10, MH * 18 * k, s, t);
      prism(B, x, G + MV * (22 + 96 * k), z, MH * 1.2, MH * 0.5, MV * 22 * k, 6, s, t);
    }
  },
  apartments(B, x, z, k, s, t, D) { BUILD.hotel(B, x, z, k * 0.82, s, t, D); },
  building(B, x, z, k, s, t, D) { BUILD.hotel(B, x, z, k * 0.75, s, t, D); },

  /* 综合地标 / 景点: 裙楼 + 主体 + 尖顶 */
  landmark(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 54 * k, MV * 8, MH * 42 * k, s, t);
    box(B, x, G + MV * 8, z, MH * 34 * k, MV * 54 * k, MH * 26 * k, s, t);
    prism(B, x, G + MV * (8 + 54 * k), z, MH * 11 * k, MH * 1.5 * k, MV * 26 * k, 8, s, t);
    if (D >= 2) {
      box(B, x, G, z + MH * 28 * k, MH * 30 * k, MV * 7, MH * 9 * k, s, t);
    }
  },
  attraction(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 46 * k, MV * 6, MH * 36 * k, s, t);
    box(B, x, G + MV * 6, z, MH * 30 * k, MV * 38 * k, MH * 24 * k, s, t);
    hipRoof(B, x, G + MV * (6 + 38 * k), z, MH * 34 * k, MH * 28 * k, MV * 9 * k, t);
  },

  /* 纪念碑 / 纪念物: 基座 + 方尖碑 + 锥顶 */
  monument(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 20 * k, MV * 5, MH * 20 * k, s, t);
    box(B, x, G + MV * 5, z, MH * 13 * k, MV * 3, MH * 13 * k, s, t);
    prism(B, x, G + MV * 8, z, MH * 6.5 * k, MH * 3.4 * k, MV * 34 * k, 4, s, t, Math.PI / 4);
    prism(B, x, G + MV * (8 + 34 * k), z, MH * 3.4 * k, 0, MV * 6 * k, 4, s, t, Math.PI / 4);
  },
  memorial(B, x, z, k, s, t, D) { BUILD.monument(B, x, z, k * 0.9, s, t, D); },

  /* 雕塑 / 艺术品: 基座 + 像身 + 头部 */
  statue(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 11 * k, MV * 8, MH * 11 * k, s, t);
    prism(B, x, G + MV * 8, z, MH * 3.6 * k, MH * 2.6 * k, MV * 13 * k, 8, s, t);
    prism(B, x, G + MV * (8 + 13 * k), z, MH * 2.4 * k, MH * 2.4 * k, MV * 4.4 * k, 8, s, t);
  },
  artwork(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 9 * k, MV * 3, MH * 9 * k, s, t);
    prism(B, x, G + MV * 3, z, MH * 4.2 * k, MH * 1.6 * k, MV * 16 * k, 6, s, t);
  },

  /* 教堂 / 寺庙: 中殿 + 坡顶 + 钟楼 */
  place_of_worship(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 54 * k, MV * 20 * k, MH * 26 * k, s, t);
    hipRoof(B, x, G + MV * 20 * k, z, MH * 58 * k, MH * 30 * k, MV * 12 * k, t);
    box(B, x - MH * 30 * k, G, z, MH * 13 * k, MV * 54 * k, MH * 13 * k, s, t);
    prism(B, x - MH * 30 * k, G + MV * 54 * k, z, MH * 7 * k, 0, MV * 22 * k, 4, s, t, Math.PI / 4);
    if (D >= 1) box(B, x, G, z + MH * 18 * k, MH * 16 * k, MV * 11, MH * 7 * k, s, t);
  },

  /* 宫殿 / 古建 / 遗址: 院墙 + 角楼 + 主殿 */
  palace(B, x, z, k, s, t, D) {
    const W = 76 * k, Dp = 56 * k;
    box(B, x, G, z, MH * W, MV * 9, MH * Dp, s, t);
    box(B, x, G + MV * 9, z, MH * W * 0.62, MV * 18 * k, MH * Dp * 0.58, s, t);
    hipRoof(B, x, G + MV * (9 + 18 * k), z, MH * W * 0.68, MH * Dp * 0.64, MV * 10 * k, t);
    if (D >= 1) {
      const cx = W / 2, cz = Dp / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        prism(B, x + MH * sx * cx, G, z + MH * sz * cz, MH * 6 * k, MH * 5 * k, MV * 26 * k, 6, s, t);
        prism(B, x + MH * sx * cx, G + MV * 26 * k, z + MH * sz * cz, MH * 8 * k, 0, MV * 9 * k, 6, s, t);
      }
    }
  },
  castle(B, x, z, k, s, t, D) { BUILD.palace(B, x, z, k * 1.05, s, t, D); },
  historic(B, x, z, k, s, t, D) { BUILD.palace(B, x, z, k * 0.8, s, t, D); },
  archaeological_site(B, x, z, k, s, t, D) {
    const W = 66 * k, Dp = 48 * k;
    for (const [ox, oz, w, d] of [
      [0, -Dp / 2, W, 3], [0, Dp / 2, W, 3], [-W / 2, 0, 3, Dp], [W / 2, 0, 3, Dp],
    ]) box(B, x + MH * ox, G, z + MH * oz, MH * w, MV * 7, MH * d, s, t);
    box(B, x, G, z, MH * W * 0.42, MV * 11, MH * Dp * 0.4, s, t);
  },
  ruins(B, x, z, k, s, t, D) { BUILD.archaeological_site(B, x, z, k * 0.9, s, t, D); },

  /* 公园 / 绿地 / 动物园: 树丛 + 亭子 */
  park(B, x, z, k, s, t, D) {
    const lc = rgb('#3fa86a', 1.0);
    const tc = rgb('#6b4a2f', 1.0);
    const n = D >= 2 ? 9 : D >= 1 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (x * 7.3 + z * 3.1);
      const rr = (0.55 + 0.45 * ((i * 37) % 11) / 11) * 46 * k;
      tree(B, x + MH * Math.cos(a) * rr, z + MH * Math.sin(a) * rr, tc, lc, 0.9 + (i % 3) * 0.22);
    }
    box(B, x, G, z, MH * 15 * k, MV * 6, MH * 15 * k, s, t);
    hipRoof(B, x, G + MV * 6, z, MH * 21 * k, MH * 21 * k, MV * 8 * k, t);
  },
  garden(B, x, z, k, s, t, D) { BUILD.park(B, x, z, k * 0.85, s, t, D); },
  nature_reserve(B, x, z, k, s, t, D) { BUILD.park(B, x, z, k * 1.15, s, t, D); },
  zoo(B, x, z, k, s, t, D) {
    BUILD.park(B, x, z, k, s, t, D);
    box(B, x, G, z - MH * 52 * k, MH * 26 * k, MV * 12, MH * 8 * k, s, t);
    prism(B, x - MH * 10 * k, G, z - MH * 52 * k, MH * 3, MH * 3, MV * 16, 6, s, t);
    prism(B, x + MH * 10 * k, G, z - MH * 52 * k, MH * 3, MH * 3, MV * 16, 6, s, t);
  },

  /* 主题乐园 / 水上乐园: 城堡 + 穹顶 + 摩天轮支架 */
  theme_park(B, x, z, k, s, t, D) {
    BUILD.palace(B, x - MH * 46 * k, z, k * 0.9, s, t, D);
    dome(B, x + MH * 40 * k, G, z + MH * 10 * k, MH * 30 * k, s, t, 4, 16);
    if (D >= 1) {
      // 摩天轮: 两座支架 + 轮盘(16 边圆环近似)
      const R = 42 * k;
      for (const sx of [-1, 1]) {
        prism(B, x + MH * sx * R * 0.5, G, z - MH * 56 * k, MH * 3.2, MH * 1.6, MV * R * 1.25, 6, s, t);
      }
      const cy = G + MV * R * 1.2, cz = z - MH * 56 * k;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        prism(B, x + Math.cos(a) * MH * R, cy + Math.sin(a) * MH * R, cz,
          MH * 1.5, MH * 1.5, MH * 3, 4, s, t);
      }
    }
  },
  water_park(B, x, z, k, s, t, D) {
    dome(B, x, G, z, MH * 40 * k, s, t, 4, 16);
    box(B, x, G, z + MH * 46 * k, MH * 50 * k, MV * 8, MH * 26 * k, s, t);
    if (D >= 1) prism(B, x + MH * 62 * k, G, z, MH * 6, MH * 4, MV * 34 * k, 6, s, t);
  },

  /* 观景点: 平台 + 柱亭 */
  viewpoint(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 26 * k, MV * 3, MH * 26 * k, s, t);
    if (D >= 1) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        prism(B, x + MH * sx * 9 * k, G + MV * 3, z + MH * sz * 9 * k, MH * 1.4, MH * 1.4, MV * 12, 6, s, t);
      }
    }
    box(B, x, G + MV * 15, z, MH * 24 * k, MV * 2, MH * 24 * k, s, t);
    hipRoof(B, x, G + MV * 17, z, MH * 28 * k, MH * 28 * k, MV * 10 * k, t);
  },

  /* 剧院 / 影院: 裙房 + 观众厅圆柱 */
  theatre(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 70 * k, MV * 5, MH * 48 * k, s, t);
    prism(B, x, G + MV * 5, z, MH * 24 * k, MH * 24 * k, MV * 26 * k, 16, s, t);
    box(B, x, G, z + MH * 30 * k, MH * 44 * k, MV * 14, MH * 12 * k, s, t);
    if (D >= 1) hipRoof(B, x, G + MV * 14, z + MH * 30 * k, MH * 48 * k, MH * 16 * k, MV * 6, t);
  },
  cinema(B, x, z, k, s, t, D) { BUILD.theatre(B, x, z, k * 0.85, s, t, D); },

  /* 体育中心: 大平台 + 穹顶 */
  sports_centre(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 104 * k, MV * 6, MH * 82 * k, s, t);
    dome(B, x, G + MV * 6, z, MH * 38 * k, s, t, 4, 18);
  },

  resort(B, x, z, k, s, t, D) {
    box(B, x, G, z, MH * 58 * k, MV * 14, MH * 38 * k, s, t);
    hipRoof(B, x, G + MV * 14, z, MH * 62 * k, MH * 42 * k, MV * 12 * k, t);
    if (D >= 1) BUILD.park(B, x + MH * 62 * k, z, k * 0.6, s, t, 0);
  },
};

/* ---------------- 主构建 ---------------- */
export function buildPoiBuildings({ pois, buildings, sites, footprints } = {}) {
  const group = new THREE.Group();
  group.name = 'poiBuildings';

  /* v=46: 网红景点 generic 体块(按 kind 着色的彩色圆柱/方盒/挤出体)整体下线。
     真实景点已由 379 处地标精模替代(替代删除三规则见 v=43/v=44);
     剩余长尾 POI 为商铺/道路/雕像等, 不再渲染。恢复请回退本函数。 */
  return { group, mesh: null, count: 0, real: 0 };

  if (!pois || !pois.length) return { group, mesh: null, count: 0, real: 0 };

  const B = { pos: [], nrm: [], col: [], idx: [], cur: [1, 1, 1] };

  /* --- 已有 footprint 索引 (原城市建筑 + 定向补拉的) --- */
  const CELL = 0.25;
  const grid = new Map();
  const addPoly = (p, h, n) => {
    if (!p || p.length < 6) return;
    const nv = p.length / 2;
    let cx = 0, cz = 0;
    for (let i = 0; i < nv; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= nv; cz /= nv;
    const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ p, h: h || 0.02, cx, cz, n: n || '' });
  };
  for (const b of (buildings || [])) addPoly(b.p, b.h, b.n);
  for (const f of (footprints || [])) addPoly(f.p, f.h, f.n);

  function findNearest(px, pz, radius) {
    const kx = Math.floor(px / CELL), kz = Math.floor(pz / CELL);
    const r = Math.ceil(radius / CELL);
    let best = null, bd = radius * radius;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const arr = grid.get((kx + dx) + ',' + (kz + dz));
      if (!arr) continue;
      for (const it of arr) {
        const d = (it.cx - px) ** 2 + (it.cz - pz) ** 2;
        if (d < bd) { bd = d; best = it; }
      }
    }
    return best;
  }

  /* 已有精模的地标让位 */
  const exclude = (sites || []).filter(s => s.rx).map(s => ({ x: s.x, z: s.z, r2: s.rx * s.rx }));
  const inExcluded = (px, pz) => exclude.some(e => (e.x - px) ** 2 + (e.z - pz) ** 2 <= e.r2);
  /* v=41/v=43: 被"地标精模"替代的网红景点 generic 体块, 直接删除。
     v=41 只删"完全同名"; v=43 补两条:
     ① 名称互相包含(≥3字) 且距精模 <250m —— 同一景点的别名/英文名/带后缀变体,
        例如"上海自然博物馆旧馆"被"上海自然博物馆"收编, "东方明珠塔"被"东方明珠"收编;
     ② 抑制半径取 max(编辑半径 rx, 模型实际占地 footR×1.15) —— 大体量精模
        (火车站 220m / 公园 300m) 不能只靠编辑半径, 不然边上总留着圆柱形挤出残留。 */
  const lmSites = (sites || []).map(s => ({
    name: s.name, x: s.x, z: s.z,
    supR: Math.max(s.rx || 0.05, (s.footR || 0) * 1.15, 0.05),
  }));

  let count = 0, real = 0;

  for (const p of pois) {
    const px = p.x, pz = p.z;
    let kill = false;
    for (const L of lmSites) {
      const dx = L.x - px, dz = L.z - pz;
      const d2 = dx * dx + dz * dz;
      if (p.name === L.name) { kill = true; break; }                                   // 同名
      if (d2 <= L.supR * L.supR) { kill = true; break; }                               // 占地内
      if (p.name.length >= 3 && L.name.length >= 3 &&
          (p.name.includes(L.name) || L.name.includes(p.name)) &&
          d2 <= 0.25 * 0.25) { kill = true; break; }                                   // 别名
    }
    if (kill) continue;
    if (inExcluded(px, pz)) continue;

    const hex = KIND_COLOR[p.kind] || FALLBACK;
    const side = rgb(hex, 0.88);
    const top = rgb(hex, 1.28);
    const stars = Math.max(0, Math.min(5, p.stars || 1));
    const k = 0.72 + stars * 0.13;                 // 热度尺寸系数
    const D = stars >= 4 ? 2 : stars >= 2 ? 1 : 0; // 精细度

    const fp = findNearest(px, pz, 0.2);
    count++;

    if (fp) {
      /* ---- 真实 OSM footprint: 挤出成体, 略微放大以包住原体块 ---- */
      real++;
      const nv = fp.p.length / 2;
      const ox = px - fp.cx, oz = pz - fp.cz;
      const top0 = G;
      const h = Math.max(fp.h * 1.06 + 0.010, MV * 18);
      const top1 = G + h;
      // 侧面
      for (let i = 0; i < nv; i++) {
        const j = (i + 1) % nv;
        const x1 = fp.p[i * 2] + ox, z1 = fp.p[i * 2 + 1] + oz;
        const x2 = fp.p[j * 2] + ox, z2 = fp.p[j * 2 + 1] + oz;
        useColor(B, side);
        quad(B, [x1, top0, z1], [x2, top0, z2], [x2, top1, z2], [x1, top1, z1]);
      }
      // 顶面 (扇形)
      useColor(B, top);
      const base = B.pos.length / 3;
      for (let i = 0; i < nv; i++) {
        push(B, [fp.p[i * 2] + ox, top1, fp.p[i * 2 + 1] + oz], [0, 1, 0], top);
      }
      for (let i = 1; i < nv - 1; i++) B.idx.push(base, base + i, base + i + 1);
      // 顶冠: 让它在城市里"跳"出来
      useColor(B, top);
      prism(B, px, top1, pz, MH * 3.2, MH * 1.1, MV * 16 * k, 6, side, top);
    } else {
      /* ---- 按类型生成真实结构体 ---- */
      const fn = BUILD[p.kind] || BUILD.landmark;
      fn(B, px, pz, k, side, top, D);
    }
  }

  if (!B.pos.length) return { group, mesh: null, count: 0, real: 0 };

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  geo.setIndex(B.idx);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.52, metalness: 0.30,
    emissive: new THREE.Color('#18283c'), emissiveIntensity: 0.55,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'poiShapeMesh';
  mesh.raycast = () => { };          // 不遮挡景点图钉拾取
  group.add(mesh);
  return { group, mesh, count, real };
}
