# -*- coding: utf-8 -*-
"""
数据编译:  _raw/*.json  ->  data/*.json

1. WGS84 经纬度投影为场景平面坐标 (1 场景单位 = 1 公里)
2. 过滤跨省脏数据 / 去重 / 抽稀 / 定点压缩
3. 景点推荐指数: 全部由真实可计算指标加权得出, 不掺主观臆造分
"""
import json, os, math, collections, re, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "_raw")
OUT = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

# ---------------- 投影 ----------------
LON0, LAT0 = 121.4737, 31.2304          # 人民广场
M_LON = 111320 * math.cos(math.radians(LAT0))
M_LAT = 110957
SCENE = 1.0 / 1000.0                     # 1 场景单位 = 1 公里

# 上海市域外接矩形, 用于过滤跨省脏数据
SH = (120.85, 30.67, 122.05, 31.90)


def in_sh(lon, lat):
    return SH[0] <= lon <= SH[2] and SH[1] <= lat <= SH[3]


def proj(lon, lat):
    """经纬度 -> 场景 (x, z).  three.js 中 -z 为北"""
    return ((lon - LON0) * M_LON * SCENE, -(lat - LAT0) * M_LAT * SCENE)


def r4(v):
    return round(v, 4)


def hsl_hex(h, s, l):
    """HSL -> #RRGGBB  (h:0-360, s/l:0-100)"""
    hh = (h % 360) / 360.0
    ss, ll = s / 100.0, l / 100.0

    def f(n):
        k = (n + hh * 12) % 12
        a = ss * min(ll, 1 - ll)
        return ll - a * max(-1, min(k - 3, min(9 - k, 1)))
    return "#%02X%02X%02X" % (round(f(0) * 255), round(f(8) * 255), round(f(4) * 255))


def poly_area(pts):
    """经纬度多边形面积 -> 平方公里 (鞋带公式 + 局部平面近似)"""
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0 * M_LON * M_LAT / 1e6


def pline_len(line):
    """场景折线长度 (单位 km)"""
    return sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
               for i in range(len(line) - 1))


def nearest_t(path, p):
    """点到折线的沿程距离, 用于把站点按线路走向排序"""
    best, bestt, acc = 1e18, 0.0, 0.0
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        dx, dz = b[0] - a[0], b[1] - a[1]
        seg2 = dx * dx + dz * dz
        t = 0.0 if seg2 < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / seg2))
        px, pz = a[0] + t * dx, a[1] + t * dz
        d = (p[0] - px) ** 2 + (p[1] - pz) ** 2
        if d < best:
            best, bestt = d, acc + t * math.sqrt(seg2)
        acc += math.sqrt(seg2)
    return bestt


def natural_key(s):
    """线路编号自然排序: 1,2,...,10,磁浮"""
    m = re.match(r"^(\d+)", str(s))
    return (0, int(m.group(1))) if m else (1, str(s))


def load(name):
    p = os.path.join(RAW, name + ".json")
    if not os.path.exists(p):
        print("  [缺失] %s" % name)
        return {"elements": []}
    return json.load(open(p, encoding="utf-8"))


def dump(name, obj):
    p = os.path.join(OUT, name + ".json")
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    open(p, "w", encoding="utf-8").write(s)
    print("  [输出] %-18s %8.1f KB" % (name + ".json", len(s.encode("utf-8")) / 1024))
    return len(s.encode("utf-8"))


def geom_of(e):
    """取元素几何点串 [(lon,lat)...], 兼容 geometry / center / 自身坐标"""
    if e.get("type") == "node" and "lat" in e:
        return [(e["lon"], e["lat"])]
    if "geometry" in e:
        return [(g["lon"], g["lat"]) for g in e["geometry"] if g and "lon" in g]
    if "center" in e:
        return [(e["center"]["lon"], e["center"]["lat"])]
    return []


def simplify(pts, tol_deg):
    """垂距抽稀 (保留形状特征)"""
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        q = out[-1]
        if abs(p[0] - q[0]) + abs(p[1] - q[1]) > tol_deg:
            out.append(p)
    out.append(pts[-1])
    return out


def stitch(segments, max_gap=1.2):
    """把乱序线段贪心拼接成连续折线 (单位: 场景单位/公里)"""
    segs = [list(s) for s in segments if len(s) >= 2]
    if not segs:
        return []
    segs.sort(key=len, reverse=True)
    cur = segs.pop(0)
    while segs:
        best_i, best_rev, best_d = -1, False, 1e9
        for i, s in enumerate(segs):
            for rev in (False, True):
                c = s[::-1] if rev else s
                for anchor in (cur[-1], cur[0]):
                    d = (c[0][0] - anchor[0]) ** 2 + (c[0][1] - anchor[1]) ** 2
                    if d < best_d:
                        best_d, best_i, best_rev = d, i, rev
        if best_i < 0 or best_d > max_gap ** 2:
            break
        s = segs.pop(best_i)
        if best_rev:
            s = s[::-1]
        cur.extend(s[1:])
    return cur


print("=" * 66)
print("编译上海真实地理数据")
print("=" * 66)

# =========================================================
# 1. 行政区
# =========================================================
print("\n[1/8] 行政区边界")

# 按"距市中心远近"分配色相: 中心暖色, 外围冷色, 保证 16 区彼此可辨
DIST_ORDER = None
bnd = load("boundary")
feats = bnd["features"]
centers = {}
for f in feats:
    c = f["properties"].get("center") or [0, 0]
    centers[f["properties"]["name"]] = (c[0], c[1])

names_sorted = sorted(centers.keys(), key=lambda n:
                      (centers[n][0] - LON0) ** 2 + (centers[n][1] - LAT0) ** 2)

districts = []
for idx, nm in enumerate(names_sorted):
    f = next(x for x in feats if x["properties"]["name"] == nm)
    p = f["properties"]
    # 色相: 从暖(0/红) 过渡到 冷(220/蓝)
    t = idx / max(1, len(names_sorted) - 1)
    hue = int(8 + t * 232)          # 8°(红) -> 240°(蓝)
    sat = 62 + (1 - t) * 16
    lit = 52 + (1 - t) * 6
    col = hsl_hex(hue, sat, lit)

    polys = []
    geom = f["geometry"]
    rings = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    area_sum = 0.0
    for poly in rings:
        for ri, ring in enumerate(poly):
            pts = [(c[0], c[1]) for c in ring]
            if not pts or not all(in_sh(a, b) for a, b in pts):
                continue
            sp = simplify(pts, 0.00035)
            if len(sp) < 4:
                continue
            area_sum += poly_area(sp) * (1 if ri == 0 else -1)
            polys.append({
                "hole": ri > 0,
                "p": [r4(v) for pt in sp for v in proj(pt[0], pt[1])]
            })
    cx, cz = proj(*centers[nm])
    districts.append({
        "name": nm,
        "adcode": str(p["adcode"]),
        "color": col,
        "c": [r4(cx), r4(cz)],
        "area": round(abs(area_sum), 1),   # km²
        "polys": polys,
    })

dump("districts", {"districts": districts})

# =========================================================
# 2. 水系
# =========================================================
print("\n[2/8] 水系 (黄浦江 / 苏州河 / 主要河道)")

# 真实河道宽度 (米), 依据上海市河道规划蓝线公开资料
RIVER_WIDTH = {
    "黄浦江": 480, "苏州河": 58, "吴淞江": 58, "蕰藻浜": 75,
    "淀浦河": 48, "川杨河": 55, "大治河": 90, "金汇港": 80,
    "张家浜": 35, "白莲泾": 32, "杨树浦港": 26, "虹口港": 22,
    "龙华港": 30, "新泾港": 30, "蒲汇塘": 24, "桃浦河": 26,
    "彭越浦": 24, "俞泾浦": 22, "油墩港": 60, "漕河泾": 22,
}
DEFAULT_W = 26

riv = load("water_rivers")
byname = collections.defaultdict(list)
for e in riv["elements"]:
    nm = e.get("tags", {}).get("name")
    if not nm:
        continue
    g = geom_of(e)
    if len(g) >= 2 and all(in_sh(a, b) for a, b in g):
        byname[nm].append([proj(a, b) for a, b in g])

rivers = []
for nm, segs in byname.items():
    flat = []
    for s in segs:
        flat.extend(s)
    # 拼接成连续中心线
    line = stitch(segs) if len(segs) <= 400 else flat
    if len(line) < 2:
        line = flat
    if len(line) < 2:
        continue
    line = [(r4(x), r4(z)) for x, z in line]
    w = RIVER_WIDTH.get(nm, DEFAULT_W)
    rivers.append({
        "name": nm,
        "w": w,
        "len": round(pline_len(line), 2),
        "line": [v for pt in line for v in pt],   # 扁平 [x,z,x,z...]
    })

rivers.sort(key=lambda r: -r["w"])

# 水面多边形 (natural=water)
surf = load("water_surface")
lakes = []
for e in surf["elements"] + load("water_lakes")["elements"]:
    t = e.get("tags", {})
    nm = t.get("name") or t.get("name:zh") or "水体"
    g = geom_of(e)
    if len(g) < 4:
        continue
    if not all(in_sh(a, b) for a, b in g):
        continue
    sp = simplify(g, 0.0002)
    if len(sp) < 4:
        continue
    lakes.append({
        "name": nm,
        "kind": t.get("water", t.get("natural", "water")),
        "p": [r4(v) for pt in sp for v in proj(pt[0], pt[1])],
    })

dump("water", {"rivers": rivers, "lakes": lakes})
print("     河道 %d 条, 水面 %d 个" % (len(rivers), len(lakes)))
for r in rivers[:6]:
    print("       %-8s 宽%4dm  长%7.2fkm  %d点" % (r["name"], r["w"], r["len"], len(r["line"]) // 2))

# =========================================================
# 3. 地铁
# =========================================================
print("\n[3/8] 地铁线路与站点")

metro_raw = load("metro")
nodes_xy, node_name = {}, {}
for e in metro_raw["elements"]:
    if e["type"] == "node" and "lat" in e and in_sh(e["lon"], e["lat"]):
        nodes_xy[e["id"]] = proj(e["lon"], e["lat"])
        tg = e.get("tags") or {}
        nm = tg.get("name") or tg.get("name:zh")
        if nm:
            node_name[e["id"]] = nm
ways_pts = {}
for e in metro_raw["elements"]:
    if e["type"] == "way":
        pts = [nodes_xy[n] for n in e.get("nodes", []) if n in nodes_xy]
        if len(pts) >= 2:
            ways_pts[e["id"]] = pts

# 站点名称: 优先用线路关系内的节点标签, 再用独立站点表补全
st_info = dict(node_name)
for e in load("metro_stations")["elements"]:
    if not in_sh(e.get("lon", 0), e.get("lat", 0)):
        continue
    t = e.get("tags", {})
    nm = t.get("name") or t.get("name:zh")
    if nm:
        st_info[e["id"]] = nm

rels = [e for e in metro_raw["elements"] if e["type"] == "relation"]
groups = collections.defaultdict(list)
for r in rels:
    t = r.get("tags", {})
    ref = t.get("ref") or t.get("name", "?")
    groups[ref].append(r)

metro_lines = []
station_lines = collections.defaultdict(set)
station_meta = {}

for ref, rs in groups.items():
    # 双向/支线合并: 取成员最多的作为主干, 其余的站点并入
    rs.sort(key=lambda r: -len(r.get("members", [])))
    main = rs[0]
    t = main.get("tags", {})
    nm = t.get("name") or ("%s号线" % ref)
    # 去掉 "：xx -> yy" 方向后缀
    nm = re.split(r"[：:]", nm)[0].strip() or ("%s号线" % ref)

    stop_ids, way_ids = [], []
    for r in rs:
        for m in r.get("members", []):
            if m["type"] == "node" and "stop" in (m.get("role") or ""):
                if m["ref"] not in stop_ids:
                    stop_ids.append(m["ref"])
            elif m["type"] == "way" and not m.get("role"):
                if m["ref"] not in way_ids:
                    way_ids.append(m["ref"])

    path = stitch([ways_pts[w] for w in way_ids if w in ways_pts])
    if len(path) < 2:
        continue

    # 站点按沿线位置排序
    sts = []
    for sid in stop_ids:
        if sid not in nodes_xy:
            continue
        x, z = nodes_xy[sid]
        sts.append({"id": sid, "name": st_info.get(sid, "未命名"), "x": r4(x), "z": r4(z)})
    if sts:
        sts.sort(key=lambda s: nearest_t(path, (s["x"], s["z"])))

    for s in sts:
        station_lines[s["id"]].add(ref)
        station_meta[s["id"]] = s

    metro_lines.append({
        "ref": ref,
        "name": nm,
        "color": (t.get("colour") or "#888888").upper(),
        "op": t.get("operator", t.get("network", "上海地铁")),
        "hours": t.get("opening_hours", ""),
        "n": len(sts),
        "path": [r4(v) for pt in path for v in pt],
        "stations": sts,
    })

metro_lines.sort(key=lambda l: natural_key(l["ref"]))

# 换乘站合并: 同名且相距 <600m 的站台节点归为一座车站
by_name = collections.defaultdict(list)
for sid, lines in station_lines.items():
    s = station_meta[sid]
    by_name[s["name"]].append(s)

stations = []
for nm, group in by_name.items():
    clusters = []
    for s in group:
        for c in clusters:
            if math.hypot(s["x"] - c[0]["x"], s["z"] - c[0]["z"]) < 0.6:
                c.append(s)
                break
        else:
            clusters.append([s])
    for c in clusters:
        ls = set()
        for s in c:
            ls |= station_lines[s["id"]]
        cx = sum(s["x"] for s in c) / len(c)
        cz = sum(s["z"] for s in c) / len(c)
        stations.append({
            "name": nm,
            "x": r4(cx), "z": r4(cz),
            "lines": sorted(ls, key=natural_key),
        })

stations.sort(key=lambda s: -len(s["lines"]))

dump("metro", {"lines": metro_lines, "stations": stations})
print("     线路 %d 条, 站点 %d 座" % (len(metro_lines), len(stations)))
for l in metro_lines[:8]:
    print("       %-10s %s  %2d站  路径%4d点" % (l["name"], l["color"], l["n"], len(l["path"]) // 2))

# =========================================================
# 4. 公交
# =========================================================
print("\n[4/8] 公交站点与线路")

stops_raw = load("bus_stops")
bus_stops, sid2i = [], {}
for e in stops_raw["elements"]:
    t = e.get("tags", {})
    if "lat" not in e or not in_sh(e["lon"], e["lat"]):
        continue
    nm = t.get("name") or t.get("name:zh")
    if not nm:
        continue
    x, z = proj(e["lon"], e["lat"])
    sid2i[e["id"]] = len(bus_stops)
    bus_stops.append({"id": e["id"], "name": nm, "x": r4(x), "z": r4(z)})

routes_raw = load("bus_routes")
bus_lines = []
for e in routes_raw["elements"]:
    t = e.get("tags", {})
    nm = t.get("name") or t.get("ref")
    if not nm:
        continue
    t.get("ref", "")
    members = e.get("members", [])
    node_ids = [m["ref"] for m in members if m["type"] == "node"]
    if len(node_ids) < 3:
        continue
    idx = [sid2i[n] for n in node_ids if n in sid2i]
    if len(idx) < 3:
        continue
    bus_lines.append({
        "name": nm,
        "ref": t.get("ref", ""),
        "op": t.get("operator", ""),
        "from": t.get("from", ""),
        "to": t.get("to", ""),
        "hours": t.get("opening_hours", ""),
        "n": len(idx),
        "s": idx,           # 站点索引序列
    })

# 站点 -> 线路索引
stop_routes = collections.defaultdict(list)
for li, bl in enumerate(bus_lines):
    for si in set(bl["s"]):
        stop_routes[si].append(li)

dump("bus", {
    "stops": [{"id": s["id"], "name": s["name"], "x": s["x"], "z": s["z"]} for s in bus_stops],
    "lines": bus_lines,
    "stopRoutes": {str(k): v for k, v in stop_routes.items()},
})
print("     站点 %d 个, 线路 %d 条" % (len(bus_stops), len(bus_lines)))

# =========================================================
# 5. 景点 + 推荐指数
# =========================================================
print("\n[5/8] 网红景点与推荐指数")

# ---- 噪音过滤 ----
NOISE_KW = ("号线", "派出所", "加油站", "停车场", "公共厕所", "变电站", "垃圾", "污水",
            "消防", "收费站", "出入口", "电梯", "楼梯", "天桥", "地道", "隧道",
            "路灯", "监控", "洗车", "维修", "仓库", "工地", "工地", "宿舍", "食堂",
            "有限公司", "股份有限公司", "分公司", "便利店", "快递", "物流", "房产",
            "售楼", "中介", "药房", "支行", "分理处", "营业厅", "ATM", "党群", "居委会",
            "街道", "社区居民", "村委会", "村民", "新村", "居民区", "住宅", "公寓",
            "派出所", "警务", "车队", "调度", "首末站", "公交", "地铁", "车站")
CROSS_RE = re.compile(r"^[\u4e00-\u9fa5]{1,6}路[\u4e00-\u9fa5]{1,6}路$")

# 上海真实网红地标核心词 (命中即认定为景点, 避免 OSM 标签缺失导致遗漏)
CORE_KW = (
    "东方明珠|上海中心大厦|上海环球金融中心|金茂大厦|外滩|南京路步行街|豫园|城隍庙|"
    "上海迪士尼|田子坊|新天地|武康大楼|武康路|思南公馆|静安寺|玉佛寺|龙华寺|龙华塔|"
    "上海博物馆|上海科技馆|上海自然博物馆|上海天文馆|中华艺术宫|浦东美术馆|西岸美术馆|"
    "油罐艺术中心|龙美术馆|M50|1933老场坊|四行仓库|一大会址|二大会址|鲁迅公园|多伦路|"
    "朱家角古镇|七宝古镇|新场古镇|枫泾古镇|召稼楼|广富林|佘山|辰山植物园|上海动物园|"
    "上海植物园|顾村公园|世纪公园|滴水湖|海昌海洋公园|欢乐谷|玛雅海滩|东方绿舟|"
    "泰晤士小镇|和平饭店|国际饭店|马勒别墅|上海图书馆|上海大剧院|大世界|外白渡桥|"
    "十六铺|老码头|前滩|世博|静安雕塑公园|邮政博物馆|铁路博物馆|海关大楼|"
    "上海环球港|兴业太古汇|国金中心|恒隆广场|新世界|第一百货|横沔|蟠龙"
)
CORE_RE = re.compile(CORE_KW.replace("\n", ""), re.I)

# 有这些标签说明确实是旅游/文化/休闲场所
SUBSTANTIAL = ("tourism", "historic", "leisure", "wikidata", "wikipedia",
               "man_made", "attraction", "heritage", "description", "website")
SUBST_AMENITY = ("place_of_worship", "theatre", "museum", "arts_centre",
                 "exhibition_centre", "casino", "cinema", "monastery")


def keep_poi(nm, t):
    """判断是否作为景点保留"""
    if any(k in nm for k in NOISE_KW):
        return False
    if re.match(CROSS_RE, nm):
        return False
    if t.get("shop") or t.get("office") or t.get("craft"):
        return False
    if CORE_RE.search(nm):
        return True
    if any(k in t for k in SUBSTANTIAL):
        return True
    if t.get("amenity") in SUBST_AMENITY:
        return True
    if t.get("landuse") == "recreation_ground" or t.get("tourism"):
        return True
    return False


# ---- 建筑高度索引 (真实的地标尺度指标) ----
HCELL = 0.15      # 150m 网格, 保证陆家嘴三件套等密集地标能各自取到真实高度
hgrid = collections.defaultdict(float)
for _src in ("buildings_core", "buildings_bund"):
    for e in load(_src)["elements"]:
        if e.get("type") != "way":
            continue
        g = geom_of(e)
        if len(g) < 4:
            continue
        t = e.get("tags", {})
        try:
            h = float(re.sub(r"[^\d.]", "", t.get("height", "")) or 0)
        except Exception:
            h = 0
        if not h:
            try:
                h = float(re.sub(r"[^\d.]", "", t.get("building:levels", "")) or 0) * 3.2
            except Exception:
                h = 0
        if not h:
            h = 14.0
        pts = [proj(a, b) for a, b in g if in_sh(a, b)]
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        k = (int(math.floor(cx / HCELL)), int(math.floor(cz / HCELL)))
        hgrid[k] = max(hgrid[k], h)


def peak_height(x, z):
    """景点周边 ±250m 内最高建筑 (米)"""
    cx, cz = int(math.floor(x / HCELL)), int(math.floor(z / HCELL))
    m = 0.0
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            m = max(m, hgrid.get((cx + dx, cz + dz), 0.0))
    return m


# ---- 地铁站名索引 (地铁以景点命名 = 城市地位的真实体现) ----
metro_idx = collections.defaultdict(list)
for s in stations:
    metro_idx[s["name"]].append((s["x"], s["z"]))
ALL_METRO = list(metro_idx.items())


BIG_SITE = ("theme_park", "water_park", "zoo", "nature_reserve", "themepark",
            "aquarium", "resort", "recreation_ground")


def metro_access(nm, x, z):
    """地铁直达性: 地铁站以景点命名最高, 否则按最近地铁站距离衰减 (单位 km)"""
    cand = list(metro_idx.get(nm) or [])
    named = False
    if not cand and len(nm) >= 3:
        cand = [pt for mname, lst in ALL_METRO
                if nm in mname or mname in nm for pt in lst]
        named = bool(cand)
    elif cand:
        named = True
    d = 1e9
    for mx, mz in cand:
        d = min(d, math.hypot(x - mx, z - mz))
    if not cand:                                  # 无同名站则取最近地铁站
        for s in stations:
            d = min(d, math.hypot(s["x"] - x, s["z"] - z))
    if named and d < 0.5:
        return 14
    if d <= 0.3:
        return 11
    if d <= 0.6:
        return 9
    if d <= 1.0:
        return 6
    if d <= 2.0:
        return 3
    return 0


pois = []
seen = set()
for src, meta_kind in [("attractions", "attraction"), ("landmarks", "landmark"),
                       ("theme_parks", "themepark"), ("viewpoints", "viewpoint")]:
    for e in load(src)["elements"]:
        t = e.get("tags", {})
        nm = t.get("name") or t.get("name:zh")
        if not nm:
            continue
        if not keep_poi(nm, t):
            continue
        g = geom_of(e)
        if not g:
            continue
        lon = sum(a for a, b in g) / len(g)      # 取质心, 避免取到边缘节点
        lat = sum(b for a, b in g) / len(g)
        if not in_sh(lon, lat):
            continue
        key = (nm, round(lon, 3), round(lat, 3))
        if key in seen:
            continue
        seen.add(key)
        x, z = proj(lon, lat)

        # 取一个具体的类别标签, 过滤掉 yes/no 这类无意义值
        def nice_kind():
            for k in ("tourism", "historic", "leisure", "attraction", "man_made"):
                v = t.get(k)
                if v and v not in ("yes", "no", "limited"):
                    return v
            return meta_kind

        pois.append({
            "name": nm, "x": r4(x), "z": r4(z), "lon": r4(lon), "lat": r4(lat),
            "kind": nice_kind(),
            "src": src,
            "en": t.get("name:en", ""),
            "wiki": (t.get("wikidata") or t.get("wikipedia") or ""),
            "web": t.get("website", ""),
            "fee": t.get("fee", ""),
            "hours": t.get("opening_hours", ""),
            "heritage": t.get("heritage", ""),
            "historic": t.get("historic", ""),
            "phone": t.get("phone", ""),
            "addr": t.get("addr:full") or t.get("addr:street") or "",
            "desc": t.get("description") or t.get("description:zh") or "",
            "tags": len(t),
            "id": e["id"],
        })

print("     合并去重后 POI: %d 个" % len(pois))

# ---- 空间索引 (网格), 用于真实计算交通便利度与周边热度 ----
CELL = 1.0  # 1 公里网格


def key_of(x, z):
    return (int(math.floor(x / CELL)), int(math.floor(z / CELL)))


metro_grid = collections.defaultdict(int)
for s in stations:
    metro_grid[key_of(s["x"], s["z"])] += 1
bus_grid = collections.defaultdict(int)
for s in bus_stops:
    bus_grid[key_of(s["x"], s["z"])] += 1
poi_grid = collections.defaultdict(int)
for p in pois:
    poi_grid[key_of(p["x"], p["z"])] += 1


def around(grid, x, z, rad_cells):
    cx, cz = int(math.floor(x / CELL)), int(math.floor(z / CELL))
    n = 0
    for dx in range(-rad_cells, rad_cells + 1):
        for dz in range(-rad_cells, rad_cells + 1):
            n += grid.get((cx + dx, cz + dz), 0)
    return n


def point_in_ring(x, z, flat):
    """射线法: 点是否落在多边形内 (flat = [x,z,x,z...])"""
    n = len(flat) // 2
    inside = False
    j = n - 1
    for i in range(n):
        xi, zi = flat[i * 2], flat[i * 2 + 1]
        xj, zj = flat[j * 2], flat[j * 2 + 1]
        if (zi > z) != (zj > z):
            if x < (xj - xi) * (z - zi) / ((zj - zi) or 1e-12) + xi:
                inside = not inside
        j = i
    return inside


# 行政区包围盒预筛 + 精确命中, 得到景点真实所属区
d_bbox = []
for d in districts:
    xs, zs = [], []
    for p in d["polys"]:
        xs.extend(p["p"][0::2])
        zs.extend(p["p"][1::2])
    d_bbox.append((min(xs), min(zs), max(xs), max(zs)))


def district_of(x, z):
    for i, (x0, z0, x1, z1) in enumerate(d_bbox):
        if x0 <= x <= x1 and z0 <= z <= z1:
            for p in districts[i]["polys"]:
                if not p["hole"] and point_in_ring(x, z, p["p"]):
                    return districts[i]["name"]
    bi = min(range(len(districts)),
             key=lambda i: (districts[i]["c"][0] - x) ** 2 + (districts[i]["c"][1] - z) ** 2)
    return districts[bi]["name"]


def nearest_metro(x, z):
    bs, bd = "", 1e9
    for s in stations:
        d = (s["x"] - x) ** 2 + (s["z"] - z) ** 2
        if d < bd:
            bd, bs = d, s
    return bs["name"], round(math.sqrt(bd) * 1000)


def clean_name(nm):
    """修正 '文庙上海文庙' 这类首尾重复的错误命名"""
    if len(nm) <= 12:
        for k in (2, 3, 4):
            if len(nm) > k and nm[:k] == nm[-k:]:
                return nm[k:] if len(nm) > k * 2 else nm[:k]
    return nm


# ---- 推荐指数: 5 个维度, 全部基于真实可计算指标 ----
for p in pois:
    x, z = p["x"], p["z"]
    p["name"] = clean_name(p["name"])
    # ---- (1) 交通便利 0-25 : 500m 内地铁站数 + 300m 内公交站数 ----
    m_cnt = around(metro_grid, x, z, 0)
    b_cnt = around(bus_grid, x, z, 0)
    s_traffic = min(20, m_cnt * 10) + min(5, b_cnt)

    # ---- (2) 周边热度 0-18 : 1km 内其它景点数量, 对数缩放避免市中心满分扎堆 ----
    nb = max(0, around(poi_grid, x, z, 1) - 1)
    s_hot = min(18.0, round(math.log1p(nb) * 5.2, 1))

    # ---- (3) 知名度 0-32 : 以可验证的结构化证据为准 ----
    s_fame = metro_access(p["name"], x, z)   # 地铁直达性
    if (p["kind"] or "").lower() in BIG_SITE:  # 大型主题乐园 / 动物园 / 保护区
        s_fame += 8
    if p["wiki"].startswith("Q"):
        s_fame += 8
    elif p["wiki"]:
        s_fame += 6
    if p["en"]:
        s_fame += 3
    if p["web"]:
        s_fame += 2
    if p["desc"]:
        s_fame += 2
    if p["tags"] >= 10:
        s_fame += 3
    s_fame = min(32, s_fame)

    # ---- (4) 文化价值 0-15 : 文物保护身份 ----
    s_cul = 0
    if p["heritage"]:
        s_cul += 9
    if p["historic"]:
        s_cul += 6
    s_cul = min(15, s_cul)

    # ---- (5) 地标尺度 0-10 : 周边 250m 内最高建筑, 以 632m(上海中心) 为满分基准 ----
    ph = peak_height(x, z)
    s_scale = min(10.0, round(ph / 632.0 * 10.0, 1))

    total = s_traffic + s_hot + s_fame + s_cul + s_scale
    p["score"] = round(total, 1)
    p["br"] = [round(s_traffic, 1), s_hot, s_fame, s_cul, s_scale]
    p["metro"] = m_cnt
    p["bus"] = b_cnt
    p["peak"] = round(ph)
    p["dist"] = district_of(x, z)
    mn, md = nearest_metro(x, z)
    p["near"] = mn
    p["nearD"] = md

pois.sort(key=lambda p: -p["score"])

# 星级按分位数评定 (保证榜单梯度, 而非绝对分数)
N = len(pois)
for i, p in enumerate(pois):
    q = i / max(1, N - 1)
    p["stars"] = 5 if q <= 0.03 else 4 if q <= 0.12 else 3 if q <= 0.32 else 2 if q <= 0.60 else 1

# 清洗后再次去重: 同名且相距 <200m 视为同一景点, 保留高分那条
seen2, dedup = {}, []
for p in pois:
    dup = False
    for q in seen2.get(p["name"], []):
        if math.hypot(p["x"] - q["x"], p["z"] - q["z"]) < 0.2:
            dup = True
            break
    if dup:
        continue
    seen2.setdefault(p["name"], []).append(p)
    dedup.append(p)
pois = dedup
# 精简字段
slim = []
for p in pois:
    slim.append({
        "name": p["name"], "x": p["x"], "z": p["z"], "lon": p["lon"], "lat": p["lat"],
        "kind": p["kind"], "en": p["en"], "wiki": p["wiki"], "web": p["web"],
        "fee": p["fee"], "hours": p["hours"], "addr": p["addr"], "desc": p["desc"][:180],
        "score": p["score"], "stars": p["stars"], "br": p["br"],
        "metro": p["metro"], "bus": p["bus"], "tags": p["tags"], "peak": p["peak"],
        "dist": p.get("dist", ""), "near": p.get("near", ""), "nearD": p.get("nearD", 0),
    })

dump("attractions", {"pois": slim})
print("     景点 %d 个, 前 12 名:" % len(slim))
for p in slim[:12]:
    print("       %-20s %5.1f分 %d星 (交通%.0f 热度%.0f 知名%.0f 文化%.0f 尺度%.0f 峰高%dm)"
          % (p["name"][:20], p["score"], p["stars"], p["br"][0], p["br"][1],
             p["br"][2], p["br"][3], p["br"][4], p["peak"]))

# =========================================================
# 6. 建筑
# =========================================================
print("\n[6/8] 建筑体块")

buildings = []
seen_b = set()
for src in ("buildings_core", "buildings_bund"):
    for e in load(src)["elements"]:
        if e.get("type") != "way":
            continue
        t = e.get("tags", {})
        g = geom_of(e)
        if len(g) < 4:
            continue
        if not all(in_sh(a, b) for a, b in g):
            continue
        key = (round(g[0][0], 5), round(g[0][1], 5), len(g))
        if key in seen_b:
            continue
        seen_b.add(key)
        # 真实高度: 优先 height 标签, 其次层数×3.2m
        h = 0
        try:
            h = float(re.sub(r"[^\d.]", "", t.get("height", "")) or 0)
        except Exception:
            h = 0
        if not h:
            try:
                lv = float(re.sub(r"[^\d.]", "", t.get("building:levels", "")) or 0)
                h = lv * 3.2
            except Exception:
                h = 0
        if not h:
            h = 14.0
        h = min(h, 700)
        sp = simplify(g, 0.00002)
        if len(sp) < 4:
            continue
        buildings.append({
            "p": [r4(v) for pt in sp for v in proj(pt[0], pt[1])],
            "h": round(h * 0.001 * 1.6, 4),      # 米 -> 场景单位, 视觉放大 1.6x
            "n": (t.get("name") or t.get("name:zh") or "")[:24],
        })

dump("buildings", {"b": buildings})
print("     建筑 %d 栋, 最高 %.0fm" % (len(buildings), max(b["h"] for b in buildings) / 0.0016))

# =========================================================
# 7. 道路
# =========================================================
print("\n[7/8] 主干道路")

roads = []
for e in load("roads")["elements"]:
    if e.get("type") != "way":
        continue
    t = e.get("tags", {})
    g = geom_of(e)
    if len(g) < 2:
        continue
    pts = [(a, b) for a, b in g if in_sh(a, b)]
    if len(pts) < 2:
        continue
    sp = simplify(pts, 0.00012)
    if len(sp) < 2:
        continue
    cls = t.get("highway", "primary")
    roads.append({
        "c": 1 if cls in ("motorway", "trunk") else 2,
        "p": [r4(v) for pt in sp for v in proj(pt[0], pt[1])],
    })
roads.sort(key=lambda r: r["c"])
dump("roads", {"r": roads})
print("     道路 %d 段" % len(roads))

# =========================================================
# 8. 轮渡 / 游轮 / 公园
# =========================================================
print("\n[8/8] 轮渡游轮 与 公园绿地")

# 轮渡码头
ferry_pts, cruise_pts = [], []
seen_f = set()
for src, bucket in (("ferry", ferry_pts), ("cruise", cruise_pts)):
    for e in load(src)["elements"]:
        t = e.get("tags", {})
        nm = t.get("name") or t.get("name:zh")
        if not nm:
            continue
        g = geom_of(e)
        if not g:
            continue
        lon, lat = g[len(g) // 2]
        if not in_sh(lon, lat):
            continue
        if nm in seen_f:
            continue
        seen_f.add(nm)
        x, z = proj(lon, lat)
        bucket.append({"name": nm, "x": r4(x), "z": r4(z),
                       "kind": t.get("amenity") or t.get("seamark:type") or t.get("landuse") or "ferry",
                       "op": t.get("operator", "")})

# 黄浦江游轮航线 = 黄浦江中心线
hp = next((r for r in rivers if r["name"] == "黄浦江"), None)
cruise_route = hp["line"] if hp else []

parks = []
for e in load("parks")["elements"]:
    t = e.get("tags", {})
    nm = t.get("name") or t.get("name:zh")
    if not nm:
        continue
    g = geom_of(e)
    if len(g) < 4 or not all(in_sh(a, b) for a, b in g):
        continue
    sp = simplify(g, 0.00025)
    if len(sp) < 4:
        continue
    parks.append({"name": nm, "p": [r4(v) for pt in sp for v in proj(pt[0], pt[1])]})

dump("ferry", {"ferry": ferry_pts, "cruise": cruise_pts, "cruiseRoute": cruise_route, "parks": parks})
print("     轮渡码头 %d, 邮轮/港口 %d, 公园 %d" % (len(ferry_pts), len(cruise_pts), len(parks)))
print("     黄浦江游轮航线 %d 点" % (len(cruise_route) // 2))

# =========================================================
# 元信息
# =========================================================
meta = {
    "built": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "sources": {
        "行政边界": "阿里云 DataV.GeoAtlas (民政部行政区划) geo.datav.aliyun.com",
        "地铁/公交/水系/景点/建筑/道路": "OpenStreetMap via Overpass API (ODbL)",
    },
    "osmTimestamp": load("metro").get("osm3s", {}).get("timestamp_osm_base", ""),
    "projection": {"lon0": LON0, "lat0": LAT0, "unit": "1 场景单位 = 1 公里"},
    "counts": {
        "districts": len(districts), "rivers": len(rivers), "lakes": len(lakes),
        "metroLines": len(metro_lines), "metroStations": len(stations),
        "busStops": len(bus_stops), "busLines": len(bus_lines),
        "pois": len(slim), "buildings": len(buildings),
        "roads": len(roads), "ferry": len(ferry_pts), "cruise": len(cruise_pts),
        "parks": len(parks),
    },
}
dump("meta", meta)

print("\n" + "=" * 66)
print("编译完成")
print("=" * 66)
