import * as THREE from 'three';
import { flatToVec3 } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   游轮 / 轮渡 / 邮轮码头
   航线采用黄浦江真实中心线 (OSM waterway), 码头为真实渡口与客运港。

   · 游轮 (100~150 m 级豪华邮轮): 有舷弧的放样船体 (水线下防锈红 / 水线上白)
     + 5 层退台甲板 (层间深色带) + 前倾舰桥 + 涂装烟囱 + 后部雷达桅
     + 栏杆 + 救生艇 + 顶层泳池 + 舷窗 + 航行灯。
   · 渡轮 (30~40 m 级黄浦江渡轮): 平底船体 + 单层客舱 + 驾驶室 + 烟囱 + 栏杆，
     按真实渡口两两配对走"过江摆渡"短航线。
   · 码头设施: 栈桥/引桥 + 候船楼(亭) + 系缆桩 + 栏杆 + 灯塔
     + 龙门吊 + 集装箱堆场, cruise(harbour) 大、ferry 小。

   性能: 74 处码头全部烘焙进 3 个顶点色网格 (结构 / 发光 / 标记圈),
   每艘船合并为 2 个网格 (结构 / 发光), draw call 增量很小。
   ========================================================= */

const WATER_Y = Y.water;
const SHIP_Y = WATER_Y + 0.006;      // 船体吃水线所在高度
const PIER_Y = WATER_Y + 0.005;      // 码头平台面

/* =========================================================
   一、顶点色几何累加器 (写法参照 poi_buildings.js)
   ========================================================= */
function acc() { return { pos: [], nrm: [], col: [], idx: [], cur: [1, 1, 1] }; }

function push(B, p, n, c) {
  B.pos.push(p[0], p[1], p[2]);
  B.nrm.push(n[0], n[1], n[2]);
  B.col.push(c[0], c[1], c[2]);
}

/** 四边形面: a->b->c->d 从外侧看为逆时针 */
function quad(B, a, b, c, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nz /= l; ny /= l; nx /= l;
  const base = B.pos.length / 3;
  const k = 0.76 + 0.24 * Math.min(1, Math.max(0, ny * 0.5 + 0.5));
  const cc = [B.cur[0] * k, B.cur[1] * k, B.cur[2] * k];
  push(B, a, [nx, ny, nz], cc); push(B, b, [nx, ny, nz], cc);
  push(B, c, [nx, ny, nz], cc); push(B, d, [nx, ny, nz], cc);
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function useColor(B, c) { B.cur = c; }

const _c1 = new THREE.Color();
function rgb(hex, m = 1) { _c1.set(hex); return [_c1.r * m, _c1.g * m, _c1.b * m]; }

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();
const _e = new THREE.Euler(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _m3 = new THREE.Matrix3();

/** 把一份 three 内置几何按给定矩阵并入累加器, 顶点色做简易 AO 明暗 */
function addGeo(B, geo, col, mtx) {
  const P = geo.attributes.position, N = geo.attributes.normal, I = geo.index;
  const base = B.pos.length / 3;
  if (mtx) _m3.getNormalMatrix(mtx);
  for (let i = 0; i < P.count; i++) {
    _v.fromBufferAttribute(P, i);
    if (mtx) _v.applyMatrix4(mtx);
    if (N) { _n.fromBufferAttribute(N, i); if (mtx) _n.applyMatrix3(_m3).normalize(); }
    else _n.set(0, 1, 0);
    B.pos.push(_v.x, _v.y, _v.z);
    B.nrm.push(_n.x, _n.y, _n.z);
    const k = 0.78 + 0.22 * Math.min(1, Math.max(0, _n.y * 0.5 + 0.5));
    B.col.push(col[0] * k, col[1] * k, col[2] * k);
  }
  if (I) for (let i = 0; i < I.count; i++) B.idx.push(base + I.getX(i));
  else for (let i = 0; i < P.count; i++) B.idx.push(base + i);
}

/* 单位几何 (复用, 通过缩放摆放) */
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sph: new THREE.SphereGeometry(1, 10, 7),
  cap: new THREE.CapsuleGeometry(1, 2, 3, 8),   // 局部 +Y 为长轴, 总长 4, 半径 1
};
const _cylCache = new Map();
function cylGeo(rT, rB, h, seg) {
  const k = rT + '|' + rB + '|' + h + '|' + seg;
  let g = _cylCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rT, rB, h, seg); _cylCache.set(k, g); }
  return g;
}

/** 通用摆放 (px,py,pz 为几何中心) */
function put(B, geo, col, px, py, pz, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_e);
  _m4.compose(_v.set(px, py, pz), _q, _s.set(sx, sy, sz));
  addGeo(B, geo, col, _m4);
}
/** 长方体: (cx, cy, cz) 为底面中心 */
function boxAt(B, col, cx, cy, cz, w, h, d, ry) {
  put(B, UNIT.box, col, cx, cy + h / 2, cz, 0, ry || 0, 0, w, h, d);
}
/** 圆柱 / 圆台 / 圆锥: cy 为底面 */
function cylAt(B, col, cx, cy, cz, rT, rB, h, seg, ry) {
  put(B, cylGeo(rT, rB, h, seg || 10), col, cx, cy + h / 2, cz, 0, ry || 0, 0, 1, 1, 1);
}
/** 球 (可三轴缩放成椭球) */
function ballAt(B, col, cx, cy, cz, r, sx, sy, sz) {
  put(B, UNIT.sph, col, cx, cy, cz, 0, 0, 0, r * (sx || 1), r * (sy || 1), r * (sz || 1));
}
/** 胶囊 (救生艇): 长轴沿 X, 长 len, 截面半径 rad */
function capAt(B, col, cx, cy, cz, len, rad, flat) {
  put(B, UNIT.cap, col, cx, cy, cz, 0, 0, -Math.PI / 2, rad * (flat || 0.78), len / 4, rad);
}
/** 平板圆环 (码头标记圈) */
function disc(B, cx, cy, cz, r0, r1, seg, col) {
  useColor(B, col);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (r, a) => [cx + r * Math.cos(a), cy, cz + r * Math.sin(a)];
    quad(B, p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0));
  }
}

/**
 * 楔形箱体: +X 面自下而上向后倾 (舰桥 / 驾驶室的前倾窗面)
 * (x0..x1, y0..y1, z0..z1) 为包围盒, inset 为前缘顶部内收量
 */
function slopedBox(B, col, x0, x1, y0, y1, z0, z1, inset) {
  useColor(B, col);
  const fx = x1 - inset;
  quad(B, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);          // 底
  quad(B, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);          // 尾
  quad(B, [x0, y0, z1], [x1, y0, z1], [fx, y1, z1], [x0, y1, z1]);          // +z 侧
  quad(B, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [fx, y1, z0]);          // -z 侧
  quad(B, [x1, y0, z1], [x1, y0, z0], [fx, y1, z0], [fx, y1, z1]);          // 前倾面
  quad(B, [x0, y1, z1], [fx, y1, z1], [fx, y1, z0], [x0, y1, z0]);          // 顶
}

/** 贴在前倾面上的玻璃 (沿面法向外移 eps, 避免 z-fighting) */
function slopedGlass(G, col, x0, x1, y0, y1, z0, z1, inset, eps) {
  const h = y1 - y0;
  const gy0 = y0 + h * 0.18, gy1 = y1 - h * 0.10;
  const gx0 = x1 - inset * (gy0 - y0) / h;
  const gx1 = x1 - inset * (gy1 - y0) / h;
  const dz = z1 - z0;
  const gz0 = z0 + dz * 0.09, gz1 = z1 - dz * 0.09;
  const nl = Math.hypot(h, inset) || 1;
  const ox = eps * h / nl, oy = eps * inset / nl;
  useColor(G, col);
  quad(G,
    [gx0 + ox, gy0 + oy, gz1], [gx0 + ox, gy0 + oy, gz0],
    [gx1 + ox, gy1 + oy, gz0], [gx1 + ox, gy1 + oy, gz1]);
}

/** 把子累加器绕 Y 旋转 ang 并平移后并入主累加器 (局部 +X 指向 (cos,-sin)) */
function emit(A, B, ang, tx, ty, tz) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const base = A.pos.length / 3;
  for (let i = 0; i < B.pos.length; i += 3) {
    const x = B.pos[i], y = B.pos[i + 1], z = B.pos[i + 2];
    A.pos.push(tx + x * c + z * s, ty + y, tz - x * s + z * c);
    const nx = B.nrm[i], ny = B.nrm[i + 1], nz = B.nrm[i + 2];
    A.nrm.push(nx * c + nz * s, ny, -nx * s + nz * c);
  }
  for (let i = 0; i < B.col.length; i++) A.col.push(B.col[i]);
  for (let i = 0; i < B.idx.length; i++) A.idx.push(base + B.idx[i]);
}

function finish(B) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  g.setIndex(B.idx);
  g.computeBoundingSphere();
  return g;
}

/** 确定性伪随机 [0,1) */
function hash(a, b) { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }

/* =========================================================
   二、船体
   ========================================================= */

/* 站位表: [纵向 u(-0.5 尾 -> +0.5 首), 半宽系数, 吃水系数, 舷高系数(含舷弧)] */
const CRUISE_ST = [
  [-0.500, 0.78, 0.55, 1.30], [-0.470, 0.90, 0.80, 1.14], [-0.400, 0.97, 0.93, 1.04],
  [-0.250, 1.00, 1.00, 0.99], [-0.050, 1.00, 1.00, 0.96], [0.120, 0.99, 0.99, 0.98],
  [0.250, 0.94, 0.92, 1.04], [0.345, 0.82, 0.80, 1.14], [0.420, 0.60, 0.58, 1.30],
  [0.470, 0.33, 0.34, 1.52], [0.500, 0.06, 0.10, 1.72],
];
const FERRY_ST = [
  [-0.500, 0.84, 0.72, 1.06], [-0.440, 0.95, 0.90, 1.00], [-0.280, 1.00, 1.00, 0.97],
  [0.000, 1.00, 1.00, 0.96], [0.180, 0.99, 0.99, 0.97], [0.320, 0.92, 0.90, 1.02],
  [0.420, 0.70, 0.66, 1.12], [0.480, 0.36, 0.34, 1.26], [0.500, 0.10, 0.12, 1.36],
];

/** 船体放样: 削斜船首 + 略方船尾 + 舷弧, 水线上下分色 */
function loftHull(B, st, L, HB, DRAFT, FREE, cTop, cBot, cDeck) {
  const P = st.map(s => ({ x: s[0] * L, hb: s[1] * HB, yb: -s[2] * DRAFT, yd: s[3] * FREE }));
  for (let i = 0; i < P.length - 1; i++) {
    for (const sz of [1, -1]) {
      const a = P[sz > 0 ? i : i + 1], b = P[sz > 0 ? i + 1 : i];
      const top = s => [s.x, s.yd, sz * s.hb];
      const wl = s => [s.x, 0, sz * s.hb];
      const bl = s => [s.x, s.yb + (s.yd - s.yb) * 0.22, sz * s.hb * 0.80];
      const ke = s => [s.x, s.yb, 0];
      useColor(B, cTop); quad(B, wl(a), wl(b), top(b), top(a));   // 水线以上
      useColor(B, cBot); quad(B, bl(a), bl(b), wl(b), wl(a));     // 水线以下 (防锈红)
      quad(B, ke(a), ke(b), bl(b), bl(a));                        // 舭部 -> 龙骨
    }
    const a = P[i], b = P[i + 1];
    useColor(B, cDeck);
    quad(B, [a.x, a.yd, a.hb], [b.x, b.yd, b.hb], [b.x, b.yd, -b.hb], [a.x, a.yd, -a.hb]);
  }
}

/** 船体侧面涂装条 */
function hullStripe(B, st, L, HB, y0, y1, col, eps) {
  useColor(B, col);
  const P = st.map(s => [s[0] * L, s[1] * HB + eps]);
  for (let i = 0; i < P.length - 1; i++) {
    for (const sz of [1, -1]) {
      const a = P[sz > 0 ? i : i + 1], b = P[sz > 0 ? i + 1 : i];
      quad(B, [a[0], y0, sz * a[1]], [b[0], y0, sz * b[1]], [b[0], y1, sz * b[1]], [a[0], y1, sz * a[1]]);
    }
  }
}

/** 侧舷一排窗 (发光面, sz = +1/-1 表示朝哪一侧) */
function windowRow(B, sz, x0, x1, y, z, n, w, h, col) {
  useColor(B, col);
  for (let i = 0; i < n; i++) {
    const cx = x0 + (x1 - x0) * ((i + 0.5) / n);
    const a = [cx - w / 2, y - h / 2, z], b = [cx + w / 2, y - h / 2, z];
    const c = [cx + w / 2, y + h / 2, z], d = [cx - w / 2, y + h / 2, z];
    if (sz > 0) quad(B, a, b, c, d); else quad(B, b, a, d, c);
  }
}

/* ---------------- 豪华游轮 ---------------- */
/**
 * @param L 船长 (场景单位)
 * @returns {S 结构累加器, G 发光累加器}
 */
function buildCruiseShip(L, hullWhite, superWhite, accent) {
  const S = acc(), G = acc();
  const HB = L * 0.0875;          // 半宽 (~L/11.4)
  const DRAFT = L * 0.050;
  const FREE = L * 0.090;

  const white = rgb(hullWhite, 1.0);
  const upper = rgb(superWhite, 1.0);
  const red = rgb('#8b2f2f', 1.0);        // 水线下防锈红
  const dark = rgb('#232a33', 1.0);
  const band = rgb('#2b3340', 1.0);       // 甲板层间深色带 / 舷墙
  const teak = rgb('#c8a26a', 1.0);       // 露天甲板木铺装
  const livery = rgb(accent, 1.0);
  const water = rgb('#5ad2ff', 1.0);      // 泳池
  const boatC = rgb('#f0892f', 1.0);      // 救生艇
  const boil = rgb('#ffe9a8', 1.0);       // 窗光

  /* --- 船体 --- */
  loftHull(S, CRUISE_ST, L, HB, DRAFT, FREE, white, red, teak);
  hullStripe(S, CRUISE_ST, L, HB, L * 0.010, L * 0.018, rgb('#27466b', 1.0), L * 0.002);
  hullStripe(S, CRUISE_ST, L, HB, L * 0.021, L * 0.024, livery, L * 0.002);

  /* --- 5 层退台甲板 --- */
  const DECKS = [
    [-0.44, 0.40, 0.92, 0.028], [-0.41, 0.34, 0.86, 0.026], [-0.37, 0.27, 0.79, 0.025],
    [-0.33, 0.19, 0.70, 0.024], [-0.29, 0.11, 0.60, 0.022],
  ];
  let y = FREE * 0.98;
  const dt = [];
  for (let i = 0; i < DECKS.length; i++) {
    const [x0, x1, w, hh] = DECKS[i];
    const h = L * hh, hw = HB * w, cx = (x0 + x1) * 0.5 * L, len = (x1 - x0) * L;
    boxAt(S, upper, cx, y, 0, len, h, hw * 2);
    boxAt(S, band, cx, y + h, 0, len * 1.005, L * 0.006, hw * 2 * 1.03);   // 层间深色带
    y += h + L * 0.006;
    dt.push({ y, x0, x1, hw });
  }
  const top = dt[dt.length - 1];

  /* --- 舰桥 (前部, 前倾窗) --- */
  const bw = L * 0.15, bd = top.hw * 1.85, bh = L * 0.030, bx = L * 0.19;
  const bz = bd / 2, bins = L * 0.045;
  slopedBox(S, upper, bx - bw / 2, bx + bw / 2, top.y, top.y + bh, -bz, bz, bins);
  slopedGlass(G, boil, bx - bw / 2, bx + bw / 2, top.y, top.y + bh, -bz, bz, bins, L * 0.0016);
  // 驾驶台两侧桥翼
  for (const sz of [1, -1]) {
    boxAt(S, upper, bx - L * 0.03, top.y + bh * 0.30, sz * (bz + L * 0.010), L * 0.055, L * 0.008, L * 0.020);
  }
  // 舰桥顶
  boxAt(S, band, bx - bins / 2, top.y + bh, 0, bw - bins, L * 0.005, bd * 1.04);

  /* --- 中央烟囱 (带公司色涂装条) --- */
  const fx = -L * 0.04, fr = L * 0.030, fy = top.y - L * 0.002;
  cylAt(S, dark, fx, fy, 0, fr * 0.94, fr * 1.04, L * 0.056, 10);
  cylAt(S, livery, fx, fy + L * 0.016, 0, fr * 1.07, fr * 1.07, L * 0.018, 10);
  cylAt(S, dark, fx, fy + L * 0.056, 0, fr * 1.02, fr * 0.96, L * 0.009, 10);
  boxAt(S, band, fx, fy + L * 0.030, 0, fr * 2.3, L * 0.003, fr * 0.3);   // 烟囱侧支索

  /* --- 后部雷达桅 + 前桅 --- */
  const rxm = -L * 0.30;
  cylAt(S, upper, rxm, top.y, 0, L * 0.0032, L * 0.0042, L * 0.090, 6);
  boxAt(S, upper, rxm, top.y + L * 0.058, 0, L * 0.034, L * 0.003, L * 0.003);
  boxAt(S, upper, rxm, top.y + L * 0.078, 0, L * 0.022, L * 0.003, L * 0.003);
  boxAt(S, dark, rxm - L * 0.013, top.y + L * 0.088, 0, L * 0.015, L * 0.010, L * 0.013);
  const fxm = L * 0.31;
  cylAt(S, upper, fxm, FREE * 0.98, 0, L * 0.0028, L * 0.0036, L * 0.070, 6);
  boxAt(S, upper, fxm, FREE * 0.98 + L * 0.050, 0, L * 0.018, L * 0.0025, L * 0.0025);

  /* --- 顶层甲板栏杆 + 立柱 --- */
  const rcx = (top.x0 + top.x1) * 0.5 * L, rlen = (top.x1 - top.x0) * L;
  for (const sz of [1, -1]) {
    boxAt(S, band, rcx, top.y, sz * top.hw, rlen, L * 0.009, L * 0.0012);
    for (let i = 0; i <= 8; i++) {
      boxAt(S, upper, (top.x0 + (top.x1 - top.x0) * (i / 8)) * L, top.y, sz * top.hw, L * 0.0026, L * 0.012, L * 0.0022);
    }
  }

  /* --- 救生艇 (两舷各 3 艘 + 吊架) --- */
  for (const sz of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const lx = (-0.20 + i * 0.14) * L;
      const ly = dt[1].y + L * 0.010;
      const lz = sz * (HB * 0.86 + L * 0.014);
      capAt(S, boatC, lx, ly, lz, L * 0.042, L * 0.009);
      capAt(S, rgb('#f6f2ea', 1.0), lx, ly + L * 0.004, lz, L * 0.040, L * 0.0075);   // 艇篷
      boxAt(S, upper, lx, ly + L * 0.004, sz * (HB * 0.95), L * 0.003, L * 0.016, L * 0.003);  // 吊架
    }
  }

  /* --- 顶层泳池 --- */
  boxAt(S, rgb('#e7edf5', 1.0), -L * 0.06, top.y, 0, L * 0.14, L * 0.003, top.hw * 1.1);
  boxAt(S, water, -L * 0.06, top.y + L * 0.003, 0, L * 0.105, L * 0.0035, top.hw * 0.72);

  /* --- 舷窗 / 舷侧窗 (发光) --- */
  const zHull = HB + L * 0.0022;
  for (const sz of [1, -1]) {
    windowRow(G, sz, -L * 0.30, L * 0.18, FREE * 0.55, sz * zHull, 16, L * 0.009, L * 0.006, boil);
    // 上层建筑各层: 窗带贴在该层侧壁上 (dt[i].y 为第 i+1 层底, dt[i+1].hw 为其半宽)
    windowRow(G, sz, -L * 0.38, L * 0.30, dt[0].y + L * 0.010, sz * (dt[1].hw + L * 0.0016), 15, L * 0.008, L * 0.006, boil);
    windowRow(G, sz, -L * 0.34, L * 0.24, dt[1].y + L * 0.010, sz * (dt[2].hw + L * 0.0016), 13, L * 0.008, L * 0.006, boil);
    windowRow(G, sz, -L * 0.30, L * 0.16, dt[2].y + L * 0.009, sz * (dt[3].hw + L * 0.0016), 11, L * 0.008, L * 0.006, boil);
  }

  /* --- 航行灯 --- */
  ballAt(G, rgb('#fff6d0', 1.0), rxm, top.y + L * 0.098, 0, L * 0.006);          // 桅顶白灯
  ballAt(G, rgb('#ff4d5e', 1.0), fxm, FREE * 0.98 + L * 0.075, 0, L * 0.0055);   // 前桅红灯
  ballAt(G, rgb('#7ef7ff', 1.0), L * 0.505, FREE * 1.30, 0, L * 0.0065);         // 船首白灯
  ballAt(G, rgb('#8effc8', 1.0), -L * 0.505, FREE * 1.24, 0, L * 0.0055);        // 船尾绿灯

  /* --- 船首球鼻艏 + 锚 --- */
  ballAt(S, red, L * 0.510, -DRAFT * 0.5, 0, L * 0.032, 1.35, 0.95, 1);       // 球鼻艏
  boxAt(S, dark, L * 0.470, -L * 0.010, 0, L * 0.012, L * 0.012, L * 0.012);  // 锚链筒
  boxAt(S, rgb('#3a4048', 1.0), L * 0.486, -L * 0.020, 0, L * 0.018, L * 0.022, L * 0.010); // 锚

  /* --- 直升机停机坪 (顶层甲板, 带 H 标识) --- */
  const hp = top.y + L * 0.003;
  disc(S, -L * 0.04, hp, 0, L * 0.020, L * 0.030, 22, rgb('#2b3340', 1.0));    // 停机圆坪
  for (const s of [1, -1]) boxAt(G, rgb('#ffe9a8', 1.0), -L * 0.04, hp + L * 0.001, s * L * 0.013, L * 0.018, L * 0.0016, L * 0.0022); // H 两竖
  boxAt(G, rgb('#ffe9a8', 1.0), -L * 0.04, hp + L * 0.001, 0, L * 0.004, L * 0.0016, L * 0.026); // H 横

  /* --- 雷达桅卫星通信罩 + 细天线 --- */
  ballAt(S, white, rxm, top.y + L * 0.092, 0, L * 0.012, 1, 0.9, 1);          // 雷达罩
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    boxAt(S, dark, rxm + Math.cos(a) * L * 0.010, top.y + L * 0.080, Math.sin(a) * L * 0.010, L * 0.0016, L * 0.030, L * 0.0016);
  }

  /* --- 舯部救生艇 + 顶层甲板更多舷窗 --- */
  for (const sz of [1, -1]) {
    const lx = -L * 0.02, ly = dt[1].y + L * 0.010, lz = sz * (HB * 0.92 + L * 0.012);
    capAt(S, boatC, lx, ly, lz, L * 0.038, L * 0.0085);
  }
  for (const sz of [1, -1]) windowRow(G, sz, -L * 0.26, L * 0.12, dt[3].y + L * 0.008, sz * (dt[3].hw + L * 0.0016), 11, L * 0.007, L * 0.005, boil);

  /* --- 甲板边缘串灯 (夜景装饰) --- */
  for (let i = 0; i < 10; i++) {
    const x = (-0.30 + i * 0.066) * L;
    ballAt(G, rgb('#ffd9a0', 1.0), x, top.y + L * 0.010, top.hw + L * 0.004, L * 0.006);
    ballAt(G, rgb('#7ef7ff', 1.0), x, top.y + L * 0.010, -top.hw - L * 0.004, L * 0.006);
  }

  return { S, G };
}

/* ---------------- 黄浦江渡轮 ---------------- */
function buildFerryShip(L, hullWhite, cabinWhite, accent) {
  const S = acc(), G = acc();
  const HB = L * 0.135;           // 半宽 (~L/3.7, 平底宽体)
  const DRAFT = L * 0.055;
  const FREE = L * 0.085;

  const white = rgb(hullWhite, 1.0);
  const upper = rgb(cabinWhite, 1.0);
  const red = rgb('#7d3a30', 1.0);
  const dark = rgb('#232a33', 1.0);
  const band = rgb('#2b3340', 1.0);
  const deck = rgb('#8d99a8', 1.0);
  const livery = rgb(accent, 1.0);
  const boil = rgb('#ffe9a8', 1.0);

  /* --- 平底船体 --- */
  loftHull(S, FERRY_ST, L, HB, DRAFT, FREE, white, red, deck);
  hullStripe(S, FERRY_ST, L, HB, L * 0.020, L * 0.030, rgb('#27466b', 1.0), L * 0.003);

  /* --- 单层客舱 --- */
  const dy = FREE * 0.96;
  const ch = L * 0.130, chw = HB * 0.78, cx = (-0.36 + 0.22) * 0.5 * L;
  boxAt(S, upper, cx, dy, 0, (0.22 + 0.36) * L, ch, chw * 2);
  boxAt(S, band, cx, dy + ch, 0, (0.58) * L * 1.01, L * 0.010, chw * 2.06);

  /* --- 驾驶室 (前倾窗) --- */
  const wy = dy + ch + L * 0.010;
  const ww = L * 0.15, wd = chw * 1.7, wh = L * 0.075, wx = L * 0.13, wins = L * 0.040;
  slopedBox(S, upper, wx - ww / 2, wx + ww / 2, wy, wy + wh, -wd / 2, wd / 2, wins);
  slopedGlass(G, boil, wx - ww / 2, wx + ww / 2, wy, wy + wh, -wd / 2, wd / 2, wins, L * 0.0022);
  boxAt(S, band, wx - wins / 2, wy + wh, 0, ww - wins, L * 0.008, wd * 1.05);

  /* --- 烟囱 (后部) --- */
  cylAt(S, dark, -L * 0.30, wy + L * 0.010, 0, L * 0.026, L * 0.030, L * 0.105, 8);
  cylAt(S, livery, -L * 0.30, wy + L * 0.038, 0, L * 0.031, L * 0.031, L * 0.030, 8);

  /* --- 桅杆 --- */
  cylAt(S, upper, L * 0.26, wy + L * 0.010, 0, L * 0.005, L * 0.007, L * 0.20, 6);
  boxAt(S, upper, L * 0.26, wy + L * 0.180, 0, L * 0.05, L * 0.004, L * 0.004);

  /* --- 舷墙 / 栏杆 (首尾露天甲板) --- */
  for (const sz of [1, -1]) {
    boxAt(S, band, L * 0.36, dy, sz * HB * 0.86, L * 0.26, L * 0.014, L * 0.0022);
    boxAt(S, band, -L * 0.43, dy, sz * HB * 0.86, L * 0.14, L * 0.014, L * 0.0022);
    for (let i = 0; i <= 4; i++) {
      boxAt(S, upper, (0.24 + i * 0.06) * L, dy, sz * HB * 0.86, L * 0.005, L * 0.018, L * 0.004);
    }
  }

  /* --- 舷窗 (客舱两舷各一排) --- */
  for (const sz of [1, -1]) {
    windowRow(G, sz, -L * 0.32, L * 0.18, dy + ch * 0.62, sz * (chw + L * 0.0025), 8, L * 0.030, L * 0.028, boil);
  }

  /* --- 航行灯 --- */
  ballAt(G, rgb('#fff6d0', 1.0), L * 0.26, wy + L * 0.212, 0, L * 0.012);
  ballAt(G, rgb('#7ef7ff', 1.0), L * 0.50, FREE * 1.15, 0, L * 0.013);
  ballAt(G, rgb('#8effc8', 1.0), -L * 0.50, FREE * 1.12, 0, L * 0.011);

  return { S, G };
}

/** 造一艘船 -> THREE.Group (结构网格 + 发光网格), 保留 userData.len */
function makeShip(kind, L, c1, c2, c3) {
  const g = new THREE.Group();
  const built = kind === 'ferry'
    ? buildFerryShip(L, c1, c2, c3)
    : buildCruiseShip(L, c1, c2, c3);
  const struct = new THREE.Mesh(finish(built.S), MAT_STRUCT);
  struct.name = 'shipBody';
  const glow = new THREE.Mesh(finish(built.G), MAT_GLOW);
  glow.name = 'shipGlow';
  g.add(struct, glow);
  g.userData.len = L;
  return g;
}

/* =========================================================
   三、码头设施 (局部坐标: +X 指向水域, y=0 为平台面)
   ========================================================= */

/* 集装箱涂装 */
const BOX_COLORS = ['#d7443e', '#2f6fb5', '#3f9e5b', '#e08a24', '#8d5bb5'];

/** 客运港 / 邮轮码头: 大候船楼 + 长栈桥 + 灯塔 (+ 1/3 概率的龙门吊与堆场) */
function buildHarbour(B, G, t) {
  const pier = rgb('#8d99a8', 1.0);
  const pave = rgb('#a6b2c0', 1.0);
  const steel = rgb('#6f7d8c', 1.0);
  const wall = rgb('#dfe7f1', 1.0);
  const glass = rgb('#8fd0ff', 1.0);
  const roof = rgb('#3b4756', 1.0);
  const win = rgb('#ffe9a8', 1.0);
  const lamp = rgb('#fff2c0', 1.0);
  const redW = rgb('#c2453f', 1.0);

  const PL = 0.085, PW = 0.020;      // 栈桥长 / 宽

  /* 陆域平台 */
  boxAt(B, pier, -0.020, -0.006, 0, 0.046, 0.006, 0.046);
  boxAt(B, pave, -0.020, -0.0010, 0, 0.046, 0.0010, 0.046);

  /* 栈桥 / 引桥 + 桥墩 + 栏杆 */
  boxAt(B, pier, PL / 2, -0.006, 0, PL, 0.006, PW);
  boxAt(B, pave, PL / 2, -0.0010, 0, PL, 0.0010, PW * 0.96);
  for (let i = 1; i <= 3; i++) cylAt(B, pier, PL * i / 4, -0.020, 0, 0.0024, 0.0030, 0.014, 6);
  for (const sz of [1, -1]) {
    boxAt(B, steel, PL / 2, 0, sz * (PW / 2 - 0.0012), PL * 0.98, 0.0022, 0.0012);
    for (let i = 0; i <= 7; i++) boxAt(B, steel, PL * i / 7, 0, sz * (PW / 2 - 0.0012), 0.0016, 0.0032, 0.0016);
  }

  /* 系缆桩 */
  for (let i = 0; i < 6; i++) {
    const bx = 0.008 + (i % 3) * 0.030, bz = (i < 3 ? 1 : -1) * (PW / 2 - 0.0028);
    cylAt(B, rgb('#2f3742', 1.0), bx, 0, bz, 0.0013, 0.0016, 0.0034, 8);
    ballAt(B, rgb('#3b4552', 1.0), bx, 0.0034, bz, 0.0015, 1, 0.8, 1);
  }

  /* 候船楼 (大) */
  const hx = -0.026, hz = 0.008;
  boxAt(B, wall, hx, 0, hz, 0.026, 0.014, 0.020);
  /* v=47: 屋盖改十六铺式波浪雨棚 —— 5 段交替斜置, 远看是一条起伏的银色波浪 */
  const WV = 5, WS = 0.029 / WV;
  for (let wi = 0; wi < WV; wi++) {
    put(B, UNIT.box, roof,
      hx - 0.0145 + WS * (wi + 0.5), 0.0145 + (wi % 2 ? 0.0008 : 0), hz,
      wi % 2 ? 0.16 : -0.16, 0, 0, WS * 1.12, 0.0032, 0.023);
  }
  boxAt(B, rgb('#9fb0c4', 1.0), hx, 0.0175, hz, 0.024, 0.0016, 0.018);   // 屋顶设备
  // 落地窗带 (面向水域 +x)
  useColor(G, glass);
  quad(G, [hx + 0.0132, 0.002, hz - 0.009], [hx + 0.0132, 0.002, hz + 0.009],
    [hx + 0.0132, 0.011, hz + 0.009], [hx + 0.0132, 0.011, hz - 0.009]);
  useColor(G, win);
  for (let i = 0; i < 5; i++) {
    const z0 = hz - 0.008 + i * 0.0034;
    quad(G, [hx + 0.0134, 0.002, z0], [hx + 0.0134, 0.002, z0 + 0.0022],
      [hx + 0.0134, 0.011, z0 + 0.0022], [hx + 0.0134, 0.011, z0]);
  }

  /* 灯塔 (细长锥柱 + 顶部发光小球) */
  const lx = PL - 0.008, lz = PW / 2 - 0.003;
  cylAt(B, rgb('#e8eef6', 1.0), lx, 0, lz, 0.0018, 0.0028, 0.026, 10);
  cylAt(B, redW, lx, 0.007, lz, 0.0021, 0.0021, 0.005, 10);
  cylAt(B, redW, lx, 0.017, lz, 0.0019, 0.0019, 0.004, 10);
  cylAt(B, rgb('#2a2f38', 1.0), lx, 0.026, lz, 0.0028, 0.0028, 0.0022, 10);
  cylAt(B, rgb('#2a2f38', 1.0), lx, 0.0282, lz, 0.0012, 0.0012, 0.0044, 8);   // 灯室芯柱
  ballAt(G, lamp, lx, 0.0304, lz, 0.0024);                                     // 发光灯 (略大于芯柱)
  cylAt(B, rgb('#2a2f38', 1.0), lx, 0.0326, lz, 0.0006, 0.0028, 0.0028, 8);   // 顶帽

  /* 登船桥 (引桥 -> 水面, 带扶手) */
  const gwX = PL - 0.004, gwZ = PW / 2 - 0.0035;
  for (const sz of [1, -1]) {
    put(B, UNIT.box, steel, gwX + 0.012, -0.010, sz * gwZ, 0, 0, -0.12, 0.032, 0.0016, 0.006);
    boxAt(B, steel, gwX + 0.012, 0.001, sz * (gwZ - 0.0028), 0.032, 0.0024, 0.0010);
    for (let i = 0; i <= 4; i++) boxAt(B, steel, gwX + 0.006 + i * 0.006, -0.001, sz * gwZ, 0.0014, 0.0026, 0.0014);
  }

  /* 防撞轮胎 (护舷) + 系缆柱 */
  for (const sz of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const tx = PL - 0.006 + i * 0.006;
      cylAt(B, rgb('#1c2026', 1.0), tx, -0.006, sz * (PW / 2 - 0.0026), 0.0034, 0.0034, 0.006, 10);
    }
  }

  /* 候船厅前挑檐雨棚 + 立柱 */
  boxAt(B, roof, hx + 0.004, 0.018, hz, 0.020, 0.0016, 0.026);
  for (const sz of [1, -1]) boxAt(B, steel, hx + 0.012, 0.008, hz + sz * 0.012, 0.0016, 0.018, 0.0016);

  /* 站名牌 (发光) */
  useColor(G, rgb('#7ef7ff', 1.0));
  quad(G, [hx + 0.0138, 0.004, hz - 0.008], [hx + 0.0138, 0.004, hz + 0.008],
    [hx + 0.0138, 0.013, hz + 0.008], [hx + 0.0138, 0.013, hz - 0.008]);

  /* 龙门吊 + 集装箱堆场: 约 1/3 的码头 */
  if (Math.abs(t.x * 7.3 + t.z * 3.1) % 3 < 1) {
    const CH = 0.030, CL = 0.030, gx = -0.026;
    for (const sz of [-1, 1]) {
      boxAt(B, steel, gx, 0, sz * CL / 2, 0.0030, CH, 0.0030);
      boxAt(B, steel, gx + 0.026, 0, sz * CL / 2, 0.0030, CH, 0.0030);
      boxAt(B, steel, gx + 0.013, CH * 0.55, sz * CL / 2, 0.030, 0.0020, 0.0018);
    }
    boxAt(B, steel, gx + 0.013, CH, 0, 0.034, 0.0030, CL + 0.002);
    boxAt(B, steel, gx + 0.040, CH - 0.005, 0, 0.048, 0.0026, 0.0026);     // 前伸吊臂
    boxAt(B, steel, gx + 0.058, CH - 0.005, 0, 0.006, 0.0026, 0.0050);     // 小车
    boxAt(B, rgb('#2a2f38', 1.0), gx + 0.058, CH - 0.020, 0, 0.0006, 0.015, 0.0006);
    boxAt(B, rgb('#b8532f', 1.0), gx + 0.058, CH - 0.026, 0, 0.009, 0.006, 0.007);  // 吊具
    // 集装箱堆场
    for (let i = 0; i < 10; i++) {
      const bx = -0.048 + (i % 5) * 0.0108;
      const bz = -0.011 + Math.floor(i / 5) * 0.019;
      const st = 1 + Math.floor(hash(t.x + i * 1.7, t.z + i * 2.3) * 3);
      for (let k = 0; k < st; k++) {
        const col = rgb(BOX_COLORS[Math.floor(hash(t.x + k * 3.1 + i, t.z - i * 1.3) * BOX_COLORS.length)], 1.0);
        boxAt(B, col, bx, k * 0.0039, bz, 0.0098, 0.0037, 0.0076);
      }
    }
  }
}

/** 轮渡渡口: 小候船亭 + 短栈桥 + 系缆桩 */
function buildFerryPier(B, G, t) {
  const pier = rgb('#8d99a8', 1.0);
  const pave = rgb('#a6b2c0', 1.0);
  const steel = rgb('#6f7d8c', 1.0);
  const wall = rgb('#e6ecf4', 1.0);
  const glass = rgb('#8fd0ff', 1.0);
  const roof = rgb('#4a5563', 1.0);
  const win = rgb('#ffe9a8', 1.0);
  const lamp = rgb('#fff2c0', 1.0);

  const PL = 0.050, PW = 0.013;

  /* 后方小平台 + 候船亭 */
  boxAt(B, pier, -0.015, -0.005, 0, 0.026, 0.005, 0.024);
  boxAt(B, pave, -0.015, -0.0009, 0, 0.026, 0.0009, 0.024);
  const sx = -0.021;
  boxAt(B, wall, sx, 0, 0, 0.011, 0.0075, 0.009);
  const a = 0.011 / 2 * 1.42;
  cylAt(B, roof, sx, 0.0075, 0, 0, a * 1.02, 0.0042, 4, Math.PI / 4);   // 四坡顶
  useColor(G, glass);
  quad(G, [sx + 0.0056, 0.0018, -0.0042], [sx + 0.0056, 0.0018, 0.0042],
    [sx + 0.0056, 0.0062, 0.0042], [sx + 0.0056, 0.0062, -0.0042]);
  cylAt(B, rgb('#2f3742', 1.0), sx, 0.0117, 0, 0.0008, 0.0008, 0.0016, 6);
  ballAt(G, lamp, sx, 0.0136, 0, 0.0013);

  /* 栈桥 + 栏杆 */
  boxAt(B, pier, PL / 2, -0.005, 0, PL, 0.005, PW);
  boxAt(B, pave, PL / 2, -0.0009, 0, PL, 0.0009, PW * 0.95);
  for (let i = 1; i <= 2; i++) cylAt(B, pier, PL * i / 3, -0.016, 0, 0.0018, 0.0022, 0.011, 6);
  for (const sz of [1, -1]) {
    boxAt(B, steel, PL / 2, 0, sz * (PW / 2 - 0.0009), PL * 0.97, 0.0018, 0.0010);
    for (let i = 0; i <= 5; i++) boxAt(B, steel, PL * i / 5, 0, sz * (PW / 2 - 0.0009), 0.0013, 0.0026, 0.0013);
  }

  /* 系缆桩 */
  for (const sz of [1, -1]) {
    cylAt(B, rgb('#2f3742', 1.0), PL - 0.006, 0, sz * (PW / 2 - 0.0022), 0.0011, 0.0013, 0.0028, 6);
  }
  /* 防撞轮胎 (护舷) */
  for (const sz of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      const tx = PL - 0.008 + i * 0.008;
      cylAt(B, rgb('#1c2026', 1.0), tx, -0.005, sz * (PW / 2 - 0.0024), 0.0026, 0.0026, 0.005, 9);
    }
  }
  /* 渡口标识灯 */
  cylAt(B, rgb('#2f3742', 1.0), PL - 0.004, 0, PW / 2 - 0.004, 0.0007, 0.0009, 0.0034, 6);
  ballAt(G, rgb('#5ef2a0', 1.0), PL - 0.004, 0.0042, PW / 2 - 0.004, 0.0012);
}

/* =========================================================
   四、材质 (单材质 + vertexColors)
   ========================================================= */
const MAT_STRUCT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.44, metalness: 0.32,
  emissive: new THREE.Color('#16283c'), emissiveIntensity: 0.50,
});
const MAT_TERMINAL = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.72, metalness: 0.12,
  emissive: new THREE.Color('#16283c'), emissiveIntensity: 0.50,
});
const MAT_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const MAT_RING = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.48,
  side: THREE.DoubleSide, depthWrite: false,
});

/* =========================================================
   五、尾迹 / 航道工具
   ========================================================= */
function makeWake(color = '#bfeaff', N = 26) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3);
  const alpha = new Float32Array(N * 2);
  const idx = [];
  for (let i = 0; i < N; i++) {
    alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / N;
    if (i < N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      attribute float aAlpha; varying float vA;
      void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main(){ gl_FragColor = vec4(uColor, vA * 0.42); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/** 把一组点沿切线法向横向偏移, 生成第二条航道 */
function offsetPoints(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return new THREE.Vector3(p.x - tz * d, p.y, p.z + tx * d);
  });
}

/** 求 (x,z) 到江心线的最近点, 得到"朝江方向" */
function waterDir(rpts, x, z) {
  let bd = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < rpts.length; i++) {
    const dx = rpts[i].x - x, dz = rpts[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bx = dx; bz = dz; }
  }
  const d = Math.sqrt(bd);
  if (d < 1e-6) return null;
  return { dx: bx / d, dz: bz / d, dist: d };
}

/* =========================================================
   六、主构建
   ========================================================= */
export function buildCruise(ferryData) {
  const group = new THREE.Group();
  group.name = 'cruise';

  const route = ferryData.cruiseRoute || [];
  const rpts = route.length ? flatToVec3(route, WATER_Y) : [];

  /* ---------------- 码头设施 (74 处 -> 3 个网格) ---------------- */
  const terminalGroup = new THREE.Group();
  terminalGroup.name = 'terminals';
  const TS = acc(), TG = acc(), TR = acc();
  const markers = [];

  const addTerminal = (t, kind, color) => {
    const d = rpts.length ? waterDir(rpts, t.x, t.z) : null;
    // 局部 +X 指向水域; 远离江心线的渡口用确定性伪随机朝向
    const ang = (d && d.dist < 5)
      ? Math.atan2(-d.dz, d.dx)
      : hash(t.x, t.z) * Math.PI * 2;
    const S = acc(), G = acc();
    if (kind === 'cruise') buildHarbour(S, G, t); else buildFerryPier(S, G, t);
    emit(TS, S, ang, t.x, PIER_Y, t.z);
    emit(TG, G, ang, t.x, PIER_Y, t.z);
    disc(TR, t.x, WATER_Y + 0.003, t.z, 0.055, 0.085, 24, rgb(color, 1.0));

    const m = new THREE.Object3D();
    m.position.set(t.x, PIER_Y, t.z);
    m.userData = { type: kind === 'cruise' ? 'cruiseTerminal' : 'ferryTerminal', data: t };
    m.visible = false;                 // 仅供点击拾取, 实体已烘焙进合并网格
    terminalGroup.add(m);
    markers.push(m);
  };

  for (const t of ferryData.cruise || []) addTerminal(t, 'cruise', '#ff8ec7');
  for (const t of ferryData.ferry || []) addTerminal(t, 'ferry', '#5ef2a0');

  /* v=47: 码头名字铭牌 —— 每座码头挂一块刻名的发光板(游轮=粉边/轮渡=绿边) */
  const termLabelGroup = new THREE.Group();
  termLabelGroup.name = 'terminalLabels';
  const termLabel = (t, colorHex) => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    const rr = (x, y, w2, h2, r) => {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w2 - r, y); g.quadraticCurveTo(x + w2, y, x + w2, y + r);
      g.lineTo(x + w2, y + h2 - r); g.quadraticCurveTo(x + w2, y + h2, x + w2 - r, y + h2);
      g.lineTo(x + r, y + h2); g.quadraticCurveTo(x, y + h2, x, y + h2 - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.closePath();
    };
    rr(1, 1, 254, 62, 12);
    g.fillStyle = 'rgba(8,16,28,0.88)'; g.fill();
    g.strokeStyle = colorHex; g.lineWidth = 3; g.stroke();
    g.fillStyle = colorHex; rr(10, 12, 8, 40, 4); g.fill();
    g.fillStyle = '#ffffff';
    g.font = '700 34px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(t.name, 30, 33);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    const k = 0.00036;                     // 256px -> ~92m 宽
    sp.scale.set(256 * k, 64 * k, 1);
    sp.position.set(t.x, WATER_Y + 0.042, t.z);
    sp.renderOrder = 6;
    return sp;
  };
  for (const t of ferryData.cruise || []) termLabelGroup.add(termLabel(t, '#ff8ec7'));
  for (const t of ferryData.ferry || []) termLabelGroup.add(termLabel(t, '#5ef2a0'));
  terminalGroup.add(termLabelGroup);

  const tm = new THREE.Mesh(finish(TS), MAT_TERMINAL); tm.name = 'terminalStruct';
  const tgm = new THREE.Mesh(finish(TG), MAT_GLOW); tgm.name = 'terminalGlow';
  const trm = new THREE.Mesh(finish(TR), MAT_RING); trm.name = 'terminalRings';
  trm.renderOrder = 2;
  terminalGroup.add(tm, tgm, trm);
  group.add(terminalGroup);

  /* ---------------- 黄浦江游轮 ---------------- */
  const ships = [];
  let curveA = null, curveB = null;
  let curveC = null, curveD = null;  // v=31: 苏州河第二航线

  if (route.length >= 8) {
    const all = flatToVec3(route, SHIP_Y);

    /* 取市中心游览航段 |z| <= 6.5 (南浦—杨浦大桥一带) 内最长连续航道 */
    const REACH = 6.5;
    let best = [], cur = [];
    for (const p of all) {
      if (Math.abs(p.z) <= REACH) cur.push(p);
      else { if (cur.length > best.length) best = cur; cur = []; }
    }
    if (cur.length > best.length) best = cur;
    const pts = best.length >= 8 ? best : all;

    const step = Math.max(1, Math.floor(pts.length / 170));
    const sp = pts.filter((_, i) => i % step === 0);
    if (sp.length >= 4 && pts[pts.length - 1]) sp.push(pts[pts.length - 1]);

    curveA = new THREE.CatmullRomCurve3(sp, false, 'catmullrom', 0.35);
    curveB = new THREE.CatmullRomCurve3(offsetPoints(sp, 0.07), false, 'catmullrom', 0.35);

    if (pts !== all) {
      const fg = new THREE.BufferGeometry().setFromPoints(all);
      const fl = new THREE.Line(fg, new THREE.LineBasicMaterial({
        color: new THREE.Color('#4a7fb5'), transparent: true, opacity: 0.13,
      }));
      fl.name = 'riverwayRef';
      group.add(fl);
    }

    // 双航道参考线
    const mkLine = (c, col, op) => {
      const g = new THREE.BufferGeometry().setFromPoints(c.getPoints(400));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: op }));
      group.add(l); return l;
    };
    mkLine(curveA, '#ff9ec7', 0.20);
    mkLine(curveB, '#9ec7ff', 0.14);

    /* v=31: 苏州河航线 (沿苏州河东向西, 独立于 cruiseRoute) */
    const SUZHOU_RIVER_ROUTE = [
      10.5, 3.2,   9.8, 3.0,   9.0, 2.8,   8.2, 2.5,
      7.3, 2.1,    6.4, 1.7,   5.5, 1.3,   4.6, 0.8,
      3.7, 0.4,    2.8, 0.0,   1.9, -0.4,  1.0, -0.8,
      0.2, -1.3,   -0.5, -1.8, -1.2, -2.2, -2.0, -2.6,
      -2.8, -2.9,  -3.6, -3.0,
    ];
    const srAll = flatToVec3(SUZHOU_RIVER_ROUTE, SHIP_Y);
    curveC = new THREE.CatmullRomCurve3(srAll, false, 'catmullrom', 0.35);
    curveD = new THREE.CatmullRomCurve3(offsetPoints(srAll, 0.05), false, 'catmullrom', 0.35);
    mkLine(curveC, '#a3d4ff', 0.16);
    mkLine(curveD, '#ffce8a', 0.12);

    // 7 艘游轮, 双航道对开 (135~155 m 级)
    const PALETTE = [
      ['#f2f6fb', '#e2ecf8', '#ff5d7a'],
      ['#f6f2ea', '#e8e0d0', '#2f6fb5'],
      ['#eaf4ff', '#d6e8fb', '#ffb703'],
      ['#f0f7ea', '#dcecd0', '#3f9e5b'],
      ['#fff6e6', '#f5e6c8', '#d7443e'],
      ['#eef3ff', '#dbe6fb', '#8d5bb5'],
      ['#fff0f4', '#f8dde6', '#e08a24'],
    ];
    const KMH = [15, 18.5, 16, 22, 17, 19, 21];
    for (let i = 0; i < 7; i++) {
      const P = PALETTE[i % PALETTE.length];
      const L = 0.235 + (i % 3) * 0.018;   // 235~271 m
      const ship = makeShip('cruise', L, P[0], P[1], P[2]);
      const wake = makeWake('#bfeaff', 26);
      group.add(ship); group.add(wake);
      ships.push({
        obj: ship, wake, t: i / 7, kmh: KMH[i % KMH.length],
        curve: i % 2 === 0 ? curveA : curveB, dir: (i % 2 === 0) ? 1 : -1,
        km: (i % 2 === 0 ? curveA : curveB).getLength(),
        hist: [], N: 26,
      });
    }

    /* v=31: 苏州河航线再放 4 艘小游船 (双航道对开), 丰富城市水上活动 */
    const KMH_SR = [10, 12, 11, 9];
    for (let i = 0; i < 4; i++) {
      const P = PALETTE[(i + 2) % PALETTE.length];
      const L = 0.060 + (i % 2) * 0.008;  // 60~68m 小游船
      const ship = makeShip('cruise', L, P[0], P[1], P[2]);
      const wake = makeWake('#bfeaff', 12);
      group.add(ship); group.add(wake);
      ships.push({
        obj: ship, wake, t: (i + 1) / 5, kmh: KMH_SR[i % KMH_SR.length],
        curve: i % 2 === 0 ? curveC : curveD, dir: (i % 2 === 0) ? 1 : -1,
        km: (i % 2 === 0 ? curveC : curveD).getLength(),
        hist: [], N: 12,
      });
    }
  }

  /* ---------------- 黄浦江过江渡轮 ----------------
     把江心线附近的渡口按沿江顺序两两配对 (天然就是对岸渡口),
     生成一条略带弧线的过江摆渡航线, 每对 1 艘 30~40 m 级渡轮。 */
  const FERRY_MAX = 12;
  if (rpts.length) {
    const cand = (ferryData.ferry || [])
      .map(t => ({ t, w: waterDir(rpts, t.x, t.z) }))
      .filter(o => o.w && o.w.dist < 0.9)
      .map(o => ({ ...o.t, dx: o.w.dx, dz: o.w.dz, rd: o.w.dist }));
    // 按沿江位置排序: 黄浦江总体南北走向, 以 z 主序 + x 次序即可近似沿江顺序
    cand.sort((a, b) => (a.z - b.z) || (a.x - b.x));

    const used = new Set();
    const legs = [];
    for (let i = 0; i < cand.length && legs.length < FERRY_MAX; i++) {
      if (used.has(i)) continue;
      for (let j = i + 1; j < cand.length; j++) {
        if (used.has(j)) continue;
        const a = cand[i], b = cand[j];
        const dd = Math.hypot(a.x - b.x, a.z - b.z);
        const mid = waterDir(rpts, (a.x + b.x) / 2, (a.z + b.z) / 2);
        if (dd >= 0.20 && dd <= 1.10 && mid && mid.dist < 0.45) {
          used.add(i); used.add(j); legs.push([a, b]); break;
        }
      }
    }

    const legPts = [];
    for (let k = 0; k < legs.length; k++) {
      const [a, b] = legs[k];
      // 端点从渡口向江心推出一段 (落在栈桥头外侧的水面)
      const sa = Math.min(0.052, a.rd * 0.8), sb = Math.min(0.052, b.rd * 0.8);
      const ax = a.x + a.dx * sa, az = a.z + a.dz * sa;
      const bx = b.x + b.dx * sb, bz = b.z + b.dz * sb;
      // 中点沿流向偏移, 让航线略带弧线
      const dirx = bx - ax, dirz = bz - az;
      const ll = Math.hypot(dirx, dirz) || 1;
      const px = -dirz / ll, pz = dirx / ll;
      const bow = (k % 2 === 0 ? 1 : -1) * ll * 0.10;
      const mx = (ax + bx) / 2 + px * bow, mz = (az + bz) / 2 + pz * bow;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ax, SHIP_Y, az),
        new THREE.Vector3(mx, SHIP_Y, mz),
        new THREE.Vector3(bx, SHIP_Y, bz),
      ], false, 'catmullrom', 0.5);

      const P = [
        ['#f4f7fb', '#e4ebf4', '#d7443e'],
        ['#f7f3ea', '#eae1cf', '#2f6fb5'],
        ['#eaf2fb', '#d8e6f6', '#3f9e5b'],
      ][k % 3];
      const L = 0.050 + (k % 3) * 0.005;           // 50~60 m (原 34~40 m 偏小)
      const ship = makeShip('ferry', L, P[0], P[1], P[2]);
      const wake = makeWake('#cfe9ff', 14);
      group.add(ship); group.add(wake);
      ships.push({
        obj: ship, wake, t: (k * 0.37) % 1, kmh: 11 + (k % 4),
        curve, dir: k % 2 === 0 ? 1 : -1,
        km: curve.getLength(), hist: [], N: 14, ferry: true,
      });

      const cp = curve.getPoints(12);
      for (let q = 0; q < cp.length - 1; q++) legPts.push(cp[q], cp[q + 1]);
    }
    if (legPts.length) {
      const lg = new THREE.BufferGeometry().setFromPoints(legPts);
      const ll = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
        color: new THREE.Color('#5ef2a0'), transparent: true, opacity: 0.10,
      }));
      ll.name = 'ferryLegs';
      group.add(ll);
    }
  }

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpBack = new THREE.Vector3();   // v=51: 原来每艘船每帧 new Vector3 x2 + clone, 改模块级复用
  const tmpPerp = new THREE.Vector3();

  const routeKm = curveA ? curveA.getLength() : 0;
  let timeScale = 10;

  return {
    group,
    markers,
    shipCount: ships.length,
    hasRoute: !!curveA,
    routeKm,
    getTimeScale: () => timeScale,
    setTimeScale: (v) => { timeScale = Math.max(1, Math.min(120, v)); },
    legSeconds: () => (routeKm && ships.length)
      ? routeKm / (ships[0].kmh / 3600 * timeScale) : 0,
    update(t, dt) {
      if (!ships.length) return;
      const d = Math.min(0.05, dt || 0.016);
      for (const s of ships) {
        if (!s.km) continue;
        const kmPerSec = s.kmh / 3600 * timeScale;
        s.t += (kmPerSec / s.km) * d * s.dir;
        if (s.t > 1) { s.t = 1 - 1e-4; s.dir = -1; }
        if (s.t < 0) { s.t = 1e-4; s.dir = 1; }

        const u = Math.min(0.9999, Math.max(0.0001, s.t));
        s.curve.getPointAt(u, tmp);
        s.curve.getTangentAt(u, tmp2);
        if (s.dir < 0) tmp2.negate();

        s.obj.position.copy(tmp);
        s.obj.rotation.y = Math.atan2(tmp2.x, tmp2.z) - Math.PI / 2;   // 船首始终朝航向
        s.obj.position.y += (s.ferry ? 0.0012 : 0.0022) * Math.sin(t * 1.6 + s.t * 22);
        s.obj.rotation.z = (s.ferry ? 0.02 : 0.028) * Math.sin(t * 1.25 + s.t * 17);

        const len = s.obj.userData.len;
        /* v=51 性能: 尾迹历史改对象池环形缓冲 —— 原来每帧 unshift(tmp.clone())+pop,
           46 艘船每帧产生上百个 Vector3 垃圾; 语义不变(索引 0=最新点, 不足时重复最旧点) */
        if (!s.pool) {
          s.pool = [];
          for (let i = 0; i < s.N; i++) s.pool.push(new THREE.Vector3());
          s.head = 0; s.filled = 0;
        }
        tmpBack.set(-len * 0.52, 0, 0).applyEuler(s.obj.rotation);
        const slot = s.pool[s.head];
        slot.copy(tmp).add(tmpBack);
        s.head = (s.head + 1) % s.N;
        if (s.filled < s.N) s.filled++;

        const pos = s.wake.geometry.attributes.position;
        tmpPerp.set(0, 0, 1).applyEuler(s.obj.rotation);
        for (let i = 0; i < s.N; i++) {
          const ri = Math.min(i, s.filled - 1);
          const h = s.pool[(s.head - 1 - ri + s.N * 2) % s.N];
          const w = len * 0.16 * (1 + i * 0.09);
          const k = i * 6;
          pos.array[k] = h.x + tmpPerp.x * w;
          pos.array[k + 1] = WATER_Y + 0.003;
          pos.array[k + 2] = h.z + tmpPerp.z * w;
          pos.array[k + 3] = h.x - tmpPerp.x * w;
          pos.array[k + 4] = WATER_Y + 0.003;
          pos.array[k + 5] = h.z - tmpPerp.z * w;
        }
        pos.needsUpdate = true;
      }
    },
  };
}
