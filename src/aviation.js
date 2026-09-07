import * as THREE from 'three';
import { Y } from './basemap.js?v=32';

/* =========================================================
   航空: 以上海两机场为端点的进近 / 离场航线 + 沿弧线运动的飞机
   航线用真实风格的大圆近似弧线 (CatmullRom), 飞机为简化几何模型。
   注意: 航线走向为示意性还原, 非实时航迹。
   ========================================================= */

const LON0 = 121.4737, LAT0 = 31.2304;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const M_LAT = 110957;
const proj = (lon, lat) => [(lon - LON0) * M_LON / 1000, -(lat - LAT0) * M_LAT / 1000];

// 机场 (真实经纬度)
const AIRPORTS = {
  PVG: { lon: 121.8053, lat: 31.1440, name: '浦东国际机场' },
  SHA: { lon: 121.3344, lat: 31.1979, name: '虹桥国际机场' },
};

/* 造一架客机 (机身 + 机翼/小翼 + 平尾 + 垂尾 + 发动机短舱 + 翼尖航行灯) */
function makePlane(scale = 0.12, color = '#eef3fb') {
  const g = new THREE.Group();
  const tint = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.55);
  const body = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a3446'), roughness: 0.35, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color('#16303f'), roughness: 0.15, metalness: 0.1 });

  // 机身
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.075, 0.92, 12), body);
  fus.rotation.z = Math.PI / 2;
  fus.position.x = -0.04;
  g.add(fus);

  // 机头 + 雷达罩
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 10), body);
  nose.position.x = 0.48; nose.scale.set(1.25, 1, 1);
  g.add(nose);
  const radome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), dark);
  radome.position.x = 0.555; radome.scale.set(0.9, 0.9, 0.9);
  g.add(radome);

  // 驾驶舱风挡
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.115), glass);
  cockpit.position.set(0.40, 0.045, 0);
  g.add(cockpit);

  // 主机翼 + 翼尖小翼
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.028, 0.92), body);
  wing.position.set(-0.02, 0, 0);
  g.add(wing);
  for (const sz of [1, -1]) {
    const wl = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.022), accent);
    wl.position.set(-0.05, 0.065, sz * 0.465);
    wl.rotation.x = sz * 0.35;
    g.add(wl);
  }

  // 发动机短舱 + 挂架 + 进气口
  for (const sz of [1, -1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.03), body);
    pylon.position.set(0.06, -0.03, sz * 0.24);
    g.add(pylon);
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.22, 12), body);
    nac.rotation.z = Math.PI / 2;
    nac.position.set(0.10, -0.075, sz * 0.26);
    g.add(nac);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.050, 0.02, 12), dark);
    intake.rotation.z = Math.PI / 2;
    intake.position.set(0.215, -0.075, sz * 0.26);
    g.add(intake);
  }

  // 平尾 + 端板
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.40), body);
  tailW.position.set(-0.44, 0.03, 0);
  g.add(tailW);
  for (const sz of [1, -1]) {
    const tp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.055, 0.018), accent);
    tp.position.set(-0.45, 0.055, sz * 0.205);
    g.add(tp);
  }

  // 垂尾 + 前缘
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.26, 0.028), accent);
  fin.position.set(-0.44, 0.155, 0);
  g.add(fin);
  const finLead = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.030), dark);
  finLead.position.set(-0.375, 0.145, 0);
  finLead.rotation.z = 0.22;
  g.add(finLead);

  // 机腹整流罩
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.14), body);
  belly.position.set(0.02, -0.085, 0);
  g.add(belly);

  // 机身舷窗灯带 (客舱高度两侧各一条细发光带, 远看即"舷窗")
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfeaff'), toneMapped: false });
  for (const sz of [1, -1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.012, 0.004), winMat);
    win.position.set(-0.04, 0.055, sz * 0.105);
    g.add(win);
  }
  // 舱门轮廓 (前后各一道深色门框)
  const doorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2738'), roughness: 0.5, metalness: 0.3 });
  for (const sx of [-0.18, 0.16]) for (const sz of [1, -1]) {
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.058, 0.0016), doorMat);
    dr.position.set(sx, 0.02, sz * 0.108);
    g.add(dr);
  }
  // 翼根整流罩 (机翼与机身接合处的圆润过渡)
  for (const sz of [1, -1]) {
    const wf = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.10), body);
    wf.position.set(-0.02, -0.02, sz * 0.30);
    g.add(wf);
  }
  // 第二根天线 (垂尾 VHF 刀形)
  const ant2 = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.055, 0.012), dark);
  ant2.position.set(-0.42, 0.30, 0);
  g.add(ant2);
  // 机身顶部红色信标灯
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30') }));
  beacon.position.set(0.05, 0.106, 0);
  g.add(beacon);

  // 翼尖航行灯 (左红右绿)
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30') }));
  navL.position.set(-0.05, 0.012, 0.475);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#30ff6a') }));
  navR.position.set(-0.05, 0.012, -0.475);
  g.add(navL, navR);

  // 尾部天线
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.10, 6), dark);
  ant.position.set(-0.30, 0.155, 0);
  g.add(ant);

  g.scale.setScalar(scale);
  return g;
}

/* v=38: 航线高度改为真实客机巡航高度 9,000~13,000 m (30,000~43,000 ft)
   垂直换算: 1 米 = 0.0016 场景单位 (与 landmarks.js 的 H 一致)
   · 进近 (arrival)  : 远方巡航高度 → 逐渐下降 → 机场低空
   · 离场 (departure): 机场低空 → 逐渐爬升 → 远方巡航高度 */
const M2Y = 0.0016;                       // 1 米 → 场景单位 (垂直)
const CRUISE_Y = (m) => m * M2Y;          // 9,000m → 14.4 单位; 13,000m → 20.8 单位
const FIELD_Y = CRUISE_Y(260);            // 机场起降端约 260m

/* 由起降点构造一条带高度的进近 / 离场弧线 */
function flightCurve(fromLon, fromLat, toLon, toLat, cruiseM, isArrival) {
  const [fx, fz] = proj(fromLon, fromLat);
  const [tx, tz] = proj(toLon, toLat);
  // 中间抬升, 并横向偏移一点形成弧线
  const mx = (fx + tx) / 2 + (tz - fz) * 0.18;
  const mz = (fz + tz) / 2 - (tx - fx) * 0.18;
  const cy = CRUISE_Y(cruiseM);
  // 进近: 起点(远方)在巡航高度, 终点(机场)在低空; 离场反之
  const fy = isArrival ? cy : FIELD_Y;
  const ty = isArrival ? FIELD_Y : cy;
  const my = (fy + ty) * 0.55;            // 中点高度, 形成平滑的下降/爬升剖面
  const p0 = new THREE.Vector3(fx, fy, fz);
  const p1 = new THREE.Vector3(mx, my, mz);
  const p2 = new THREE.Vector3(tx, ty, tz);
  return new THREE.CatmullRomCurve3([p0, p1, p2], false, 'catmullrom', 0.5);
}

export function buildAviation() {
  const group = new THREE.Group();
  group.name = 'aviation';

  // 航线定义: 进近 (到机场) / 离场 (离机场)
  // 每个方向多铺几条不同方位角/高度的航线, 让空中同时有多架飞机在飞
  const defs = [
    // ---- 浦东进场 (自东海 / 东南 / 南) ----
    { from: [122.18, 30.92], to: AIRPORTS.PVG, arr: true },
    { from: [122.05, 31.42], to: AIRPORTS.PVG, arr: true },
    { from: [121.55, 30.70], to: AIRPORTS.PVG, arr: true },
    { from: [122.55, 31.15], to: AIRPORTS.PVG, arr: true },
    { from: [121.95, 30.45], to: AIRPORTS.PVG, arr: true },
    { from: [122.40, 31.60], to: AIRPORTS.PVG, arr: true },
    // ---- 浦东离场 (往西北 / 西 / 北) ----
    { from: AIRPORTS.PVG, to: [120.95, 31.85], arr: false },
    { from: AIRPORTS.PVG, to: [121.20, 32.35], arr: false },
    { from: AIRPORTS.PVG, to: [120.55, 31.05], arr: false },
    { from: AIRPORTS.PVG, to: [121.85, 32.60], arr: false },
    { from: AIRPORTS.PVG, to: [120.40, 31.75], arr: false },
    // ---- 虹桥进场 (自西 / 西南 / 北) ----
    { from: [120.85, 30.95], to: AIRPORTS.SHA, arr: true },
    { from: [120.60, 31.55], to: AIRPORTS.SHA, arr: true },
    { from: [120.95, 31.95], to: AIRPORTS.SHA, arr: true },
    { from: [120.25, 30.80], to: AIRPORTS.SHA, arr: true },
    { from: [121.05, 32.20], to: AIRPORTS.SHA, arr: true },
    // ---- 虹桥离场 ----
    { from: AIRPORTS.SHA, to: [122.10, 31.05], arr: false },
    { from: AIRPORTS.SHA, to: [120.70, 32.10], arr: false },
    { from: AIRPORTS.SHA, to: [122.45, 30.60], arr: false },
    { from: AIRPORTS.SHA, to: [119.95, 31.35], arr: false },
    // ---- 两场之间的空中走廊 ----
    { from: AIRPORTS.SHA, to: AIRPORTS.PVG, arr: false },
  ];

  const flights = [];
  // 每条航线一种可辨识的色相, 进近/离场都能一眼区分
  const PALETTE = ['#7fd0ff', '#ffb27f', '#9be39b', '#ff9ec7', '#ffd166', '#b39cff', '#5ef2e0', '#ff8a8a', '#c9f07a'];

  defs.forEach((d, i) => {
    const fromLon = Array.isArray(d.from) ? d.from[0] : d.from.lon;
    const fromLat = Array.isArray(d.from) ? d.from[1] : d.from.lat;
    const toLon = Array.isArray(d.to) ? d.to[0] : d.to.lon;
    const toLat = Array.isArray(d.to) ? d.to[1] : d.to.lat;
    const cruiseM = 9000 + ((i * 977) % 4001);   // v=38: 真实巡航高度 9,000~13,000 m (30,000~43,000 ft)
    const curve = flightCurve(fromLon, fromLat, toLon, toLat, cruiseM, d.arr);

    // 航线参考线 (按序取色, 提高不透明度让彩虹航线清晰可辨)
    const col = PALETTE[i % PALETTE.length];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(130)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: 0.65 })
    );
    group.add(line);

    // 发光航迹管: 让航线在空中更醒目
    const glowGeo = new THREE.TubeGeometry(curve, 120, 0.045, 6, false);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(col), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.renderOrder = 4;
    group.add(glow);

    const plane = makePlane(0.15, col);
    group.add(plane);
    flights.push({
      curve, plane, color: col,
      t: (i / defs.length) % 1,
      dir: 1,
      speed: 0.0068 + (i % 3) * 0.0009,
    });
  });

  // 机场标记 (发光环)
  for (const k of Object.keys(AIRPORTS)) {
    const a = AIRPORTS[k];
    const [x, z] = proj(a.lon, a.lat);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.18, 28),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, Y.ground + 0.02, z);
    ring.userData = { type: 'airport', name: a.name };
    group.add(ring);
  }

  const tmp = new THREE.Vector3(), tan = new THREE.Vector3();
  let timeScale = 6;

  return {
    group,
    flightCount: flights.length,
    getTimeScale: () => timeScale,
    setTimeScale(v) { timeScale = Math.max(1, Math.min(40, v)); },
    update(t, dt) {
      const d = Math.min(0.05, dt || 0.016);
      for (const f of flights) {
        f.t += f.speed * d * timeScale * f.dir;
        if (f.t > 1) { f.t = 1; f.dir = -1; }
        if (f.t < 0) { f.t = 0; f.dir = 1; }
        const tt = Math.min(0.999, Math.max(0.001, f.t));
        f.curve.getPointAt(tt, tmp);
        f.curve.getTangentAt(tt, tan);
        if (f.dir < 0) tan.negate();
        f.plane.position.copy(tmp);
        const yaw = Math.atan2(tan.x, tan.z) - Math.PI / 2;
        f.plane.rotation.y += (yaw - f.plane.rotation.y) * 0.1;
        // 轻微滚转
        f.plane.rotation.z = Math.sin(t * 1.3 + f.t * 10) * 0.12;
      }
    },
  };
}
