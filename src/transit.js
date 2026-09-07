import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tubeFromFlat, toColor, buildGrid, makeRand } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   轨道交通与公交
   ---------------------------------------------------------
   线路走向、站点、线路编号与官方配色均来自 OSM route relation。
   视觉优化:
     · 地铁线 = 霓虹管线(带亮芯), 不再是一条死板的管子
     · 地铁站 = 彩色圆点节点 + 落地环, 换乘枢纽为金色光环
     · 公交站 = 真实候车亭(雨棚 + 立柱 + 背板 + 站牌杆)
   ========================================================= */

/* 地铁线网原浮在 620m 高空 (Y.metro=0.62), 改为贴地敷设:
   · 线路管线贴着街道层上方 (METRO_LINE_Y), 不再悬空
   · 站点节点 / 标牌 / 名称标注在街道层之上 (METRO_NODE_Y), 便于点击与读图 */
const METRO_LINE_Y = Y.road + 0.012;
const METRO_NODE_Y = Y.road + 0.045;
const BUS_Y = Y.ground;            // 候车亭/站牌/电话亭贴地; 旧 +0.003 仍有视觉抬高, 直接坐到地面

/* ---------------- 标牌贴图 (canvas 现画) ---------------- */
function signTexture(kind) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');

  if (kind === 'metro') {
    g.fillStyle = '#d2232a';
    const r = 26;
    g.beginPath();
    g.moveTo(r, 0); g.lineTo(S - r, 0); g.quadraticCurveTo(S, 0, S, r);
    g.lineTo(S, S - r); g.quadraticCurveTo(S, S, S - r, S);
    g.lineTo(r, S); g.quadraticCurveTo(0, S, 0, S - r);
    g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.92)';
    g.lineWidth = 7;
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 84px "Arial Black",Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('M', S / 2, S / 2 + 4);
  } else if (kind === 'bus') {
    /* 现代化公交站牌: 深色圆角面板 + 青绿顶条 + 白色巴士图形 (取代旧的黄框 BUS 方块) */
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.closePath();
    };
    g.fillStyle = '#16202e';                       // 面板底
    rr(5, 5, S - 10, S - 10, 18); g.fill();
    g.fillStyle = '#17c3a0';                       // 顶部青绿条
    rr(5, 5, S - 10, 24, 14); g.fill();
    g.fillStyle = '#0f1826';                       // 顶条下分隔
    g.fillRect(5, 26, S - 10, 5);
    g.fillStyle = '#f2f7fb';                       // 巴士车身
    rr(30, 44, 68, 42, 9); g.fill();
    g.fillStyle = '#16202e';                       // 车窗
    g.fillRect(37, 51, 21, 14);
    g.fillRect(62, 51, 21, 14);
    g.fillStyle = '#16202e';                       // 车轮
    g.beginPath(); g.arc(44, 88, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(84, 88, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8fa6bd';                       // 文字
    g.font = 'bold 16px Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BUS', S / 2, 111);
  } else if (kind === 'phone') {
    /* 公用电话招牌: 深色面板 + 青绿条 + "公用电话" 文字 */
    g.fillStyle = '#0e1828';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#19c7d8';
    g.fillRect(0, 0, S, 26);
    g.fillStyle = '#0f1826';
    g.fillRect(0, 26, S, 4);
    g.fillStyle = '#f2f7fb';
    g.font = 'bold 24px "PingFang SC","Microsoft YaHei",Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('公用电话', S / 2, 56);
    g.fillStyle = '#7fb6e8';
    g.font = '14px "PingFang SC","Microsoft YaHei",Arial,sans-serif';
    g.fillText('PUBLIC  PHONE', S / 2, 86);
    g.fillStyle = '#19c7d8';
    g.fillRect(30, 100, S - 60, 3);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SIGNS = { metro: signTexture('metro'), bus: signTexture('bus'), phone: signTexture('phone') };

/* ============ v=40: 地铁"几号线"圆形徽标 ============
   25 条线颜色各异, 光看颜色分不清是几号线。这里在每条线的路径上按间隔放置
   线路官方配色的圆形号码牌(白圈+白字, 与真实地铁线路标识一致)。
   非数字编号(磁浮/金山铁路/机场线/捷运等)用短名显示。 */
function shortLineRef(ref) {
  const r = String(ref == null ? '' : ref);
  if (/^\d+$/.test(r)) return r;                       // 1 ~ 18 号线
  if (r === '磁浮') return '磁浮';
  if (r === '金山铁路') return '金山';
  if (r === '市域机场线') return '机场线';
  if (r === '浦东机场捷运东线') return '捷运东';
  if (r === '浦东机场捷运西线') return '捷运西';
  if (r === '浦江') return '浦江';
  if (/^Z/i.test(r)) return r.split('/')[0];
  return r.slice(0, 3);
}
function lineBadgeTexture(ref, colorHex) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = 50;
  // 暗色外描边: 保证在浅色底图/雪白建筑上也看得清
  g.beginPath(); g.arc(cx, cy, R + 8, 0, Math.PI * 2);
  g.fillStyle = 'rgba(3,8,16,0.86)'; g.fill();
  // 线路官方色圆盘
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fillStyle = colorHex || '#7fb6e8'; g.fill();
  // 白色内圈
  g.beginPath(); g.arc(cx, cy, R - 7, 0, Math.PI * 2);
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.stroke();
  // 线路号
  const txt = shortLineRef(ref);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const size = txt.length >= 3 ? 30 : (txt.length === 2 ? 46 : 58);
  g.font = 'bold ' + size + 'px "Arial Black","PingFang SC","Microsoft YaHei",Arial,sans-serif';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.strokeText(txt, cx, cy + 2);
  g.fillStyle = '#ffffff';
  g.fillText(txt, cx, cy + 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildTransit({ metro, bus }) {
  const group = new THREE.Group();
  group.name = 'transit';
  const rand = makeRand(19930410);
  const dummy = new THREE.Object3D();

  /* ================= 地铁 ================= */
  const metroGroup = new THREE.Group();
  metroGroup.name = 'metroLayer';
  group.add(metroGroup);

  // ---- 线路: 霓虹管线 + 亮芯 ----
  const lineMeshes = new Map();
  const lineGroup = new THREE.Group();
  lineGroup.name = 'metroLines';
  const lineCore = new THREE.Group();
  lineGroup.name = 'metroLineCores';

  for (const l of metro.lines) {
    // v=38: 用户反馈"地铁线有点粗" —— 管径 0.020 → 0.011 (约 11m, 约为原宽 55%),
    //   同时降低自发光与不透明度, 让它更像"图上的轨道线"而不是粗霓虹管
    const geo = tubeFromFlat(l.path, METRO_LINE_Y, 0.011, 460);
    if (!geo) continue;
    const col = toColor(l.color, '#7fb6e8');
    const tubeMat = new THREE.MeshStandardMaterial({
      color: col, emissive: col.clone().multiplyScalar(0.36),
      roughness: 0.36, metalness: 0.34,
      transparent: true, opacity: 0.78,
    });
    const m = new THREE.Mesh(geo, tubeMat);
    m.userData = { type: 'metroLine', line: l };
    lineGroup.add(m);
    lineMeshes.set(l.ref, m);

    // 细亮芯(方向指引), v=38: 0.005 → 0.0032, 与主管道同步收细
    const coreGeo = new THREE.TubeGeometry(
      (() => {
        const pts = [];
        for (let i = 0; i < l.path.length; i += 2) pts.push(new THREE.Vector3(l.path[i], METRO_LINE_Y + 0.001, l.path[i + 1]));
        if (pts.length < 2) return null;
        return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
      })(), 320, 0.0032, 6, false);
    if (coreGeo) {
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
        color: col.clone().lerp(new THREE.Color('#ffffff'), 0.65),
        transparent: true, opacity: 0.45, toneMapped: false,
      }));
      lineCore.add(core);
    }
  }
  metroGroup.add(lineGroup, lineCore);

  // ---- 站点节点: 彩色圆点 + 落地环 ----
  const stations = metro.stations;
  /* v=42b: 枢纽站点合并显示 —— OSM 里同一枢纽每条线各有一条站点记录,
     上海南站就有 1/3/15/金山铁路 4 条记录叠在同一位置, 节点/落地环/站牌/
     站名标签互相叠加成一团。这里把 90m 内的记录并成一个显示节点(线路取并集,
     名字取最长的那条), 渲染只用 disp; 拾取网格仍用原始 stations。 */
  const disp = [];
  const _used = new Array(stations.length).fill(false);
  for (let i = 0; i < stations.length; i++) {
    if (_used[i]) continue;
    _used[i] = true;
    const a = stations[i];
    const node = { name: a.name, x: a.x, z: a.z, lines: a.lines.slice() };
    for (let j = i + 1; j < stations.length; j++) {
      if (_used[j]) continue;
      const b = stations[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 0.09) continue;
      _used[j] = true;
      for (const lf of b.lines) if (!node.lines.includes(lf)) node.lines.push(lf);
      if (b.name.length > node.name.length) node.name = b.name;
    }
    disp.push(node);
  }
  const NS = disp.length;
  const stScale = disp.map(s => 1 + Math.min(s.lines.length, 5) * 0.12);

  const nodeGeo = new THREE.SphereGeometry(0.032, 14, 12);
  const nodeMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.3, emissiveIntensity: 0.7 });
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, NS);
  nodeMesh.name = 'metroNodes';
  const nodeCol = new THREE.Color();
  const padGeo = new THREE.RingGeometry(0.034, 0.052, 24);
  const padMat = new THREE.MeshBasicMaterial({ color: '#cfe0f5', transparent: true, opacity: 0.40, side: THREE.DoubleSide, depthWrite: false });
  const padMesh = new THREE.InstancedMesh(padGeo, padMat, NS);
  padMesh.name = 'metroPads';

  // 立柱 + 标牌
  const poleGeo = new THREE.CylinderGeometry(0.004, 0.006, 0.024, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#aab9cc'), roughness: 0.4, metalness: 0.6 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, NS);
  const signGeo = new THREE.PlaneGeometry(0.052, 0.052);
  const signMat = new THREE.MeshBasicMaterial({ map: SIGNS.metro, transparent: true, side: THREE.DoubleSide, toneMapped: false });
  const signMesh = new THREE.InstancedMesh(signGeo, signMat, NS);
  signMesh.name = 'metroSigns';

  const SIGN_TILT = THREE.MathUtils.degToRad(52);
  const SIGN_H = 0.024 + 0.020;

  /* v=49 性能: 原来视角每转 2° 就全量重算 453 站 × 5 套矩阵 + 4 次大缓冲上传,
     拖动时每帧都触发 => 主要卡顿源。拆成两层:
     · layoutStationsStatic(): 节点/落地环(与朝向无关)只在初始化时算一次;
     · layoutStationsYaw(): 只有立柱/站牌依赖朝向, 视角变化时仅更新这两套(453×2)。 */
  function layoutStationsStatic() {
    for (let i = 0; i < NS; i++) {
      const s = disp[i];
      const k = stScale[i];
      const colHex = s.lines.length >= 3 ? '#ffd166'
        : (data_lineColor(metro, s.lines[0]) || '#cfe0f5');
      nodeCol.set(colHex);
      nodeMesh.setColorAt(i, nodeCol);

      dummy.position.set(s.x, METRO_NODE_Y + 0.004, s.z);
      dummy.scale.setScalar(k);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      nodeMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, METRO_NODE_Y + 0.001, s.z);
      dummy.scale.setScalar(k);
      dummy.updateMatrix();
      padMesh.setMatrixAt(i, dummy.matrix);
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    padMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
  }
  layoutStationsStatic();

  function layoutStationsYaw(yaw) {
    for (let i = 0; i < NS; i++) {
      const s = disp[i];
      const k = stScale[i];
      dummy.position.set(s.x, METRO_NODE_Y + 0.012 * k, s.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(k);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, METRO_NODE_Y + SIGN_H * k, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.rotateY(yaw);
      dummy.rotateX(-SIGN_TILT);
      dummy.scale.setScalar(k);
      dummy.updateMatrix();
      signMesh.setMatrixAt(i, dummy.matrix);
    }
    poleMesh.instanceMatrix.needsUpdate = true;
    signMesh.instanceMatrix.needsUpdate = true;
  }
  layoutStationsYaw(0);   // v=49: 静态层已在上方自调用, 这里只补朝向层

  nodeMesh.userData = { type: 'metroStations' };
  metroGroup.add(nodeMesh, padMesh, poleMesh, signMesh);

  // ---- 换乘枢纽光环 (2 线及以上都画, 大站更亮) ----
  const hubGeo = new THREE.RingGeometry(0.042, 0.068, 32);
  const hubMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166'), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const hubs = disp.filter(s => s.lines.length >= 2);
  const hubMesh = new THREE.InstancedMesh(hubGeo, hubMat, Math.max(1, hubs.length));
  hubs.forEach((s, i) => {
    dummy.position.set(s.x, METRO_NODE_Y + 0.002, s.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(1 + s.lines.length * 0.10);
    dummy.updateMatrix();
    hubMesh.setMatrixAt(i, dummy.matrix);
  });
  hubMesh.count = hubs.length;
  hubMesh.instanceMatrix.needsUpdate = true;
  hubMesh.name = 'metroHubs';
  hubMesh.renderOrder = 3;
  metroGroup.add(hubMesh);

  // ---- 换乘站菱形标识 (2 线及以上, 节点之上方块+连线柱, 远看立刻识别出"换乘") ----
  const xferList = disp.filter(s => s.lines.length >= 2);
  /* v=42b: 原先 45m 立柱 + 52~84m 方块, 且 metalness 0.55 无环境反射 => 远看是黑柱黑块;
     缩小一档 + 降金属度提亮, 换乘标识保留但不再压过站点本身 */
  const xferColGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 0.030, 6);
  const xferColMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9c6d6'), roughness: 0.55, metalness: 0.25 });
  const xferColMesh = new THREE.InstancedMesh(xferColGeo, xferColMat, Math.max(1, xferList.length));
  const xferTopGeo = new THREE.BoxGeometry(0.026, 0.026, 0.026);
  const xferTopMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffd166'), roughness: 0.48, metalness: 0.22,
    emissive: new THREE.Color('#c98f1e'), emissiveIntensity: 0.45,
  });
  const xferTopMesh = new THREE.InstancedMesh(xferTopGeo, xferTopMat, Math.max(1, xferList.length));
  xferList.forEach((s, i) => {
    dummy.position.set(s.x, METRO_NODE_Y + 0.016, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    xferColMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, METRO_NODE_Y + 0.033, s.z);
    dummy.rotation.set(0, Math.PI / 4, 0);
    dummy.scale.setScalar(1 + s.lines.length * 0.06);
    dummy.updateMatrix();
    xferTopMesh.setMatrixAt(i, dummy.matrix);
  });
  xferColMesh.count = xferList.length;
  xferTopMesh.count = xferList.length;
  xferColMesh.instanceMatrix.needsUpdate = true;
  xferTopMesh.instanceMatrix.needsUpdate = true;
  xferColMesh.name = 'metroXferCol';
  xferTopMesh.name = 'metroXferTop';
  xferColMesh.renderOrder = 4;
  xferTopMesh.renderOrder = 4;
  metroGroup.add(xferColMesh, xferTopMesh);

  /* ---- 站点名称 + 线路编号标注 (canvas 贴图 sprite) ---- */
  function metroLabelTexture(name, refs) {
    const W = 256, H = 64;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.font = 'bold 30px "PingFang SC","Microsoft YaHei",Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,8,16,0.85)';
    g.strokeText(name, W / 2, 22);
    g.fillStyle = '#ffffff';
    g.fillText(name, W / 2, 22);
    // 线路编号
    const txt = refs.join('/');
    g.font = 'bold 22px "Arial",sans-serif';
    g.lineWidth = 4;
    g.strokeText(txt, W / 2, 50);
    g.fillStyle = '#ffe08a';
    g.fillText(txt, W / 2, 50);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const labelGroup = new THREE.Group();
  labelGroup.name = 'metroLabels';
  const labelInfos = [];
  for (let i = 0; i < NS; i++) {
    const s = disp[i];
    const refs = s.lines.map(r => metro.lines.find(l => l.ref === r)).filter(Boolean)
      .map(l => l.name.replace('号线', ''));
    const tex = metroLabelTexture(s.name, refs);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.16, 0.04, 1);
    sp.position.set(s.x, METRO_NODE_Y + 0.085, s.z);
    sp.visible = false;
    sp.renderOrder = 5;
    labelGroup.add(sp);
    labelInfos.push({ sp, x: s.x, z: s.z, y: METRO_NODE_Y + 0.085 });
  }
  metroGroup.add(labelGroup);

  /* ---- v=40: 线路号徽标 (沿线路按间隔摆放, 挂在 metroGroup 下随图层开关) ----
     LOD 分级: 每条线中点那枚(lod0)在远景也显示, 便于总览时一眼分辨哪条是几号线;
     拉近后逐级补入更多枚, 避免远景糊成一片。 */
  const badgeGroup = new THREE.Group();
  badgeGroup.name = 'metroLineBadges';
  const badgeInfos = [];
  const BADGE_SPACING = 3.2;                    // 约 2.7km 一枚
  const BADGE_Y = METRO_NODE_Y + 0.10;
  for (const l of metro.lines) {
    const p = l.path;
    if (!p || p.length < 8) continue;
    // 沿线累计长度
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) {
      cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    }
    const total = cum[cum.length - 1];
    if (total < 2.5) continue;                  // 太短的支线不放, 免得挤在一起
    const tex = lineBadgeTexture(l.ref, toColor(l.color, '#7fb6e8').getStyle());
    const n = Math.max(1, Math.min(12, Math.floor(total / BADGE_SPACING)));
    const mid = Math.floor(n / 2);
    for (let b = 0; b < n; b++) {
      const target = total * (b + 0.5) / n;
      let idx = 1;
      while (idx < cum.length - 1 && cum[idx] < target) idx++;
      const x = p[idx * 2], z = p[idx * 2 + 1];
      // depthTest:false —— 线路标识要"一眼看见是几号线", 不能被楼块挡住
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      }));
      sp.position.set(x, BADGE_Y, z);
      sp.visible = false;
      sp.renderOrder = 8;
      badgeGroup.add(sp);
      badgeInfos.push({ sp, x, z, y: BADGE_Y, lod: b === mid ? 0 : (b % 2 === 0 ? 1 : 2) });
    }
  }
  metroGroup.add(badgeGroup);

  /* ================= 公交候车亭 ================= */
  const busGroup = new THREE.Group();
  busGroup.name = 'busStops';
  const stops = bus.stops;
  const NB = stops.length;

  /* 去重: 同名/邻近(≤25m)的站点只渲染一个候车亭, 避免 2~3 个挤在一起 */
  const stopRoutes = bus.stopRoutes || {};
  const rcount = new Array(NB).fill(0);
  for (let i = 0; i < NB; i++) { const a = stopRoutes[String(i)]; rcount[i] = a ? a.length : 0; }
  const order = [...Array(NB).keys()].sort((a, b) => rcount[b] - rcount[a]); // 线路多者优先
  const kept = [], okPos = [];
  for (const i of order) {
    const s = stops[i]; let dup = false;
    for (const k of okPos) { if (Math.hypot(s.x - k.x, s.z - k.z) < 0.025) { dup = true; break; } }
    if (dup) continue;
    kept.push(i); okPos.push(s);
  }
  const NSHEL = kept.length;
  const yawOf = new Map();
  for (const i of kept) yawOf.set(i, rand() * Math.PI);

  /* 候车亭几何: 框架(不透明) + 玻璃(半透明) 两套, 各一个 InstancedMesh */
  const frameParts = [], glassParts = [];
  const add = (arr, g) => { arr.push(g); };
  // 顶棚(略带前檐)
  add(frameParts, new THREE.BoxGeometry(0.076, 0.008, 0.034).translate(0, 0.048, 0));
  add(frameParts, new THREE.BoxGeometry(0.080, 0.004, 0.038).translate(0, 0.043, 0)); // 檐口
  // 四立柱
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(frameParts, new THREE.CylinderGeometry(0.0024, 0.0024, 0.046, 8)
      .translate(sx * 0.032, 0.023, sz * 0.013));
  }
  // 背墙框架 + 顶横梁
  add(frameParts, new THREE.BoxGeometry(0.004, 0.034, 0.030).translate(-0.032, 0.024, 0));
  // 长椅
  add(frameParts, new THREE.BoxGeometry(0.050, 0.005, 0.012).translate(-0.002, 0.014, 0.006));
  // 长椅靠背 + 椅腿
  add(frameParts, new THREE.BoxGeometry(0.050, 0.012, 0.004).translate(-0.002, 0.019, 0.011));
  for (const sx of [-1, 1]) add(frameParts, new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 6)
    .translate(-0.002 + sx * 0.020, 0.008, 0.006));
  // 顶棚横梁 (两道, 让屋盖有结构感)
  for (const sx of [-1, 1]) add(frameParts, new THREE.BoxGeometry(0.002, 0.004, 0.034)
    .translate(sx * 0.026, 0.045, 0));
  // 侧向连杆 (上下两道横杆, 现代候车亭样式)
  for (const sy of [0.012, 0.038]) add(frameParts, new THREE.BoxGeometry(0.064, 0.0016, 0.0016)
    .translate(0, sy, -0.014));
  // 立柱底座
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(frameParts, new THREE.CylinderGeometry(0.0042, 0.0048, 0.003, 8)
      .translate(sx * 0.032, 0.0015, sz * 0.013));
  }
  // 垃圾桶
  add(frameParts, new THREE.CylinderGeometry(0.0052, 0.0044, 0.012, 10).translate(0.030, 0.006, 0.010));
  add(frameParts, new THREE.CylinderGeometry(0.0056, 0.0056, 0.0018, 10).translate(0.030, 0.0128, 0.010));
  // 玻璃: 背板 + 两侧 + 前下
  add(glassParts, new THREE.BoxGeometry(0.002, 0.030, 0.028).translate(-0.030, 0.026, 0));
  for (const sz of [-1, 1]) add(glassParts, new THREE.BoxGeometry(0.062, 0.028, 0.002).translate(0, 0.026, sz * 0.014));
  add(glassParts, new THREE.BoxGeometry(0.062, 0.016, 0.002).translate(0, 0.018, 0.015));

  const frameGeo = mergeGeometries(frameParts, false);
  const glassGeo = mergeGeometries(glassParts, false);
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7c8ea3'), roughness: 0.55, metalness: 0.5,
    emissive: new THREE.Color('#3a4658'), emissiveIntensity: 0.3,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#bfe6ff'), roughness: 0.15, metalness: 0.0,
    transparent: true, opacity: 0.42, depthWrite: false,
    emissive: new THREE.Color('#2a4d6b'), emissiveIntensity: 0.2,
  });
  const shelterFrame = new THREE.InstancedMesh(frameGeo, frameMat, NSHEL);
  shelterFrame.name = 'busShelters';
  const shelterGlass = new THREE.InstancedMesh(glassGeo, glassMat, NSHEL);
  shelterGlass.name = 'busShelterGlass';
  shelterGlass.renderOrder = 2;

  // 站牌杆 + BUS 牌 (尺寸按真实站牌比例缩小: 旧值 30×21 m 比公交车还大)
  const plateGeo = new THREE.PlaneGeometry(0.0115, 0.0082);
  const plateMat = new THREE.MeshBasicMaterial({ map: SIGNS.bus, transparent: true, side: THREE.DoubleSide, toneMapped: false });
  const plateMesh = new THREE.InstancedMesh(plateGeo, plateMat, NSHEL);
  plateMesh.name = 'busPlates';

  /* v=42: 候车亭发光配件(第三套 InstancedMesh) —— 夜间灯带/线路信息牌/广告灯箱。
     原先只有框架+玻璃两套材质, 夜里整座亭子黑乎乎; 上海真实候车亭夜里是亮着的。 */
  const accentParts = [];
  // 顶棚下灯带 ×2 (长边沿 Z, 模拟亭内照明)
  for (const sx of [-1, 1]) accentParts.push(new THREE.BoxGeometry(0.0030, 0.0022, 0.030).translate(sx * 0.020, 0.0425, 0));
  // 背墙线路信息牌 (背板玻璃内侧, 乘客一眼看到线路)
  accentParts.push(new THREE.BoxGeometry(0.0012, 0.012, 0.020).translate(-0.0286, 0.026, 0));
  // 广告灯箱 (背墙外侧下半部, 上海候车亭标配)
  accentParts.push(new THREE.BoxGeometry(0.0016, 0.014, 0.030).translate(-0.0280, 0.013, 0));
  const accentGeo = mergeGeometries(accentParts, false);
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#eef4ff'), roughness: 0.4, metalness: 0.1,
    emissive: new THREE.Color('#ffe9b8'), emissiveIntensity: 0.95,
  });
  const shelterAccent = new THREE.InstancedMesh(accentGeo, accentMat, NSHEL);
  shelterAccent.name = 'busShelterAccent';

  /* ---- 公共电话亭 (上海街头仍在服役的公用电话亭) ----
     每 4 座候车亭旁立 1 座; 金属框架 + 半透玻璃, 沿用候车亭的多材质合并做法。 */
  const boothIdx = [];
  kept.forEach((i, m) => { if (m % 4 === 0) boothIdx.push({ i, m }); });
  const NBOOT = Math.max(1, boothIdx.length);
  const BW = 0.011, BD = 0.009, BH = 0.026;   // 视觉放大后的电话亭 (实物 ~1.1×0.9×2.6 m, ×10 便于远景辨认)
  const bFrame = [], bGlass = [];
  const badd = (arr, g) => { arr.push(g); };
  // 底座 (带门槛 + 上台踏步)
  badd(bFrame, new THREE.BoxGeometry(0.0146, 0.0026, 0.0126).translate(0, 0.0013, 0));
  badd(bFrame, new THREE.BoxGeometry(0.0120, 0.0016, 0.0096).translate(0, 0.0032, 0.0006)); // 门槛
  badd(bFrame, new THREE.BoxGeometry(0.0140, 0.0008, 0.0120).translate(0, 0.0044, 0));    // 踏步台
  // 四角立柱 (上细下粗, 铝合金立柱感)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    badd(bFrame, new THREE.BoxGeometry(0.0016, BH, 0.0016)
      .translate(sx * (BW / 2 - 0.0008), BH / 2, sz * (BD / 2 - 0.0008)));
  }
  // 中部横梁 (加强结构感, 上下两道)
  for (const sy of [BH * 0.34, BH * 0.66]) for (const sx of [-1, 1])
    badd(bFrame, new THREE.BoxGeometry(0.0012, 0.0010, BD - 0.0030)
      .translate(sx * (BW / 2 - 0.0009), sy, 0));
  // 顶盖 (双层: 主盖板 + 出檐) + 顶置天线 (老式公用电话亭馈线杆)
  badd(bFrame, new THREE.BoxGeometry(BW + 0.004, 0.0020, BD + 0.004).translate(0, BH + 0.0010, 0));
  badd(bFrame, new THREE.BoxGeometry(BW + 0.0008, 0.0011, BD + 0.0008).translate(0, BH + 0.0025, 0));
  badd(bFrame, new THREE.CylinderGeometry(0.0007, 0.0004, 0.013, 5).translate(0, BH + 0.0105, 0));
  // 背板 (上半) + 话机面板 (中部嵌银灰色金属板, 上有听筒挂钩、拨号键盘位、显示屏位)
  badd(bFrame, new THREE.BoxGeometry(BW - 0.002, BH * 0.34, 0.0012).translate(0, BH * 0.80, -(BD / 2 - 0.0012)));
  badd(bFrame, new THREE.BoxGeometry(0.0050, 0.0090, 0.0018).translate(0, BH * 0.54, -(BD / 2 - 0.0018)));
  badd(bFrame, new THREE.BoxGeometry(0.0040, 0.0018, 0.0010).translate(0, BH * 0.72, -(BD / 2 - 0.0020))); // 听筒挂钩
  badd(bFrame, new THREE.BoxGeometry(0.0030, 0.0014, 0.0010).translate(0, BH * 0.50, -(BD / 2 - 0.0020))); // 显示屏槽
  badd(bFrame, new THREE.BoxGeometry(0.0034, 0.0020, 0.0010).translate(0, BH * 0.42, -(BD / 2 - 0.0020))); // 拨号键盘
  // 内置折叠座椅 (靠背墙, 长条凳)
  badd(bFrame, new THREE.BoxGeometry(BW * 0.62, 0.0008, 0.0020).translate(-BW * 0.10, BH * 0.20, -(BD / 2 - 0.0022))); // 座板
  badd(bFrame, new THREE.BoxGeometry(BW * 0.62, 0.0050, 0.0008).translate(-BW * 0.10, BH * 0.36, -(BD / 2 - 0.0014))); // 靠背
  // 话机: 银灰色主机体 + 黑色听筒 (T 字造型, 置于话机面板前)
  badd(bFrame, new THREE.BoxGeometry(0.0036, 0.0018, 0.0014).translate(0, BH * 0.72, -(BD / 2 - 0.0024))); // 话机主体
  badd(bFrame, new THREE.BoxGeometry(0.0020, 0.0012, 0.0026).translate(0, BH * 0.74, -(BD / 2 - 0.0036))); // 听筒横柄
  // 硬币投币口 (话机主体右侧的细缝)
  badd(bFrame, new THREE.BoxGeometry(0.0008, 0.0003, 0.0016).translate(0.0014, BH * 0.695, -(BD / 2 - 0.0025)));
  // 状态指示灯 (顶部小红灯, 微微发光, 用 emissive 颜色让金属材质亮起来)
  badd(bFrame, new THREE.BoxGeometry(0.0006, 0.0006, 0.0006).translate(-0.002, BH * 0.76, -(BD / 2 - 0.0020)));
  // 前门框 (门洞四周细框, 一眼认出"电话亭门")
  for (const sy of [BH * 0.10, BH * 0.74]) badd(bFrame, new THREE.BoxGeometry(BW - 0.002, 0.0014, 0.0010).translate(0, sy, BD / 2 - 0.0008));
  for (const sx of [-1, 1]) badd(bFrame, new THREE.BoxGeometry(0.0014, BH * 0.66, 0.0010).translate(sx * (BW / 2 - 0.0009), BH * 0.42, BD / 2 - 0.0008));
  // 门把手 (前框中部, 一侧竖短杆)
  badd(bFrame, new THREE.BoxGeometry(0.0010, 0.0030, 0.0008).translate(BW * 0.30, BH * 0.42, BD / 2 - 0.0008));
  // 玻璃: 前 / 后 / 两侧 (更通透)
  badd(bGlass, new THREE.BoxGeometry(BW - 0.003, BH * 0.62, 0.0010).translate(0, BH * 0.42, BD / 2 - 0.0009));
  badd(bGlass, new THREE.BoxGeometry(BW - 0.003, BH * 0.62, 0.0010).translate(0, BH * 0.42, -(BD / 2 - 0.0009)));
  for (const sx of [-1, 1]) {
    badd(bGlass, new THREE.BoxGeometry(0.0010, BH * 0.62, BD - 0.003).translate(sx * (BW / 2 - 0.0009), BH * 0.42, 0));
  }
  const boothFrameGeo = mergeGeometries(bFrame, false);
  const boothGlassGeo = mergeGeometries(bGlass, false);
  const boothMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cdd7e2'), roughness: 0.42, metalness: 0.55,
    emissive: new THREE.Color('#2b3a4f'), emissiveIntensity: 0.18,
  });
  const boothGlassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d6f0ff'), roughness: 0.10, metalness: 0.0,
    transparent: true, opacity: 0.30, depthWrite: false,
    emissive: new THREE.Color('#2a6f8f'), emissiveIntensity: 0.28,
  });
  const boothFrame = new THREE.InstancedMesh(boothFrameGeo, boothMat, NBOOT);
  boothFrame.name = 'phoneBooths';
  const boothGlassM = new THREE.InstancedMesh(boothGlassGeo, boothGlassMat, NBOOT);
  boothGlassM.name = 'phoneBoothGlass';
  boothGlassM.renderOrder = 2;
  // 顶部发光招牌: "公用电话" 文字灯箱 (独立材质 + canvas 贴图, 不参与几何合并)
  const boothSignGeo = new THREE.PlaneGeometry(BW - 0.0030, 0.0054);
  const boothSignMat = new THREE.MeshBasicMaterial({ map: SIGNS.phone, transparent: true, side: THREE.DoubleSide, toneMapped: false });
  const boothSign = new THREE.InstancedMesh(boothSignGeo, boothSignMat, NBOOT);
  boothSign.name = 'phoneBoothSign';
  /* v=42: 电话亭内部顶灯 —— 夜里整亭亮起来, 远景一眼认出是电话亭 */
  const bAccentGeo = mergeGeometries(
    [new THREE.BoxGeometry(BW - 0.004, 0.0009, BD - 0.004).translate(0, BH - 0.0025, 0)], false);
  const boothAccent = new THREE.InstancedMesh(bAccentGeo, accentMat, NBOOT);
  boothAccent.name = 'phoneBoothAccent';

  kept.forEach((i, m) => {
    const s = stops[i];
    const yw = yawOf.get(i);
    dummy.position.set(s.x, BUS_Y, s.z);
    dummy.rotation.set(0, yw, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    shelterFrame.setMatrixAt(m, dummy.matrix);
    shelterGlass.setMatrixAt(m, dummy.matrix);
    shelterAccent.setMatrixAt(m, dummy.matrix);

    // BUS 站牌: 已按真实站牌比例缩小, 沿候车亭朝向侧伸
    const ox = Math.cos(yw) * 0.030, oz = -Math.sin(yw) * 0.030;
    dummy.position.set(s.x + ox, BUS_Y + 0.021, s.z + oz);
    dummy.rotation.set(0, 0, 0);
    dummy.rotateY(yw + Math.PI / 2);
    dummy.rotateX(-THREE.MathUtils.degToRad(46));
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    plateMesh.setMatrixAt(m, dummy.matrix);
  });

  // 电话亭单独摆位: 沿候车亭法向外移, 避免与候车亭/站牌重叠
  const SIGN_OFF = (BD / 2 - 0.0010);   // 招牌相对亭心的前向偏移
  boothIdx.forEach((rec, b) => {
    const s = stops[rec.i];
    const yw = yawOf.get(rec.i);
    const nx = Math.cos(yw + Math.PI / 2), nz = -Math.sin(yw + Math.PI / 2);
    const px = s.x + nx * 0.026 + Math.cos(yw) * 0.010;
    const pz = s.z + nz * 0.026 - Math.sin(yw) * 0.010;
    dummy.position.set(px, BUS_Y, pz);
    dummy.rotation.set(0, yw, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    boothFrame.setMatrixAt(b, dummy.matrix);
    boothGlassM.setMatrixAt(b, dummy.matrix);
    boothAccent.setMatrixAt(b, dummy.matrix);
    // 招牌: 亭心前移 SIGN_OFF, 抬高到顶盖上方
    dummy.position.set(px + SIGN_OFF * Math.sin(yw), BUS_Y + BH + 0.004, pz + SIGN_OFF * Math.cos(yw));
    dummy.rotation.set(0, yw, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    boothSign.setMatrixAt(b, dummy.matrix);
  });
  boothFrame.count = boothIdx.length;
  boothGlassM.count = boothIdx.length;
  boothSign.count = boothIdx.length;
  boothAccent.count = boothIdx.length;

  shelterFrame.instanceMatrix.needsUpdate = true;
  shelterGlass.instanceMatrix.needsUpdate = true;
  plateMesh.instanceMatrix.needsUpdate = true;
  boothFrame.instanceMatrix.needsUpdate = true;
  boothGlassM.instanceMatrix.needsUpdate = true;
  boothSign.instanceMatrix.needsUpdate = true;
  shelterAccent.instanceMatrix.needsUpdate = true;
  boothAccent.instanceMatrix.needsUpdate = true;
  shelterFrame.userData = { type: 'busStops' };
  boothFrame.userData = { type: 'phoneBooths' };
  busGroup.add(shelterFrame, shelterGlass, shelterAccent, plateMesh, boothFrame, boothGlassM, boothSign, boothAccent);
  group.add(busGroup);

  /* ================= 拾取索引 ================= */
  const metroGrid = buildGrid(stations, 0.5, s => s.x, s => s.z);
  const busGrid = buildGrid(stops, 0.5, s => s.x, s => s.z);
  const lineByRef = new Map(metro.lines.map(l => [l.ref, l]));

  const busRoutesOf = (stopIndex) => {
    const arr = bus.stopRoutes[String(stopIndex)];
    return arr ? arr.map(i => bus.lines[i]).filter(Boolean) : [];
  };

  /* ================= 高亮 ================= */
  let highlighted = null;
  function highlightLine(ref) {
    for (const [r, m] of lineMeshes) {
      const on = (ref === null) || (r === ref);
      m.material.opacity = ref === null ? 0.70 : (on ? 0.90 : 0.06);
      m.material.emissiveIntensity = ref === null ? 1.0 : (on ? 1.3 : 0.12);
    }
    lineCore.children.forEach((c, i) => {
      const l = metro.lines[i];
      const on = (ref === null) || (l && l.ref === ref);
      c.material.opacity = on ? 0.35 : 0.06;
    });
    highlighted = ref;
  }

  /* ---- 选中站点的定位光环 (v=31: 双圈 + 垂直光柱, 更醒目不偏移) ---- */
  // 外圈: 大半径, 低不透明度
  const pickRingOuter = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.17, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#4fd6ff'), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  pickRingOuter.rotation.x = -Math.PI / 2;
  pickRingOuter.visible = false;
  pickRingOuter.renderOrder = 6;
  pickRingOuter.name = 'pickRingOuter';
  // 内圈: 中等半径, 高不透明度
  const pickRingInner = new THREE.Mesh(
    new THREE.RingGeometry(0.085, 0.105, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#4fd6ff'), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
  );
  pickRingInner.rotation.x = -Math.PI / 2;
  pickRingInner.visible = false;
  pickRingInner.renderOrder = 7;
  pickRingInner.name = 'pickRingInner';
  // 垂直光柱: 从地面到天空, 帮助定位
  const pickBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.5, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#4fd6ff'), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })
  );
  pickBeam.visible = false;
  pickBeam.renderOrder = 5;
  pickBeam.name = 'pickBeam';
  group.add(pickRingOuter, pickRingInner, pickBeam);

  const markAt = (x, z, y) => {
    // v=31: y 直接用 (不再 +0.004), 由各调用方指定
    const yy = (y == null ? METRO_Y : y);
    pickRingOuter.position.set(x, yy, z);
    pickRingInner.position.set(x, yy, z);
    pickBeam.position.set(x, yy + 0.25, z);
    pickRingOuter.visible = true;
    pickRingInner.visible = true;
    pickBeam.visible = true;
  };
  const clearMark = () => { pickRingOuter.visible = false; pickRingInner.visible = false; pickBeam.visible = false; };

  /* ---- 公交线路走向 ---- */
  const routeLineMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#ff9ec7'), transparent: true, opacity: 0.95 });
  let routeLine = null;
  function showBusRoute(line) {
    clearBusRoute();
    if (!line) return;
    const pts = [];
    for (const si of line.s) {
      const st = bus.stops[si];
      if (st) pts.push(new THREE.Vector3(st.x, Y.ground + 0.02, st.z));
    }
    if (pts.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    routeLine = new THREE.Line(g, routeLineMat);
    routeLine.name = 'busRouteLine';
    group.add(routeLine);

    const mk = (p, c) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), new THREE.MeshBasicMaterial({ color: c }));
      m.position.copy(p);
      return m;
    };
    const a = mk(pts[0], new THREE.Color('#5ef2a0'));
    const b = mk(pts[pts.length - 1], new THREE.Color('#ff5d7a'));
    a.name = b.name = 'busRouteEnd';
    group.add(a); group.add(b);
    routeLine.userData.ends = [a, b];
  }
  function clearBusRoute() {
    if (routeLine) {
      group.remove(routeLine);
      routeLine.geometry.dispose();
      (routeLine.userData.ends || []).forEach(e => { group.remove(e); e.geometry.dispose(); e.material.dispose(); });
      routeLine = null;
    }
  }

  /* ================= 每帧 ================= */
  let lastYaw = 1e9;
  return {
    group, metroGroup, lineGroup, lineCore,
    metroStations: nodeMesh, metroSigns: signMesh, metroHubs: hubMesh,
    metroXferTop: xferTopMesh,
    busStops: busGroup,
    stationCount: NS, stopCount: NB,
    lineMeshes, lineByRef,
    metroGrid, busGrid, busRoutesOf,
    highlightLine, getHighlighted: () => highlighted,
    showBusRoute, clearBusRoute, markAt, clearMark,
    update(t, camera) {
      hubMat.opacity = 0.34 + Math.sin(t * 1.8) * 0.16;
      if (pickRingOuter.visible) {
        // v=31: 双圈 + 光柱 一起呼吸
        const p = 1 + Math.sin(t * 3.4) * 0.10;
        pickRingOuter.scale.set(p, p, 1);
        pickRingInner.scale.set(p, p, 1);
        pickRingOuter.material.opacity = 0.45 + Math.sin(t * 3.4) * 0.25;
        pickRingInner.material.opacity = 0.70 + Math.sin(t * 3.4 + 0.5) * 0.25;
        pickBeam.material.opacity = 0.25 + Math.abs(Math.sin(t * 2.0)) * 0.20;
      }
      if (camera && metroGroup.visible && signMesh.visible) {
        camera.getWorldDirection(_dir);
        const yaw = Math.atan2(-_dir.x, -_dir.z);
        if (Math.abs(yaw - lastYaw) > 0.06) { layoutStationsYaw(yaw); lastYaw = yaw; }   // v=49: 0.035→0.06, 只更新立柱/站牌
      }
      /* 站点名称 + 线路编号标注: 拉近距离后逐级显现
         v=51 性能: metroGroup 隐藏时子级本就不渲染, 整个循环跳过(原来仍每帧
         遍历 453 标签 + 300 徽标逐项置 hidden); 相机静止时距离/缩放不变, 也跳过。 */
      /* v=51b: 图层由隐藏切回显示时强制重算一次(否则保留隐藏前的旧可见性) */
      if (metroGroup.visible && !_mgWasVisible) _labCp.set(1e9, 0, 0);
      _mgWasVisible = metroGroup.visible;
      if (camera && metroGroup.visible && _camMoved(camera)) {
        const cp = camera.position;
        for (const li of labelInfos) {
          const d = Math.hypot(cp.x - li.x, cp.z - li.z, cp.y - li.y);
          if (d > 7.5) { if (li.sp.visible) li.sp.visible = false; continue; }
          if (!li.sp.visible) li.sp.visible = true;
          const k = Math.max(0.30, Math.min(1.7, d / 4.5));   // v=42b: 下限 0.7→0.30, 贴近不再变巨牌
          li.sp.scale.set(0.16 * k, 0.04 * k, 1);
          li.sp.material.opacity = d > 6 ? Math.min(1, (7.5 - d) / 1.5) : 1;
        }
        /* v=40: 线路号徽标 —— 按 LOD 分级显现, 尺寸随距离补偿, 保持约 20px 屏幕大小 */
        const LIM = [75, 34, 17];                // lod0/1/2 的可见距离上限(场景单位)
        for (const bi of badgeInfos) {
          const d = Math.hypot(cp.x - bi.x, cp.z - bi.z, cp.y - bi.y);
          const lim = LIM[bi.lod];
          if (d > lim) { if (bi.sp.visible) bi.sp.visible = false; continue; }
          if (!bi.sp.visible) bi.sp.visible = true;
          const s = Math.max(0.02, Math.min(0.95, d * 0.0219));   // v=42b: 下限 0.15→0.02, 贴近时不再是 150m 巨牌
          bi.sp.scale.set(s, s, 1);
          bi.sp.material.opacity = d > lim * 0.82 ? Math.min(1, (lim - d) / (lim * 0.18)) : 1;
        }
      }
    },
  };
}

const _dir = new THREE.Vector3();
/* v=51: 标签/徽标重算门控 —— 仅当相机位置实际变化时返回 true */
const _labCp = new THREE.Vector3(1e9, 0, 0);
let _mgWasVisible = true;
function _camMoved(camera) {
  const cp = camera.position;
  if (cp.distanceToSquared(_labCp) < 1e-8) return false;
  _labCp.copy(cp);
  return true;
}

function flatToPts(flat, y = 0) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector3(flat[i], y, flat[i + 1]));
  return out;
}

function data_lineColor(metro, ref) {
  const l = metro.lines.find(x => x.ref === ref);
  return l ? l.color : null;
}
