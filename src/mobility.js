import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Y } from './basemap.js?v=32';
import { makeRand } from './util.js?v=32';

/* =========================================================
   共享出行: 共享单车 / 共享电动车
   在地铁站与公交站周边成簇停放, 还原"最后一公里"的真实分布。
   ---------------------------------------------------------
   建模方式: 按真实尺寸(米)用顶点色累加器搭建单车/电动车,
   每辆车烘焙成一份带 color 属性的合并几何, 再走 InstancedMesh。
   单车间只差车架配色, 故按品牌拆 3 个 InstancedMesh(可各带自发光),
   电动车 1 个, 合计 4 个 draw call。
   ========================================================= */

const MH = 0.001;    // 1 米 水平 -> 场景单位 (1 场景单位 = 1 km)
const MV = 0.0016;   // 1 米 垂直 (垂直 1.6x 视觉放大)
/* 车辆可见性放大系数: 真实尺寸(单车长 1.7m)在全景下几乎不可见,
   这里放大到 ~16x(单车约 27m), 拉近到街区尺度即可清晰辨认, 又不至于夸张成楼。 */
const VIS = 22.0;
const U = MH * VIS;  // 建模单位: 1 米 -> U 场景单位 (等比缩放, 保证车轮是正圆)

/* ---------------- 配色 ---------------- */
const C_DARK = '#1a1a20';    // 轮胎 / 座垫 / 把套
const C_METAL = '#b9c2cc';   // 车筐 / 轮毂
const C_SPOKE = '#d3dae1';   // 辐条 / 牙盘
const C_PLATE = '#eef4fa';   // 车头二维码牌
const C_TAIL = '#ff4436';    // 电动车尾灯

const _c = new THREE.Color();
const rgb = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };

/* =========================================================
   顶点色累加器 (与 poi_buildings.js 的 push/quad 同思路)
   只累加 position + color + index, 法线最后统一 computeVertexNormals
   ========================================================= */
function acc() { return { p: [], c: [], i: [] }; }

/* 追加顶点, 返回索引 */
function vtx(B, x, y, z, col) {
  B.p.push(x, y, z); B.c.push(col[0], col[1], col[2]);
  return B.p.length / 3 - 1;
}
/* 追加面, d 省略时为三角形 */
function face(B, a, b, c, d) {
  B.i.push(a, b, c);
  if (d !== undefined) B.i.push(a, c, d);
}
/* 四边形: 顶点按右手定则给出, 保证 computeVertexNormals 得到外法线 */
function quad(B, P, col) {
  const i0 = vtx(B, P[0][0], P[0][1], P[0][2], col);
  const i1 = vtx(B, P[1][0], P[1][1], P[1][2], col);
  const i2 = vtx(B, P[2][0], P[2][1], P[2][2], col);
  const i3 = vtx(B, P[3][0], P[3][1], P[3][2], col);
  face(B, i0, i1, i2, i3);
}
/* 长方体(独立顶点 -> 硬边), 参数为两组对角点 */
function boxF(B, x0, y0, z0, x1, y1, z1, col) {
  quad(B, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col);  // +Z
  quad(B, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], col);  // -Z
  quad(B, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], col);  // +X
  quad(B, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], col);  // -X
  quad(B, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], col);  // 顶
  quad(B, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], col);  // 底
}
/* 直杆: 沿任意方向的棱柱, 环向共享顶点(平滑着色), 两端不封口 */
function rod(B, a, b, r, sides, col) {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  // 取一个与轴不平行的参考向量, 叉积得到正交基
  let px = 0, py = 1, pz = 0;
  if (Math.abs(dy) > 0.9) { px = 1; py = 0; }
  let ux = dy * pz - dz * py, uy = dz * px - dx * pz, uz = dx * py - dy * px;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const ia = [], ib = [];
  for (let k = 0; k < sides; k++) {
    const t = (k / sides) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
    const nx = ux * ct + vx * st, ny = uy * ct + vy * st, nz = uz * ct + vz * st;
    ia.push(vtx(B, a[0] + r * nx, a[1] + r * ny, a[2] + r * nz, col));
    ib.push(vtx(B, b[0] + r * nx, b[1] + r * ny, b[2] + r * nz, col));
  }
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    face(B, ia[k], ia[k2], ib[k2], ib[k]);
  }
}
/* 环形扫掠: 沿 XY 平面圆弧扫掠一个椭圆截面 —— 外胎 / 挡泥板 */
function arcTube(B, cx, cy, cz, R, a0, a1, rR, rZ, secN, seg, col, closed) {
  const rings = [], nr = closed ? seg : seg + 1;
  for (let i = 0; i < nr; i++) {
    const a = a0 + (a1 - a0) * (i / seg), ca = Math.cos(a), sa = Math.sin(a);
    const ox = cx + R * ca, oy = cy + R * sa;
    const row = [];
    for (let j = 0; j < secN; j++) {
      const t = (j / secN) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
      row.push(vtx(B, ox + rR * ca * ct, oy + rR * sa * ct, cz + rZ * st, col));
    }
    rings.push(row);
  }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % nr;
    for (let j = 0; j < secN; j++) {
      const j2 = (j + 1) % secN;
      face(B, rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]);
    }
  }
}
/* 弧形薄带: 挡泥板, 法线朝圆心外侧 */
function arcBand(B, cx, cy, cz, R, a0, a1, hw, seg, col) {
  const L = [], Rt = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg), ca = Math.cos(a), sa = Math.sin(a);
    const x = cx + R * ca, y = cy + R * sa;
    L.push(vtx(B, x, y, cz - hw, col));
    Rt.push(vtx(B, x, y, cz + hw, col));
  }
  for (let i = 0; i < seg; i++) face(B, L[i], L[i + 1], Rt[i + 1], Rt[i]);
}
/* 放样: 若干等长截面环依次连成蒙皮 (座垫 / 车座) */
function loft(B, rings, col, caps) {
  const idx = rings.map(r => r.map(p => vtx(B, p[0], p[1], p[2], col)));
  const n = rings[0].length;
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      face(B, idx[k][j], idx[k][j2], idx[k + 1][j2], idx[k + 1][j]);
    }
  }
  if (caps) {
    const a = idx[0], z = idx[idx.length - 1];
    for (let j = 1; j < n - 1; j++) face(B, a[0], a[j + 1], a[j]);
    for (let j = 1; j < n - 1; j++) face(B, z[0], z[j], z[j + 1]);
  }
}
/* 圆盘: 牙盘 */
function disc(B, cx, cy, cz, r, seg, col) {
  const c = vtx(B, cx, cy, cz, col);
  const rim = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    rim.push(vtx(B, cx + r * Math.cos(a), cy + r * Math.sin(a), cz, col));
  }
  for (let k = 0; k < seg; k++) face(B, c, rim[k], rim[(k + 1) % seg]);
}
/* 水平薄板 (法线 +Y) */
function plateY(B, cx, cy, cz, sx, sz, col) {
  quad(B, [
    [cx - sx / 2, cy, cz + sz / 2], [cx + sx / 2, cy, cz + sz / 2],
    [cx + sx / 2, cy, cz - sz / 2], [cx - sx / 2, cy, cz - sz / 2],
  ], col);
}
/* 车筐: 上宽下窄的开口斗 (底面 + 四侧) */
function basket(B, x0, x1, y0, y1, hw0, hw1, col) {
  const b = [[x0, y0, -hw0], [x1, y0, -hw0], [x1, y0, hw0], [x0, y0, hw0]];
  const t = [[x0, y1, -hw1], [x1, y1, -hw1], [x1, y1, hw1], [x0, y1, hw1]];
  const ib = b.map(p => vtx(B, p[0], p[1], p[2], col));
  const it = t.map(p => vtx(B, p[0], p[1], p[2], col));
  for (let j = 0; j < 4; j++) {
    const j2 = (j + 1) % 4;
    face(B, ib[j], it[j], it[j2], ib[j2]);
  }
  face(B, ib[0], ib[1], ib[2], ib[3]);
}
/* 累加器 -> BufferGeometry (无 uv, MeshStandardMaterial 无贴图时不需要) */
function toGeo(B) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
  g.setIndex(B.i);
  return g;
}
/* 把带位姿的零件烘进自身顶点 (供合并) */
function part(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const m = new THREE.Mesh(geo);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.set(scl[0], scl[1], scl[2]);
  m.updateMatrix();
  geo.applyMatrix4(m.matrix);
  return geo;
}
/* 收尾: 统一缩放到场景单位 + 生成法线 (此时最低点应正好是 y = 0) */
function finish(parts) {
  const g = mergeGeometries(parts, false);
  g.scale(U, U, U);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* =========================================================
   车轮: 外胎(圆环) + 辐条(细扁条) + 花鼓
   局部坐标 —— 轮心在原点, 轴向 Z, 外缘半径 RC + T
   ========================================================= */
function wheelGeo(RC, T, dark, spoke, spokeN, rib) {
  const B = acc();
  arcTube(B, 0, 0, 0, RC, 0, Math.PI * 2, T, T, 4, 12, dark, true);  // 外胎
  const r1 = RC - T * 0.15, hw = rib ? 0.012 : 0.004;
  for (let k = 0; k < spokeN; k++) {                                  // 辐条
    const a = (k / spokeN) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    quad(B, [
      [ca * 0.020 - sa * hw, sa * 0.020 + ca * hw, 0],
      [ca * r1 - sa * hw, sa * r1 + ca * hw, 0],
      [ca * r1 + sa * hw, sa * r1 - ca * hw, 0],
      [ca * 0.020 + sa * hw, sa * 0.020 - ca * hw, 0],
    ], spoke);
  }
  rod(B, [0, 0, -0.048], [0, 0, 0.048], 0.026, 5, spoke);            // 花鼓
  return toGeo(B);
}

/* =========================================================
   一辆共享单车 (车头朝 +X), 单位: 米, 轮胎最低点 y = 0
   部件: 2 轮(胎+辐条+花鼓) / 主梁 / 头管 / 座管 / 后上叉 / 后下叉 / 前叉
        横把 + 把套 / 马鞍座垫 / 牙盘 + 脚踏 / 前车筐 / 前后挡泥板 / 二维码牌
   ========================================================= */
function bikeGeometry(bodyHex) {
  const body = rgb(bodyHex);
  const dark = rgb(C_DARK), metal = rgb(C_METAL), spoke = rgb(C_SPOKE), plate = rgb(C_PLATE);

  const RW = 0.32, T = 0.030, RC = RW - T;   // 车轮外半径 / 胎厚 / 胎中心线半径
  const WB = 0.52;                            // 半轴距 (轴距 1.04m)
  const P_BB = [-0.10, 0.27];                 // 中轴(牙盘)
  const P_H0 = [0.50, 0.60], P_H1 = [0.44, 0.94];  // 头管下端 / 上端(把立)
  const P_ST = [-0.27, 0.86];                 // 座管顶(顶到座垫底)

  const B = acc();
  /* --- 车架: 带倾角的细杆 --- */
  rod(B, [P_H0[0], P_H0[1], 0], [0.18, 0.44, 0], 0.017, 4, body);         // 主梁前段
  rod(B, [0.18, 0.44, 0], [P_BB[0], P_BB[1], 0], 0.017, 4, body);         // 主梁后段
  rod(B, [P_H0[0], P_H0[1], 0], [P_H1[0], P_H1[1], 0], 0.017, 4, body);   // 头管
  rod(B, [P_BB[0], P_BB[1], 0], [P_ST[0], P_ST[1], 0], 0.017, 4, body);   // 座管
  for (const s of [-1, 1]) {
    rod(B, [P_ST[0], P_ST[1] - 0.02, 0.048 * s], [-WB, RW, 0.048 * s], 0.011, 4, body);   // 后上叉
    rod(B, [P_BB[0], P_BB[1], 0.048 * s], [-WB, RW, 0.048 * s], 0.012, 4, body);           // 后下叉
    rod(B, [P_H0[0], P_H0[1], 0.055 * s], [WB, RW, 0.055 * s], 0.013, 4, body);            // 前叉
  }

  /* --- 车把 + 把套 --- */
  rod(B, [0.40, 0.97, -0.26], [0.40, 0.97, 0.26], 0.014, 4, body);
  for (const s of [-1, 1]) {
    rod(B, [0.398, 0.972, 0.150 * s], [0.393, 0.978, 0.285 * s], 0.021, 5, dark);
  }
  /* --- 座垫: 三段放样出马鞍形(后宽前窄, 中间微凹) --- */
  const ring = (x, y, hw, h) => [[x, y + h, -hw], [x, y + h, hw], [x, y - h, hw], [x, y - h, -hw]];
  loft(B, [
    ring(-0.40, 0.885, 0.082, 0.014),
    ring(-0.30, 0.895, 0.050, 0.020),
    ring(-0.17, 0.872, 0.038, 0.013),
  ], dark, true);

  /* --- 牙盘 + 脚踏 --- */
  disc(B, P_BB[0], P_BB[1], 0.078, 0.085, 8, spoke);
  plateY(B, P_BB[0] - 0.02, 0.235, 0.115, 0.085, 0.045, dark);
  plateY(B, P_BB[0] + 0.02, 0.205, -0.115, 0.085, 0.045, dark);

  /* --- 前车筐 --- */
  basket(B, 0.38, 0.60, 0.68, 0.90, 0.105, 0.125, metal);

  /* --- 前后挡泥板: 贴合轮胎的薄弧面 --- */
  arcBand(B, WB, RW, 0, RW + 0.022, 0.09, Math.PI - 0.09, 0.042, 6, body);
  arcBand(B, -WB, RW, 0, RW + 0.022, 0.09, Math.PI - 0.09, 0.042, 6, body);

  /* --- 车头二维码牌 --- */
  quad(B, [
    [0.355, 1.020, 0.028], [0.435, 1.020, 0.028],
    [0.440, 0.985, -0.028], [0.360, 0.985, -0.028],
  ], plate);

  return finish([
    part(wheelGeo(RC, T, dark, spoke, 8, false), [WB, RW, 0]),
    part(wheelGeo(RC, T, dark, spoke, 8, false), [-WB, RW, 0]),
    toGeo(B),
  ]);
}

/* =========================================================
   一辆共享电动车 (车头朝 +X), 单位: 米, 轮胎最低点 y = 0
   部件: 前后小轮(胖胎 + 轮辐 + 花鼓) / 踏板平台 / 电池仓 / 宽厚车座
        长立管 + 前叉 / 横把 + 把套 / 仪表盘 / 前车筐 / 后视镜 / 前后挡泥板
        后尾灯 / 脚撑 / 品牌色条 / 二维码牌
   ========================================================= */
function scooterGeometry(bodyHex) {
  const body = rgb(bodyHex);
  const dark = rgb(C_DARK), metal = rgb(C_METAL), spoke = rgb(C_SPOKE), tail = rgb(C_TAIL);
  const screen = rgb('#76e8c0'), qrim = rgb('#ffffff'), yellow = rgb('#ffb300');

  const RW = 0.235, T = 0.042, RC = RW - T;   // 略小的轮 + 更粗的胎
  const WB = 0.52;                             // 半轴距

  const B = acc();
  /* --- 踏板平台 (防滑纹理用细密横条带) --- */
  boxF(B, -0.34, 0.115, -0.145, 0.30, 0.175, 0.145, body);
  for (let i = -3; i <= 3; i++) {
    const z = i * 0.04;
    boxF(B, -0.32, 0.175, z - 0.004, 0.28, 0.179, z + 0.004, dark);
  }
  /* --- 座位下电池仓 --- */
  boxF(B, -0.26, 0.175, -0.115, 0.00, 0.500, 0.115, body);
  /* --- 车座: 更宽厚 --- */
  const ring = (x, y, hw, h) => [[x, y + h, -hw], [x, y + h, hw], [x, y - h, hw], [x, y - h, -hw]];
  loft(B, [
    ring(-0.28, 0.522, 0.125, 0.024),
    ring(-0.16, 0.535, 0.100, 0.030),
    ring(-0.02, 0.524, 0.078, 0.022),
  ], dark, true);
  /* --- 长立管 + 前叉 --- */
  rod(B, [0.475, 0.50, 0], [0.420, 0.98, 0], 0.026, 5, body);
  for (const s of [-1, 1]) {
    rod(B, [0.475, 0.55, 0.055 * s], [WB, RW, 0.055 * s], 0.015, 4, body);
  }
  /* --- 车把 + 把套 --- */
  rod(B, [0.395, 1.00, -0.30], [0.395, 1.00, 0.30], 0.015, 4, body);
  for (const s of [-1, 1]) {
    rod(B, [0.390, 1.005, 0.170 * s], [0.385, 1.010, 0.300 * s], 0.022, 5, dark);
  }
  /* --- 仪表盘: 立管上端的发光小屏 --- */
  boxF(B, 0.450, 0.92, -0.045, 0.510, 0.97, 0.045, screen);
  boxF(B, 0.448, 0.92, -0.045, 0.452, 0.96, 0.045, dark);
  /* --- 车把按钮 (左右各一, 加速/喇叭) --- */
  for (const s of [-1, 1]) {
    boxF(B, 0.380, 0.992, s * 0.16, 0.412, 1.012, s * 0.20, yellow);
  }
  /* --- 前车筐 --- */
  basket(B, 0.44, 0.62, 0.66, 0.86, 0.115, 0.135, metal);
  /* --- 篮内二维码牌 (扫码开锁) --- */
  boxF(B, 0.475, 0.78, -0.085, 0.585, 0.86, -0.080, qrim);
  /* --- 前大灯: 车把下方的小亮盒 --- */
  boxF(B, 0.460, 0.870, -0.030, 0.490, 0.920, 0.030, rgb('#fff4c2'));
  /* --- 后视镜: 立管顶部两侧细杆 + 小镜面 --- */
  for (const s of [-1, 1]) {
    rod(B, [0.430, 0.97, s * 0.06], [0.420, 1.06, s * 0.10], 0.004, 4, dark);
    boxF(B, 0.410, 1.04, s * 0.09, 0.430, 1.08, s * 0.12, rgb('#9fd8ff'));
  }
  /* --- 脚撑: 电池仓左侧的细斜杆, 撑到地面 --- */
  rod(B, [-0.10, 0.170, -0.16], [-0.20, 0.00, -0.40], 0.012, 4, metal);
  /* --- 侧身品牌色条 (白底大字) --- */
  boxF(B, -0.260, 0.280, -0.117, 0.000, 0.320, -0.117, rgb('#ffffff'));
  boxF(B, -0.255, 0.290, -0.119, -0.005, 0.310, -0.119, rgb(bodyHex));
  /* --- 后尾灯: 电池仓后方的小方块 (亮红) --- */
  boxF(B, -0.275, 0.360, -0.060, -0.245, 0.460, 0.060, tail);
  /* --- 挡泥板 --- */
  arcBand(B, WB, RW, 0, RW + 0.026, 0.26, Math.PI - 0.26, 0.055, 6, body);
  arcBand(B, -WB, RW, 0, RW + 0.026, 0.26, Math.PI - 0.26, 0.055, 6, body);

  return finish([
    part(wheelGeo(RC, T, dark, spoke, 5, true), [WB, RW, 0]),
    part(wheelGeo(RC, T, dark, spoke, 5, true), [-WB, RW, 0]),
    toGeo(B),
  ]);
}

/* =========================================================
   道路上行驶的公交车 (多车型, 沿真实线路以正常速度行驶)
   ---------------------------------------------------------
   选取代表性线路, 由站点坐标生成样条路径, 每线 1 辆公交车沿路径往返;
   按运营方 / 线路特征分 5 种涂装 (常规绿 / 浦东蓝 / 巴士红 / 夜宵黄 / 机场金)。
   ========================================================= */
const BUS_TYPES = [
  { body: '#e8edf2', roof: '#c9d4e0', win: '#2b3b52', stripe: '#1f8a4c', shape: 'std' },     // 0 常规 · 绿
  { body: '#dff0ff', roof: '#bcd6ef', win: '#22364d', stripe: '#1f6fd0', shape: 'std' },     // 1 浦东 · 蓝
  { body: '#f3e6e0', roof: '#e0c9bd', win: '#3a2a24', stripe: '#c0392b', shape: 'std' },     // 2 巴士 · 红
  { body: '#2b2f3a', roof: '#1c1f29', win: '#ffd27a', stripe: '#ffb300', shape: 'std' },     // 3 夜宵 · 黄
  { body: '#fff7e6', roof: '#e8d9b8', win: '#2b3b52', stripe: '#b8860b', shape: 'deck' },    // 4 机场专线 · 金 双层
  { body: '#d8e6f2', roof: '#b9c8d8', win: '#22364d', stripe: '#3f51b5', shape: 'trolley' }, // 5 无轨电车 · 蓝灰(带辫子)
  { body: '#c0392b', roof: '#96271c', win: '#26313f', stripe: '#ffd166', shape: 'artic' },   // 6 中运量 · 红(铰接)
  { body: '#e8edf2', roof: '#c9d4e0', win: '#2b3b52', stripe: '#1f8a4c', shape: 'deck' },    // 7 观光 · 双层
];

/* 上海经典无轨电车线路(6/8/13~28/37 路等), 按线路号识别挂"辫子" */
const TROLLEY_REF = /^(6|8|13|14|15|17|18|19|20|21|22|23|24|25|26|27|28|37)路?$/;

function refHash(ref) {
  let h = 7;
  const r = String(ref || '');
  for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) >>> 0;
  return h;
}
function busTypeOf(line) {
  const nm = line.name || '', op = line.op || '';
  const ref = String(line.ref || '');
  if (/夜|夜宵|N\d/.test(nm)) return 3;
  if (/观光|游览|双层/.test(nm)) return 7;                           // 观光双层
  if (/中运量|BRT|巨龙/.test(nm) || ref === '71') return 6;          // 中运量铰接
  /* 电车判定必须放在"大桥/高速"之前 —— 17/18 路是经典无轨电车,
     但名字里带"卢浦大桥/南浦大桥", 会被机场专线规则抢走(实测踩坑) */
  if (/电车|无轨/.test(nm) || TROLLEY_REF.test(ref)) return 5;       // 无轨电车
  if (/机场|高速|大桥|守航|磁悬浮/.test(nm)) return 4;               // 机场/大桥专线 → 双层
  if (/浦东/.test(op) || /浦东/.test(nm)) return 1;
  if (/巴士|强生|锦江|大众/.test(op)) return 2;
  /* 兜底: 按线路号散列, 让双层/电车/铰接在普通线路里零星出现(确定性, 不随刷新变化)。
     数据里没有 71路中运量/观光双层线路(OSM 未收录), 不加散列这两类会一直是 0。 */
  const hv = refHash(ref);
  if (hv % 37 === 0) return 4;                                       // 双层
  if (hv % 29 === 0) return 5;                                       // 电车
  if (hv % 47 === 0) return 6;                                       // 铰接(中运量)
  if (hv % 53 === 0) return 7;                                       // 观光双层
  return 0;
}

function busGeometry(T) {
  const B = acc();
  const body = rgb(T.body), roof = rgb(T.roof), win = rgb(T.win),
    stripe = rgb(T.stripe), dark = rgb('#1a1a20'), tyre = rgb('#15151a');
  const hub = rgb('#8d949e'), lamp = rgb('#fff4c2'), tail = rgb('#c0392b'), glass = rgb('#7fb6d9');
  /* v=41: 车型分级 —— 单层 6m / 双层 6.6m·4.05m / 铰接 10.5m / 电车=单层+集电杆 */
  const shape = T.shape || 'std';
  const L = shape === 'artic' ? 10.5 : shape === 'deck' ? 6.6 : 6.0;
  const W = 2.35;
  const H = shape === 'deck' ? 4.05 : 2.65;
  const wy = 0.46;
  const Hc = H;                                                             // 车顶下沿
  boxF(B, -L / 2, 0.55, -W / 2, L / 2, Hc, W / 2, body);                    // 车身主体
  boxF(B, -L / 2, Hc, -W / 2, L / 2, Hc + 0.14, W / 2, roof);               // 车顶
  boxF(B, -L / 2, 0.42, -W / 2 + 0.06, L / 2, 0.55, W / 2 - 0.06, dark);   // 底盘/侧裙阴影
  // 侧窗带: 双层上下两条, 其余一条
  const bands = shape === 'deck'
    ? [[1.05, 2.05], [2.55, 3.55]]
    : [[H * 0.60, H * 0.92]];
  for (const sz of [1, -1]) {
    for (const bi of bands) {
      boxF(B, -L * 0.40, bi[0], sz * (W / 2 - 0.02), L * 0.42, bi[1], sz * (W / 2 + 0.01), win);
    }
    boxF(B, -L / 2, 0.85, sz * (W / 2 + 0.006), L / 2, 1.12, sz * (W / 2 + 0.03), stripe);  // 腰线
    for (const dx of [L * 0.30, -L * 0.10]) {                                               // 前后车门竖缝
      boxF(B, dx - 0.03, 0.55, sz * (W / 2 + 0.012), dx + 0.03, (shape === 'deck' ? 2.05 : H * 0.95), sz * (W / 2 + 0.026), dark);
    }
    if (shape === 'deck') {
      boxF(B, -L * 0.06, 2.05, sz * (W / 2 + 0.004), -L * 0.06 + 0.12, 2.55, sz * (W / 2 + 0.018), dark); // 楼梯口
      boxF(B, L * 0.44, 1.90, sz * (W / 2 + 0.02), L * 0.46, 1.95, sz * (W / 2 + 0.16), dark);            // 下层后视镜
      boxF(B, L * 0.43, 1.78, sz * (W / 2 + 0.14), L * 0.47, 2.02, sz * (W / 2 + 0.20), glass);
    } else {
      boxF(B, L * 0.44, H * 0.80, sz * (W / 2 + 0.02), L * 0.46, H * 0.82, sz * (W / 2 + 0.16), dark);
      boxF(B, L * 0.43, H * 0.74, sz * (W / 2 + 0.14), L * 0.47, H * 0.90, sz * (W / 2 + 0.20), glass);
    }
  }
  // 前挡风: 双层上下两块
  if (shape === 'deck') {
    boxF(B, L / 2 - 0.04, 1.15, -W * 0.42, L / 2 + 0.02, 2.15, W * 0.42, win);
    boxF(B, L / 2 - 0.04, 2.60, -W * 0.42, L / 2 + 0.02, 3.60, W * 0.42, win);
    boxF(B, L / 2 + 0.005, 3.62, -0.5, L / 2 + 0.06, 3.78, 0.5, rgb('#ffe9a8'));
  } else {
    boxF(B, L / 2 - 0.04, H * 0.52, -W * 0.42, L / 2 + 0.02, H * 0.95, W * 0.42, win);
    boxF(B, L / 2 + 0.005, H * 0.95, -0.5, L / 2 + 0.06, H * 1.02, 0.5, rgb('#ffe9a8'));
  }
  boxF(B, L / 2 + 0.01, 0.62, -W * 0.46, L / 2 + 0.05, 0.86, W * 0.46, dark);            // 前保险杠
  for (const sz of [-1, 1]) boxF(B, L / 2 + 0.02, 0.70, sz * W * 0.30, L / 2 + 0.06, 0.84, sz * W * 0.44, lamp);  // 前大灯
  boxF(B, -L / 2 - 0.04, 0.5, -W * 0.4, -L / 2 + 0.02, 1.2, W * 0.4, dark);               // 后围裙
  for (const sz of [-1, 1]) boxF(B, -L / 2 - 0.06, 0.72, sz * W * 0.26, -L / 2 - 0.02, 0.94, sz * W * 0.40, tail); // 尾灯
  boxF(B, -L / 2 - 0.05, H * 0.90, -0.42, -L / 2 - 0.01, H * 0.99, 0.42, rgb('#ffb347')); // 后路牌
  boxF(B, -L * 0.16, Hc + 0.14, -W * 0.30, L * 0.10, Hc + 0.34, W * 0.30, rgb('#d7dee6')); // 车顶空调
  boxF(B, -L * 0.14, Hc + 0.34, -W * 0.24, L * 0.08, Hc + 0.38, W * 0.24, dark);
  for (let i = 0; i < 4; i++) {
    boxF(B, -L * 0.14 + i * 0.06, Hc + 0.38, -W * 0.22, -L * 0.10 + i * 0.06, Hc + 0.382, W * 0.22, rgb('#8d949e'));
  }
  for (const sx of [-1, 1]) boxF(B, L / 2 - 0.20, H * 0.55, sx * 0.35, L / 2 - 0.05, H * 0.555, sx * 0.05, rgb('#15151a'));  // 雨刷
  boxF(B, L / 2 + 0.008, H * 0.83, -W * 0.22, L / 2 + 0.045, H * 0.93, W * 0.22, rgb('#ff8a00'));  // LED 路线屏
  for (const sz of [-1, 1]) boxF(B, -L * 0.30, Hc + 0.155, sz * (W * 0.42), L * 0.28, Hc + 0.175, sz * (W * 0.42), rgb('#8d949e'));  // 车顶扶手
  boxF(B, -L * 0.32, Hc + 0.14, -W * 0.18, -L * 0.22, Hc + 0.22, W * 0.18, rgb('#3a4452'));        // 电池舱
  boxF(B, -L * 0.315, Hc + 0.145, -W * 0.175, -L * 0.225, Hc + 0.215, W * 0.175, rgb('#5d6a79'));
  for (const sz of [-1, 1]) {                                                                      // 车门铰链
    boxF(B, L * 0.28, 0.62, sz * (W / 2 + 0.005), L * 0.29, 0.82, sz * (W / 2 + 0.012), rgb('#2b3a4f'));
    boxF(B, L * 0.28, 1.45, sz * (W / 2 + 0.005), L * 0.29, 1.65, sz * (W / 2 + 0.012), rgb('#2b3a4f'));
    boxF(B, -L * 0.12, 0.62, sz * (W / 2 + 0.005), -L * 0.11, 0.82, sz * (W / 2 + 0.012), rgb('#2b3a4f'));
    boxF(B, -L * 0.12, 1.45, sz * (W / 2 + 0.005), -L * 0.11, 1.65, sz * (W / 2 + 0.012), rgb('#2b3a4f'));
  }
  boxF(B, L / 2 - 0.28, H * 0.45, -0.08, L / 2 - 0.24, H * 0.50, 0.08, rgb('#2b3a4f'));   // 雨刮电机
  rod(B, [L * 0.20, Hc + 0.10, 0], [L * 0.20, Hc + 0.18, 0], 0.012, 4, dark);             // 天线
  boxF(B, -L / 2 - 0.02, 0.42, -0.025, -L / 2 + 0.01, H * 0.88, 0.025, rgb('#1a1a20'));   // 应急门

  /* ---- 车型专属部件 ---- */
  if (shape === 'trolley') {
    // 无轨电车"辫子": 车尾两根斜向上集电杆 + 滑靴 + 绝缘座
    for (const sz of [-1, 1]) {
      rod(B, [-L * 0.28, Hc + 0.14, sz * 0.35], [-L * 0.50, Hc + 0.85, sz * 0.20], 0.022, 5, dark);
      boxF(B, -L * 0.54, Hc + 0.82, sz * 0.14, -L * 0.47, Hc + 0.89, sz * 0.27, rgb('#c9d4e0'));
    }
    boxF(B, -L * 0.30, Hc + 0.08, -0.46, -L * 0.25, Hc + 0.16, 0.46, rgb('#7a4a2b'));
  }
  if (shape === 'artic') {
    // 铰接(中运量): 中间风箱(波纹) + 第三轴
    const jx = -L * 0.02;
    boxF(B, jx - 0.30, 0.60, -W / 2 + 0.05, jx + 0.30, H * 0.96, W / 2 - 0.05, rgb('#141a22'));
    for (let i = 0; i < 5; i++) {
      boxF(B, jx - 0.27 + i * 0.115, 0.66, -W / 2 + 0.04, jx - 0.20 + i * 0.115, H * 0.92, W / 2 - 0.04, rgb('#232c38'));
    }
  }
  // 车轮: 铰接三轴, 其余两轴
  const axles = shape === 'artic' ? [-L * 0.33, L * 0.14, L * 0.34] : [-L * 0.32, L * 0.32];
  for (const ax of axles) for (const sz of [-1, 1]) {
    rod(B, [ax, wy, sz * (W / 2 - 0.12)], [ax, wy, sz * (W / 2 + 0.12)], 0.5, 10, tyre);
    disc(B, ax, wy, sz * (W / 2 - 0.12), 0, 0.5, 10, tyre);
    disc(B, ax, wy, sz * (W / 2 + 0.12), 0, 0.5, 10, tyre);
    disc(B, ax, wy, sz * (W / 2 + 0.13), 0, 0.26, 10, hub);
  }
  return finish([toGeo(B)]);
}

function buildBuses(bus) {
  const group = new THREE.Group(); group.name = 'buses';
  const lines = bus.lines || [];
  const stops = bus.stops || [];
  // 排除轮渡/水上线路, 公交不应开进水里; 排除空路线/过短线路
  const cand = lines.filter(l => {
    if (!l.s || l.s.length < 4) return false;
    const nm = (l.name || '') + ' ' + (l.op || '') + ' ' + (l.ref || '');
    if (/轮渡|渡轮|轮船|船线|水上|航线|ferry|船/.test(nm)) return false;
    // 粗略过滤: 若所有站点都偏离路网中心区域很远, 可能是水上的
    return true;
  });
  if (!cand.length) return { group, count: 0, setTimeScale() { }, update() { } };
  /* v=41: 先全量分型, 再按类配额抽样 —— 旧逻辑按索引隔 8 抽 1, 双层/电车/铰接这类
     小众车型会在抽样里被滤光(实测 bus_5/6/7 全是 0)。现在每类单独配额, 特殊车型保底。 */
  const buckets = BUS_TYPES.map(() => []);
  for (let i = 0; i < cand.length; i++) buckets[busTypeOf(cand[i])].push(cand[i]);
  const quota = [92, 34, 34, 14, 16, 16, 14, 16];
  const chosen = [];
  buckets.forEach((arr, ti) => {
    const st = Math.max(1, Math.floor(arr.length / quota[ti]));
    for (let i = 0; i < arr.length; i += st) chosen.push(arr[i]);
  });
  if (!chosen.length) return { group, count: 0, setTimeScale() { }, update() { } };

  const list = [];
  chosen.forEach((line, idx) => {
    const s = line.s;
    const pts = [];
    const stride = s.length > 50 ? 2 : 1;
    for (let i = 0; i < s.length; i += stride) {
      const stp = stops[s[i]];
      if (stp) pts.push(new THREE.Vector3(stp.x, Y.road + 0.02, stp.z));
    }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const seed = (idx * 2654435761) >>> 0;
    const r = (Math.sin(seed) * 43758.5453) % 1;
    list.push({ line, curve, t: Math.abs(r), dir: 1, type: busTypeOf(line), km: curve.getLength() });
  });
  if (!list.length) return { group, count: 0, setTimeScale() { }, update() { } };

  const byType = BUS_TYPES.map(() => []);     // v=41: 8 种车型
  list.forEach(b => byType[b.type].push(b));
  const geos = BUS_TYPES.map(busGeometry);
  const mats = BUS_TYPES.map(t => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0.35,
    emissive: new THREE.Color(t.stripe).multiplyScalar(0.12), emissiveIntensity: 0.3,
  }));
  const meshes = byType.map((arr, ti) => {
    const m = new THREE.InstancedMesh(geos[ti], mats[ti], Math.max(1, arr.length));
    m.name = 'bus_' + ti;
    m.frustumCulled = false;
    m.count = arr.length;
    arr.forEach((b, i) => { b.inst = i; });
    group.add(m);
    return m;
  });

  const dummy = new THREE.Object3D();
  const _bp = new THREE.Vector3(), _bt = new THREE.Vector3();
  let timeScale = 8;
  return {
    group, count: list.length,
    getTimeScale: () => timeScale,
    setTimeScale(v) { timeScale = Math.max(1, Math.min(60, v)); },
    update(t, dt) {
      const d = Math.min(0.05, dt || 0.016);
      for (let ti = 0; ti < byType.length; ti++) {
        const arr = byType[ti], mesh = meshes[ti];
        for (const b of arr) {
          if (!b.km) continue;
          const kmPerSec = (16 + b.type * 2) / 3600 * timeScale;
          b.t += (kmPerSec / b.km) * d * b.dir;
          if (b.t > 1) { b.t = 1 - 1e-4; b.dir = -1; }
          if (b.t < 0) { b.t = 1e-4; b.dir = 1; }
          const u = Math.min(0.9999, Math.max(0.0001, b.t));
          b.curve.getPointAt(u, _bp);
          b.curve.getTangentAt(u, _bt);
          if (b.dir < 0) _bt.negate();
          dummy.position.copy(_bp);
          dummy.rotation.set(0, Math.atan2(_bt.x, _bt.z) - Math.PI / 2, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          mesh.setMatrixAt(b.inst, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

export function buildMobility({ metro, bus }) {
  const group = new THREE.Group();
  group.name = 'mobility';
  const rand = makeRand(77123);

  /* 三种品牌涂装: 每色一份几何 + 一份材质(自发光取车身色暗版) */
  const BRANDS = [
    { key: 'meituan', body: '#ffd21e' },
    { key: 'hello', body: '#22a7f0' },
    { key: 'qingju', body: '#2fd06a' },
  ];
  const SCOOTER_BODY = '#22c3a6';

  const bikeGeos = BRANDS.map(b => bikeGeometry(b.body));
  const bikeMats = BRANDS.map(b => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0.35,
    side: THREE.DoubleSide,   // 辐条/挡泥板是薄面, 双面可见更省顶点
    emissive: new THREE.Color(b.body).multiplyScalar(0.20),
    emissiveIntensity: 0.35,
  }));
  const scooterGeo = scooterGeometry(SCOOTER_BODY);
  const scoMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0.35,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(SCOOTER_BODY).multiplyScalar(0.20),
    emissiveIntensity: 0.35,
  });

  // 收集停放点: 地铁站全部 + 采样公交站
  const spots = [];
  (metro.stations || []).forEach(s => spots.push(s));
  const bs = bus.stops || [];
  const stride = Math.max(1, Math.floor(bs.length / 1800));
  for (let i = 0; i < bs.length; i += stride) spots.push(bs[i]);

  const bikeM = [], scoM = [];
  for (const s of spots) {
    // 每点 2~5 辆单车 + 1~3 辆电动车, 围绕站点散开成簇; 第 4 项为品牌索引
    const nB = 2 + (rand() < 0.7 ? 1 : 0) + (rand() < 0.4 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
    const nS = 1 + (rand() < 0.5 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
    for (let k = 0; k < nB; k++) {
      const a = rand() * Math.PI * 2, r = 0.025 + rand() * 0.06;
      bikeM.push([s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, rand() * Math.PI * 2, (rand() * 3) | 0]);
    }
    for (let k = 0; k < nS; k++) {
      const a = rand() * Math.PI * 2, r = 0.025 + rand() * 0.06;
      scoM.push([s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, rand() * Math.PI * 2]);
    }
  }

  const dummy = new THREE.Object3D();
  const yBase = Y.road + MV * 0.05;   // 站在路面上, 抬高 5cm 防 z-fighting

  const bikes = new THREE.Group(); bikes.name = 'bikes';
  const scooters = new THREE.Group(); scooters.name = 'scooters';

  for (let b = 0; b < BRANDS.length; b++) {
    const list = bikeM.filter(p => p[3] === b);
    const mesh = new THREE.InstancedMesh(bikeGeos[b], bikeMats[b], list.length);
    mesh.name = 'bikes_' + BRANDS[b].key;
    list.forEach((p, i) => {
      dummy.position.set(p[0], yBase, p[1]);
      dummy.rotation.set(0, p[2], 0);
      dummy.scale.setScalar(0.90 + rand() * 0.20);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    bikes.add(mesh);
  }

  const scoMesh = new THREE.InstancedMesh(scooterGeo, scoMat, scoM.length);
  scoMesh.name = 'scooters';
  scoM.forEach((p, i) => {
    dummy.position.set(p[0], yBase, p[1]);
    dummy.rotation.set(0, p[2], 0);
    dummy.scale.setScalar(0.90 + rand() * 0.20);
    dummy.updateMatrix();
    scoMesh.setMatrixAt(i, dummy.matrix);
  });
  scoMesh.instanceMatrix.needsUpdate = true;
  scooters.add(scoMesh);

  group.add(bikes, scooters);

  const buses = buildBuses(bus);
  group.add(buses.group);
  buses.group.visible = false;   // 由"公交车(行驶)"图层控制

  return {
    group,
    bikes,
    scooters,
    buses,
    bikeCount: bikeM.length,
    scooterCount: scoM.length,
    busCount: buses.count,
    setBikes(v) { bikes.visible = v; },
    setScooters(v) { scooters.visible = v; },
    update(t, dt) { buses.update(t, dt); },
  };
}
