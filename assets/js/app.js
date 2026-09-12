/* ============================================================
   门户主逻辑：地图查询 / 变更办理 / 审核核界 / 版本追溯 / 乡镇统计
   ============================================================ */
(function () {
  'use strict';
  const G = QX.geo;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- 岗位 ---------------- */
  const ROLES = {
    reviewer: { name: '周建辉', dept: '县不动产登记中心 · 审核岗', avatar: '审', canReview: true,  canApply: false },
    clerk:    { name: '李文娟', dept: '龙泉镇审批办 · 经办岗', avatar: '办', canReview: false, canApply: true },
    patrol:   { name: '王志强', dept: '自然资源所 · 巡查岗', avatar: '巡', canReview: false, canApply: false },
  };
  const CHANGE_TYPES = [
    { key: '分户', icon: '🏠', desc: '一宗拆分为多宗<br>分别登记发证', geometric: true },
    { key: '继承', icon: '📜', desc: '权利人过世<br>界址房屋不变', geometric: false },
    { key: '翻建', icon: '🧱', desc: '拆除旧房原址<br>（或移位）新建', geometric: true },
    { key: '拆除', icon: '🚧', desc: '注销房屋所有权<br>宅基地使用权保留', geometric: true },
  ];
  const SOURCE_OPTIONS = ['农户申请', '继承公证书', '人民法院 / 公证机构法律文书', '乡镇人民政府批准文件', '村民委员会证明', '权籍调查核实'];
  const MAT_KEYS = ['zhengshu', 'quanji', 'qianzhang', 'pizhun', 'gongzheng', 'jianding', 'silin', 'chaichu', 'cunzheng', 'fayuan'];
  const REQ_DOCS = { 分户: ['cunzheng'], 继承: ['gongzheng'], 翻建: ['jianding', 'pizhun'], 拆除: ['cunzheng'] };

  const state = {
    role: 'reviewer',
    selected: null,
    results: [],
    appFilter: '',
    wiz: null,            // 进行中的向导 {app, step, scope}
    reviewId: null,
    trace: null,          // {code, ver}
    drawing: null,
    cmpMode: 'split',
  };

  /* ================= 地图初始化 ================= */
  const map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: .5 });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  map.createPane('afterPane');
  map.getPane('afterPane').style.zIndex = 450;
  map.getPane('afterPane').style.pointerEvents = 'none';

  const lgBase = L.layerGroup().addTo(map);       // 村界、道路、农田
  const lgFarm = L.layerGroup().addTo(map);
  const lgParcels = L.layerGroup().addTo(map);
  const lgBuildings = L.layerGroup().addTo(map);
  const lgHistory = L.layerGroup();
  const lgChange = L.layerGroup().addTo(map);
  const lgScopeLabels = L.layerGroup().addTo(map);
  const lgLabels = L.layerGroup().addTo(map);
  const lgAfter = L.layerGroup([], { pane: 'afterPane' }).addTo(map);
  const parcelLayers = {};

  initBase();
  renderParcels();
  renderBuildings();
  renderHistoryFootprints();
  renderChangeLayers();
  // 初始视野落在龙泉镇龙山村（在办变更最集中的片区）
  const home = QX.villages.find(v => v.name === '龙山村');
  map.fitBounds(L.latLngBounds(G.rectPoly(home.rect)).pad(0.12));
  map.on('zoomend', updateLabelZoom);
  updateLabelZoom();

  function updateLabelZoom() {
    if (map.getZoom() >= 15.8) lgScopeLabels.addTo(map); else lgScopeLabels.remove();
  }

  function initBase() {
    // 行政村面
    QX.villages.forEach(v => {
      L.polygon(G.rectPoly(v.rect), {
        color: '#9fb0c6', weight: 1.2, dashArray: '4 4', fillColor: '#f3f6fa', fillOpacity: .9, interactive: false,
      }).addTo(lgBase);
    });
    // 道路
    QX.roads.forEach(r => {
      L.polyline(r.pts, {
        color: r.major ? '#b9c2cf' : '#d2d9e2', weight: r.major ? 4.5 : 2.6,
        opacity: .9, interactive: false,
      }).addTo(lgBase);
    });
    // 基本农田
    QX.farmlands.forEach(f => {
      L.polygon(G.rectPoly(f.rect), {
        color: '#1baf7a', weight: 1.3, dashArray: '5 4', fillColor: '#1baf7a', fillOpacity: .08, interactive: false,
      }).bindTooltip(f.name, { sticky: true, className: 'farm-tip' }).addTo(lgFarm);
    });
    // 地名注记
    const townLabelPts = {};
    QX.villages.forEach(v => {
      const [lat, lng] = G.P(v.x, v.y + v.h / 2 - 14);
      L.marker([lat, lng], {
        icon: L.divIcon({ className: '', iconSize: [90, 18], iconAnchor: [45, 9],
          html: `<div style="font-size:12px;color:#5a6b82;font-weight:600;letter-spacing:2px;text-shadow:0 0 3px #fff,0 0 3px #fff">${v.name}</div>` }),
        interactive: false,
      }).addTo(lgLabels);
      (townLabelPts[v.town] = townLabelPts[v.town] || []).push(G.P(v.x, v.y - v.h / 2 - 12));
    });
    QX.towns.forEach(t => {
      L.marker(G.P(t.center[0], t.center[1]), {
        icon: L.divIcon({ className: '', iconSize: [120, 20], iconAnchor: [60, 10],
          html: `<div style="font-size:14px;color:#33475f;font-weight:700;letter-spacing:4px;opacity:.75;text-shadow:0 0 4px #f2f4f8">【${t.name}】</div>` }),
        interactive: false,
      }).addTo(lgLabels);
    });
  }

  function parcelStyle(p) {
    const active = activeApps(p.code).length > 0;
    if (p.status === 'disputed')
      return { color: '#d03b3b', weight: 2, dashArray: null, fillColor: '#d03b3b', fillOpacity: .10 };
    if (p.status === 'demolished')
      return { color: '#9aa2af', weight: 1.4, dashArray: '6 4', fillColor: '#9aa2af', fillOpacity: .08 };
    if (p.status === 'replaced')
      return { color: '#9aa2af', weight: 1.2, dashArray: '2 3', fillColor: '#9aa2af', fillOpacity: .05 };
    if (active)
      return { color: '#1c5cab', weight: 2, dashArray: '7 5', fillColor: '#2a78d6', fillOpacity: .12 };
    return { color: '#2a78d6', weight: 1.4, dashArray: null, fillColor: '#2a78d6', fillOpacity: .07 };
  }

  function renderParcels() {
    lgParcels.clearLayers();
    Object.keys(parcelLayers).forEach(k => delete parcelLayers[k]);
    QX.parcels.forEach(p => {
      const s = parcelStyle(p);
      const layer = L.polygon(G.rectPoly(p.rect), s);
      layer.bindTooltip(`${p.code} · ${p.owner}`, { sticky: true });
      layer.on('click', (e) => {
        if (state.drawing) return; // 绘制状态下放行给地图，不拦截点
        L.DomEvent.stopPropagation(e);
        selectParcel(p.code);
      });
      layer.addTo(lgParcels);
      parcelLayers[p.code] = layer;
    });
  }

  function renderBuildings(traceOnly) {
    lgBuildings.clearLayers();
    if (traceOnly) return;
    QX.parcels.forEach(p => {
      if (p.status === 'replaced') return;
      p.houses.forEach(h => {
        if (h.status === 'demolished') return;
        L.rectangle(rectBounds(h.rect), bldStyle(h))
          .bindTooltip(`${p.code}-F｜${h.structure} ${h.floors} 层`, { sticky: true }).addTo(lgBuildings);
      });
    });
  }
  function rectBounds(r) {
    const pts = G.rectPoly(r);
    return L.latLngBounds(pts);
  }
  function bldStyle(h) {
    return { color: '#c9501f', weight: 1, fillColor: '#eb6834', fillOpacity: .5, interactive: true };
  }

  function renderHistoryFootprints() {
    lgHistory.clearLayers();
    QX.parcels.forEach(p => {
      if (p.versions.length < 2) return;
      const v1 = p.versions[0];
      (v1.snapshot.houses || []).forEach(h => {
        L.rectangle(rectBounds(h.rect), {
          color: '#8a93a0', weight: 1.2, dashArray: '4 3', fill: false, interactive: false,
        }).bindTooltip(`${p.code} 历史房屋轮廓（${v1.date}）`, { sticky: true }).addTo(lgHistory);
      });
    });
  }

  /* 变更范围图层（在办申请 + 向导预览） */
  function renderChangeLayers() {
    lgChange.clearLayers();
    lgScopeLabels.clearLayers();
    QX.applications.forEach(a => {
      if (a.status === '已办结' || !a.scope) return;
      drawScope(a.scope, { opacity: .75, showLabels: true, app: a });
    });
    if (state.wiz && state.wiz.scope) {
      drawScope(state.wiz.scope, { opacity: .95, showLabels: true, preview: true });
    }
  }
  function drawScope(scope, opt) {
    const kinds = [
      ['add', '#2a78d6', .24, '新增'],
      ['adjust', '#eb6834', .24, '调整'],
      ['cancel', '#d03b3b', .18, '注销'],
    ];
    kinds.forEach(([k, color, fill, label]) => {
      (scope[k] || []).forEach((pts, i) => {
        const latlngs = pts.map(q => G.P(q[0], q[1]));
        const poly = L.polygon(latlngs, {
          color, weight: opt.preview ? 2.2 : 1.6, dashArray: k === 'cancel' ? '5 3' : null,
          fillColor: color, fillOpacity: fill, interactive: !!opt.app,
        });
        if (opt.app) poly.bindTooltip(`${opt.app.id} ${label}范围`, { sticky: true });
        poly.addTo(lgChange);
        const name = scope.labels && scope.labels[scopeLabelIndex(scope, k, i)];
        if (opt.showLabels && name) {
          const c = G.bbox(pts);
          L.marker(G.P(c.x, c.y), {
            icon: L.divIcon({ className: '', iconSize: [110, 16], iconAnchor: [55, 8],
              html: `<div style="font-size:10.5px;color:${color};font-weight:700;text-align:center;text-shadow:0 0 3px #fff,0 0 3px #fff">${name}</div>` }),
            interactive: false,
          }).addTo(lgScopeLabels);
        }
      });
    });
  }
  function scopeLabelIndex(scope, kind, i) {
    let n = 0;
    for (const k of ['add', 'adjust', 'cancel']) {
      const len = (scope[k] || []).length;
      if (k === kind) return n + i;
      n += len;
    }
    return 0;
  }

  function flyToParcel(code) {
    const layer = parcelLayers[code];
    if (layer) map.flyToBounds(layer.getBounds().pad(.35), { duration: .5 });
  }
  function highlightParcel(code) {
    Object.entries(parcelLayers).forEach(([c, l]) => {
      if (c === code) { l.setStyle({ weight: 3, color: '#0f2f56' }); l.bringToFront(); }
      else l.setStyle(parcelStyle(QX.byCode(c)));
    });
  }

  /* ================= 业务工具 ================= */
  function activeApps(code) { return QX.applications.filter(a => a.parcelCode === code && a.status !== '已办结'); }
  function pendingApps() { return QX.applications.filter(a => a.status !== '已办结'); }
  function tagFor(st) { return ({
    '已办结': ['tag-ok', '✓ 已办结'], '待审核': ['tag-run', '待审核'], '审核中': ['tag-warn', '审核中'],
    '待补正': ['tag-crit', '退回待补正'],
  }[st] || ['tag-gray', st]); }

  /* ---------------- 自动核界检查 ---------------- */
  function runChecks(a) {
    const p = QX.byCode(a.parcelCode);
    const out = [];
    const has = key => (a.docs || []).some(d => d === QX.materials[key]);

    if (!a.geometric) {
      out.push(p.status === 'disputed'
        ? { lv: 'bad', title: '争议核查', desc: '该宗地存在未化解权属争议，争议调处结论未入库，暂缓办理。' }
        : { lv: 'ok', title: '争议核查', desc: '宗地无未化解争议记录。' });
      out.push(has('gongzheng')
        ? { lv: 'ok', title: '继承材料', desc: '已附继承公证书，权属来源清晰。' }
        : { lv: 'bad', title: '继承材料', desc: '缺少继承公证书或生效法律文书。' });
      out.push({ lv: 'ok', title: '界址房屋', desc: '继承登记不改变宗地界址、面积及房屋现状，无需图形变更。' });
      return out;
    }

    const sc = a.scope || { add: [], adjust: [], cancel: [] };
    const changePolys = [].concat(sc.add || [], sc.adjust || []);

    /* 1. 越界检查 */
    let outsideArea = 0; const outsideParts = [];
    changePolys.forEach(poly => {
      const inside = G.clipPolyRect(poly, p.rect);
      const outPart = poly; // 外溢部分用总面积-内部面积近似（演示核界）
      const aAll = G.polyArea(poly), aIn = G.polyArea(inside);
      const d = Math.max(0, aAll - aIn);
      if (d > .4) { outsideArea += d; outsideParts.push({ area: d }); }
    });
    /* 2. 基本农田压占 + 相邻宗地 */
    let farmHit = null, neighborHit = null, nearWarn = null;
    for (const poly of changePolys) {
      const pb = G.bbox(poly);
      for (const f of QX.farmlands) {
        if (!G.rectsOverlap(pb, f.rect)) continue;
        const clipped = G.clipPolyRect(poly, f.rect);
        const ar = G.polyArea(clipped);
        if (ar > .4) { farmHit = { name: f.name, area: ar }; }
      }
      for (const n of QX.parcels) {
        if (n.code === p.code || n.status === 'replaced') continue;
        const clipped = G.clipPolyRect(poly, n.rect);
        if (G.polyArea(clipped) > .4) { neighborHit = n; break; }
        const expanded = { x: n.rect.x, y: n.rect.y, w: n.rect.w + 3, h: n.rect.h + 3 };
        if (!nearWarn && G.polyArea(G.clipPolyRect(poly, expanded)) > .4) nearWarn = n;
      }
      if (neighborHit) break;
    }

    if (farmHit) out.push({ lv: 'bad', title: '永久基本农田压占', desc: `变更范围压占 ${farmHit.name}，重叠约 ${farmHit.area.toFixed(1)} ㎡，触碰耕地保护红线，须重新放线。` });
    if (neighborHit) out.push({ lv: 'bad', title: '相邻宗地核查', desc: `变更范围压占相邻宗地 ${neighborHit.code}（${neighborHit.owner}），未经相邻权利人确认。` });
    else if (nearWarn) out.push({ lv: 'warn', title: '相邻间距核查', desc: `与相邻宗地 ${nearWarn.code}（${nearWarn.owner}）间距偏小，应核四邻意见并现场确认间距、排水。` });
    else out.push({ lv: 'ok', title: '相邻宗地核查', desc: '变更范围未压占相邻宗地，四至关系清楚。' });

    if (outsideArea > .4) out.push({ lv: 'bad', title: '界址越界检查', desc: `新增/调整范围超出原确权宗地界址约 ${outsideArea.toFixed(1)} ㎡，超出宅基地批准范围。` });
    else out.push({ lv: 'ok', title: '界址越界检查', desc: '新增、调整范围均落在原宗地界址以内。' });
    if (farmHit) out.push({ lv: 'bad', title: '耕地用途管制', desc: '该范围不符合“建新房不占耕地”要求，不得通过。' });

    /* 3. 房屋拆旧覆盖 */
    if (a.type === '翻建' || a.type === '拆除') {
      const cancels = sc.cancel || [];
      const covered = p.houses.some(h => h.status !== 'demolished' && cancels.some(c => G.rectsOverlap(G.bbox(c), h.rect)));
      if (cancels.length === 0) out.push({ lv: 'warn', title: '拆旧范围', desc: '未标绘拟拆除房屋轮廓，请补充注销范围。' });
      else if (covered) out.push({ lv: 'ok', title: '拆旧范围', desc: '注销范围覆盖原登记房屋轮廓，拆旧对应关系一致。' });
      else out.push({ lv: 'warn', title: '拆旧范围', desc: '注销范围与登记房屋轮廓未完全对应，需现场核实。' });
    }

    /* 4. 材料完整性 */
    const missing = (REQ_DOCS[a.type] || []).filter(k => !has(k));
    if (a.type === '翻建' && nearWarn && !has('silin') && !has('qianzhang'))
      out.push({ lv: 'warn', title: '四邻意见', desc: '存在相邻间距风险但未见四邻签字 / 界址签章材料。' });
    if (missing.length)
      out.push({ lv: 'bad', title: '申请材料完整性', desc: '缺少：' + missing.map(k => QX.materials[k].name).join('、') + '，应退回补正后再审核。' });
    else
      out.push({ lv: 'ok', title: '申请材料完整性', desc: '该变更类型所需申请来源及附件齐全。' });

    /* 5. 争议 */
    out.push(p.status === 'disputed'
      ? { lv: 'bad', title: '争议宗地核查', desc: '宗地处于争议状态：' + p.dispute }
      : { lv: 'ok', title: '争议宗地核查', desc: '非争议宗地，无未决权属纠纷记录。' });

    return out;
  }

  /* ================= 左栏：查询 ================= */
  function fillSearchOptions() {
    const gSel = $('#qGroup');
    if (gSel.options.length > 1) return; // 已填充（分宗新增同村组，不重复追加）
    const tSel = $('#qTown');
    QX.towns.forEach(t => tSel.appendChild(el(`<option value="${t.name}">${t.name}</option>`)));
    const seen = new Set();
    QX.parcels.slice().sort((a, b) => a.code.localeCompare(b.code)).forEach(p => {
      const v = `${p.village}|${p.group}`;
      if (seen.has(v)) return; seen.add(v);
      gSel.appendChild(el(`<option value="${v}">${p.village} · ${p.group}</option>`));
    });
  }
  function doSearch() {
    const town = $('#qTown').value, group = $('#qGroup').value, code = $('#qParcel').value.trim().toUpperCase(), owner = $('#qOwner').value.trim();
    state.results = QX.parcels.filter(p => {
      if (town && p.town !== town) return false;
      if (group) { const [v, g] = group.split('|'); if (p.village !== v || p.group !== g) return false; }
      if (code && !p.code.toUpperCase().includes(code)) return false;
      if (owner && !p.owner.includes(owner)) return false;
      return true;
    });
    renderResultList();
  }
  function resetSearch() {
    $('#qTown').value = ''; $('#qGroup').value = ''; $('#qParcel').value = ''; $('#qOwner').value = '';
    state.results = QX.parcels.slice();
    renderResultList();
  }
  function renderResultList() {
    const box = $('#resultList');
    $('#resultCount').textContent = `共 ${state.results.length} 宗`;
    box.innerHTML = '';
    state.results.forEach(p => {
      const apps = activeApps(p.code);
      const tags = [];
      if (p.status === 'disputed') tags.push('<span class="tag tag-crit">争议</span>');
      if (p.status === 'demolished') tags.push('<span class="tag tag-gray">房屋已拆除</span>');
      if (p.status === 'replaced') tags.push('<span class="tag tag-gray">已分宗</span>');
      if (apps.length) tags.push(`<span class="tag tag-run">${esc(apps[0].status)}</span>`);
      const item = el(`
        <div class="list-item ${state.selected === p.code ? 'sel' : ''}">
          <div class="li-top"><span class="li-id">${p.code}</span>${tags.join('')}</div>
          <div class="li-sub"><span>${esc(p.owner)}</span><span>${p.town} · ${p.village} · ${p.group}</span></div>
          <div class="li-foot"><span class="li-area">宗地 ${p.area} ㎡ · 房屋 ${p.houses.length} 幢</span><span class="muted">查看 ›</span></div>
        </div>`);
      item.onclick = () => selectParcel(p.code, true);
      box.appendChild(item);
    });
    if (!state.results.length) box.appendChild(el('<div class="muted" style="padding:18px;text-align:center">未查询到匹配宗地</div>'));
  }

  /* ================= 右栏：档案详情 ================= */
  function selectParcel(code, fly) {
    state.selected = code;
    state.reviewId = null;
    state.wiz = null;
    exitDrawing(false);
    if (fly) flyToParcel(code);
    highlightParcel(code);
    renderArchive();
    renderResultList();
  }

  function renderArchive() {
    const p = QX.byCode(state.selected);
    showRightBody(`
      <div class="rb-head">
        <h3>${p.code} <span style="font-size:11px;font-weight:500">${statusBadge(p)}</span></h3>
        <button class="rb-close" id="rbClose">×</button>
      </div>
      <div id="rbScroll"></div>`);
    const box = $('#rbScroll');

    /* 在办提示 */
    const apps = activeApps(p.code);
    if (apps.length) {
      box.appendChild(el(`<div class="rb-sec" style="background:#f7faff">
        <h4>在办变更 ${apps.length} 件</h4>
        ${apps.map(a => `
          <div class="list-item" data-app="${a.id}" style="margin-bottom:6px">
            <div class="li-top"><span class="li-id">${a.id} · ${a.type}</span><span class="tag ${tagFor(a.status)[0]}">${tagFor(a.status)[1]}</span></div>
            <div class="li-sub"><span>申请人：${esc(a.applicant)}</span><span>${a.submitDate}</span></div>
          </div>`).join('')}
      </div>`));
      box.querySelectorAll('[data-app]').forEach(n => n.onclick = () => openApp(n.dataset.app));
    }

    /* 基本信息 */
    box.appendChild(el(`<div class="rb-sec">
      <h4>确权登记信息</h4>
      <dl class="kv">
        <dt>权利人</dt><dd class="strong">${esc(p.owner)}</dd>
        <dt>宗地编号</dt><dd>${p.code}</dd>
        <dt>坐落</dt><dd>${p.town} ${p.village} ${p.group}</dd>
        <dt>权利类型</dt><dd>${p.rightType}</dd>
        <dt>确权时间</dt><dd>${p.confirmDate}</dd>
        <dt>宗地面积</dt><dd><span class="strong">${p.area}</span> ㎡</dd>
        <dt>权籍调查</dt><dd>${p.surveyOrg}</dd>
        <dt>四至</dt><dd>${esc(p.boundaries)}</dd>
      </dl>
    </div>`));

    /* 争议提示 */
    if (p.dispute) {
      box.appendChild(el(`<div class="rb-sec">
        <h4 style="color:#a82a2a">⚠ 争议情况</h4>
        <div style="font-size:12px;color:#7c2f2f;line-height:1.7">${esc(p.dispute)}</div>
      </div>`));
    }

    /* 房屋 */
    box.appendChild(el(`<div class="rb-sec">
      <h4>房屋轮廓（${p.houses.length} 幢）</h4>
      ${p.houses.length ? p.houses.map(h => `
        <div class="house-card">
          <div class="h-top"><span>${h.id}</span>${h.status === 'demolished' ? '<span class="tag tag-gray">已拆除注销</span>' : ''}</div>
          <div class="house-meta">
            <span>结构：${h.structure}</span><span>${h.floors} 层</span><span>建于 ${h.builtYear} 年</span><span>建筑 ${h.area} ㎡</span>
          </div>
        </div>`).join('') : '<div class="muted" style="font-size:12px">地上房屋已注销 / 详见分层分户图</div>'}
    </div>`));

    /* 材料 */
    box.appendChild(el(`<div class="rb-sec">
      <h4>关联材料（${p.materials.length}）</h4>
      ${p.materials.map((m, i) => `
        <div class="doc-row" data-doc="${i}">
          <div class="doc-ic">PDF</div>
          <div><div class="doc-name">${esc(m.name)}</div><div class="doc-sub">${esc(m.sub)}</div></div>
          <div class="doc-go">查看 ›</div>
        </div>`).join('')}
    </div>`));
    box.querySelectorAll('[data-doc]').forEach(n => n.onclick = () => openDoc(p.materials[+n.dataset.doc]));

    /* 版本 */
    const cur = Math.max(...p.versions.map(v => v.ver));
    box.appendChild(el(`<div class="rb-sec">
      <h4>版本沿革（旧成果可追溯）</h4>
      <div class="timeline">
        ${p.versions.slice().reverse().map(v => `
          <div class="tl-item ${v.ver === cur ? 'cur' : ''}" data-ver="${v.ver}">
            <div class="tl-ver">V${v.ver} · ${v.type} ${v.ver === cur ? '<span class="tag tag-ok">当前版本</span>' : ''}</div>
            <div class="tl-date">${v.date} ｜ ${esc(v.operator)}</div>
            <div class="tl-note">${esc(v.note)}<br><span class="muted">来源：${esc(v.source)}</span></div>
          </div>`).join('')}
      </div>
    </div>`));
    box.querySelectorAll('.tl-item').forEach(n => n.onclick = () => traceVersion(p.code, +n.dataset.ver));

    /* 操作 */
    const role = ROLES[state.role];
    box.appendChild(el(`<div class="rb-sec" style="border-bottom:0">
      <h4>后续业务</h4>
      <button class="btn ${role.canApply ? 'btn-primary' : 'btn-ghost'} btn-block" id="btnStartWiz">
        ${role.canApply ? '发起变更（分户 / 继承 / 翻建 / 拆除）' : '发起变更申请'}
      </button>
      ${role.canReview ? '<p class="hint" style="font-size:11px;color:var(--ink-3);margin-top:7px">审核岗可从左侧「待办审核」进入核界对比。</p>' : ''}
      ${state.role === 'patrol' ? '<p class="hint" style="font-size:11px;color:var(--ink-3);margin-top:7px">查询巡查岗仅开放档案查看与现场比对。</p>' : ''}
    </div>`));
    $('#btnStartWiz').onclick = () => {
      if (!role.canApply) { toast('当前岗位无变更发起权限，请由乡镇经办岗办理', 'warn'); return; }
      startWizard(p);
    };
    $('#rbClose').onclick = closeRight;
  }

  function statusBadge(p) {
    if (p.status === 'disputed') return '<span class="tag tag-crit">争议宗地</span>';
    if (p.status === 'demolished') return '<span class="tag tag-gray">房屋已拆除</span>';
    if (p.status === 'replaced') return '<span class="tag tag-gray">已分宗（原成果归档）</span>';
    if (activeApps(p.code).length) return `<span class="tag tag-run">变更办理中</span>`;
    return '<span class="tag tag-ok">确权成果有效</span>';
  }

  /* ---------------- 版本回溯 ---------------- */
  function traceVersion(code, ver) {
    const p = QX.byCode(code);
    const v = p.versions.find(x => x.ver === ver);
    state.trace = { code, ver };
    lgHistory.remove();      // 回溯时只看目标版本
    renderBuildings(true);
    // 旧宗地界址
    L.polygon(G.rectPoly(p.rect), { color: '#8a93a0', weight: 2, dashArray: '7 5', fill: false, interactive: false }).addTo(lgBuildings);
    (v.snapshot.houses || []).forEach(h => {
      L.rectangle(rectBounds(h.rect), { color: '#8a6a2a', weight: 1.6, dashArray: '4 3', fillColor: '#c9a24f', fillOpacity: .25, interactive: false })
        .bindTooltip(`V${ver} 房屋`, { sticky: true }).addTo(lgBuildings);
    });
    $('#traceText').textContent = `历史回溯：${code} V${ver}（${v.date} · ${v.type}）— 当前显示的是归档旧成果，非现状登记数据`;
    $('#traceBar').hidden = false;
    flyToParcel(code);
    toast(`已切换到 V${ver} 历史成果对比视图`, 'ok');
  }
  function exitTrace() {
    state.trace = null;
    $('#traceBar').hidden = true;
    renderBuildings();
    if ($('input[data-layer="history"]').checked) lgHistory.addTo(map);
  }

  /* ================= 变更向导 ================= */
  function startWizard(p) {
    state.reviewId = null;
    state.wiz = {
      app: {
        id: 'A2026-' + String(28 + QX.applications.filter(a => a.id.startsWith('A2026')).length).padStart(3, '0'),
        parcelCode: p.code, type: '', applicant: p.owner, submitDate: QX.today,
        source: '', sourceDetail: '', docs: [p.materials[0], p.materials[1]],        scope: { add: [], adjust: [], cancel: [] }, geometric: null,
        status: '待审核', opinion: '', isNew: true,
      },
      step: 1,
    };
    renderWizard();
  }

  function renderWizard() {
    const w = state.wiz, a = w.app, p = QX.byCode(a.parcelCode);
    const stepNames = ['变更类型', '地图标绘', '提交审核'];
    showRightBody(`
      <div class="rb-head"><h3>变更申请办理 ${a.isNew ? '' : ''} <span class="tag tag-run" style="font-size:10px">草稿</span></h3>
        <button class="rb-close" id="rbClose">×</button></div>
      <div class="wiz-steps">
        ${stepNames.map((n, i) => `
          <div class="wiz-step ${w.step === i + 1 ? 'on' : ''} ${w.step > i + 1 ? 'done' : ''}"><span>${w.step > i + 1 ? '✓' : i + 1}</span>${n}</div>`).join('')}
      </div>
      <div id="wizBody"></div>`);
    const body = $('#wizBody');
    $('#rbClose').onclick = () => { exitDrawing(false); closeRight(); };

    /* ---- Step 1 ---- */
    if (w.step === 1) {
      body.appendChild(el(`<div class="rb-sec">
        <h4>变更宗地</h4>
        <dl class="kv">
          <dt>宗地编号</dt><dd>${p.code}</dd>
          <dt>权利人</dt><dd>${esc(p.owner)}</dd>
          <dt>坐落</dt><dd>${p.town} ${p.village} ${p.group}</dd>
          <dt>确权时间</dt><dd>${p.confirmDate}</dd>
        </dl>
      </div>`));
      const typeBox = el(`<div class="rb-seclist"></div>`);
      body.appendChild(el(`<div class="rb-sec"><h4>① 选择变更类型</h4><div class="change-type-grid" id="ctGrid"></div></div>`));
      const grid = $('#ctGrid');
      CHANGE_TYPES.forEach(t => {
        const c = el(`<div class="ctype ${a.type === t.key ? 'sel' : ''}" data-k="${t.key}">
          <div class="ct-ic">${t.icon}</div><div class="ct-name">${t.key}</div><div class="ct-desc">${t.desc}</div></div>`);
        c.onclick = () => {
          a.type = t.key; a.geometric = t.geometric;
          (REQ_DOCS[t.key] || []).forEach(k => { const m = QX.materials[k]; if (!a.docs.includes(m)) a.docs.push(m); });
          renderWizard();
        };
        grid.appendChild(c);
      });

      if (a.type) {
        body.appendChild(el(`<div class="rb-sec">
          <h4>② 填写申请来源</h4>
          <div class="field"><label>申请人 / 申请主体</label><input id="fApplicant" value="${esc(a.applicant)}"></div>
          <div class="field" style="margin-top:9px"><label>申请来源（必选）</label>
            <select id="fSource">
              <option value="">请选择申请来源…</option>
              ${SOURCE_OPTIONS.map(s => `<option ${a.source === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-top:9px"><label>申请情况说明</label>
            <textarea class="textarea" id="fDetail" placeholder="说明变更事由、家庭/权属关系、拟建设内容…">${esc(a.sourceDetail)}</textarea>
          </div>
          <div class="source-box">系统将把申请来源与后续图形标绘、现场核查意见一并归入该宗地版本档案。</div>
        </div>`));
        body.appendChild(el(`<div class="rb-sec" style="border-bottom:0">
          <h4>③ 随附材料</h4>
          <div id="matList" style="display:grid;grid-template-columns:1fr 1fr;gap:5px 10px"></div>
        </div>`));
        const ml = $('#matList');
        MAT_KEYS.forEach(k => {
          const m = QX.materials[k];
          const checked = a.docs.some(d => d === m);
          const lab = el(`<label style="font-size:11.5px;color:var(--ink-2);display:flex;gap:6px;align-items:flex-start">
            <input type="checkbox" data-k="${k}" ${checked ? 'checked' : ''}><span>${m.name}</span></label>`);
          lab.querySelector('input').onchange = (e) => {
            if (e.target.checked) a.docs.push(m); else a.docs = a.docs.filter(d => d !== m);
          };
          ml.appendChild(lab);
        });

        $('#fApplicant').oninput = e => a.applicant = e.target.value;
        $('#fSource').onchange = e => a.source = e.target.value;
        $('#fDetail').oninput = e => a.sourceDetail = e.target.value;
      }

      body.appendChild(el(`<div class="wiz-foot">
        <button class="btn btn-ghost" id="wizCancel">取消</button>
        <button class="btn btn-primary" id="wizNext" ${a.type ? '' : 'disabled'}>下一步：地图标绘</button>
      </div>`));
      $('#wizCancel').onclick = () => { state.wiz = null; renderArchive(); };
      $('#wizNext').onclick = () => {
        if (!a.source) { toast('请先选择申请来源', 'warn'); return; }
        if (!a.sourceDetail.trim()) { a.sourceDetail = $('#fDetail')?.value || ''; }
        w.step = 2; renderWizard();
      };
      return;
    }

    /* ---- Step 2 ---- */
    if (w.step === 2) {
      const tipMap = {
        分户: '在图上依次标绘分宗后各宗地的界线范围（使用「调整界址」），系统将检查是否超出原宗地。',
        翻建: '用「新增范围」标绘拟建房屋轮廓，用「注销范围」圈定拟拆除旧房；注意不得越过界址、压占农田或邻宗地。',
        拆除: '用「注销范围」圈定拟拆除的房屋轮廓；宗地界址不变，宅基地使用权保留。',
      };
      body.appendChild(el(`<div class="rb-sec">
        <h4>${a.id} · ${a.type}</h4>
        <dl class="kv">
          <dt>申请人</dt><dd>${esc(a.applicant)}</dd>
          <dt>申请来源</dt><dd>${esc(a.source)}</dd>
        </dl>
        <div class="source-box">${tipMap[a.type] || ''}</div>
        ${!a.geometric ? '<div class="source-box" style="border-color:#9fc99f;background:#f5fbf5;margin-top:8px">该变更类型<b>不涉及图形变更</b>：界址、房屋轮廓维持现状，可直接进入下一步提交。</div>' : `
        <div style="margin-top:10px">
          <div style="font-size:11.5px;font-weight:600;color:var(--ink-2);margin-bottom:5px">已标绘范围</div>
          <div id="scopeList"></div>
        </div>`}
      </div>`));

      if (a.geometric) {
        renderScopeList(body.querySelector('#scopeList'));
        if (!w.paused) {
          $('#drawBar').hidden = false;
          $('.map-wrap').classList.add('drawing');
          if (!state.drawing) startDrawing('add');
          setDrawTool(a.type === '分户' ? 'adjust' : 'add');
        } else {
          const resume = el('<button class="btn btn-ghost btn-block" style="margin-top:9px">恢复地图标绘</button>');
          resume.onclick = () => { w.paused = false; renderWizard(); };
          body.querySelector('#scopeList').after(resume);
        }
      }

      body.appendChild(el(`<div class="wiz-foot">
        <button class="btn btn-ghost" id="wizPrev">上一步</button>
        <button class="btn btn-primary" id="wizNext2">下一步：核对提交</button>
      </div>`));
      $('#wizPrev').onclick = () => { exitDrawing(false); w.step = 1; renderWizard(); };
      $('#wizNext2').onclick = () => {
        if (a.geometric) {
          const n = a.scope.add.length + a.scope.adjust.length + a.scope.cancel.length;
          if (!n) { toast('请先在地图上标绘变更范围（至少 1 个多边形）', 'warn'); return; }
        }
        exitDrawing(false); w.step = 3; renderWizard();
      };
      return;
    }

    /* ---- Step 3 ---- */
    const checks = runChecks(a);
    const hardBad = checks.some(c => c.lv === 'bad');
    body.appendChild(el(`<div class="rb-sec">
      <h4>提交前自检（系统预检）</h4>
      ${checks.map(checkHtml).join('')}
      <div class="source-box" style="margin-top:8px">提交后进入登记审核岗待办，审核人员将进行前后图层对比与现场核查，确认后形成新版本。</div>
    </div>`));
    body.appendChild(el(`<div class="rb-sec" style="border-bottom:0">
      <h4>申请摘要</h4>
      <dl class="kv">
        <dt>变更类型</dt><dd class="strong">${a.type}</dd>
        <dt>申请来源</dt><dd>${esc(a.source)}</dd>
        <dt>申请人</dt><dd>${esc(a.applicant)}</dd>
        <dt>图形变更</dt><dd>${a.geometric ? scopeSummaryText(a.scope) : '无（界址房屋不变）'}</dd>
        <dt>材料</dt><dd>${a.docs.map(d => d.name).join('、')}</dd>
      </dl>
    </div>`));
    body.appendChild(el(`<div class="wiz-foot">
      <button class="btn btn-ghost" id="wizPrev">上一步修改</button>
      <button class="btn btn-primary" id="wizSubmit">提交审核</button>
    </div>`));
    $('#wizPrev').onclick = () => { w.step = 2; renderWizard(); };
    $('#wizSubmit').onclick = () => {
      if (hardBad) {
        toast('预检存在硬性问题（越界 / 压占农田 / 材料缺失），请修改后再提交', 'err');
        return;
      }
      delete a.isNew;
      if (!QX.applications.includes(a)) QX.applications.push(a);
      state.wiz = null;
      renderChangeLayers(); renderParcels(); renderLists();
      toast(`${a.id} 已提交至登记审核岗待办，旧成果在审核确认前继续有效`, 'ok');
      switchTab('todo');
      closeRight();
    };
  }

  function renderScopeList(box) {
    if (!box) return;
    const a = state.wiz.app;
    box.innerHTML = '';
    const rows = [['add', '新增范围'], ['adjust', '调整界址'], ['cancel', '注销范围']];
    rows.forEach(([k, label]) => {
      a.scope[k].forEach((pts, i) => {
        const area = G.polyArea(pts);
        const row = el(`<div class="doc-row"><div class="doc-ic" style="background:${k === 'add' ? '#e8f1fc' : k === 'adjust' ? '#fdeee7' : '#fce9e9'}">范</div>
          <div><div class="doc-name">${label} ${i + 1}</div><div class="doc-sub">${pts.length} 个界址点 · ${area.toFixed(1)} ㎡</div></div>
          <button class="btn btn-mini" style="margin-left:auto">删除</button></div>`);
        row.querySelector('button').onclick = () => { a.scope[k].splice(i, 1); a.scope.labels = a.scope.labels || []; renderChangeLayers(); renderScopeList(box); };
        box.appendChild(row);
      });
    });
    if (!box.children.length) box.innerHTML = '<div class="muted" style="font-size:12px;padding:4px 0">暂无，使用地图上方工具条在图上点击标绘</div>';
  }
  function scopeSummaryText(sc) {
    const parts = [];
    if (sc.add.length) parts.push(`新增 ${sc.add.length} 处`);
    if (sc.adjust.length) parts.push(`调整 ${sc.adjust.length} 处`);
    if (sc.cancel.length) parts.push(`注销 ${sc.cancel.length} 处`);
    return parts.join('、') || '无';
  }

  /* ---------------- 地图手绘 ---------------- */
  function startDrawing(tool) {
    state.drawing = { tool, pts: [], tempLayer: null, dotLayer: null };
    map.doubleClickZoom.disable();
    map.on('click', onMapDrawClick);
  }
  function exitDrawing(redraw = true) {
    if (!state.drawing) return;
    clearTemp();
    map.off('click', onMapDrawClick);
    map.doubleClickZoom.enable();
    state.drawing = null;
    $('#drawBar').hidden = true;
    $('.map-wrap').classList.remove('drawing');
    if (redraw) renderChangeLayers();
  }
  function clearTemp() {
    const d = state.drawing;
    if (!d) return;
    if (d.tempLayer) { map.removeLayer(d.tempLayer); d.tempLayer = null; }
    if (d.dotLayer) { map.removeLayer(d.dotLayer); d.dotLayer = null; }
  }
  function setDrawTool(tool) {
    if (!state.drawing) startDrawing(tool);
    state.drawing.tool = tool;
    $$('.draw-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    const tips = { add: '在图上依次点击界址点标绘「新增范围」，点击起点或按「闭合完成」',
      adjust: '在图上依次点击界址点标绘「调整 / 分宗范围」', cancel: '在图上依次点击圈定「注销范围」（拟拆除房屋）' };
    $('#drawTip').textContent = tips[tool];
  }
  function onMapDrawClick(e) {
    const d = state.drawing;
    const m = G.M([e.latlng.lat, e.latlng.lng]);
    if (d.pts.length >= 3) {
      const first = d.pts[0];
      if (Math.hypot(first[0] - m[0], first[1] - m[1]) < 3) { finishPolygon(); return; }
    }
    d.pts.push(m);
    redrawTemp();
  }
  function redrawTemp() {
    const d = state.drawing;
    clearTemp();
    if (!d.pts.length) return;
    const color = { add: '#2a78d6', adjust: '#eb6834', cancel: '#d03b3b' }[d.tool];
    const latlngs = d.pts.map(q => G.P(q[0], q[1]));
    d.tempLayer = L.polyline(latlngs.concat([latlngs[0]]), { color, weight: 2, dashArray: '5 4' }).addTo(map);
    d.dotLayer = L.layerGroup(latlngs.map((q, i) => L.circleMarker(q, {
      radius: i === 0 ? 5 : 3.5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1,
    }))).addTo(map);
  }
  function finishPolygon() {
    const d = state.drawing;
    if (d.pts.length < 3) { toast('至少需要 3 个界址点', 'warn'); return; }
    const a = state.wiz.app;
    a.scope[d.tool].push(d.pts.slice());
    d.pts = [];
    clearTemp();
    renderChangeLayers();
    if (state.wiz && state.wiz.step === 2) {
      const box = document.querySelector('#scopeList');
      if (box) renderScopeList(box);
    }
    toast('范围已闭合，可切换工具继续标绘，或进入下一步', 'ok');
  }

  /* ================= 审核 ================= */
  function openApp(id) {
    const a = QX.applications.find(x => x.id === id);
    const role = ROLES[state.role];
    state.selected = a.parcelCode;
    state.reviewId = id;
    state.wiz = null;
    exitDrawing(false);
    highlightParcel(a.parcelCode);
    flyToParcel(a.parcelCode);
    renderReview(a, role);
  }

  function checkHtml(c) {
    const ic = c.lv === 'ok' ? '✅' : c.lv === 'warn' ? '⚠️' : '⛔';
    const res = c.lv === 'ok' ? '<span class="check-result pass">通过</span>'
      : c.lv === 'warn' ? '<span class="check-result review">需核实</span>'
      : '<span class="check-result fail">不通过</span>';
    return `<div class="check-item ${c.lv}"><span class="ck-ic">${ic}</span>
      <div class="ck-body"><div class="ck-title">${c.title}</div><div class="ck-desc">${c.desc}</div></div>${res}</div>`;
  }

  function renderReview(a, role) {
    const p = QX.byCode(a.parcelCode);
    const checks = runChecks(a);
    const hardBad = checks.some(c => c.lv === 'bad');
    showRightBody(`
      <div class="rb-head">
        <h3>${a.id} · ${a.type} <span class="tag ${tagFor(a.status)[0]}">${tagFor(a.status)[1]}</span></h3>
        <button class="rb-close" id="rbClose">×</button>
      </div>
      <div id="rbScroll"></div>`);
    const box = $('#rbScroll');
    box.appendChild(el(`<div class="rb-sec">
      <h4>申请信息</h4>
      <dl class="kv">
        <dt>宗地编号</dt><dd>${p.code}（${p.town} ${p.village} ${p.group}）</dd>
        <dt>现权利人</dt><dd>${esc(p.owner)}</dd>
        <dt>申请人</dt><dd class="strong">${esc(a.applicant)}</dd>
        <dt>申请来源</dt><dd>${esc(a.source)}</dd>
        <dt>受理日期</dt><dd>${a.submitDate}</dd>
        <dt>情况说明</dt><dd>${esc(a.sourceDetail)}</dd>
      </dl>
      <div style="margin-top:8px">${a.docs.map((m, i) => `
        <div class="doc-row" data-doc="${i}">
          <div class="doc-ic">PDF</div>
          <div><div class="doc-name">${esc(m.name)}</div><div class="doc-sub">${esc(m.sub)}</div></div><div class="doc-go">查看 ›</div>
        </div>`).join('')}</div>
    </div>`));
    box.querySelectorAll('[data-doc]').forEach(n => n.onclick = () => openDoc(a.docs[+n.dataset.doc]));

    box.appendChild(el(`<div class="rb-sec">
      <h4>前后图层对比 · 自动核界</h4>
      ${a.geometric ? '<p style="font-size:11.5px;color:var(--ink-3);margin-bottom:8px">地图下方出现对比滑条，拖动查看变更前/后图层。</p>' : ''}
      ${checks.map(checkHtml).join('')}
      ${a.geometric ? `<div class="scope-summary">${scopeSummaryText(a.scope)}</div>` : ''}
    </div>`));

    /* 已有核查意见 */
    if (a.opinion) {
      box.appendChild(el(`<div class="rb-sec">
        <h4>现场核查 / 历次意见</h4>
        <div class="source-box" style="border-color:#e3c98e;background:#fdf9ee">${esc(a.opinion)}<br><span class="muted">—— ${esc(a.inspector || '审核人员')}</span></div>
      </div>`));
    }

    /* 意见填写 */
    box.appendChild(el(`<div class="rb-sec" style="border-bottom:0">
      <h4>现场核查意见与审核结论</h4>
      <div class="field"><label>核查 / 审核意见</label>
        <textarea class="textarea" id="revOpinion" placeholder="现场踏勘情况、界址比对结论、是否同意变更…" ${role.canReview ? '' : 'disabled'}>${esc(a.opinion || '')}</textarea>
      </div>
      ${!role.canReview ? '<p class="hint" style="font-size:11px;color:var(--ink-3);margin-top:6px">当前岗位无审核权限，意见由县登记中心审核岗填写。</p>' : ''}
      ${role.canReview ? `<div class="wiz-foot" style="padding-left:0;padding-right:0">
        <button class="btn btn-danger" id="btnReject">退回补正</button>
        <button class="btn btn-success" id="btnApprove">审核通过 · 形成新版本</button>
      </div>
      <p style="font-size:11px;color:var(--ink-3);margin-top:6px">${hardBad ? '⚠ 存在不通过项，须退回处理，无法形成新版本。' : '核查无误后确认，成果生成新版本，旧版本自动归档并可追溯。'}</p>` : ''}
    </div>`));

    $('#rbClose').onclick = () => { exitCompare(); closeRight(); };
    if (role.canReview) {
      $('#btnReject').onclick = () => {
        const op = $('#revOpinion').value.trim();
        if (!op) { toast('退回补正须填写核查意见', 'warn'); return; }
        a.opinion = op; a.status = '待补正'; a.inspector = role.name + '（审核岗）';
        finishReviewAction('已退回申请人补正，台账状态已更新');
      };
      $('#btnApprove').onclick = () => {
        const op = $('#revOpinion').value.trim();
        if (!op) { toast('请填写现场核查 / 审核意见后再确认', 'warn'); return; }
        if (hardBad) { toast('自动核界存在不通过项（越界 / 压占农田 / 材料缺失），不能通过', 'err'); return; }
        approveApplication(a, op, role);
      };
    }

    /* 地图对比 */
    if (a.geometric) enterCompare(a); else exitCompare();

    /* 地图右上角审核条 */
    showReviewBanner(a);
  }

  function showReviewBanner(a) {
    let b = $('#reviewBanner');
    if (!b) { b = el('<div class="reviewing-banner" id="reviewBanner"></div>'); $('.map-wrap').appendChild(b); }
    b.innerHTML = `<b>审核中：${a.id}</b><span>${a.type} ｜ ${a.parcelCode}<br>红色＝注销 / 蓝色＝新增 / 橙色＝调整</span>`;
  }
  function hideReviewBanner() { const b = $('#reviewBanner'); if (b) b.remove(); }

  /* ---------------- 前后对比 ---------------- */
  function enterCompare(a) {
    $('#compareBar').hidden = false;
    lgChange.remove(); // 对比模式下，变更提议只在「变更后」窗格显示
    lgScopeLabels.remove();
    lgAfter.clearLayers();
    const p = QX.byCode(a.parcelCode);
    // 变更后：原界址 + 变更范围重绘于 afterPane
    L.polygon(G.rectPoly(p.rect), { color: '#0f2f56', weight: 2.2, fill: false, pane: 'afterPane' }).addTo(lgAfter);
    [['add', '#2a78d6'], ['adjust', '#eb6834'], ['cancel', '#d03b3b']].forEach(([k, color]) => {
      (a.scope[k] || []).forEach(pts => {
        L.polygon(pts.map(q => G.P(q[0], q[1])), {
          color, weight: 2, dashArray: k === 'cancel' ? '5 3' : null,
          fillColor: color, fillOpacity: .25, pane: 'afterPane',
        }).addTo(lgAfter);
      });
    });
    state.cmpMode = 'split';
    $$('.cmp-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === 'split'));
    $('#compareSlider').value = 50;
    applyCompare();
  }
  function exitCompare() {
    $('#compareBar').hidden = true;
    lgAfter.clearLayers();
    map.getPane('afterPane').style.clipPath = '';
    map.getPane('afterPane').style.display = '';
    lgBuildings.addTo(map);
    if ($('input[data-layer="change"]').checked) { lgChange.addTo(map); updateLabelZoom(); }
  }
  function applyCompare() {
    const pane = map.getPane('afterPane');
    const v = +$('#compareSlider').value;
    if (state.cmpMode === 'before') { pane.style.display = 'none'; lgBuildings.addTo(map); }
    if (state.cmpMode === 'after') { pane.style.display = ''; pane.style.clipPath = 'none'; lgBuildings.remove(); }
    if (state.cmpMode === 'overlay') { pane.style.display = ''; pane.style.clipPath = 'none'; lgBuildings.addTo(map); }
    if (state.cmpMode === 'split') {
      pane.style.display = ''; pane.style.clipPath = `inset(0 0 0 ${v}%)`;
      lgBuildings.addTo(map);
    }
  }

  /* ---------------- 审核通过：落库新版本 ---------------- */
  function approveApplication(a, opinion, role) {
    const p = QX.byCode(a.parcelCode);
    const ver = p.versions.length + 1;
    const baseVer = { ver, date: QX.today, source: a.source, operator: role.name + '（审核岗）',
      note: opinion + `（申请单 ${a.id}，申请人：${a.applicant}）`, status: 'current' };

    if (a.type === '继承') {
      p.owner = a.applicant;
      p.versions.push(Object.assign({ type: '继承', snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) } }, baseVer));
      pushMaterials(p, a.docs);
    }

    if (a.type === '拆除') {
      p.houses.forEach(h => {
        if ((a.scope.cancel || []).some(c => G.rectsOverlap(G.bbox(c), h.rect))) h.status = 'demolished';
      });
      p.status = 'demolished';
      p.versions.push(Object.assign({ type: '拆除（房屋所有权注销）',
        snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) } }, baseVer));
    }

    if (a.type === '翻建') {
      p.houses.forEach(h => {
        if ((a.scope.cancel || []).some(c => G.rectsOverlap(G.bbox(c), h.rect))) h.status = 'demolished';
      });
      (a.scope.add || []).forEach((pts, i) => {
        const b = G.bbox(pts);
        p.houses.push({ id: `${p.code}-F${p.houses.length + 1}`, rect: G.rectOf(b.x, b.y, b.w, b.h),
          structure: '砖混', floors: 2, builtYear: 2026, area: Math.round(G.polyArea(pts) * 2), status: 'active' });
      });
      p.status = 'confirmed';
      p.versions.push(Object.assign({ type: '翻建', snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) } }, baseVer));
      pushMaterials(p, a.docs);
    }

    if (a.type === '分户') {
      const polys = a.scope.adjust.length >= 2 ? a.scope.adjust : a.scope.adjust.concat(a.scope.add);
      const owners = a.splitOwners || polys.map((_, i) => `${a.applicant.split('/')[0].trim()}（${i + 1}）`);
      polys.slice(0, 2).forEach((pts, i) => {
        const b = G.bbox(pts);
        const np = {
          code: `${p.code}-${i + 1}`, rect: G.rectOf(b.x, b.y, b.w, b.h),
          town: p.town, village: p.village, group: p.group, owner: owners[i] || owners[0],
          area: Math.round(G.polyArea(pts)), use: p.use, rightType: p.rightType,
          confirmDate: QX.today, surveyOrg: p.surveyOrg, status: 'confirmed', dispute: null,
          boundaries: p.boundaries, houses: [],
          materials: [QX.materials.zhengshu, QX.materials.quanji, QX.materials.cunzheng],
          versions: [{ ver: 1, date: QX.today, type: '分户登记', source: a.source,
            operator: role.name + '（审核岗）',
            note: `由 ${p.code} 分户设立，申请人 ${a.applicant}。${opinion}`,
            snapshot: { houses: [] }, status: 'current' }],
        };
        QX.parcels.push(np);
      });
      p.status = 'replaced';
      p.versions.push(Object.assign({ type: '分户（原宗归档）',
        note: `原宗地分宗为 ${p.code}-1、${p.code}-2，原成果归档保留。${opinion}`,
        snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) } }, baseVer));
    }

    p.versions.forEach(v => { if (v.ver !== ver) v.status = 'history'; });
    a.status = '已办结'; a.opinion = opinion; a.inspector = role.name + '（审核岗）';
    a.closedDate = QX.today;

    exitTraceSafe();
    exitCompare(); hideReviewBanner();
    renderParcels(); renderBuildings(); renderHistoryFootprints(); renderChangeLayers();
    renderLists(); fillSearchOptions?.();
    renderStats();
    toast(`审核确认：${p.code} 已形成 V${ver}，旧成果已归档，可在版本沿革中追溯`, 'ok');
    closeRight();
    state.selected = p.code;
  }
  function pushMaterials(p, docs) {
    docs.forEach(d => { if (!p.materials.includes(d)) p.materials.push(d); });
  }
  function exitTraceSafe() { if (state.trace) exitTrace(); }
  function finishReviewAction(msg) {
    renderParcels(); renderChangeLayers(); renderLists(); renderStats();
    exitCompare(); hideReviewBanner(); closeRight();
    toast(msg, 'ok');
  }

  /* ================= 左栏列表 ================= */
  function switchTab(tab) {
    $$('.ptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-pane').forEach(n => n.classList.toggle('active', n.dataset.pane === tab));
    if (tab === 'todo') renderTodo();
    if (tab === 'apply') renderAppList();
  }
  function renderLists() {
    renderAppList(); renderTodo(); updateBadges();
  }
  function updateBadges() {
    const pend = pendingApps();
    $('#badgeApply').textContent = pend.length;
    $('#badgeTodo').textContent = pend.length;
  }
  function appItem(a) {
    const p = QX.byCode(a.parcelCode);
    const [cls, txt] = tagFor(a.status);
    const checks = runChecks(a);
    const bad = checks.filter(c => c.lv === 'bad').length;
    const warn = checks.filter(c => c.lv === 'warn').length;
    const node = el(`<div class="list-item ${state.reviewId === a.id ? 'sel' : ''}">
      <div class="li-top"><span class="li-id">${a.id} · ${a.type}</span><span class="tag ${cls}">${txt}</span></div>
      <div class="li-sub"><span>${p.code} · ${esc(a.applicant)}</span><span>${a.submitDate}</span></div>
      <div class="li-foot">
        <span class="li-area">${a.geometric ? scopeSummaryText(a.scope) : '权属变更·界址不变'}</span>
        <span>${bad ? `<b style="color:#a82a2a">${bad} 项不通过</b>` : warn ? `<span style="color:#946200">${warn} 项待核实</span>` : '<span style="color:#16701a">预检正常</span>'}</span>
      </div>
    </div>`);
    node.onclick = () => openApp(a.id);
    return node;
  }
  function renderAppList() {
    const box = $('#appList'); box.innerHTML = '';
    const list = QX.applications
      .filter(a => !state.appFilter || a.status === state.appFilter)
      .sort((a, b) => b.submitDate.localeCompare(a.submitDate));
    if (!list.length) { box.appendChild(el('<div class="muted" style="padding:18px;text-align:center">暂无该状态的变更申请</div>')); return; }
    list.forEach(a => box.appendChild(appItem(a)));
  }
  function renderTodo() {
    const box = $('#todoList'); box.innerHTML = '';
    const pend = pendingApps().sort((a, b) => a.status === '待补正' ? -1 : 1);
    const nWait = pend.filter(a => a.status !== '待补正').length;
    const nFix = pend.filter(a => a.status === '待补正').length;
    $('#todoSummary').innerHTML = `
      <div style="display:flex;gap:8px;padding:12px 14px 4px">
        <div style="flex:1;background:#f3f8fe;border:1px solid #d6e5f7;border-radius:8px;padding:9px 11px">
          <div style="font-size:19px;font-weight:700;color:#1c5cab">${nWait}</div><div class="muted" style="font-size:11px">待审核 / 审核中</div></div>
        <div style="flex:1;background:#fdf6f6;border:1px solid #f0d4d4;border-radius:8px;padding:9px 11px">
          <div style="font-size:19px;font-weight:700;color:#a82a2a">${nFix}</div><div class="muted" style="font-size:11px">退回待补正</div></div>
      </div>`;
    pend.forEach(a => box.appendChild(appItem(a)));
    if (!pend.length) box.appendChild(el('<div class="muted" style="padding:18px;text-align:center">待办已清零 ✓</div>'));
  }

  /* ================= 右栏框架 ================= */
  function showRightBody(html) {
    $('#rightEmpty').style.display = 'none';
    const body = $('#rightBody');
    body.classList.add('show');
    body.innerHTML = html;
  }
  function closeRight() {
    $('#rightEmpty').style.display = '';
    $('#rightBody').classList.remove('show');
    $('#rightBody').innerHTML = '';
    state.selected = null; state.reviewId = null; state.wiz = null;
    exitDrawing(false); exitCompare(); hideReviewBanner();
    renderParcels(); renderResultList();
  }

  /* ---------------- 材料弹窗 ---------------- */
  function openDoc(m) {
    $('#docModalTitle').textContent = m.name;
    $('#docModalDesc').textContent = `${m.sub}\n\n（原型演示：电子档案扫描件，实际系统对接不动产登记电子档案库与权籍调查附件。）`;
    $('#docModal').hidden = false;
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, kind) {
    const t = el(`<div class="toast ${kind || ''}"><span>${kind === 'ok' ? '✓' : kind === 'err' ? '⛔' : kind === 'warn' ? '⚠' : 'ℹ'}</span><span>${esc(msg)}</span></div>`);
    $('#toastWrap').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2800);
  }

  /* ================= 乡镇统计 ================= */
  const statsData = () => {
    const rows = QX.towns.map(t => {
      const apps = QX.applications.filter(a => QX.byCode(a.parcelCode).town === t.name);
      const pending = apps.filter(a => a.status !== '已办结').length;
      const disputedParcels = QX.parcels.filter(p => p.town === t.name && p.status === 'disputed').length;
      return { name: t.name, change: t.closedYTD + apps.length, pending, dispute: disputedParcels + t.disputeExtra,
        closed: t.closedYTD + apps.filter(a => a.status === '已办结').length, raw: t };
    });
    return rows;
  };

  function renderStats() {
    if (!$('#view-stats').classList.contains('active')) return;
    const rows = statsData();
    const totalChange = rows.reduce((s, r) => s + r.change, 0);
    const totalPending = rows.reduce((s, r) => s + r.pending, 0);
    const totalDispute = rows.reduce((s, r) => s + r.dispute, 0);
    const monthClosed = rows.reduce((s, r) => s + r.raw.closedYTD, 0);
    const closedApps = QX.applications.filter(a => a.status === '已办结').length;
    const nFix = QX.applications.filter(a => a.status === '待补正').length;

    $('#kpiRow').innerHTML = `
      ${kpi('k1', '本年度变更总量', totalChange, '宗', `已办结 <b>${monthClosed + closedApps}</b> 宗 · 在办 ${totalPending} 宗`)}
      ${kpi('k2', '确权成果库总量', '28,416', '宗', `覆盖 6 乡镇 132 个行政村 · 房地一体`, true)}
      ${kpi('k3', '未办结事项', totalPending, '件', `其中退回待补正 <span class="up-warn">${nFix}</span> 件`)}
      ${kpi('k4', '争议宗地', totalDispute, '宗', '需现场调处后再办理登记', false, true)}`;

    drawBarChart(rows);
    $('#todoCardSub').textContent = `全县 ${totalPending} 件未办结`;
    const mini = $('#statsTodo');
    mini.innerHTML = '';
    rows.sort((a, b) => b.pending - a.pending).forEach((r, i) => {
      const row = el(`<div class="mini-row ${i === 0 && r.pending ? 'top' : ''}">
        <span class="mr-rank">${i + 1}</span>
        <div class="mr-body"><div class="mr-id">${r.name}</div><div class="mr-sub">变更 ${r.change} 宗 · 办结率 ${rate(r)}%</div></div>
        <div class="mr-num">${r.pending}<small> 件</small></div></div>`);
      row.onclick = () => jumpToTown(r.name);
      mini.appendChild(row);
    });

    /* 明细表 */
    const tb = $('#townTable tbody');
    tb.innerHTML = '';
    statsData().forEach(r => {
      const rt = rate(r);
      const cls = rt >= 90 ? '' : rt >= 75 ? 'low' : 'crit';
      tb.appendChild(el(`<tr data-town="${r.name}">
        <td class="t-town">${r.name}</td><td>${r.change}</td><td>${r.pending}</td><td>${r.dispute}</td>
        <td><div class="rate-cell"><div class="rate-track"><div class="rate-fill ${cls}" style="width:${rt}%"></div></div>${rt}%</div></td>
        <td><span class="t-link">在地图上查看 ›</span></td></tr>`));
    });
    tb.querySelectorAll('tr').forEach(tr => tr.onclick = () => jumpToTown(tr.dataset.town));

    /* 争议清单：空间库争议宗地 + 台账其他 */
    const dl = $('#disputeList'); dl.innerHTML = '';
    QX.parcels.filter(p => p.status === 'disputed').forEach(p => {
      const row = el(`<div class="mini-row">
        <span class="mr-rank" style="background:#fce9e9;color:#a82a2a">争</span>
        <div class="mr-body"><div class="mr-id">${p.code} · ${esc(p.owner)}</div><div class="mr-sub">${p.town} ${p.village} ${p.group}：${esc(p.dispute.slice(0, 26))}…</div></div>
        <span class="tag tag-crit">未调处</span></div>`);
      row.onclick = () => { switchView('workbench'); selectParcel(p.code, true); };
      dl.appendChild(row);
    });
    statsData().filter(r => r.raw.disputeExtra).forEach(r => {
      dl.appendChild(el(`<div class="mini-row">
        <span class="mr-rank" style="background:#fdf3df;color:#946200">议</span>
        <div class="mr-body"><div class="mr-id">${r.name} · 台账登记争议</div><div class="mr-sub">村组上报、尚未落入空间库专题的争议宗地</div></div>
        <span class="mr-num">${r.raw.disputeExtra}<small> 宗</small></span></div>`));
    });
  }
  function rate(r) { return Math.round((r.closed / r.change) * 100); }
  function kpi(cls, label, val, unit, delta, big) {
    return `<div class="kpi ${cls}">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" ${big ? 'style="font-size:27px;padding-top:4px"' : ''}>${val}<span class="unit">${unit}</span></div>
      <div class="kpi-delta">${delta}</div></div>`;
  }
  function jumpToTown(town) {
    switchView('workbench');
    $('#qTown').value = town;
    doSearch();
    const t = QX.towns.find(x => x.name === town);
    map.flyTo(G.P(t.center[0], t.center[1]), Math.max(map.getZoom(), 15.5), { duration: .6 });
  }

  /* ---------------- 分组柱状图（SVG） ---------------- */
  const SERIES = [
    { key: 'change', name: '变更数量', color: '#2a78d6' },
    { key: 'pending', name: '未办结', color: '#eb6834' },
    { key: 'dispute', name: '争议宗地', color: '#1baf7a' },
  ];
  function drawBarChart(rows) {
    const host = $('#townChart');
    host.innerHTML = '';
    const W = Math.max(560, host.clientWidth || 760), H = 300;
    const M = { l: 42, r: 14, t: 16, b: 48 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const maxV = Math.max(...rows.map(r => r.change));
    const yMax = Math.ceil(maxV / 5) * 5;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'bar-chart'); svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    /* 网格 + Y 轴 */
    for (let i = 0; i <= yMax / 5; i++) {
      const v = i * 5, y = M.t + ih - (v / yMax) * ih;
      const ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('class', 'grid'); ln.setAttribute('x1', M.l); ln.setAttribute('x2', W - M.r);
      ln.setAttribute('y1', y); ln.setAttribute('y2', y);
      svg.appendChild(ln);
      const tx = document.createElementNS(svgNS, 'text');
      tx.setAttribute('class', 'tick'); tx.setAttribute('x', M.l - 8); tx.setAttribute('y', y + 3.5);
      tx.setAttribute('text-anchor', 'end'); tx.textContent = v;
      svg.appendChild(tx);
    }
    const axis = document.createElementNS(svgNS, 'line');
    axis.setAttribute('class', 'axis'); axis.setAttribute('x1', M.l); axis.setAttribute('x2', M.l);
    axis.setAttribute('y1', M.t); axis.setAttribute('y2', M.t + ih);
    svg.appendChild(axis);

    const slot = iw / rows.length;
    const groupW = Math.min(62, slot * .62);
    const barW = Math.min(19, (groupW - 4) / 3);
    const x0 = M.l + (slot - groupW) / 2;
    const maxTown = rows.reduce((a, b) => b.change > a.change ? b : a);

    rows.forEach((r, i) => {
      const gx = x0 + i * slot;
      SERIES.forEach((s, j) => {
        const v = r[s.key];
        const h = Math.max(v ? 2 : 0, (v / yMax) * ih);
        const x = gx + j * (barW + 2) + 2;
        const y = M.t + ih - h;
        const rad = 4;
        const bar = document.createElementNS(svgNS, 'path');
        // 仅数据端（顶端）圆角，基线端直角
        const d = v >= rad
          ? `M${x},${y + h} L${x},${y + rad} Q${x},${y} ${x + rad},${y} L${x + barW - rad},${y} Q${x + barW},${y} ${x + barW},${y + rad} L${x + barW},${y + h} Z`
          : `M${x},${y} h${barW} v${h} h${-barW} Z`;
        bar.setAttribute('class', 'bar');
        bar.setAttribute('d', d);
        bar.setAttribute('fill', s.color);
        svg.appendChild(bar);
        /* 选择性直标：最高乡镇的变更总量 */
        if (s.key === 'change' && r === maxTown) {
          const t = document.createElementNS(svgNS, 'text');
          t.setAttribute('class', 'direct-label'); t.setAttribute('x', x + barW / 2);
          t.setAttribute('y', y - 5); t.setAttribute('text-anchor', 'middle');
          t.textContent = v;
          svg.appendChild(t);
        }
      });
      const lb = document.createElementNS(svgNS, 'text');
      lb.setAttribute('class', 'tick'); lb.setAttribute('x', gx + groupW / 2);
      lb.setAttribute('y', M.t + ih + 18); lb.setAttribute('text-anchor', 'middle');
      lb.setAttribute('style', 'fill:#52514e;font-weight:600');
      lb.textContent = r.name;
      svg.appendChild(lb);

      /* 命中区 */
      const hit = document.createElementNS(svgNS, 'rect');
      hit.setAttribute('x', M.l + i * slot); hit.setAttribute('y', M.t);
      hit.setAttribute('width', slot); hit.setAttribute('height', ih);
      hit.setAttribute('fill', 'transparent');
      hit.addEventListener('mousemove', e => showTip(e, r));
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
    });

    host.appendChild(svg);
    if (!$('#chartLegend')) {
      const lg = el(`<div class="chart-legend" id="chartLegend">
        ${SERIES.map(s => `<span><i class="lk" style="background:${s.color}"></i>${s.name}</span>`).join('')}
        <span class="muted" style="margin-left:auto">单位：宗/件</span></div>`);
      host.parentNode.insertBefore(lg, host.nextSibling);
    }
  }
  const tip = el('<div class="chart-tip" id="chartTip"></div>');
  document.body.appendChild(tip);
  function showTip(e, r) {
    tip.style.display = 'block';
    tip.innerHTML = `<div class="tt-t">${r.name}</div>
      ${SERIES.map(s => `<div class="tt-r"><span><i style="background:${s.color}"></i>${s.name}</span><b>${r[s.key]}</b></div>`).join('')}`;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 160) + 'px';
    tip.style.top = (e.clientY - 20) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  /* ================= 视图 / 事件绑定 ================= */
  function switchView(v) {
    state.view = v;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $('#view-workbench').classList.toggle('active', v === 'workbench');
    $('#view-stats').classList.toggle('active', v === 'stats');
    if (v === 'workbench') setTimeout(() => map.invalidateSize(), 60);
    if (v === 'stats') renderStats();
  }

  $$('.nav-btn').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('#btnSearch').onclick = doSearch;
  $('#btnSearchReset').onclick = resetSearch;
  $('#qParcel').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  $('#qOwner').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  $('#qTown').onchange = doSearch;
  $('#qGroup').onchange = doSearch;
  $$('.ptab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $$('#appStatusFilter .chip-toggle').forEach(b => b.onclick = () => {
    $$('#appStatusFilter .chip-toggle').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.appFilter = b.dataset.st === '' ? '' : b.dataset.st;
    if (b.dataset.st === '') state.appFilter = '';
    renderAppList();
  });
  $('#btnNewChange').onclick = () => {
    const role = ROLES[state.role];
    if (!role.canApply) { toast('请先查询选定宗地；发起申请由乡镇经办岗操作', 'warn'); return; }
    if (!state.selected) { toast('请先在查询结果或地图上选定要变更的宗地', 'warn'); switchTab('search'); return; }
    startWizard(QX.byCode(state.selected));
  };

  /* 图层开关 */
  $$('.layer-card input[data-layer]').forEach(cb => cb.onchange = () => {
    const map2 = { parcels: lgParcels, buildings: lgBuildings, history: lgHistory, labels: lgLabels, farmland: lgFarm, change: [lgChange, lgScopeLabels] };
    const g = map2[cb.dataset.layer];
    (Array.isArray(g) ? g : [g]).forEach(lyr => { if (cb.checked) lyr.addTo(map); else lyr.removeFrom(map); });
  });

  /* 绘制工具 */
  $$('.draw-tool').forEach(b => b.onclick = () => setDrawTool(b.dataset.tool));
  $('#drawUndo').onclick = () => { const d = state.drawing; if (d && d.pts.length) { d.pts.pop(); redrawTemp(); } };
  $('#drawFinish').onclick = () => finishPolygon();
  $('#drawAbort').onclick = () => {
    if (state.wiz) state.wiz.paused = true;
    exitDrawing(true);
    if (state.wiz) renderWizard();
  };
  $('#traceExit').onclick = exitTrace;

  /* 图例折叠 */
  $('#legendFold').onclick = () => {
    const body = $('#legendBody');
    const folded = body.style.display === 'none';
    body.style.display = folded ? '' : 'none';
    $('#legendFold').textContent = folded ? '收起' : '展开';
  };

  /* 对比 */
  $('#compareSlider').oninput = applyCompare;
  $$('.cmp-mode').forEach(b => b.onclick = () => {
    state.cmpMode = b.dataset.mode;
    $$('.cmp-mode').forEach(x => x.classList.toggle('active', x === b));
    applyCompare();
  });

  /* 岗位切换 */
  $('#roleSelect').onchange = e => {
    state.role = e.target.value;
    const r = ROLES[state.role];
    $('#userName').textContent = r.name;
    $('#userDept').textContent = r.dept;
    $('#userAvatar').textContent = r.avatar;
    toast(`已切换岗位：${r.dept}`, 'ok');
    if ($('#rightBody').classList.contains('show')) {
      if (state.reviewId) openApp(state.reviewId);
      else if (state.wiz) renderWizard();
      else if (state.selected) renderArchive();
    }
    renderLists();
  };

  /* 弹窗 */
  $('#docModalClose').onclick = () => { $('#docModal').hidden = true; };
  $('#docModal').onclick = e => { if (e.target.id === 'docModal') $('#docModal').hidden = true; };
  $('#gotoTable').onclick = e => { e.preventDefault(); document.getElementById('townTable').scrollIntoView({ behavior: 'smooth' }); };
  $('#statsExport').onclick = () => toast('原型演示：实际将导出台账 Excel 并推送登记业务系统', 'ok');

  window.addEventListener('resize', () => {
    if ($('#view-stats').classList.contains('active')) {
      const rows = statsData();
      if ($('#townChart svg')) drawBarChart(rows);
    }
  });

  /* ---------------- 初始化 ---------------- */
  fillSearchOptions();
  state.results = QX.parcels.slice();
  renderResultList();
  renderLists();
  renderStats();
  const d = new Date(2026, 8, 11);
  $('#topDate').textContent = `2026年9月11日 星期五`;
})();
