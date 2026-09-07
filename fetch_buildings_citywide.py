# -*- coding: utf-8 -*-
"""
全市建筑体块分片抓取 (解决"只有中心区域有建筑, 其他区空白")

背景:
  _raw/buildings_core.json 只抓了 (31.2150,121.4700,31.2620,121.5300) 内环 5x5.6km,
  导致 长宁/徐汇/普陀/闵行/宝山/嘉定/奉贤/松江/青浦/崇明/金山 全部 0 栋。

做法:
  按 0.10° 网格分片遍历全上海 bbox, 每片抓"值得渲染"的建筑:
    - 有 building:levels / height 标签 (有体量)
    - 或 building 类型为 apartments/residential/commercial/... (有体积)
    - 排除 shed/garage/roof/hut/greenhouse 等小构件
  每片按高度降序取 top KEEP_PER_CELL, 控制总量可渲染。

输出: data/buildings_outer.json  ->  { "b": [ {p:[x,z,...], h:场景高度, n:名称} ] }
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request, gzip

LON0, LAT0 = 121.4737, 31.2304
M_LON = 111320 * math.cos(math.radians(LAT0))
M_LAT = 110957
SCENE = 1.0 / 1000.0
VM = 0.0016                       # 1 米 -> 场景单位

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "buildings_outer.json")

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# 全上海 16 区范围
SH = (30.67, 120.85, 31.90, 122.05)      # lat0, lon0, lat1, lon1
CELL = 0.10
KEEP_PER_CELL = 420                       # 每片最多保留多少栋 (按高度/面积降序)
UA = "shanghai-3d-map/1.0 (citywide building fetch)"


def proj(lon, lat):
    return ((lon - LON0) * M_LON * SCENE, -(lat - LAT0) * M_LAT * SCENE)


def r4(v):
    return round(v, 4)


def http_post(q, timeout=180, tries=4):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for k in range(tries):
        url = MIRRORS[k % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": UA, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                buf = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    buf = gzip.decompress(buf)
            return json.loads(buf.decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(3 + k * 4)
    raise last


def height_of(tags):
    try:
        h = float(re.sub(r"[^\d.]", "", tags.get("height", "") or "") or 0)
    except Exception:
        h = 0.0
    if not h:
        try:
            lv = float(re.sub(r"[^\d.]", "", tags.get("building:levels", "") or "") or 0)
            h = lv * 3.2
        except Exception:
            h = 0.0
    if not h:
        h = 10.0
    return min(h, 650.0)


def simplify(pts, eps):
    """Douglas-Peucker 简化 (经纬度)"""
    if len(pts) < 5:
        return pts
    def d(p, a, b):
        if a[0] == b[0] and a[1] == b[1]:
            return math.hypot(p[0] - a[0], p[1] - a[1])
        t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / \
            ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
        t = max(0.0, min(1.0, t))
        return math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])))
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        dd = d(pts[i], pts[0], pts[-1])
        if dd > dmax:
            dmax, idx = dd, i
    if dmax > eps:
        return simplify(pts[:idx + 1], eps)[:-1] + simplify(pts[idx:], eps)
    return [pts[0], pts[-1]]


def poly_area(p):
    """场景坐标下的多边形面积 (鞋带公式)"""
    n = len(p) // 2
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
    return abs(s) / 2.0


def main():
    lat0, lon0, lat1, lon1 = SH
    cells = []
    y = lat0
    while y < lat1:
        x = lon0
        while x < lon1:
            cells.append((y, x, min(y + CELL, lat1), min(x + CELL, lon1)))
            x += CELL
        y += CELL
    print("网格分片: %d 片 (%.2f deg/片)" % (len(cells), CELL), flush=True)

    QUERY = """[out:json][timeout:180];
(
  way["building"]["building:levels"](%s);
  way["building"]["height"](%s);
  way["building"~"^(apartments|residential|commercial|retail|industrial|office|hotel|skyscraper|warehouse|church|cathedral|hospital|school|university|college|train_station|detached|terrace|semidetached_house|dormitory|supermarket)$"](%s);
);
out geom;"""

    seen = set()
    kept = []
    ok = fail = 0
    for i, (sy, sx, ey, ex) in enumerate(cells):
        bbox = "%f,%f,%f,%f" % (sy, sx, ey, ex)
        try:
            js = http_post(QUERY % (bbox, bbox, bbox))
        except Exception as e:
            print("  [%d/%d] 失败 %s : %s" % (i + 1, len(cells), bbox, e), flush=True)
            fail += 1
            continue
        ok += 1

        cands = []
        for el in js.get("elements", []):
            if el.get("type") != "way":
                continue
            g = el.get("geometry") or []
            if len(g) < 4:
                continue
            t = el.get("tags", {})
            if t.get("building") in ("shed", "garage", "roof", "hut", "greenhouse", "carport", "container"):
                continue
            pts = [(pt["lon"], pt["lat"]) for pt in g if pt]
            if pts[0] != pts[-1]:
                continue
            pts = pts[:-1]
            sp = simplify(pts, 0.00003)
            if len(sp) < 3:
                continue
            flat = [v for lon, lat in sp for v in proj(lon, lat)]
            area = poly_area(flat)
            if area < 0.000008:                 # 小于约 8 m² 的碎片丢弃
                continue
            h = height_of(t)
            score = h * 1000 + area * 40000 + (40 if t.get("name") else 0)
            cands.append({
                "p": [r4(v) for v in flat],
                "h": round(h * VM, 4),
                "n": (t.get("name") or t.get("name:zh") or "")[:24],
                "_s": score,
            })

        # 去重 (同首点+同顶点数)
        uniq = []
        for c in cands:
            key = (round(c["p"][0], 3), round(c["p"][1], 3), len(c["p"]))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(c)
        uniq.sort(key=lambda c: -c["_s"])
        for c in uniq[:KEEP_PER_CELL]:
            c.pop("_s", None)
            kept.append(c)

        if (i + 1) % 10 == 0 or i == len(cells) - 1:
            print("  [%d/%d] ok=%d fail=%d 累计建筑=%d" % (i + 1, len(cells), ok, fail, len(kept)), flush=True)
            json.dump({"b": kept}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
        time.sleep(1.0)

    json.dump({"b": kept}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("DONE 全市建筑 %d 栋 -> %s (%.1f KB)" % (len(kept), OUT, os.path.getsize(OUT) / 1024), flush=True)


if __name__ == "__main__":
    main()
