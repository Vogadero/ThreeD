import * as THREE from 'three';
import { Y } from './basemap.js?v=32';

/* =========================================================
   地标建筑三维形态库
   ---------------------------------------------------------
   · 全部按公开的建筑实测尺寸(米)程序化生成: 高度 / 层数 / 球体直径 /
     扭转角 / 塔刹层数 / 跨度, 因此轮廓与真实建筑一致而非抽象色块。
   · 坐标一律使用 OSM 的 WGS-84 经纬度 (与卫星底图、建筑体块同一基准),
     不再使用国内地图常见的 GCJ-02 偏移坐标, 否则会整体东移约 400 米。
   · 水平 1 米 = 0.0010 场景单位, 垂直 1 米 = 0.0016 场景单位,
     与 OSM 建筑体块采用完全相同的高度夸张系数, 二者能平滑衔接。
   ========================================================= */

const LON0 = 121.4737, LAT0 = 31.2304;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const M_LAT = 110957;
const proj = (lon, lat) => [(lon - LON0) * M_LON / 1000, -(lat - LAT0) * M_LAT / 1000];

const W = 0.0010;      // 水平: 1 米
const H = 0.0016;      // 垂直: 1 米 (同建筑体块)
const BASE_Y = Y.ground;
const D2R = Math.PI / 180;

/* ---------------- 材质 ---------------- */
const mk = (color, o = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness: o.rough != null ? o.rough : 0.55,
  metalness: o.metal != null ? o.metal : 0.30,
  emissive: new THREE.Color(o.emi || color).multiplyScalar(o.emiK != null ? o.emiK : 0.18),
  emissiveIntensity: o.emiI != null ? o.emiI : 1.0,
  transparent: !!o.opacity, opacity: o.opacity != null ? o.opacity : 1,
  side: o.side || THREE.FrontSide,
});

const M = {
  glass: mk('#8fd0f0', { rough: 0.16, metal: 0.88, emi: '#1d4e6e', emiK: 0.55 }),
  glassW: mk('#cfe6f5', { rough: 0.12, metal: 0.80, emi: '#2a5a78', emiK: 0.5 }),
  glassG: mk('#ddc98c', { rough: 0.20, metal: 0.80, emi: '#4a3a14', emiK: 0.5 }),
  steel: mk('#c3d3e3', { rough: 0.32, metal: 0.82, emi: '#243a4e', emiK: 0.42 }),
  stone: mk('#d6ccb6', { rough: 0.62, metal: 0.12, emi: '#4a4030', emiK: 0.42 }),
  stoneD: mk('#b4a892', { rough: 0.68, metal: 0.10, emi: '#3c352a', emiK: 0.40 }),
  granite: mk('#a9a396', { rough: 0.74, metal: 0.08, emi: '#33302a', emiK: 0.36 }),
  white: mk('#eef2f7', { rough: 0.48, metal: 0.14, emi: '#44546a', emiK: 0.34 }),
  cream: mk('#e6d9bd', { rough: 0.58, metal: 0.12, emi: '#4c4230', emiK: 0.40 }),
  redwall: mk('#a83f2c', { rough: 0.64, metal: 0.10, emi: '#4a1608', emiK: 0.55 }),
  gold: mk('#e2a92c', { rough: 0.34, metal: 0.66, emi: '#6a4a08', emiK: 0.62 }),
  greenRoof: mk('#2f6d54', { rough: 0.44, metal: 0.42, emi: '#0e3527', emiK: 0.55 }),
  grayTile: mk('#5d6a79', { rough: 0.60, metal: 0.24, emi: '#22303c', emiK: 0.44 }),
  darkTile: mk('#3d4854', { rough: 0.62, metal: 0.22, emi: '#161f28', emiK: 0.48 }),
  terra: mk('#b4553a', { rough: 0.62, metal: 0.14, emi: '#4a1c0e', emiK: 0.48 }),
  wood: mk('#7d4f2c', { rough: 0.72, metal: 0.06, emi: '#33190a', emiK: 0.42 }),
  tree: mk('#2e6b41', { rough: 0.86, metal: 0.02, emi: '#123020', emiK: 0.40 }),
  pink: mk('#f6cadd', { rough: 0.46, metal: 0.16, emi: '#6a3a52', emiK: 0.40 }),
  blueRoof: mk('#5b83c6', { rough: 0.38, metal: 0.46, emi: '#1c2f5e', emiK: 0.58 }),
  concrete: mk('#c6c0b2', { rough: 0.78, metal: 0.06, emi: '#3c3830', emiK: 0.36 }),
  dark: mk('#39434f', { rough: 0.66, metal: 0.30, emi: '#151c24', emiK: 0.42 }),
  lamp: new THREE.MeshBasicMaterial({ color: '#fff3cf' }),
  neon: new THREE.MeshBasicMaterial({ color: '#7ef7ff' }),
  water: mk('#2b6f9e', { rough: 0.14, metal: 0.62, emi: '#0d3050', emiK: 0.6 }),
};

/* ---------------- 基本体 (尺寸单位: 米, y 为底面高度) ---------------- */
const PYR4 = new THREE.CylinderGeometry(0, 0.5, 1, 4, 1);
PYR4.rotateY(Math.PI / 4);
const HEMI = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const BALL = new THREE.SphereGeometry(1, 18, 12);

function BOX(mat, x, y, z, w, h, d, rotY = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * W, h * H, d * W), mat);
  m.position.set(x * W, (y + h / 2) * H, z * W);
  m.rotation.y = rotY;
  return m;
}
function CYL(mat, x, y, z, rBot, rTop, h, seg = 16, rotY = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop * W, rBot * W, h * H, seg), mat);
  m.position.set(x * W, (y + h / 2) * H, z * W);
  m.rotation.y = rotY;
  return m;
}
function PYR(mat, x, y, z, w, d, h, rotY = 0) {
  const m = new THREE.Mesh(PYR4, mat);
  m.scale.set(w * W / 0.70711, h * H, d * W / 0.70711);
  m.position.set(x * W, (y + h / 2) * H, z * W);
  m.rotation.y = rotY;
  return m;
}
function CONE(mat, x, y, z, r, h, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0, r * W, h * H, seg), mat);
  m.position.set(x * W, (y + h / 2) * H, z * W);
  return m;
}
function DOME(mat, x, y, z, r, h) {
  const m = new THREE.Mesh(HEMI, mat);
  m.scale.set(r * W, h * H, r * W);
  m.position.set(x * W, y * H, z * W);
  return m;
}
function SPH(mat, x, y, z, r) {
  const m = new THREE.Mesh(BALL, mat);
  m.scale.set(r * W, r * H, r * W);
  m.position.set(x * W, y * H, z * W);
  return m;
}
/** 斜撑: 从 (x1,y1,z1) 连到 (x2,y2,z2), 半径 r (米) */
function STRUT(mat, x1, y1, z1, x2, y2, z2, r) {
  const a = new THREE.Vector3(x1 * W, y1 * H, z1 * W);
  const b = new THREE.Vector3(x2 * W, y2 * H, z2 * W);
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * W, r * W, len, 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
/** 中式屋顶: 四坡顶 + 外挑檐口, 视觉上一眼能认出是中式殿宇 */
function CN_ROOF(g, roofMat, x, y, z, w, d, h, rotY = 0) {
  g.add(BOX(roofMat, x, y, z, w * 1.18, h * 0.14, d * 1.18, rotY));            // 檐口
  g.add(PYR(roofMat, x, y + h * 0.14, z, w, d, h * 0.86, rotY));               // 坡面
  /* v=45 精修: 正脊 + 脊端鸱吻 + 四角翘角 —— 中式屋顶辨识度的三件套。
     沿长轴布脊; 所有偏移随 rotY 旋到世界系(halls/石舫带 8°~18° 朝向)。
     正脊刻意嵌进坡面上部(0.62h~0.78h), 从侧面读出一条屋脊线而不悬空。 */
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const loc = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const ry = y + h * 0.70;
  if (w >= d) {
    const ridge = w * 0.58;
    g.add(BOX(roofMat, x, ry, z, ridge, h * 0.16, d * 0.075, rotY));           // 正脊
    for (const sg of [-1, 1]) {                                                // 鸱吻
      const [ex, ez] = loc(sg * ridge * 0.5, 0);
      g.add(BOX(roofMat, ex, ry + h * 0.09, ez, w * 0.075, h * 0.15, d * 0.11, rotY));
    }
  } else {
    const ridge = d * 0.58;
    g.add(BOX(roofMat, x, ry, z, w * 0.075, h * 0.16, ridge, rotY));           // 正脊
    for (const sg of [-1, 1]) {                                                // 鸱吻
      const [ex, ez] = loc(0, sg * ridge * 0.5);
      g.add(BOX(roofMat, ex, ry + h * 0.09, ez, w * 0.11, h * 0.15, d * 0.075, rotY));
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                        // 四角翘角
    const [cx, cz] = loc(sx * w * 0.55, sz * d * 0.55);
    g.add(BOX(roofMat, cx, y + h * 0.08, cz, w * 0.05, h * 0.20, w * 0.05, rotY));
  }
  g.add(BOX(M.gold, x, y + h * 0.96, z, w * 0.10, h * 0.10, d * 0.10, rotY));  // 宝顶
}

/* =========================================================
   一、陆家嘴超高层
   ========================================================= */

/** 楼层发光环: 在塔身外缘套一圈细发光带, 远看即"层层舷窗" */
function WINRING(mat, x, y, z, r, h, seg = 18) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * W, r * W, h * H, seg), mat);
  m.position.set(x * W, y * H, z * W);
  return m;
}

/** 东方明珠广播电视塔 468m; 下球 Ø68 / 中球 Ø45 / 上球 Ø14 */
function orientalPearl() {
  const g = new THREE.Group();
  // 三根斜撑 (Ø9m, 底部外扩 34m, 汇于 90m 处塔身)
  for (let i = 0; i < 3; i++) {
    const a = i * 120 * D2R + 30 * D2R;
    g.add(STRUT(M.steel, Math.cos(a) * 34, 0, Math.sin(a) * 34, 0, 92, 0, 4.6));
  }
  g.add(CYL(M.steel, 0, 0, 0, 9, 7, 350, 14));            // 主塔身
  g.add(CYL(M.steel, 0, 0, 0, 16, 13, 26, 14));           // 底座
  /* v=39 精修: 按真实尺寸校正三球 —— 下球 直径50m(原代码半径34=68m, 明显偏大),
     标高 68~118m; 上球 直径45m, 标高 250~295m; 顶部太空舱 直径14m, 标高约 350m。 */
  g.add(SPH(mk('#f0648f', { rough: 0.22, metal: 0.6, emi: '#7d1f3c', emiK: 0.7 }), 0, 93, 0, 25));
  g.add(SPH(mk('#ff9ec7', { rough: 0.22, metal: 0.6, emi: '#7d1f3c', emiK: 0.7 }), 0, 272, 0, 22.5));
  g.add(SPH(mk('#ffd166', { rough: 0.22, metal: 0.6, emi: '#6a4a08', emiK: 0.8 }), 0, 350, 0, 7));
  g.add(CYL(M.steel, 0, 350, 0, 3.4, 0.8, 118, 8));       // 天线
  g.add(SPH(M.lamp, 0, 470, 0, 3));
  g.userData.height = 470 * H;
  return g;
}

/** 上海中心大厦 632m; 圆角三角形截面, 自下而上扭转 120° */
function shanghaiTower() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 108, 18, 108));           // 裙楼基座
  g.add(BOX(M.glass, 0, 18, 0, 96, 10, 96));               // 基座玻璃幕
  const segs = 34, HT = 580;
  const winMat = new THREE.MeshBasicMaterial({ color: '#8fd6e8', transparent: true, opacity: 0.42 });
  for (let i = 0; i < segs; i++) {
    const t = i / segs, t2 = (i + 1) / segs;
    const r = 46 * (1 - Math.pow(t, 1.3) * 0.62);
    const rT = 46 * (1 - Math.pow(t2, 1.3) * 0.62);
    const m = CYL(M.glass, 0, HT * t, 0, r, rT, HT / segs * 1.04, 3);
    m.rotation.y = t * 120 * D2R;
    g.add(m);
  }
  // 楼层发光环: 每 ~26m 一道, 让超高层在夜景下"亮"成灯带
  for (let y = 16; y < HT; y += 26) g.add(WINRING(winMat, 0, y, 0, 47.5, 0.7));
  g.add(CYL(M.steel, 0, HT, 0, 16, 3, 52, 3));            // 顶冠
  g.add(SPH(M.lamp, 0, 634, 0, 2.5));
  g.userData.height = 634 * H;
  return g;
}

/** 金茂大厦 421m; 宝塔式 13 段收分, 塔尖 Ø 递减 */
function jinmaoTower() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 88, 14, 88));            // 裙楼基座
  const segs = 13, HT = 370;
  const winMat = new THREE.MeshBasicMaterial({ color: '#d8b25a', transparent: true, opacity: 0.40 });
  for (let i = 0; i < segs; i++) {
    const t = i / segs, t2 = (i + 1) / segs;
    const k = Math.pow(1 - t, 0.55), k2 = Math.pow(1 - t2, 0.55);
    const r = 20 + 22 * k, rT = 20 + 22 * k2;
    g.add(CYL(M.glassG, 0, HT * t, 0, r, rT, HT / segs * 1.05, 8));
    if (i % 2 === 1) g.add(CYL(M.steel, 0, HT * t2 - 1.5, 0, 21 + 22 * k2, 21 + 22 * k2, 3, 8));
    // 每层一道金色窗带, 呼应金茂的密檐收分
    g.add(WINRING(winMat, 0, HT * (i + 0.5) / segs, 0, r + 1, 1.1, 8));
  }
  g.add(CYL(M.glassG, 0, HT, 0, 19, 8, 34, 8));
  g.add(CYL(M.steel, 0, HT + 34, 0, 4, 0.5, 18, 8));
  g.userData.height = 424 * H;
  return g;
}

/** 上海环球金融中心 492m; 方形收分体 + 顶部倒梯形"开瓶器"洞口 */
function swfcTower() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 120, 16, 120, Math.PI / 4));   // 裙楼基座
  const HT = 492, w0 = 58;
  const winMat = new THREE.MeshBasicMaterial({ color: '#8fd0e8', transparent: true, opacity: 0.38 });
  const body = CYL(M.glass, 0, 0, 0, w0, w0 * 0.60, HT * 0.78, 4, Math.PI / 4);
  g.add(body);
  g.add(CYL(M.glass, 0, HT * 0.78, 0, w0 * 0.60, w0 * 0.30, HT * 0.22, 4, Math.PI / 4));
  // 方形塔身的横向窗带
  for (let y = 20; y < HT * 0.78; y += 20) g.add(BOX(winMat, 0, y, 0, w0 * 1.04, 1.0, w0 * 1.04, Math.PI / 4));
  // 洞口横梁 + 顶部风阻尼层
  g.add(BOX(M.steel, 0, HT * 0.90, 0, w0 * 0.92, 7, 12));
  g.add(BOX(M.steel, 0, HT - 6, 0, w0 * 0.50, 6, 9));
  g.add(SPH(M.neon, 0, HT + 2, 0, 2.2));
  g.userData.height = (HT + 4) * H;
  return g;
}

/** 上海国际会议中心: 主楼 + 两颗直径 50m 的球体 (地球模型) */
function convCenter() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 130, 44, 58, -8 * D2R));
  g.add(BOX(M.glassW, 0, 44, 0, 96, 14, 44, -8 * D2R));
  g.add(SPH(mk('#4f8fd0', { rough: 0.2, metal: 0.7, emi: '#123a6a', emiK: 0.7 }), -40, 74, 0, 25));
  g.add(SPH(mk('#4f8fd0', { rough: 0.2, metal: 0.7, emi: '#123a6a', emiK: 0.7 }), 40, 74, 0, 25));
  g.userData.height = 100 * H;
  return g;
}

/* =========================================================
   二、外滩万国建筑博览群
   ========================================================= */

/** 江海关大楼: 8 层主体 + 79m 钟塔 + 四面大钟 */
function customsHouse() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 62, 32, 38));
  g.add(BOX(M.stoneD, 0, 32, 0, 58, 4, 34));
  // 门廊柱列
  for (let i = -2; i <= 2; i++) g.add(CYL(M.stone, i * 8, 0, 20, 1.9, 1.9, 22, 10));
  g.add(BOX(M.stoneD, 0, 22, 20, 44, 3.4, 4));
  // 钟塔
  g.add(BOX(M.stone, 0, 36, -3, 18, 26, 18));
  g.add(BOX(M.stoneD, 0, 62, -3, 20, 3, 20));
  /* v=40 精修: 四面大钟补上时针/分针与中心轴 —— 大钟是海关大楼最醒目的标志,
     原来只有一个空白圆盘, 远景看不出是钟。指针作为 face 的子物体, 自动跟随
     lookAt 的朝向分别贴在四个立面上。 */
  const clockHandMat = mk('#20262f', { rough: 0.55, metal: 0.35 });
  for (const [dx, dz] of [[0, 9.6], [0, -9.6], [9.6, 0], [-9.6, 0]]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(5.4 * W, 20), M.cream);
    face.position.set(dx * W, 52 * H, (dz - 3) * W);
    face.lookAt(dx * 3 * W, 52 * H, (dz * 3 - 3) * W);
    g.add(face);
    for (const [ang, len, wd] of [[-58, 2.8, 0.62], [104, 4.3, 0.42]]) {
      const a = ang * D2R;
      const hand = new THREE.Mesh(new THREE.PlaneGeometry(len * W, wd * W), clockHandMat);
      hand.position.set(Math.cos(a) * len * 0.5 * W, Math.sin(a) * len * 0.5 * W, 0.05 * W);
      hand.rotation.z = a;
      face.add(hand);
    }
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.55 * W, 12), clockHandMat);
    hub.position.z = 0.06 * W;
    face.add(hub);
  }
  g.add(BOX(M.stone, 0, 65, -3, 13, 8, 13));
  g.add(PYR(M.greenRoof, 0, 73, -3, 15, 15, 12));
  g.add(CYL(M.gold, 0, 85, -3, 0.8, 0.3, 8, 6));
  g.userData.height = 94 * H;
  return g;
}

/** 前汇丰银行大楼 (今浦发银行): 6 层希腊式主体 + 穹顶 */
function hsbcDome() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 74, 28, 46));
  g.add(BOX(M.stoneD, 0, 28, 0, 70, 3.4, 42));
  g.add(BOX(M.stone, 0, 31.4, 0, 40, 8, 30));
  for (let i = -3; i <= 3; i++) g.add(CYL(M.cream, i * 6, 0, 24, 2.2, 2.2, 24, 12));
  g.add(BOX(M.stoneD, 0, 24, 24, 44, 4, 5));
  g.add(PYR(M.stoneD, 0, 28, 24, 44, 5, 5));
  g.add(CYL(M.stone, 0, 39.4, 0, 15, 14, 6, 16));
  g.add(DOME(M.greenRoof, 0, 45.4, 0, 14, 16));
  g.add(CYL(M.gold, 0, 61, 0, 1, 0.3, 6, 6));
  g.userData.height = 68 * H;
  return g;
}

/** 和平饭店北楼 (原沙逊大厦) 77m: 花岗岩塔身 + 19m 墨绿金字塔顶 */
function peaceHotel() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 46, 24, 34, -8 * D2R));
  g.add(BOX(M.granite, 2, 24, 0, 34, 30, 28, -8 * D2R));
  g.add(BOX(M.granite, 2, 54, 0, 26, 12, 22, -8 * D2R));
  g.add(PYR(M.greenRoof, 2, 66, 0, 24, 20, 19, -8 * D2R));
  g.add(CYL(M.gold, 2, 85, 0, 0.7, 0.25, 7, 6));
  g.userData.height = 93 * H;
  return g;
}

/** 外白渡桥: 两跨钢桁架, 全长 106m */
function trussBridge() {
  const g = new THREE.Group();
  const L = 106, Bw = 18, Th = 9;
  g.add(BOX(M.dark, 0, 4, 0, L, 1.6, Bw, 12 * D2R));   // 桥面
  for (const side of [1, -1]) {
    const off = side * Bw * 0.46;
    // 上下弦
    g.add(BOX(M.steel, 0, 5.6, off, L, 1.1, 1.4, 12 * D2R));
    g.add(BOX(M.steel, 0, 5.6 + Th, off, L * 0.98, 1.1, 1.4, 12 * D2R));
    // 斜腹杆
    for (let i = 0; i < 12; i++) {
      const x1 = -L / 2 + i * (L / 12), x2 = x1 + L / 12;
      const c = Math.cos(12 * D2R), s = Math.sin(12 * D2R);
      const p1 = [x1 * c, off - x1 * s], p2 = [x2 * c, off - x2 * s];
      g.add(STRUT(M.steel, p1[0], 6, p1[1], p2[0], 6 + Th, p2[1], 0.55));
      g.add(STRUT(M.steel, p1[0], 6, p1[1], p1[0], 6 + Th, p1[1], 0.55));
    }
  }
  // 桥墩
  for (const dx of [-L * 0.26, L * 0.26]) g.add(BOX(M.granite, dx, -6, 0, 6, 12, Bw + 4, 12 * D2R));
  g.userData.height = 18 * H;
  return g;
}

/** 浦东美术馆: 清水混凝土方体 + 临江"水镜厅"玻璃盒 */
function artMuseumBox() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 96, 34, 56, -8 * D2R));
  g.add(BOX(M.white, 0, 34, 0, 70, 8, 42, -8 * D2R));
  g.add(BOX(M.glassW, -20, 0, 32, 32, 30, 14, -8 * D2R));   // 水镜厅
  g.add(BOX(M.concrete, 34, 0, 0, 16, 46, 30, -8 * D2R));   // 竖向体量
  g.userData.height = 46 * H;
  return g;
}

/** 城市步行街: 南京东路一类商业步行街 —— 长条路面 + 半透玻璃顶棚 + 两侧骑楼 */
function pedestrianStreet(opt = {}) {
  const L = opt.L || 320;     // 街长 (米)
  const Wd = opt.W || 46;     // 街宽 (米)
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, Wd, 1.2, L, 0));               // 路面
  for (const s of [-1, 1]) {                                    // 两侧骑楼 (低层商业)
    g.add(BOX(M.cream, s * (Wd / 2 + 8), 0, 0, 14, 22, L, 0));
    g.add(BOX(M.stoneD, s * (Wd / 2 + 8), 22, 0, 14, 4, L, 0));
  }
  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#cfe6f5', roughness: 0.2, metalness: 0.5,
    emissive: new THREE.Color('#2a5a78').multiplyScalar(0.4),
    transparent: true, opacity: 0.45, side: THREE.DoubleSide,
  });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(Wd * W, 3 * H, L * W), canopyMat);
  canopy.position.set(0, 27 * H, 0);
  g.add(canopy);
  for (let i = -2; i <= 2; i++) {                              // 顶棚支柱
    g.add(CYL(M.steel, -Wd / 2 + 4, 0, i * (L / 5), 1, 1, 27, 8));
    g.add(CYL(M.steel, Wd / 2 - 4, 0, i * (L / 5), 1, 1, 27, 8));
  }
  g.userData.height = 30 * H;
  return g;
}

/** 人民英雄纪念塔: 三柱擎天 60m */
function obelisk() {
  const g = new THREE.Group();
  g.add(CYL(M.granite, 0, 0, 0, 18, 16, 6, 20));
  for (let i = 0; i < 3; i++) {
    const a = i * 120 * D2R;
    const m = BOX(M.white, Math.cos(a) * 5, 6, Math.sin(a) * 5, 5, 54, 9, -a);
    m.rotation.z = Math.cos(a) * 0.05;
    g.add(m);
  }
  g.userData.height = 62 * H;
  return g;
}

/** 上海邮政博物馆: 巴洛克钟塔 + 转角穹亭 */
function postOffice() {
  const g = new THREE.Group();
  g.add(BOX(M.cream, 0, 0, 0, 76, 26, 50, 20 * D2R));
  g.add(BOX(M.stoneD, 0, 26, 0, 72, 3, 46, 20 * D2R));
  for (let i = -3; i <= 3; i++) g.add(CYL(M.cream, i * 7, 6, 22, 1.8, 1.8, 20, 10));
  g.add(BOX(M.cream, -24, 29, -14, 16, 18, 16, 20 * D2R));
  g.add(CYL(M.cream, -24, 47, -14, 8, 7, 8, 14));
  g.add(DOME(M.greenRoof, -24, 55, -14, 7.5, 10));
  g.add(CYL(M.gold, -24, 65, -14, 0.8, 0.25, 8, 6));
  g.userData.height = 74 * H;
  return g;
}

/* =========================================================
   三、老城厢 / 寺庙园林
   ========================================================= */

/** 中式殿宇: 台基 + 红墙 + 重檐屋顶, roof 可选金瓦或灰瓦 */
function templeHall(opt = {}) {
  const w = opt.w || 34, d = opt.d || 22;
  const roof = opt.gold ? M.gold : M.grayTile;
  const wall = opt.gray ? M.stoneD : M.redwall;
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, w * 1.25, 3, d * 1.3));
  g.add(BOX(wall, 0, 3, 0, w, 11, d));
  for (const dx of [-w * 0.42, -w * 0.14, w * 0.14, w * 0.42])
    g.add(CYL(M.terra, dx, 3, d * 0.52, 0.9, 0.9, 11, 8));
  CN_ROOF(g, roof, 0, 14, 0, w * 1.05, d * 1.15, 9);        // 下檐
  g.add(BOX(wall, 0, 22, 0, w * 0.66, 5, d * 0.66));
  CN_ROOF(g, roof, 0, 27, 0, w * 0.78, d * 0.86, 11);       // 上檐
  if (opt.wing) {
    for (const s of [-1, 1]) {
      g.add(BOX(wall, s * (w * 0.86), 2, -d * 0.1, w * 0.34, 8, d * 0.6));
      CN_ROOF(g, roof, s * (w * 0.86), 10, -d * 0.1, w * 0.42, d * 0.7, 6);
    }
  }
  g.userData.height = 40 * H;
  return g;
}

/** 楼阁: 三层重檐小楼 (沉香阁一类) */
function pavilionTower(opt = {}) {
  const g = new THREE.Group();
  const w = opt.w || 18;
  g.add(BOX(M.granite, 0, 0, 0, w * 1.3, 2.5, w * 1.1));
  let y = 2.5;
  for (let i = 0; i < 3; i++) {
    const s = 1 - i * 0.17;
    g.add(BOX(M.redwall, 0, y, 0, w * s, 7, w * 0.86 * s));
    CN_ROOF(g, M.grayTile, 0, y + 7, 0, w * 1.12 * s, w * 0.98 * s, 5);
    y += 12;
  }
  g.userData.height = (y + 3) * H;
  return g;
}

/** 豫园: 多重亭榭 + 假山 + 水面, 江南园林格局 */
function chineseGarden() {
  const g = new THREE.Group();
  // 水面
  const pond = new THREE.Mesh(new THREE.CircleGeometry(44 * W, 26), M.water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(6 * W, 0.6 * H, 8 * W);
  pond.scale.set(1, 1.5, 1);
  g.add(pond);
  // 三处厅堂
  const halls = [[-44, -26, 30, 18, 0], [30, -34, 24, 16, 18 * D2R], [-30, 34, 22, 14, -12 * D2R]];
  for (const [x, z, w, d, r] of halls) {
    g.add(BOX(M.cream, x, 0, z, w, 9, d, r));
    CN_ROOF(g, M.grayTile, x, 9, z, w * 1.16, d * 1.2, 7, r);
  }
  // 湖心亭 (六角攒尖)
  g.add(CYL(M.wood, 22, 0, 22, 9, 9, 7, 6));
  g.add(CYL(M.grayTile, 22, 7, 22, 12, 11, 1.6, 6));
  g.add(CONE(M.grayTile, 22, 8.6, 22, 11, 9, 6));
  g.add(CYL(M.gold, 22, 17.6, 22, 0.7, 0.2, 3, 6));
  // 九曲桥
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    g.add(BOX(M.granite, -14 + t * 34, 1.2, 26 - Math.sin(t * 6.3) * 8, 7, 1.2, 3.4, (i % 2 ? 0.5 : -0.5)));
  }
  // 假山与古树
  for (const [x, z, r, h] of [[-8, -8, 9, 13], [-16, -2, 6, 9], [40, 10, 7, 10]])
    g.add(CONE(M.granite, x, 0, z, r, h, 7));
  for (const [x, z] of [[-50, 10], [46, -16], [10, -40], [-24, -40], [52, 26]]) {
    g.add(CYL(M.wood, x, 0, z, 1.2, 1, 6, 6));
    g.add(SPH(M.tree, x, 11, z, 6.5));
  }
  g.userData.height = 24 * H;
  return g;
}

/** 楼阁式塔: 龙华塔七级八面 40.4m / 双塔等 */
function pagoda(tiers = 7, total = 40, rBase = 7) {
  const g = new THREE.Group();
  g.add(CYL(M.granite, 0, 0, 0, rBase * 1.7, rBase * 1.6, 2.4, 8));
  let y = 2.4;
  const hT = (total - 6) / tiers;
  for (let i = 0; i < tiers; i++) {
    const k = 1 - i / (tiers + 1.6);
    g.add(CYL(M.redwall, 0, y, 0, rBase * k, rBase * k * 0.94, hT * 0.72, 8));
    g.add(CYL(M.grayTile, 0, y + hT * 0.72, 0, rBase * k * 1.42, rBase * k * 1.08, hT * 0.28, 8));
    y += hT;
  }
  g.add(CONE(M.grayTile, 0, y, 0, rBase * 0.42, 3.4, 8));
  g.add(CYL(M.gold, 0, y + 3.4, 0, 0.55, 0.18, 5.6, 6));   // 塔刹
  g.userData.height = (y + 10) * H;
  return g;
}

/* =========================================================
   四、人民广场 / 市中心
   ========================================================= */

/** 上海博物馆: 方基圆顶"鼎"形, 顶部两侧拱形出挑 */
function shanghaiMuseum() {
  const g = new THREE.Group();
  g.add(BOX(M.stoneD, 0, 0, 0, 76, 6, 76));
  g.add(BOX(M.cream, 0, 6, 0, 66, 20, 66));
  g.add(CYL(M.stone, 0, 26, 0, 26, 25, 8, 28));
  g.add(DOME(M.stone, 0, 34, 0, 25, 12));
  // 双耳
  for (const s of [-1, 1]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(11 * W, 2.2 * W, 8, 18, Math.PI), M.stone);
    arc.position.set(s * 25 * W, 36 * H, 0);
    arc.rotation.set(0, Math.PI / 2, s > 0 ? 0 : Math.PI);
    g.add(arc);
  }
  g.userData.height = 48 * H;
  return g;
}

/** 上海大剧院: 玻璃体 + 白色倒弧形挑檐屋盖 */
function grandTheatre() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 84, 8, 74));
  g.add(BOX(M.glassW, 0, 8, 0, 70, 32, 62));
  for (let i = -3; i <= 3; i++) g.add(CYL(M.white, i * 11, 8, 32, 1.6, 1.6, 34, 10));
  // 倒弧屋盖: 两条上翘的弧梁 + 平顶板
  g.add(BOX(M.white, 0, 40, 0, 92, 3.4, 80));
  for (const s of [-1, 1]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(46 * W, 2.6 * W, 7, 22, Math.PI * 0.42), M.white);
    arc.position.set(0, 40 * H, s * 40 * W);
    arc.rotation.set(-Math.PI / 2, 0, Math.PI * 0.29);
    arc.scale.set(1, 1, 5.6);
    g.add(arc);
  }
  g.add(BOX(M.white, 0, 43.4, -34, 92, 12, 10));
  g.add(BOX(M.white, 0, 43.4, 34, 92, 12, 10));
  g.userData.height = 58 * H;
  return g;
}

/** 国际饭店 83.8m: Art Deco 层层退台 */
function artDeco(opt = {}) {
  const g = new THREE.Group();
  /* v=41 精修: 参数化 —— 22 处地标共用同一个形体, 外滩一排楼长得一模一样。
     w/d/h/tiers/dome/spire 可调; 默认值 ≈ 原形体(26×22 · 5 级 · 总高 104 模型米),
     旧的无参引用形状不变。h 为"模型米"(已含 1.6 倍垂直夸张)。 */
  const W0 = opt.w || 26, D0 = opt.d || 22, H0 = opt.h || 104;
  const tiers = Math.max(1, opt.tiers || 5);
  const dome = !!opt.dome, spire = opt.spire !== false;
  const usable = H0 - tiers * 1.2 - 14;
  let w = W0, d = D0, frSum = 0;
  for (let i = 0; i < tiers; i++) frSum += Math.pow(0.62, i);
  const steps = [];
  for (let i = 0; i < tiers; i++) {
    steps.push([w, d, Math.max(5, usable * Math.pow(0.62, i) / frSum)]);
    w *= 0.74; d *= 0.76;
  }
  let y = 0;
  for (const [sw, sd, sh] of steps) {
    g.add(BOX(M.granite, 0, y, 0, sw, sh, sd));
    g.add(BOX(M.dark, 0, y + sh, 0, sw * 1.04, 1.2, sd * 1.04));
    y += sh + 1.2;
  }
  // 正面竖向玻璃壁柱条, 强化 Art Deco 装饰感
  for (let si = 0; si < Math.min(3, tiers); si++) {
    const [sw, sd, sh] = steps[si];
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      g.add(BOX(M.glassW, k * sw * 0.18, 2, sd / 2 + 0.05, 1.4, Math.max(4, sh - 5), 0.3));
    }
  }
  if (dome) {
    const rr = Math.max(6, steps[tiers - 1][0] * 0.62);
    g.add(CYL(M.granite, 0, y, 0, rr, rr * 0.92, 6, 12));
    g.add(DOME(M.greenRoof, 0, y + 6, 0, rr, 10));
    g.add(CYL(M.steel, 0, y + 16, 0, 0.9, 0.3, 8, 6));
  } else if (spire) {
    g.add(CYL(M.steel, 0, y, 0, 1.1, 0.3, 12, 6));
  }
  g.userData.height = H0 * H;
  return g;
}

/** 上海自然博物馆: 螺旋壳体下沉式建筑 + 玻璃中庭 */
function spiralMuseum() {
  const g = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const a = t * Math.PI * 1.9;
    const r = 46 * (1 - t * 0.72);
    const h = 8 + t * 16;
    const m = BOX(M.stone, Math.cos(a) * r, 0, Math.sin(a) * r, 9, h, 4.5, -a);
    g.add(m);
  }
  g.add(CYL(M.glassW, 0, 0, 0, 15, 13, 22, 20));
  g.add(DOME(M.glassW, 0, 22, 0, 13, 7));
  g.userData.height = 34 * H;
  return g;
}

/** 摩天轮 (大悦城/锦江乐园一类) */
function ferrisWheel(R = 27) {
  const g = new THREE.Group();
  const yC = R + 8;
  for (const s of [-1, 1]) {
    g.add(STRUT(M.steel, s * R * 0.5, 0, R * 0.34, 0, yC, 0, 1.6));
    g.add(STRUT(M.steel, s * R * 0.5, 0, -R * 0.34, 0, yC, 0, 1.6));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * W, 1.1 * W, 8, 40), M.steel);
  ring.position.set(0, yC * H, 0);
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62 * W, 0.7 * W, 6, 32), M.steel);
  ring2.position.set(0, yC * H, 0);
  g.add(ring2);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    g.add(STRUT(M.steel, 0, yC, 0, Math.cos(a) * R, yC + Math.sin(a) * R * (H / H), 0, 0.4));
    const cab = BOX(i % 2 ? M.pink : M.glassW, Math.cos(a) * R, yC + Math.sin(a) * R - 2.6, 0, 3.4, 3.4, 3.4);
    g.add(cab);
  }
  g.add(CYL(M.dark, 0, 0, 0, 8, 7, 4, 12));
  g.userData.height = (yC + R + 6) * H;
  return g;
}

/* =========================================================
   五、世博 / 滨江 / 科教
   ========================================================= */

/** 中华艺术宫 (原世博中国馆) 63m: 倒斗冠 + 四组巨柱 */
function chinaPavilion() {
  const g = new THREE.Group();
  const red = mk('#c0342b', { rough: 0.5, metal: 0.24, emi: '#5a0e08', emiK: 0.6 });
  g.add(BOX(M.concrete, 0, 0, 0, 140, 3, 140));
  for (const [dx, dz] of [[-26, -26], [26, -26], [-26, 26], [26, 26]])
    g.add(BOX(M.concrete, dx, 3, dz, 15, 30, 15));
  // 倒置斗冠: 自下而上外扩的层叠方框
  let y = 33;
  for (let i = 0; i < 7; i++) {
    const w = 74 + i * 12;
    g.add(BOX(red, 0, y, 0, w, 4.2, w));
    y += 4.4;
  }
  g.add(BOX(red, 0, y, 0, 146, 3, 146));
  g.userData.height = (y + 6) * H;
  return g;
}

/** 油罐艺术中心: 五座航油罐改造 */
function oilTanks() {
  const g = new THREE.Group();
  const pos = [[-34, -12], [-6, 12], [22, -16], [46, 10], [8, -38]];
  pos.forEach(([x, z], i) => {
    const r = 11 + (i % 3) * 2;
    g.add(CYL(M.white, x, 0, z, r, r, 16 + (i % 2) * 4, 20));
    g.add(DOME(M.steel, x, 16 + (i % 2) * 4, z, r, 4.5));
    g.add(CYL(M.steel, x, 0, z, r * 1.06, r * 1.06, 1.4, 20));
  });
  g.add(BOX(M.glassW, 6, 0, -8, 66, 6, 12, 22 * D2R));
  g.userData.height = 24 * H;
  return g;
}

/** 上海科技馆: 巨型玻璃球 + 弧形展馆 */
function scienceMuseum() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 150, 26, 60, -6 * D2R));
  // 弧形体量
  const arc = new THREE.Mesh(new THREE.TorusGeometry(78 * W, 13 * W, 10, 26, Math.PI * 0.62), M.stone);
  arc.position.set(0, 14 * H, 26 * W);
  arc.rotation.set(-Math.PI / 2, 0, Math.PI * 0.19);
  arc.scale.set(1, 1, 2.0);
  g.add(arc);
  g.add(SPH(M.glassW, -6, 34, -4, 27));
  g.add(CYL(M.steel, -6, 0, -4, 30, 26, 8, 24));
  g.userData.height = 66 * H;
  return g;
}

/** 上海天文馆: 圆洞天窗 + 倒转穹顶 + 螺旋体 */
function planetarium() {
  const g = new THREE.Group();
  g.add(CYL(M.white, 0, 0, 0, 62, 56, 18, 30));
  for (let i = 0; i < 22; i++) {
    const t = i / 22, a = t * Math.PI * 1.7;
    const r = 60 * (1 - t * 0.5);
    g.add(BOX(M.white, Math.cos(a) * r, 18, Math.sin(a) * r, 11, 6 + t * 14, 6, -a));
  }
  g.add(DOME(M.glassW, 22, 18, -10, 26, 22));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(30 * W, 3 * W, 8, 30), M.steel);
  ring.position.set(-14 * W, 32 * H, 14 * W);
  ring.rotation.set(-Math.PI / 2.6, 0.4, 0);
  g.add(ring);
  g.userData.height = 48 * H;
  return g;
}

/** 江湾体育场 / 大型体育场: 椭圆看台碗 */
function stadium() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), M.concrete);
  ring.scale.set(96 * W, 22 * H, 76 * W);
  ring.position.y = 11 * H;
  ring.material = mk('#c6c0b2', { rough: 0.8, side: THREE.DoubleSide });
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), ring.material);
  ring2.scale.set(78 * W, 16 * H, 60 * W);
  ring2.position.y = 8 * H;
  g.add(ring2);
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 34), M.tree);
  field.rotation.x = -Math.PI / 2;
  field.scale.set(70 * W, 54 * W, 1);
  field.position.y = 1.2 * H;
  g.add(field);
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    g.add(BOX(M.concrete, Math.cos(a) * 92, 0, Math.sin(a) * 72, 5, 22, 5, -a));
  }
  g.userData.height = 30 * H;
  return g;
}

/** 航站楼: 长向波浪屋盖 + 塔台 */
function airportTerminal() {
  const g = new THREE.Group();
  g.add(BOX(M.glassW, 0, 0, 0, 300, 22, 66, 12 * D2R));
  for (let i = 0; i < 10; i++) {
    const x = -135 + i * 30;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(36 * W, 2.4 * W, 6, 14, Math.PI), M.steel);
    arc.position.set(x * W, 22 * H, 0);
    arc.rotation.set(0, Math.PI / 2 + 12 * D2R, 0);
    g.add(arc);
  }
  g.add(BOX(M.white, 0, 22, 0, 306, 4, 74, 12 * D2R));
  g.add(CYL(M.concrete, 150, 0, -40, 7, 5.5, 62, 12));
  g.add(CYL(M.glassW, 150, 62, -40, 11, 9, 12, 12));
  g.add(CONE(M.steel, 150, 74, -40, 10, 8, 12));
  g.userData.height = 84 * H;
  return g;
}

/* =========================================================
   六、迪士尼 / 乐园
   ========================================================= */

/** 奇幻童话城堡 (上海迪士尼) 高约 60m: 中央主塔 + 环列尖塔 + 拱门 */
function disneyCastle() {
  const g = new THREE.Group();
  const wall = mk('#f2e9dc', { rough: 0.52, metal: 0.12, emi: '#5a4a56', emiK: 0.36 });
  const roofA = mk('#4f7fc8', { rough: 0.34, metal: 0.5, emi: '#16305e', emiK: 0.62 });
  const roofB = mk('#ef9dc0', { rough: 0.38, metal: 0.36, emi: '#6a2a48', emiK: 0.55 });

  g.add(BOX(M.granite, 0, 0, 0, 96, 5, 74));                     // 台基
  g.add(BOX(wall, 0, 5, 6, 76, 20, 46));                         // 主体
  g.add(BOX(wall, 0, 5, -20, 44, 30, 26));                       // 后部高体
  // 拱门
  g.add(BOX(roofA, 0, 25, 6, 80, 3, 50));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(8 * W, 3 * W, 8, 16, Math.PI), M.gold);
  arch.position.set(0, 16 * H, 29.5 * W);
  g.add(arch);
  g.add(BOX(M.wood, 0, 5, 29.5, 14, 12, 2.5));

  // 中央主塔
  g.add(CYL(wall, 0, 28, -8, 13, 11, 30, 12));
  g.add(CYL(roofB, 0, 58, -8, 14.5, 13.5, 3, 12));
  g.add(CONE(roofA, 0, 61, -8, 14, 26, 12));
  g.add(CYL(M.gold, 0, 87, -8, 0.7, 0.25, 7, 6));
  g.add(SPH(M.lamp, 0, 94, -8, 1.8));

  // 环列尖塔
  const towers = [[-34, 18, 8, 22, roofA], [34, 18, 8, 22, roofB],
  [-24, -26, 6.5, 17, roofB], [24, -26, 6.5, 17, roofA],
  [-16, 24, 5.5, 13, roofB], [16, 24, 5.5, 13, roofA]];
  for (const [x, z, r, h, rf] of towers) {
    g.add(CYL(wall, x, 5, z, r, r * 0.92, h, 10));
    g.add(CYL(rf, x, 5 + h, z, r * 1.24, r * 1.14, 1.8, 10));
    g.add(CONE(rf, x, 5 + h + 1.8, z, r * 1.16, h * 0.95, 10));
    g.add(CYL(M.gold, x, 5 + h * 1.95 + 1.8, z, 0.4, 0.15, 4, 6));
  }
  // 侧翼城墙垛口
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      g.add(BOX(wall, s * (30 + i * 7), 25, 24, 4.5, 4, 4.5));
    }
  }
  g.userData.height = 98 * H;
  return g;
}

/** 主题乐园综合体: 摩天轮 + 过山车环 + 帐篷 */
function amusementPark() {
  const g = new THREE.Group();
  const fw = ferrisWheel(24);
  fw.position.set(-40 * W, 0, 20 * W);
  g.add(fw);
  // 过山车回环
  const loop = new THREE.Mesh(new THREE.TorusGeometry(17 * W, 1.1 * W, 7, 26), M.steel);
  loop.position.set(34 * W, 20 * H, -10 * W);
  loop.rotation.y = 0.5;
  loop.scale.set(1, 1.5, 1);
  g.add(loop);
  for (const dx of [22, 46]) g.add(STRUT(M.steel, dx, 0, -10, dx, 20, -10, 1.1));
  // 帐篷
  for (const [x, z, r] of [[0, -34, 13], [-18, -14, 9], [16, 26, 10]]) {
    g.add(CYL(M.white, x, 0, z, r * 0.9, r * 0.9, 5, 12));
    g.add(CONE(mk('#e0554f', { rough: 0.6 }), x, 5, z, r, 12, 12));
    g.add(CYL(M.gold, x, 17, z, 0.4, 0.15, 4, 6));
  }
  g.userData.height = 56 * H;
  return g;
}

/* =========================================================
   七、古镇 / 郊野 / 近代风貌
   ========================================================= */

/** 江南水乡古镇: 沿河两排坡顶民居 + 石拱桥 */
function waterTown() {
  const g = new THREE.Group();
  // 河道
  const river = new THREE.Mesh(new THREE.PlaneGeometry(230 * W, 22 * W), M.water);
  river.rotation.x = -Math.PI / 2;
  river.position.y = 0.6 * H;
  g.add(river);
  const rnd = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const x = -108 + i * 18 + side * 3;
      const z = side * (20 + Math.abs(rnd(i + side * 7)) * 8);
      const w = 13 + Math.abs(rnd(i * 3 + side)) * 5;
      const h = 7 + Math.abs(rnd(i * 5 + side)) * 5;
      g.add(BOX(M.cream, x, 0, z, w, h, 12));
      g.add(BOX(M.darkTile, x, h, z, w * 1.2, 1.2, 14));
      g.add(PYR(M.darkTile, x, h + 1.2, z, w * 1.1, 13, 5));
      if (i % 4 === 0) {
        g.add(CYL(M.wood, x + 7, 0, z - side * 9, 0.6, 0.6, 9, 6));
        g.add(SPH(M.lamp, x + 7, 10, z - side * 9, 1));
      }
    }
  }
  // 石拱桥
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(11 * W, 2.6 * W, 8, 18, Math.PI), M.granite);
  bridge.position.set(-6 * W, 1 * H, 0);
  bridge.rotation.y = Math.PI / 2;
  bridge.scale.set(1, 1.5, 3.4);
  g.add(bridge);
  g.add(BOX(M.granite, -6, 12, 0, 8, 1.4, 30));
  for (const [x, z] of [[-70, -34], [56, 32], [96, -28]]) {
    g.add(CYL(M.wood, x, 0, z, 1.2, 1, 6, 6));
    g.add(SPH(M.tree, x, 11, z, 7));
  }
  g.userData.height = 22 * H;
  return g;
}

/** 广富林遗址: 半沉水中的大坡屋顶群 */
function floatingRoofs() {
  const g = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CircleGeometry(90 * W, 30), M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.6 * H;
  g.add(water);
  const roofs = [[0, 0, 62, 40, 22], [-56, 30, 42, 28, 16], [50, -34, 46, 30, 17]];
  for (const [x, z, w, d, h] of roofs) {
    g.add(BOX(M.darkTile, x, 0, z, w * 1.1, 2, d * 1.1));
    g.add(PYR(M.terra, x, 2, z, w, d, h));
    g.add(BOX(M.terra, x, 2, z, w * 1.16, 2.4, d * 1.16));
  }
  g.add(CYL(M.granite, -20, 0, -48, 5, 4, 14, 8));
  g.userData.height = 28 * H;
  return g;
}

/** 佘山: 山体 + 天文台穹顶 + 双塔教堂 */
function hillObservatory() {
  const g = new THREE.Group();
  g.add(CONE(mk('#3c5a44', { rough: 0.9, metal: 0.02, emi: '#16281c', emiK: 0.4 }), 0, 0, 0, 130, 98, 22));
  g.add(CYL(M.white, -18, 84, 10, 11, 10, 12, 16));
  g.add(DOME(M.steel, -18, 96, 10, 10.5, 9));
  // 教堂
  g.add(BOX(M.cream, 26, 72, -12, 30, 14, 18, 22 * D2R));
  g.add(PYR(M.terra, 26, 86, -12, 32, 20, 8, 22 * D2R));
  for (const dx of [-8, 8]) {
    g.add(BOX(M.cream, 26 + dx, 72, -22, 8, 26, 8, 22 * D2R));
    g.add(CONE(M.terra, 26 + dx, 98, -22, 6, 12, 8));
  }
  g.userData.height = 116 * H;
  return g;
}

/** 武康大楼: 30° 街角"熨斗"式八层公寓 */
function wukangMansion() {
  const g = new THREE.Group();
  // 锐角三角平面: 用三块渐窄的体量拼出楔形
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const w = 15 * (1 - t * 0.88) + 2;
    const x = -46 + i * 10;
    g.add(BOX(M.terra, x, 0, 0, 10.4, 24, w + 12, 0));
    g.add(BOX(M.cream, x, 24, 0, 10.6, 2.4, w + 13, 0));
    g.add(BOX(M.terra, x, 26.4, 0, 9.4, 4.4, w + 9, 0));
  }
  g.add(BOX(M.cream, -46, 0, 0, 3, 31, 27));
  g.add(BOX(M.darkTile, -12, 30.8, 0, 78, 1.6, 22));
  g.userData.height = 36 * H;
  return g;
}

/** 现代美术馆 / 艺术中心: 混凝土"伞拱"体量 (龙美术馆一类) */
function vaultGallery() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 110, 10, 70, 10 * D2R));
  for (let i = 0; i < 5; i++) {
    const x = -44 + i * 22;
    const vault = new THREE.Mesh(new THREE.CylinderGeometry(11 * W, 11 * W, 62 * W, 14, 1, false, 0, Math.PI), M.concrete);
    vault.rotation.set(Math.PI / 2, 0, 0);
    vault.rotation.z = 10 * D2R;
    vault.position.set(x * W, 10 * H, 0);
    vault.scale.set(1, 1, 1.6);
    g.add(vault);
    g.add(BOX(M.concrete, x, 0, 0, 3.4, 12, 62, 10 * D2R));
  }
  g.add(BOX(M.glassW, 0, 0, 38, 90, 9, 8, 10 * D2R));
  g.userData.height = 30 * H;
  return g;
}

/* =========================================================
   七·五、第二批地标构件 (商圈 / 教堂 / 体育 / 会展 / 枢纽 / 郊野)
   ---------------------------------------------------------
   与第一批共用同一套基本体 (BOX/CYL/PYR/CONE/DOME/SPH/STRUT/CN_ROOF)
   与材质表 M, 尺寸一律按建筑实测米数给定; 随机量用确定性哈希,
   保证每次刷新生成的形态完全一致。
   ========================================================= */

/** 确定性伪随机 [0,1) */
function rnd1(i, k = 1) {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 通用退台塔楼: 可选裙房 + 逐段收分方塔 + 顶冠 / 桅杆 */
function boxTower(opt = {}) {
  const h = opt.h || 160, w = opt.w || 44, d = opt.d || 38;
  const mat = opt.mat || M.glass, rot = (opt.rot || 0) * D2R;
  const g = new THREE.Group();
  let y = 0;
  if (opt.podium) {
    g.add(BOX(opt.pmat || M.stone, 0, 0, 0, opt.pw || w * 2.0, opt.podium, opt.pd || d * 2.0, rot));
    y = opt.podium;
  }
  // v=29: 楼层窗带材质 — 玻璃塔用青白, 钢混塔用微黄
  const winMat = mat === M.glass ? new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.32 })
    : new THREE.MeshBasicMaterial({ color: '#d8b25a', transparent: true, opacity: 0.28 });
  const segs = opt.segs || 4, hh = (h - y) / segs;
  for (let i = 0; i < segs; i++) {
    const k = 1 - (i / segs) * (opt.taper || 0.22);
    g.add(BOX(mat, 0, y, 0, w * k, hh * 0.93, d * k, rot));
    g.add(BOX(M.steel, 0, y + hh * 0.93, 0, w * k * 1.07, hh * 0.07 + 0.5, d * k * 1.07, rot));
    // 楼层窗带: 沿四面绕一圈, 间隔 ~3.5m
    const floors = Math.max(2, Math.floor(hh * 0.93 / 3.5));
    for (let fi = 1; fi < floors; fi++) {
      const fy = y + hh * 0.93 * (fi / floors);
      g.add(BOX(winMat, 0, fy, 0, w * k * 1.005, 0.45, d * k * 1.005, rot));
    }
    y += hh;
  }
  if (opt.crown) g.add(BOX(M.steel, 0, h, 0, w * 0.42, opt.crown, d * 0.42, rot));
  if (opt.mast) g.add(CYL(M.steel, 0, h + (opt.crown || 0), 0, 1.0, 0.3, opt.mast, 6));
  g.userData.height = (h + (opt.crown || 0) + (opt.mast || 0) + 6) * H;
  return g;
}

/** 双塔: 两座退台塔 + 共用裙房 (港汇恒隆 / 环贸 iapm / 上海图书馆) */
function twinTowers(opt = {}) {
  const g = new THREE.Group();
  const gap = opt.gap || 70, w = opt.w || 44, rot = (opt.rot || 0) * D2R;
  for (const s of [-1, 1]) {
    const t = boxTower({
      h: opt.h || 160, w, d: opt.d || 38, mat: opt.mat || M.glass,
      taper: opt.taper || 0.2, segs: opt.segs || 4, crown: opt.crown || 0,
    });
    t.position.set(s * gap * 0.5 * W, 0, 0);
    g.add(t);
  }
  g.add(BOX(opt.pmat || M.stone, 0, 0, 0, gap + w * 1.5, opt.podium || 28, opt.pd || (opt.d || 38) * 1.8, rot));
  if (opt.sky) g.add(BOX(M.glassW, 0, (opt.h || 160) * 0.66, 0, gap * 0.92, 7, 15, rot));
  g.userData.height = ((opt.h || 160) + 14) * H;
  return g;
}

/** 上海展览中心 (原中苏友好大厦 1955): 中央塔楼 + 两翼展厅 + 柱廊 */
function expoCenter() {
  const g = new THREE.Group();
  const wall = M.cream;
  g.add(BOX(M.granite, 0, 0, 0, 250, 4, 120));
  for (const s of [-1, 1]) {
    g.add(BOX(wall, s * 88, 4, 0, 76, 30, 66));
    g.add(BOX(M.stoneD, s * 88, 34, 0, 80, 3, 70));
    for (let i = -2; i <= 2; i++) g.add(CYL(M.white, s * 88 + i * 16, 12, 34, 1.7, 1.7, 22, 10));
    g.add(PYR(M.greenRoof, s * 88, 37, 0, 74, 64, 12));
  }
  // 中央塔楼 (仿圣彼得堡海军部大厦 / 全苏农展馆主楼)
  g.add(BOX(wall, 0, 4, 0, 54, 32, 48));
  g.add(BOX(M.stoneD, 0, 36, 0, 58, 3, 52));
  for (let i = -3; i <= 3; i++) g.add(CYL(M.white, i * 8, 4, 26, 1.8, 1.8, 28, 12));
  g.add(BOX(wall, 0, 39, 0, 40, 22, 38));
  g.add(BOX(M.stoneD, 0, 61, 0, 44, 3, 42));
  g.add(CYL(M.white, 0, 64, 0, 13, 10, 20, 18));
  g.add(DOME(M.gold, 0, 84, 0, 10, 13));
  g.add(CYL(M.steel, 0, 97, 0, 1.0, 0.3, 12, 6));
  g.add(SPH(M.gold, 0, 110, 0, 3.4));                 // 塔顶五角星
  g.userData.height = 118 * H;
  return g;
}

/** 哥特复兴教堂: 双钟塔 + 中殿 + 侧廊 + 玫瑰窗 (徐家汇天主教堂) */
function gothicChurch(opt = {}) {
  const g = new THREE.Group();
  const L = opt.L || 68, Wd = opt.Wd || 34, th = opt.th || 24;
  g.add(BOX(M.granite, 0, 0, 0, L * 1.08, 2, Wd * 1.2));
  g.add(BOX(M.cream, 0, 2, 0, L, 26, Wd));                        // 中殿
  g.add(BOX(M.stoneD, 0, 28, 0, L * 1.02, 2, Wd * 1.04));
  g.add(PYR(M.darkTile, 0, 30, 0, L * 0.92, Wd * 1.02, 13));      // 坡屋顶
  for (const s of [-1, 1]) {                                      // 侧廊
    g.add(BOX(M.cream, 0, 2, s * (Wd * 0.66), L * 0.84, 15, Wd * 0.32));
    g.add(BOX(M.darkTile, 0, 17, s * (Wd * 0.66), L * 0.86, 1.6, Wd * 0.36));
  }
  for (const s of [-1, 1]) {                                      // 双钟塔 + 尖顶
    const x = s * Wd * 0.44, z = Wd * 0.34;
    g.add(BOX(M.cream, x, 2, z, 13, th, 13));
    g.add(BOX(M.granite, x, 2 + th, z, 15, 2.6, 15));
    g.add(BOX(M.cream, x, 4.6 + th, z, 10, 11, 10));
    g.add(CONE(M.darkTile, x, 15.6 + th, z, 7.4, 24, 4));
    g.add(CYL(M.gold, x, 39.6 + th, z, 0.5, 0.14, 5, 4));         // 十字
  }
  const rose = new THREE.Mesh(new THREE.CircleGeometry(5.6 * W, 20), M.glassW);
  rose.position.set(0, 22 * H, (Wd * 0.5 + 0.4) * W);
  g.add(rose);
  g.add(BOX(M.terra, 0, 2, Wd * 0.5 + 1, 9, 13, 2));              // 入口门廊
  g.userData.height = (th + 50) * H;
  return g;
}

/** 球体商业体: 石材裙房 + 巨型玻璃球 (美罗城) */
function globeBuilding(opt = {}) {
  const g = new THREE.Group();
  const r = opt.r || 22;
  const glassBall = mk('#8fd0f0', { rough: 0.14, metal: 0.90, emi: '#1d4e6e', emiK: 0.6 });
  g.add(BOX(M.granite, 0, 0, 0, r * 3.0, 9, r * 2.4));
  g.add(BOX(M.glassW, 0, 9, 0, r * 2.6, 13, r * 2.1));
  g.add(BOX(M.stoneD, 0, 22, 0, r * 2.1, 2.4, r * 1.7));
  g.add(CYL(M.steel, 0, 24.4, 0, r * 0.92, r * 0.86, 3, 24));     // 球体支座
  g.add(SPH(glassBall, 0, 27.4 + r, 0, r));                       // 巨型玻璃球
  g.add(CYL(M.steel, 0, 27.4 + r * 2 - 2, 0, r * 0.32, r * 0.28, 4, 16));
  g.add(BOX(M.dark, 0, 27.4 + r, 0, r * 2.05, 0.8, r * 2.05));    // 球体腰带
  g.userData.height = (27.4 + r * 2 + 10) * H;
  return g;
}

/** 巨型商业综合体: 裙房 + 中庭玻璃穹顶 + 双子塔 (上海环球港) */
function mallDome() {
  const g = new THREE.Group();
  g.add(BOX(M.cream, 0, 0, 0, 250, 44, 170));
  g.add(BOX(M.stoneD, 0, 44, 0, 254, 3, 174));
  g.add(CYL(M.glassW, 0, 47, 0, 64, 60, 8, 30));
  g.add(DOME(M.glassW, 0, 55, 0, 60, 30));                        // 中庭穹顶
  for (let i = -4; i <= 4; i++) g.add(CYL(M.white, i * 28, 0, 88, 2.6, 2.6, 44, 12));
  g.add(PYR(M.greenRoof, 0, 47, -66, 74, 60, 18));                // 屋顶花园塔冠
  for (const s of [-1, 1]) {                                      // 248m 双子塔
    const t = boxTower({ h: 248, w: 46, d: 40, taper: 0.26, mat: M.glass, segs: 5 });
    t.position.set(s * 92 * W, 0, -30 * W);
    g.add(t);
  }
  g.userData.height = 266 * H;
  return g;
}

/** 上海国金中心 IFC: 南塔 249.9m / 北塔 259.9m + 85m 低层商业体 */
function ifcTowers() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 176, 24, 96));                      // 大裙房
  const tower = (x, h, segs) => {
    const hh = (h - 24) / segs;
    let y = 24;
    for (let i = 0; i < segs; i++) {
      const k = 1 - (i / segs) * 0.22;
      g.add(BOX(M.glassW, x, y, 0, 36 * k, hh * 0.94, 26 * k));
      g.add(BOX(M.steel, x, y + hh * 0.94, 0, 36 * k * 1.06, hh * 0.06 + 0.6, 26 * k * 1.06));
      y += hh;
    }
    g.add(BOX(M.steel, x, h, 0, 24, 6, 18));
  };
  tower(-34, 250, 10);
  tower(34, 260, 10);
  g.add(BOX(M.glassW, 0, 24, -46, 60, 61, 48));                   // 85m 低层建筑
  g.add(BOX(M.stoneD, 0, 85, -46, 64, 3, 52));
  g.add(CYL(M.glassW, 0, 24, 40, 9, 9, 8, 20));                   // 下沉广场玻璃筒 (Apple 店)
  g.userData.height = 274 * H;
  return g;
}

/** 震旦国际大楼 180m: 花岗岩基座 + 玻璃幕墙 + 面向外滩的巨型弧形 LED 屏 */
function ledTower() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 60, 26, 50));                     // 1~5F 石材
  g.add(BOX(M.glassW, 0, 26, 0, 48, 154, 42));                    // 主楼至 180m
  for (let i = 0; i < 5; i++) g.add(BOX(M.steel, 0, 26 + i * 31, 0, 50, 1.6, 44));
  g.add(BOX(M.steel, 0, 180, 0, 40, 5, 34));
  g.add(CYL(M.steel, 0, 185, 0, 1.1, 0.3, 12, 6));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(57 * W, 63 * H), M.neon);
  led.position.set(-24.6 * W, 70 * H, 0);                         // 57m × 63m 弧形屏
  led.rotation.y = -Math.PI / 2;
  g.add(led);
  g.add(BOX(M.concrete, 48, 0, 8, 34, 34, 42));                   // 6 层副楼
  g.userData.height = 202 * H;
  return g;
}

/** 白玉兰广场: 320m 主塔 (浦西第一高) + 172m W 酒店 + 商业裙房 */
function magnoliaPlaza() {
  const g = new THREE.Group();
  g.add(BOX(M.stone, 0, 0, 0, 230, 26, 150));
  g.add(BOX(M.glassW, 0, 26, 0, 200, 20, 120));
  const segs = 13, hh = (320 - 46) / segs;
  let y = 46;
  for (let i = 0; i < segs; i++) {
    const k = 1 - Math.pow(i / segs, 1.2) * 0.52;
    g.add(BOX(M.glassW, 0, y, 0, 44 * k, hh * 0.94, 40 * k));
    g.add(BOX(M.steel, 0, y + hh * 0.94, 0, 44 * k * 1.07, hh * 0.06 + 0.5, 40 * k * 1.07));
    y += hh;
  }
  g.add(BOX(M.steel, 0, 320, 0, 20, 8, 18));                      // 直升机平台
  g.add(CYL(M.steel, 0, 328, 0, 1.2, 0.3, 14, 6));
  g.add(SPH(M.lamp, 0, 344, 0, 2.2));
  const hotel = boxTower({ h: 172, w: 34, d: 30, taper: 0.2, mat: M.glass, segs: 4 });
  hotel.position.set(-88 * W, 0, -28 * W);
  g.add(hotel);
  g.userData.height = 350 * H;
  return g;
}

/** 上海东方艺术中心: 五片"花瓣"椭圆壳体 + 玻璃基座 */
function petalHall() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 190, 5, 160));
  const petals = [
    [0, 12, 40, 31, 34, 0], [-58, 36, 30, 23, 26, -35], [58, 36, 30, 23, 26, 35],
    [-46, -48, 27, 21, 23, 200], [46, -48, 27, 21, 23, 160],
  ];
  for (const [x, z, a, b, h, rot] of petals) {
    g.add(CYL(M.white, x, 5, z, a, a * 0.92, 7, 24));             // 基座鼓座
    const shell = new THREE.Mesh(HEMI, M.white);
    shell.scale.set(a * W, h * H, b * W);
    shell.position.set(x * W, 12 * H, z * W);
    shell.rotation.y = rot * D2R;
    g.add(shell);
    g.add(CYL(M.steel, x, 12 + h - 2, z, 1.0, 0.3, 5, 6));        // 采光尖顶
  }
  g.add(BOX(M.glassW, 0, 5, 82, 124, 13, 18));                    // 入口大厅
  g.userData.height = 56 * H;
  return g;
}

/** 梅赛德斯-奔驰文化中心: 飞碟壳体 + 看台鼓座 (18000 座) */
function discArena() {
  const g = new THREE.Group();
  g.add(CYL(M.concrete, 0, 0, 0, 68, 64, 12, 32));
  g.add(CYL(M.glassW, 0, 12, 0, 62, 58, 10, 32));
  g.add(CYL(M.steel, 0, 18, 0, 34, 70, 4, 32));                   // 下壳
  g.add(CYL(M.dark, 0, 22, 0, 70, 70, 2.4, 32));                  // 碟环
  g.add(CYL(M.steel, 0, 24.4, 0, 70, 26, 11, 32));                // 上壳
  g.add(CYL(M.glassW, 0, 35.4, 0, 26, 12, 4, 32));
  g.add(CYL(M.steel, 0, 39.4, 0, 12, 4, 4, 24));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    g.add(CYL(M.granite, Math.cos(a) * 60, 0, Math.sin(a) * 60, 3, 2.6, 18, 8));
  }
  g.userData.height = 54 * H;
  return g;
}

/** 圆形体育场 + 白色大罩棚 (上海体育场 / 八万人体育场) */
function canopyStadium(opt = {}) {
  const g = new THREE.Group();
  const R = opt.R || 126, rIn = opt.rIn || 74;
  const side = mk('#dfe6ee', { rough: 0.74, metal: 0.10, emi: '#3a4450', emiK: 0.38, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 44, 1, true), side);
  ring.scale.set(R * W, 24 * H, R * 0.84 * W);
  ring.position.y = 12 * H;
  g.add(ring);
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 40), M.tree);
  field.rotation.x = -Math.PI / 2;
  field.scale.set(rIn * W, rIn * 0.8 * W, 1);
  field.position.y = 1.4 * H;
  g.add(field);
  for (let i = 0; i < 44; i++) {                                  // 外圈柱列
    const a = i / 44 * Math.PI * 2;
    g.add(BOX(M.concrete, Math.cos(a) * R * 1.03, 0, Math.sin(a) * R * 0.86, 5, 24, 5, -a));
  }
  const canopy = new THREE.Mesh(
    new THREE.RingGeometry(R * 0.56 * W, R * 1.18 * W, 44),
    mk('#eef2f7', { rough: 0.42, metal: 0.30, emi: '#3d4a5c', emiK: 0.34, side: THREE.DoubleSide }));
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.y = 36 * H;
  g.add(canopy);
  for (let i = 0; i < 24; i++) {                                  // 罩棚外沿 + 桅杆
    const a = i / 24 * Math.PI * 2;
    const x = Math.cos(a) * R * 1.16, z = Math.sin(a) * R * 0.98;
    g.add(BOX(M.white, x, 33.4, z, 9, 2.4, 9, -a));
    if (i % 3 === 0) g.add(STRUT(M.steel, x, 0, z, x * 0.86, 36, z * 0.86, 1.3));
  }
  g.userData.height = 52 * H;
  return g;
}

/** 专业足球场: 矩形看台 + 两侧罩棚 (虹口足球场 3.5 万座) */
function footballStadium() {
  const g = new THREE.Group();
  const Lx = 104, Lz = 78, lv = 6, hh = 5.4;
  for (let i = 0; i < lv; i++) {                                  // 四面看台层层外扩
    const t = i / lv, x = Lx + t * 12, z = Lz + t * 10, y = i * hh, th = 5.4;
    for (const s of [-1, 1]) {
      g.add(BOX(M.concrete, 0, y, s * z, x * 2 + th, hh, th));
      g.add(BOX(M.concrete, s * x, y, 0, th, hh, z * 2 + th));
    }
  }
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 30), M.tree);
  field.rotation.x = -Math.PI / 2;
  field.scale.set((Lx - 22) * W, (Lz - 16) * W, 1);
  field.position.y = 1.4 * H;
  g.add(field);
  const yTop = lv * hh;
  for (const s of [-1, 1]) {                                      // 南北两侧罩棚
    g.add(BOX(M.white, 0, yTop + 13, s * (Lz + 6) * 0.5, Lx * 2.15, 2.6, (Lz + 6) * 0.72));
    for (let i = -3; i <= 3; i++) g.add(CYL(M.steel, i * 32, yTop, s * (Lz + 6) * 0.84, 1.5, 1.5, 13, 8));
  }
  g.userData.height = (yTop + 24) * H;
  return g;
}

/** 国家会展中心 "四叶草": 四座展馆环绕中央广场 */
function cloverExpo() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 380, 5, 360));
  const halls = [[0, -122, 1], [0, 122, 1], [-122, 0, 0], [122, 0, 0]];
  for (const [x, z, horiz] of halls) {
    const w = horiz ? 216 : 100, d = horiz ? 100 : 216;
    g.add(BOX(M.white, x, 5, z, w, 24, d));
    g.add(BOX(M.stoneD, x, 29, z, w * 1.03, 2, d * 1.03));
    for (let i = -2; i <= 2; i++) {                               // 弧形屋脊
      const u = i / 2, rh = 11 * (1 - u * u * 0.62);
      if (horiz) g.add(BOX(M.steel, x + i * (w / 5.2), 31, z, w / 5.6, rh, d * 0.92));
      else g.add(BOX(M.steel, x, 31, z + i * (d / 5.2), w * 0.92, rh, d / 5.6));
    }
  }
  g.add(CYL(M.glassW, 0, 5, 0, 66, 62, 22, 32));                  // 中央广场
  g.add(CYL(M.steel, 0, 27, 0, 68, 44, 8, 32));
  g.add(CYL(M.glassW, 0, 35, 0, 44, 20, 6, 32));
  g.userData.height = 58 * H;
  return g;
}

/** 上海马戏城: 金顶圆形杂技场 + 侧翼 + 入口大厅 */
function circusDome(opt = {}) {
  const g = new THREE.Group();
  const r = opt.r || 27;
  g.add(BOX(M.stone, 0, 0, 0, r * 2.8, 6, r * 2.2));
  g.add(CYL(M.cream, 0, 6, 0, r, r * 0.98, 17, 26));
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    g.add(CYL(M.white, Math.cos(a) * r, 6, Math.sin(a) * r, 1.8, 1.8, 17, 8));
  }
  g.add(CYL(M.stoneD, 0, 23, 0, r * 1.06, r * 1.04, 2.4, 26));
  g.add(DOME(M.gold, 0, 25.4, 0, r * 1.02, r * 0.72));
  g.add(CYL(M.gold, 0, 25.4 + r * 0.72, 0, 1.1, 0.3, 8, 6));
  g.add(SPH(M.lamp, 0, 25.4 + r * 0.72 + 9, 0, 1.8));
  g.add(BOX(M.cream, r * 1.9, 6, 0, r * 1.5, 20, r * 1.5));       // 侧翼
  g.add(BOX(M.terra, r * 1.9, 26, 0, r * 1.7, 1.6, r * 1.7));
  g.add(BOX(M.glassW, 0, 6, r * 1.72, r * 2.0, 16, r * 1.0));     // 入口大厅
  g.userData.height = (25.4 + r * 0.72 + 16) * H;
  return g;
}

/** 火车站: round=true 为圆形玻璃站房 (上海南站), 否则为线侧站房 + 站台雨棚 */
function railStation(opt = {}) {
  const g = new THREE.Group();
  if (opt.round) {
    const R = opt.R || 96;
    g.add(CYL(M.granite, 0, 0, 0, R * 1.14, R * 1.14, 5, 40));
    g.add(CYL(M.glassW, 0, 5, 0, R, R * 0.98, 25, 40));
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2;
      g.add(CYL(M.steel, Math.cos(a) * R * 0.99, 5, Math.sin(a) * R * 0.99, 0.9, 0.9, 25, 6));
    }
    /* v=42b: 屋盖提亮 —— M.steel 金属度高, 俯视时整个南站是一块深色大圆盘;
       换成浅灰铝板色, 俯视能读出"圆形站屋" */
    const roofMat = mk('#c9d0da', { rough: 0.5, metal: 0.32 });
    g.add(CYL(roofMat, 0, 30, 0, R * 1.04, R * 0.74, 9, 40));     // 圆盘屋盖
    g.add(CYL(M.glassW, 0, 39, 0, R * 0.74, R * 0.36, 6, 40));
    g.add(CYL(M.steel, 0, 45, 0, R * 0.36, R * 0.14, 4, 40));
    for (let i = 0; i < 24; i++) {                                // 放射状屋架
      const a = i / 24 * Math.PI * 2;
      g.add(STRUT(M.steel,
        Math.cos(a) * R * 0.14, 49, Math.sin(a) * R * 0.14,
        Math.cos(a) * R * 1.02, 30, Math.sin(a) * R * 1.02, 1.0));
    }
    g.userData.height = 62 * H;
    return g;
  }
  const L = opt.L || 200, D = opt.D || 56, HH = opt.h || 32;
  g.add(BOX(M.granite, 0, 0, 0, L * 1.06, 3, D * 1.1));
  g.add(BOX(M.stone, 0, 3, 0, L, 9, D));
  g.add(BOX(M.glassW, 0, 12, 0, L * 0.96, HH - 12, D * 0.88));
  const vault = new THREE.Mesh(
    new THREE.CylinderGeometry(D * 0.54 * W, D * 0.54 * W, L * W, 20, 1, false, 0, Math.PI), M.steel);
  vault.rotation.z = Math.PI / 2;                                 // 半圆拱顶开口朝下
  vault.position.set(0, HH * H, 0);
  g.add(vault);
  for (const s of [-1, 1]) {                                      // 站台 + 雨棚
    g.add(BOX(M.concrete, 0, 0, s * (D * 0.5 + 24), L * 0.86, 9, 42));
    for (let i = -3; i <= 3; i++) g.add(CYL(M.steel, i * L * 0.14, 9, s * (D * 0.5 + 38), 1.0, 1.0, 7, 6));
    g.add(BOX(M.steel, 0, 16, s * (D * 0.5 + 24), L * 0.82, 1.6, 40));
  }
  g.userData.height = (HH + D * 0.54 + 8) * H;
  return g;
}

/** 中承式钢拱桥 (卢浦大桥: 主跨 550m · 拱高 100m · 世界第一拱) */
function archBridge(opt = {}) {
  const g = new THREE.Group();
  const span = opt.span || 550, rise = opt.rise || 100, bw = opt.bw || 30, deck = opt.deck || 26;
  const N = 24, pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = -span / 2 + u * span;
    pts.push([x, deck + rise * (1 - Math.pow(2 * u - 1, 2))]);    // 抛物线拱轴
  }
  for (let i = 0; i < N; i++) {                                   // 两道拱肋
    for (const s of [-1, 1]) {
      g.add(STRUT(M.steel, pts[i][0], pts[i][1], s * bw * 0.5, pts[i + 1][0], pts[i + 1][1], s * bw * 0.5, 2.8));
    }
  }
  g.add(BOX(M.dark, 0, deck - 2, 0, span * 1.34, 3, bw));         // 桥面
  for (let i = 1; i < N; i++) {                                   // 吊杆 + 拱上立柱
    const x = pts[i][0], y = pts[i][1];
    if (Math.abs(x) > span * 0.47) continue;
    for (const s of [-1, 1]) g.add(STRUT(M.steel, x, deck, s * bw * 0.42, x, y, s * bw * 0.5, 0.9));
  }
  for (let i = 0; i < 4; i++) {                                   // 风撑
    const u = 0.2 + i * 0.2;
    const x = -span / 2 + u * span, y = deck + rise * (1 - Math.pow(2 * u - 1, 2));
    g.add(STRUT(M.steel, x, y, -bw * 0.5, x, y, bw * 0.5, 1.2));
  }
  for (const s of [-1, 1]) g.add(BOX(M.granite, s * span * 0.5, -12, 0, 28, deck + 8, bw + 18));
  g.userData.height = (deck + rise + 16) * H;
  return g;
}

/** 动物园: 草坪 + 湖面 + 动物馆舍 + 林木 (上海动物园 74 公顷) */
function zooPark() {
  const g = new THREE.Group();
  const grass = mk('#3f7a4e', { rough: 0.92, metal: 0.02, emi: '#14301e', emiK: 0.4 });
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 36), grass);
  lawn.rotation.x = -Math.PI / 2;
  lawn.scale.set(300 * W, 230 * W, 1);
  lawn.position.y = 0.5 * H;
  g.add(lawn);
  for (const [x, z, a, b] of [[-96, 46, 74, 44], [120, -70, 52, 34]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 26), M.water);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(a * W, b * W, 1);
    p.position.set(x * W, 0.8 * H, z * W);
    g.add(p);
  }
  // 动物馆舍: 圆顶 / 高体量 / 长条形
  const houses = [
    [-72, -62, 30, 'dome'], [6, -86, 26, 'tall'], [88, -52, 24, 'box'],
    [-44, 74, 26, 'box'], [104, 62, 22, 'dome'], [-150, 20, 20, 'tall'],
  ];
  for (const [x, z, r, kind] of houses) {
    g.add(BOX(M.cream, x, 0, z, r * 1.5, 9, r * 1.3));
    if (kind === 'dome') {
      g.add(CYL(M.white, x, 9, z, r * 0.8, r * 0.78, 6, 18));
      g.add(DOME(M.blueRoof, x, 15, z, r * 0.78, r * 0.5));
    } else if (kind === 'tall') {
      g.add(BOX(M.terra, x, 9, z, r * 1.1, 16, r * 0.9));
      g.add(PYR(M.terra, x, 25, z, r * 1.2, r * 1.0, 7));
    } else {
      g.add(BOX(M.granite, x, 9, z, r * 1.6, 2, r * 1.4));
      g.add(PYR(M.grayTile, x, 11, z, r * 1.5, r * 1.3, 6));
    }
  }
  for (let i = 0; i < 42; i++) {                                  // 林木
    const x = -270 + rnd1(i) * 540, z = -200 + rnd1(i, 2) * 400;
    g.add(CYL(M.wood, x, 0, z, 1.2, 1.0, 6, 6));
    g.add(SPH(M.tree, x, 11, z, 5 + rnd1(i, 3) * 3));
  }
  g.add(BOX(M.terra, 0, 0, 118, 70, 13, 12));                     // 大门
  CN_ROOF(g, M.grayTile, 0, 13, 118, 76, 16, 6);
  g.userData.height = 36 * H;
  return g;
}

/** 江南古典园林: 鸳鸯湖 + 厅堂 + 白鹤亭 + 竹林 (南翔古猗园) */
function classicalGarden() {
  const g = new THREE.Group();
  const grass = mk('#41794f', { rough: 0.92, metal: 0.02, emi: '#14301e', emiK: 0.4 });
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 34), grass);
  lawn.rotation.x = -Math.PI / 2;
  lawn.scale.set(140 * W, 120 * W, 1);
  lawn.position.y = 0.4 * H;
  g.add(lawn);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 30), M.water);
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(62 * W, 44 * W, 1);
  pond.position.set(-8 * W, 0.7 * H, 4 * W);
  g.add(pond);
  const halls = [[-68, -44, 34, 20, 12], [56, -48, 26, 16, -18], [-48, 62, 28, 18, 8]];
  for (const [x, z, w, d, r] of halls) {
    g.add(BOX(M.cream, x, 0, z, w, 9, d, r * D2R));
    CN_ROOF(g, M.grayTile, x, 9, z, w * 1.16, d * 1.2, 7, r * D2R);
  }
  // 白鹤亭 (六角攒尖)
  g.add(CYL(M.wood, 28, 0, 36, 7, 7, 6, 6));
  g.add(CYL(M.grayTile, 28, 6, 36, 10, 9.4, 1.6, 6));
  g.add(CONE(M.grayTile, 28, 7.6, 36, 9.4, 10, 6));
  g.add(CYL(M.gold, 28, 17.6, 36, 0.6, 0.2, 3, 6));
  // 九曲桥
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    g.add(BOX(M.granite, -18 + t * 44, 1.2, -22 - Math.sin(t * 6.3) * 10, 7, 1.2, 3.2, i % 2 ? 0.5 : -0.5));
  }
  // 石舫
  g.add(BOX(M.granite, 62, 0, 26, 26, 4, 10, 12 * D2R));
  g.add(BOX(M.cream, 62, 4, 26, 18, 6, 8, 12 * D2R));
  CN_ROOF(g, M.grayTile, 62, 10, 26, 20, 10, 5, 12 * D2R);
  // 竹丛与古树
  const bamboo = mk('#5f8f45', { rough: 0.88, metal: 0.02, emi: '#1e3a18', emiK: 0.42 });
  for (let i = 0; i < 54; i++) {
    const x = -130 + rnd1(i) * 260, z = -110 + rnd1(i, 2) * 220;
    g.add(CYL(bamboo, x, 0, z, 0.5, 0.34, 7 + rnd1(i, 3) * 6, 5));
  }
  for (const [x, z] of [[-96, 40], [96, -20], [20, 104], [-70, -96], [110, 88]]) {
    g.add(CYL(M.wood, x, 0, z, 1.3, 1.1, 6, 6));
    g.add(SPH(M.tree, x, 11, z, 7));
  }
  g.userData.height = 32 * H;
  return g;
}

/** 海滨沙滩景区: 人工沙滩 + 海水 + 遮阳伞阵 + 观海塔 (碧海金沙) */
function beachPark() {
  const g = new THREE.Group();
  const sand = mk('#e8d9a8', { rough: 0.94, metal: 0.02, emi: '#5a4a24', emiK: 0.4 });
  const sd = new THREE.Mesh(new THREE.CircleGeometry(1, 40), sand);
  sd.rotation.x = -Math.PI / 2;
  sd.scale.set(300 * W, 165 * W, 1);
  sd.position.set(0, 0.6 * H, -66 * W);
  g.add(sd);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(1, 40), M.water);
  sea.rotation.x = -Math.PI / 2;
  sea.scale.set(520 * W, 270 * W, 1);
  sea.position.set(0, 0.9 * H, 150 * W);
  g.add(sea);
  g.add(BOX(M.granite, 0, 0, 70, 440, 5, 8));                     // 防波堤
  for (let i = 0; i < 26; i++) {                                  // 遮阳伞
    const x = -220 + rnd1(i) * 440, z = -20 + rnd1(i, 2) * 76;
    g.add(CYL(M.white, x, 0, z, 0.6, 0.5, 4.6, 6));
    g.add(CONE(i % 2 ? M.pink : M.terra, x, 4.6, z, 4.6, 2.6, 8));
  }
  // 观海廊
  for (const [x, z, r] of [[-140, -70, 0], [130, -80, 10]]) {
    g.add(BOX(M.cream, x, 0, z, 74, 8, 22, r * D2R));
    CN_ROOF(g, M.terra, x, 8, z, 80, 26, 6, r * D2R);
  }
  // 观光塔
  g.add(CYL(M.white, 0, 0, -140, 9, 6, 36, 14));
  g.add(CYL(M.glassW, 0, 36, -140, 11, 9, 10, 14));
  g.add(CONE(M.blueRoof, 0, 46, -140, 10, 12, 14));
  g.userData.height = 66 * H;
  return g;
}

/** 湿地公园: 芦苇荡 + 水泊 + 木栈道 + 观鸟塔 + 风车 (崇明东滩) */
function wetlandPark() {
  const g = new THREE.Group();
  const mud = mk('#6d7a4c', { rough: 0.94, metal: 0.02, emi: '#22301a', emiK: 0.4 });
  const flat = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mud);
  flat.rotation.x = -Math.PI / 2;
  flat.scale.set(300 * W, 260 * W, 1);
  flat.position.y = 0.4 * H;
  g.add(flat);
  for (const [x, z, a, b] of [[-96, -64, 92, 60], [116, 44, 80, 54], [0, 116, 112, 48]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.water);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(a * W, b * W, 1);
    p.position.set(x * W, 0.7 * H, z * W);
    g.add(p);
  }
  const reed = mk('#8a9a58', { rough: 0.9, metal: 0.02, emi: '#2c3a18', emiK: 0.45 });
  for (let i = 0; i < 110; i++) {
    const x = -270 + rnd1(i) * 540, z = -240 + rnd1(i, 2) * 480;
    if (Math.abs(x) < 46 && Math.abs(z) < 46) continue;
    g.add(CYL(reed, x, 0, z, 0.5, 0.3, 6 + rnd1(i, 3) * 8, 4));
  }
  for (let i = 0; i < 15; i++) {                                  // 木栈道
    const t = i / 14;
    g.add(BOX(M.wood, -150 + t * 300, 0.8, 126 - Math.sin(t * 5.2) * 28, 7, 1.2, 3.2));
  }
  // 观鸟台
  g.add(CYL(M.wood, -44, 0, -136, 6, 5, 22, 8));
  g.add(BOX(M.wood, -44, 22, -136, 18, 3, 18));
  g.add(BOX(M.glassW, -44, 25, -136, 15, 5, 15));
  CN_ROOF(g, M.grayTile, -44, 30, -136, 19, 19, 5);
  // 风力发电机
  for (const [x, z] of [[156, -156], [46, -196]]) {
    g.add(CYL(M.white, x, 0, z, 3.2, 1.6, 62, 12));
    g.add(SPH(M.white, x, 62, z, 2.6));
    for (let b = 0; b < 3; b++) {
      const a = b * 120 * D2R;
      g.add(STRUT(M.white, x, 62, z, x + Math.cos(a) * 30, 62 + Math.sin(a) * 30, z, 1.3));
    }
  }
  g.userData.height = 104 * H;
  return g;
}

/** 海洋主题公园: 大穹顶 + 鲸鲨馆 + 剧场 + 过山车 (上海海昌海洋公园) */
function oceanPark() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 340, 4, 290));
  // 主馆大穹顶
  g.add(CYL(M.glassW, 0, 4, -50, 48, 46, 16, 28));
  g.add(DOME(M.steel, 0, 20, -50, 46, 28));
  g.add(CYL(M.steel, 0, 48, -50, 1.2, 0.4, 10, 6));
  // 鲸鲨馆: 圆柱 + 蓝锥顶
  g.add(CYL(M.white, -112, 4, 32, 38, 34, 22, 26));
  g.add(CYL(M.glassW, -112, 4, 32, 39, 39, 5, 26));
  g.add(CONE(M.blueRoof, -112, 26, 32, 38, 22, 26));
  // 海豚剧场
  g.add(CYL(M.concrete, 102, 4, 42, 54, 50, 14, 28));
  g.add(DOME(M.glassW, 102, 18, 42, 50, 26));
  // 火山鲨鱼馆
  g.add(CONE(mk('#8d4a34', { rough: 0.8, metal: 0.06, emi: '#3a1a10', emiK: 0.5 }), -44, 4, 98, 34, 42, 7));
  // 过山车回环
  const loop = new THREE.Mesh(new THREE.TorusGeometry(22 * W, 1.2 * W, 7, 26), M.steel);
  loop.position.set(62 * W, 26 * H, -98 * W);
  loop.rotation.y = 0.4;
  loop.scale.set(1, 1.6, 1);
  g.add(loop);
  for (const dx of [46, 78]) g.add(STRUT(M.steel, dx, 0, -98, dx, 26, -98, 1.2));
  // 度假酒店双塔
  for (const s of [-1, 1]) {
    const t = boxTower({ h: 96, w: 30, d: 26, taper: 0.14, mat: M.cream, segs: 3 });
    t.position.set(s * 64 * W, 0, 120 * W);
    g.add(t);
  }
  // 水面与绿化
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 26), M.water);
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(92 * W, 46 * W, 1);
  pool.position.set(20 * W, 0.8 * H, 104 * W);
  g.add(pool);
  for (let i = 0; i < 16; i++) {
    const x = -160 + rnd1(i) * 320, z = -134 + rnd1(i, 2) * 268;
    g.add(CYL(M.wood, x, 0, z, 1.1, 0.9, 6, 6));
    g.add(SPH(M.tree, x, 10, z, 6));
  }
  g.userData.height = 80 * H;
  return g;
}

/** 石库门里弄: 两排二层砖木住宅 + 石库门门楣 + 老虎窗 (中共一大会址) */
function shikumenBlock(opt = {}) {
  const g = new THREE.Group();
  const brick = mk('#7d6a5c', { rough: 0.74, metal: 0.06, emi: '#2e2418', emiK: 0.42 });
  for (const zz of [-15, 15]) {
    const sgn = Math.sign(zz);
    for (let i = -2; i <= 2; i++) {
      const x = i * 17;
      g.add(BOX(brick, x, 0, zz, 16, 10, 11));
      g.add(BOX(M.darkTile, x, 10, zz, 17, 1.2, 12));
      g.add(BOX(M.granite, x, 0, zz - sgn * 5.6, 6, 5, 1.4));     // 石库门门框
      g.add(BOX(M.terra, x, 5, zz - sgn * 5.6, 6.8, 1, 1.8));     // 门楣
      g.add(BOX(brick, x + 5, 11.2, zz, 5, 3, 4));                 // 老虎窗
      g.add(BOX(M.darkTile, x + 5, 14.2, zz, 5.6, 1, 4.6));
    }
  }
  /* v=43: 新馆附楼只在"中共一大会址"本尊处生成 —— 原先硬编码在 builder 里,
     13 处石库门地标(鲁迅故居/宋庆龄故居...)旁边全都凭空多出一座一大纪念馆 */
  if (opt.annex) {
    g.add(BOX(M.stoneD, 0, 0, 62, 74, 14, 34));
    g.add(BOX(M.stone, 0, 14, 62, 68, 5, 30));
    for (let i = -3; i <= 3; i++) g.add(CYL(M.stone, i * 10, 0, 80, 1.6, 1.6, 19, 10));
  }
  g.userData.height = 34 * H;
  return g;
}

/* =========================================================
   八、名称标注
   ========================================================= */
function makeLabel(text, sub, color) {
  /* v=42 样式精修:
     · 左侧分类色条(替代整圈彩色描边承担分类识别, 描边改细)
     · 内侧 1px 发丝高光, 标签更精致
     · 底部小箭头指向地标本体
     · 副题从"分类原色"降为浅蓝灰, 避免和描边抢色 */
  const pad = 16, fs = 44, sfs = 24, barW = 7, gap = 12;
  const cv = document.createElement('canvas');
  const m = cv.getContext('2d');
  m.font = `700 ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const w1 = m.measureText(text).width;
  m.font = `400 ${sfs}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const w2 = sub ? m.measureText(sub).width : 0;
  const textW = Math.ceil(Math.max(w1, w2));
  const Wd = pad * 2 + barW + gap + textW + 2;
  const Hg = pad * 2 + fs + (sub ? sfs + 8 : 0) + 12;      // 底部留箭头

  cv.width = Wd; cv.height = Hg;
  const c = cv.getContext('2d');
  const BH = Hg - 12;                                      // 主体高
  const rr = (x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  };
  // 底部小箭头
  c.fillStyle = 'rgba(10,18,32,0.90)';
  c.beginPath();
  c.moveTo(Wd / 2 - 9, BH - 2); c.lineTo(Wd / 2 + 9, BH - 2); c.lineTo(Wd / 2, Hg - 1);
  c.closePath(); c.fill();
  // 主体圆角面板
  rr(1, 1, Wd - 2, BH - 2, 13);
  c.fillStyle = 'rgba(10,18,32,0.90)'; c.fill();
  c.strokeStyle = color; c.lineWidth = 2.5; c.stroke();
  // 内侧发丝高光
  c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1;
  rr(4, 4, Wd - 8, BH - 8, 10); c.stroke();
  // 左侧分类色条
  c.fillStyle = color;
  rr(9, 10, barW, BH - 20, 3.5); c.fill();
  // 文字
  const tx = 9 + barW + gap;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff';
  c.font = `700 ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
  c.fillText(text, tx, pad + fs * 0.86);
  if (sub) {
    c.fillStyle = '#c9d8ea';
    c.font = `400 ${sfs}px "PingFang SC","Microsoft YaHei",sans-serif`;
    c.fillText(sub, tx, pad + fs + sfs * 0.92 + 6);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  const k = 0.0026;
  spr.scale.set(Wd * k, Hg * k, 1);
  spr.userData.baseScale = spr.scale.clone();
  return spr;
}

/* =========================================================
   九、地标清单
   tier: 1 = 全景可见 / 2 = 中景可见 / 3 = 近景可见
   r:    该地标占地半径(米), 用于抹掉底下重复的 OSM 体块
   ========================================================= */

/* =========================================================
   交通枢纽精模 (铁路车站 / 机场航站楼 / 综合枢纽)
   ========================================================= */
/** 虹桥综合交通枢纽 · 铁路站房 (巨型连续波浪拱顶 + 中央采光光厅) */
function hongqiaoHub() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 380, 6, 150));
  g.add(BOX(M.stone, 0, 6, 0, 352, 16, 132));
  g.add(BOX(M.glassW, 0, 22, 0, 340, 18, 120));
  for (let k = -1; k <= 1; k++) {
    const z = k * 44;
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(30 * W, 30 * W, 340 * W, 24, 1, true, 0, Math.PI), M.steel);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(0, 40 * H, z * W);
    g.add(arch);
    for (let i = -6; i <= 6; i++) g.add(CYL(M.grayTile, i * 26, 40, z, 0.6, 0.6, 30, 6));
  }
  g.add(CYL(M.glassW, 0, 40, 0, 24, 16, 26, 24));
  g.add(DOME(M.glass, 0, 66, 0, 24, 16));
  for (const s of [-1, 1]) {
    g.add(BOX(M.white, s * 150, 6, 70, 70, 12, 22));
    g.add(BOX(M.glassW, s * 150, 18, 70, 64, 10, 16));
  }
  g.userData.height = 86 * H;
  return g;
}

/** 上海站 · 终端式站房 (弧形波浪屋面 + 中央钟塔) */
function shanghaiRailwayStation() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 280, 6, 110));
  g.add(BOX(M.stone, 0, 6, 0, 256, 14, 96));
  g.add(BOX(M.glassW, 0, 20, 0, 244, 16, 84));
  const N = 9;
  for (let i = -N; i <= N; i++) {
    const x = i * 14;
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(20 * W, 20 * W, 96 * W, 16, 1, true, 0, Math.PI), M.steel);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(x * W, 36 * H, 0);
    g.add(arch);
  }
  g.add(BOX(M.white, 0, 36, -56, 26, 30, 18));
  g.add(CYL(M.white, 0, 66, -56, 9, 7, 22, 12));
  g.add(CONE(M.steel, 0, 88, -56, 8, 8, 12));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(6 * W, 24), M.lamp);
  clock.position.set(0, 50 * H, -56 * W - 0.2 * W);
  clock.rotation.y = Math.PI;
  g.add(clock);
  g.userData.height = 100 * H;
  return g;
}

/** 大型机场航站楼 (指廊 + 廊桥 + 塔台) */
function airportTerminalBig(opt = {}) {
  const piers = opt.piers || 3;
  const gl = new THREE.Group();
  gl.add(BOX(M.granite, 0, 0, 0, 320, 5, 90));
  gl.add(BOX(M.glassW, 0, 5, 0, 304, 16, 78));
  for (let i = 0; i < 8; i++) {
    const x = -140 + i * 40;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(30 * W, 2.2 * W, 6, 16, Math.PI), M.steel);
    arc.position.set(x * W, 21 * H, 0);
    arc.rotation.set(0, Math.PI / 2, 0);
    gl.add(arc);
  }
  gl.add(BOX(M.white, 0, 22, 0, 312, 4, 86));
  for (let p = 0; p < piers; p++) {
    const x = -90 + p * 90;
    gl.add(BOX(M.glassW, x, 5, 70, 36, 12, 120));
    gl.add(BOX(M.white, x, 17, 70, 40, 3, 124));
    for (let b = 0; b < 4; b++) {
      const z = 36 + b * 24;
      gl.add(BOX(M.grayTile, x + 18, 11, z, 36, 4, 7));
    }
  }
  gl.add(CYL(M.white, 150, 0, -50, 6, 4.5, 60, 12));
  gl.add(CYL(M.glassW, 150, 60, -50, 11, 9, 12, 12));
  gl.add(CONE(M.steel, 150, 72, -50, 10, 8, 12));
  gl.userData.height = 84 * H;
  return gl;
}

/** 莘庄枢纽 · 公铁/地铁换乘中心 (高架站厅 + 双线轨道层) */
function xinzhuangHub() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 240, 5, 120));
  g.add(BOX(M.concrete, 0, 5, 0, 220, 10, 100));
  for (const s of [-1, 1]) {
    g.add(BOX(M.steel, 0, 22, s * 24, 240, 8, 18));
    for (let i = -5; i <= 5; i++) g.add(CYL(M.dark, i * 22, 15, s * 24, 1.2, 1.2, 7, 6));
  }
  g.add(BOX(M.glassW, 0, 30, 0, 216, 14, 80));
  g.add(BOX(M.white, 0, 44, 0, 224, 4, 88));
  for (const s of [-1, 1]) g.add(BOX(M.grayTile, s * 100, 5, 64, 50, 8, 16));
  g.userData.height = 52 * H;
  return g;
}

/** 上海东站 (在建) · 巨型双曲面拱顶站房 */
function shanghaiEastStation() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 360, 6, 140));
  g.add(BOX(M.stone, 0, 6, 0, 336, 14, 120));
  g.add(BOX(M.glassW, 0, 20, 0, 320, 20, 108));
  for (let k = -1; k <= 1; k += 2) {
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(36 * W, 36 * W, 320 * W, 28, 1, true, 0, Math.PI), M.steel);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(0, 40 * H, k * 30 * W);
    g.add(arch);
  }
  g.add(BOX(M.white, 0, 40, 0, 332, 6, 80));
  g.add(CYL(M.glassW, 0, 46, 0, 20, 12, 30, 24));
  g.add(DOME(M.glass, 0, 76, 0, 20, 14));
  g.userData.height = 96 * H;
  return g;
}

/** 上海西站 · 真如客运枢纽: 沪宁城际主线, 卧钟主立面 + 拱形屋架 + 钟塔顶 */
function shanghaiWestStation() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 320, 6, 100));
  g.add(BOX(M.stone, 0, 6, 0, 300, 18, 92));
  g.add(BOX(M.glassW, 0, 24, 0, 286, 14, 84));
  for (let i = -5; i <= 5; i++) {
    const x = i * 26;
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(22 * W, 22 * W, 86 * W, 18, 1, true, 0, Math.PI), M.steel);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(x * W, 38 * H, 0);
    g.add(arch);
  }
  g.add(BOX(M.white, 0, 38, 0, 296, 4, 92));
  // 中央卧钟塔 (西站标志, 类似大钟造型)
  g.add(BOX(M.grayTile, 0, 42, -52, 38, 38, 20));
  for (const s of [-1, 1]) g.add(CYL(M.white, s * 22, 0, -52, 4, 3, 50, 12));
  g.add(DOME(M.greenRoof, 0, 80, -52, 22, 12));
  g.add(SPH(M.gold, 0, 92, -52, 2.5));
  // 侧翼站台雨棚
  for (const s of [-1, 1]) {
    g.add(BOX(M.concrete, 0, 0, s * 68, 286, 9, 36));
    g.add(BOX(M.steel, 0, 14, s * 68, 270, 2.4, 38));
  }
  g.userData.height = 100 * H;
  return g;
}

/** 上海松江站 · 沪苏湖高铁枢纽: 双侧大跨度桁架 + 中央光廊 */
function shanghaiSongjiangStation() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 360, 6, 110));
  g.add(BOX(M.stone, 0, 6, 0, 340, 16, 100));
  g.add(BOX(M.glassW, 0, 22, 0, 326, 18, 92));
  g.add(BOX(M.white, 0, 40, 0, 332, 5, 30));
  g.add(CYL(M.glassW, 0, 45, 0, 18, 16, 28, 24));
  g.add(DOME(M.glass, 0, 73, 0, 18, 12));
  for (const sz of [-1, 1]) {
    for (let i = -5; i <= 5; i++) {
      const x = i * 30;
      const truss = new THREE.Mesh(
        new THREE.CylinderGeometry(18 * W, 18 * W, 92 * W, 16, 1, true, 0, Math.PI), M.steel);
      truss.rotation.z = Math.PI / 2;
      truss.position.set(x * W, 40 * H, sz * 36 * W);
      g.add(truss);
    }
  }
  for (const s of [-1, 1]) {
    g.add(BOX(M.concrete, 0, 0, s * 72, 320, 9, 38));
    g.add(BOX(M.steel, 0, 14, s * 72, 304, 2.4, 40));
  }
  g.userData.height = 88 * H;
  return g;
}

/** 上海北站 · 沪通方向, 普速/城际共用: 拱形屋架 + 双翼站台 */
function shanghaiNorthStation() {
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, 280, 6, 100));
  g.add(BOX(M.stone, 0, 6, 0, 260, 14, 90));
  g.add(BOX(M.glassW, 0, 20, 0, 248, 14, 84));
  for (let i = -4; i <= 4; i++) {
    const x = i * 28;
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(20 * W, 20 * W, 88 * W, 16, 1, true, 0, Math.PI), M.steel);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(x * W, 34 * H, 0);
    g.add(arch);
  }
  g.add(BOX(M.white, 0, 34, 0, 256, 4, 92));
  for (const s of [-1, 1]) {
    g.add(BOX(M.concrete, 0, 0, s * 66, 248, 9, 34));
    g.add(BOX(M.steel, 0, 14, s * 66, 234, 2.4, 36));
  }
  g.userData.height = 78 * H;
  return g;
}

/** 公铁换乘中心 · 高架换乘厅 + 中央光廊 + 四角引桥 (龙阳路 / 五角场 / 临港等) */
function transitCenter(opt = {}) {
  const L = opt.L || 220, D = opt.D || 100, HH = opt.h || 38;
  const g = new THREE.Group();
  g.add(BOX(M.granite, 0, 0, 0, L * 1.1, 6, D * 1.15));
  g.add(BOX(M.stone, 0, 6, 0, L, HH - 6, D));
  g.add(BOX(M.glassW, 0, HH, 0, L * 0.95, 4, D * 0.9));
  g.add(BOX(M.white, 0, HH + 4, 0, L * 1.04, 4, D * 0.95));
  g.add(CYL(M.glassW, 0, HH + 8, 0, D * 0.18, D * 0.14, 14, 20));
  g.add(DOME(M.glass, 0, HH + 22, 0, D * 0.18, 8));
  for (const [x, z] of [[-L * 0.55, 0], [L * 0.55, 0], [0, -D * 0.55], [0, D * 0.55]]) {
    g.add(BOX(M.concrete, x, 0, z, 30, 5, 30));
    g.add(BOX(M.steel, x * 1.1, 8, z * 1.1, 24, 4, 24));
  }
  g.userData.height = (HH + 30) * H;
  return g;
}

/** 里弄石库门 (张园/思南公馆式): 多排二层砖木住宅 + 石库门头 + 老虎窗 */
function lilongBlock() {
  const g = new THREE.Group();
  const brick = mk('#7d6a5c', { rough: 0.74, metal: 0.06, emi: '#2e2418', emiK: 0.42 });
  for (const zz of [-22, 0, 22]) {
    for (let i = -2; i <= 2; i++) {
      const x = i * 18;
      g.add(BOX(brick, x, 0, zz, 17, 11, 13));
      g.add(BOX(M.darkTile, x, 11, zz, 18, 1.4, 14));
      g.add(BOX(M.granite, x, 0, zz - 7.2, 6.5, 5.5, 1.4));
      g.add(BOX(M.terra, x, 5.5, zz - 7.2, 7.2, 1, 1.8));
      g.add(BOX(brick, x + 5, 12.4, zz, 5, 3, 4));
      g.add(BOX(M.darkTile, x + 5, 15.4, zz, 5.6, 1, 4.6));
    }
  }
  g.userData.height = 36 * H;
  return g;
}

/** 工业遗产改造 (1933老场坊/M50): 厚重混凝土 + 钢桁架 + 圆窗 + 烟囱 */
function industrialLoft() {
  const g = new THREE.Group();
  g.add(BOX(M.concrete, 0, 0, 0, 130, 26, 100));
  g.add(BOX(M.granite, 0, 26, 0, 134, 4, 104));
  // 外墙圆窗
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const win = new THREE.Mesh(new THREE.CircleGeometry(2.6 * W, 16), M.glassW);
    win.position.set((-52 + i * 26) * W, 14 * H, s * 51 * W);
    win.rotation.y = s > 0 ? Math.PI : 0;
    g.add(win);
  }
  // 顶部钢桁架
  for (let i = -3; i <= 3; i++) {
    g.add(STRUT(M.steel, i * 18, 30, -50, i * 18, 30, 50, 1.2));
  }
  g.add(BOX(M.steel, 0, 30, 0, 124, 1.6, 102));
  // 烟囱
  g.add(CYL(M.grayTile, 56, 0, 50, 5, 4, 38, 12));
  g.add(CYL(M.terra, 56, 38, 50, 4.5, 4.5, 3, 12));
  g.userData.height = 50 * H;
  return g;
}

/** 滨江筒仓改造 (民生码头八万吨筒仓): 8 座巨型圆筒 */
function cementSilos() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const x = -30 + i * 20, z = -18 + j * 36;
      g.add(CYL(M.concrete, x, 0, z, 8, 8.6, 38, 24));
      g.add(CYL(M.grayTile, x, 38, z, 8.6, 8.6, 3, 24));
    }
  }
  g.add(BOX(M.steel, 0, 42, 0, 86, 2, 42));
  g.userData.height = 50 * H;
  return g;
}

/** 公园 (复兴公园 / 鲁迅公园 / 中山公园): 草坪 + 林荫 + 中央水池 + 假山 */
function cityPark(opt = {}) {
  const W0 = (opt.w || 220), D0 = (opt.d || 160);
  const g = new THREE.Group();
  const grass = mk('#2e6b41', { rough: 0.9, metal: 0.02, emi: '#123020', emiK: 0.4 });
  g.add(BOX(grass, 0, 0.1, 0, W0, 0.1, D0));
  // 湖面 (略放大)
  g.add(BOX(M.water, -W0 * 0.16, 0.3, D0 * 0.08, W0 * 0.28, 0.05, D0 * 0.24));
  // v=37 精修: 林木改为"树干 + 树冠"并用确定性伪随机散布, 不再是 4 棵固定球
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.58 + rnd() * 0.40;                 // 偏外圈, 给中间留出草地
    const x = Math.cos(a) * W0 * rr * 0.5;
    const z = Math.sin(a) * D0 * rr * 0.5;
    const th = 5 + rnd() * 6, cr = 5 + rnd() * 4;
    g.add(CYL(M.wood, x, 0.2, z, 0.9, 0.7, th, 6));
    g.add(SPH(M.tree, x, 0.2 + th, z, cr));
  }
  // 林荫道
  for (let i = -2; i <= 2; i++) g.add(BOX(M.concrete, i * 40, 0.15, 0, 2.4, 0.05, D0 * 0.85));
  for (let j = -1; j <= 1; j++) g.add(BOX(M.concrete, 0, 0.15, j * 50, W0 * 0.85, 0.05, 2.4));
  // 湖心亭 (六角攒尖): 台基 + 6 柱 + 额枋 + 攒尖顶 + 宝顶
  const px = W0 * 0.24, pz = -D0 * 0.24;
  g.add(CYL(M.stone, px, 0.2, pz, 7, 7, 1.2, 6));
  for (let i = 0; i < 6; i++) {
    const a2 = i * 60 * D2R;
    g.add(CYL(M.wood, px + Math.cos(a2) * 5.4, 1.4, pz + Math.sin(a2) * 5.4, 0.5, 0.4, 5.8, 6));
  }
  g.add(CYL(M.redwall, px, 7.2, pz, 5.8, 5.2, 1.0, 6));
  g.add(CONE(M.grayTile, px, 8.2, pz, 6.4, 6, 6));
  g.add(CYL(M.gold, px, 14.2, pz, 0.5, 0.15, 2.4, 6));
  // 假山 + 花坛
  g.add(SPH(M.stone, -W0 * 0.22, 3, -D0 * 0.20, 7));
  g.add(BOX(mk('#c2456b', { rough: 0.8, metal: 0.05, emi: '#5a1f33', emiK: 0.5 }),
    W0 * 0.08, 0.4, D0 * 0.32, W0 * 0.16, 0.6, 16));
  g.userData.height = 18 * H;
  return g;
}

export const LANDMARK_DEFS = [
  // ---- 陆家嘴 ----
  { name: '东方明珠电视塔', sub: '468m · 广播电视塔', cat: '陆家嘴 · 天际线', color: '#ff8ec7', build: orientalPearl, lon: 121.4952, lat: 31.2419, tier: 1, r: 70 },
  { name: '上海中心大厦', sub: '632m · 中国第一高', cat: '陆家嘴 · 天际线', color: '#4fd6ff', build: shanghaiTower, lon: 121.5013, lat: 31.2356, tier: 1, r: 70 },
  { name: '金茂大厦', sub: '421m · 88层观光厅', cat: '陆家嘴 · 天际线', color: '#ffd166', build: jinmaoTower, lon: 121.5014, lat: 31.2373, tier: 1, r: 55 },
  { name: '上海环球金融中心', sub: '492m · 开瓶器', cat: '陆家嘴 · 天际线', color: '#9fd8ff', build: swfcTower, lon: 121.5030, lat: 31.2366, tier: 1, r: 60 },
  { name: '上海国际会议中心', sub: '双球 · 滨江地标', cat: '陆家嘴 · 天际线', color: '#7fb6e8', build: convCenter, lon: 121.4923, lat: 31.2416, tier: 2, r: 80 },
  { name: '浦东美术馆', sub: '清水混凝土 · 水镜厅', cat: '陆家嘴 · 天际线', color: '#dbe6f7', build: artMuseumBox, lon: 121.4920, lat: 31.2402, tier: 2, r: 60 },

  // ---- 外滩 ----
  { name: '江海关大楼', sub: '外滩 13 号 · 大钟', cat: '外滩 · 万国建筑', color: '#e8d5a8', build: customsHouse, lon: 121.4856, lat: 31.2386, tier: 2, r: 40 },
  { name: '前汇丰银行大楼', sub: '外滩 12 号 · 穹顶', cat: '外滩 · 万国建筑', color: '#e8d5a8', build: hsbcDome, lon: 121.4858, lat: 31.2380, tier: 2, r: 42 },
  { name: '和平饭店', sub: '沙逊大厦 · 绿色塔顶', cat: '外滩 · 万国建筑', color: '#5ef2a0', build: peaceHotel, lon: 121.4845, lat: 31.2411, tier: 2, r: 34 },
  { name: '外白渡桥', sub: '1907 · 钢桁架桥', cat: '外滩 · 万国建筑', color: '#c8d8e8', build: trussBridge, lon: 121.4857, lat: 31.2453, tier: 2, r: 40, rot: 0 },
  { name: '上海邮政博物馆', sub: '1924 · 巴洛克钟塔', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: postOffice, lon: 121.4808, lat: 31.2464, tier: 3, r: 42 },
  { name: '人民英雄纪念塔', sub: '外滩 · 三柱擎天', cat: '外滩 · 万国建筑', color: '#eef2f7', build: obelisk, lon: 121.4870, lat: 31.2443, tier: 3, r: 24 },

  // ---- 老城厢 ----
  { name: '豫园', sub: '明代江南园林', cat: '老城厢 · 园林寺庙', color: '#5ef2a0', build: chineseGarden, lon: 121.4878, lat: 31.2289, tier: 2, r: 120 },
  { name: '上海城隍庙', sub: '海上白云观 · 殿宇', cat: '老城厢 · 园林寺庙', color: '#ffd166', build: () => templeHall({ gold: true, wing: true }), lon: 121.4882, lat: 31.2279, tier: 2, r: 40 },
  { name: '沉香阁', sub: '明代楼阁 · 三重檐', cat: '老城厢 · 园林寺庙', color: '#e2a92c', build: () => pavilionTower({ w: 18 }), lon: 121.4856, lat: 31.2293, tier: 3, r: 22 },

  // ---- 寺庙古塔 ----
  { name: '静安寺', sub: '金瓦重檐 · 真言宗', cat: '寺庙 · 古塔', color: '#e2a92c', build: () => templeHall({ gold: true, w: 38, d: 26, wing: true }), lon: 121.4407, lat: 31.2254, tier: 2, r: 70 },
  { name: '玉佛禅寺', sub: '缅甸玉佛 · 宋式', cat: '寺庙 · 古塔', color: '#e2a92c', build: () => templeHall({ gold: true, w: 32, d: 22 }), lon: 121.4398, lat: 31.2436, tier: 3, r: 40 },
  { name: '龙华塔', sub: '七级八面 · 40.4m', cat: '寺庙 · 古塔', color: '#b4553a', build: () => pagoda(7, 40.4, 7), lon: 121.4473, lat: 31.1756, tier: 2, r: 18 },
  { name: '龙华寺', sub: '上海最古丛林', cat: '寺庙 · 古塔', color: '#a83f2c', build: () => templeHall({ w: 34, d: 22, wing: true }), lon: 121.4471, lat: 31.1771, tier: 3, r: 40 },
  { name: '南翔寺双塔', sub: '五代砖塔 · 11m', cat: '寺庙 · 古塔', color: '#b4553a', build: () => { const g = new THREE.Group(); const a = pagoda(7, 12, 2.2); a.position.x = -6 * W; const b = pagoda(7, 12, 2.2); b.position.x = 6 * W; g.add(a, b); g.userData.height = 22 * H; return g; }, lon: 121.3037, lat: 31.2930, tier: 3, r: 14 },

  // ---- 市中心 ----
  { name: '上海博物馆', sub: '方基圆顶 · 鼎形', cat: '人民广场 · 市中心', color: '#e6d9bd', build: shanghaiMuseum, lon: 121.4710, lat: 31.2302, tier: 2, r: 50 },
  { name: '上海大剧院', sub: '白色倒弧屋盖', cat: '人民广场 · 市中心', color: '#eef2f7', build: grandTheatre, lon: 121.4673, lat: 31.2315, tier: 2, r: 55 },
  { name: '国际饭店', sub: '83.8m · Art Deco', cat: '人民广场 · 市中心', color: '#a9a396', build: () => artDeco({ w: 22, d: 20, h: 134, tiers: 6 }), lon: 121.4670, lat: 31.2356, tier: 3, r: 22 },
  { name: '上海自然博物馆', sub: '螺旋壳体 · 下沉庭院', cat: '人民广场 · 市中心', color: '#d6ccb6', build: spiralMuseum, lon: 121.4580, lat: 31.2369, tier: 3, r: 55 },
  { name: '摩天轮', sub: '大悦城 · 屋顶转轮', cat: '人民广场 · 市中心', color: '#ff8ec7', build: () => ferrisWheel(24), lon: 121.4675, lat: 31.2466, tier: 3, r: 26 },
  { name: '武康大楼', sub: '1924 · 熨斗式公寓', cat: '人民广场 · 市中心', color: '#b4553a', build: wukangMansion, lon: 121.4337, lat: 31.2063, tier: 2, r: 50, rot: 30 },

  // ---- 滨江文化 ----
  { name: '中华艺术宫', sub: '世博中国馆 · 东方之冠', cat: '滨江 · 文化科教', color: '#c0342b', build: chinaPavilion, lon: 121.4899, lat: 31.1865, tier: 1, r: 90 },
  { name: '油罐艺术中心', sub: '航油罐改造', cat: '滨江 · 文化科教', color: '#eef2f7', build: oilTanks, lon: 121.4594, lat: 31.1665, tier: 3, r: 60 },
  { name: '龙美术馆（西岸馆）', sub: '清水混凝土伞拱', cat: '滨江 · 文化科教', color: '#c6c0b2', build: vaultGallery, lon: 121.4602, lat: 31.1859, tier: 3, r: 60 },
  { name: '西岸艺术中心', sub: '飞机制造厂改造', cat: '滨江 · 文化科教', color: '#c6c0b2', build: () => vaultGallery(), lon: 121.4570, lat: 31.1693, tier: 3, r: 55 },
  { name: '上海科技馆', sub: '玻璃球体 + 弧形展馆', cat: '滨江 · 文化科教', color: '#7fb6e8', build: scienceMuseum, lon: 121.5387, lat: 31.2219, tier: 2, r: 85 },
  { name: '上海天文馆', sub: '圆洞天窗 · 倒转穹顶', cat: '滨江 · 文化科教', color: '#cfe6f5', build: planetarium, lon: 121.9224, lat: 30.9152, tier: 2, r: 80 },

  // ---- 乐园 / 枢纽 ----
  { name: '奇幻童话城堡', sub: '上海迪士尼 · 主城堡', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: disneyCastle, lon: 121.6553, lat: 31.1457, tier: 1, r: 80 },
  { name: '上海欢乐谷', sub: '佘山 · 主题乐园', cat: '乐园 · 枢纽 · 郊野', color: '#ffd166', build: amusementPark, lon: 121.2103, lat: 31.0985, tier: 2, r: 80 },
  { name: '锦江乐园', sub: '摩天轮 · 老牌乐园', cat: '乐园 · 枢纽 · 郊野', color: '#ffd166', build: () => ferrisWheel(30), lon: 121.4042, lat: 31.1411, tier: 3, r: 34 },
  { name: '虹桥2号航站楼', sub: '波浪屋盖 + 塔台', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: airportTerminal, lon: 121.3198, lat: 31.1961, tier: 2, r: 170, rot: -12 },
  { name: '江湾体育场', sub: '1935 · 椭圆看台', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: stadium, lon: 121.5103, lat: 31.3081, tier: 3, r: 100 },
  { name: '佘山', sub: '天文台 + 双塔教堂', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: hillObservatory, lon: 121.2253, lat: 31.1068, tier: 2, r: 130 },
  { name: '广富林遗址', sub: '半沉水中的大屋顶', cat: '乐园 · 枢纽 · 郊野', color: '#b4553a', build: floatingRoofs, lon: 121.1905, lat: 31.0636, tier: 3, r: 90 },
  { name: '朱家角', sub: '江南水乡 · 放生桥', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.0439, lat: 31.1025, tier: 2, r: 120, rot: 20 },
  { name: '七宝古镇', sub: '蒲汇塘 · 老街', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.3501, lat: 31.1539, tier: 3, r: 120, rot: -10 },
  { name: '枫泾古镇', sub: '吴越交界水乡', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.0114, lat: 30.8894, tier: 3, r: 120, rot: 40 },
  { name: '新场古镇', sub: '盐运古镇 · 石驳岸', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.6419, lat: 31.0265, tier: 3, r: 120, rot: 5 },

  // ---- 徐家汇 / 淮海路 / 静安 商圈 ----
  { name: '上海图书馆', sub: '106m 双塔 · 淮海中路', cat: '人民广场 · 市中心', color: '#d6ccb6', build: () => twinTowers({ h: 106, w: 40, d: 34, gap: 62, podium: 30, pd: 88, taper: 0.12, segs: 3 }), lon: 121.4400, lat: 31.2092, tier: 3, r: 70 },
  { name: '环贸iapm广场', sub: 'iapm · 玻璃双塔 · 淮海中路', cat: '人民广场 · 市中心', color: '#9fd8ff', build: () => twinTowers({ h: 220, w: 44, d: 38, gap: 66, podium: 32, pd: 94, taper: 0.20, segs: 4 }), lon: 121.4525, lat: 31.2175, tier: 2, r: 66 },
  { name: '上海展览中心', sub: '中苏友好大厦 · 1955', cat: '人民广场 · 市中心', color: '#e6d9bd', build: expoCenter, lon: 121.4487, lat: 31.2262, tier: 2, r: 120 },
  { name: '上海环球港', sub: '48万㎡ · 248m 双塔', cat: '人民广场 · 市中心', color: '#eef2f7', build: mallDome, lon: 121.4079, lat: 31.2342, tier: 2, r: 130 },
  { name: '徐家汇天主教堂', sub: '圣依纳爵堂 · 哥特双塔', cat: '人民广场 · 市中心', color: '#e6d9bd', build: gothicChurch, lon: 121.4324, lat: 31.1930, tier: 2, r: 52, rot: 8 },
  { name: '港汇恒隆广场', sub: 'Grand Gateway 66 · 262m', cat: '人民广场 · 市中心', color: '#7fb6e8', build: () => twinTowers({ h: 262, w: 46, d: 40, gap: 72, podium: 34, pd: 98, taper: 0.22, segs: 5 }), lon: 121.4329, lat: 31.1963, tier: 2, r: 72 },
  { name: '美罗城', sub: '巨型玻璃球 · 徐家汇', cat: '人民广场 · 市中心', color: '#8fd0f0', build: () => globeBuilding({ r: 22 }), lon: 121.4356, lat: 31.1950, tier: 3, r: 40 },
  { name: '中共一大会址', sub: '兴业路 76 号 · 石库门', cat: '人民广场 · 市中心', color: '#b4553a', build: () => shikumenBlock({ annex: true }), lon: 121.4710, lat: 31.2218, tier: 3, r: 46 },

  // ---- 陆家嘴 / 北外滩 ----
  { name: '上海国金中心', sub: 'IFC · 双子塔 250 / 260m', cat: '陆家嘴 · 天际线', color: '#cfe6f5', build: ifcTowers, lon: 121.4975, lat: 31.2386, tier: 2, r: 92 },
  { name: '震旦国际大楼', sub: '180m · 江畔巨幅 LED 屏', cat: '陆家嘴 · 天际线', color: '#7ef7ff', build: ledTower, lon: 121.4953, lat: 31.2362, tier: 3, r: 42 },
  { name: '白玉兰广场', sub: '320m · 浦西第一高楼', cat: '陆家嘴 · 天际线', color: '#eef2f7', build: magnoliaPlaza, lon: 121.4940, lat: 31.2505, tier: 1, r: 80 },

  // ---- 文化 · 体育 · 会展 · 桥梁 ----
  { name: '东方艺术中心', sub: '五片花瓣 · 保罗·安德鲁', cat: '滨江 · 文化科教', color: '#eef2f7', build: petalHall, lon: 121.5385, lat: 31.2235, tier: 2, r: 82 },
  { name: '梅赛德斯-奔驰文化中心', sub: '世博飞碟 · 18000 座', cat: '滨江 · 文化科教', color: '#9fd8ff', build: discArena, lon: 121.4896, lat: 31.1908, tier: 2, r: 72 },
  { name: '上海体育场', sub: '八万人 · 白色大罩棚', cat: '滨江 · 文化科教', color: '#dfe6ee', build: () => canopyStadium({ R: 126, rIn: 74 }), lon: 121.4378, lat: 31.1832, tier: 2, r: 120 },
  { name: '虹口足球场', sub: '3.5 万座 · 专业足球场', cat: '滨江 · 文化科教', color: '#5ef2a0', build: footballStadium, lon: 121.4766, lat: 31.2729, tier: 3, r: 110 },
  { name: '上海马戏城', sub: '金顶杂技场 · 时空之旅', cat: '滨江 · 文化科教', color: '#e2a92c', build: () => circusDome({ r: 27 }), lon: 121.4474, lat: 31.2794, tier: 3, r: 56 },
  { name: '国家会展中心', sub: '四叶草 · 世界最大展馆', cat: '滨江 · 文化科教', color: '#cfe6f5', build: cloverExpo, lon: 121.2990, lat: 31.1914, tier: 2, r: 230 },
  { name: '卢浦大桥', sub: '2003 · 主跨 550m 钢拱桥', cat: '滨江 · 文化科教', color: '#c8d8e8', build: () => archBridge({ span: 550, rise: 100, deck: 26 }), lon: 121.4808, lat: 31.1894, tier: 2, r: 380, rot: 8 },

  // ---- 铁路枢纽 ----
  { name: '上海南站', sub: '圆形玻璃站房 · 2006', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: () => railStation({ round: true, R: 96 }), lon: 121.4278, lat: 31.1544, tier: 2, r: 120 },
  { name: '上海西站', sub: '沪宁城际 · 卧钟主立面', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: shanghaiWestStation, lon: 121.3981, lat: 31.2647, tier: 2, r: 110, rot: -6 },
  { name: '上海松江站', sub: '沪苏湖高铁 · 巨型桁架', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: shanghaiSongjiangStation, lon: 121.2265, lat: 30.9845, tier: 2, r: 130 },
  { name: '上海北站', sub: '沪通方向 · 普速/城际', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: shanghaiNorthStation, lon: 121.4540, lat: 31.2620, tier: 2, r: 110 },
  { name: '宝山站', sub: '沪渝蓉高铁 · 在建', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: () => transitCenter({ L: 220, D: 90, h: 32 }), lon: 121.4890, lat: 31.4050, tier: 3, r: 110 },
  { name: '崇明站', sub: '沪渝蓉高铁 · 长江过江', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: () => transitCenter({ L: 200, D: 80, h: 30 }), lon: 121.4010, lat: 31.6220, tier: 3, r: 110 },
  { name: '临港新片区', sub: '滴水湖 · 自贸港', cat: '乐园 · 枢纽 · 郊野', color: '#7fb6e8', build: () => transitCenter({ L: 240, D: 100, h: 36 }), lon: 121.9270, lat: 30.9010, tier: 3, r: 140 },
  { name: '龙阳路枢纽', sub: '磁浮 + 2/7/16号线', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: () => transitCenter({ L: 220, D: 90, h: 36 }), lon: 121.5530, lat: 31.2090, tier: 2, r: 110 },
  { name: '五角场枢纽', sub: '10号线 + 公交枢纽', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: () => transitCenter({ L: 180, D: 80, h: 28 }), lon: 121.5140, lat: 31.2990, tier: 2, r: 100 },

  // ---- 综合交通枢纽 (重点客站 / 机场) ----
  { name: '虹桥综合交通枢纽', sub: '虹桥站 · 空铁联运', cat: '乐园 · 枢纽 · 郊野', color: '#4fd6ff', build: hongqiaoHub, lon: 121.3200, lat: 31.1940, tier: 1, r: 200 },
  { name: '上海站', sub: '京沪/沪宁始发 · 钟塔站房', cat: '乐园 · 枢纽 · 郊野', color: '#ffd166', build: shanghaiRailwayStation, lon: 121.4555, lat: 31.2490, tier: 1, r: 130 },
  { name: '上海东站', sub: '沪通/沪乍杭 · 在建特大火车站', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: shanghaiEastStation, lon: 121.8080, lat: 31.1320, tier: 2, r: 180 },
  { name: '莘庄枢纽', sub: '1/5号线 + 公交换乘', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: xinzhuangHub, lon: 121.3880, lat: 31.1120, tier: 2, r: 130 },
  { name: '虹桥国际机场', sub: 'T1 航站楼 · 国内', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: () => airportTerminalBig({ piers: 2 }), lon: 121.3344, lat: 31.1979, tier: 2, r: 180, rot: -8 },
  { name: '浦东国际机场', sub: 'T1/T2 · 亚太航空枢纽', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: () => airportTerminalBig({ piers: 4 }), lon: 121.8053, lat: 31.1440, tier: 2, r: 260, rot: 28 },

  // ---- 郊野 / 公园 ----
  { name: '上海动物园', sub: '74 公顷 · 西郊公园', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: zooPark, lon: 121.3599, lat: 31.1938, tier: 3, r: 190 },
  { name: '古猗园', sub: '明代园林 · 南翔', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.3120, lat: 31.2938, tier: 3, r: 86 },
  { name: '碧海金沙', sub: '奉贤海湾 · 人工沙滩', cat: '乐园 · 枢纽 · 郊野', color: '#ffd166', build: beachPark, lon: 121.5689, lat: 30.8245, tier: 3, r: 200 },
  { name: '东滩湿地公园', sub: '崇明 · 候鸟栖息地', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: wetlandPark, lon: 121.9455, lat: 31.5198, tier: 3, r: 220 },
  { name: '上海海昌海洋公园', sub: '滴水湖畔 · 海洋主题', cat: '乐园 · 枢纽 · 郊野', color: '#4fd6ff', build: oceanPark, lon: 121.9022, lat: 30.9140, tier: 2, r: 160 },

  // ---- 里弄 / 石库门 / 工业遗产 / 城市公园 ----
  { name: '张园', sub: '茂名北路 · 石库门里弄', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4640, lat: 31.2290, tier: 2, r: 60 },
  { name: '思南公馆', sub: '复兴中路 · 花园洋房', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4690, lat: 31.2120, tier: 2, r: 70 },
  { name: '步高里', sub: '陕西南路 · 1930 石库门', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4620, lat: 31.2160, tier: 3, r: 50 },
  { name: '荣宅', sub: '陕西北路 · 1918 巨宅', cat: '人民广场 · 市中心', color: '#e6d9bd', build: wukangMansion, lon: 121.4670, lat: 31.2340, tier: 3, r: 36 },
  { name: '四行仓库', sub: '光复路 · 1935 · 抗战遗址', cat: '人民广场 · 市中心', color: '#c6c0b2', build: industrialLoft, lon: 121.4730, lat: 31.2370, tier: 3, r: 50 },
  { name: '1933老场坊', sub: '溧阳路 · 1933 宰牲场改造', cat: '滨江 · 文化科教', color: '#c6c0b2', build: industrialLoft, lon: 121.4840, lat: 31.2570, tier: 2, r: 55 },
  { name: 'M50创意园', sub: '莫干山路 · 纺织厂改造', cat: '滨江 · 文化科教', color: '#c6c0b2', build: industrialLoft, lon: 121.4470, lat: 31.2540, tier: 3, r: 50 },
  { name: '民生码头八万吨筒仓', sub: '民生路 · 亚洲最大筒仓', cat: '滨江 · 文化科教', color: '#eef2f7', build: cementSilos, lon: 121.5100, lat: 31.2440, tier: 2, r: 60 },
  { name: '复兴公园', sub: '复兴中路 · 法式园林', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 220, d: 160 }), lon: 121.4720, lat: 31.2210, tier: 2, r: 100 },
  { name: '鲁迅公园', sub: '四川北路 · 大陆新村', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 160 }), lon: 121.4830, lat: 31.2770, tier: 2, r: 100 },
  { name: '中山公园', sub: '长宁路 · 百年公园', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 240, d: 180 }), lon: 121.4190, lat: 31.2210, tier: 2, r: 120 },
  { name: '和平公园', sub: '虹口 · 鲁迅路旁', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 140 }), lon: 121.4860, lat: 31.2710, tier: 3, r: 90 },
  { name: '徐家汇公园', sub: '肇嘉浜路 · 城市绿肺', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 120 }), lon: 121.4380, lat: 31.1990, tier: 3, r: 80 },
  { name: '静安公园', sub: '南京西路 · 都市绿洲', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.4480, lat: 31.2270, tier: 3, r: 70 },
  { name: '上海博物馆东馆', sub: '杨高南路 · 2024 开放', cat: '滨江 · 文化科教', color: '#e6d9bd', build: shanghaiMuseum, lon: 121.5260, lat: 31.1860, tier: 2, r: 80 },
  { name: '上海图书馆东馆', sub: '迎春路 · 2022 开放', cat: '滨江 · 文化科教', color: '#cfe6f5', build: () => twinTowers({ h: 86, w: 40, d: 36, gap: 56, podium: 22, pd: 92, taper: 0.10, segs: 3 }), lon: 121.5320, lat: 31.2160, tier: 2, r: 70 },
  { name: '世博文化中心', sub: '世博大道 · 央企总部', cat: '滨江 · 文化科教', color: '#9fd8ff', build: discArena, lon: 121.4900, lat: 31.1840, tier: 2, r: 80 },

  // ---- 外滩 / 南京路 / 淮海路 历史建筑 ----
  { name: '大世界', sub: '西藏中路 · 1917 · 游乐场', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco(), lon: 121.4790, lat: 31.2320, tier: 2, r: 40 },
  { name: '上海音乐厅', sub: '延安东路 · 1930 · 罗马式', cat: '人民广场 · 市中心', color: '#e6d9bd', build: () => grandTheatre(), lon: 121.4790, lat: 31.2280, tier: 2, r: 45 },
  { name: '大光明电影院', sub: '南京西路 · 1928 · 装饰艺术', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco(), lon: 121.4660, lat: 31.2330, tier: 3, r: 36 },
  { name: '沐恩堂', sub: '西藏中路 · 1931 · 哥特复兴', cat: '寺庙 · 古塔', color: '#e6d9bd', build: () => gothicChurch(), lon: 121.4790, lat: 31.2340, tier: 3, r: 36 },
  { name: '圣三一堂', sub: '九江路 · 1869 · 红砖哥特', cat: '寺庙 · 古塔', color: '#b4553a', build: () => gothicChurch(), lon: 121.4820, lat: 31.2360, tier: 3, r: 34 },
  { name: '国泰电影院', sub: '淮海中路 · 1932 · Art Deco', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco(), lon: 121.4600, lat: 31.2190, tier: 3, r: 32 },
  { name: '兰心大戏院', sub: '茂名南路 · 1931', cat: '人民广场 · 市中心', color: '#e6d9bd', build: () => grandTheatre(), lon: 121.4620, lat: 31.2170, tier: 3, r: 34 },

  // ---- 里弄 / 石库门 (续) ----
  { name: '静安别墅', sub: '南京西路 · 1928 新式里弄', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4520, lat: 31.2270, tier: 3, r: 55 },
  { name: '尚贤坊', sub: '淮海中路 · 1921 石库门', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4660, lat: 31.2200, tier: 3, r: 45 },
  { name: '建业里', sub: '建国西路 · 1930 石库门', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4510, lat: 31.2090, tier: 3, r: 50 },

  // ---- 商业地标 / 摩天楼 ----
  { name: '恒隆广场', sub: '南京西路 · 288m 双塔', cat: '人民广场 · 市中心', color: '#cfe6f5', build: () => twinTowers({ h: 288, w: 48, d: 42, gap: 76, podium: 36, pd: 104, taper: 0.22, segs: 5 }), lon: 121.4490, lat: 31.2280, tier: 2, r: 72 },
  { name: '静安嘉里中心', sub: '南京西路 · 260m', cat: '人民广场 · 市中心', color: '#9fd8ff', build: () => twinTowers({ h: 260, w: 46, d: 40, gap: 70, podium: 34, pd: 98, taper: 0.20, segs: 4 }), lon: 121.4460, lat: 31.2260, tier: 2, r: 68 },
  { name: '兴业太古汇', sub: '南京西路 · 250m', cat: '人民广场 · 市中心', color: '#7fb6e8', build: () => twinTowers({ h: 250, w: 44, d: 38, gap: 66, podium: 32, pd: 94, taper: 0.20, segs: 4 }), lon: 121.4540, lat: 31.2300, tier: 2, r: 64 },
  { name: '正大广场', sub: '陆家嘴 · 滨江商业', cat: '陆家嘴 · 天际线', color: '#ff8ec7', build: () => mallDome(), lon: 121.4980, lat: 31.2410, tier: 3, r: 70 },

  // ---- 体育 / 文博 / 工业改造 ----
  { name: '上海赛车场', sub: '嘉定 · F1 中国大奖赛', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: () => canopyStadium({ R: 130, rIn: 78 }), lon: 121.2200, lat: 31.3370, tier: 2, r: 150 },
  { name: '东方体育中心', sub: '浦东 · 水上运动中心', cat: '滨江 · 文化科教', color: '#9fd8ff', build: () => canopyStadium({ R: 118, rIn: 70 }), lon: 121.4970, lat: 31.1610, tier: 2, r: 120 },
  { name: '上海海洋水族馆', sub: '陆家嘴 · 155m 海底隧道', cat: '陆家嘴 · 天际线', color: '#4fd6ff', build: () => oceanPark(), lon: 121.4980, lat: 31.2430, tier: 3, r: 55 },
  { name: '上海当代艺术博物馆', sub: '黄浦滨江 · 原南市发电厂', cat: '滨江 · 文化科教', color: '#c6c0b2', build: industrialLoft, lon: 121.4860, lat: 31.1920, tier: 2, r: 70 },
  { name: '上海历史博物馆', sub: '南京西路 · 原跑马总会', cat: '人民广场 · 市中心', color: '#e6d9bd', build: () => shanghaiMuseum(), lon: 121.4690, lat: 31.2330, tier: 3, r: 50 },
  { name: '十六铺码头', sub: '外滩 · 水上旅游中心', cat: '外滩 · 万国建筑', color: '#5ef2a0', build: () => convCenter(), lon: 121.4910, lat: 31.2320, tier: 3, r: 70 },

  // ---- 公园 / 郊野 (补) ----
  { name: '上海世纪公园', sub: '浦东花木 · 140 公顷', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 300, d: 240 }), lon: 121.5527, lat: 31.2197, tier: 3, r: 230 },
  { name: '上海野生动物园', sub: '南汇 · 153 公顷', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: zooPark, lon: 121.7079, lat: 31.0459, tier: 3, r: 240 },
  { name: '顾村公园', sub: '宝山 · 樱花胜地', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 280, d: 220 }), lon: 121.4000, lat: 31.3500, tier: 3, r: 200 },
  { name: '大宁灵石公园', sub: '静安 · 人工湖', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 220, d: 180 }), lon: 121.4500, lat: 31.2800, tier: 3, r: 160 },
  { name: '共青森林公园', sub: '杨浦 · 131 公顷', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: zooPark, lon: 121.5300, lat: 31.3100, tier: 3, r: 200 },

  // ---- 高校 ----
  { name: '复旦大学', sub: '邯郸校区 · 1905', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.5030, lat: 31.2980, tier: 3, r: 170 },
  { name: '上海交通大学', sub: '徐汇校区 · 1896', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.4320, lat: 31.2000, tier: 3, r: 150 },
  { name: '同济大学', sub: '四平路 · 1907', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.5000, lat: 31.2840, tier: 3, r: 150 },
  { name: '华东师范大学', sub: '中山北路校区', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.4000, lat: 31.2280, tier: 3, r: 140 },

  // ---- 场馆 / 寺庙 ----
  { name: '真如寺', sub: '普陀 · 元代木构大殿', cat: '寺庙 · 古塔', color: '#a83f2c', build: () => templeHall({ w: 30, d: 22, wing: true }), lon: 121.3900, lat: 31.2540, tier: 3, r: 70 },
  { name: '上海城市规划展示馆', sub: '人民大道 · 城模', cat: '人民广场 · 市中心', color: '#9fd8ff', build: globeBuilding, lon: 121.4737, lat: 31.2320, tier: 3, r: 60 },
  { name: '上海外滩美术馆', sub: '外滩源 · 原亚洲文会', cat: '外滩 · 万国建筑', color: '#e8d5a8', build: () => artDeco({ w: 20, d: 18, h: 40, tiers: 3, spire: false }), lon: 121.4840, lat: 31.2420, tier: 3, r: 45 },
  { name: '上海国际舞蹈中心', sub: '长宁虹桥路', cat: '滨江 · 文化科教', color: '#ff8ec7', build: petalHall, lon: 121.3900, lat: 31.2000, tier: 3, r: 70 },
  { name: '浦东图书馆', sub: '前程路 · 巨型"书"形', cat: '滨江 · 文化科教', color: '#d6ccb6', build: vaultGallery, lon: 121.5400, lat: 31.1800, tier: 3, r: 60 },
  { name: '上海玻璃博物馆', sub: '宝山 · 旧玻璃厂改造', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4400, lat: 31.3200, tier: 3, r: 60 },
  { name: '上海汽车博物馆', sub: '嘉定 · 汽车博览公园', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.2900, lat: 31.2900, tier: 3, r: 70 },
  { name: '上海儿童博物馆', sub: '长宁宋园路', cat: '滨江 · 文化科教', color: '#ffd166', build: scienceMuseum, lon: 121.4100, lat: 31.1950, tier: 3, r: 50 },
  { name: '宋庆龄故居', sub: '淮海西路 1843 号', cat: '滨江 · 文化科教', color: '#e6d9bd', build: shikumenBlock, lon: 121.4350, lat: 31.2050, tier: 3, r: 45 },

  // ---- 2026 扩展: 以精模覆盖更多网红景点 / 城市绿地 (自动抑制其周边通用模型) ----
  { name: '上海植物园', sub: '龙吴路 · 1974 建园', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 240, d: 190 }), lon: 121.4375, lat: 31.1620, tier: 3, r: 200 },
  { name: '上海辰山植物园', sub: '松江 · 矿坑花园', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 420, d: 360 }), lon: 121.1770, lat: 31.0800, tier: 3, r: 320 },
  { name: '上海新天地', sub: '兴业路 · 石库门时尚街区', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4704, lat: 31.2218, tier: 2, r: 100 },
  { name: '上海田子坊', sub: '泰康路 · 弄堂创意街区', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4641, lat: 31.2102, tier: 2, r: 60 },
  { name: '上海醉白池', sub: '松江 · 上海五大古典园林', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.2280, lat: 31.0030, tier: 3, r: 90 },
  { name: '上海方塔园', sub: '松江 · 宋塔 + 照壁', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.2330, lat: 31.0020, tier: 3, r: 90 },
  { name: '滨江森林公园', sub: '浦东高桥 · 长江口', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 320, d: 260 }), lon: 121.5450, lat: 31.3800, tier: 3, r: 220 },

  // ---- 2026 v=28 扩展: 再补一批精模, 进一步抑制通用网红景点 ----
  { name: '长风公园', sub: '普陀 · 银锄湖 + 铁臂山', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 260, d: 200 }), lon: 121.3980, lat: 31.2240, tier: 3, r: 160 },
  { name: '蓬莱公园', sub: '黄浦 · 老城厢绿地', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.4840, lat: 31.2240, tier: 3, r: 70 },
  { name: '古城公园', sub: '黄浦 · 人民公园旁', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 130, d: 100 }), lon: 121.4790, lat: 31.2350, tier: 3, r: 70 },
  { name: '外滩源', sub: '圆明园路 · 近代外滩起点', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: lilongBlock, lon: 121.4910, lat: 31.2440, tier: 3, r: 80 },
  { name: '多伦路文化名人街', sub: '虹口 · 近代名人故居群', cat: '滨江 · 文化科教', color: '#b4553a', build: lilongBlock, lon: 121.4880, lat: 31.2700, tier: 3, r: 90 },
  { name: '召稼楼古镇', sub: '闵行 · 钟楼广场', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.5180, lat: 31.0840, tier: 3, r: 130, rot: 12 },
  { name: '南翔古镇', sub: '嘉定 · 双塔 + 古猗园旁', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.3120, lat: 31.2940, tier: 3, r: 110, rot: -15 },
  { name: '上海影视乐园', sub: '松江 · 车墩老上海街景', cat: '乐园 · 枢纽 · 郊野', color: '#c6c0b2', build: lilongBlock, lon: 121.3020, lat: 30.9830, tier: 3, r: 140 },
  { name: '上海音乐学院', sub: '汾阳路 · 歌剧与民乐', cat: '滨江 · 文化科教', color: '#e6d9bd', build: () => artDeco({ w: 24, d: 20, h: 40, tiers: 3, spire: false }), lon: 121.4490, lat: 31.2110, tier: 3, r: 36 },
  { name: '上海大学', sub: '宝山 · 延长校区', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.3940, lat: 31.3280, tier: 3, r: 150 },
  { name: '上海海事大学', sub: '临港 · 海运摇篮', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.8880, lat: 30.9110, tier: 3, r: 150 },
  { name: '上海师范大学', sub: '徐汇 · 桂林路校区', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.4080, lat: 31.1810, tier: 3, r: 140 },
  { name: '上海理工大学', sub: '杨浦 · 军工路校区', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.5470, lat: 31.2980, tier: 3, r: 140 },
  { name: '上海应用技术大学', sub: '奉贤 · 海泉路', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.5300, lat: 30.9540, tier: 3, r: 130 },
  { name: '上海第二工业大学', sub: '浦东 · 金海路', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.7310, lat: 31.1530, tier: 3, r: 110 },
  { name: '上海工程技术大学', sub: '松江 · 龙腾路', cat: '滨江 · 文化科教', color: '#c9b8e8', build: vaultGallery, lon: 121.2300, lat: 31.0490, tier: 3, r: 130 },
  { name: '上海纽约大学', sub: '陆家嘴 · 前滩', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.5180, lat: 31.1710, tier: 3, r: 50 },
  { name: '吴淞炮台湾国家湿地公园', sub: '宝山 · 长江口湿地', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 240, d: 200 }), lon: 121.5100, lat: 31.4080, tier: 3, r: 180 },
  { name: '秋霞圃', sub: '嘉定 · 明代园林', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.2540, lat: 31.3750, tier: 3, r: 80 },

  // ---- v=29 继续扩展: 再补 25 处, 进一步覆盖网红景点 ----
  { name: '人民公园', sub: '黄浦 · 南京西路旁', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 160 }), lon: 121.4750, lat: 31.2310, tier: 3, r: 110 },
  { name: '延中公园', sub: '黄浦 · 黄河路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 90 }), lon: 121.4710, lat: 31.2300, tier: 3, r: 60 },
  { name: '丽园公园', sub: '黄浦 · 丽园路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4780, lat: 31.2140, tier: 3, r: 50 },
  { name: '南园公园', sub: '黄浦 · 陆家浜路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 90 }), lon: 121.4830, lat: 31.2150, tier: 3, r: 60 },
  { name: '人民广场', sub: '黄浦 · 上海市中心地标', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 240, d: 200 }), lon: 121.4750, lat: 31.2330, tier: 3, r: 170 },
  { name: '静安雕塑公园', sub: '静安 · 石门一路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 100 }), lon: 121.4520, lat: 31.2300, tier: 3, r: 60 },
  { name: '不夜城绿地', sub: '闸北 · 上海站旁', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 90 }), lon: 121.4570, lat: 31.2490, tier: 3, r: 60 },
  { name: '闸北公园', sub: '闸北 · 共和新路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 140 }), lon: 121.4600, lat: 31.2540, tier: 3, r: 90 },
  { name: '霍山公园', sub: '浦东 · 洋泾浜', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.5320, lat: 31.2360, tier: 3, r: 40 },
  { name: '上南公园', sub: '浦东 · 上南路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 80 }), lon: 121.5120, lat: 31.1800, tier: 3, r: 60 },
  { name: '金桥公园', sub: '浦东 · 金桥镇', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 100 }), lon: 121.5990, lat: 31.2620, tier: 3, r: 70 },
  { name: '张江科学公园', sub: '浦东 · 张江高科', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 120 }), lon: 121.5970, lat: 31.2070, tier: 3, r: 80 },
  { name: '滴水湖', sub: '临港 · 圆形人工湖', cat: '人民广场 · 市中心', color: '#7fb6e8', build: mallDome, lon: 121.9270, lat: 30.9020, tier: 3, r: 160 },
  { name: '中国航海博物馆', sub: '临港 · 帆体建筑', cat: '滨江 · 文化科教', color: '#cfe6f5', build: () => archBridge({ span: 80, rise: 30, deck: 10 }), lon: 121.9250, lat: 30.8880, tier: 3, r: 100 },
  { name: '上海国际赛车场', sub: '嘉定 · F1 赛道', cat: '滨江 · 文化科教', color: '#c6c0b2', build: () => canopyStadium({ R: 160, rIn: 90 }), lon: 121.2200, lat: 31.3370, tier: 3, r: 200 },
  { name: '上海国际医学园区', sub: '浦东 · 周邓路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.6420, lat: 31.1830, tier: 3, r: 110 },
  { name: '上海鲜花港', sub: '浦东 · 书院镇', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: () => cityPark({ w: 200, d: 160 }), lon: 121.7020, lat: 30.9540, tier: 3, r: 140 },
  { name: '书院人家', sub: '浦东 · 书院镇', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: lilongBlock, lon: 121.7100, lat: 30.9350, tier: 3, r: 60 },
  { name: '芦潮港', sub: '浦东 · 临港新城', cat: '乐园 · 枢纽 · 郊野', color: '#7fb6e8', build: () => transitCenter({ L: 200, D: 80, h: 28 }), lon: 121.8610, lat: 30.8640, tier: 3, r: 80 },
  { name: '南汇桃花村', sub: '浦东 · 惠南镇', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: () => cityPark({ w: 160, d: 120 }), lon: 121.7480, lat: 31.0540, tier: 3, r: 100 },
  { name: '上海滨海高尔夫', sub: '奉贤 · 滨海', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 200 }), lon: 121.6900, lat: 30.8500, tier: 3, r: 140 },
  { name: '奉贤海湾园', sub: '奉贤 · 海湾镇', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 120 }), lon: 121.6200, lat: 30.8900, tier: 3, r: 100 },
  { name: '青浦环城水系', sub: '青浦 · 淀山湖畔', cat: '乐园 · 枢纽 · 郊野', color: '#5fd6be', build: waterTown, lon: 121.1300, lat: 31.1500, tier: 3, r: 200, rot: 25 },
  { name: '重固古镇', sub: '青浦 · 重固镇', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.1820, lat: 31.2000, tier: 3, r: 80, rot: 18 },

  // ---- v=30 再扩 30+ 处, 进一步覆盖网红景点, 并精修 boxTower + 一两个老 builder ----
  { name: '曹杨新村', sub: '普陀 · 中国第一个工人新村', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4070, lat: 31.2400, tier: 3, r: 80 },
  { name: '长风生态商务区', sub: '普陀 · 长风公园旁', cat: '人民广场 · 市中心', color: '#9fd8ff', build: artMuseumBox, lon: 121.4000, lat: 31.2220, tier: 3, r: 70 },
  { name: 'M50 创意园', sub: '普陀 · 莫干山路', cat: '滨江 · 文化科教', color: '#c6c0b2', build: industrialLoft, lon: 121.4470, lat: 31.2540, tier: 3, r: 60 },
  { name: '苏州河梦清园', sub: '普陀 · 苏州河边', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.4380, lat: 31.2500, tier: 3, r: 60 },
  { name: '长寿路绿地', sub: '普陀 · 长寿路口', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4400, lat: 31.2380, tier: 3, r: 50 },
  { name: '普陀公园', sub: '普陀 · 光复西路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 90 }), lon: 121.4120, lat: 31.2400, tier: 3, r: 55 },
  { name: '宜川公园', sub: '普陀 · 宜川路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.4400, lat: 31.2600, tier: 3, r: 40 },
  { name: '彭浦公园', sub: '闸北 · 彭浦新村', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 70 }), lon: 121.4580, lat: 31.3120, tier: 3, r: 50 },
  { name: '五角场下沉广场', sub: '杨浦 · 政通路', cat: '人民广场 · 市中心', color: '#9fd8ff', build: mallDome, lon: 121.5140, lat: 31.2990, tier: 3, r: 80 },
  { name: '黄兴公园', sub: '杨浦 · 内江路口', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 120 }), lon: 121.5240, lat: 31.2940, tier: 3, r: 80 },
  { name: '杨浦公园', sub: '杨浦 · 控江路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.5210, lat: 31.2780, tier: 3, r: 70 },
  { name: '复兴岛公园', sub: '杨浦 · 复兴岛', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.5640, lat: 31.2840, tier: 3, r: 50 },
  { name: '内江公园', sub: '杨浦 · 内江路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 60, d: 50 }), lon: 121.5180, lat: 31.2860, tier: 3, r: 40 },
  { name: '惠民公园', sub: '浦东 · 浦东大道', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 60, d: 50 }), lon: 121.5280, lat: 31.2520, tier: 3, r: 40 },
  { name: '临沂公园', sub: '浦东 · 临沂路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.5300, lat: 31.2060, tier: 3, r: 40 },
  { name: '南浦广场公园', sub: '黄浦 · 陆家浜路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.4860, lat: 31.2090, tier: 3, r: 50 },
  { name: '日晖绿地', sub: '徐汇 · 零陵路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.4570, lat: 31.1920, tier: 3, r: 40 },
  { name: '东安公园', sub: '徐汇 · 东安路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.4580, lat: 31.1970, tier: 3, r: 70 },
  { name: '漕河泾开发区公园', sub: '徐汇 · 古美路口', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4040, lat: 31.1760, tier: 3, r: 60 },
  { name: '上海南站绿地', sub: '徐汇 · 上海南站', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 80 }), lon: 121.4290, lat: 31.1550, tier: 3, r: 60 },
  { name: '锦江乐园绿地', sub: '徐汇 · 虹梅路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 70 }), lon: 121.4040, lat: 31.1420, tier: 3, r: 50 },
  { name: '华泾公园', sub: '徐汇 · 华泾路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4500, lat: 31.1140, tier: 3, r: 60 },
  { name: '长桥绿地', sub: '徐汇 · 长桥路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 60 }), lon: 121.4400, lat: 31.1380, tier: 3, r: 50 },
  { name: '康健园', sub: '徐汇 · 桂林路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 130, d: 90 }), lon: 121.4190, lat: 31.1680, tier: 3, r: 70 },
  { name: '新虹桥中心花园', sub: '长宁 · 娄山关路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 80 }), lon: 121.4020, lat: 31.2080, tier: 3, r: 60 },
  { name: '天原公园', sub: '长宁 · 凯旋路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.4220, lat: 31.2200, tier: 3, r: 50 },
  { name: '哈雷绿地', sub: '闵行 · 哈雷路口', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4040, lat: 31.1300, tier: 3, r: 60 },
  { name: '莘庄公园', sub: '闵行 · 莘庄', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.3860, lat: 31.1100, tier: 3, r: 50 },

  // ---- v=31 再扩 30+ 处, 进一步覆盖网红景点 ----
  { name: '三泉公园', sub: '闸北 · 三泉路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.4540, lat: 31.2700, tier: 3, r: 50 },
  { name: '岭南公园', sub: '闵行 · 莘庄', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 50 }), lon: 121.3920, lat: 31.1080, tier: 3, r: 45 },
  { name: '莘城公园', sub: '闵行 · 莘城', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.3790, lat: 31.1150, tier: 3, r: 40 },
  { name: '吴泾公园', sub: '闵行 · 吴泾', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.4520, lat: 31.0420, tier: 3, r: 60 },
  { name: '浦江郊野公园', sub: '闵行 · 浦江镇', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 160 }), lon: 121.5200, lat: 31.0770, tier: 3, r: 120 },
  { name: '纪王公园', sub: '嘉定 · 纪王镇', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 60 }), lon: 121.2300, lat: 31.2600, tier: 3, r: 50 },
  { name: '江桥公园', sub: '嘉定 · 江桥镇', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 80 }), lon: 121.3500, lat: 31.2580, tier: 3, r: 60 },
  { name: '南翔公园', sub: '嘉定 · 南翔', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 50 }), lon: 121.3150, lat: 31.2950, tier: 3, r: 50 },
  { name: '徐行公园', sub: '嘉定 · 徐行镇', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 50 }), lon: 121.2520, lat: 31.3800, tier: 3, r: 45 },
  { name: '华亭人家', sub: '嘉定 · 华亭镇', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.2700, lat: 31.4350, tier: 3, r: 70, rot: 18 },
  { name: '浏岛度假村', sub: '嘉定 · 浏河', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.2700, lat: 31.4200, tier: 3, r: 80 },
  { name: '月罗园', sub: '宝山 · 月浦', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 60 }), lon: 121.4300, lat: 31.4200, tier: 3, r: 50 },
  { name: '罗店公园', sub: '宝山 · 罗店', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 70 }), lon: 121.3950, lat: 31.4100, tier: 3, r: 60 },
  { name: '美兰湖', sub: '宝山 · 罗店', cat: '乐园 · 枢纽 · 郊野', color: '#5fd6be', build: () => cityPark({ w: 200, d: 140 }), lon: 121.4000, lat: 31.4150, tier: 3, r: 120 },
  { name: '顾村公园东园', sub: '宝山 · 顾村东', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 100 }), lon: 121.4200, lat: 31.3500, tier: 3, r: 90 },
  { name: '宝山滨江公园', sub: '宝山 · 滨江', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 50 }), lon: 121.5050, lat: 31.4150, tier: 3, r: 80 },
  { name: '智慧湾科创园', sub: '宝山 · 智慧湾', cat: '滨江 · 文化科教', color: '#9fd8ff', build: industrialLoft, lon: 121.4900, lat: 31.4000, tier: 3, r: 80 },
  { name: '智慧岛公园', sub: '崇明 · 城桥', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 80 }), lon: 121.3950, lat: 31.6200, tier: 3, r: 70 },
  { name: '崇明西沙湿地', sub: '崇明 · 西沙', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 140 }), lon: 121.4300, lat: 31.6600, tier: 3, r: 120 },
  { name: '明珠湖', sub: '崇明 · 西部', cat: '乐园 · 枢纽 · 郊野', color: '#5fd6be', build: () => cityPark({ w: 200, d: 160 }), lon: 121.3500, lat: 31.7000, tier: 3, r: 120 },
  { name: '东平国家森林公园', sub: '崇明 · 中北部', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 280, d: 220 }), lon: 121.4900, lat: 31.6800, tier: 3, r: 180 },
  { name: '海湾国家森林公园', sub: '奉贤 · 海湾', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 280, d: 200 }), lon: 121.6700, lat: 30.8800, tier: 3, r: 160 },
  { name: '申隆生态园', sub: '奉贤 · 庄行', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 140 }), lon: 121.3800, lat: 30.9600, tier: 3, r: 100 },
  { name: '奉贤中央公园', sub: '奉贤 · 南桥', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 100 }), lon: 121.4750, lat: 30.9200, tier: 3, r: 80 },
  { name: '青浦曲水园', sub: '青浦 · 城中', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.1250, lat: 31.1500, tier: 3, r: 70 },
  { name: '青西郊野公园', sub: '青浦 · 青西', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 280, d: 220 }), lon: 121.0500, lat: 31.1000, tier: 3, r: 200 },
  { name: '东方绿舟', sub: '青浦 · 朱家角西', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 280, d: 200 }), lon: 121.0700, lat: 31.1000, tier: 3, r: 200 },
  { name: '金泽古镇', sub: '青浦 · 金泽', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.0300, lat: 31.0800, tier: 3, r: 100, rot: 20 },
  { name: '练塘古镇', sub: '青浦 · 练塘', cat: '乐园 · 枢纽 · 郊野', color: '#e6d9bd', build: waterTown, lon: 121.0700, lat: 31.0000, tier: 3, r: 90, rot: 15 },
  { name: '松江方塔', sub: '松江 · 中山中路', cat: '乐园 · 枢纽 · 郊野', color: '#a83f2c', build: () => pagoda(7, 48, 9), lon: 121.2210, lat: 31.0010, tier: 3, r: 30 },
  { name: '松江醉白池', sub: '松江 · 人民南路', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: classicalGarden, lon: 121.2300, lat: 31.0020, tier: 3, r: 60 },
  { name: '西佘山园', sub: '松江 · 佘山', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 160 }), lon: 121.2100, lat: 31.0960, tier: 3, r: 120 },
  { name: '月湖公园', sub: '松江 · 月湖', cat: '乐园 · 枢纽 · 郊野', color: '#5fd6be', build: () => cityPark({ w: 180, d: 120 }), lon: 121.2300, lat: 31.0900, tier: 3, r: 100 },
  { name: '松江中央公园', sub: '松江 · 思贤路', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 100 }), lon: 121.2200, lat: 31.0280, tier: 3, r: 80 },
  { name: '佘山月湖雕塑公园', sub: '松江 · 月湖', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.2300, lat: 31.0850, tier: 3, r: 80 },
  { name: '金山城市沙滩', sub: '金山 · 石化', cat: '乐园 · 枢纽 · 郊野', color: '#7fb6e8', build: () => cityPark({ w: 180, d: 60 }), lon: 121.3300, lat: 30.7100, tier: 3, r: 100 },
  { name: '金山公园', sub: '金山 · 蒙山路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.3500, lat: 30.9100, tier: 3, r: 80 },
  { name: '廊下郊野公园', sub: '金山 · 廊下', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 160 }), lon: 121.1900, lat: 30.8200, tier: 3, r: 120 },
  { name: '吕巷水果公园', sub: '金山 · 吕巷', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 100 }), lon: 121.2500, lat: 30.8600, tier: 3, r: 80 },

  // ---- v=32 再扩 25+ 处, 进一步覆盖网红景点 ----
  { name: '上海动物园东园', sub: '长宁 · 西郊', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 120, d: 90 }), lon: 121.3650, lat: 31.1980, tier: 3, r: 80 },
  { name: '水霞公园', sub: '长宁 · 水城路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.3830, lat: 31.2240, tier: 3, r: 50 },
  { name: '延西绿地', sub: '长宁 · 延西路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 60 }), lon: 121.4070, lat: 31.2180, tier: 3, r: 50 },
  { name: '华山绿地', sub: '长宁 · 华山路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 70 }), lon: 121.4300, lat: 31.2160, tier: 3, r: 50 },
  { name: '周桥绿地', sub: '长宁 · 周家桥', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.4080, lat: 31.2090, tier: 3, r: 40 },
  { name: '古羊绿地', sub: '闵行 · 古羊路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.3900, lat: 31.2000, tier: 3, r: 40 },
  { name: '华江绿地', sub: '嘉定 · 华江路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.3320, lat: 31.2500, tier: 3, r: 40 },
  { name: '翔江绿地', sub: '嘉定 · 翔江公路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 70, d: 50 }), lon: 121.3400, lat: 31.2800, tier: 3, r: 40 },
  { name: '宝山烈士陵园', sub: '宝山 · 友谊路', cat: '滨江 · 文化科教', color: '#a83f2c', build: () => cityPark({ w: 140, d: 100 }), lon: 121.4940, lat: 31.4050, tier: 3, r: 80 },
  { name: '上海犹太难民纪念馆', sub: '虹口 · 提篮桥', cat: '滨江 · 文化科教', color: '#e6d9bd', build: () => artDeco({ w: 20, d: 16, h: 32, tiers: 2, spire: false }), lon: 121.4960, lat: 31.2520, tier: 3, r: 40 },
  { name: '下海庙', sub: '虹口 · 昆明路', cat: '滨江 · 文化科教', color: '#a83f2c', build: () => templeHall({ w: 26, d: 20 }), lon: 121.4890, lat: 31.2580, tier: 3, r: 30 },
  { name: '上海犹太公园', sub: '虹口 · 霍山路', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 50 }), lon: 121.4910, lat: 31.2580, tier: 3, r: 50 },
  { name: '鲁迅故居', sub: '虹口 · 山阴路', cat: '滨江 · 文化科教', color: '#b4553a', build: shikumenBlock, lon: 121.4860, lat: 31.2730, tier: 3, r: 30 },
  { name: '李白烈士故居', sub: '虹口 · 黄渡路', cat: '滨江 · 文化科教', color: '#b4553a', build: shikumenBlock, lon: 121.4870, lat: 31.2720, tier: 3, r: 25 },
  { name: '世纪公园西园', sub: '浦东 · 花木', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 160 }), lon: 121.5500, lat: 31.2190, tier: 3, r: 130 },
  { name: '汤臣高尔夫', sub: '浦东 · 龙阳路', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 140 }), lon: 121.5700, lat: 31.1900, tier: 3, r: 100 },
  { name: '前滩友城公园', sub: '浦东 · 前滩', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 140, d: 80 }), lon: 121.5280, lat: 31.1700, tier: 3, r: 80 },
  { name: '三林绿地', sub: '浦东 · 三林', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 80 }), lon: 121.5100, lat: 31.1530, tier: 3, r: 60 },
  { name: '周浦绿地', sub: '浦东 · 周浦', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 80 }), lon: 121.5710, lat: 31.1200, tier: 3, r: 60 },
  { name: '航头绿地', sub: '浦东 · 航头', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 100, d: 70 }), lon: 121.6300, lat: 31.0400, tier: 3, r: 60 },
  { name: '老港绿地', sub: '浦东 · 老港', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.7000, lat: 31.0400, tier: 3, r: 50 },
  { name: '书院绿地', sub: '浦东 · 书院', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.7100, lat: 30.9350, tier: 3, r: 50 },
  { name: '宣桥绿地', sub: '浦东 · 宣桥', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.6800, lat: 31.0400, tier: 3, r: 50 },

  // ---- v=34 扩展: 补一批高人气"网红景点"精模, 就近抑制其通用建模 (坐标取自 attractions.json) ----
  { name: '南京东路', sub: '黄浦 · 中华商业第一街', cat: '人民广场 · 市中心', color: '#ffd166', build: () => pedestrianStreet({ L: 340, W: 46 }), lon: 121.4802, lat: 31.2403, tier: 2, r: 60 },
  { name: '上海文庙', sub: '黄浦 · 儒学宫 · 魁星阁', cat: '老城厢 · 园林寺庙', color: '#e2a92c', build: () => templeHall({ w: 34, d: 24, wing: true }), lon: 121.4834, lat: 31.2201, tier: 2, r: 42 },
  { name: '小南门警钟楼', sub: '黄浦 · 清末救火钟楼', cat: '老城厢 · 园林寺庙', color: '#b4553a', build: () => pavilionTower({ w: 12 }), lon: 121.4934, lat: 31.2179, tier: 3, r: 18 },
  { name: '上海铁路博物馆', sub: '静安 · 老沪宁铁路总局', cat: '人民广场 · 市中心', color: '#c6c0b2', build: industrialLoft, lon: 121.4718, lat: 31.2520, tier: 3, r: 50 },
  { name: '五卅运动纪念碑', sub: '黄浦 · 五卅惨案纪念', cat: '人民广场 · 市中心', color: '#ffd166', build: obelisk, lon: 121.4686, lat: 31.2357, tier: 3, r: 18 },
  { name: '世博会博物馆', sub: '黄浦 · 世博园区', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4776, lat: 31.1964, tier: 3, r: 90 },
  { name: '中国共产党第二次全国代表大会会址', sub: '静安 · 老成都北路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4621, lat: 31.2262, tier: 3, r: 40 },
  { name: '法租界会审公廨旧址', sub: '黄浦 · 建国中路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4649, lat: 31.2119, tier: 3, r: 40 },
  { name: '后滩', sub: '浦东 · 滨江湿地', cat: '滨江 · 文化科教', color: '#5ef2a0', build: () => cityPark({ w: 160, d: 120 }), lon: 121.4694, lat: 31.1741, tier: 3, r: 90 },
  { name: '林肯爵士乐上海中心', sub: '黄浦 · 外滩源', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: () => artDeco({ w: 20, d: 18, h: 40, tiers: 3, spire: false }), lon: 121.4824, lat: 31.2401, tier: 3, r: 30 },
  { name: '上海当代艺术馆', sub: '黄浦 · 人民公园内', cat: '人民广场 · 市中心', color: '#9fd8ff', build: artMuseumBox, lon: 121.4682, lat: 31.2333, tier: 3, r: 40 },
  { name: 'Fotografiska影像艺术中心', sub: '静安 · 苏州河畔', cat: '人民广场 · 市中心', color: '#cfe6f5', build: artMuseumBox, lon: 121.4653, lat: 31.2417, tier: 3, r: 40 },
  { name: '外滩中心', sub: '黄浦 · 延安东路 · 双塔写字楼', cat: '外滩 · 万国建筑', color: '#9fd8ff', build: () => twinTowers({ h: 180, w: 44, d: 38, gap: 60, podium: 30, pd: 90, taper: 0.18, segs: 4 }), lon: 121.4831, lat: 31.2345, tier: 3, r: 55 },
  { name: '上海总商会旧址', sub: '静安 · 北苏州路', cat: '人民广场 · 市中心', color: '#c6c0b2', build: industrialLoft, lon: 121.4776, lat: 31.2450, tier: 3, r: 50 },
  { name: '外滩花园酒店', sub: '黄浦 · 外滩源', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: () => artDeco({ w: 22, d: 18, h: 40, tiers: 3, spire: false }), lon: 121.4814, lat: 31.2382, tier: 3, r: 40 },
  { name: '和平影都', sub: '黄浦 · 南京西路', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco({ w: 20, d: 18, h: 48, tiers: 4, spire: false }), lon: 121.4717, lat: 31.2346, tier: 3, r: 30 },
  { name: '刘海粟美术馆', sub: '长宁 · 延安西路', cat: '人民广场 · 市中心', color: '#c6c0b2', build: artMuseumBox, lon: 121.4146, lat: 31.2114, tier: 3, r: 50 },
  { name: '中国社会主义青年团中央机关旧址', sub: '黄浦 · 淮海中路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4638, lat: 31.2220, tier: 3, r: 40 },
  { name: '上海琉璃艺术博物馆', sub: '黄浦 · 泰康路', cat: '人民广场 · 市中心', color: '#8fd0f0', build: artMuseumBox, lon: 121.4658, lat: 31.2098, tier: 3, r: 40 },
  { name: '中共中央政治局机关旧址', sub: '黄浦 · 云南中路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4732, lat: 31.2335, tier: 3, r: 35 },
  { name: '1933 Time Travel Youth Hotel', sub: '虹口 · 沙泾路 · 青年旅舍', cat: '滨江 · 文化科教', color: '#c6c0b2', build: industrialLoft, lon: 121.4797, lat: 31.2407, tier: 3, r: 40 },
  { name: 'A.F.A上海融侨中心', sub: '长宁 · 淮海西路', cat: '人民广场 · 市中心', color: '#c6c0b2', build: artMuseumBox, lon: 121.4195, lat: 31.2010, tier: 3, r: 60 },
  { name: '上海市历史博物馆', sub: '黄浦 · 南京西路 · 原跑马总会', cat: '人民广场 · 市中心', color: '#e6d9bd', build: artMuseumBox, lon: 121.4666, lat: 31.2326, tier: 3, r: 50 },
  { name: '尹奉吉义举现场', sub: '虹口 · 鲁迅公园', cat: '人民广场 · 市中心', color: '#ffd166', build: obelisk, lon: 121.4790, lat: 31.2748, tier: 3, r: 18 },
  { name: 'OCAT上海馆', sub: '静安 · 苏河湾', cat: '人民广场 · 市中心', color: '#9fd8ff', build: artMuseumBox, lon: 121.4685, lat: 31.2436, tier: 3, r: 35 },
  { name: '上海外滩W酒店', sub: '虹口 · 北外滩', cat: '外滩 · 万国建筑', color: '#9fd8ff', build: () => twinTowers({ h: 140, w: 40, d: 34, gap: 54, podium: 26, pd: 86, taper: 0.16, segs: 4 }), lon: 121.4920, lat: 31.2509, tier: 3, r: 45 },
  { name: '上海市文史研究馆', sub: '黄浦 · 思南路', cat: '人民广场 · 市中心', color: '#e6d9bd', build: artMuseumBox, lon: 121.4657, lat: 31.2123, tier: 3, r: 35 },
  { name: '刘海粟旧居', sub: '黄浦 · 复兴中路', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4669, lat: 31.2176, tier: 3, r: 35 },
  { name: '武康路', sub: '徐汇 · 百年梧桐街', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4345, lat: 31.2080, tier: 3, r: 80 },
  { name: '吴昌硕纪念馆', sub: '浦东 · 陆家嘴', cat: '陆家嘴 · 天际线', color: '#e6d9bd', build: artMuseumBox, lon: 121.5025, lat: 31.2388, tier: 3, r: 30 },
  { name: '一大会址·黄陂南路', sub: '黄浦 · 老渔阳里', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4693, lat: 31.2249, tier: 3, r: 40 },

  // ---- v=35 继续扩展: 补齐剩余高人气景点 (坐标取自 attractions.json, 就近抑制通用建模) ----
  { name: '上海迪士尼度假区', sub: '浦东 · 主题度假区', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: amusementPark, lon: 121.6621, lat: 31.1434, tier: 2, r: 160 },
  { name: '东方乐器博物馆', sub: '徐汇 · 高安路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4399, lat: 31.2054, tier: 3, r: 35 },
  { name: '中共中央与中央军委联络点旧址', sub: '黄浦 · 湖州会馆', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4755, lat: 31.2340, tier: 3, r: 30 },
  { name: '舞动广场', sub: '浦东 · 世博源', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 90, d: 70 }), lon: 121.4779, lat: 31.1844, tier: 3, r: 40 },
  { name: '一大会址·新天地', sub: '黄浦 · 新天地广场', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4698, lat: 31.2179, tier: 3, r: 40 },
  { name: '邬达克纪念馆', sub: '长宁 · 番禺路 · 国际饭店设计者', cat: '人民广场 · 市中心', color: '#b4553a', build: () => artDeco({ w: 18, d: 16, h: 32, tiers: 2, spire: false }), lon: 121.4254, lat: 31.2099, tier: 3, r: 35 },
  { name: '大韩民国临时政府旧址', sub: '黄浦 · 马当路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4702, lat: 31.2192, tier: 3, r: 30 },
  { name: '屋里厢石库门博物馆', sub: '黄浦 · 新天地 · 石库门民居', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4702, lat: 31.2219, tier: 3, r: 30 },
  { name: '洛克·外滩源', sub: '虹口 · 圆明园路 · 历史建筑群', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: lilongBlock, lon: 121.4834, lat: 31.2441, tier: 3, r: 60 },
  { name: '蜂巢当代艺术中心', sub: '静安 · 莫干山路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4804, lat: 31.2426, tier: 3, r: 30 },
  { name: '外滩中央广场', sub: '黄浦 · 滨江公共空间', cat: '外滩 · 万国建筑', color: '#5ef2a0', build: () => cityPark({ w: 80, d: 60 }), lon: 121.4829, lat: 31.2397, tier: 3, r: 35 },
  { name: '总工会旧址', sub: '静安 · 中北西路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4658, lat: 31.2555, tier: 3, r: 30 },

  // ---- v=37 继续扩展: 再补一批高人气景点 (坐标取自 attractions.json) ----
  { name: '上海迪士尼乐园', sub: '浦东 · 七大主题园区', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: amusementPark, lon: 121.6562, lat: 31.1463, tier: 2, r: 140 },
  { name: '五卅惨案纪念地', sub: '黄浦 · 南京东路', cat: '人民广场 · 市中心', color: '#ffd166', build: obelisk, lon: 121.4823, lat: 31.2401, tier: 3, r: 18 },
  { name: '和平饭店南楼', sub: '黄浦 · 外滩 19 号', cat: '外滩 · 万国建筑', color: '#e6d9bd', build: () => artDeco({ w: 26, d: 22, h: 48, tiers: 3, spire: false }), lon: 121.4848, lat: 31.2406, tier: 3, r: 30 },
  { name: '罗斯福公馆', sub: '黄浦 · 外滩 27 号', cat: '外滩 · 万国建筑', color: '#e8d5a8', build: () => artDeco({ w: 22, d: 20, h: 48, tiers: 4, spire: false }), lon: 121.4853, lat: 31.2424, tier: 3, r: 30 },
  { name: '上海杜莎夫人蜡像馆', sub: '黄浦 · 南京西路', cat: '人民广场 · 市中心', color: '#ffd166', build: artMuseumBox, lon: 121.4690, lat: 31.2365, tier: 3, r: 30 },
  { name: '第一美术馆', sub: '黄浦 · 绍兴路', cat: '人民广场 · 市中心', color: '#9fd8ff', build: artMuseumBox, lon: 121.4673, lat: 31.2122, tier: 3, r: 30 },
  { name: '蔡元培故居', sub: '静安 · 华山路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4420, lat: 31.2234, tier: 3, r: 60 },

  // ---- v=38 继续扩展: 再补一批高人气景点, 就近抑制通用建模, 让精模覆盖更全 ----
  { name: '上海交响乐团音乐厅', sub: '徐汇 · 复兴中路', cat: '滨江 · 文化科教', color: '#cfe6f5', build: artMuseumBox, lon: 121.4630, lat: 31.2100, tier: 3, r: 35 },
  { name: '中国证券博物馆', sub: '虹口 · 浦江饭店', cat: '外滩 · 万国建筑', color: '#e8d5a8', build: () => artDeco({ w: 26, d: 22, h: 64, tiers: 4, dome: true }), lon: 121.4950, lat: 31.2480, tier: 3, r: 30 },
  { name: '上海科学会堂', sub: '黄浦 · 南昌路', cat: '人民广场 · 市中心', color: '#e6d9bd', build: () => artDeco({ w: 30, d: 22, h: 32, tiers: 2, spire: false }), lon: 121.4700, lat: 31.2150, tier: 3, r: 35 },
  { name: '田子坊', sub: '黄浦 · 泰康路 · 文创里弄', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4660, lat: 31.2070, tier: 3, r: 48 },

  /* ================= v=39 新增: 覆盖尚未被精模替代的高分网红景点 ================= */
  /* --- 博物馆 / 美术馆 --- */
  { name: '上海纺织博物馆', sub: '普陀 · 澳门路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4415, lat: 31.2486, tier: 3, r: 42 },
  { name: '上海造币博物馆', sub: '普陀 · 光复西路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: () => artDeco({ w: 26, d: 20, h: 40, tiers: 3, dome: true }), lon: 121.4322, lat: 31.2510, tier: 3, r: 42 },
  { name: '上海公安博物馆', sub: '徐汇 · 瑞金南路', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4638, lat: 31.2004, tier: 3, r: 42 },
  { name: '春美术馆', sub: '黄浦 · 福州路', cat: '人民广场 · 市中心', color: '#c77dff', build: artMuseumBox, lon: 121.4742, lat: 31.2340, tier: 3, r: 34 },
  { name: '上海工艺美术博物馆', sub: '徐汇 · 汾阳路 · 小白宫', cat: '滨江 · 文化科教', color: '#9fd8ff', build: () => artDeco({ w: 24, d: 20, h: 32, tiers: 2, dome: true }), lon: 121.4499, lat: 31.2122, tier: 3, r: 44 },
  { name: '西岸美术馆', sub: '徐汇 · 龙腾大道 · 蓬皮杜合作', cat: '滨江 · 文化科教', color: '#9fd8ff', build: vaultGallery, lon: 121.4593, lat: 31.1696, tier: 2, r: 62 },
  { name: '苏州河展示中心', sub: '普陀 · 梦清馆', cat: '滨江 · 文化科教', color: '#9fd8ff', build: artMuseumBox, lon: 121.4353, lat: 31.2515, tier: 3, r: 36 },
  { name: '上海宣传画艺术中心', sub: '长宁 · 江苏路', cat: '滨江 · 文化科教', color: '#c77dff', build: artMuseumBox, lon: 121.4294, lat: 31.2173, tier: 3, r: 32 },
  { name: '中共四大纪念馆', sub: '静安 · 多伦路', cat: '人民广场 · 市中心', color: '#ffd166', build: artMuseumBox, lon: 121.4804, lat: 31.2572, tier: 3, r: 40 },
  { name: '韬奋纪念馆', sub: '黄浦 · 重庆南路', cat: '人民广场 · 市中心', color: '#ffd166', build: artMuseumBox, lon: 121.4667, lat: 31.2163, tier: 3, r: 32 },
  /* --- 寺庙 / 纪念地 --- */
  { name: '玉佛寺', sub: '普陀 · 安远路 · 玉佛坐像', cat: '寺庙 · 古塔', color: '#e2a92c', build: () => templeHall({ gold: true, w: 40, d: 26 }), lon: 121.4402, lat: 31.2441, tier: 2, r: 62 },
  { name: '宋庆龄陵园', sub: '长宁 · 陵园路', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 180, d: 140 }), lon: 121.4057, lat: 31.1969, tier: 2, r: 92 },
  /* --- 名人故居 (石库门 / 里弄) --- */
  { name: '毛泽东旧居', sub: '静安 · 茂名北路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4559, lat: 31.2283, tier: 3, r: 32 },
  { name: '刘长胜故居', sub: '静安 · 愚园路', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4418, lat: 31.2266, tier: 3, r: 32 },
  { name: '上海徐志摩旧居', sub: '黄浦 · 南昌路', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4634, lat: 31.2211, tier: 3, r: 32 },
  { name: '霞飞坊旧址', sub: '徐汇 · 淮海中路', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4553, lat: 31.2185, tier: 3, r: 36 },
  /* --- 商业综合体 / 塔楼 --- */
  { name: '前滩太古里', sub: '浦东 · 前滩 · 开放式商业', cat: '陆家嘴 · 天际线', color: '#9ec7ff', build: mallDome, lon: 121.4772, lat: 31.1548, tier: 2, r: 90 },
  { name: '北外滩来福士广场', sub: '虹口 · 东大名路', cat: '陆家嘴 · 天际线', color: '#9ec7ff', build: twinTowers, lon: 121.5029, lat: 31.2547, tier: 2, r: 88 },
  { name: '浦东海关大楼', sub: '浦东 · 滨江大道', cat: '陆家嘴 · 天际线', color: '#9fd8ff', build: () => artDeco({ w: 22, d: 20, h: 60, tiers: 4 }), lon: 121.4943, lat: 31.2398, tier: 3, r: 50 },
  { name: '五角场彩蛋', sub: '杨浦 · 五角场环岛', cat: '乐园 · 枢纽 · 郊野', color: '#ff8ec7', build: discArena, lon: 121.5112, lat: 31.3021, tier: 2, r: 78 },
  /* --- 街区 / 历史建筑 --- */
  { name: '南京路步行街', sub: '黄浦 · 中华商业第一街', cat: '人民广场 · 市中心', color: '#ff8ec7', build: () => pedestrianStreet({ L: 520, W: 46 }), lon: 121.4752, lat: 31.2381, tier: 1, r: 120 },
  { name: '上海古城墙遗址', sub: '黄浦 · 大境阁 · 明代城墙', cat: '老城厢 · 园林寺庙', color: '#e2a92c', build: () => pavilionTower({ w: 20 }), lon: 121.4798, lat: 31.2292, tier: 3, r: 40 },
  { name: '公共租界总巡捕房旧址', sub: '黄浦 · 福州路 185 号', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 26, d: 20, h: 40, tiers: 3, spire: false }), lon: 121.4822, lat: 31.2367, tier: 3, r: 40 },

  /* ================= v=40 新增 ================= */
  { name: '上海文化广场', sub: '徐汇 · 复兴中路 · 下沉式剧场', cat: '滨江 · 文化科教', color: '#ffd166', build: grandTheatre, lon: 121.4577, lat: 31.2138, tier: 2, r: 78 },
  { name: '上海世博展览馆', sub: '浦东 · 国展路 · 大跨展厅', cat: '滨江 · 文化科教', color: '#9fd8ff', build: expoCenter, lon: 121.4855, lat: 31.1845, tier: 2, r: 110 },
  { name: '中国劳动组合书记部旧址', sub: '静安 · 成都北路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4592, lat: 31.2398, tier: 3, r: 34 },
  { name: '新青年编辑部旧址', sub: '黄浦 · 南昌路 · 渔阳里', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4643, lat: 31.2214, tier: 3, r: 34 },
  { name: '程十发美术馆', sub: '长宁 · 虹桥路', cat: '滨江 · 文化科教', color: '#c77dff', build: artMuseumBox, lon: 121.4003, lat: 31.1993, tier: 3, r: 38 },
  { name: '龙华烈士陵园', sub: '徐汇 · 龙华西路 · 纪念园区', cat: '乐园 · 枢纽 · 郊野', color: '#5ef2a0', build: () => cityPark({ w: 200, d: 150 }), lon: 121.4444, lat: 31.1786, tier: 2, r: 100 },
  { name: '原英国驻上海总领事馆', sub: '虹口 · 外白渡桥北堍', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 32, d: 22, h: 24, tiers: 2, spire: false }), lon: 121.4846, lat: 31.2444, tier: 3, r: 44 },
  { name: '公共租界工部局旧址', sub: '黄浦 · 汉口路 193 号', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 34, d: 24, h: 48, tiers: 3, spire: false }), lon: 121.4823, lat: 31.2379, tier: 3, r: 40 },
  { name: '沈尹默故居', sub: '虹口 · 海伦路', cat: '人民广场 · 市中心', color: '#b4553a', build: lilongBlock, lon: 121.4829, lat: 31.2605, tier: 3, r: 32 },

  /* ================= v=41 新增: 外滩历史建筑带 + 遗漏场馆 ================= */
  { name: '外滩18号', sub: '黄浦 · 麦加利银行大楼 · 1924', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 18, h: 48, tiers: 4 }), lon: 121.4850, lat: 31.2403, tier: 3, r: 26 },
  { name: '外滩五号', sub: '黄浦 · 日清大楼 · 1925', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 22, d: 18, h: 48, tiers: 4 }), lon: 121.4861, lat: 31.2364, tier: 3, r: 26 },
  { name: '华安大楼', sub: '黄浦 · 南京西路 · 华侨饭店', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco({ w: 22, d: 20, h: 60, tiers: 5 }), lon: 121.4682, lat: 31.2361, tier: 3, r: 30 },
  { name: '原西侨青年会', sub: '黄浦 · 南京西路 · 体育大厦', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco({ w: 20, d: 18, h: 48, tiers: 4, spire: false }), lon: 121.4675, lat: 31.2356, tier: 3, r: 28 },
  { name: '上海大自然野生昆虫馆', sub: '浦东 · 陆家嘴滨江', cat: '乐园 · 枢纽 · 郊野', color: '#9fd8ff', build: artMuseumBox, lon: 121.4934, lat: 31.2424, tier: 3, r: 30 },
  { name: '上海幻觉艺术博物馆', sub: '黄浦 · 外滩 · 视错觉展馆', cat: '滨江 · 文化科教', color: '#c77dff', build: artMuseumBox, lon: 121.4823, lat: 31.2391, tier: 3, r: 30 },

  /* ================= v=43 新增: 外滩历史建筑带收尾 + 名人纪念 ================= */
  { name: '外滩六号', sub: '黄浦 · 中国通商银行大楼 · 1906', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 18, h: 44, tiers: 4, spire: false }), lon: 121.4861, lat: 31.2367, tier: 3, r: 24 },
  { name: '大新百货大楼', sub: '黄浦 · 南京东路 · 老字号', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 22, d: 18, h: 48, tiers: 4, spire: false }), lon: 121.4703, lat: 31.2369, tier: 3, r: 28 },
  { name: '新永安大楼', sub: '黄浦 · 南京东路 · 华侨饭店', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 18, h: 44, tiers: 4, spire: false }), lon: 121.4743, lat: 31.2371, tier: 3, r: 26 },
  { name: '华商纱布交易所旧址', sub: '黄浦 · 汉口路', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 16, h: 36, tiers: 3, spire: false }), lon: 121.4828, lat: 31.2333, tier: 3, r: 26 },
  { name: '老闸捕房旧址', sub: '黄浦 · 南京东路', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 16, h: 36, tiers: 3, spire: false }), lon: 121.4712, lat: 31.2379, tier: 3, r: 26 },
  { name: '虹口救火会', sub: '虹口 · 吴淞路 · 老消防站', cat: '外滩 · 万国建筑', color: '#ffd166', build: () => artDeco({ w: 20, d: 16, h: 40, tiers: 3, spire: false }), lon: 121.4834, lat: 31.2554, tier: 3, r: 28 },
  { name: '上海中华职业教育社', sub: '黄浦 · 雁荡路 · 历史社团', cat: '人民广场 · 市中心', color: '#ffd166', build: () => artDeco({ w: 18, d: 16, h: 32, tiers: 2, spire: false }), lon: 121.4650, lat: 31.2215, tier: 3, r: 28 },
  { name: '田汉故居', sub: '静安 · 山海关路', cat: '人民广场 · 市中心', color: '#b4553a', build: shikumenBlock, lon: 121.4475, lat: 31.2191, tier: 3, r: 30 },
  /* ================= v=45 新增(收尾): 剩余真实场馆/绿地 ================= */
  { name: 'SNH48星梦剧院', sub: '虹口 · 嘉兴路 · 剧场改造', cat: '滨江 · 文化科教', color: '#ffd166', build: industrialLoft, lon: 121.4859, lat: 31.2587, tier: 3, r: 30 },
  { name: '仰贤堂', sub: '浦东 · 川沙 · 临河宅邸', cat: '人民广场 · 市中心', color: '#9fd8ff', build: artMuseumBox, lon: 121.5796, lat: 31.3476, tier: 3, r: 28 },
  { name: '新天地太平湖', sub: '黄浦 · 新天地 · 人工湖绿地', cat: '人民广场 · 市中心', color: '#5ef2a0', build: () => cityPark({ w: 110, d: 85 }), lon: 121.4728, lat: 31.2219, tier: 3, r: 45 },
  /* ================= v=45 新增(收尾): 剩余真实场馆/绿地 ================= */
];

/**
 * 用 OSM 景点表校正每处地标的经纬度: 数据里有同名要素就用数据里的真实坐标,
 * 没有才退回清单中的经纬度, 保证模型永远落在卫星影像上的正确位置。
 */
export function resolveLandmarks(pois = []) {
  const byName = new Map();
  for (const p of pois) {
    if (!byName.has(p.name) || p.score > byName.get(p.name).score) byName.set(p.name, p);
  }
  return LANDMARK_DEFS.map(def => {
    const p = byName.get(def.name);
    const lon = p ? p.lon : def.lon;
    const lat = p ? p.lat : def.lat;
    const [x, z] = proj(lon, lat);
    return {
      ...def, lon, lat, x, z,
      poi: p || null,
      fromOSM: !!p,
      rx: (def.r || 50) / 1000,          // 抹除半径 (场景单位)
    };
  });
}

/* =========================================================
   十、入口
   ========================================================= */
function genericLandmark(s) {
  // 某个精模构建失败时的兜底:  tier 越高级别越高
  const h = s.tier === 1 ? 0.13 : s.tier === 2 ? 0.09 : 0.06;
  const col = new THREE.Color(s.color || '#dbe6f7');
  const mat = new THREE.MeshStandardMaterial({
    color: col, roughness: 0.5, metalness: 0.3,
    emissive: col, emissiveIntensity: 0.22,
  });
  const g = new THREE.Group();
  const w = Math.max(0.02, s.rx * 1.5);
  const d = Math.max(0.016, s.rx * 1.1);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.65, d), mat));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.7, h * 0.45, 4), mat);
  roof.position.y = h * 0.55;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.userData.height = h;
  return g;
}

export function buildLandmarks(sites) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const labels = [];
  const models = new Map();
  let labelsOn = true;            // 名称标注总开关 (图层"地标名"控制)
  const _lmCp = new THREE.Vector3(1e9, 0, 0);   // v=51: update 门控缓存
  const _lmTg = new THREE.Vector3(1e9, 0, 0);
  let _lmOn = null;

  for (const s of sites) {
    let obj;
    try { obj = s.build(); }
    catch (e) { obj = genericLandmark(s); }

    obj.position.set(s.x, BASE_Y, s.z);
    if (s.rot) obj.rotation.y = s.rot * D2R;
    obj.userData.landmark = { name: s.name, sub: s.sub, lon: s.lon, lat: s.lat };
    group.add(obj);
    models.set(s.name, s.sub);

    // 名称标注
    const lab = makeLabel(s.name, s.sub, s.color);
    const h = obj.userData.height || 0.06;
    s.height = h;                      // 回写给导览用: 决定飞抵时的退距
    lab.position.set(s.x, BASE_Y + h + 0.16, s.z);
    lab.userData.tier = s.tier || 3;
    group.add(lab);
    labels.push(lab);

    /* 贴地定位环: v=39 精修 —— 尺寸改为按"模型实际占地"算, 不再用抹除半径 s.rx。
       s.rx 只是编辑用的抑制半径(为了让精模替代周边通用网红景点而调大), 拿它当光圈直径
       会导致调大抑制范围时地面光圈跟着一起放大, 视觉上和建筑体量完全脱节。 */
    obj.updateMatrixWorld(true);
    const _bb = new THREE.Box3().setFromObject(obj);
    const _span = Math.max(_bb.max.x - _bb.min.x, _bb.max.z - _bb.min.z);
    const ringR = Math.max(0.020, _span * 0.5 * 1.12);
    s.footR = _span * 0.5;              // v=43: 模型实际占地半径, 供 poi_buildings 抑制同点 generic 模型
    /* v=47: 统一石材广场垫层 —— 每座精模坐在一块圆形石板广场上, 全城 379 座观感统一 */
    const padR = Math.max(0.022, _span * 0.5 * 1.18);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(padR, 30),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#59626e'), roughness: 0.88, metalness: 0.04 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, BASE_Y + 0.0010, s.z);
    pad.renderOrder = 1;
    group.add(pad);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR * 0.92, ringR * 1.18, 30),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(s.color), transparent: true, opacity: 0.30,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, BASE_Y + 0.006, s.z);
    group.add(ring);
  }

  // 分级可见距离: 远景只留超级地标, 凑近了才逐级显示, 避免标签糊成一片
  const FAR = { 1: 150, 2: 46, 3: 20 };

  return {
    group,
    labels,
    count: models.size,
    total: sites.length,
    labelCount: labels.length,
    sites,
    modelOf: (name) => models.get(name) || null,
    setLabels(v) { labelsOn = v; },
    update(camera, controls) {
      const cp = camera.position;
      /* v=51 性能: 相机位置/看点/开关三者都没变时, 每个标签的距离/缩放/透明度
         与上一帧完全相同, 直接跳过(379 个标签的 distanceTo + 属性写入)。 */
      const tg = controls ? controls.target : null;
      const unchanged = cp.distanceToSquared(_lmCp) < 1e-8
        && (!tg || tg.distanceToSquared(_lmTg) < 1e-8)
        && _lmOn === labelsOn;
      if (unchanged) return;
      _lmCp.copy(cp); if (tg) _lmTg.copy(tg); _lmOn = labelsOn;
      const camClose = controls ? (cp.distanceTo(controls.target) < 1.6) : (cp.length() < 1.6);  // 相机到看点很近(<1.6km)时缩到 0.4x
      for (const lab of labels) {
        if (!labelsOn) { lab.visible = false; continue; }
        const far = FAR[lab.userData.tier] || 20;
        const d = cp.distanceTo(lab.position);
        if (d > far) { lab.visible = false; continue; }
        lab.visible = true;
        const k = Math.max(0.9, Math.min(3.0, d / 7));
        const b = lab.userData.baseScale;
        const nearScale = camClose ? 0.4 : 1.0;
        lab.scale.set(b.x * k * nearScale, b.y * k * nearScale, 1);
        lab.material.opacity = d > far * 0.78 ? (far - d) / (far * 0.22) : 1;
      }
    },
  };
}
