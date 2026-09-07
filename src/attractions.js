import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildGrid, loadJSON, extrudePolygon } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   网红景点标记
   推荐指数由 5 项真实可计算指标加权得出。

   两套可视化并存:
   1) 真实建模形状 (poiShapes) —— 由 data/poi_buildings.json 提供每个
      景点的 footprint: 优先复用 OSM 建筑轮廓与高度, 匹配不到的用
      正八边形兜底。合并成单个 Mesh, 顶点色按类目着色。
   2) 三维图钉 (poiPins) —— 原来的立体图钉保留, 作为空中辅助标记,
      方便远距离定位与点击。
   ========================================================= */

const BASE_Y = Y.poi;               // 图钉悬浮高度
// 形状贴地: 在建筑地面之上抬 1.5 米, 避免与 city 图层里同一栋
// OSM 体块的顶面共面而产生 z-fighting 闪烁
const SHAPE_Y = Y.ground + 0.0015;

const POI_SHAPES_URL = 'data/poi_buildings.json';

const KIND_COLOR = {
  attraction: '#4fd6ff', museum: '#ffb703', artwork: '#c77dff', gallery: '#c77dff',
  viewpoint: '#5ef2a0', theme_park: '#ff6b6b', zoo: '#ffb703', nature_reserve: '#5ef2a0',
  park: '#5ef2a0', monument: '#ffd166', memorial: '#ffd166', landmark: '#ff8ec7',
  apartments: '#e8d5a8', building: '#e8d5a8', statue: '#c77dff', palace: '#ffd166',
  place_of_worship: '#ffe08a', theatre: '#ff8ec7', cinema: '#ff8ec7', arts_centre: '#c77dff',
  archaeological_site: '#ffd166', historic: '#ffd166', ruins: '#ffd166', castle: '#ffd166',
  communications_tower: '#ff6b6b', tower: '#ff8ec7', hotel: '#9fd8ff', resort: '#9fd8ff',
  water_park: '#4fd6ff', garden: '#5ef2a0', observatory: '#ffb703', sports_centre: '#5ef2a0',
};
const FALLBACK_COLOR = '#4fd6ff';

/** 一枚地图针标: 顶部圆头 + 锥形针体收向底部 (y=0), 经典 POI 立体标牌 */
function pinGeometry() {
  const parts = [];
  // 锥形针体 (顶点在底部 y=0, 底面在顶部)
  const cone = new THREE.ConeGeometry(0.024, 1.0, 18);
  cone.rotateZ(Math.PI);     // 顶点朝下
  cone.translate(0, 0.5, 0); // 顶点落到原点
  parts.push(cone);
  // 圆头 (顶部)
  const head = new THREE.SphereGeometry(0.026, 16, 12);
  head.translate(0, 1.0, 0);
  parts.push(head);
  // 顶端高光点 (让针标更亮, 像发光地标)
  const dot = new THREE.SphereGeometry(0.011, 12, 10);
  dot.translate(0, 1.04, 0);
  parts.push(dot);
  return mergeGeometries(parts, false);
}

/**
 * 兜底 footprint: 正八边形, 逆时针, 首尾不重复。
 * 与 build_poi_buildings.py 的 octagon() 保持一致。
 */
function octagonFlat(x, z, stars) {
  const r = (25 + stars * 5) / 1000;      // 25 + stars*5 米 -> 场景单位
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    out.push(x + r * Math.cos(a), z + r * Math.sin(a));
  }
  return out;
}

/**
 * 把 poi_buildings.json 的 footprint 逐个挤出并合并成一个带顶点色的 Mesh。
 *
 * @param data  poi_buildings.json -> {pois:[{name,kind,x,z,color,h,p:[x,z,...]}]}
 * @param pois  attractions.json 的原始景点数组 (用于对齐与兜底)
 * @returns {THREE.Mesh|null} 合并后的形状网格, 无有效几何时返回 null
 */
export function buildPOIShapes(data, pois) {
  const list = (data && data.pois) || [];
  if (!list.length) return null;

  const geos = [];
  const colors = [];
  const c = new THREE.Color();

  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    const src = (pois && pois[i]) || {};
    const stars = Math.max(0, Math.min(5, src.stars || 1));

    // footprint: 优先用预生成的轮廓, 缺失/退化则现场补一个八边形
    let flat = (s.p && s.p.length >= 6) ? s.p : octagonFlat(
      typeof s.x === 'number' ? s.x : src.x || 0,
      typeof s.z === 'number' ? s.z : src.z || 0,
      stars
    );
    let h = (typeof s.h === 'number' && s.h > 0) ? s.h : 0.008 + stars * 0.004;

    const g = extrudePolygon(flat, h, SHAPE_Y);
    if (!g || !g.getAttribute('position')) continue;

    // 顶点色: 用 JSON 里烘好的颜色, 取不到再按 kind 查表
    let hex = (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color))
      ? s.color
      : (KIND_COLOR[s.kind] || KIND_COLOR[src.kind] || FALLBACK_COLOR);
    c.set(hex);

    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      arr[k * 3] = c.r;
      arr[k * 3 + 1] = c.g;
      arr[k * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));

    geos.push(g);
    colors.push(hex);
  }

  if (!geos.length) return null;

  const merged = mergeGeometries(geos, false);
  // 合并后各子几何已无用, 及时释放显存/内存
  geos.forEach(g => g.dispose());
  if (!merged) return null;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0.1, emissiveIntensity: 0.0,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'poiShapes';
  mesh.userData = { type: 'poiShapes', count: geos.length };
  return mesh;
}

export function buildAttractions(data /*, sites */) {
  const group = new THREE.Group();
  group.name = 'attractions';
  const pois = data.pois || [];
  const grid = buildGrid(pois, 0.5, p => p.x, p => p.z);

  /* v=46: 网红景点 generic 可视化(立体图钉 poiPins)整体下线。
     379 处地标精模 + 三重替代删除规则已覆盖全部真实景点;
     剩余 1365 个 POI 为商铺/道路/雕像/游乐设施等长尾, 不再渲染彩色图钉。
     数据(pois)与拾取网格(grid)保留; 若要恢复图钉, 回退本函数即可。 */
  return { group, mesh: null, grid, pois, update() {} };
}
