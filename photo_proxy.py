#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高德地图照片代理 (示例) —— 让沙盘能展示"地图导航软件"里的真实照片。

为什么需要它:
  · 高德 / 百度 / 腾讯 的 POI 照片接口都要求 API Key, 且浏览器直连会被 CORS 拦截。
  · 因此在「服务端 / 本机」用这个脚本转发, 前端只认 http://127.0.0.1:8787/photo。

用法:
  1) 申请高德 Web 服务 Key: https://lbs.amap.com/  (免费)
  2) 设置环境变量后启动:
       set AMAP_KEY=你的key        (Windows)
       python photo_proxy.py
  3) 在前端控制台注入代理地址 (一次性, 或写进 main.js):
       window.__PHOTO_PROXY = 'http://127.0.0.1:8787/photo'
  4) 重新点开任意地标 / 景点, 实景照片区即改为高德图片。

返回结构需与前端一致:
  { "photos":[{"url":..., "title":...}], "extract":"", "source":"...", "title":"..." }
"""
import os
import json
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

AMAP_KEY = os.environ.get('AMAP_KEY', '')
BAIDU_KEY = os.environ.get('BAIDU_KEY', '')
PORT = 8787


def amap_search(q, lon, lat):
    """按关键词在高德 POI 库检索, 取首条 POI 的 photos。"""
    if not AMAP_KEY:
        return None
    params = {
        'key': AMAP_KEY,
        'keywords': q,
        'city': '上海',
        'citylimit': 'true',
        'offset': '1',
        'extensions': 'all',
    }
    url = 'https://restapi.amap.com/v3/place/text?' + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return None
    if data.get('status') != '1':
        return None
    pois = data.get('pois') or []
    if not pois:
        return None
    poi = pois[0]
    photos = []
    for p in (poi.get('photos') or []):
        if not isinstance(p, dict):
            continue
        u = p.get('url') or p.get('photo')
        if u:
            photos.append({'url': u, 'title': p.get('title') or poi.get('name') or q})
    return {'title': poi.get('name'), 'photos': photos}


def baidu_search(q):
    """按关键词在百度地图 POI 库检索 (用户提到"百度地图能搜到照片"), 取首条 results 的图片。

    需 BAIDU_KEY 环境变量 (百度地图开放平台 服务端 AK, 免费)。"""
    if not BAIDU_KEY:
        return None
    params = {
        'query': q,
        'region': '上海',
        'output': 'json',
        'scope': '2',           # scope=2 才会返回每条结果的 image / photos
        'ak': BAIDU_KEY,
    }
    url = 'https://api.map.baidu.com/place/v2/search?' + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return None
    if data.get('status') != 0:
        return None
    results = data.get('results') or []
    if not results:
        return None
    photos = []
    for res in results[:3]:
        im = res.get('image')
        if im and isinstance(im, str):
            photos.append({'url': im, 'title': res.get('name') or q})
        for ph in (res.get('photos') or []):
            u = ph.get('url') or ph.get('image')
            if u and isinstance(u, str):
                photos.append({'url': u, 'title': res.get('name') or q})
    return {'title': results[0].get('name'), 'photos': photos}


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/photo'):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = qs.get('q', [''])[0]
            lon = qs.get('lon', [''])[0]
            lat = qs.get('lat', [''])[0]
            res = amap_search(name, lon, lat)
            if not res or not res.get('photos'):
                alt = baidu_search(name)
                if alt and alt.get('photos'):
                    res = alt
                    res['source'] = '百度地图 (代理)'
            if not res:
                res = {'photos': [], 'extract': '', 'source': '高德/百度地图 (代理)', 'title': name}
            res.setdefault('source', '高德地图 (代理)')
            self._send(res)
        else:
            self._send({'photos': []})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'photo proxy  ->  http://127.0.0.1:{PORT}/photo')
    print(f'AMAP_KEY     ->  {"已配置" if AMAP_KEY else "未配置(请 set AMAP_KEY=你的高德Key)"}')
    print(f'BAIDU_KEY    ->  {"已配置" if BAIDU_KEY else "未配置(可选, set BAIDU_KEY=你的百度地图AK)"}')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
