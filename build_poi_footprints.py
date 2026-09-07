# -*- coding: utf-8 -*-
"""
为缺少 OSM 建筑轮廓的网红景点, 定向补拉建筑 footprint。

做法:
  1. 读 data/attractions.json + data/buildings.json
  2. 找出 150m 内没有已知建筑的 POI
  3. 把这些 POI 按 0.02° 网格聚类, 每个格子发一次 Overpass bbox 查询
  4. 解析几何 -> 投影 -> 计算高度(米 * 0.0016)
  5. 每个 POI 保留最近的一栋建筑, 写入 data/poi_footprints.json

输出: data/poi_footprints.json = [ { "i": poi下标, "p":[x,z,...], "h":场景高度, "n":名称 } ]
"""
import json, math, re, os, sys, time, urllib.request, urllib.parse

LON0, LAT0 = 121.4737, 31.2304
M_LON = 111320 * math.cos(math.radians(LAT0))
M_LAT = 110957
SCENE = 1.0 / 1000.0
VM = 0.0016                      # 1 米 -> 场景单位 (与 build_data.py 一致)

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def proj(lon, lat):
    return ((lon - LON0) * M_LON * SCENE, -(lat - LAT0) * M_LAT * SCENE)


def r4(v):
    return round(v, 4)


def http_post(url, data, timeout=180, tries=3):
    body = urllib.parse.urlencode({"data": data}).encode("utf-8")
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={"User-Agent": "shanghai-3d/1.0 (osm building fetch)"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(4 + k * 5)
    raise last


def height_of(tags):
    h = 0.0
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
        h = 14.0
    return min(h, 700.0)


def poly_center(p):
    n = len(p) // 2
    return sum(p[i * 2] for i in range(n)) / n, sum(p[i * 2 + 1] for i in range(n)) / n


def main():
    pois = json.load(open(os.path.join(DATA, "attractions.json"), encoding="utf-8"))["pois"]
    bl = json.load(open(os.path.join(DATA, "buildings.json"), encoding="utf-8"))["b"]
    print("pois=%d  buildings=%d" % (len(pois), len(bl)))

    # --- 已有建筑质心网格 ---
    CELL = 0.5
    grid = {}
    for b in bl:
        p = b.get("p") or []
        if len(p) < 6:
            continue
        cx, cz = poly_center(p)
        grid.setdefault((math.floor(cx / CELL), math.floor(cz / CELL)), []).append((cx, cz))

    def has_building(x, z, radius):
        R = int(math.ceil(radius / CELL))
        kx, kz = math.floor(x / CELL), math.floor(z / CELL)
        r2 = radius * radius
        for dx in range(-R, R + 1):
            for dz in range(-R, R + 1):
                for c in grid.get((kx + dx, kz + dz), ()):
                    if (c[0] - x) ** 2 + (c[1] - z) ** 2 <= r2:
                        return True
        return False

    missing = [i for i, p in enumerate(pois) if not has_building(p["x"], p["z"], 0.15)]
    print("缺少轮廓的 POI: %d / %d" % (len(missing), len(pois)))

    # --- 按 0.02° 网格聚类 ---
    GC = 0.02
    cells = {}
    for i in missing:
        p = pois[i]
        cells.setdefault((math.floor(p["lon"] / GC), math.floor(p["lat"] / GC)), []).append(i)
    print("需要查询的网格: %d" % len(cells))

    results = {}          # poi index -> footprint
    ep_i = 0
    done = 0
    for (gx, gy), idxs in sorted(cells.items()):
        s = 0.012                                  # bbox 外扩, 覆盖 120m 半径
        w, e = gx * GC - s, (gx + 1) * GC + s
        so, n = gy * GC - s, (gy + 1) * GC + s
        q = (
            "[out:json][timeout:120];("
            'way["building"](%f,%f,%f,%f);'
            'way["building:part"](%f,%f,%f,%f);'
            'relation["building"]["type"="multipolygon"](%f,%f,%f,%f);'
            ");out geom;"
            % (so, w, n, e, so, w, n, e, so, w, n, e)
        )
        try:
            js = http_post(ENDPOINTS[ep_i % len(ENDPOINTS)], q)
        except Exception as ex:
            print("  cell(%d,%d) 失败: %s" % (gx, gy, ex))
            ep_i += 1
            continue
        ep_i += 1

        cand = []
        for el in js.get("elements", []):
            tags = el.get("tags", {})
            geoms = []
            if el.get("type") == "way":
                g = el.get("geometry") or []
                if len(g) >= 4:
                    geoms.append([(pt["lon"], pt["lat"]) for pt in g if pt])
            elif el.get("type") == "relation":
                for m in el.get("members", []):
                    if m.get("type") == "way" and m.get("geometry"):
                        g = m["geometry"]
                        if len(g) >= 4:
                            geoms.append([(pt["lon"], pt["lat"]) for pt in g if pt])
            for g in geoms:
                if g[0] != g[-1]:
                    continue
                g = g[:-1]
                if len(g) < 3:
                    continue
                pts = [v for lon, lat in g for v in proj(lon, lat)]
                cx, cz = poly_center(pts)
                cand.append({
                    "p": [r4(v) for v in pts],
                    "cx": cx, "cz": cz,
                    "h": round(height_of(tags) * VM, 4),
                    "n": (tags.get("name") or tags.get("name:zh") or "")[:24],
                })

        if cand:
            # 每个 POI 取最近的建筑
            for i in idxs:
                px, pz = pois[i]["x"], pois[i]["z"]
                best, bd = None, 0.25 * 0.25
                for c in cand:
                    d = (c["cx"] - px) ** 2 + (c["cz"] - pz) ** 2
                    if d < bd:
                        bd, best = d, c
                if best:
                    results[i] = best
        done += 1
        if done % 20 == 0:
            print("  ... %d/%d 网格, 已补 %d 处" % (done, len(cells), len(results)))
            json.dump([dict(v, i=k) for k, v in results.items()],
                      open(os.path.join(DATA, "poi_footprints.json"), "w", encoding="utf-8"),
                      ensure_ascii=False)
        time.sleep(1.2)

    out = [dict(v, i=k) for k, v in sorted(results.items())]
    json.dump(out, open(os.path.join(DATA, "poi_footprints.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    print("DONE 补到轮廓: %d 处 (原缺 %d)" % (len(out), len(missing)))


if __name__ == "__main__":
    main()
