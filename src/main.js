import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadJSON } from './util.js?v=32';
import { buildWater, buildWaterExclusion } from './water.js?v=59';
import { buildDistricts, makeDistrictLabels } from './districts.js?v=59';
import { buildCity } from './buildings.js?v=59';
import { buildTransit } from './transit.js?v=59';
import { buildCruise } from './cruise.js?v=32';
import { buildAviation } from './aviation.js?v=59';
import { buildMobility } from './mobility.js?v=59';
import { buildBasemap, Y } from './basemap.js?v=32';
import { buildLandmarks, resolveLandmarks } from './landmarks.js?v=59';
import { buildSky } from './sky.js?v=59';
import { initUI } from './ui.js?v=59';

/* =========================================================
   上海三维城市沙盘 · 主入口
   ========================================================= */

window.__errors = [];
window.addEventListener('error', e => window.__errors.push({ msg: e.message, file: e.filename, line: e.lineno }));
window.addEventListener('unhandledrejection', e => window.__errors.push({ msg: 'unhandled: ' + e.reason }));

const LON0 = 121.4737, LAT0 = 31.2304;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const M_LAT = 110957;
const proj = (lon, lat) => [(lon - LON0) * M_LON / 1000, -(lat - LAT0) * M_LAT / 1000];

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // v=49: 1.8→1.5, 高分屏填充率减负
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.34;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050912');
scene.fog = new THREE.Fog('#050912', 90, 320);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.08, 900);
camera.position.set(0, 15, 24);         // 起始机位已在市中心上方, 入场只做轻微推近

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.487;
controls.minDistance = 0.45;            // 可放大到更近, 看单体建筑
controls.maxDistance = 260;
controls.rotateSpeed = 0.42;           // 降低拖拽灵敏度
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.6;
controls.target.set(0, 8, -22);        // v=31: 再抬高, 默认视野上沿能看到天上的太阳月亮

/* ---------------- 光照 ---------------- */
const ambient = new THREE.AmbientLight('#5f7fa8', 1.05);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#cfe4ff', 1.65);
sun.position.set(38, 62, 26);
scene.add(sun);
const rim = new THREE.DirectionalLight('#ff9ec7', 0.48);
rim.position.set(-42, 26, -34);
scene.add(rim);
const fillTop = new THREE.HemisphereLight('#8fd0ff', '#101d33', 0.62);
scene.add(fillTop);

/* ---------------- 载入数据 ---------------- */
const FILES = [
  ['districts', 'data/districts.json'],
  ['water', 'data/water.json'],
  ['metro', 'data/metro.json'],
  ['bus', 'data/bus.json'],
  ['attractions', 'data/attractions.json'],
  ['city', 'data/buildings.json'],
  ['buildingsOuter', 'data/buildings_outer.json'],   // 全市分片抓取的建筑体块
  ['roads', 'data/roads.json'],
  ['ferry', 'data/ferry.json'],
  ['meta', 'data/meta.json'],
  ['poiFootprints', 'data/poi_footprints.json'],   // 定向补拉的建筑轮廓(可缺失)
];
const ldi = document.getElementById('ldi');
const ldt = document.getElementById('ldt');
const data = {};
let done = 0;
for (const [key, path] of FILES) {
  ldt.textContent = `加载 ${path.replace('data/', '')} …`;
  ldi.style.width = Math.round((done / FILES.length) * 92) + '%';
  try { data[key] = await loadJSON(path); done++; }
  catch (e) { ldt.textContent = '加载失败: ' + path; data[key] = null; }
}
ldi.style.width = '94%';

/* ---------------- 真实卫星底图 ---------------- */
let basemap = null;
try {
  ldt.textContent = '加载卫星影像底图 …';
  const tilesMeta = await loadJSON('assets/tiles/meta.json');
  basemap = await buildBasemap(tilesMeta);
  scene.add(basemap.mesh);
} catch (e) { /* 底图加载失败, 回退为纯色地面 */ }
ldi.style.width = '97%';
ldt.textContent = '构建三维场景 …';
await new Promise(r => setTimeout(r, 16));

/* ---------------- 构建图层 ---------------- */
/* 合并中心区建筑 (buildings.json) 与全市分片建筑 (buildings_outer.json)。
   中心环线 bbox 内只保留中心区数据, 避免与 outer 重复绘制 (outer 同样覆盖该区域)。 */
function mergeBuildings() {
  const inner = (data.city && data.city.b) || [];
  const outer = (data.buildingsOuter && data.buildingsOuter.b) || [];
  if (!outer.length) return inner;
  if (!inner.length) return outer;
  // 中心内环大致范围 (审计确认 inner 全部落在此框内)
  const BOX = { x0: -0.6, x1: 5.6, z0: -3.9, z1: 2.0 };
  const inBox = (cx, cz) => cx >= BOX.x0 && cx <= BOX.x1 && cz >= BOX.z0 && cz <= BOX.z1;
  const out = inner.slice();
  let fillIn = 0;
  for (const b of outer) {
    const p = b.p, n = p.length / 2;
    if (n < 3) continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= n; cz /= n;
    if (inBox(cx, cz)) {
      // 中心框内的普通楼与 inner 重复 -> 丢弃。
      // 但程序生成的补白楼带 f:1 标记 (生成时已对内源做过碰撞检测, 只填在内源空白处),
      // 必须放行, 否则长宁/徐汇/普陀等内源为零的区会整片空白。
      if (!b.f) continue;
      fillIn++;
    }
    out.push(b);
  }
  return out;
}
const cityData = { buildings: mergeBuildings(), roads: (data.roads && data.roads.r) || [] };
const sites = resolveLandmarks(data.attractions.pois);
const districts = buildDistricts(data.districts);
const districtsLabels = makeDistrictLabels(data.districts);
const water = buildWater(data.water);
const waterExcl = buildWaterExclusion(data.water);
const city = buildCity(cityData, sites, waterExcl);
const transit = buildTransit({ metro: data.metro, bus: data.bus });
const cruise = buildCruise(data.ferry);
const aviation = buildAviation();
const mobility = buildMobility({ metro: data.metro, bus: data.bus });
const landmarks = buildLandmarks(sites);
const sky = buildSky();

scene.add(sky.group, districts.group, districtsLabels.group, water.group, city.group, transit.group,
  cruise.group, aviation.group, mobility.group, landmarks.group);

/* ---------------- 地面底板 ---------------- */
const basePlate = new THREE.Mesh(
  new THREE.CircleGeometry(150, 64),
  new THREE.MeshStandardMaterial({ color: '#070d18', roughness: 1, metalness: 0 })
);
basePlate.rotation.x = -Math.PI / 2;
basePlate.position.y = Y.basemap - 0.008;
scene.add(basePlate);

/* ---------------- 经纬度 -> 所属区 ---------------- */
function pointInPoly(x, z, flat) {
  let inside = false; const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], zi = flat[i * 2 + 1], xj = flat[j * 2], zj = flat[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function districtOf(lon, lat) {
  const [x, z] = proj(lon, lat);
  for (const d of data.districts.districts) {
    for (const poly of d.polys) { if (poly.hole) continue; if (pointInPoly(x, z, poly.p)) return d.name; }
  }
  return '其它';
}

/* ---------------- 夜间模式: 底图关闭时也能全局生效 ---------------- */
let _uiRef = null;                              // ui 初始化后被赋值, 避免 TDZ
function setNightMode(v) {
  sun.intensity = v ? 0.32 : 1.65;
  ambient.intensity = v ? 0.42 : 1.05;
  rim.intensity = v ? 0.18 : 0.48;
  fillTop.intensity = v ? 0.24 : 0.62;
  scene.background = new THREE.Color(v ? '#02030a' : '#050912');
  scene.fog.color = new THREE.Color(v ? '#02030a' : '#050912');
  scene.fog.near = v ? 60 : 90;
  scene.fog.far = v ? 260 : 320;
  if (city.buildingMesh && city.buildingMesh.material) {
    city.buildingMesh.material.emissiveIntensity = v ? 1.5 : 0.9;
  }
  if (city.roadMesh && city.roadMesh.material) {
    city.roadMesh.material.opacity = v ? 0.32 : 0.50;
  }
  if (city.setNightMode) city.setNightMode(v);
  if (_uiRef && _uiRef.setLayer) _uiRef.setLayer('夜间模式', !!v);
}

/* ---------------- UI: 图层 (v=33: 夜间/卫星/星系置顶, 已去重) ---------------- */
const layerDefs = [
  // 置顶三件套: 夜间模式 → 卫星底图 → 天空星系 (用户要求的最前顺序)
  { name: '夜间模式', color: '#2ba6e0', tip: '关=日间', on: false, set: v => { basemap && basemap.setMode(v ? 'night' : 'day'); setNightMode(v); } },
  { name: '卫星底图', color: '#8a7fd8', tip: '真实地貌', on: false, set: v => basemap && (basemap.mesh.visible = v) },
  { name: '天空星系', color: '#8aa6ff', tip: '★ 3400 星 + 银河带', on: false, set: v => sky.setNight(v) },
  // 3D 模型核心层
  { name: '地标精模', color: '#ffd166', tip: landmarks.count + ' 处', on: true, set: v => landmarks.group.visible = v },
  { name: '建筑体块', color: '#7fd8ff', tip: city.builtCount + ' 栋', on: true, set: v => city.setBuildings(v) },
  { name: '街道路面', color: '#7fb6e8', tip: cityData.roads.length + ' 段', on: true, set: v => city.setRoads(v) },
  { name: '江河湖泊', color: '#2ba6e0', tip: water.riverCount + ' 条', on: true, set: v => water.group.visible = v },
  // 行政区
  { name: '行政区', color: '#5fa8ff', tip: data.districts.districts.length + ' 区', on: true, set: v => districts.group.visible = v },
  { name: '行政区名', color: '#9ec7ff', tip: data.districts.districts.length + ' 个', on: true, set: v => districtsLabels.group.visible = v },
  { name: '地标名', color: '#ffe08a', tip: landmarks.labelCount + ' 处', on: false, set: v => landmarks.setLabels(v) },
  // 交通工具
  { name: '公交候车亭', color: '#ffd166', tip: data.bus.stops.length + ' 个', on: false, set: v => transit.busStops.visible = v },
  { name: '公交车(行驶)', color: '#ff9d3d', tip: mobility.busCount + ' 辆', on: false, set: v => mobility.buses.group.visible = v },
  { name: '共享单车', color: '#ff7a3d', tip: mobility.bikeCount + ' 辆', on: true, set: v => mobility.setBikes(v) },
  { name: '共享电动车', color: '#22c3a6', tip: mobility.scooterCount + ' 辆', on: true, set: v => mobility.setScooters(v) },
  { name: '地铁线网', color: '#ff6b6b', tip: data.metro.lines.length + ' 线', on: false, set: v => transit.metroGroup.visible = v },
  { name: '航班航线', color: '#9ec7ff', tip: aviation.flightCount + ' 班', on: false, set: v => aviation.group.visible = v },
  { name: '游轮码头', color: '#5ef2a0', tip: (data.ferry.cruise.length + data.ferry.ferry.length) + ' 处', on: true, set: v => cruise.group.visible = v },
];

let flying = null;
function flyTo(pos, target, ms = 1150) {
  flying = {
    t0: performance.now(), ms,
    p0: camera.position.clone(), p1: new THREE.Vector3(...pos),
    t0v: controls.target.clone(), t1v: new THREE.Vector3(...target),
  };
}

const LUJIAZUI = proj(121.5057, 31.2455);
const BUND = proj(121.4900, 31.2400);
const DISNEY = proj(121.6740, 31.1470);
const PEOPLE = proj(121.4737, 31.2304);
const HONGQIAO = proj(121.3200, 31.1940);

/* ---------------- 预设机位 (普通景观点) ---------------- */
const views = [
  { name: '全市全景', tip: '16 区', go: () => flyTo([2, 78, 96], [0, 0, 0]) },
  { name: '外滩天际线', tip: '陆家嘴', go: () => flyTo([LUJIAZUI[0] + 3.6, 2.8, LUJIAZUI[1] + 2.8], [LUJIAZUI[0], 1.2, LUJIAZUI[1]]) },
  { name: '人民广场', tip: '市中心', go: () => flyTo([PEOPLE[0], 4.2, PEOPLE[1] + 6.2], [PEOPLE[0], 0.4, PEOPLE[1]]) },
  { name: '浦江游览', tip: '游轮视角', go: () => flyTo([BUND[0] + 6.5, 1.5, BUND[1] - 1.2], [BUND[0] + 1.2, 0.3, BUND[1] + 2.4]) },
  { name: '迪士尼度假区', tip: '浦东', go: () => flyTo([DISNEY[0] + 2.5, 5.5, DISNEY[1] + 6.5], [DISNEY[0], 0, DISNEY[1]]) },
  { name: '虹桥枢纽', tip: '浦西', go: () => flyTo([HONGQIAO[0] + 2.5, 5.5, HONGQIAO[1] + 6.0], [HONGQIAO[0], 0, HONGQIAO[1]]) },
  { name: '苏州河两岸', tip: '中环', go: () => flyTo([1.5, 3.4, 5.5], [0.4, 0.2, 2.2]) },
  { name: '豫园 · 城隍庙', tip: '老城厢', go: () => flyTo([proj(121.49, 31.23)[0] + 1.6, 2.0, proj(121.49, 31.23)[1] + 1.6], [proj(121.49, 31.23)[0], 0.2, proj(121.49, 31.23)[1]]) },
  { name: '南京东路', tip: '步行街', go: () => flyTo([proj(121.48, 31.236)[0] + 1.4, 1.8, proj(121.48, 31.236)[1] + 1.4], [proj(121.48, 31.236)[0], 0.2, proj(121.48, 31.236)[1]]) },
  { name: '世纪公园', tip: '浦东', go: () => flyTo([proj(121.55, 31.22)[0] + 2.0, 3.0, proj(121.55, 31.22)[1] + 2.0], [proj(121.55, 31.22)[0], 0.2, proj(121.55, 31.22)[1]]) },
  { name: '中华艺术宫', tip: '世博', go: () => flyTo([proj(121.49, 31.18)[0] + 2.0, 2.6, proj(121.49, 31.18)[1] + 2.0], [proj(121.49, 31.18)[0], 0.2, proj(121.49, 31.18)[1]]) },
  { name: '朱家角古镇', tip: '青浦', go: () => flyTo([proj(121.05, 31.11)[0] + 1.4, 3.4, proj(121.05, 31.11)[1] + 1.4], [proj(121.05, 31.11)[0], 0.2, proj(121.05, 31.11)[1]]) },
  { name: '佘山', tip: '松江', go: () => flyTo([proj(121.225, 31.107)[0] + 1.2, 2.4, proj(121.225, 31.107)[1] + 1.2], [proj(121.225, 31.107)[0], 0.2, proj(121.225, 31.107)[1]]) },
  { name: '崇明岛', tip: '生态', go: () => flyTo([proj(121.40, 31.62)[0] + 4, 6, proj(121.40, 31.62)[1] - 4], [proj(121.40, 31.62)[0], 0, proj(121.40, 31.62)[1]]) },
  { name: '上海植物园', tip: '徐汇', go: () => flyTo([proj(121.44, 31.16)[0] + 1.4, 2.2, proj(121.44, 31.16)[1] + 1.4], [proj(121.44, 31.16)[0], 0.2, proj(121.44, 31.16)[1]]) },
  { name: '张园', tip: '石库门里弄', go: () => flyTo([proj(121.4640, 31.2290)[0] + 0.8, 1.6, proj(121.4640, 31.2290)[1] + 0.8], [proj(121.4640, 31.2290)[0], 0.2, proj(121.4640, 31.2290)[1]]) },
  { name: '思南公馆', tip: '花园洋房', go: () => flyTo([proj(121.4690, 31.2120)[0] + 0.9, 1.8, proj(121.4690, 31.2120)[1] + 0.9], [proj(121.4690, 31.2120)[0], 0.2, proj(121.4690, 31.2120)[1]]) },
  { name: '1933老场坊', tip: '溧阳路 · 工业遗产', go: () => flyTo([proj(121.4840, 31.2570)[0] + 0.8, 1.6, proj(121.4840, 31.2570)[1] + 0.8], [proj(121.4840, 31.2570)[0], 0.2, proj(121.4840, 31.2570)[1]]) },
  { name: '民生码头筒仓', tip: '滨江 · 八万吨筒仓', go: () => flyTo([proj(121.5100, 31.2440)[0] + 0.9, 1.8, proj(121.5100, 31.2440)[1] + 0.9], [proj(121.5100, 31.2440)[0], 0.2, proj(121.5100, 31.2440)[1]]) },
  { name: '复兴公园', tip: '法式园林', go: () => flyTo([proj(121.4720, 31.2210)[0] + 1.2, 2.0, proj(121.4720, 31.2210)[1] + 1.2], [proj(121.4720, 31.2210)[0], 0.2, proj(121.4720, 31.2210)[1]]) },
  { name: '鲁迅公园', tip: '虹口 · 大陆新村', go: () => flyTo([proj(121.4830, 31.2770)[0] + 1.2, 2.0, proj(121.4830, 31.2770)[1] + 1.2], [proj(121.4830, 31.2770)[0], 0.2, proj(121.4830, 31.2770)[1]]) },
  { name: '中山公园', tip: '长宁 · 百年公园', go: () => flyTo([proj(121.4190, 31.2210)[0] + 1.4, 2.0, proj(121.4190, 31.2210)[1] + 1.4], [proj(121.4190, 31.2210)[0], 0.2, proj(121.4190, 31.2210)[1]]) },
  { name: '大宁灵石公园', tip: '静安 · 人工湖', go: () => flyTo([proj(121.4500, 31.2800)[0] + 1.2, 2.0, proj(121.4500, 31.2800)[1] + 1.2], [proj(121.4500, 31.2800)[0], 0.2, proj(121.4500, 31.2800)[1]]) },
  { name: '共青森林公园', tip: '杨浦 · 131 公顷', go: () => flyTo([proj(121.5300, 31.3100)[0] + 2.0, 2.6, proj(121.5300, 31.3100)[1] + 2.0], [proj(121.5300, 31.3100)[0], 0.2, proj(121.5300, 31.3100)[1]]) },
  { name: '顾村公园', tip: '宝山 · 樱花胜地', go: () => flyTo([proj(121.4000, 31.3500)[0] + 2.0, 2.6, proj(121.4000, 31.3500)[1] + 2.0], [proj(121.4000, 31.3500)[0], 0.2, proj(121.4000, 31.3500)[1]]) },
  { name: '上海野生动物园', tip: '南汇 · 153 公顷', go: () => flyTo([proj(121.7079, 31.0459)[0] + 2.5, 3.2, proj(121.7079, 31.0459)[1] + 2.5], [proj(121.7079, 31.0459)[0], 0.2, proj(121.7079, 31.0459)[1]]) },
  { name: '复旦大学', tip: '杨浦 · 邯郸校区', go: () => flyTo([proj(121.5030, 31.2980)[0] + 1.4, 2.2, proj(121.5030, 31.2980)[1] + 1.4], [proj(121.5030, 31.2980)[0], 0.2, proj(121.5030, 31.2980)[1]]) },
  { name: '上海交通大学', tip: '徐汇 · 华山路校区', go: () => flyTo([proj(121.4320, 31.2000)[0] + 1.2, 2.0, proj(121.4320, 31.2000)[1] + 1.2], [proj(121.4320, 31.2000)[0], 0.2, proj(121.4320, 31.2000)[1]]) },
  { name: '同济大学', tip: '杨浦 · 四平路校区', go: () => flyTo([proj(121.5000, 31.2840)[0] + 1.2, 2.0, proj(121.5000, 31.2840)[1] + 1.2], [proj(121.5000, 31.2840)[0], 0.2, proj(121.5000, 31.2840)[1]]) },
  { name: '华东师范大学', tip: '普陀 · 中山北路', go: () => flyTo([proj(121.4000, 31.2280)[0] + 1.4, 2.0, proj(121.4000, 31.2280)[1] + 1.4], [proj(121.4000, 31.2280)[0], 0.2, proj(121.4000, 31.2280)[1]]) },
  { name: '真如寺', tip: '普陀 · 元代木构大殿', go: () => flyTo([proj(121.3900, 31.2540)[0] + 1.0, 1.8, proj(121.3900, 31.2540)[1] + 1.0], [proj(121.3900, 31.2540)[0], 0.2, proj(121.3900, 31.2540)[1]]) },
  { name: '城市规划展示馆', tip: '人民广场 · 城模', go: () => flyTo([proj(121.4737, 31.2320)[0] + 0.9, 1.8, proj(121.4737, 31.2320)[1] + 0.9], [proj(121.4737, 31.2320)[0], 0.2, proj(121.4737, 31.2320)[1]]) },
  { name: '外滩美术馆', tip: '外滩源 · 原亚洲文会', go: () => flyTo([proj(121.4840, 31.2420)[0] + 0.8, 1.6, proj(121.4840, 31.2420)[1] + 0.8], [proj(121.4840, 31.2420)[0], 0.2, proj(121.4840, 31.2420)[1]]) },
  { name: '国际舞蹈中心', tip: '长宁虹桥路', go: () => flyTo([proj(121.3900, 31.2000)[0] + 1.0, 1.8, proj(121.3900, 31.2000)[1] + 1.0], [proj(121.3900, 31.2000)[0], 0.2, proj(121.3900, 31.2000)[1]]) },
  { name: '浦东图书馆', tip: '前程路 · 巨型"书"形', go: () => flyTo([proj(121.5400, 31.1800)[0] + 1.0, 1.8, proj(121.5400, 31.1800)[1] + 1.0], [proj(121.5400, 31.1800)[0], 0.2, proj(121.5400, 31.1800)[1]]) },
  { name: '玻璃博物馆', tip: '宝山 · 旧玻璃厂改造', go: () => flyTo([proj(121.4400, 31.3200)[0] + 1.0, 1.8, proj(121.4400, 31.3200)[1] + 1.0], [proj(121.4400, 31.3200)[0], 0.2, proj(121.4400, 31.3200)[1]]) },
  { name: '汽车博物馆', tip: '嘉定 · 汽车博览公园', go: () => flyTo([proj(121.2900, 31.2900)[0] + 1.2, 2.0, proj(121.2900, 31.2900)[1] + 1.2], [proj(121.2900, 31.2900)[0], 0.2, proj(121.2900, 31.2900)[1]]) },
  { name: '儿童博物馆', tip: '长宁宋园路', go: () => flyTo([proj(121.4100, 31.1950)[0] + 0.9, 1.6, proj(121.4100, 31.1950)[1] + 0.9], [proj(121.4100, 31.1950)[0], 0.2, proj(121.4100, 31.1950)[1]]) },
  { name: '宋庆龄故居', tip: '淮海西路 1843 号', go: () => flyTo([proj(121.4350, 31.2050)[0] + 0.8, 1.6, proj(121.4350, 31.2050)[1] + 0.8], [proj(121.4350, 31.2050)[0], 0.2, proj(121.4350, 31.2050)[1]]) },
];

/* ---------------- 预设机位 (重点交通枢纽, 单独分组区分) ---------------- */
const hubViews = [
  { name: '虹桥综合枢纽', tip: '高铁+机场+地铁', go: () => flyTo([HONGQIAO[0] + 2.0, 4.6, HONGQIAO[1] + 5.0], [HONGQIAO[0], 0, HONGQIAO[1]]) },
  { name: '上海站', tip: '铁路枢纽 · 钟塔站房', go: () => flyTo([proj(121.4555, 31.2490)[0] + 1.6, 2.4, proj(121.4555, 31.2490)[1] + 1.6], [proj(121.4555, 31.2490)[0], 0.2, proj(121.4555, 31.2490)[1]]) },
  { name: '上海南站', tip: '圆形玻璃站房', go: () => flyTo([proj(121.4280, 31.1550)[0] + 1.6, 2.4, proj(121.4280, 31.1550)[1] + 1.6], [proj(121.4280, 31.1550)[0], 0.2, proj(121.4280, 31.1550)[1]]) },
  { name: '上海西站', tip: '真如 · 卧钟主立面', go: () => flyTo([proj(121.3981, 31.2647)[0] + 1.4, 2.4, proj(121.3981, 31.2647)[1] + 1.4], [proj(121.3981, 31.2647)[0], 0.2, proj(121.3981, 31.2647)[1]]) },
  { name: '上海北站', tip: '沪通方向', go: () => flyTo([proj(121.4540, 31.2620)[0] + 1.4, 2.2, proj(121.4540, 31.2620)[1] + 1.4], [proj(121.4540, 31.2620)[0], 0.2, proj(121.4540, 31.2620)[1]]) },
  { name: '上海东站', tip: '在建 · 沪通/沪乍杭', go: () => flyTo([proj(121.8080, 31.1320)[0] + 2.0, 2.6, proj(121.8080, 31.1320)[1] + 2.0], [proj(121.8080, 31.1320)[0], 0.2, proj(121.8080, 31.1320)[1]]) },
  { name: '上海松江站', tip: '沪苏湖高铁 · 桁架', go: () => flyTo([proj(121.2265, 30.9845)[0] + 1.6, 2.4, proj(121.2265, 30.9845)[1] + 1.6], [proj(121.2265, 30.9845)[0], 0.2, proj(121.2265, 30.9845)[1]]) },
  { name: '浦东国际机场', tip: '航空枢纽', go: () => flyTo([proj(121.8053, 31.1440)[0] - 3, 3.2, proj(121.8053, 31.1440)[1] - 3], [proj(121.8053, 31.1440)[0], 0, proj(121.8053, 31.1440)[1]]) },
  { name: '虹桥国际机场', tip: 'T1 · 国内', go: () => flyTo([proj(121.3344, 31.1979)[0] + 1.6, 2.6, proj(121.3344, 31.1979)[1] + 1.6], [proj(121.3344, 31.1979)[0], 0, proj(121.3344, 31.1979)[1]]) },
  { name: '龙阳路枢纽', tip: '磁浮 + 2/7/16号线', go: () => flyTo([proj(121.5530, 31.2090)[0] + 1.4, 2.2, proj(121.5530, 31.2090)[1] + 1.4], [proj(121.5530, 31.2090)[0], 0.2, proj(121.5530, 31.2090)[1]]) },
  { name: '五角场枢纽', tip: '10号线换乘', go: () => flyTo([proj(121.5140, 31.2990)[0] + 1.4, 2.2, proj(121.5140, 31.2990)[1] + 1.4], [proj(121.5140, 31.2990)[0], 0.2, proj(121.5140, 31.2990)[1]]) },
  { name: '莘庄枢纽', tip: '1/5号线换乘', go: () => flyTo([proj(121.3880, 31.1120)[0] + 1.4, 2.2, proj(121.3880, 31.1120)[1] + 1.4], [proj(121.3880, 31.1120)[0], 0.2, proj(121.3880, 31.1120)[1]]) },
  { name: '宝山站', tip: '沪渝蓉高铁 · 在建', go: () => flyTo([proj(121.4890, 31.4050)[0] + 1.4, 2.2, proj(121.4890, 31.4050)[1] + 1.4], [proj(121.4890, 31.4050)[0], 0.2, proj(121.4890, 31.4050)[1]]) },
  { name: '临港新片区', tip: '滴水湖 · 自贸港', go: () => flyTo([proj(121.9270, 30.9010)[0] + 1.8, 2.6, proj(121.9270, 30.9010)[1] + 1.8], [proj(121.9270, 30.9010)[0], 0.2, proj(121.9270, 30.9010)[1]]) },
  { name: '崇明站', tip: '沪渝蓉 · 过江通道', go: () => flyTo([proj(121.4010, 31.6220)[0] + 2.4, 3.2, proj(121.4010, 31.6220)[1] + 2.4], [proj(121.4010, 31.6220)[0], 0.2, proj(121.4010, 31.6220)[1]]) },
];

/* ---------------- 默认视角: 聚焦市中心 ---------------- */
const CENTER_VIEW = {
  name: '上海市中心', tip: '人民广场',
  go: () => flyTo([PEOPLE[0], 3.6, PEOPLE[1] + 5.8], [PEOPLE[0], 0.2, PEOPLE[1]], 1600),
};

/* ---------------- 地标导览: 按"区"分组 ---------------- */
const landmarkGuide = sites.map(s => {
  const hm = (s.height || 0.06) / 0.0016;
  const d = Math.max(1.6, Math.min(9, hm / 42));
  return {
    name: s.name, sub: s.sub, cat: s.cat, color: s.color,
    dist: districtOf(s.lon, s.lat),
    lon: s.lon, lat: s.lat, poi: s.poi,
    go: () => flyTo(
      [s.x - d * 0.62, Math.max(1.1, hm * 0.0016 * 1.25 + 0.7), s.z + d],
      [s.x, Math.max(0.35, hm * 0.0016 * 0.45), s.z], 1250),
  };
});

const ui = initUI({
  layers: layerDefs, views, hubViews, data,
  transit, cruise, landmarks: landmarkGuide, aviation, mobility,
  modelOf: landmarks.modelOf,
  onSelectLine(ref) { transit.highlightLine(ref); },
});
_uiRef = ui;                                   // 供 setNightMode 安全同步图层开关

if (data.meta) {
  const ts = data.meta.osmTimestamp ? String(data.meta.osmTimestamp).replace('T', ' ').replace('Z', '') : '';
  document.getElementById('ts').textContent = `OSM 数据快照 ${ts} · 编译于 ${data.meta.built || ''}`;
}

/* ---------------- 交互拾取 ---------------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.32);
const hitPoint = new THREE.Vector3();

let downPos = null, downTime = 0;
canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; downTime = performance.now(); });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  const dt = performance.now() - downTime;
  downPos = null;
  if (moved > 6 || dt > 600) return;
  handleClick(e);
});

const siteByName = new Map(sites.map(s => [s.name, s]));
function landmarkOf(obj) {
  let o = obj;
  while (o) { if (o.userData && o.userData.landmark) return o.userData.landmark; o = o.parent; }
  return null;
}

function handleClick(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (landmarks.group.visible) {
    const lh = raycaster.intersectObjects(landmarks.group.children, true);
    for (const h of lh) {
      const lm = landmarkOf(h.object);
      if (!lm) continue;
      const s = siteByName.get(lm.name);
      transit.markAt(s ? s.x : h.point.x, s ? s.z : h.point.z, Y.ground);
      if (s && s.poi) return ui.showPOI(s.poi);
      return ui.showLandmark(lm);
    }
  }

  let hit = null;
  if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    const { x, z } = hitPoint;
    const cands = [];
    if (transit.metroGroup.visible) { const r = transit.metroGrid.nearest(x, z, 0.32); if (r) cands.push({ kind: 'metro', r, w: 1.0 }); }
    if (transit.busStops.visible) { const r = transit.busGrid.nearest(x, z, 0.18); if (r) cands.push({ kind: 'bus', r, w: 0.78 }); }
    if (cruise.group.visible && cruise.markers.length) {
      let bd = 0.35, bt = null, bi = -1;
      cruise.markers.forEach((m, i) => { const t = m.userData.data; const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; bt = m; bi = i; } });
      if (bt) cands.push({ kind: 'terminal', r: { i: bt.userData.data, d: bd }, w: 1.0, node: bt });
    }
    if (cands.length) {
      cands.sort((a, b) => (a.r.d / a.w) - (b.r.d / b.w));
      hit = cands[0];
      if (hit.kind === 'metro') { const s = data.metro.stations[hit.r.i]; transit.markAt(s.x, s.z, Y.metro); flyToPoint(s.x, s.z, 3.0); return ui.showMetroStation(s); }
      if (hit.kind === 'bus') { const s = data.bus.stops[hit.r.i]; transit.markAt(s.x, s.z, Y.bus); return ui.showBusStop(s, hit.r.i); }
      if (hit.kind === 'terminal') { const t = hit.r.i; const kind = hit.node.userData.type; transit.markAt(t.x, t.z, Y.road); return ui.showTerminal(t, kind); }
    }
  }

  // 地铁线路 (递归, 线路藏在 metroGroup 内)
  if (transit.metroGroup.visible) {
    /* v=49 性能: 只与地铁线管(lineGroup)求交 —— 原来递归整个 transit 组,
       会把 10056 实例的候车亭/码头体块全部遍历一遍, 是点击卡顿的大头;
       metroLine 标记只存在于线管上, 行为不变 */
    const lh = raycaster.intersectObjects(transit.lineGroup.children, false)
      .find(o => o.object.userData && o.object.userData.type === 'metroLine');
    if (lh) return ui.showMetroLine(lh.object.userData.line, null);
  }

  const dh = raycaster.intersectObjects(districts.meshes, false);
  if (dh.length) {
    const ud = dh[0].object.userData.pick || dh[0].object.userData;
    if (ud && ud.type === 'district') {
      /* v=49 修复: 板块 userData 没有 polys, 直接传会抛 d.polys is not iterable;
         按名称解析出完整区划数据再打开抽屉 */
      const dd = (data.districts.districts || []).find(x => x.name === ud.name) || ud;
      ui.showDistrict(dd); transit.highlightLine(null); transit.clearMark(); return;
    }
  }
  transit.highlightLine(null);
  transit.clearBusRoute();
  transit.clearMark();
  ui.close();
}

function flyToPoint(x, z, dist) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const cur = camera.position.distanceTo(controls.target);
  const target = new THREE.Vector3(x, 0, z);
  const nd = Math.min(cur, dist * 6);
  const pos = target.clone().add(dir.multiplyScalar(nd));
  flyTo([pos.x, pos.y, pos.z], [x, 0, z], 900);
}

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();
let last = 0;
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = Math.min(0.05, t - last);
  last = t;

  /* v=52: 控制台/抽屉交互(拖拽·滚动·折叠动画)期间跳过整帧 —— 画布保持静止后
     合成器可复用上一帧, backdrop 毛玻璃不再每帧重算, UI 不再与 WebGL 抢 GPU。
     相机飞行(flying)期间不冻结。 */
  if (!flying && window.__uiBusy && window.__uiBusy()) return;

  if (flying) {
    const k = Math.min(1, (performance.now() - flying.t0) / flying.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(flying.p0, flying.p1, e);
    controls.target.lerpVectors(flying.t0v, flying.t1v, e);
    if (k >= 1) flying = null;
  }

  water.update(t);
  sky.update(t);
  transit.update(t, camera);
  /* v=51 性能: 图层隐藏时跳过对应每帧更新 —— 公交车层默认隐藏, 原来每帧白跑
     236 辆车的曲线弧长求值; 游轮/航班同理。mobility 补上 dt(原来恒按 0.016 走,
     高刷屏车速会偏快)。 */
  if (cruise.group.visible) cruise.update(t, dt);
  if (aviation.group.visible) aviation.update(t, dt);
  if (mobility.update && mobility.buses.group.visible) mobility.update(t, dt);
  landmarks.update(camera, controls);
  districtsLabels.update(camera.position.distanceTo(controls.target));

  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

animate();

/* ---------------- 收尾 ---------------- */
ldi.style.width = '100%';
/* 刷新/初始化: 直接飞向市中心机位(而非全市全景), 满足"打开即聚焦中心区域" */
setTimeout(() => {
  document.getElementById('loading').classList.add('hide');
  CENTER_VIEW.go();
}, 260);

/* ---------------- 调试采样 ---------------- */
function samplePixels(w = 160, h = 96) {
  const rt = new THREE.WebGLRenderTarget(w, h);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(null);
  rt.dispose();
  return Array.from(buf);
}

window.__SH = {
  scene, camera, controls, renderer, data, districts, districtsLabels, water, city,
  transit, cruise, aviation, mobility, landmarks, basemap, sky, ui, samplePixels,
  views, hubViews, landmarkGuide, flyTo, setNightMode,
};
