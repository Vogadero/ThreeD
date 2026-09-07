import * as THREE from 'three';
import { ribbonGeometry, flatPolygon } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   水系: 黄浦江 / 苏州河 / 主要河道 + 湖泊
   真实河道中心线来自 OSM, 宽度按上海市河道蓝线公开资料给定,
   河面由中心线偏移生成带状网格, 配合自定义 shader 表现流动。
   水面观感: 深浅渐变 + 流动波纹 + 太阳镜面高光 + 岸边泡沫,
   让黄浦江 / 苏州河 / 湖泊看起来更像真实的水。
   ========================================================= */

const VERT = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
void main(){
  vUv = uv;
  vec3 p = position;
  // low-frequency swell (ASCII-only comments: some ANGLE drivers fail on UTF-8 in shader source)
  float w = sin(p.x * 2.6 + uTime * 0.9) * cos(p.z * 2.1 - uTime * 0.72);
  p.y += w * 0.026;
  vW = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uFoam;
uniform vec3  uSky;
uniform vec3  uSun;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vW;

float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// water normal from noise gradient (ASCII comments only - UTF-8 breaks ANGLE compilers)
vec3 waterNormal(vec2 p, float t){
  float e = 0.06;
  float n1 = fbm(p * 1.4 + vec2(t * 0.18, t * 0.11));
  float n2 = fbm(p * 1.4 + vec2(t * 0.18 + e, t * 0.11));
  float n3 = fbm(p * 1.4 + vec2(t * 0.18, t * 0.11 + e));
  vec3 n = vec3((n1 - n2) / e, 1.0, (n1 - n3) / e);
  return normalize(n);
}

void main(){
  vec2 p = vW.xz;
  float t = uTime * 0.30;

  // three noise octaves
  float n1 = fbm(p * 1.25 + vec2(t, t * 0.62));
  float n2 = fbm(p * 2.9  - vec2(t * 0.55, t * 0.88));
  float n3 = fbm(p * 5.2  + vec2(t * 0.40, -t * 0.30));
  float n  = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;

  // flowing light bands (p is vec2 = (world x, world z), so its 2nd component is p.y, not p.z)
  float band  = sin(p.x * 1.9 + p.y * 1.35 - uTime * 1.9 + n1 * 7.5);
  float spark = pow(max(band, 0.0), 5.0);

  // deep in the middle, shallow near banks
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  edge = clamp(edge, 0.0, 1.0);
  float depth = clamp(edge * 0.55 + n * 0.60, 0.0, 1.0);

  vec3 col = mix(uShallow, uDeep, depth);

  // normal + sun specular (tight highlight + broad sheen: reads more like real water)
  vec3 nrm = waterNormal(p, uTime);
  vec3 sunDir = normalize(uSun);
  float sd = max(dot(nrm, sunDir), 0.0);
  float spec  = pow(sd, 40.0);
  float sheen = pow(sd, 8.0);
  col += vec3(1.0, 0.97, 0.86) * (spec * 1.55 + sheen * 0.32);

  // sky reflection
  col = mix(col, uSky, 0.20 + 0.22 * max(nrm.y, 0.0));

  // flowing sparkle
  col += uFoam * spark * 1.0;
  col += uShallow * pow(n1, 3.0) * 0.28;

  // shore foam line, broken up by noise so it is not a uniform glowing band
  float foamN = fbm(p * 6.5 + vec2(t * 0.55, -t * 0.38));
  col += uFoam * pow(1.0 - edge, 3.5) * (0.42 + 0.62 * foamN);
  // slow broad highlight band
  col += uSky * pow(max(sin(p.x * 0.5 + p.y * 0.4 - uTime * 0.5), 0.0), 14.0) * 0.22;

  gl_FragColor = vec4(col, uAlpha);
}`;

/* 河道视觉宽度表(场景单位) —— v=38 定稿值; buildWater 与 buildWaterExclusion 共用,
   保证"剔除建筑用的宽度"和"实际画出来的河宽"永远一致 */
export const RIVER_VIS = {
  '黄浦江': 0.74,
  '苏州河': 0.30,
  '吴淞江': 0.30,
  '大治河': 0.33,
  '金汇港': 0.30,
  '蕰藻浜': 0.28,
  '油墩港': 0.27,
  '川杨河': 0.27,
  '淀浦河': 0.27,
  '张泾河': 0.26,
};
export const RIVER_MIN = 0.12;   // 其余无名小河道最低 0.12 单位(≈100m)

/* ============ v=42: 水面占位 —— 供 buildings.js 剔除"长在河湖里的建筑" ============
   建筑体块从地面(Y.ground)拔起, 而水面在 Y.water, 落在水域里的体块会从河/湖里探出头来。
   这里把河面离散成一串占位圆(圆心沿中心线, 半径=半宽), 湖面保留原多边形;
   buildings.js 用它们做剔除, 宽度表与渲染共用, 两者永远一致。 */
export function buildWaterExclusion(waterData) {
  const circles = [];
  const STEP = 0.18;                                   // 沿线每 ~180m 一个占位圆
  for (const r of waterData.rivers || []) {
    if (r.w / 1000 <= 0) continue;
    const vis = RIVER_VIS[r.name] || Math.max((r.w / 1000) * 1.6, RIVER_MIN);
    const rad = vis / 2 + 0.012;                       // 与 ribbonGeometry 半宽一致(+12m 余量)
    const line = r.line;
    if (!line || line.length < 4) continue;
    let px = line[0], pz = line[1], acc = 0;
    circles.push({ x: px, z: pz, r: rad });
    for (let i = 2; i < line.length; i += 2) {
      const x = line[i], z = line[i + 1];
      acc += Math.hypot(x - px, z - pz);
      if (acc >= STEP) { circles.push({ x, z, r: rad }); acc = 0; }
      px = x; pz = z;
    }
  }
  const lakes = [];
  for (const l of waterData.lakes || []) {
    const p = l.p || [];
    if (p.length < 6) continue;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < z0) z0 = p[i + 1];
      if (p[i + 1] > z1) z1 = p[i + 1];
    }
    lakes.push({ p, x0, x1, z0, z1 });
  }
  return { circles, lakes };
}

export function buildWater(waterData) {
  const group = new THREE.Group();
  group.name = 'water';

  const sunDir = new THREE.Vector3(38, 62, 26).normalize();
  const uniforms = {
    uTime: { value: 0 },
    // 蓝色调: 深水偏墨蓝, 近岸偏明亮天蓝, 一眼看出"蓝色河水"
    uDeep: { value: new THREE.Color('#0d3d6e') },
    uShallow: { value: new THREE.Color('#4fb8e8') },
    uFoam: { value: new THREE.Color('#e8f7ff') },
    uSky: { value: new THREE.Color('#bfdff5') },
    uSun: { value: sunDir },
    uAlpha: { value: 0.97 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ---------- 河道: 每条河按真实宽度生成带状水面 ----------
  // v=34 重新定标: 本场景 1 单位 ≈ 0.86km, ribbonGeometry 的 width 直接按"场景单位"理解。
  //   主干道宽 0.0215 单位(≈18m)、次干道 0.0105。要让江河"明显比街道宽一大截"又不被夸张成湖泊,
  // v=37: shader 修好后水面真正渲染出来了, 之前 v=34 的宽度显得偏宽 —— 整体收窄约 40%:
  //   黄浦江 1.30 → 0.80 单位(≈0.69km, 真实 0.45km, 约 1.5 倍夸张), 仍约为主干道的 37 倍宽;
  //   大河 0.27~0.36, 无名小河下限 0.12 单位(≈100m)。
  const riverGeos = [];
  let riverCount = 0;
  for (const r of waterData.rivers || []) {
    if (r.w / 1000 <= 0) continue;
    const vis = RIVER_VIS[r.name] || Math.max((r.w / 1000) * 1.6, RIVER_MIN);
    const g = ribbonGeometry(r.line, vis, Y.water);
    if (g) { riverGeos.push(g); riverCount++; }
  }
  const riverMesh = new THREE.Mesh(mergeGeos(riverGeos), mat);
  riverMesh.renderOrder = 2;
  riverMesh.name = 'rivers';
  group.add(riverMesh);

  // ---------- 湖泊 / 大型水面 (v=31: 按面积轻微外扩, 让湖看起来更显眼) ----------
  const lakeGeos = [];
  for (const l of waterData.lakes || []) {
    // 计算湖泊多边形面积, 面积越大向外扩越多
    let area = 0, cx = 0, cz = 0;
    const lp = l.p || [];
    const ln = lp.length / 2;
    for (let i = 0; i < ln; i++) {
      const ax = lp[i * 2], az = lp[i * 2 + 1];
      const bx = lp[((i + 1) % ln) * 2], bz = lp[((i + 1) % ln) * 2 + 1];
      area += ax * bz - bx * az;
      cx += ax; cz += az;
    }
    area = Math.abs(area) * 0.5;
    cx /= ln; cz /= ln;
    // v=37: 湖面外扩同步收窄一档 (>3 km² 扩 0.10, >1 km² 扩 0.06, >0.3 km² 扩 0.03)
    // v=38: 湖面外扩再轻收一档 (>3 km² 扩 0.09, >1 km² 扩 0.055, >0.3 km² 扩 0.025)
    const pad = area > 3.0 ? 0.09 : area > 1.0 ? 0.055 : area > 0.3 ? 0.025 : 0;
    let padded = lp;
    if (pad > 0) {
      // 从质心向外推 pad 距离
      padded = new Array(ln * 2);
      for (let i = 0; i < ln; i++) {
        const x = lp[i * 2], z = lp[i * 2 + 1];
        const dx = x - cx, dz = z - cz;
        const len = Math.hypot(dx, dz) || 1;
        padded[i * 2] = x + (dx / len) * pad;
        padded[i * 2 + 1] = z + (dz / len) * pad;
      }
    }
    const g = flatPolygon(padded, Y.water);
    if (g) {
      /* v=41: 湖泊补 UV —— flatPolygon 原本不生成 uv, shader 里 vUv 恒为 (0,0):
         edge 恒 0 → 深浅梯度失效, 且岸线泡沫 pow(1-edge,3.5)=1 打满整片湖, 湖面发白发亮。
         这里按"到质心的归一化距离"写 uv.x: 湖心 0.5 → 岸边 1.0,
         对应 shader edge = 1-|uv.x-0.5|*2 → 湖心 1(深) 岸边 0(浅), 泡沫只在岸边。 */
      const pa = g.attributes.position.array;
      const uvArr = new Float32Array((pa.length / 3) * 2);
      let rMax = 1e-6;
      for (let i = 0; i < pa.length; i += 3) {
        const rr = Math.hypot(pa[i] - cx, pa[i + 2] - cz);
        if (rr > rMax) rMax = rr;
      }
      for (let i = 0; i < pa.length; i += 3) {
        const rr = Math.hypot(pa[i] - cx, pa[i + 2] - cz);
        uvArr[(i / 3) * 2] = 0.5 + 0.5 * (rr / rMax);
        uvArr[(i / 3) * 2 + 1] = 0.5;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      lakeGeos.push(g);
    }
  }
  let lakeMesh = null;
  if (lakeGeos.length) {
    lakeMesh = new THREE.Mesh(mergeGeos(lakeGeos), mat);
    lakeMesh.renderOrder = 2;
    lakeMesh.name = 'lakes';
    group.add(lakeMesh);
  }

  // ---------- 高亮: 所有河道中心加一层发光岸线 ----------
  const glowMat = new THREE.LineBasicMaterial({
    color: new THREE.Color('#9ff0e0'), transparent: true, opacity: 0.78,
  });
  for (const r of waterData.rivers || []) {
    if (r.w / 1000 <= 0) continue;
    const pts = [];
    for (let i = 0; i < r.line.length; i += 2) pts.push(new THREE.Vector3(r.line[i], Y.water + 0.006, r.line[i + 1]));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, glowMat);
    l.name = 'glow_' + r.name;
    group.add(l);
  }

  return {
    group,
    riverCount,
    lakeCount: waterData.lakes ? waterData.lakes.length : 0,
    update(t) { uniforms.uTime.value = t; },
  };
}

/** 简易几何合并 (只处理 position/uv/normal + index) */
export function mergeGeos(geos) {
  if (geos.length === 1) return geos[0];
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : 0;
  }
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const nrm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    pos.set(p, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, vo * 3);
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    }
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
