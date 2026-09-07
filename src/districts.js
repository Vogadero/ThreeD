import * as THREE from 'three';
import { extrudePolygon, toColor } from './util.js?v=32';
import { Y } from './basemap.js?v=32';

/* =========================================================
   行政区: 16 个区各自挤出为彩色三维地块
   边界来自民政部行政区划 (阿里云 DataV.GeoAtlas)
   地块为半透明覆盖层, 让下层的真实卫星底图透出, 避免画面抽象
   ========================================================= */

export function buildDistricts(data) {
  const group = new THREE.Group();
  group.name = 'districts';
  const meshes = [];

  // 农业 / 郊区为主的区: 地块填充改用绿色, 让"农田区"一眼偏绿
  const RURAL = new Set(['崇明区', '青浦区', '松江区', '奉贤区', '金山区', '嘉定区']);

  for (const d of data.districts) {
    const col = toColor(d.color, '#4a6fa5');
    const h = Y.districtTop - Y.districtBase;
    const isRural = RURAL.has(d.name);

    const parts = [];
    for (const poly of d.polys) {
      const g = extrudePolygon(poly.p, h, Y.districtBase);
      if (g) parts.push(g);
    }
    if (!parts.length) continue;

    // 压低 district 颜色饱和度, 避免覆盖真实卫星底图后显得"红红绿绿"
    // (农业郊区则直接染成绿地色, 让农田区在关掉卫星底图时也能看出是绿色)
    const baseCol = isRural
      ? new THREE.Color('#3fa64f').lerp(col, 0.30)
      : col.clone().lerp(new THREE.Color('#e8e8e8'), 0.40);
    const geo = parts.length === 1 ? parts[0] : mergeSimple(parts);
    const mat = new THREE.MeshStandardMaterial({
      color: baseCol.clone().multiplyScalar(isRural ? 1.05 : 0.95),
      emissive: baseCol.clone().multiplyScalar(isRural ? 0.22 : 0.12),
      emissiveIntensity: 0.9,
      roughness: isRural ? 0.7 : 0.78,
      metalness: 0.26,
      transparent: true,
      /* v=41: 不透明度 0.16→0.34 / 0.34→0.52 —— 之前淡到开关图层几乎看不出区别,
         现在开启时有清晰的分区分色效果; 饱和度也回调一档让各区颜色更好认。 */
      opacity: isRural ? 0.52 : 0.34,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = {
      type: 'district', name: d.name, adcode: d.adcode,
      area: d.area, color: d.color, center: d.c,
    };
    group.add(mesh);
    meshes.push(mesh);

    // 顶面轮廓发光边
    const edgeMat = new THREE.LineBasicMaterial({
      color: baseCol.clone().lerp(new THREE.Color('#ffffff'), 0.55),
      transparent: true, opacity: 0.80,   // v=41: 0.42 -> 0.80, 分区边界更清晰
    });
    for (const poly of d.polys) {
      if (poly.hole) continue;
      const pts = [];
      const f = poly.p;
      for (let i = 0; i < f.length; i += 2) pts.push(new THREE.Vector3(f[i], Y.districtTop + 0.004, f[i + 1]));
      if (pts.length > 2) {
        pts.push(pts[0].clone());
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lg, edgeMat);
        line.userData.pick = mesh.userData;   // 轮廓线同样可拾取
        group.add(line);
        meshes.push(line);
      }
    }
  }

  return {
    group,
    meshes,
    /** 悬停高亮: 半透明覆盖层靠不透明度区分 */
    highlight(mesh) {
      for (const m of meshes) {
        if (!m.material) continue;
        const isLine = m.type === 'Line';
        const on = (m === mesh);
        if (m.material.transparent) {
          m.material.opacity = isLine ? (on ? 0.95 : 0.80) : (on ? 0.55 : 0.34);
        } else if (m.material.emissive) {
          m.material.emissiveIntensity = on ? 2.4 : 1.0;
        }
      }
    },
    clearHighlight() {
      for (const m of meshes) {
        if (!m.material) continue;
        const isLine = m.type === 'Line';
        if (m.material.transparent) m.material.opacity = isLine ? 0.80 : 0.34;
        else if (m.material.emissive) m.material.emissiveIntensity = 0.9;
      }
    },
  };
}

/**
 * 行政区名称标签: 每个区一张画布文字广告牌 (Sprite, 恒朝相机),
 * 相机拉近时淡入, 让"区域划分"在放大时更清晰。
 */
let _dcLast = -1, _dcSettled = false;   // v=51: 收敛门控

export function makeDistrictLabels(data) {
  const group = new THREE.Group();
  group.name = 'districtLabels';
  const sprites = [];

  for (const d of data.districts) {
    // 质心
    let sx = 0, sz = 0, n = 0;
    for (const poly of d.polys) {
      if (poly.hole) continue;
      for (let i = 0; i < poly.p.length; i += 2) { sx += poly.p[i]; sz += poly.p[i + 1]; n++; }
    }
    const cx = n ? sx / n : 0, cz = n ? sz / n : 0;

    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 72;
    const g = cv.getContext('2d');
    g.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(4,10,20,.85)';
    g.strokeText(d.name, 128, 38);
    g.fillStyle = '#e9f3ff';
    g.fillText(d.name, 128, 38);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    spr.scale.set(3.0, 0.84, 1);
    spr.position.set(cx, Y.districtTop + 0.55, cz);
    spr.renderOrder = 20;
    spr.material.opacity = 0;
    group.add(spr);
    sprites.push(spr);
  }

  return {
    group,
    /** camDist: 相机到原点距离; 拉到太近(<2.5km)隐藏, 防止遮挡 */
    update(camDist) {
      /* v=51 性能: 相机距离没变且淡入/缩放已收敛时直接跳过 */
      if (Math.abs(camDist - _dcLast) < 1e-4 && _dcSettled) return;
      _dcLast = camDist;
      const show = camDist > 2.4 && camDist < 46;
      const target = show ? 1 : 0;
      // 拉到附近时缩到 0.25x, 远处还原 1.0x (在 2.4~8 区间线性)
      const scl = camDist < 8 ? 0.25 + 0.75 * Math.max(0, Math.min(1, (camDist - 2.4) / 5.6)) : 1;
      let maxDelta = 0;
      for (const s of sprites) {
        const dO = (target - s.material.opacity) * 0.12;
        s.material.opacity += dO;
        s.visible = s.material.opacity > 0.02;
        const baseX = 3.0 * scl, baseY = 0.84 * scl;
        const dX = (baseX - s.scale.x) * 0.18, dY = (baseY - s.scale.y) * 0.18;
        s.scale.x += dX;
        s.scale.y += dY;
        const d = Math.abs(dO) + Math.abs(dX) + Math.abs(dY);
        if (d > maxDelta) maxDelta = d;
      }
      _dcSettled = maxDelta < 0.002;
    },
  };
}

/** 合并同材质的多边形几何 (带洞的区需要多个 shape) */
function mergeSimple(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, vo * 3);
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
