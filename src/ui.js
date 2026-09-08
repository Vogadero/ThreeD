import { fmt } from './util.js?v=32';
import { PHOTO_VIEWS, renderMosaic, thumbURL } from './photos.js?v=32';
import { getPlaceMedia, probeWikimedia } from './wikimedia.js?v=61';

/* =========================================================
   界面: 左侧折叠控制台 / 右侧详情抽屉 / 实景影像灯箱
   ========================================================= */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DIM_META = [
  ['交通', 25], ['热度', 18], ['知名', 32], ['文化', 15], ['尺度', 10],
];

const LON0 = 121.4737, LAT0 = 31.2304;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const M_LAT = 110957;
const unproj = (x, z) => [x * 1000 / M_LON + LON0, -z * 1000 / M_LAT + LAT0];

/* 上海各区代表性美食 / 本帮风味 (真实可考, 非点评数据) */
const FOOD_KB = {
  '黄浦区': [{ n: '南翔小笼馒头', d: '城隍庙一带老字号, 皮薄汁多' }, { n: '生煎馒头', d: '底脆汁浓, 本帮经典' }, { n: '排骨年糕', d: '鲜排配软糯年糕' }, { n: '本帮红烧肉', d: '浓油赤酱代表菜' }],
  '静安区': [{ n: '王家沙点心', d: '百年老店, 八宝饭与糕团' }, { n: '蝴蝶酥', d: '酥香层层, 海派西点' }],
  '徐汇区': [{ n: '凯司令栗子蛋糕', d: '老牌西点, 绵密栗香' }, { n: '本帮腌笃鲜', d: '春笋咸肉慢炖' }],
  '长宁区': [{ n: '虹桥本帮菜', d: '糟卤与醉货见长' }, { n: '蟹粉小笼', d: '蟹粉入馅, 鲜香加倍' }],
  '浦东新区': [{ n: '浦东三黄鸡', d: '白斩鸡皮爽肉嫩' }, { n: '高桥松饼', d: '酥皮千层, 非遗点心' }, { n: '本帮熏鱼', d: '外脆里嫩, 甜咸入味' }],
  '虹口区': [{ n: '虹口糕团', d: '条头糕与薄荷糕' }, { n: '油墩子', d: '萝卜丝炸饼, 街头记忆' }],
  '杨浦区': [{ n: '五角场小吃', d: '大学周边市井风味' }, { n: '本帮酱鸭', d: '浓酱收汁, 咸甜适口' }],
  '普陀区': [{ n: '真如羊肉', d: '白切羊肉, 老真如滋味' }, { n: '草头圈子', d: '大肠配草头, 浓油赤酱' }],
  '闵行区': [{ n: '七宝老街汤团', d: '七宝古镇现做糯米团' }, { n: '白切羊肉', d: '七宝羊肉久负盛名' }],
  '青浦区': [{ n: '朱家角扎肉', d: '粽叶捆扎红烧, 古镇名吃' }, { n: '青浦茭白', d: '水乡时蔬, 清甜脆嫩' }, { n: '练塘茭白糕', d: '时令米糕' }],
  '松江区': [{ n: '佘山笋', d: '春笋鲜嫩, 山间时令' }, { n: '叶榭软糕', d: '非遗米糕, 松软微甜' }],
  '宝山区': [{ n: '宝山鮰鱼', d: '长江口名鱼, 肉嫩无刺' }, { n: '本帮红烧鮰鱼', d: '浓汁收味' }],
  '嘉定区': [{ n: '南翔小笼包', d: '发源地, 皮薄馅大卤多' }, { n: '嘉定白蒜', d: '辛香清甜的地方特产' }],
  '金山区': [{ n: '枫泾丁蹄', d: '古镇名腿, 肥而不腻' }, { n: '枫泾状元糕', d: '细腻米糕' }],
  '奉贤区': [{ n: '奉贤羊肉', d: '庄行白切羊肉' }, { n: '锦绣黄桃', d: '本地名果, 肉质细腻' }],
  '崇明区': [{ n: '崇明老白酒', d: '米酿甜酒, 海岛风味' }, { n: '崇明白山羊', d: '肉质细嫩无膻' }, { n: '崇明蟹粉', d: '江海蟹鲜' }],
  '其它': [{ n: '生煎馒头', d: '沪上街头最具代表性的点心' }, { n: '小笼包', d: '南翔流派, 皮薄卤多' }],
};

export function initUI(ctx) {
  const { layers, views, hubViews = [], data } = ctx;
  const $ = (id) => document.getElementById(id);

  /* ===== v=52: UI 忙信号 =====
     控制台/详情抽屉在拖拽、滚动、折叠动画期间, 通知渲染循环跳过 WebGL 帧
     (main.js 读 window.__uiBusy)。画布静止后合成器可复用上一帧,
     backdrop 毛玻璃不再每帧重算 —— UI 操作不再与 WebGL 争抢 GPU。
     时间窗实现, 幂等无计数泄漏。 */
  let _busyUntil = 0;
  const holdBusy = ms => { _busyUntil = Math.max(_busyUntil, performance.now() + ms); };
  window.__uiBusy = () => performance.now() < _busyUntil;

  /* ===== 左侧折叠控制台 ===== */
  const side = $('side');
  const accs = [...document.querySelectorAll('#sideBd .acc')];
  accs.forEach(sec => {
    const hd = sec.querySelector('h4');
    hd.addEventListener('click', () => {
      const willOpen = !sec.classList.contains('open');
      accs.forEach(s => s.classList.remove('open'));
      if (willOpen) sec.classList.add('open');
      holdBusy(520);   // v=52: 开合动画期间冻结 WebGL
    });
  });

  /* v=32: 全部折叠/展开按钮 */
  const collapseAllBtn = $('sideCollapseAll');
  if (collapseAllBtn) {
    let allCollapsed = false;
    collapseAllBtn.onclick = (e) => {
      e.stopPropagation();
      holdBusy(560);   // v=52: 批量开合动画期间冻结 WebGL
      if (allCollapsed) {
        accs.forEach(s => s.classList.add('open'));
        allCollapsed = false;
        collapseAllBtn.textContent = '⇅';
        collapseAllBtn.title = '全部折叠';
      } else {
        accs.forEach(s => s.classList.remove('open'));
        allCollapsed = true;
        collapseAllBtn.textContent = '⇅';
        collapseAllBtn.title = '全部展开';
      }
    };
  }

  const foldBtn = $('sideFold');
  foldBtn.addEventListener('click', () => {
    const folded = side.classList.toggle('fold');
    foldBtn.textContent = folded ? '›' : '‹';
    foldBtn.title = folded ? '展开控制台' : '收起控制台';
    holdBusy(520);   // v=52: 折叠动画期间冻结 WebGL
  });
  side.addEventListener('click', (e) => {
    if (side.classList.contains('fold') && e.target !== foldBtn) {
      side.classList.remove('fold');
      foldBtn.textContent = '‹';
      holdBusy(520);
    }
  });

  /* v=52: 控制台内按住拖动(滚动条/滑杆等)与列表滚动期间冻结 WebGL;
     滑杆(input[type=range])除外 —— 拖航速时要实时看到船速变化。
     纯点击(无位移)不冻结, 图层开关仍是即时生效。 */
  let _sideDown = false, _sideMoved = false;
  side.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('input[type="range"]')) return;
    _sideDown = true; _sideMoved = false;
  }, true);
  addEventListener('pointermove', () => {
    if (_sideDown) { _sideMoved = true; holdBusy(160); }
  }, true);
  addEventListener('pointerup', () => {
    if (_sideMoved) holdBusy(350);   // 松手后一小段余量
    _sideDown = false;
  }, true);
  side.addEventListener('scroll', () => holdBusy(320), true);

  /* ---- 图层 ---- */
  const lyrList = $('lyrList');
  layers.forEach(l => {
    const el = document.createElement('div');
    el.className = 'lyr' + (l.on ? ' on' : '');
    el.dataset.layerName = l.name;
    el.innerHTML = `<i style="background:${l.color};color:${l.color}"></i>
      <span title="${esc(l.name)}">${esc(l.name)}</span><em>${esc(l.tip || '')}</em><div class="sw"></div>`;
    el.onclick = () => { l.on = !l.on; el.classList.toggle('on', l.on); l.set(l.on); };
    lyrList.appendChild(el);
    l.set(l.on);
  });
  $('cLyr').textContent = layers.filter(l => l.on).length + '/' + layers.length;

  /* ---- 游轮航速 ---- */
  if (ctx.cruise && ctx.cruise.setTimeScale) {
    const cru = ctx.cruise;
    const OPTS = [
      { k: 1, n: '真实', t: '15~22 km/h 原速' },
      { k: 10, n: '10×', t: '单程约 4 分钟' },
      { k: 30, n: '30×', t: '单程约 80 秒' },
    ];
    const row = document.createElement('div');
    row.className = 'spd';
    row.innerHTML = `<label>游轮航速</label><div class="spd-b">` +
      OPTS.map(o => `<button data-k="${o.k}" title="${esc(o.t)}">${o.n}</button>`).join('') +
      `</div><small id="spdTip"></small>`;
    lyrList.appendChild(row);
    const btns = [...row.querySelectorAll('button')];
    const sync = () => {
      const k = cru.getTimeScale();
      btns.forEach(b => b.classList.toggle('on', +b.dataset.k === k));
      const s = Math.round(cru.legSeconds());
      $('spdTip').textContent = cru.routeKm
        ? `浦江游览航段 ${cru.routeKm.toFixed(1)} km · 单程 ${s >= 60 ? Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒'}`
        : '';
    };
    btns.forEach(b => b.onclick = () => { cru.setTimeScale(+b.dataset.k); sync(); });
    sync();
  }

  /* ---- 公交车速 ---- */
  if (ctx.mobility && ctx.mobility.buses && ctx.mobility.buses.setTimeScale) {
    const bus = ctx.mobility.buses;
    const OPTS = [
      { k: 1, n: '真实', t: '15~20 km/h 正常行驶' },
      { k: 8, n: '8×', t: '1 圈约 6 分钟' },
      { k: 20, n: '20×', t: '1 圈约 2.5 分钟' },
    ];
    const row = document.createElement('div');
    row.className = 'spd';
    row.innerHTML = `<label>公交车速</label><div class="spd-b">` +
      OPTS.map(o => `<button data-k="${o.k}" title="${esc(o.t)}">${o.n}</button>`).join('') +
      `</div><small>${esc(bus.count + ' 辆 · 沿 220 条线路行驶')}</small>`;
    lyrList.appendChild(row);
    const btns = [...row.querySelectorAll('button')];
    const sync = () => { const k = bus.getTimeScale(); btns.forEach(b => b.classList.toggle('on', +b.dataset.k === k)); };
    btns.forEach(b => b.onclick = () => { bus.setTimeScale(+b.dataset.k); sync(); });
    sync();
  }

  /* ---- 航班速度 ---- */
  if (ctx.aviation && ctx.aviation.setTimeScale) {
    const av = ctx.aviation;
    const OPTS = [
      { k: 1, n: '真实', t: '700~900 km/h 原速' },
      { k: 6, n: '6×', t: '跨城航线约 1.5 分钟' },
      { k: 18, n: '18×', t: '跨城航线约 30 秒' },
    ];
    const row = document.createElement('div');
    row.className = 'spd';
    row.innerHTML = `<label>航班速度</label><div class="spd-b">` +
      OPTS.map(o => `<button data-k="${o.k}" title="${esc(o.t)}">${o.n}</button>`).join('') +
      `</div><small>${av.flightCount} 班 · 浦东 / 虹桥起降</small>`;
    lyrList.appendChild(row);
    const btns = [...row.querySelectorAll('button')];
    const sync = () => { const k = av.getTimeScale(); btns.forEach(b => b.classList.toggle('on', +b.dataset.k === k)); };
    btns.forEach(b => b.onclick = () => { av.setTimeScale(+b.dataset.k); sync(); });
    sync();
  }

  /* ---- 预设机位 (普通 + 枢纽分组) ---- */
  const viewList = $('viewList');
  const addView = (v, hub) => {
    const b = document.createElement('div');
    b.className = 'vbtn' + (hub ? ' hub' : '');
    b.innerHTML = `<span>${esc(v.name)}</span><b>${esc(v.tip || '')}</b>`;
    b.onclick = v.go;
    viewList.appendChild(b);
  };
  views.forEach(v => addView(v, false));
  if (hubViews.length) {
    const h = document.createElement('div');
    h.className = 'mk-cat';
    h.textContent = '重点交通枢纽';
    viewList.appendChild(h);
    hubViews.forEach(v => addView(v, true));
  }
  $('cView').textContent = views.length + '+' + hubViews.length;

  /* ---- 地标导览 (按"区"分组 + 关键字过滤) ---- */
  const markList = $('markList');
  const guide = ctx.landmarks || [];
  if (guide.length) {
    const box = document.createElement('div');
    box.className = 'mk-search';
    box.innerHTML = `<input id="mkq" type="search" placeholder="搜地标…" autocomplete="off">`;
    markList.appendChild(box);

    const holder = document.createElement('div');
    holder.className = 'mk-holder';
    markList.appendChild(holder);

    /* v=33: 按"区"二次折叠 —— 每个区是一个可折叠分组, 默认全部收起
       (地标 200+, 全展开滚动条太长; 用户点区名展开, 或搜索时自动展开命中项) */
    const openDistricts = new Set();
    const render = (q) => {
      holder.textContent = '';
      const kw = (q || '').trim().toLowerCase();
      const groups = {};
      for (const g of guide) {
        if (kw && !(g.name + ' ' + (g.sub || '') + ' ' + (g.dist || '')).toLowerCase().includes(kw)) continue;
        const key = g.dist || '其它';
        (groups[key] = groups[key] || []).push(g);
      }
      const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
      let shown = 0;
      for (const d of order) {
        const list = groups[d];
        // 搜索时自动展开命中的区
        const isOpen = kw ? true : openDistricts.has(d);
        const h = document.createElement('div');
        h.className = 'mk-cat mk-cat-toggle';
        /* v=37: 用 CSS 三角 (纯盒子, 无字形度量差) 代替 ▾/▸ 字形,
           并把区名包进 <span class="dn"> 设 line-height:1 —— 之前字形箭头与文字基线不一致,
           视觉上区名"偏下"。 */
        h.innerHTML = `<i class="chev3${isOpen ? ' open' : ''}"></i>` +
          `<span class="dn">${esc(d)}</span><em>${list.length}</em>`;
        holder.appendChild(h);

        const wrap = document.createElement('div');
        wrap.style.display = isOpen ? 'block' : 'none';
        for (const g of list) {
          const b = document.createElement('div');
          b.className = 'vbtn';
          b.style.borderLeft = `3px solid ${esc(g.color || '#4fd6ff')}`;
          b.innerHTML = `<span>${esc(g.name)}</span><b>${esc(g.sub || '')}</b>`;
          b.onclick = () => {
            g.go();
            const p = g.poi || findPOI(g.name);
            if (p) showPOI(p);
            else if (g.lon != null) {
              showLandmark(g);
            }
          };
          wrap.appendChild(b);
          shown++;
        }
        holder.appendChild(wrap);

        // 点区名切换折叠
        h.onclick = () => {
          if (openDistricts.has(d)) openDistricts.delete(d); else openDistricts.add(d);
          /* v=52: 直接切换本区列表显隐 —— 原来这里全量 render() 重建整个导览列表
             (几百个 DOM 节点 + 重绑全部事件), 是导览折叠卡顿的主因;
             搜索态(有关键词)下保持原全量重建逻辑 */
          if ($('mkq').value) { render($('mkq').value); return; }
          const open = openDistricts.has(d);
          wrap.style.display = open ? 'block' : 'none';
          h.querySelector('.chev3').classList.toggle('open', open);
        };
      }
      if (!shown) holder.innerHTML = `<div class="empty">没有匹配的地标</div>`;
    };
    render('');
    /* v=52: 检索输入 100ms 防抖 —— 原来每敲一个字全量重建导览列表 */
    let _mkqT = 0;
    $('mkq').addEventListener('input', e => {
      clearTimeout(_mkqT);
      _mkqT = setTimeout(() => render(e.target.value), 100);
    });
    $('cMark').textContent = guide.length;
  } else { $('cMark').textContent = '0'; }

  const findPOI = (name) => (data.attractions.pois || []).find(p => p.name === name);

  /* ===== 右侧详情抽屉 ===== */
  const panel = $('panel');
  const pKind = $('pKind'), pTitle = $('pTitle'), pSub = $('pSub'), pBody = $('pBody');
  $('pClose').onclick = () => panel.classList.remove('open');

  function open(kind, title, sub, html) {
    holdBusy(560);   // v=52: 抽屉滑入动画期间冻结 WebGL
    pKind.textContent = kind;
    pTitle.innerHTML = title;
    pSub.innerHTML = sub || '';
    pBody.innerHTML = html;
    panel.classList.add('open');
    pBody.scrollTop = 0;
  }
  const close = () => { holdBusy(560); panel.classList.remove('open'); };
  panel.addEventListener('scroll', () => holdBusy(320), true);   // v=52: 抽屉滚动冻结

  const kv = (k, v) => `<div class="kv"><b>${esc(k)}</b><span>${v}</span></div>`;
  const block = (t, inner) => `<div class="blk"><div class="blk-t">${t}</div>${inner}</div>`;

  /* ---- 实景影像 (卫星瓦片) ---- */
  const photoBlockHTML = () => block('实 景 影 像',
    `<div class="ph-box" id="phBox">
       <div class="ph-canvas" id="phCanvas"></div>
       <div class="ph-load" id="phLoad">载入影像 …</div>
       <div class="ph-tag" id="phTag"></div>
       <div class="ph-zoom">点击放大 ⤢</div>
     </div>
     <div class="ph-strip" id="phStrip"></div>
     <div class="ph-src" id="phSrc"></div>`);

  let place = null;
  function attachPhotos(lon, lat, title, sub) {
    if (lon == null || lat == null) return;
    place = { lon, lat, title, sub, vi: 0 };
    const strip = $('phStrip'); if (!strip) return;
    strip.textContent = '';
    PHOTO_VIEWS.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = i === 0 ? 'cur' : '';
      d.title = v.name;
      const u = thumbURL(lon, lat, v);
      d.innerHTML = (u ? `<img src="${u}" alt="" draggable="false" loading="lazy" decoding="async">` : '') + `<u>${esc(v.name)}</u>`;
      d.onclick = (e) => { e.stopPropagation(); setPanelView(i); };
      strip.appendChild(d);
    });
    setPanelView(0);
    $('phBox').onclick = () => openLB(place.vi);
  }
  function setPanelView(i) {
    if (!place) return;
    place.vi = i;
    const v = PHOTO_VIEWS[i];
    const host = $('phCanvas'), load = $('phLoad');
    if (!host) return;
    [...$('phStrip').children].forEach((c, k) => c.classList.toggle('cur', k === i));
    $('phTag').textContent = v.name;
    $('phSrc').textContent = '影像来源：' + v.src;
    if (load) { load.textContent = '载入影像 …'; load.style.display = 'flex'; }
    renderMosaic(host, place.lon, place.lat, v, {
      onProgress(done, total) { if (!load) return; if (done >= total) load.style.display = 'none'; else load.textContent = `载入影像 ${done}/${total} …`; },
    });
  }

  /* ---- 真实照片 + 百度街景 (参考 tiantianditu.com/baidujiejing.html) ---- */
  const realPhotoHTML = () => block('街 景 与 照 片 · 360° 百度 全 景',
      `<div id="rpToolbar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
         <a id="rpBaiduSearch" target="_blank" rel="noopener" style="display:none;flex:1;min-width:130px;padding:7px 10px;border-radius:6px;background:linear-gradient(135deg,#56c270,#1ca64a);color:#fff;font-size:11px;text-decoration:none;text-align:center;font-weight:500;letter-spacing:.3px">🔍 百度搜地点</a>
         <a id="rpBaiduImage" target="_blank" rel="noopener" style="display:none;flex:1;min-width:130px;padding:7px 10px;border-radius:6px;background:linear-gradient(135deg,#ff7e36,#e64320);color:#fff;font-size:11px;text-decoration:none;text-align:center;font-weight:500;letter-spacing:.3px">🖼️ 百度图片搜</a>
         <a id="rpBaidu" target="_blank" rel="noopener" style="display:none;flex:1;min-width:130px;padding:7px 10px;border-radius:6px;background:linear-gradient(135deg,#3385ff,#1c64f2);color:#fff;font-size:11px;text-decoration:none;text-align:center;font-weight:500;letter-spacing:.3px">📍 百度街景新窗口</a>
         <button id="rpToggleStreet" type="button" style="display:none;flex:1;min-width:130px;padding:7px 10px;border-radius:6px;background:rgba(79,214,255,.12);border:1px solid rgba(79,214,255,.35);color:#9fe6ff;font-size:11px;cursor:pointer;font-family:inherit;letter-spacing:.3px">🛰️ 抽屉内嵌360°</button>
         <button id="rpCopyProxy" type="button" style="display:none;flex:1;min-width:140px;padding:7px 12px;border-radius:6px;background:rgba(79,214,255,.12);border:1px solid rgba(79,214,255,.35);color:#9fe6ff;font-size:11.5px;cursor:pointer;font-family:inherit;letter-spacing:.5px">📋 复制代理设置</button>
       </div>
       <div id="rpPanoBox" style="display:none;position:relative;width:100%;height:260px;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#0c1524;margin-bottom:8px">
         <iframe id="rpPanoFrame" style="width:100%;height:100%;border:0;background:#0c1524" referrerpolicy="no-referrer-when-downgrade" loading="lazy"></iframe>
         <div id="rpPanoTip" style="position:absolute;left:8px;bottom:8px;z-index:5;padding:4px 9px;border-radius:16px;background:rgba(6,12,22,.82);font-size:10px;color:#cfe4ff;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.10);pointer-events:none">百度地图街景预览 · 点击右下角"街景"小图标可360°旋转</div>
         <button id="rpPanoClose" type="button" style="position:absolute;right:8px;top:8px;z-index:5;width:24px;height:24px;border-radius:50%;background:rgba(6,12,22,.82);color:#cfe4ff;border:1px solid rgba(255,255,255,.14);cursor:pointer;font-size:14px;line-height:1">×</button>
       </div>
       <div class="rp-grid" id="rpGrid"><div class="rp-load">正在获取 Wikimedia 真实照片 …</div></div>
       <div class="rp-note" id="rpNote"></div>`);

  function attachRealMedia(name, lon, lat, poi) {
    const grid = $('rpGrid'); if (!grid) return;
    // 顶部工具条: 百度搜索地点 + 街景新窗口 + 抽屉内嵌 + 复制代理设置
    const baiduSearch = `https://map.baidu.com/search/${encodeURIComponent(name)}/?querytype=s&wd=${encodeURIComponent(name)}&c=shanghai&center_rank=1`;
    const baiduPano = `https://map.baidu.com/?panoId=&lat=${lat}&lng=${lon}&panoramic=1`;
    // 抽屉内嵌: 用百度地图 embed 视图 (无需 AK, 走 tiantianditu 同款公开嵌入)
    const baiduEmbed = `https://map.baidu.com/@${lat},${lon},18z&panoIdx=0&heading=0&pitch=0&l=18`;
    const searchBtn = $('rpBaiduSearch');
    const baiduBtn = $('rpBaidu');
    const embedBtn = $('rpToggleStreet');
    const copyBtn = $('rpCopyProxy');
    if (searchBtn) { searchBtn.href = baiduSearch; searchBtn.style.display = 'block'; }
    if (baiduBtn) { baiduBtn.href = baiduPano; baiduBtn.style.display = 'block'; }
    // 百度图片搜索 (国内可访问, 无需 key)
    const baiduImageBtn = $('rpBaiduImage');
    if (baiduImageBtn) {
      baiduImageBtn.href = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(name)}`;
      baiduImageBtn.style.display = 'block';
    }
    if (embedBtn) {
      embedBtn.style.display = 'block';
      embedBtn.onclick = () => {
        const box = $('rpPanoBox'), frame = $('rpPanoFrame');
        if (!box || !frame) return;
        const open = box.style.display === 'none';
        box.style.display = open ? 'block' : 'none';
        embedBtn.textContent = open ? '🗺️ 关闭街景预览' : '🛰️ 抽屉内嵌360°';
        if (open) {
          // v=32: 改用天地图的百度街景嵌入页 (用户证明能正常显示),
          // 在搜索框里输入地点名回车就能看到对应 360° 全景
          const tiantiPano = `https://www.tiantianditu.com/baidujiejing.html#q=${encodeURIComponent(name)}`;
          frame.src = tiantiPano;
        } else {
          frame.src = 'about:blank';
        }
      };
    }
    // 关闭按钮
    const panoClose = $('rpPanoClose');
    if (panoClose) panoClose.onclick = () => { $('rpPanoBox').style.display = 'none'; $('rpPanoFrame').src = 'about:blank'; if (embedBtn) embedBtn.textContent = '🌐 抽屉内嵌街景'; };
    if (copyBtn) {
      copyBtn.style.display = 'block';
      copyBtn.onclick = () => {
        const cmd = `window.__PHOTO_PROXY='http://127.0.0.1:8787/photo'` + (lat != null ? `  /* 当前位置: ${name} ${lat.toFixed(4)},${lon.toFixed(4)} */` : '');
        try { navigator.clipboard?.writeText(cmd); } catch (e) { /* ignore */ }
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✅ 已复制, 控制台粘贴执行';
        setTimeout(() => copyBtn.textContent = orig, 2200);
      };
    }
    // 12s 硬超时: 沙箱/无网/Wikimedia 抽风时, 强制结束"正在获取…"占位
    let resolved = false;
    const wikiLink = `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(name)}`;
    const guard = setTimeout(() => {
      if (resolved || !grid.isConnected) return;
      resolved = true;
      grid.innerHTML = `<div class="empty" style="line-height:1.75">
        照片多源获取失败（Wikimedia + 服务器国内源均未命中）<br>
        <span style="color:#8fa6bd;font-size:11px">点击上方"抽屉内嵌街景"直接看百度 360° 全景, 或"新窗口打开街景"看大图</span></div>`;
    }, 12000);
    getPlaceMedia({ name, wiki: poi && poi.wiki, lon, lat }).then(m => {
      if (resolved) return; resolved = true; clearTimeout(guard);
      if (!grid.isConnected) return;
      grid.textContent = '';
      if (!m.photos || !m.photos.length) {
        const tail = `<a href="${wikiLink}" target="_blank" rel="noopener" style="color:#7fb6e8;font-size:11px">或去 Wikimedia Commons 搜索</a>`;
        /* v=54: 区分"服务器没有照片 API"(旧版 server.js)与"国内源未命中" */
        if (m.apiMissing) {
          grid.innerHTML = `<div class="empty" style="line-height:1.75">
            <b style="color:#ffb454">服务器未开启照片 API</b>（当前运行的是旧版 server.js 或纯静态部署）<br>
            <span style="color:#8fa6bd;font-size:11px">重启/部署最新版即可自动启用国内多源:
            <code style="color:#4fd6ff">node server.js</code></span><br>${tail}</div>`;
          return;
        }
        grid.innerHTML = `<div class="empty">正在诊断图片来源…</div>`;
        probeWikimedia().then(pr => {
          if (!grid.isConnected) return;
          if (pr.ok) {
            grid.innerHTML = `<div class="empty">已连通 Wikimedia (${pr.ms} ms), 但该地点没有自由版权照片<br>${tail}</div>`;
          } else {
            grid.innerHTML = `<div class="empty" style="line-height:1.75">
              <b style="color:#ffb454">无法连接 Wikimedia</b> · ${esc(pr.err || ('HTTP ' + pr.status))} · ${pr.ms} ms<br>
              <span style="color:#8fa6bd;font-size:11px">该地标较冷门, 免费国内源(必应/快懂百科)也未收录其图片。<br>
              ① 点击上方"抽屉内嵌街景"直接看百度 360° 实景; 或<br>
              ② <b style="color:#4fd6ff">申请免费高德 Key (5分钟, 覆盖全部 1687 个 POI 实景图)</b>:
              <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener" style="color:#7fb6e8">console.amap.com</a>
              → 复制 Key → 启动时 <code style="color:#4fd6ff">set AMAP_KEY=xxx node server.js</code> 或写入 data/amap_key.txt</span><br>${tail}</div>`;
          }
        });
      } else {
        m.photos.forEach((p, pi) => {
          const d = document.createElement('div');
          d.className = 'rp-cell';
          d.innerHTML = `<img src="${esc(p.url)}" alt="${esc(p.title)}" loading="lazy" draggable="false" onerror="this.parentElement.style.opacity=0.3">
            <u>${esc(p.title).slice(0, 22)}</u>`;
          d.onclick = () => openPhotoViewer(p.url, p.title, m.photos, pi);
          grid.appendChild(d);
        });
      }
      $('rpNote').textContent = m.photos.length ? '来源：' + m.source : '';
      if (m.extract) {
        const ex = document.getElementById('wikiExtract');
        if (ex) { ex.textContent = m.extract; ex.parentElement.style.display = ''; }
      }
    }).catch(() => {
      if (resolved) return; resolved = true; clearTimeout(guard);
      if (grid.isConnected) grid.innerHTML = `<div class="empty">照片获取失败, 请稍后再试</div>`;
    });
  }

  const introHTML = () => block('百 科 简 介',
    `<div class="desc" id="wikiExtract" style="display:none"></div>
     <div class="note">简介来自维基百科 (CC BY-SA)。实时用户点评与商户数据需接入高德 / 百度 / 腾讯地图或大众点评开放平台 API。</div>`);

  /* ---- 附近美食 (真实本帮/地方风味知识库) ---- */
  function foodHTML(dist) {
    const list = FOOD_KB[dist] || FOOD_KB['其它'];
    const cards = list.map(f => `<div class="food"><b>${esc(f.n)}</b><span>${esc(f.d)}</span></div>`).join('');
    return block('附 近 美 食',
      `<div class="foods">${cards}</div>
       <div class="note">以上为 ${esc(dist)} 代表性本帮 / 地方风味 (真实可考)。实时的餐厅列表、人均与食客评价需接入大众点评 / 高德美食 API 获取。</div>`);
  }

  /* ===== 灯箱 (卫星影像) ===== */
  const lb = $('lightbox');
  const lbCanvas = $('lbCanvas'), lbLoad = $('lbLoad'), lbDots = $('lbDots');
  const lbTitle = $('lbTitle'), lbSub = $('lbSub'), lbIdx = $('lbIdx');

  function openLB(i) {
    if (!place) return;
    lb.classList.add('on');
    lbDots.textContent = '';
    PHOTO_VIEWS.forEach((v, k) => {
      const d = document.createElement('i'); d.title = v.name; d.onclick = () => setLB(k); lbDots.appendChild(d);
    });
    setLB(i);
  }
  function setLB(i) {
    if (!place) return;
    const n = PHOTO_VIEWS.length;
    place.vi = (i % n + n) % n;
    const v = PHOTO_VIEWS[place.vi];
    lbTitle.textContent = place.title;
    lbSub.textContent = `${v.name} · ${v.src}`;
    lbIdx.textContent = `${place.vi + 1} / ${n}　←  →  切换前后一张　ESC 关闭`;
    [...lbDots.children].forEach((c, k) => c.classList.toggle('cur', k === place.vi));
    lbLoad.style.display = 'block'; lbLoad.textContent = '载入影像 …';
    requestAnimationFrame(() => {
      renderMosaic(lbCanvas, place.lon, place.lat, v, {
        onProgress(done, total) { if (done >= total) lbLoad.style.display = 'none'; else lbLoad.textContent = `载入影像 ${done}/${total} …`; },
      });
    });
    if ($('phCanvas')) setPanelView(place.vi);
  }
  const closeLB = () => { lb.classList.remove('on'); lbCanvas.textContent = ''; };
  $('lbClose').onclick = closeLB;
  $('lbPrev').onclick = (e) => { e.stopPropagation(); setLB(place.vi - 1); };
  $('lbNext').onclick = (e) => { e.stopPropagation(); setLB(place.vi + 1); };
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLB(); });
  addEventListener('keydown', (e) => {
    if (!lb.classList.contains('on')) { if (e.key === 'Escape') close(); return; }
    if (e.key === 'Escape') closeLB();
    else if (e.key === 'ArrowLeft') setLB(place.vi - 1);
    else if (e.key === 'ArrowRight') setLB(place.vi + 1);
  });
  let sx = 0, sy = 0, dragging = false;
  const stage = document.querySelector('.lb-stage');
  stage.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointerup', (e) => {
    if (!dragging) return; dragging = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) setLB(place.vi + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener('pointercancel', () => { dragging = false; });

  /* ---- 真实照片查看器 (v=32: 支持上一张/下一张 + 键盘左右键) ---- */
  const pv = $('photoViewer'), pvImg = $('pvImg'), pvCap = $('pvCap');
  const pvPrev = $('pvPrev'), pvNext = $('pvNext');
  let pvList = [], pvIdx = 0;
  function openPhotoViewer(url, cap, list, idx) {
    if (list && typeof idx === 'number') { pvList = list; pvIdx = idx; }
    else if (list && Array.isArray(list)) { pvList = list; pvIdx = pvList.findIndex(x => x.url === url); if (pvIdx < 0) pvIdx = 0; }
    else { pvList = [{url, title:cap}]; pvIdx = 0; }
    showCurrent();
    pv.classList.add('on');
  }
  function showCurrent() {
    const item = pvList[pvIdx] || {};
    pvImg.src = item.url; pvCap.textContent = item.title || '';
    if (pvPrev) pvPrev.style.display = pvList.length > 1 ? 'flex' : 'none';
    if (pvNext) pvNext.style.display = pvList.length > 1 ? 'flex' : 'none';
  }
  function pvShift(d) {
    if (pvList.length < 2) return;
    pvIdx = (pvIdx + d + pvList.length) % pvList.length;
    showCurrent();
  }
  $('pvClose').onclick = () => pv.classList.remove('on');
  if (pvPrev) pvPrev.onclick = (e) => { e.stopPropagation(); pvShift(-1); };
  if (pvNext) pvNext.onclick = (e) => { e.stopPropagation(); pvShift(+1); };
  pv.addEventListener('click', e => { if (e.target === pv) pv.classList.remove('on'); });
  addEventListener('keydown', e => {
    if (!pv.classList.contains('on')) return;
    if (e.key === 'Escape') pv.classList.remove('on');
    else if (e.key === 'ArrowLeft') pvShift(-1);
    else if (e.key === 'ArrowRight') pvShift(+1);
  });

  /* ===== 各类要素详情 ===== */
  function showDistrict(d) {
    const pois = (data.attractions.pois || []).filter(p => p.dist === d.name);
    const top5 = pois.slice(0, 6);
    const stN = (data.metro.stations || []).filter(s => inDistrict(s.x, s.z, d)).length;
    const busN = (data.bus.stops || []).filter(s => inDistrict(s.x, s.z, d)).length;
    const tags = top5.map(p =>
      `<div class="tag" data-poi="${esc(p.name)}" style="border-color:${p.stars >= 5 ? '#ffd166' : p.stars >= 4 ? '#ff8ec7' : '#4fd6ff'}">
        ${esc(p.name)} <b style="color:#ffd166">${'★'.repeat(p.stars)}</b></div>`).join('');
    open('行政区 · DISTRICT', esc(d.name),
      `行政区划代码 ${esc(d.adcode)} &nbsp;·&nbsp; 面积约 ${fmt(Math.round(d.area))} km²`,
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('区 情 概 览',
        kv('所属', '上海市') + kv('面积', `${fmt(Math.round(d.area))} 平方公里`) +
        kv('地铁站', `${fmt(stN)} 座`) + kv('公交站', `${fmt(busN)} 个`) + kv('收录景点', `${fmt(pois.length)} 处`)) +
      (top5.length ? block('热 门 景 点', `<div class="tags">${tags}</div>`) : `<div class="empty">该区暂无高分收录景点</div>`) +
      foodHTML(d.name) +
      `<div class="note">面积按行政区多边形实际投影计算；站点与景点数量由 OSM 要素空间归属统计。</div>`);
    const c = districtCenter(d);
    attachPhotos(c[0], c[1], d.name, '行政区中心影像');
    attachRealMedia(d.name, c[0], c[1], null);
    pBody.querySelectorAll('[data-poi]').forEach(el => el.onclick = () => { const p = data.attractions.pois.find(x => x.name === el.dataset.poi); if (p) showPOI(p); });
  }
  function districtCenter(d) {
    let sx = 0, sz = 0, n = 0;
    for (const poly of d.polys) { if (poly.hole) continue; for (let i = 0; i < poly.p.length; i += 2) { sx += poly.p[i]; sz += poly.p[i + 1]; n++; } }
    return n ? unproj(sx / n, sz / n) : [LON0, LAT0];
  }
  function inDistrict(x, z, d) {
    for (const poly of d.polys) { if (poly.hole) continue; if (pointIn(x, z, poly.p)) return true; }
    return false;
  }
  function pointIn(x, z, flat) {
    let inside = false; const n = flat.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = flat[i * 2], zi = flat[i * 2 + 1], xj = flat[j * 2], zj = flat[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }

  /* 由站点名确定性派生地铁口信息 (OSM 未含出入口, 仅作示意) */
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function genExits(st) {
    const dirs = ['东北', '东南', '西南', '西北', '正东', '正南', '正北'];
    const roads = ['南京东路', '世纪大道', '中山北路', '虹桥路', '四川北路', '江苏路', '肇嘉浜路', '浦东大道', '控江路', '宜山路', '长寿路', '曲阳路', '大连路', '西藏南路'];
    const n = Math.max(2, Math.min(6, 1 + st.lines.length + (hashStr(st.name) % 2)));
    const ex = []; let seed = hashStr(st.name); const used = new Set();
    for (let i = 0; i < n; i++) {
      let d;
      do { seed = (seed * 9301 + 49297) % 233280; d = dirs[seed % dirs.length]; } while (used.has(d));
      used.add(d);
      seed = (seed * 9301 + 49297) % 233280;
      const r = roads[seed % roads.length];
      ex.push({ no: (i + 1) + '号口', dir: d, road: r });
    }
    return ex;
  }

  function showMetroStation(st) {
    const lines = st.lines.map(r => data.metro.lines.find(l => l.ref === r)).filter(Boolean);
    const tags = lines.map(l =>
      `<div class="tag" data-line="${esc(l.ref)}" style="background:${esc(l.color)}22;border-color:${esc(l.color)};color:${esc(l.color)}">${esc(l.name)}</div>`).join('');
    const [lon, lat] = unproj(st.x, st.z);
    const exits = genExits(st);
    const exitHTML = exits.map(e => kv(e.no, e.dir + ' · ' + e.road)).join('');
    open('地铁站 · METRO', esc(st.name),
      `${st.lines.length} 条线路换乘 · ${esc(lines.map(l => l.op).find(Boolean) || '上海地铁')}`,
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('途 经 线 路', `<div class="tags">${tags}</div>`) +
      block('地 铁 口 · 出 入 口', exitHTML + `<div class="note">出入口信息由站点名确定性派生，仅作示意；实际位置与编号以车站现场导向标识为准。</div>`) +
      block('车 站 信 息', kv('线路数', `${st.lines.length} 条`) + kv('线路编号', st.lines.join(' / ')) + kv('坐标', `${lat.toFixed(5)}, ${lon.toFixed(5)}`)) +
      `<div class="note">点击上方线路标签可展开该线路完整站点序列与运营信息。</div>`);
    attachPhotos(lon, lat, st.name + ' 站', '地铁站周边影像');
    attachRealMedia(st.name, lon, lat, null);
    pBody.querySelectorAll('[data-line]').forEach(el => el.onclick = () => { const l = data.metro.lines.find(x => x.ref === el.dataset.line); if (l) showMetroLine(l, st.name); });
    ctx.onSelectLine && ctx.onSelectLine(null);
  }

  function showMetroLine(line, curName) {
    const sts = line.stations || [];
    // 检测换乘站: 同时出现在其他线路的站名
    const xferSet = new Set();
    if (data.metro.lines) {
      const nameCount = new Map();
      data.metro.lines.forEach(l => (l.stations || []).forEach(s => nameCount.set(s.name, (nameCount.get(s.name) || 0) + 1)));
      sts.forEach(s => { if ((nameCount.get(s.name) || 0) > 1) xferSet.add(s.name); });
    }
    const list = sts.map((s, i) => {
      const isStart = i === 0;
      const isEnd = i === sts.length - 1;
      const isTerm = isStart || isEnd;
      const isXfer = xferSet.has(s.name);
      const cls = ['sti', s.name === curName ? 'cur' : '', isXfer ? 'xfer' : '', isTerm ? 'term' : ''].filter(Boolean).join(' ');
      const termLabel = isStart ? '起' : (isEnd ? '终' : '');
      const tip = [s.name, isXfer && '换乘站', isTerm && (isStart ? '起讫站' : '终点站')].filter(Boolean).join(' · ');
      // 左侧 3px 粗条颜色 = 当前线路色; 卡片底色柔和
      return `<div class="${cls}" data-st="${i}" data-term="${termLabel}"
        style="--c:${esc(line.color)}" title="${esc(tip)}">
        <u>${(i + 1).toString().padStart(2, '0')}</u>
        <span class="stn-name">${esc(s.name)}</span>
      </div>`;
    }).join('');
    const from = sts.length ? sts[0].name : '';
    const to = sts.length ? sts[sts.length - 1].name : '';
    open('地铁线路 · LINE', esc(line.name), `<span style="color:${esc(line.color)};font-weight:700">●</span> ${esc(line.ref || '?')} 号线 · ${esc(from)} ⇄ ${esc(to)}`,
      block('线 路 信 息',
        kv('线路编号', esc(line.ref)) + kv('站点数', `${sts.length} 座`) + kv('换乘站', `${xferSet.size} 座`) + kv('运营方', esc(line.op || '—')) +
        kv('首末班', esc(line.hours || 'OSM 未收录')) + kv('线路色', `<span style="color:${esc(line.color)};font-weight:600">${esc(line.color)}</span>`)) +
      block(`站 点 序 列 · ${sts.length} 站`, `<div class="stlist" style="border-left:3px solid ${esc(line.color)}99;box-shadow:inset 3px 0 8px -3px ${esc(line.color)}55">${list}</div>`) +
      `<div class="note" style="line-height:1.9">站点顺序按线路走向沿轨排序；首末班时间取自 OSM opening_hours 标签；
       <span style="display:inline-block;background:#ff7eb6;color:#fff;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;margin:0 2px">换</span>为可换乘站，
       <span style="display:inline-block;background:#ffd166;color:#0a0e16;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;margin:0 2px">起</span>/<span style="display:inline-block;background:#ffd166;color:#0a0e16;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;margin:0 2px">终</span>为线路起讫站（悬停站点查看完整含义）。</div>`);
    pBody.querySelectorAll('[data-st]').forEach(el => el.onclick = () => { const s = sts[+el.dataset.st]; const full = (data.metro.stations || []).find(x => x.name === s.name); if (full) showMetroStation(full); });
    ctx.onSelectLine && ctx.onSelectLine(line.ref);
  }

  function showBusStop(stop, index) {
    const routes = ctx.transit.busRoutesOf(index) || [];
    const uniq = []; const seen = new Set();
    for (const r of routes) { if (seen.has(r.name)) continue; seen.add(r.name); uniq.push(r); }
    uniq.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const tags = uniq.slice(0, 60).map((r, i) => `<div class="tag" data-bus="${i}">${esc(r.name)}</div>`).join('');
    const [lon, lat] = unproj(stop.x, stop.z);
    open('公交站点 · BUS STOP', esc(stop.name), `${uniq.length} 条线路经停`,
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('经 停 线 路', uniq.length ? `<div class="tags">${tags}</div>` : `<div class="empty">该站点暂无线路数据</div>`) +
      block('站 点 信 息', kv('OSM ID', esc(stop.id)) + kv('坐标', `${lat.toFixed(5)}, ${lon.toFixed(5)}`)) +
      `<div class="note">点击线路标签可在场景中绘制该线路走向与起终点。</div>`);
    attachPhotos(lon, lat, stop.name, '公交站周边影像');
    attachRealMedia(stop.name, lon, lat, null);
    pBody.querySelectorAll('[data-bus]').forEach(el => el.onclick = () => { const r = uniq[+el.dataset.bus]; showBusLine(r, stop.name); });
  }

  function showBusLine(line, curName) {
    const stops = (line.s || []).map(i => ctx.data.bus.stops[i]).filter(Boolean);
    const list = stops.map((s, i) => `<div class="sti${s.name === curName ? ' cur' : ''}"><u>${i + 1}</u><span>${esc(s.name)}</span></div>`).join('');
    open('公交线路 · BUS LINE', esc(line.name),
      `${esc(line.from || (stops[0] && stops[0].name) || '—')} → ${esc(line.to || (stops.length ? stops[stops.length - 1].name : '—'))}`,
      block('线 路 信 息',
        kv('路号', esc(line.ref || '—')) + kv('站点数', `${stops.length} 站`) + kv('运营方', esc(line.op || '—')) + kv('首末班', esc(line.hours || 'OSM 未收录'))) +
      block(`站 点 序 列 · ${stops.length} 站`, `<div class="stlist">${list}</div>`));
    ctx.transit.showBusRoute(line);
  }

  const KIND_MAP = {
    attraction: '景点', museum: '博物馆', artwork: '艺术装置', gallery: '美术馆', viewpoint: '观景点', theme_park: '主题乐园', zoo: '动物园', nature_reserve: '自然保护区',
    park: '公园', monument: '纪念碑', memorial: '纪念地', landmark: '地标', apartments: '历史建筑', building: '建筑', statue: '雕塑', palace: '宫殿',
    place_of_worship: '宗教场所', theatre: '剧场', cinema: '影院', arts_centre: '艺术中心', archaeological_site: '考古遗址', historic: '历史遗迹', ruins: '遗址', castle: '城堡',
    communications_tower: '广播电视塔', tower: '塔', hotel: '酒店', resort: '度假区', water_park: '水上乐园', garden: '园林', observatory: '天文台', sports_centre: '体育中心',
  };

  function showPOI(p) {
    const br = p.br || [0, 0, 0, 0, 0];
    const bars = DIM_META.map((m, i) =>
      `<div class="bar-row"><i>${m[0]}</i><div class="bar-bg"><em style="width:${Math.min(100, (br[i] / m[1]) * 100).toFixed(1)}%"></em></div><u>${br[i]} / ${m[1]}</u></div>`).join('');
    const feeTxt = p.fee === 'yes' ? '<span style="color:#ffd166">收费</span>' : p.fee === 'no' ? '<span style="color:#5ef2a0">免费</span>' : '<span style="color:#7b93b4">OSM 未收录</span>';
    const model = ctx.modelOf ? ctx.modelOf(p.name) : null;
    open('网红景点 · SPOT', esc(p.name), p.en ? esc(p.en) : (KIND_MAP[p.kind] || esc(p.kind || '景点')),
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('推 荐 指 数',
        `<div class="score"><b>${p.score}</b><span>/ 100</span><span class="stars">${'★'.repeat(p.stars)}${'☆'.repeat(5 - p.stars)}</span></div><div class="bars">${bars}</div>`) +
      block('基 本 信 息',
        kv('类别', esc(KIND_MAP[p.kind] || p.kind || '—')) + kv('所在区', esc(p.dist || '—')) +
        (model ? kv('三维建模', `<span style="color:#5ef2a0">已建模 · ${esc(model)}</span>`) : '') +
        kv('最近地铁', p.near ? `${esc(p.near)} · ${p.nearD} m` : '—') +
        kv('周边 500m', `地铁 ${p.metro} 座 / 公交 ${p.bus} 个`) + kv('门票', feeTxt) +
        kv('开放时间', esc(p.hours || 'OSM 未收录')) + (p.addr ? kv('地址', esc(p.addr)) : '') +
        (p.peak ? kv('周边最高建筑', `${p.peak} m`) : '') + kv('坐标', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`) +
        (p.wiki ? kv('维基收录', esc(p.wiki)) : '') + (p.web ? kv('官网', `<a href="${esc(p.web)}" target="_blank" rel="noopener" style="color:#4fd6ff">访问</a>`) : '')) +
      (p.desc ? block('简 介', `<div class="desc">${esc(p.desc)}</div>`) : '') +
      foodHTML(p.dist || '其它') +
      `<div class="note"><b style="color:#9fd8ff">推荐指数量化口径</b><br>交通 = 500m 内地铁站数 + 300m 内公交站数；热度 = 1km 内其它景点数量的对数；知名 = 地铁直达性 + 大型乐园加成 + Wikidata/多语言名/官网等结构化收录证据；文化 = 文保与历史建筑身份；尺度 = 周边 250m 内最高建筑相对上海中心(632m)的比值。全部由 OSM 公开数据实时计算，不含主观打分。</div>`);
    attachPhotos(p.lon, p.lat, p.name, KIND_MAP[p.kind] || p.kind || '景点');
    attachRealMedia(p.name, p.lon, p.lat, p);
  }

  function showLandmark(lm) {
    const p = findPOI(lm.name);
    if (p) return showPOI(p);
    const g = (ctx.landmarks || []).find(x => x.name === lm.name);
    open('地标精模 · LANDMARK', esc(lm.name), esc(lm.sub || ''),
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('地 标 信 息',
        kv('名称', esc(lm.name)) + kv('性质', esc(lm.sub || '—')) +
        (g && g.dist ? kv('所在区', esc(g.dist)) : '') + (g && g.cat ? kv('所属片区', esc(g.cat)) : '') +
        kv('坐标', `${lm.lat.toFixed(5)}, ${lm.lon.toFixed(5)}`)) +
      foodHTML(g && g.dist ? g.dist : '其它') +
      `<div class="note">该地标按真实经纬度 (WGS-84) 单独精细建模，所在范围内的 OSM 粗体块已自动让位。上方实景影像为当下在线卫星瓦片实时拼接，真实照片来自维基共享资源。</div>`);
    attachPhotos(lm.lon, lm.lat, lm.name, lm.sub || '地标');
    attachRealMedia(lm.name, lm.lon, lm.lat, null);
  }

  function showTerminal(t, kind) {
    const isCruise = kind === 'cruiseTerminal';
    const [lon, lat] = unproj(t.x, t.z);
    open(isCruise ? '邮轮 / 客运港 · CRUISE' : '轮渡码头 · FERRY', esc(t.name), esc(t.op || (isCruise ? '水上客运' : '黄浦江轮渡')),
      photoBlockHTML() + realPhotoHTML() + introHTML() +
      block('码 头 信 息',
        kv('类型', isCruise ? '邮轮 / 客运港' : '轮渡码头') + kv('设施', esc(t.kind || '—')) +
        kv('运营方', esc(t.op || '—')) + kv('坐标', `${lat.toFixed(5)}, ${lon.toFixed(5)}`)) +
      `<div class="note">黄浦江轮渡为上海公共交通体系的组成部分，部分航线允许行人、自行车与电动车过江。</div>`);
    attachPhotos(lon, lat, t.name, isCruise ? '客运港影像' : '轮渡码头影像');
    attachRealMedia(t.name, lon, lat, null);
  }

  function setLayer(name, on) {
    const el = lyrList.querySelector(`[data-layer-name="${name}"]`);
    const def = layers.find(l => l.name === name);
    if (!el || !def) return;
    if (def.on === on) return;
    def.on = on;
    el.classList.toggle('on', on);
    def.set(on);
  }
  function getLayer(name) { return layers.find(l => l.name === name); }

  return {
    open, close, showDistrict, showMetroStation, showMetroLine,
    showBusStop, showBusLine, showPOI, showTerminal, showLandmark,
    openLightbox: openLB, setLayer, getLayer,
  };
}
