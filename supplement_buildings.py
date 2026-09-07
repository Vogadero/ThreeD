# -*- coding: utf-8 -*-
"""
补足全市建筑体块。

背景 / 已修的两个 bug:
  1) 中心 7 区原本被整体 SKIP, 而内源 data/buildings.json 实际只覆盖了黄浦/虹口/静安/杨浦的一小部分,
     长宁、徐汇、普陀 **一栋都没有** —— 这三区既拿不到内源、又被中心排除框挡住外源, 于是完全空白。
     现在改为: 所有区都参与生成, 但生成时会用内源建筑做碰撞检测, 只填"空白处"。
  2) 旧的 dist_factor = max(0.35, 1 - d/0.7), 分母 0.7 单位其实是 km, 导致**任何离市中心超过 0.7km
     的区都被压到下限 0.35**, 外区楼因此普遍只有 10~26m, 明显比中心矮小。
     现在改为按"每个楼位点"到市中心的真实距离 km 衰减: max(0.60, 1 - d/90)。

生成结果统一打标记 'f':1 (fill), 供 main.js 的 mergeBuildings 放行到中心排除框内部。
输出: data/buildings_outer.json
"""
import json, math, os, random

LON0, LAT0 = 121.4737, 31.2304
M_LAT = 110957
VM = 0.0016                 # 1 米 -> 场景单位 (垂直方向)

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "buildings_outer.json")
INNER = os.path.join(DATA, "buildings.json")

GEN_TAG = "程序生成"        # 程序生成的建筑名标记, 用于 REPLACE 时保留真实 OSM 数据


def r4(v):
    return round(v, 4)


# (每 km² 栋数, 平均层高 m, 最高 m, 楼栋宽度范围 m, 网格步长 km)
# 说明: 外区以高层住宅塔楼为主, 因此高度给足(平均 42~70m), 不再被旧的 0.35 系数压矮。
DENSITY = {
    # ---- 中心城区(补空白, 内源稀疏或为零) ----
    '黄浦区': {'d': 95, 'mh': 32, 'mx': 95, 'w': (13, 38), 'step': 0.030},  # 人民广场/黄浦公园 等公园绿地的补白
    '长宁区': {'d': 95, 'mh': 38, 'mx': 110, 'w': (15, 42), 'step': 0.030},
    '徐汇区': {'d': 90, 'mh': 38, 'mx': 115, 'w': (15, 42), 'step': 0.030},
    '普陀区': {'d': 88, 'mh': 36, 'mx': 105, 'w': (15, 42), 'step': 0.030},
    '静安区': {'d': 90, 'mh': 40, 'mx': 125, 'w': (15, 44), 'step': 0.030},
    '虹口区': {'d': 85, 'mh': 38, 'mx': 115, 'w': (15, 42), 'step': 0.030},
    '杨浦区': {'d': 88, 'mh': 36, 'mx': 105, 'w': (15, 42), 'step': 0.030},
    # ---- 外环 / 郊区 ----
    '浦东新区': {'d': 62, 'mh': 70, 'mx': 150, 'w': (20, 60), 'step': 0.032},
    '闵行区':   {'d': 55, 'mh': 52, 'mx': 120, 'w': (18, 50), 'step': 0.032},
    '宝山区':   {'d': 53, 'mh': 50, 'mx': 115, 'w': (18, 50), 'step': 0.032},
    '嘉定区':   {'d': 45, 'mh': 42, 'mx': 95,  'w': (16, 45), 'step': 0.032},
    '松江区':   {'d': 45, 'mh': 42, 'mx': 100, 'w': (16, 45), 'step': 0.032},
    '青浦区':   {'d': 30, 'mh': 34, 'mx': 80,  'w': (15, 40), 'step': 0.032},
    '奉贤区':   {'d': 38, 'mh': 34, 'mx': 80,  'w': (15, 42), 'step': 0.032},
    '金山区':   {'d': 26, 'mh': 30, 'mx': 65,  'w': (14, 36), 'step': 0.032},
    '崇明区':   {'d': 16, 'mh': 24, 'mx': 55,  'w': (12, 32), 'step': 0.032},
}
# 全部区都参与生成 (用于填充公园/广场等真实数据稀疏处)。
# 内源 + 已存在的真实 OSM outer 楼都纳入碰撞检测, 不会叠楼。
SKIP = set()


def in_polygon(x, z, poly):
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def poly_spans(poly, z):
    """水平线 z 与多边形各边的交点 x 列表(升序)。用于扫描线快速填充。"""
    xs = []
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xs.append(x1 + (z - z1) / (z2 - z1) * (x2 - x1))
    xs.sort()
    return xs


def build_inner_index():
    """把内源 + 已存在的真实 OSM 楼 footprint 的 AABB 打到 50m 网格, 供新建筑做碰撞检测。"""
    ib = []
    if os.path.exists(INNER):
        try:
            ib += json.load(open(INNER, encoding="utf-8")).get("b", [])
        except Exception:
            pass
    # 也把已存在的真实 OSM outer 楼纳入碰撞, 避免程序补白与真实数据叠楼
    if os.path.exists(OUT):
        try:
            for b in json.load(open(OUT, encoding="utf-8")).get("b", []):
                if GEN_TAG not in (b.get("n") or ""):
                    ib.append(b)
        except Exception:
            pass
    if not ib:
        return {}, None
    CELL = 0.05
    grid = {}
    minx = minz = 1e9
    maxx = maxz = -1e9
    for b in ib:
        p = b.get("p") or []
        if len(p) < 6:
            continue
        xs = p[0::2]
        zs = p[1::2]
        x0, x1 = min(xs), max(xs)
        z0, z1 = min(zs), max(zs)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        rx, rz = (x1 - x0) / 2, (z1 - z0) / 2
        grid.setdefault((int(cx // CELL), int(cz // CELL)), []).append((cx, cz, rx, rz))
        if x0 < minx: minx = x0
        if x1 > maxx: maxx = x1
        if z0 < minz: minz = z0
        if z1 > maxz: maxz = z1
    if minx > maxx:
        return {}, None
    return grid, (minx - 0.02, minz - 0.02, maxx + 0.02, maxz + 0.02)


def main():
    d = json.load(open(os.path.join(DATA, "districts.json"), encoding="utf-8"))

    # 保留真实 OSM 建筑; REPLACE 时清掉旧的"程序生成"楼, 重新按新参数生成
    kept_real = []
    if os.path.exists(OUT):
        try:
            ex = json.load(open(OUT, encoding="utf-8")).get("b", [])
            if os.environ.get("REPLACE"):
                kept_real = [b for b in ex if GEN_TAG not in (b.get("n") or "")]
                print(f"REPLACE: 保留真实 OSM 建筑 {len(kept_real)} 栋, 重新生成程序楼")
            else:
                kept_real = list(ex)
                print(f"追加模式: 已有 {len(kept_real)} 栋")
        except Exception as e:
            print("读取已有文件失败:", e)

    inner_grid, inner_bbox = build_inner_index()
    CELL = 0.05
    MARGIN = 0.004           # 与内源建筑至少留 4m 间隙

    def collides(x, z, hw, hd):
        if not inner_grid:
            return False
        if inner_bbox:
            x0, z0, x1, z1 = inner_bbox
            if x < x0 or x > x1 or z < z0 or z > z1:
                return False
        ci, cj = int(x // CELL), int(z // CELL)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for (cx, cz, rx, rz) in inner_grid.get((ci + di, cj + dj), ()):
                    if abs(x - cx) < (hw + rx + MARGIN) and abs(z - cz) < (hd + rz + MARGIN):
                        return True
        return False

    rng = random.Random(20260831)
    new_buildings = list(kept_real)
    total_added = 0

    for dist in d.get("districts", []):
        name = dist.get("name", "")
        if name in SKIP:
            continue
        cfg = DENSITY.get(name)
        if not cfg:
            continue

        outer, holes = None, []
        max_area = 0
        for pr in dist.get("polys", []):
            p = pr.get("p", [])
            if len(p) < 6:
                continue
            poly = [(p[i], p[i + 1]) for i in range(0, len(p), 2)]
            area = abs(sum(
                poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                for i in range(len(poly))) / 2)
            if pr.get("hole"):
                holes.append(poly)
            elif area > max_area:
                max_area = area
                outer = poly
        if not outer:
            continue

        xs = [p[0] for p in outer]
        zs = [p[1] for p in outer]
        bx0, bx1 = min(xs), max(xs)
        bz0, bz1 = min(zs), max(zs)
        step = cfg.get("step", 0.032)

        # 每个网格点被选中的概率: 目标密度(栋/km²) × 单格面积(km²)
        prob = min(1.0, max(0.02, cfg["d"] * step * step))
        print(f"  {name}: 面积 {max_area:.1f} km²  步长 {step}  prob={prob:.3f}  "
              f"目标 ~{int(cfg['d'] * max_area)} 栋")

        placed = 0
        row = bz0 + step * 0.5
        while row < bz1:
            spans = poly_spans(outer, row)
            for k in range(0, len(spans) - 1, 2):
                xa, xb = spans[k], spans[k + 1]
                gx = math.ceil(xa / step) * step
                while gx < xb:
                    gx += step
                    if rng.random() > prob:
                        continue
                    x = gx + rng.uniform(-step * 0.32, step * 0.32)
                    z = row + rng.uniform(-step * 0.32, step * 0.32)
                    if x < bx0 or x > bx1:
                        continue
                    in_hole = False
                    for h in holes:
                        if in_polygon(x, z, h):
                            in_hole = True
                            break
                    if in_hole:
                        continue

                    w = rng.uniform(*cfg["w"])
                    dp = rng.uniform(*cfg["w"])
                    if abs(w - dp) < 2:
                        dp += rng.choice([-3, 3])

                    # 高度: 按"该点到市中心的距离(km)"衰减, 下限 0.60
                    dist_km = math.hypot(x, z)
                    df = max(0.60, 1.0 - dist_km / 90.0)
                    h_m = max(4, min(cfg["mx"] * df, cfg["mh"] * df * rng.uniform(0.6, 1.6)))

                    hw, hd = w / 2000.0, dp / 2000.0     # 米 -> 场景单位, 取半径
                    if collides(x, z, hw, hd):
                        continue

                    rot = rng.choice([0, 0, 0, 90, 90])
                    c_, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
                    corners = [
                        (x - hw * c_ + hd * s_, z - hw * s_ - hd * c_),
                        (x + hw * c_ + hd * s_, z + hw * s_ - hd * c_),
                        (x + hw * c_ - hd * s_, z + hw * s_ + hd * c_),
                        (x - hw * c_ - hd * s_, z - hw * s_ + hd * c_),
                    ]
                    p = []
                    for cc in corners:
                        p.append(r4(cc[0]))
                        p.append(r4(cc[1]))
                    new_buildings.append({
                        "p": p,
                        "h": r4(h_m * VM),
                        "n": f"{name}-{GEN_TAG}",
                        "f": 1,                 # fill 标记: 允许进入中心排除框
                    })
                    placed += 1
            row += step

        total_added += placed
        print(f"    -> 实际放置 {placed} 栋")

    out = {"b": new_buildings}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n总计: 新增 {total_added} 栋, 合计 {len(new_buildings)} 栋 -> {OUT}")


if __name__ == "__main__":
    main()
