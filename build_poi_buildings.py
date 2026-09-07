#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_poi_buildings.py — 为网红景点匹配最近的 OSM 建筑轮廓
==========================================================
让 1687 个网红景点不再只是"大头针", 而是拥有真实的建模形状。

做法:
  1. 读 data/attractions.json  -> {pois:[{name,x,z,kind,stars,lon,lat,...}]}
  2. 读 data/buildings.json    -> {b:[{p:[x,z,x,z,...], h:高度}]}
  3. 每栋建筑算质心 (cx,cz), 建 0.25 单位的均匀网格索引加速查询
  4. 每个 POI 在半径 0.08 (80 米) 内找最近建筑质心:
       命中 -> 直接用该建筑的轮廓 p 与高度 h
       未命中 -> 生成一个正八边形 footprint 兜底
  5. 写 data/poi_buildings.json -> {pois:[{name,kind,x,z,color,h,p:[x,z,...]}]}

坐标约定: 场景单位, 1 单位 = 1 公里, 即 1 米 = 0.001 单位
"""

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
ATTR = os.path.join(DATA, 'attractions.json')
BLDG = os.path.join(DATA, 'buildings.json')
OUT = os.path.join(DATA, 'poi_buildings.json')

# ---------------------------------------------------------------- 常量
# 与 src/attractions.js 里的 KIND_COLOR 保持一致 (颜色在预生成阶段就烘进 JSON)
KIND_COLOR = {
    'attraction': '#4fd6ff', 'museum': '#ffb703', 'artwork': '#c77dff',
    'gallery': '#c77dff', 'viewpoint': '#5ef2a0', 'theme_park': '#ff6b6b',
    'zoo': '#ffb703', 'nature_reserve': '#5ef2a0', 'park': '#5ef2a0',
    'monument': '#ffd166', 'memorial': '#ffd166', 'landmark': '#ff8ec7',
    'apartments': '#e8d5a8', 'building': '#e8d5a8', 'statue': '#c77dff',
    'palace': '#ffd166', 'place_of_worship': '#ffe08a', 'theatre': '#ff8ec7',
    'cinema': '#ff8ec7', 'arts_centre': '#c77dff', 'archaeological_site': '#ffd166',
    'historic': '#ffd166', 'ruins': '#ffd166', 'castle': '#ffd166',
    'communications_tower': '#ff6b6b', 'tower': '#ff8ec7', 'hotel': '#9fd8ff',
    'resort': '#9fd8ff', 'water_park': '#4fd6ff', 'garden': '#5ef2a0',
    'observatory': '#ffb703', 'sports_centre': '#5ef2a0',
}
DEFAULT_COLOR = '#4fd6ff'

CELL = 0.25          # 网格边长 (场景单位 = 250 米), 规格要求 0.2~0.5
RADIUS = 0.08        # 搜索半径 = 80 米
NDIG = 5             # 坐标保留小数位 (0.00001 单位 = 1 厘米)
MIN_PTS = 3          # 少于 3 个点的环无法挤出, 视为无效


# ---------------------------------------------------------------- 工具
def clean_ring(flat):
    """去掉首尾重复的闭合点 + 相邻重复点, 返回新的扁平数组; 无效返回 None"""
    if not flat or len(flat) < 2 * MIN_PTS:
        return None
    pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat) - 1, 2)]
    # 首尾闭合点
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-12 and abs(pts[0][1] - pts[-1][1]) < 1e-12:
        pts.pop()
    # 相邻重复点
    out = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - out[-1][0]) > 1e-12 or abs(p[1] - out[-1][1]) > 1e-12:
            out.append(p)
    if len(out) < MIN_PTS:
        return None
    res = []
    for x, z in out:
        res.append(round(x, NDIG))
        res.append(round(z, NDIG))
    return res


def centroid(flat):
    """环的质心 (顶点算术平均)"""
    n = len(flat) // 2
    sx = sz = 0.0
    for i in range(n):
        sx += flat[2 * i]
        sz += flat[2 * i + 1]
    return sx / n, sz / n


def octagon(x, z, stars):
    """兜底用正八边形 footprint, 逆时针, 首尾不重复"""
    r = (25 + stars * 5) / 1000.0            # 半径 25+stars*5 米 -> 场景单位
    pts = []
    for i in range(8):                        # 逆时针, 旋转 22.5° 让边正对观察方向
        a = math.pi / 8.0 + i * math.pi / 4.0
        pts.append(round(x + r * math.cos(a), NDIG))
        pts.append(round(z + r * math.sin(a), NDIG))
    return pts


def fallback_height(stars):
    """兜底高度: 0.008 + stars*0.004 场景单位 (约 12~28 米)"""
    return round(0.008 + stars * 0.004, NDIG)


def build_index(cents, cell):
    """均匀网格索引: (ix,iz) -> [建筑下标]"""
    grid = {}
    for i, (cx, cz) in enumerate(cents):
        k = (int(math.floor(cx / cell)), int(math.floor(cz / cell)))
        grid.setdefault(k, []).append(i)
    return grid


def nearest(grid, cents, cell, radius, x, z):
    """在 radius 内找最近质心, 返回 (下标, 距离) 或 None"""
    r = int(math.ceil(radius / cell))
    ix = int(math.floor(x / cell))
    iz = int(math.floor(z / cell))
    best = -1
    bd = radius * radius
    for dx in range(-r, r + 1):
        for dz in range(-r, r + 1):
            arr = grid.get((ix + dx, iz + dz))
            if not arr:
                continue
            for i in arr:
                cx, cz = cents[i]
                d = (cx - x) ** 2 + (cz - z) ** 2
                if d < bd:
                    bd = d
                    best = i
    return (best, math.sqrt(bd)) if best >= 0 else None


# ---------------------------------------------------------------- 主流程
def main():
    pois = json.load(open(ATTR, encoding='utf-8'))['pois']
    blist = json.load(open(BLDG, encoding='utf-8'))['b']

    # --- 建筑质心 + 网格索引 ---
    cents = []
    rings = []          # 清洗后的轮廓, 与 cents 同序
    heights = []
    skipped = 0
    for b in blist:
        ring = clean_ring(b.get('p') or [])
        if ring is None:
            skipped += 1
            continue
        cx, cz = centroid(ring)
        cents.append((cx, cz))
        rings.append(ring)
        heights.append(float(b.get('h') or 0.0))
    grid = build_index(cents, CELL)

    out = []
    hit = 0
    miss = 0
    for p in pois:
        stars = int(max(0, min(5, p.get('stars') or 1)))
        kind = p.get('kind') or 'attraction'
        x = float(p.get('x'))
        z = float(p.get('z'))
        res = nearest(grid, cents, CELL, RADIUS, x, z)
        if res is not None:
            idx, _d = res
            poly = rings[idx]
            h = heights[idx]
            if h > 0 and len(poly) >= 2 * MIN_PTS:
                hit += 1
            else:                              # 高度缺失 -> 退回兜底
                poly = octagon(x, z, stars)
                h = fallback_height(stars)
                miss += 1
        else:
            poly = octagon(x, z, stars)
            h = fallback_height(stars)
            miss += 1
        out.append({
            'name': p.get('name') or '',
            'kind': kind,
            'x': round(x, NDIG),
            'z': round(z, NDIG),
            'color': KIND_COLOR.get(kind, DEFAULT_COLOR),
            'h': round(h, NDIG),
            'p': poly,
        })

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'pois': out}, f, ensure_ascii=False, separators=(',', ':'))

    size = os.path.getsize(OUT)
    print('=' * 52)
    print('  poi_buildings.json 生成完成')
    print('=' * 52)
    print('  参与索引的建筑 : %d 栋 (无效轮廓跳过 %d)' % (len(cents), skipped))
    print('  命中真实建筑   : %d 个' % hit)
    print('  兜底八边形     : %d 个' % miss)
    print('  总计           : %d 个' % len(out))
    print('  命中率         : %.1f%%' % (100.0 * hit / max(1, len(out))))
    print('  文件大小       : %.1f KB (%d 字节)' % (size / 1024.0, size))
    print('  输出           : %s' % OUT)
    return hit, miss, len(out), size


if __name__ == '__main__':
    main()
