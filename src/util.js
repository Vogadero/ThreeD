import * as THREE from 'three';

/* =========================================================
   通用工具: 数据加载 / 几何生成 / 颜色
   坐标约定: 数据中的 (x, z) 已是场景单位(1 单位 = 1 公里),
             z 轴北向为负, 与 three.js 中"北在屏幕上方"一致。
   ========================================================= */

export async function loadJSON(path, onProgress) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
  const t = await r.text();
  if (onProgress) onProgress(t.length);
  return JSON.parse(t);
}

/** 扁平数组 [x,z,x,z...] -> THREE.Vector3 数组 */
export function flatToVec3(flat, y = 0) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector3(flat[i], y, flat[i + 1]));
  return out;
}

/** 折线抽稀: 保证点数不超过 maxPts */
export function thinFlat(flat, maxPts) {
  const n = flat.length / 2;
  if (n <= maxPts) return flat;
  const step = n / maxPts;
  const out = [];
  for (let i = 0; i < maxPts; i++) {
    const k = Math.min(n - 1, Math.round(i * step));
    out.push(flat[k * 2], flat[k * 2 + 1]);
  }
  // 保留终点
  out[out.length - 2] = flat[flat.length - 2];
  out[out.length - 1] = flat[flat.length - 1];
  return out;
}

/**
 * 沿中心线生成带状水面几何 (河面)
 * @param flat    中心线 [x,z,x,z...]
 * @param widthKm 河宽 (场景单位)
 * @param y       水面高度
 */
export function ribbonGeometry(flat, widthKm, y = 0) {
  const n = flat.length / 2;
  if (n < 2) return null;
  const pos = [], uv = [], idx = [];
  const hw = widthKm / 2;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x = flat[i * 2], z = flat[i * 2 + 1];
    let tx, tz;
    if (i === 0) { tx = flat[2] - x; tz = flat[3] - z; }
    else if (i === n - 1) { tx = x - flat[(i - 1) * 2]; tz = z - flat[(i - 1) * 2 + 1]; }
    else { tx = flat[(i + 1) * 2] - flat[(i - 1) * 2]; tz = flat[(i + 1) * 2 + 1] - flat[(i - 1) * 2 + 1]; }
    const l = Math.hypot(tx, tz) || 1;
    if (i > 0) acc += Math.hypot(x - flat[(i - 1) * 2], z - flat[(i - 1) * 2 + 1]);
    tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    pos.push(x + nx * hw, y, z + nz * hw);
    pos.push(x - nx * hw, y, z - nz * hw);
    uv.push(0, acc, 1, acc);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 经纬度多边形 -> 挤出的三维地块
 * shape 平面用 (x, -z), 再绕 X 轴 -90°, 得到世界 (x, 高度, z)
 */
export function extrudePolygon(flat, height, baseY = 0) {
  const n = flat.length / 2;
  if (n < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(flat[0], -flat[1]);
  for (let i = 1; i < n; i++) shape.lineTo(flat[i * 2], -flat[i * 2 + 1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, baseY, 0);
  return g;
}

/** 多边形 -> 平面几何 (用于公园/湖面等贴合地面的面) */
export function flatPolygon(flat, y = 0) {
  const n = flat.length / 2;
  if (n < 3) return null;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) pos.push(flat[i * 2], y, flat[i * 2 + 1]);
  // 扇形三角化 (数据均为凸度不高的自然地物, 足够用)
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 折线 -> 管状几何 (地铁线路等) */
export function tubeFromFlat(flat, y, radius, maxPts = 420) {
  const th = thinFlat(flat, maxPts);
  const pts = flatToVec3(th, y);
  if (pts.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
  const seg = Math.min(pts.length * 2, 900);
  return new THREE.TubeGeometry(curve, seg, radius, 5, false);
}

/** 折线 -> 细线几何 */
export function lineFromFlat(flat, y) {
  const g = new THREE.BufferGeometry().setFromPoints(flatToVec3(flat, y));
  return g;
}

/** 十六进制颜色 -> THREE.Color (非法值兜底灰) */
export function toColor(hex, fallback = '#8899aa') {
  const c = new THREE.Color();
  try { c.set(hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback); }
  catch (e) { c.set(fallback); }
  return c;
}

/** 线性同余随机, 保证每次刷新建筑外观一致 */
export function makeRand(seed = 1) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 构建均匀网格索引, 用于点击时的最近点查找 */
export function buildGrid(items, cell, getX, getZ) {
  const map = new Map();
  const key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
  items.forEach((it, i) => {
    const k = key(getX(it, i), getZ(it, i));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  return {
    cell,
    /** 返回半径 rad 内最近的 {i, d} */
    nearest(x, z, rad) {
      const r = Math.ceil(rad / cell);
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let bi = -1, bd = rad * rad;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const arr = map.get((cx + dx) + ',' + (cz + dz));
          if (!arr) continue;
          for (const i of arr) {
            const d = (getX(items[i], i) - x) ** 2 + (getZ(items[i], i) - z) ** 2;
            if (d < bd) { bd = d; bi = i; }
          }
        }
      }
      return bi < 0 ? null : { i: bi, d: Math.sqrt(bd) };
    }
  };
}

/** 数字千分位 */
export function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
