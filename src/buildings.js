import * as THREE from 'three';
import { makeRand } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   建筑体块 + 城市街道
   ---------------------------------------------------------
   · 建筑轮廓与高度来自 OSM (building / height / building:levels)
   · 屋顶加一圈描边, 让每栋楼的体量边界看得清
   · 街道由折线加宽成带状路面 (不再是细线), 主干道更宽更亮
   · 地标已精细建模的范围内, 跳过 OSM 粗体块, 避免互相穿插
   ========================================================= */

/** 建筑高度 -> 配色 (底色, 顶色) */
function tone(hm) {
  if (hm >= 200) return [[0.34, 0.64, 0.88], [0.66, 0.94, 1.00]];
  if (hm >= 100) return [[0.26, 0.50, 0.72], [0.48, 0.78, 0.95]];
  if (hm >= 40) return [[0.18, 0.34, 0.53], [0.32, 0.55, 0.76]];
  if (hm >= 18) return [[0.15, 0.26, 0.41], [0.24, 0.40, 0.59]];
  return [[0.13, 0.21, 0.34], [0.19, 0.31, 0.48]];
}

/**
 * @param exclude 地标精模占位圈 [{x,z,rx}] — 圈内的 OSM 体块不再重复生成
 */
export function buildCity({ buildings, roads }, exclude = [], waterExcl = null) {
  const group = new THREE.Group();
  group.name = 'city';
  const rand = makeRand(20240831);
  const BASE_Y = Y.ground;

  /* ============ 地标占位圈的空间索引 ============ */
  // 网格边长取 1km, 查询时只看邻近 9 格
  const CELL = 1.0;
  const exGrid = new Map();
  for (const e of exclude) {
    if (!e || !e.rx) continue;
    const r = Math.max(1, Math.ceil(e.rx / CELL));
    const cx = Math.floor(e.x / CELL), cz = Math.floor(e.z / CELL);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const k = (cx + i) + ':' + (cz + j);
        let a = exGrid.get(k);
        if (!a) exGrid.set(k, a = []);
        a.push(e);
      }
    }
  }
  const inExcluded = (x, z) => {
    const a = exGrid.get(Math.floor(x / CELL) + ':' + Math.floor(z / CELL));
    if (!a) return false;
    for (const e of a) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz <= e.rx * e.rx) return true;
    }
    return false;
  };

  /* ============ v=42: 水面剔除 ============
     落在河/湖里的建筑体块会从水里探出来(建筑从 Y.ground 拔起, 水面在 Y.water)。
     河面用占位圆网格判(与渲染河宽同源), 湖面用包围盒+射线法。 */
  const wtGrid = new Map();
  const WT_CELL = 0.25;
  const wtCircles = (waterExcl && waterExcl.circles) || [];
  for (const c of wtCircles) {
    const r = Math.max(1, Math.ceil(c.r / WT_CELL));
    const gx = Math.floor(c.x / WT_CELL), gz = Math.floor(c.z / WT_CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const k = (gx + i) + ':' + (gz + j);
      let a = wtGrid.get(k);
      if (!a) wtGrid.set(k, a = []);
      a.push(c);
    }
  }
  const inRiver = (x, z) => {
    const a = wtGrid.get(Math.floor(x / WT_CELL) + ':' + Math.floor(z / WT_CELL));
    if (!a) return false;
    for (const c of a) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz <= c.r * c.r) return true;
    }
    return false;
  };
  const wtLakes = (waterExcl && waterExcl.lakes) || [];
  const inLake = (x, z) => {
    for (const L of wtLakes) {
      if (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1) continue;
      const p = L.p, n = p.length / 2;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  const inWater = (x, z) => inRiver(x, z) || inLake(x, z);

  /* ================= 建筑体块 ================= */
  const pos = [], nrm = [], col = [], idx = [];
  const ep = [], ec = [];              // 屋顶描边
  let skipped = 0, made = 0, culled = 0, skippedWater = 0;

  // 鞋带公式求多边形面积 (场景单位²; 1 单位 = 1km → ×1e6 得 m²)
  const polyArea = (p) => {
    let s = 0; const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    return Math.abs(s) / 2;
  };

  for (const b of buildings) {
    const p = b.p, n = p.length / 2;
    if (n < 3 || b.h <= 0) continue;

    // 质心
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= n; cz /= n;

    const hm = b.h / 0.0016;           // 还原为米
    // 地标精模范围内的普通体块跳过; 但超高层地标本体保留 (精模自己会顶掉它)
    if (inExcluded(cx, cz)) { skipped++; continue; }
    /* v=42: 河湖里的体块剔除 —— 不然会从水里探出半个楼 */
    if (inWater(cx, cz)) { skippedWater++; continue; }

    /* v=41: 建筑减量 —— 反馈"有点密且多了"。全市体块实际有 33.4 万栋
       (buildings.json 7114 + buildings_outer.json 32.7 万), 必须按高度分档抽稀:
         <24m 保留 50% / 24~40m 保留 75% / 40~60m 保留 92% / ≥60m 全保
       固定种子随机, 每次刷新一致; 天际线(≥60m)一根不动, 只稀释低层背景体块,
       实测总量约 -27%。 */
    const footM2 = polyArea(p) * 1e6;
    if (footM2 < 160 && hm < 18) { skipped++; continue; }   // 微小体块(车库/门卫/棚)直接删
    const keep = hm < 24 ? 0.50 : hm < 40 ? 0.75 : hm < 60 ? 0.92 : 1.0;
    if (keep < 1 && rand() > keep) { culled++; continue; }
    made++;

    const [base, top] = tone(hm);
    const j = 0.90 + rand() * 0.20;    // 每栋微调, 避免呆板
    const bc = base.map(v => Math.min(1, v * j));
    const tc = top.map(v => Math.min(1, v * j));
    const roofY = BASE_Y + b.h;

    // ---- 顶面 ----
    const t0 = pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos.push(p[i * 2], roofY, p[i * 2 + 1]);
      nrm.push(0, 1, 0);
      col.push(tc[0], tc[1], tc[2]);
    }
    for (let i = 1; i < n - 1; i++) idx.push(t0, t0 + i, t0 + i + 1);

    // ---- 侧面 ----
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const x1 = p[i * 2], z1 = p[i * 2 + 1];
      const x2 = p[k * 2], z2 = p[k * 2 + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const l = Math.hypot(dx, dz) || 1;
      const nx = dz / l, nz = -dx / l;
      const s0 = pos.length / 3;
      pos.push(x1, BASE_Y, z1, x2, BASE_Y, z2, x2, roofY, z2, x1, roofY, z1);
      for (let q = 0; q < 4; q++) nrm.push(nx, 0, nz);
      // 侧面下暗上亮, 模拟城市夜景光照
      const g0 = 0.58, g1 = 1.04;
      col.push(bc[0] * g0, bc[1] * g0, bc[2] * g0);
      col.push(bc[0] * g0, bc[1] * g0, bc[2] * g0);
      col.push(Math.min(1, bc[0] * g1), Math.min(1, bc[1] * g1), Math.min(1, bc[2] * g1));
      col.push(Math.min(1, bc[0] * g1), Math.min(1, bc[1] * g1), Math.min(1, bc[2] * g1));
      idx.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);

      // ---- 屋顶描边: 楼越高描边越亮 ----
      const e = hm >= 100 ? 1.0 : hm >= 40 ? 0.66 : hm >= 18 ? 0.42 : 0.26;
      ep.push(x1, roofY + 0.0015, z1, x2, roofY + 0.0015, z2);
      ec.push(0.52 * e, 0.82 * e, 1.0 * e, 0.52 * e, 0.82 * e, 1.0 * e);
    }
  }

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bg.setIndex(idx);
  bg.computeBoundingSphere();

  const bmat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.58, metalness: 0.46,
    emissive: new THREE.Color('#0a1b30'), emissiveIntensity: 0.9,
  });
  const bmesh = new THREE.Mesh(bg, bmat);
  bmesh.name = 'buildings';
  bmesh.userData.counts = { made, skippedByLandmark: skipped, culledSmall: culled, onWater: skippedWater };
  group.add(bmesh);

  // 屋顶描边
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  eg.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
  const emat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const emesh = new THREE.LineSegments(eg, emat);
  emesh.name = 'buildingEdges';
  group.add(emesh);

  /* ================= 街道路面 ================= */
  // 折线加宽成带状: 每段一个四边形, 两端各外延半个路宽把接头填平
  const ROAD = {
    1: { w: 0.0215, c: [0.62, 0.74, 0.90], y: Y.road + 0.0018 },  // 主干道 ~43m
    2: { w: 0.0105, c: [0.40, 0.52, 0.68], y: Y.road },           // 次干道/支路 ~21m
  };

  const rp = [], rc = [], ri = [];
  let segCount = 0;

  for (const r of roads) {
    const p = r.p, n = p.length / 2;
    if (n < 2) continue;
    const st = ROAD[r.c] || ROAD[2];
    const hw = st.w * 0.5;
    const ry = st.y;

    for (let i = 0; i < n - 1; i++) {
      let x1 = p[i * 2], z1 = p[i * 2 + 1];
      let x2 = p[(i + 1) * 2], z2 = p[(i + 1) * 2 + 1];
      let dx = x2 - x1, dz = z2 - z1;
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      dx /= l; dz /= l;
      // 两端外延, 让相邻段的接缝闭合
      x1 -= dx * hw; z1 -= dz * hw;
      x2 += dx * hw; z2 += dz * hw;
      const nx = dz * hw, nz = -dx * hw;

      const v0 = rp.length / 3;
      rp.push(x1 + nx, ry, z1 + nz);
      rp.push(x2 + nx, ry, z2 + nz);
      rp.push(x2 - nx, ry, z2 - nz);
      rp.push(x1 - nx, ry, z1 - nz);
      for (let q = 0; q < 4; q++) rc.push(st.c[0], st.c[1], st.c[2]);
      ri.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      segCount++;
    }
  }

  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rg.setIndex(ri);
  rg.computeVertexNormals();
  rg.computeBoundingSphere();

  const rmat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.50,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const rmesh = new THREE.Mesh(rg, rmat);
  rmesh.name = 'roads';
  rmesh.renderOrder = 2;
  group.add(rmesh);

  /* ================= 主干道中央双黄线 (路径精修) ================= */
  // 在每段主干道中心生成短黄线, 沿道路方向铺设
  const dashP = [], dashI = [];
  for (const r of roads) {
    if (r.c !== 1) continue;  // 只在主干道画
    const p = r.p, n = p.length / 2;
    if (n < 2) continue;
    const st = ROAD[1];
    for (let i = 0; i < n - 1; i++) {
      const x1 = p[i * 2], z1 = p[i * 2 + 1];
      const x2 = p[(i + 1) * 2], z2 = p[(i + 1) * 2 + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const l = Math.hypot(dx, dz);
      if (l < 0.01) continue;
      const ux = dx / l, uz = dz / l;
      // 每 5m 画一道 2m 长的虚线
      const step = 5, dashLen = 2, gapLen = 3;
      for (let s = 0; s + dashLen < l; s += step + gapLen) {
        const a = s, b = Math.min(s + dashLen, l);
        const p0x = x1 + ux * a, p0z = z1 + uz * a;
        const p1x = x1 + ux * b, p1z = z1 + uz * b;
        // 垂直方向
        const nx = -uz * 0.5, nz = ux * 0.5;
        const v0 = dashP.length / 3;
        dashP.push(p0x + nx, st.y + 0.0005, p0z + nz);
        dashP.push(p1x + nx, st.y + 0.0005, p1z + nz);
        dashP.push(p1x - nx, st.y + 0.0005, p1z - nz);
        dashP.push(p0x - nx, st.y + 0.0005, p0z - nz);
        dashI.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    }
  }
  let dashMesh = null;
  if (dashP.length) {
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dashP, 3));
    dg.setIndex(dashI);
    dg.computeBoundingSphere();
    const dm = new THREE.MeshBasicMaterial({
      color: '#ffd166', transparent: true, opacity: 0.92,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    dashMesh = new THREE.Mesh(dg, dm);
    dashMesh.name = 'roadDashes';
    dashMesh.renderOrder = 3;
    group.add(dashMesh);
  }

  /* ================= 路灯 (沿主干道布设) ================= */
  // 每 50m 一根, 双向道路左右各一根; 杆高 6m, 灯头有 emissive
  // 收集位置
  const lampPositions = [];
  for (const r of roads) {
    if (r.c !== 1) continue;  // 只在主干道装灯
    const p = r.p, n = p.length / 2;
    if (n < 2) continue;
    const st = ROAD[1];
    const hw = st.w * 0.5;
    // v=32: 间距 200m→**300m**, 只在路径长度 > 300m 的主干道上装, 每条路最多 10 根
    // 总量预计降到 ~3000-4000, 视觉上更优雅
    let totalLen = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = p[(i + 1) * 2] - p[i * 2], dz = p[(i + 1) * 2 + 1] - p[i * 2 + 1];
      totalLen += Math.hypot(dx, dz);
    }
    if (totalLen < 0.300) continue;  // < 300m 的短路不装
    let dist = 0;
    let nextLamp = 0.150;  // 起点后 150m 开始
    let sideToggle = 0;
    let countOnRoad = 0;
    const MAX_PER_ROAD = 10;  // 每条路最多 10 根
    for (let i = 0; i < n - 1; i++) {
      const x1 = p[i * 2], z1 = p[i * 2 + 1];
      const x2 = p[(i + 1) * 2], z2 = p[(i + 1) * 2 + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-6) continue;
      const ux = dx / segLen, uz = dz / segLen;
      const nx = -uz, nz = ux;
      let s = Math.max(0, nextLamp - dist);
      while (s <= segLen) {
        if (countOnRoad >= MAX_PER_ROAD) break;
        const px = x1 + ux * s, pz = z1 + uz * s;
        // v=33: 两侧对称 —— 每个位置左右各一根 (不再是 zigzag 单侧)
        lampPositions.push([px + nx * (hw + 0.003), pz + nz * (hw + 0.003), Math.atan2(uz, ux)]);
        lampPositions.push([px - nx * (hw + 0.003), pz - nz * (hw + 0.003), Math.atan2(uz, ux) + Math.PI]);
        sideToggle++;
        countOnRoad++;
        nextLamp += 0.300;  // 300m 一组 (左右各一根)
        s = nextLamp - dist;
      }
      dist += segLen;
    }
  }
  const NL = lampPositions.length;
  /* v=33: 真实比例的"柱顶灯"(post-top lantern) —— 不是之前 38m 的电线杆
     场景单位: 1 单位 = 625m, 所以 1m = 0.0016 单位
     · 灯杆: 9m 高 = 0.0144 单位, 下粗上细的锥形 (底 0.0010 / 顶 0.0005)
     · 灯罩: 杆顶的方形灯罩 (~1.2m 见方 = 0.002), 夜间发光
     · 顶珠: 灯罩上的小圆球装饰
     · 灯托: 杆与灯罩之间的收口 (更真实) */
  const poleGeo = new THREE.CylinderGeometry(0.0005, 0.0010, 0.0144, 8);
  poleGeo.translate(0, 0.0072, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2a3340', roughness: 0.4, metalness: 0.7 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, NL));
  poleMesh.name = 'streetPoles';
  // 灯罩 (方形, 夜间发光)
  const headGeo = new THREE.BoxGeometry(0.0020, 0.0022, 0.0020);
  headGeo.translate(0, 0.0165, 0);
  // 顶珠 (白天也可见的小装饰)
  const headTopGeo = new THREE.SphereGeometry(0.0006, 8, 6);
  headTopGeo.translate(0, 0.0180, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: '#fff8e0', emissive: '#ffb347', emissiveIntensity: 0.15,
    roughness: 0.3, metalness: 0.2,
  });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, NL));
  headMesh.name = 'streetHeads';
  const headTopMesh = new THREE.InstancedMesh(headTopGeo, headMat, Math.max(1, NL));
  headTopMesh.name = 'streetHeadTops';
  // 灯托 (杆顶与灯罩之间的收口圆盘, 让连接更自然)
  const armGeo = new THREE.CylinderGeometry(0.0012, 0.0008, 0.0012, 8);
  armGeo.translate(0, 0.0148, 0);
  const armMat = new THREE.MeshStandardMaterial({ color: '#2a3340', roughness: 0.4, metalness: 0.7 });
  const armMesh = new THREE.InstancedMesh(armGeo, armMat, Math.max(1, NL));
  armMesh.name = 'streetArms';
  // 地面光圈 (夜间才可见, 用平面环)
  const glowGeo = new THREE.RingGeometry(0.001, 0.012, 16);
  glowGeo.rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({
    color: '#ffd47a', transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, Math.max(1, NL));
  glowMesh.name = 'streetGlow';
  poleMesh.count = NL;
  headMesh.count = NL;
  headTopMesh.count = NL;
  armMesh.count = NL;
  glowMesh.count = NL;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < NL; i++) {
    const [px, pz, ang] = lampPositions[i];
    dummy.position.set(px, Y.ground + 0.002, pz);
    dummy.rotation.set(0, ang, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    headMesh.setMatrixAt(i, dummy.matrix);
    headTopMesh.setMatrixAt(i, dummy.matrix);
    armMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, Y.ground + 0.003, pz);
    dummy.updateMatrix();
    glowMesh.setMatrixAt(i, dummy.matrix);
  }
  poleMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  headTopMesh.instanceMatrix.needsUpdate = true;
  armMesh.instanceMatrix.needsUpdate = true;
  glowMesh.instanceMatrix.needsUpdate = true;
  group.add(poleMesh, headMesh, headTopMesh, armMesh, glowMesh);

  return {
    group,
    buildingMesh: bmesh,
    buildingEdges: emesh,
    roadMesh: rmesh,
    roadDashes: dashMesh,
    streetPoles: poleMesh,
    streetHeads: headMesh,
    streetArms: armMesh,
    streetGlow: glowMesh,
    builtCount: made,
    skippedCount: skipped,
    roadSegments: segCount,
    triCount: idx.length / 3 + ri.length / 3,
    streetLightCount: NL,
    /** 图层开关: 建筑体块与描边一起显隐 */
    setBuildings(v) { bmesh.visible = v; emesh.visible = v; },
    setRoads(v) {
      rmesh.visible = v;
      if (dashMesh) dashMesh.visible = v;
      poleMesh.visible = v;
      headMesh.visible = v;
      headTopMesh.visible = v;
      armMesh.visible = v;
      glowMesh.visible = v;
    },
    /** 夜间模式: 灯头发光 + 地面光圈 */
    setNightMode(v) {
      headMat.emissiveIntensity = v ? 1.6 : 0.15;
      glowMat.opacity = v ? 0.55 : 0.0;
    },
  };
}
