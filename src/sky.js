import * as THREE from 'three';
import { makeRand } from './util.js?v=32';

/* =========================================================
   天空星系 v=29: 星空穹顶 + 银河带 + 闪烁星点 + 星云 + 流星
   ---------------------------------------------------------
   · 渐变天穹 (深空蓝 → 黑色), 顶部有微弱极光色斑
   · 3400 颗星点: 多色温, 闪烁动画, 大星带十字光芒
   · 银河带: 沿大圆弧分布, 紫粉色, 中心更密
   · 星云色斑: 几个大块状色雾 (紫色/蓝色), 增加夜空层次
   · 流星: 每 ~12 秒一颗, 从天顶划向地平线
   ========================================================= */

const RADIUS = 400;   // v=33: 天穹半径加大到 400km, 让 180~300km 的日月都舒舒服服待在"天里面"

function buildDome() {
  const geo = new THREE.SphereGeometry(RADIUS, 48, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color('#010210') },
      uHorizon: { value: new THREE.Color('#0a1a3a') },
      uBottom: { value: new THREE.Color('#02030a') },
      uNebula: { value: new THREE.Color('#3a2068') },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying float vH;
      varying vec3 vP;
      void main(){
        vP = normalize(position);
        vH = vP.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform vec3 uNebula;
      uniform float uTime;
      varying float vH;
      varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){
        float v=0.0, a=0.5;
        for(int i=0;i<3;i++){ v += a*noise(p); p *= 2.07; a *= 0.5; }
        return v;
      }
      void main(){
        float h = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 col;
        if (h > 0.5) {
          col = mix(uHorizon, uTop, smoothstep(0.5, 1.0, h));
        } else {
          col = mix(uBottom, uHorizon, smoothstep(0.0, 0.5, h));
        }
        if (h > 0.45) {
          float ang = atan(vP.z, vP.x);
          float n = fbm(vec2(ang * 2.0 + uTime * 0.01, h * 4.0));
          float nebula = smoothstep(0.55, 0.95, n) * smoothstep(0.45, 0.7, h) * (1.0 - smoothstep(0.92, 1.0, h));
          col = mix(col, uNebula, nebula * 0.55);
        }
        float horizonGlow = exp(-abs(vH) * 8.0) * 0.12;
        col += vec3(0.20, 0.10, 0.05) * horizonGlow;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyDome';
  mesh.renderOrder = -100;
  return { mesh, mat };
}

function buildStars(count = 3400) {
  const rand = makeRand(31415);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pal = [
    [0.78, 0.84, 1.00],   // 蓝白
    [1.00, 0.92, 0.78],   // 黄白
    [1.00, 0.74, 0.62],   // 橙红
    [0.72, 0.66, 0.94],   // 紫
    [0.92, 0.98, 0.96],   // 白
  ];
  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand() * 0.92;          // y > 0 占多数
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v * 1.1);
    const r = RADIUS * (0.96 + rand() * 0.03);
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const p = pal[(rand() * pal.length) | 0];
    const k = 0.6 + rand() * 0.4;
    col[i * 3]     = p[0] * k;
    col[i * 3 + 1] = p[1] * k;
    col[i * 3 + 2] = p[2] * k;
    siz[i] = 1.3 + rand() * rand() * 7.0;   // 大量小星 + 少量大星
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSize',    new THREE.Float32BufferAttribute(siz, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixel: { value: window.devicePixelRatio || 1 },
    },
    vertexShader: /* glsl */`
      attribute float aSize;
      varying vec3 vC;
      varying float vS;
      uniform float uTime;
      uniform float uPixel;
      void main(){
        vC = color;
        vS = aSize;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float ph = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float flick = 0.72 + 0.28 * sin(uTime * 1.4 + ph * 6.2831);
        gl_PointSize = aSize * flick * uPixel;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      varying float vS;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        float halo = pow(core, 4.0) * 0.7;
        vec3 col = vC * (core + halo);
        float glow = step(2.5, vS);
        float spike = max(
          smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.5, 0.0, abs(uv.y)),
          smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.5, 0.0, abs(uv.x))
        );
        col += vC * spike * glow * 0.9;
        gl_FragColor = vec4(col, core);
      }
    `,
    vertexColors: true,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = -90;
  pts.name = 'starPoints';
  return { pts, mat: m };
}

function buildMilkyWay(count = 1800) {
  const rand = makeRand(271828);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tilt = 1.05;
  const tiltX = 0.32;
  for (let i = 0; i < count; i++) {
    const a = (i / count + rand() * 0.004) * Math.PI * 2;
    const rr = RADIUS * (0.92 + rand() * 0.06);
    const wobble = (rand() - 0.5) * 0.18;
    let x = Math.cos(a) * rr;
    let y = Math.sin(a) * rr;
    let z = 0;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt) + wobble * rr * 0.06;
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt) + wobble * rr * 0.06;
    const x2 = x * Math.cos(tiltX) - z2 * Math.sin(tiltX);
    const z3 = x * Math.sin(tiltX) + z2 * Math.cos(tiltX);
    pos[i * 3]     = x2;
    pos[i * 3 + 1] = y2;
    pos[i * 3 + 2] = z3;
    // 银河中心更亮, 边缘更暗 (亮度按 a 的 sin 调制)
    const bright = 0.4 + 0.6 * Math.pow(Math.max(0, Math.sin(a + Math.PI / 2)), 2.0);
    const k = bright * (0.45 + rand() * 0.55);
    // 银河主体偏紫粉, 边缘偏蓝
    const t = Math.max(0, Math.sin(a + Math.PI / 2));
    col[i * 3]     = (0.86 - 0.3 * t) * k;
    col[i * 3 + 1] = (0.72 - 0.2 * t) * k;
    col[i * 3 + 2] = (0.92 + 0.1 * t) * k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = -89;
  pts.name = 'milkyWay';
  return pts;
}

/* 流星: 一条长条 + 头部高亮, 从天顶划向地平线
   v=30: 增加到 5 颗, 各自独立的周期 (3~14 秒随机) + 不同方向 + 不同速度 + 拖尾长度 */
function buildMeteor(lengthMul = 1) {
  const grp = new THREE.Group();
  grp.name = 'meteor';
  // 流星本体: 拉伸的细长三角形 (头亮尾暗), lengthMul 控制拖尾长短
  const L = 8 * lengthMul;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,         // 头
    -L * 0.5, 0, -0.3,     // 尾1
    -L, 0, -0.1,    // 尾2
  ], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([
    1, 1, 1,         // 头 (白)
    0.4, 0.6, 1,     // 尾1 (淡蓝)
    0, 0, 0,         // 尾2 (黑, 自然渐隐)
  ], 3));
  const m = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  grp.add(line);
  grp.visible = false;
  return { grp, line, m };
}

const METEOR_SPECS = [
  { period:  4.0, dur: 0.18, length: 1.0, hue: 0 },   // 高频流星, 短拖尾
  { period:  6.5, dur: 0.22, length: 1.2, hue: 30 },  // 暖色
  { period:  9.0, dur: 0.20, length: 1.5, hue: 200 }, // 蓝色
  { period: 12.0, dur: 0.16, length: 0.8, hue: 320 }, // 粉红
  { period: 16.0, dur: 0.14, length: 1.0, hue: 0 },   // 长周期
];

function updateMeteor(meteor, spec, t) {
  const phase = (t % spec.period) / spec.period;
  if (phase < spec.dur) {
    meteor.grp.visible = true;
    const p = phase / spec.dur;          // 0 → 1
    if (p < 0.02) {
      const seed = Math.floor(t / spec.period) + spec.hue;
      const rand = makeRand(seed * 7919);
      meteor._ang = rand() * Math.PI * 2;
      meteor._alt = 0.8 + rand() * 0.4;       // 50~80 度仰角
    }
    const ang = meteor._ang;
    const alt = meteor._alt;
    // 从高处划向低处, 进度用平方曲线让初速慢末速快
    const fast = p * p;
    const r = RADIUS * (0.95 - fast * 0.40);
    const y = r * Math.sin(alt) * (1 - fast * 1.2);
    const horiz = r * Math.cos(alt);
    meteor.grp.position.set(
      Math.cos(ang) * horiz, Math.max(8, y), Math.sin(ang) * horiz
    );
    // 朝向运动方向
    meteor.grp.lookAt(
      Math.cos(ang) * horiz - Math.sin(ang) * 1,
      Math.max(8, y) - 2.0,
      Math.sin(ang) * horiz + Math.cos(ang) * 1
    );
    // 淡入 + 淡出 (头亮尾虚)
    meteor.m.opacity = Math.sin(p * Math.PI) * 0.95;
  } else {
    meteor.grp.visible = false;
  }
}

/* =========================================================
   太阳 + 月亮
   ---------------------------------------------------------
   v=38: 重新设计位置模型 —— 日月的方位角随时辰扫过天空,
         仰角随季节(年内天数)变化; 两者始终可见(不论昼夜 /
         星系开关), 仅亮度不同。算法见下方 solarDeclination /
         sunAngles / skyPosition。
   · 太阳: canvas 太阳表面贴图 + 3 层光晕, 半径 42(明显大于月亮)
   · 月亮: canvas 月面纹理(月海暗斑) + 微弱光晕, 半径 15
   · 亮度: 白天亮 / 夜间暗; 月亮还按"月龄"做盈亏明暗起伏
   ========================================================= */
function makeSunTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  // 基础: 中心白 → 边缘黄的径向渐变
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, '#fff8d4');
  grad.addColorStop(0.75, '#ffdc6a');
  grad.addColorStop(1, '#ff8c2a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // 太阳黑子: 几个深色小圆斑
  const spots = [[88, 96, 8], [160, 130, 6], [120, 180, 7], [70, 170, 5], [180, 80, 5]];
  for (const [x, y, r] of spots) {
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, 'rgba(120,60,0,0.55)');
    sg.addColorStop(1, 'rgba(255,180,40,0)');
    g.fillStyle = sg;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 日冕纹理: 微弱的等离子丝
  g.globalAlpha = 0.18;
  g.strokeStyle = '#fff4c8'; g.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const a = (i / 14) * Math.PI * 2;
    g.moveTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110);
    g.lineTo(128 + Math.cos(a) * 122, 128 + Math.sin(a) * 122);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMoonTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  // 基础: 灰白渐变 (模拟月面光照)
  const grad = g.createRadialGradient(256, 230, 30, 256, 256, 256);
  grad.addColorStop(0, '#f4f0e2');
  grad.addColorStop(0.6, '#cdc7b3');
  grad.addColorStop(1, '#8a8472');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // 月海 (暗色斑块, 真实月球上的阴暗平原)
  const maria = [
    [200, 180, 80, 60, 'rgba(80,74,58,0.35)'],  // 静海
    [310, 220, 55, 45, 'rgba(75,70,55,0.30)'],  // 丰富海
    [150, 280, 70, 55, 'rgba(78,72,56,0.32)'],  // 雨海
    [280, 320, 60, 50, 'rgba(82,76,60,0.28)'],  // 危海
    [220, 380, 50, 40, 'rgba(78,72,56,0.26)'],  // 云海
    [340, 380, 40, 35, 'rgba(80,74,58,0.25)'],  // 湿海
  ];
  for (const [x, y, w, h, c] of maria) {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 月坑 (大大小小的圆形暗斑, 模拟环形山)
  const craters = [
    [180, 150, 12], [300, 160, 9], [240, 200, 14], [160, 220, 10],
    [350, 230, 11], [220, 270, 8], [290, 300, 13], [180, 340, 10],
    [320, 360, 9], [260, 410, 12], [380, 280, 7], [140, 180, 7],
  ];
  for (const [x, y, r] of craters) {
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(50,46,36,0.55)');
    cg.addColorStop(0.6, 'rgba(110,104,88,0.20)');
    cg.addColorStop(1, 'rgba(180,174,154,0)');
    g.fillStyle = cg;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 整体轻微噪声让月面有质感
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = `rgba(60,54,40,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildSun() {
  const grp = new THREE.Group();
  grp.name = 'sun';
  // v=37: 太阳明显比月亮大 (半径 42 vs 月亮 15, 约 2.8 倍), 光晕也放大一档
  // v=39: fog:false —— 天空元素不参与雾计算。scene.fog.far 仅 320(白天)/260(夜间),
  //   而太阳在 360 处, 超出雾远端会被 100% 染成雾色 #050912, 变成一块黑饼 —— 这正是
  //   "只看到 1 个球"(其实是看不见日月)的根因之一。
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(42, 48, 36),
    new THREE.MeshBasicMaterial({ map: makeSunTexture(), toneMapped: false, fog: false })
  );
  sun.renderOrder = -80;
  grp.add(sun);
  // 内层光晕 (紧贴太阳的亮黄)
  const halo1 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture('#ffe890', '#ffb84a'),
    color: 0xffffff, transparent: true, opacity: 0.95, toneMapped: false,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo1.scale.set(120, 120, 1);
  halo1.renderOrder = -79;
  grp.add(halo1);
  // 外层光晕 (更大更淡的橙色)
  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture('#ffb84a', '#ff6020'),
    color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo2.scale.set(250, 250, 1);
  halo2.renderOrder = -78;
  grp.add(halo2);
  // v=38: 初始位置(每帧由 update 按时间/季节重算, 这里仅避免首帧落在原点)
  grp.position.set(150, 150, -250);
  grp.userData.halo = halo1;
  grp.userData.outerHalo = halo2;
  grp.userData.core = sun;
  return grp;
}

function buildMoon() {
  const grp = new THREE.Group();
  grp.name = 'moon';
  // v=35: 月球核心改用 MeshBasicMaterial (自发光质感, 白天也清晰可见),
  //   夜晚通过 material.color 调暗 —— 之前 MeshStandardMaterial 白天只有 0.3 左右的亮度,
  //   在明亮天空背景下几乎隐形, 这就是"日间模式只能看到 1 个球"的第二个原因。
  // v=37: 月亮半径 18 → 15, 明显小于太阳 (42), 二者大小区分开。
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(15, 48, 36),
    new THREE.MeshBasicMaterial({ map: makeMoonTexture(), toneMapped: false, fog: false })
  );
  moon.renderOrder = -80;
  grp.add(moon);
  // 月亮光晕 (微弱, 比太阳小)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture('#e8e4d4', '#8a8470'),
    color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.scale.set(42, 42, 1);
  halo.renderOrder = -79;
  grp.add(halo);
  // v=38: 初始位置(每帧由 update 按时间/季节重算)
  grp.position.set(-200, 120, 230);
  grp.userData.halo = halo;
  grp.userData.core = moon;
  return grp;
}

function makeHaloTexture(innerHex, outerHex) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, innerHex);
  grad.addColorStop(0.3, innerHex + 'cc');
  grad.addColorStop(0.6, outerHex + '44');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* =========================================================
   太阳 / 月亮 位置模型 (v=38 建立, v=39 修正"只看到 1 个球")
   ---------------------------------------------------------
   · 太阳: 由"时间(小时) + 季节(年内天数)"经近似太阳位置公式
           算出仰角/方位角, 沿天穹半径 SUN_DIST 摆放。
   · 月亮: 由独立月相驱动 elongation(70°~290°), 沿天穹 MOON_DIST 摆放;
           盈亏亮度由 elongation 决定(180° 满月最亮)。
           v=38 曾把它锁死在"与太阳对冲", 结果二者夹角恒 ~139°,
           永远一前一后无法同框 —— v=39 已解除。
   · 不论白天黑夜、星系是否开启, 日月都"存在"(始终 visible),
           只是亮度不同; 方位角随时辰扫过天空, 仰角随季节变化。
   · 物理角度会经 visElevation / visTheta 压缩进"可见天空带",
           保证默认视角下两个球都在画面内 (详见下方 v=39 注释)。
   ========================================================= */
const DEG = Math.PI / 180;
const SH_LAT = 31.23 * DEG;          // 上海纬度
const SUN_DIST = 360;                 // 太阳距原点(场景单位), 比旧版(~274)更远
const MOON_DIST = 345;               // 月亮距原点
const SKY_DAY_SEC = 200;             // 模拟一整天所需的真实秒数
const SKY_YEAR_DAYS = 60;            // 模拟一整年所需的"天数"(季节变化速度)

/* ---- v=39: 可视天空带 —— 修复"太阳月亮只看到 1 个球" ----
   排查出两个叠加原因:
   ① 雾(主因): scene.fog.far 只有 320(白天)/260(夜间), 而日月摆在 345~360,
      超出雾远端 → 被 100% 染成雾色 #050912, 渲染成一块黑饼。
      解法: 日月全部材质加 fog:false (见 buildSun / buildMoon)。
   ② 方位: 上海 31.23°N, 太阳物理方位恒在南天(+Z); 而默认相机在 (0,15,24)
      朝北(-Z)俯视, 太阳永远落在相机背后(sunInFrontOfCam ≈ -0.85)。
      同时月亮被锁死在"与太阳对冲"的位置(hour+12 再加半年赤纬偏移),
      二者夹角约 139°, 永远一前一后, 不可能同框。
      解法: 把物理仰角/方位角"压缩映射"进默认视野内的一条天空带 ——
        · 仰角: 物理 [-12°, 80°] → 视觉 [3.5°, 13°]  (始终在地平线之上、画面上沿之内)
        · 方位: 物理 az(北起顺时针) → 视觉 θ ∈ ±31° (0 = 正前方 -Z, 正 = 东 +X)
      方向依旧随时辰(方位)与季节(仰角)变化, 只是幅度压缩到"看得见"的范围。
   ③ 月亮改用独立月相驱动 elongation(70°~290°), 不再与太阳死死锁对冲,
      于是有时同侧、有时对侧, 两个球可以同时出现在天空里。 */
const VIS_EL_MIN = 3.5 * DEG;        // 视觉仰角下限(贴地平线)
const VIS_EL_MAX = 13.0 * DEG;       // 视觉仰角上限(画面上沿之内)
const PHYS_EL_LO = -12 * DEG;        // 物理仰角映射下界(地平线以下)
const PHYS_EL_HI = 80 * DEG;         // 物理仰角映射上界(夏至正午)
const VIS_SPREAD = 62 * DEG;         // 方位可视总张角(左右各 31°, 小于水平半视角 ~38°)
const MOON_CYCLE_SEC = 420;          // 一个朔望周期所需的真实秒数(便于观察到相位变化)
const MOON_SEP_MIN = 18 * DEG;       // 与太阳的最小"视觉"角距(避免被太阳光晕吞掉)
const MOON_SEP_MAX = 31 * DEG;       // 最大视觉角距(= 可视带半张角, 此时二者分处两端)
const MOON_ILLUM_FLOOR = 0.35;       // 亮度下限(保证新月时也看得见)

/* 赤纬 δ: 随年内天数变化, 范围约 ±23.44° */
function solarDeclination(dayOfYear) {
  return 0.4093 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
}
/* 由(天数, 小时)求太阳的仰角 el 与方位角 az(自正北顺时针) */
function sunAngles(dayOfYear, hour) {
  const decl = solarDeclination(dayOfYear);
  const H = 15 * (hour - 12) * DEG;                 // 时角
  const sinEl = Math.sin(SH_LAT) * Math.sin(decl) + Math.cos(SH_LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosEl = Math.cos(el);
  const cosAz = (Math.sin(decl) - Math.sin(SH_LAT) * Math.sin(el)) / (Math.cos(SH_LAT) * cosEl);
  const sinAz = -Math.sin(H) * Math.cos(decl) / cosEl;
  const az = Math.atan2(sinAz, Math.max(-1, Math.min(1, cosAz)));
  return { el, az };
}
/* 物理仰角 → 视觉仰角: 线性压缩到"可见天空带"内 */
function visElevation(el) {
  const u = Math.max(0, Math.min(1, (el - PHYS_EL_LO) / (PHYS_EL_HI - PHYS_EL_LO)));
  return VIS_EL_MIN + u * (VIS_EL_MAX - VIS_EL_MIN);
}
/* 物理方位角 → 视觉偏角 θ: 0=正前方(-Z), 正=东(+X), 范围 ±VIS_SPREAD/2 */
function visTheta(az) {
  const a = (az + 2 * Math.PI) % (2 * Math.PI);      // 归一到 [0,2π): 0=北, 顺时针
  return ((Math.PI - a) / Math.PI) * (VIS_SPREAD / 2);
}
/* 由(视觉仰角, 视觉偏角, 距离)得到场景坐标
   v=51 性能: 复用模块级向量(所有调用方都是 .copy() 立即消费, 不持有引用) */
const _skyV = new THREE.Vector3();
function skyPosVis(vEl, theta, dist) {
  const ce = Math.cos(vEl);
  return _skyV.set(
    Math.sin(theta) * ce * dist,
    Math.sin(vEl) * dist,
    -Math.cos(theta) * ce * dist
  );
}
/* 由(物理仰角, 物理方位角, 距离)得到场景坐标 —— 结果保证落在默认视野内 */
function skyPosition(el, az, dist) {
  return skyPosVis(visElevation(el), visTheta(az), dist);
}
/* 由(时间 t)还原出小时与年内天数, 作为太阳位置输入 */
function simClock(t) {
  const dayFrac = ((t / SKY_DAY_SEC) + 0.54) % 1;        // 0.54 → 初始约 13:00(午后)
  const hour = dayFrac * 24;
  const dayOfYear = Math.floor((t / SKY_DAY_SEC) / SKY_YEAR_DAYS * 365) % 365;
  return { hour, dayOfYear };
}

export function buildSky() {
  const group = new THREE.Group();
  group.name = 'sky';
  const { mesh: dome, mat: domeMat } = buildDome();
  const { pts: stars, mat: starMat } = buildStars(3400);
  const milky = buildMilkyWay(1800);
  // 5 颗流星, 各自独立周期与方向
  const meteors = METEOR_SPECS.map(s => ({ spec: s, ...buildMeteor(s.length) }));
  const sun = buildSun();
  const moon = buildMoon();
  group.add(dome, stars, milky, ...meteors.map(m => m.grp), sun, moon);

  /* v=33 关键修复: 整组始终可见 (这样白天也能看到日月),
     只把"夜空元素"(天穹/星星/银河/流星)归到一个数组单独开关。
     之前用 group.visible 控制, 导致图层关掉时连日月一起隐藏 —— 用户只看到 1 个球的元凶。 */
  const nightObjs = [dome, stars, milky, ...meteors.map(m => m.grp)];
  let nightOn = false;
  const setNight = (v) => {
    nightOn = !!v;
    nightObjs.forEach(o => { o.visible = nightOn; });
  };
  // 初始: 夜晚关 (白天模式), 所以夜空元素先隐藏
  setNight(false);

  return {
    group,
    /** 图层"天空星系"调用: 只开关夜空元素, 不影响日月 */
    setNight,
    /** t: 时间(秒) */
    update(t) {
      starMat.uniforms.uTime.value = t;
      domeMat.uniforms.uTime.value = t;
      // 流星只在夜晚模式下动 (白天不浪费计算)
      if (nightOn) for (const m of meteors) updateMeteor(m, m.spec, t);
      // ---- v=38: 太阳 / 月亮 始终存在(visible), 仅亮度不同; 方位随时辰、仰角随季节变化 ----
      const { hour, dayOfYear } = simClock(t);
      // 太阳: 物理仰角/方位角 → 可见天空带
      const s = sunAngles(dayOfYear, hour);
      const sunVEl = visElevation(s.el);
      const sunTheta = visTheta(s.az);
      sun.position.copy(skyPosVis(sunVEl, sunTheta, SUN_DIST));
      sun.visible = true;                                   // 昼夜都在, 只改亮度
      const dayFactor = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12)); // 6/18 时为 0, 正午为 1
      /* v=40: 太阳贴近地平线时染上暖橙(日出/日落), 升高后回到白黄 —— 纯材质调色, 不涉及 shader */
      const lowK = 1 - Math.min(1, Math.max(0, (sunVEl - VIS_EL_MIN) / (VIS_EL_MAX - VIS_EL_MIN)));
      const warm = 0.35 + 0.65 * lowK;                    // 0.35(当空) ~ 1.0(贴地平线)
      const sunBright = nightOn ? 0.14 : (0.5 + 0.5 * dayFactor);
      sun.userData.core.material.color.setRGB(
        sunBright,
        sunBright * (1 - 0.34 * warm),
        sunBright * (1 - 0.66 * warm)
      );
      sun.userData.halo.material.color.setRGB(1, 1 - 0.18 * warm, 1 - 0.45 * warm);
      sun.userData.outerHalo.material.color.setRGB(1, 1 - 0.30 * warm, 1 - 0.62 * warm);
      sun.userData.halo.material.opacity = nightOn ? 0.10 : (0.35 + 0.50 * dayFactor);
      sun.userData.outerHalo.material.opacity = nightOn ? 0.06 : (0.20 + 0.32 * dayFactor);
      // 月亮: v=39 —— 相位驱动, 不再与太阳死死锁对冲
      const mPhase = (t / MOON_CYCLE_SEC) % 1;                       // 0→1 走完一个朔望月
      const illumRaw = 0.5 - 0.5 * Math.cos(2 * Math.PI * mPhase);   // 0=新月, 1=满月
      // 仰角: 也走物理公式(时辰+相位推进), 保证随季节/时辰起伏
      const ma = sunAngles(dayOfYear, hour + 12 + mPhase * 24);
      const moonVEl = visElevation(ma.el);
      // 方位: 以太阳为基准按相位拉开 18°~31°, 并且始终留在可视带内
      //   (只靠物理方位差会被 ±31° 压缩到不足 10°, 月亮会被太阳的大光晕吞掉)
      const sep = MOON_SEP_MIN + (MOON_SEP_MAX - MOON_SEP_MIN) * illumRaw;
      const half = VIS_SPREAD / 2;
      let moonTheta = sunTheta + (sunTheta > 0 ? -1 : 1) * sep;       // 往太阳的反侧推
      if (moonTheta > half || moonTheta < -half) moonTheta = sunTheta - (sunTheta > 0 ? -1 : 1) * sep;
      moonTheta = Math.max(-half, Math.min(half, moonTheta));
      moon.position.copy(skyPosVis(moonVEl, moonTheta, MOON_DIST));
      moon.visible = true;                                           // 昼夜都在, 只改亮度
      // 盈亏: 满月最亮; 加下限保证新月时也看得见
      const illum = MOON_ILLUM_FLOOR + (1 - MOON_ILLUM_FLOOR) * illumRaw;
      /* v=40: 月亮给一点点冷白偏色(与暖色的太阳区分开), 夜间光晕更强 */
      const moonBright = nightOn ? (0.55 + 0.40 * illum) : (0.42 + 0.28 * illum);
      moon.userData.core.material.color.setRGB(moonBright * 0.96, moonBright * 0.98, moonBright);
      moon.userData.halo.material.color.setRGB(0.90, 0.95, 1.0);
      moon.userData.halo.material.opacity = nightOn ? (0.22 + 0.34 * illum) : (0.14 + 0.12 * illum);
    },
  };
}