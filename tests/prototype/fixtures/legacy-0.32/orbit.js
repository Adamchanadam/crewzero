// 運作環第三版（2026-10-30；由設計稿 mockups/2026-10-30-orbit-v3/orbit.js 搬入正式版，資料改由 /api/dashboard 嘅 work 供應）：以參考監察台的節點網絡做骨架（左：創辦人核心＋三個膠囊；中：立方體＋會話環；右：任務欄），
// 再放入有景深的傾斜橢圓空間（遠小近大、霧化、地面反射、視差）與循環方向（環上箭頭、前方回流弧）。
// 真實規則：會話亮球、亮線、沿線粒子、HUD 掃描環、衛星、計數跳動、脈衝、漣漪、浮動標題只由真實資料事件驅動，密度跟並發數；
//           環轉、箭頭漂移、呼吸、霧化、地面光屬氣氛層（冷色、慢、無粒子），閒置可動但不會被誤會成工作中。
// 畫布資料屬性（供驗收）：data-lit、data-particles、data-two-hop、data-sub、data-moving、data-ai-channels、data-info-flows、data-human-pulse、data-floats、data-last-pulse、data-level。
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', TAU = Math.PI * 2;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); }, lerp = function (a, b, t) { return a + (b - a) * t; }, seg = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };
  var E = { out: function (t) { return 1 - Math.pow(1 - t, 3); }, in: function (t) { return t * t; }, io: function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }, back: function (t) { var c = 2.70158; return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); }, bump: function (t) { return Math.sin(Math.PI * clamp(t, 0, 1)); } };
  var PULSE_COLOR = { 'human-to-ai': '153,215,188', 'ai-to-human': '232,141,79', 'inbox-to-ai': '182,239,224', 'ai-to-session': '255,221,188', 'session-to-task': '255,221,188', 'ai-to-task': '255,221,188' };
  var S = null;            // 場景
  var rot = -.55, fxT = 0; // 環角度與粒子時鐘跨 mount 保留，節點不會跳位
  var depth = function (a) { return (Math.sin(a) + 1) / 2; }; // 0 遠 → 1 近（y 向下，sin 大＝近）

  /* ---------- 曲線與路徑 ---------- */
  function curve(a, b, bow) { var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1; return { a: a, b: b, c: { x: mx - dy / len * len * bow, y: my + dx / len * len * bow } }; }
  function samp(sg, n) { var pts = []; for (var i = 0; i <= n; i++) { var t = i / n, u = 1 - t; pts.push({ x: u * u * sg.a.x + 2 * u * t * sg.c.x + t * t * sg.b.x, y: u * u * sg.a.y + 2 * u * t * sg.c.y + t * t * sg.b.y }); } return pts; }
  function mkPath(segs) { var pts = [], cum = [0], len = 0; segs.forEach(function (s, k) { var p = samp(s, 22); if (k) p.shift(); p.forEach(function (q) { if (pts.length) { len += Math.hypot(q.x - pts[pts.length - 1].x, q.y - pts[pts.length - 1].y); cum.push(len); } pts.push(q); }); }); return { pts: pts, cum: cum, len: len }; }
  function at(path, s) { if (s <= 0) return path.pts[0]; if (s >= path.len) return path.pts[path.pts.length - 1]; var lo = 0, hi = path.cum.length - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (path.cum[m] < s) lo = m; else hi = m; } var f = (s - path.cum[lo]) / ((path.cum[hi] - path.cum[lo]) || 1), a = path.pts[lo], b = path.pts[hi]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
  function strokePath(g, p, col, w, dash) { g.beginPath(); p.pts.forEach(function (q, i) { i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); }
  function dot(g, p, r, col, glow) { g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fillStyle = col; if (glow) { g.shadowColor = glow; g.shadowBlur = 10; } g.fill(); g.shadowBlur = 0; }
  function trail(g, path, s, head, col, n, gap) { for (var k = n; k >= 1; k--) { var q = s - k * gap; if (q < 0 || q > path.len) continue; var a = 1 - k / (n + 1); dot(g, at(path, q), head * (.35 + .5 * a), 'rgba(' + col + ',' + (a * .5).toFixed(2) + ')'); } }
  function ring(g, x, y, r, a, w, col) { if (a <= .01 || r <= 0) return; g.beginPath(); g.arc(x, y, r, 0, TAU); g.strokeStyle = 'rgba(' + (col || '153,215,188') + ',' + a.toFixed(3) + ')'; g.lineWidth = w; g.stroke(); }
  function ringE(g, x, y, rx, ry, a, w, col) { if (a <= .01 || rx <= 0) return; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.strokeStyle = 'rgba(' + (col || '153,215,188') + ',' + a.toFixed(3) + ')'; g.lineWidth = w; g.stroke(); }

  /* ---------- 建立 ---------- */
  var layoutDirty = true;
  function mount(root, data, opts) {
    opts = opts || {};
    if (S && S.root !== root) destroy();
    if (!S) {
      root.textContent = '';
      var scan = el('div', 'o-scan'), floor = el('div', 'o-floor'), cv = el('canvas', 'o-canvas'), stage = el('div', 'o-stage'), fog = el('div', 'o-fog'), fx = el('canvas', 'o-fx'), fxa = el('div', 'o-fxa');
      fxa.setAttribute('role', 'status'); fxa.setAttribute('aria-live', 'polite'); root.append(scan, floor, cv, stage, fog, fx, fxa);
      S = { root: root, cv: cv, ctx: cv.getContext('2d'), fxc: fx, fctx: fx.getContext('2d'), fxa: fxa, stage: stage, raf: 0, last: 0, lastPaint: 0, tilt: 1, tTilt: 1, dx: 0, tdx: 0, pulses: [], ripples: [], floats: [], cur: null, humanPulseUntil: 0, nodes: [], tasks: [], chips: [], W: 0, H: 0 };
      root.addEventListener('mousemove', function (e) { var r = root.getBoundingClientRect(); S.tTilt = 1 + ((e.clientY - r.top) / r.height - .5) * .34; S.tdx = ((e.clientX - r.left) / r.width - .5) * 22; });
      root.addEventListener('mouseleave', function () { S.tTilt = 1; S.tdx = 0; });
      document.addEventListener('visibilitychange', function () { if (S) { if (document.hidden) stop(); else loop(); } });
    }
    S.data = data; S.n = data.names || {}; S.paused = !!opts.paused; S.fx = opts.fx !== false; S.reduced = !!opts.reduced;
    build(); layoutDirty = true; loop(); if (!S.lifeT) scheduleLife();
    return api;
  }
  function destroy() { if (S) { stop(); clearTimeout(S.lifeT); S = null; } }
  // 閒置時統籌成員有生命嘅小訊號：每 8–12 秒偶然縮一縮身（真工作時唔做，由工作動作取代）
  function scheduleLife() { clearTimeout(S.lifeT); S.lifeT = setTimeout(function () { if (!S) return; var le = S.core && S.core.querySelector('.o-lead'); if (le && le.dataset.pose !== 'working' && !le.classList.contains('swap')) flash(le, 'settle', 420); scheduleLife(); }, 8000 + Math.random() * 4000); }

  // 陶土 AI 團隊圖（品牌角色規格）：讀唔到（例如離線快照）就收埋
  function clay(name, cls) { var i = el('img', cls); i.src = '/assets/clay-orbit-' + name + '.webp'; i.alt = ''; i.setAttribute('aria-hidden', 'true'); i.addEventListener('error', function () { i.remove(); }); return i; }
  // 統籌成員姿勢（運作環同手機清單共用）：有真實工作＝工作；冇工作有待決＝敬禮；自動停＝坐低；其餘＝企定
  function poseOf(d) { var work = ((d.meta && d.meta.workLevel) || 0) > 0; return work ? 'working' : d.counts && d.counts.pending > 0 && d.connected !== false ? 'salute' : d.autoStopped ? 'sitting' : 'standing'; }
  function motionOK() { return !S.paused && !S.reduced && !document.hidden; }
  function ghost(o) { var to = S.pLead || S.pAI; if (!to) return; var g = clay('member', 'o-ghost'); g.style.transform = 'translate(' + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px)'; S.stage.append(g); requestAnimationFrame(function () { requestAnimationFrame(function () { g.style.transform = 'translate(' + to.x.toFixed(1) + 'px,' + to.y.toFixed(1) + 'px) scale(.35)'; g.style.opacity = '0'; }); }); setTimeout(function () { g.remove(); }, 450); }
  function hostCode(s) { return s.hostShort || (s.host ? String(s.host).slice(0, 2).toUpperCase() : 'AI'); }
  function stateName(st) { var n = S.n; return n['act_' + (st === 'stopped' ? 'blocked' : st)] || n['act_' + st] || st; }
  // 任務編號：畫面寫「任務 n」（n 由頁面按看板次序給，唔寫內部代號）
  function taskLabel(id) { var n = S.n, no = S.taskNo && S.taskNo[id]; return (n.tasksL || '任務') + ' ' + (no != null ? no : String(id).replace(/^t/, '')); }

  function build() {
    var old = S.nodes || [], firstBuild = !S.built, d = S.data, n = S.n, st = S.stage; st.textContent = ''; S.nodes = []; S.tasks = []; S.chips = [];
    S.taskNo = {}; (d.tasks || []).forEach(function (t) { if (t.no != null) S.taskNo[t.id] = t.no; });
    var lv = (d.meta && d.meta.workLevel) || 0, work = lv > 0;
    S.root.dataset.level = String(lv); S.root.classList.toggle('has-work', work); S.root.classList.toggle('is-sim', !!d.sim); S.root.classList.toggle('offline', d.connected === false);
    S.root.dataset.name = n.orbit || '運作環';
    // 區頭：示意徽章＋範圍
    var head = el('div', 'o-head'), hl = el('span', 'l'); hl.append(el('span', 'o-scope', (n.viewing || '正在查看') + '：' + (d.scope ? d.scope.name : (n.allL || '全部')))); if (n.parallaxHint) hl.append(el('span', null, n.parallaxHint)); head.append(hl); if (d.sim) head.append(el('span', 'o-simban', n.simBadgeShort || '示意 · 非真實狀態')); st.append(head);
    // 工作強度表（左上）
    var g = el('div', 'o-gauge');
    var r1 = el('div', 'grow'); r1.append(el('span', null, n.workLevelL || '工作強度'), el('b', null, lv + ' / 3')); g.append(r1);
    var bars = el('div', 'gbars'); for (var i = 0; i < 3; i++) { var b = el('i'); if (i < lv) b.className = 'on'; bars.append(b); } g.append(bars);
    var r2 = el('div', 'grow'); r2.append(el('span', null, (n.aiCore || 'AI 團隊') + ' ' + (n.sessionsL || '會話')), el('b', null, (d.meta.workingSessions || 0) + ' / ' + (d.sessions || []).length)); g.append(r2);
    var r3 = el('div', 'grow'); r3.append(el('span', null, n.subagentsL || '子代理'), el('b', null, String(d.meta.activeSubagents || 0))); g.append(r3);
    g.append(el('div', 'idle-note', d.connected === false ? (n.offlineNote || '連線中斷：保留最後紀錄，不代表即時工作。') : (n.idleNote || '目前沒有 AI 在工作：畫面靜止，不會假裝忙碌。')));
    st.append(g); S.gauge = g;
    // 創辦人決定核心（左）
    var human = el('div', 'o-human' + (d.counts.pending > 0 && d.connected !== false ? ' alert' : '')); human.dataset.node = 'human';
    human.append(el('span', 'o-eyebrow', n.eyebrowHuman || '方向與決定'));
    var hn = el('div', 'o-hnode'); hn.append(el('i', 'oring'), el('i', 'diamond')); var svg = sv('svg', { viewBox: '0 0 40 40' }); svg.append(sv('circle', { cx: 20, cy: 12, r: 5 })); svg.append(sv('path', { d: 'M10 29c0-10 20-10 20 0M5 20l4-4m22 0 4 4M15 33h10' })); hn.title = (n.clayDoor || '') + (d.counts.pending > 0 && d.connected !== false ? (n.clayDoorPending || '') : ''); hn.append(clay(d.counts.pending > 0 && d.connected !== false ? 'door' : 'door-empty', 'o-door')); human.append(hn);
    human.append(el('b', 'o-htitle', n.humanCore || '創辦人決定'));
    var hs = el('button', 'o-text'); hs.type = 'button'; hs.textContent = (S.humanPulseUntil > performance.now() && S.humanLabel) ? S.humanLabel : (n.pendingGlobal || '全局 {n} 項待決').replace('{n}', d.counts.pending) + ' · ' + (n.viewDesk || '查看待決事項'); hs.addEventListener('click', function () { if (d.onNeed) d.onNeed('decision'); }); human.append(hs); S.humanStatus = hs;
    st.append(human); S.human = human;
    // 三個膠囊
    [['decision', n.mPending || '待決事項', d.counts.pending, false], ['awaiting', n.awaiting || '等你回覆', d.counts.awaiting, false], ['inbox', n.inbox || '收件匣', d.counts.inbox, !!d.counts.processing]].forEach(function (x) {
      var c = el('button', 'o-chip' + (x[2] > 0 && d.connected !== false ? ' hot' : '') + (x[3] ? ' processing' : '')); c.type = 'button'; c.dataset.node = 'need:' + x[0]; c.dataset.count = String(x[2]);
      c.append(el('span', 'ct', x[1])); c.append(el('b', null, x[3] ? (n.processingL || '處理中') + ' ' + mmss(d.counts.elapsed || 0) : String(x[2])));
      if (x[0] === 'inbox' && !x[3]) c.append(el('i', null, n.openL || '開啟'));
      c.title = x[1] + ' ' + x[2]; c.addEventListener('click', function () { if (d.onNeed) d.onNeed(x[0]); });
      if (S.prevCounts && S.prevCounts[x[0]] !== undefined && S.prevCounts[x[0]] !== x[2]) flash(c, 'changed', 300);
      st.append(c); S.chips.push({ el: c, kind: x[0], count: x[2], processing: x[3] });
    });
    S.prevCounts = { decision: d.counts.pending, awaiting: d.counts.awaiting, inbox: d.counts.inbox };
    // AI 統籌核心（中）
    var core = el('div', 'o-core'); core.dataset.node = 'ai';
    var engine = el('div', 'o-engine'); engine.append(clay('workbench', 'o-bench'), el('i', 'floor'));
    // 統籌成員姿勢：有真實工作＝工作；冇工作有待決＝敬禮等指示；自動停＝坐低等；其餘＝企定等。換姿勢時定格咁跳一下
    var pose = poseOf(d); var lead = clay('lead-' + pose, 'o-lead'); lead.dataset.pose = pose; engine.append(lead); engine.title = n['clayLead_' + pose] || '';
    if (S.prevPose && S.prevPose !== pose && motionOK()) lead.classList.add('swap'); S.prevPose = pose; var cube = el('div', 'cube'); ['front', 'back', 'right', 'left', 'topf', 'bottomf'].forEach(function (f) { var face = el('span', 'face ' + f, f === 'front' ? (d.initials || 'AI') : f === 'right' ? '↗' : ''); cube.append(face); }); cube.append(el('i', 'cube-core')); engine.append(cube); core.append(engine);
    core.append(el('span', 'o-eyebrow', n.eyebrowAI || '統籌'));
    var idn = el('div', 'o-ident'); var mark = el('span', 'o-mark', (d.initials || 'AI').slice(0, 2)); idn.append(mark, el('b', null, n.aiCore || 'AI 團隊')); core.append(idn);
    core.append(el('span', 'o-status', d.connected === false ? (n.offlineStatus || '回報待核實 · 保留最後紀錄') : d.scope ? (n.scopeStatus || '此站任務：進行中 {a} · 等待 {b} · 已交付 {c}').replace('{a}', d.scope.active || 0).replace('{b}', d.scope.waiting || 0).replace('{c}', d.scope.done || 0) : work ? (n.workingNow || '{n} 個會話工作中 · 子代理 {m}').replace('{n}', d.meta.workingSessions).replace('{m}', d.meta.activeSubagents) : (n.noWorkPlain || '沒有工作進行中')));
    st.append(core); S.core = core;
    // 會話節點（≤ 6，溢出 +n）
    var list = (d.sessions || []).slice(0, 6), more = (d.sessions || []).length - list.length;
    list.forEach(function (se, i) {
      var nd = el('button', 'o-node ' + se.state + (se.sim ? ' simulated' : '') + (se.isRun ? ' run' : '')); nd.type = 'button'; nd.dataset.node = 'session:' + se.key; nd.dataset.state = se.state; nd.dataset.sub = String(se.state === 'working' ? (se.sub || 0) : 0);
      var rg = el('span', 'o-ring'); var hud = sv('svg', { class: 'ticks', viewBox: '0 0 60 60' }); var ticks = se.state === 'working' ? Math.min(6, se.sub || 0) : 0; for (var k = 0; k < ticks; k++) { var a0 = -Math.PI / 2 + k * (TAU / 6) + .1, a1 = a0 + TAU / 6 - .2; hud.append(sv('path', { d: 'M' + (30 + 27 * Math.cos(a0)) + ' ' + (30 + 27 * Math.sin(a0)) + ' A27 27 0 0 1 ' + (30 + 27 * Math.cos(a1)) + ' ' + (30 + 27 * Math.sin(a1)) })); } rg.append(hud); rg.append(clay(se.brainItem ? 'member-' + se.brainItem : 'member', 'o-mem')); rg.append(el('b', null, hostCode(se))); nd.append(rg);
      var lb = el('span', 'o-lb up'); lb.append(el('b', null, se.name + (se.main ? '（' + (n.mainL || '主線') + '）' : ''))); if (se.title) lb.append(el('i', 'idn', clip(se.title, 14))); var tk = se.state === 'working' && se.taskIds && se.taskIds.length ? ' · ' + taskLabel(se.taskIds[0]) : ''; lb.append(el('small', null, stateName(se.state) + tk)); nd.append(lb);
      nd.title = se.name + (se.title ? ' · ' + se.title : '') + ' · ' + (se.reason || stateName(se.state)) + (n.clickDetail ? '（' + n.clickDetail + '）' : '') + ' · ' + (se.brainItem && n['brain_' + se.brainItem] ? (n.clayMemberOf || '').replace('{item}', n['brain_' + se.brainItem]) : (n.clayMember || ''));
      nd.addEventListener('click', function () { if (d.onSession) d.onSession(se); });
      st.append(nd); S.nodes.push({ el: nd, lb: lb, i: i, key: se.key, working: se.state === 'working', sub: se.state === 'working' ? (se.sub || 0) : 0, taskIds: se.taskIds || [], side: 'up', ang: S.prevAng && S.prevAng[se.key] != null ? S.prevAng[se.key] : null, born: !firstBuild && motionOK() && !(S.prevAng && S.prevAng[se.key] != null) ? performance.now() : 0, lastActive: se.lastActiveAt || '' });
      if (S.prevActive && S.prevActive[se.key] !== undefined && S.prevActive[se.key] !== (se.lastActiveAt || '')) flash(nd, 'recent', 320);
    });
    S.prevActive = {}; (d.sessions || []).forEach(function (se) { S.prevActive[se.key] = se.lastActiveAt || ''; });
    // 做完歸隊：上一次有、今次冇嘅會話，細成員縮返去統籌成員身邊
    var still = {}; S.nodes.forEach(function (x) { still[x.key] = true; });
    if (!firstBuild && motionOK()) old.forEach(function (o) { if (o.key !== 'more' && !still[o.key] && o.x != null) ghost(o); });
    S.built = true;
    if (more > 0) { var mn = el('div', 'o-node more'); mn.dataset.node = 'session:more'; var mr = el('span', 'o-ring'); mr.append(el('b', null, '+' + more)); mn.append(mr); var ml = el('span', 'o-lb up'); ml.append(el('b', null, '+' + more + ' ' + (n.sessionsL || '會話'))); mn.append(ml); st.append(mn); S.nodes.push({ el: mn, lb: ml, i: list.length, key: 'more', working: false, sub: 0, taskIds: [], side: 'up', ang: null }); }
    // 任務欄（右，≤ 8，溢出「+n」，未登記）
    var tasks = (d.tasks || []).slice(0, 8), tmore = (d.tasks || []).length - tasks.length;
    var working = {}; S.nodes.forEach(function (x) { if (x.working) x.taskIds.forEach(function (id) { working[id] = true; }); });
    tasks.forEach(function (t) {
      var c = el('button', 'o-task ' + (t.status || 'active') + (working[t.id] ? ' target' : '')); c.type = 'button'; c.dataset.node = 'task:' + t.id; c.dataset.state = t.status || '';
      var k = el('span', 'k'); k.append(el('span', null, taskLabel(t.id)), el('span', null, n['ms_' + (t.status || 'active')] || n['act_' + t.status] || '')); c.append(k);
      c.append(el('span', 'tt', t.title)); if (t.ms) c.append(el('small', null, t.ms));
      c.title = taskLabel(t.id) + ' · ' + t.title; c.addEventListener('click', function () { if (d.onTask) d.onTask(t); });
      st.append(c); S.tasks.push({ el: c, id: t.id, kind: 'task' });
    });
    if (tmore > 0) { var tm = el('button', 'o-task more'); tm.type = 'button'; tm.append(el('span', 'tt', '＋' + tmore + ' ' + (n.moreTasks || '項更多'))); tm.addEventListener('click', function () { if (d.onTask) d.onTask(null); }); st.append(tm); S.tasks.push({ el: tm, id: 'more', kind: 'more' }); }
    var unlinked = S.nodes.some(function (x) { return x.working && !x.taskIds.length && x.key !== 'more'; });
    // 任務卡多過五張：每張收成兩行（編號＋標題），唔會疊埋
    st.classList.toggle('dense', tasks.length + (tmore > 0 ? 1 : 0) + (unlinked ? 1 : 0) > 5);
    if (unlinked) { var ul = el('button', 'o-task unlinked'); ul.type = 'button'; ul.dataset.node = 'unlinked'; ul.append(el('span', 'tt', n.unlinkedWork || '未登記的工作')); ul.title = n.unlinkedHint || ''; ul.addEventListener('click', function () { if (d.onUnlinked) d.onUnlinked(); }); st.append(ul); S.tasks.push({ el: ul, id: 'unlinked', kind: 'unlinked' }); }
    // 里程碑卡（範圍模式）
    S.ms = null;
    if (d.scope && d.scope.criteria) {
      var ms = el('button', 'o-ms' + (d.scope.criteria.length && d.scope.criteria.every(function (c) { return c.met; }) ? ' done' : '')); ms.type = 'button'; var met = d.scope.criteria.filter(function (c) { return c.met; }).length;
      var mh = el('div', 'mh'); mh.append(el('span', 'mt', n.milestoneL || '里程碑'), el('b', null, d.scope.name), el('em', null, (n.metL || '達成') + ' ' + met + '/' + d.scope.criteria.length)); if (d.scope.prerequisite) mh.append(el('em', null, d.scope.prerequisite)); ms.append(mh);
      var bar = el('div', 'mbar'); var fill = el('i'); fill.style.transform = 'scaleX(' + (d.scope.criteria.length ? met / d.scope.criteria.length : 0).toFixed(4) + ')'; bar.append(fill, el('u')); ms.append(bar);
      var ul2 = el('ul'); d.scope.criteria.forEach(function (c) { var li = el('li', c.met ? 'met' : ''); li.append(el('span', 'mark', c.met ? '✓' : '○'), document.createTextNode(c.text)); ul2.append(li); }); ms.append(ul2);
      ms.addEventListener('click', function () { if (d.onScopeTasks) d.onScopeTasks(); }); st.append(ms); S.ms = ms;
    }
    // 循環站名（氣氛層標籤）
    S.labels = [['st_dispatch', Math.PI * 1.12], ['st_work', Math.PI * 1.88], ['st_accept', null]].map(function (x) { var l = el('span', 'o-label', n[x[0]] || x[0]); st.append(l); return { el: l, a: x[1] }; });
    // 底部狀態行
    var foot = el('div', 'o-foot'); var route = el('span', 'route', 'view / ' + (n.orbit || '運作環')); route.append(el('i', 'cursor')); foot.append(route);
    var ws = S.nodes.filter(function (x) { return x.working; }), first = ws.map(function (x) { return x.taskIds[0]; }).filter(Boolean)[0], ft = first ? ((d.tasks || []).filter(function (t) { return t.id === first; })[0] || {}).title || '' : '';
    foot.append(el('span', 'focus', d.connected === false ? (n.offlineFocus || '連線中斷 · 保留最後紀錄') : lv ? (n.act_working || '工作中') + ' · ' + (first ? taskLabel(first) + ' ' + ft : ws.length + ' ' + (n.unlinkedFocus || '個會話在做未登記的工作')) : (n.idleFocus || '目前沒有 AI 在工作 · 畫面靜止')));
    var hb = el('span', 'hb'); hb.setAttribute('data-hb', '1'); hb.textContent = '讀回 0 秒前'; var lp = el('span', 'lp'); var l1 = el('b', null, '0'); l1.setAttribute('data-lit', '1'); var l2 = el('b', null, '0'); l2.setAttribute('data-pt', '1'); lp.append(document.createTextNode((n.litL || '亮線') + ' '), l1, document.createTextNode(' · ' + (n.particlesL || '粒子') + ' '), l2); foot.append(hb, lp, el('span', 'r', (n.taskUpdated || '任務更新') + ' ' + (d.updatedAt || '—')));
    st.append(foot); S.foot = foot;
  }
  function clip(s, n) { s = String(s || ''); var a = Array.from(s); return a.length > n ? a.slice(0, n - 1).join('') + '…' : s; }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  function flash(node, cls, ms) { if (!S || S.paused || S.reduced) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); setTimeout(function () { node.classList.remove(cls); }, ms); }

  /* ---------- 版面 ---------- */
  function layout() {
    var W = S.root.clientWidth, H = S.root.clientHeight; S.W = W; S.H = H;
    S.narrow = W < 420;
    var left = W >= 1000 ? 196 : W >= 820 ? 176 : 160, tw = W >= 1000 ? 150 : W >= 820 ? 136 : 124; S.tw = tw;
    var free = W - left - tw - 24;
    var gy0 = 34; if (S.ms) { S.ms.style.left = (left + 6) + 'px'; S.ms.style.top = '30px'; S.ms.style.width = Math.max(160, W - left - tw - 36) + 'px'; gy0 = Math.max(34, 30 + S.ms.offsetHeight + 10); }
    S.gy0 = gy0; S.gy1 = H - 30;
    S.cx = left + free / 2 + 6 + S.dx; S.cy = gy0 + (S.gy1 - gy0) * .5 + 4;
    S.rx = clamp(free / 2 - 60, 110, 330); S.ry = clamp(Math.min(S.rx * .5, (S.gy1 - gy0) * .34), 60, 170) * S.tilt;
    S.hx = left / 2 + 2; S.human.style.width = (left - 12) + 'px'; S.human.style.left = S.hx + 'px';
    S.root.classList.remove('tight'); var gaugeBottom = 30 + (S.gauge ? S.gauge.offsetHeight : 90), maxTop = H - 30 - S.human.offsetHeight - S.chips.length * 30 - 6, want = Math.max(gaugeBottom + 8, Math.min(S.cy - 88, maxTop));
    if (want > maxTop) { S.root.classList.add('tight'); gaugeBottom = 30 + (S.gauge ? S.gauge.offsetHeight : 60); want = Math.max(gaugeBottom + 8, Math.min(S.cy - 88, maxTop)); } // 空間不足時收起閒置說明（底部狀態行仍有同一句）
    var hTop = Math.min(want, maxTop); S.human.style.top = hTop + 'px'; S.hy = hTop + 58;
    var hn = S.human.querySelector('.o-hnode'); S.pHuman = { x: S.hx, y: hTop + hn.offsetTop + hn.offsetHeight / 2 };
    S.core.style.left = S.cx + 'px'; S.core.style.top = (S.cy - 14) + 'px';
    var eng = S.core.querySelector('.o-engine'); S.pAI = { x: S.cx, y: S.cy - 14 - S.core.offsetHeight / 2 + eng.offsetTop + eng.offsetHeight * .5 };
    var le = S.core.querySelector('.o-lead'); if (le) { var rr = S.root.getBoundingClientRect(), lr = le.getBoundingClientRect(); S.pLead = { x: lr.left - rr.left + lr.width / 2, y: lr.top - rr.top + lr.height / 2 }; }
    var base = hTop + S.human.offsetHeight + 8; S.pChip = {}; S.chipBase = base;
    S.chips.forEach(function (c, i) { c.el.style.left = S.hx + 'px'; c.el.style.top = (base + i * 30) + 'px'; c.el.style.maxWidth = (left - 14) + 'px'; S.pChip[c.kind] = { x: S.hx, y: base + 13 + i * 30 }; });
    var top = gy0 + 30, bot = S.gy1 - 22, n = S.tasks.length;
    S.tasks.forEach(function (t, i) { var y = n <= 1 ? (top + bot) / 2 : top + (bot - top) * i / (n - 1), x = t.kind === 'unlinked' ? W - 64 : W - tw / 2 - 10; t.el.style.width = t.kind === 'unlinked' ? '112px' : t.kind === 'more' ? '' : tw + 'px'; t.tx = x; t.ty = y; t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; if (t.x == null) { t.x = x; t.y = y; } });
    S.labels.forEach(function (l) { if (l.a == null) { l.el.style.left = (W - tw - 70) + 'px'; l.el.style.top = (S.gy1 - 12) + 'px'; l.el.style.setProperty('--dp', '1'); return; } var x = S.cx + S.rx * 1.08 * Math.cos(l.a), y = S.cy + S.ry * 1.3 * Math.sin(l.a) - 8; l.el.style.left = x + 'px'; l.el.style.top = y + 'px'; l.el.style.setProperty('--dp', depth(l.a).toFixed(3)); });
    var dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    [S.cv, S.fxc].forEach(function (c) { if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; } });
    layoutDirty = false;
  }
  function placeNodes(dt, snap) {
    var lv = Number(S.root.dataset.level) || 0, n = S.nodes.length;
    if (!snap) rot += (lv === 0 ? TAU / 70 : TAU / (42 - 8 * (lv - 1))) * dt;
    S.pSess = {}; S.prevAng = {};
    S.nodes.forEach(function (nd, i) {
      var target = rot + TAU * i / Math.max(1, n);
      if (nd.ang == null || snap) nd.ang = target; else { var diff = Math.atan2(Math.sin(target - nd.ang), Math.cos(target - nd.ang)); nd.ang += diff * Math.min(1, dt * 5); }
      var dp = depth(nd.ang), x = S.cx + S.rx * Math.cos(nd.ang), y = S.cy + S.ry * Math.sin(nd.ang), sc = .78 + .32 * dp;
      // 分工：新會話嘅細成員由統籌成員身邊分三格跳出去
      if (nd.born) { var bt = (performance.now() - nd.born) / 360; if (bt < 1 && S.pLead) { var q = Math.ceil(bt * 3) / 3; x = S.pLead.x + (x - S.pLead.x) * q; y = S.pLead.y + (y - S.pLead.y) * q; sc = sc * (.4 + .6 * q); } else nd.born = 0; }
      nd.x = x; nd.y = y; nd.dp = dp; nd.sc = sc; S.pSess[nd.key] = { x: x, y: y, dp: dp, sc: sc }; S.prevAng[nd.key] = nd.ang;
      nd.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      nd.el.style.setProperty('--dp', dp.toFixed(3)); nd.el.style.zIndex = String(dp > .5 ? 60 : 20);
      var side = dp >= .45 ? 'dn' : 'up'; if (side !== nd.side) { nd.side = side; nd.lb.classList.toggle('up', side === 'up'); nd.lb.classList.toggle('dn', side === 'dn'); }
    });
    S.tasks.forEach(function (t) { var k = snap ? 1 : Math.min(1, dt * 6); t.x += (t.tx - t.x) * k; t.y += (t.ty - t.y) * k; t.el.style.left = t.x.toFixed(1) + 'px'; t.el.style.top = t.y.toFixed(1) + 'px'; });
  }
  function edgePoint(t, from) { var hw = t.w / 2, hh = t.h / 2, dx = from.x - t.tx, dy = from.y - t.ty, sx = dx ? hw / Math.abs(dx) : 1e9, sy = dy ? hh / Math.abs(dy) : 1e9, k = Math.min(sx, sy, 1); return { x: t.tx + dx * k, y: t.ty + dy * k }; }
  function anchor(id, from) {
    if (id === 'human') return S.pHuman; if (id === 'ai') return S.pAI;
    if (id === 'inbox' || id === 'need:inbox') return S.pChip.inbox; if (id === 'need:decision') return S.pChip.decision; if (id === 'need:awaiting') return S.pChip.awaiting;
    if (id.indexOf('session:') === 0) return S.pSess[id.slice(8)] || null;
    if (id.indexOf('task:') === 0 || id === 'unlinked') { var key = id === 'unlinked' ? 'unlinked' : id.slice(5); var t = S.tasks.filter(function (x) { return x.id === key; })[0]; if (!t) return null; return from ? edgePoint(t, from) : { x: t.tx, y: t.ty }; }
    return null;
  }

  /* ---------- 迴圈 ---------- */
  function loop() { if (!S) return; stop(); if (S.paused || document.hidden) { frame(performance.now(), true); return; } S.raf = requestAnimationFrame(tick); }
  function stop() { if (S && S.raf) cancelAnimationFrame(S.raf); if (S) S.raf = 0; }
  function tick(now) { if (!S) return; frame(now, false); S.raf = requestAnimationFrame(tick); }
  function frame(now, still) {
    if (!S.root.isConnected) { stop(); return; }
    if (!still && now - S.lastPaint < 32) return;
    var dt = Math.min(.1, (now - (S.last || now)) / 1000); S.last = now; S.lastPaint = now;
    if (!still) { S.tilt += (S.tTilt - S.tilt) * .06; S.dx += (S.tdx - S.dx) * .06; fxT += dt; }
    if (layoutDirty || S.root.clientWidth !== S.W || S.root.clientHeight !== S.H || Math.abs(S.tilt - (S.layoutTilt || 1)) > .002 || Math.abs(S.dx - (S.layoutDx || 0)) > .5) { layout(); S.layoutTilt = S.tilt; S.layoutDx = S.dx; }
    if (S.narrow) { setData({ lit: 0, particles: 0 }); return; }
    var g = S.ctx, dpr = Math.min(2, devicePixelRatio || 1); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S.W, S.H);
    var lv = Number(S.root.dataset.level) || 0, work = lv > 0, animate = !still && !S.paused, conc = S.data.meta.concurrency || 0;
    placeNodes(animate ? dt : 0, still);
    var particles = 0, twoHop = 0, moving = 0, info = 0, budget = 120;
    var edgeDot = function (path, s, col, glow) { if (particles >= budget) return; dot(g, at(path, s), 3, col, glow); particles++; };
    var infoDot = function (path, s, col, glow) { dot(g, at(path, s), 3, col, glow); info++; }; // 資訊光點：代表待處理數目，不計入工作粒子
    // 地面反射（核心下）：閒置冷色、工作琥珀
    var fy = S.cy + S.ry * .72, grd = g.createRadialGradient(S.cx, fy, 4, S.cx, fy, S.rx * .55); grd.addColorStop(0, work ? 'rgba(232,141,79,.20)' : 'rgba(111,134,184,.10)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.beginPath(); g.ellipse(S.cx, fy, S.rx * .7, S.ry * .34, 0, 0, TAU); g.fill();
    // 軌道橢圓：前後兩半（景深）、96 格刻度、內外雙環、14 個箭頭
    var col = work ? '232,141,79' : '140,160,200';
    for (var half = 0; half < 2; half++) { g.beginPath(); g.ellipse(S.cx, S.cy, S.rx, S.ry, 0, half ? 0 : Math.PI, half ? Math.PI : TAU); g.strokeStyle = 'rgba(' + col + ',' + (half ? (work ? .34 : .22) : (work ? .14 : .09)) + ')'; g.lineWidth = half ? 1.2 : .7; g.setLineDash([2, 5]); g.stroke(); g.setLineDash([]); }
    for (var k = 0; k < 96; k++) { var an = k * TAU / 96, L = k % 8 === 0 ? 9 : k % 2 === 0 ? 5 : 3, dp = depth(an), c1 = Math.cos(an), s1 = Math.sin(an), ky = S.ry / S.rx; g.beginPath(); g.moveTo(S.cx + (S.rx + 4) * c1, S.cy + (S.rx + 4) * ky * s1); g.lineTo(S.cx + (S.rx + 4 + L) * c1, S.cy + (S.rx + 4 + L) * ky * s1); g.strokeStyle = 'rgba(' + col + ',' + ((work ? .34 : .14) * (.45 + .55 * dp)).toFixed(3) + ')'; g.lineWidth = 1; g.stroke(); }
    [.34, .64].forEach(function (kk) { g.beginPath(); g.ellipse(S.cx, S.cy, S.rx * kk, S.ry * kk, 0, 0, TAU); g.strokeStyle = 'rgba(255,255,255,' + (kk < .5 ? .05 : .045) + ')'; g.lineWidth = 1; g.stroke(); });
    var off = (fxT / (work ? 9 : 16)) % 1; for (var ci = 0; ci < 14; ci++) { var a = (ci / 14 + off) * TAU, dpc = depth(a), x = S.cx + S.rx * Math.cos(a), y = S.cy + S.ry * Math.sin(a), tx = -Math.sin(a) * S.rx, ty = Math.cos(a) * S.ry, LL = Math.hypot(tx, ty); tx /= LL; ty /= LL; g.save(); g.translate(x, y); g.rotate(Math.atan2(ty, tx)); g.beginPath(); g.moveTo(-4, -3); g.lineTo(2, 0); g.lineTo(-4, 3); g.strokeStyle = 'rgba(140,160,200,' + (.12 + .28 * dpc).toFixed(2) + ')'; g.lineWidth = 1; g.stroke(); g.restore(); }
    // 前方回流弧：產出 → 創辦人驗收 → 返回決定（氣氛層、冷色、三個慢箭頭）
    var ret = mkPath([curve({ x: S.W - S.tw - 16, y: S.gy1 - 6 }, { x: S.hx + 60, y: S.chipBase + S.chips.length * 30 + 2 }, .16)]);
    strokePath(g, ret, 'rgba(140,160,200,.16)', 1, [4, 6]);
    for (var ri = 0; ri < 3; ri++) { var rs = ((fxT / 22 + ri / 3) % 1) * ret.len, p0 = at(ret, Math.max(0, rs - 3)), p1 = at(ret, Math.min(ret.len, rs + 3)); g.save(); g.translate(p1.x, p1.y); g.rotate(Math.atan2(p1.y - p0.y, p1.x - p0.x)); g.beginPath(); g.moveTo(-5, -3.5); g.lineTo(1, 0); g.lineTo(-5, 3.5); g.strokeStyle = 'rgba(140,160,200,.42)'; g.lineWidth = 1; g.stroke(); g.restore(); }
    // 人↔AI 四股光絲
    [{ b: .05, a: .42, w: 1.2 }, { b: .09, a: .24, w: .9 }, { b: 0, a: .18, w: .8 }, { b: -.05, a: .26, w: .9 }].forEach(function (sd) { strokePath(g, mkPath([curve(S.pHuman, S.pAI, sd.b)]), 'rgba(232,141,79,' + (work ? sd.a : sd.a * .5) + ')', sd.w); });
    // 膠囊連線與慢速資訊光點
    var live = S.data.connected !== false;
    S.chips.forEach(function (c) {
      var cp = S.pChip[c.kind]; if (!cp) return;
      if (c.kind === 'awaiting') { strokePath(g, mkPath([curve(cp, S.pHuman, 0)]), 'rgba(255,255,255,' + (c.count > 0 && live ? .12 : .07) + ')', 1); return; }
      if (c.kind === 'inbox') { var ip = mkPath([curve(cp, S.pAI, .06)]), flow = live && (c.count > 0 || c.processing); strokePath(g, ip, 'rgba(153,215,188,' + (flow ? .3 : .08) + ')', 1); if (flow && animate) { var s = (fxT * (c.processing ? 90 : 60)) % (ip.len + 40); if (s <= ip.len) { trail(g, ip, s, 2.6, '153,215,188', 6, 6); infoDot(ip, s, '#d9fff2', '#99d7bc'); } } return; }
      var dpth = mkPath([curve(S.pAI, cp, -.06)]), fl = live && c.count > 0; strokePath(g, dpth, 'rgba(232,141,79,' + (fl ? .22 : .08) + ')', 1); if (fl && animate) { var s2 = (fxT * 50) % (dpth.len + 60); if (s2 <= dpth.len) { trail(g, dpth, s2, 2.6, '232,141,79', 6, 6); infoDot(dpth, s2, '#ffddbc', '#e88d4f'); } }
    });
    // 會話鏈路：AI → 會話 → 任務（兩段連續）；每條亮線粒子 clamp(1+並發,1,4)
    var speedV = 110 + 30 * lv, per = clamp(1 + conc, 1, 4), lit = 0;
    S.nodes.forEach(function (nd, i) {
      if (nd.key === 'more') { strokePath(g, mkPath([curve(S.pAI, nd, i % 2 ? .07 : -.07)]), 'rgba(255,255,255,.06)', 1, [3, 5]); return; }
      var sp = { x: nd.x, y: nd.y }, bowA = i % 2 ? .07 : -.07, bowB = i % 2 ? -.1 : .1, working = nd.working, dpa = .6 + .4 * nd.dp;
      var targets = nd.taskIds.map(function (id) { return anchor('task:' + id, sp); }).filter(Boolean);
      if (working && !targets.length) { var u = anchor('unlinked', sp); if (u) targets.push(u); }
      if (!targets.length) { strokePath(g, mkPath([curve(S.pAI, sp, bowA)]), working ? 'rgba(232,141,79,' + (.5 * dpa).toFixed(2) + ')' : 'rgba(255,255,255,' + (.075 * dpa).toFixed(3) + ')', working ? 1.3 : 1, working ? null : [3, 5]); if (working) lit++; return; }
      targets.forEach(function (tp, k) {
        var path = mkPath([curve(S.pAI, sp, bowA), curve(sp, tp, bowB)]);
        strokePath(g, path, working ? 'rgba(232,141,79,' + (.5 * dpa).toFixed(2) + ')' : 'rgba(255,255,255,' + (.075 * dpa).toFixed(3) + ')', working ? 1.3 : 1, working ? null : [3, 5]);
        if (!working) return;
        lit++; twoHop++;
        strokePath(g, mkPath([curve(S.pAI, sp, i % 2 ? .095 : -.095), curve(sp, tp, i % 2 ? -.13 : .13)]), 'rgba(153,215,188,.12)', .8);
        if (animate) for (var q = 0; q < per; q++) { var pos = (fxT * speedV + q * path.len / per + i * 37 + k * 53) % path.len; trail(g, path, pos, 3, '255,191,137', 8, 6); edgeDot(path, pos, '#ffddbc', '#e88d4f'); }
        else edgeDot(path, path.len * .5, '#ffddbc', '#e88d4f');
      });
    });
    // 子代理衛星：三圈軌道、最多六顆、方向交替、四段拖尾
    var subDots = 0;
    S.nodes.forEach(function (nd, i) {
      if (!nd.working || !nd.sub) return; var shown = Math.min(6, nd.sub), rings = Math.min(3, shown), sc = nd.sc;
      for (var r = 0; r < rings; r++) { g.beginPath(); g.ellipse(nd.x, nd.y, [31, 39, 47][r] * sc, [31, 39, 47][r] * sc * .78, 0, 0, TAU); g.strokeStyle = 'rgba(232,141,79,.16)'; g.lineWidth = 1; g.stroke(); }
      for (var k2 = 0; k2 < shown; k2++) { var rr = [31, 39, 47][k2 % 3] * sc, spd = (1 + (k2 % 3) * .4) * (k2 % 2 ? -1 : 1), an2 = (animate ? fxT * spd : 0) + k2 * 2.1 + i; if (animate) for (var j = 1; j <= 4; j++) { var a2 = an2 - j * .2 * (spd > 0 ? 1 : -1); dot(g, { x: nd.x + Math.cos(a2) * rr, y: nd.y + Math.sin(a2) * rr * .78 }, 3.2 - j * .6, 'rgba(255,170,100,' + (.55 - j * .11) + ')'); } if (particles >= budget) continue; dot(g, { x: nd.x + Math.cos(an2) * rr, y: nd.y + Math.sin(an2) * rr * .78 }, 3.6, '#ffc08a', '#ff9a4a'); subDots++; particles++; }
    });
    // 事件脈衝與漣漪
    S.pulses = S.pulses.filter(function (p) { return p.until > now; });
    var humanPulse = false;
    if (animate) S.pulses.forEach(function (pl) {
      var t = (now - pl.start) / pl.dur; if (t < 0 || t >= 1) return;
      var a = anchor(pl.from), b = anchor(pl.to, a); if (!a || !b) return;
      var path = mkPath([curve(a, b, pl.direction === 'session-to-task' ? .12 : .1)]), e = 1 - Math.pow(1 - t, 2.2), s = e * path.len;
      strokePath(g, path, 'rgba(' + pl.color + ',' + (.25 * (1 - t)).toFixed(2) + ')', 1.4);
      if (particles < budget) { trail(g, path, s, 5, pl.color, 10, 7); dot(g, at(path, s), 5, 'rgb(' + pl.color + ')', 'rgb(' + pl.color + ')'); particles++; } moving++;
      if (pl.from === 'human' || pl.to === 'human' || pl.to === 'need:decision') humanPulse = true;
    });
    S.ripples = S.ripples.filter(function (r) { return r.until > now; });
    if (animate) S.ripples.forEach(function (rp) { var t = (now - rp.start) / (rp.until - rp.start); if (t < 0 || t >= 1) return; var pt = anchor(rp.id); if (!pt) return; var e = 1 - Math.pow(1 - t, 2); g.beginPath(); g.arc(pt.x, pt.y, 8 + e * 42, 0, TAU); g.strokeStyle = 'rgba(' + rp.color + ',' + (.8 * (1 - t)).toFixed(2) + ')'; g.lineWidth = 1.6 * (1 - t) + .4; g.stroke(); g.beginPath(); g.arc(pt.x, pt.y, 4 + e * 24, 0, TAU); g.strokeStyle = 'rgba(' + rp.color + ',' + (.5 * (1 - t)).toFixed(2) + ')'; g.lineWidth = 1; g.stroke(); });
    S.floats = S.floats.filter(function (f) { return f.until > now; });
    if (S.humanPulseUntil && now > S.humanPulseUntil && S.humanLabel) { S.humanLabel = ''; S.humanStatus.textContent = (S.n.pendingGlobal || '全局 {n} 項待決').replace('{n}', S.data.counts.pending) + ' · ' + (S.n.viewDesk || '查看待決事項'); S.humanPulseUntil = 0; }
    setData({ lit: lit, particles: still || S.paused ? 0 : particles, twoHop: twoHop, sub: subDots, moving: still || S.paused ? 0 : twoHop + moving, aiChannels: lit, infoFlows: info, humanPulse: humanPulse && !still, floats: Math.min(4, S.floats.length) });
    celebrateFrame(now);
  }
  function setData(d) { var ds = S.cv.dataset; ds.lit = String(d.lit); ds.particles = String(d.particles); ds.twoHop = String(d.twoHop || 0); ds.sub = String(d.sub || 0); ds.moving = String(d.moving || 0); ds.aiChannels = String(d.aiChannels || 0); ds.infoFlows = String(d.infoFlows || 0); ds.humanPulse = String(!!d.humanPulse); ds.floats = String(d.floats || 0); if (!ds.lastPulse) ds.lastPulse = 'none'; ds.level = S.root.dataset.level; if (S.foot) { var a = S.foot.querySelector('[data-lit]'), b = S.foot.querySelector('[data-pt]'); if (a) a.textContent = String(d.lit); if (b) b.textContent = String(d.particles); } }

  /* ---------- 脈衝（只由真實事件或標明示意的事件呼叫）---------- */
  function pulse(spec) {
    if (!S || !spec || !spec.from || !spec.to) return;
    var now = performance.now(), dur = 1350, color = PULSE_COLOR[spec.direction] || '255,221,188', target = spec.to;
    if (target === 'human' && spec.direction === 'ai-to-human') target = 'need:decision';
    var text = String(spec.title || '').slice(0, 16);
    S.pulses = S.pulses.filter(function (p) { return p.until > now; }).concat([{ from: spec.from, to: target, title: text, direction: spec.direction, color: color, start: now, dur: dur, until: now + dur + 20 }]).slice(-8);
    S.ripples = S.ripples.filter(function (r) { return r.until > now; }).concat([{ id: spec.from, start: now, until: now + 1150, color: color }, { id: spec.from, start: now + 160, until: now + 1310, color: color }, { id: spec.rippleTarget || target, start: now + dur, until: now + dur + 1150, color: color }]).slice(-12);
    if (text && !S.paused && !S.narrow && S.fx) addFloat(anchor(spec.from), text, spec.direction === 'human-to-ai' || spec.direction === 'inbox-to-ai');
    S.cv.dataset.lastPulse = spec.direction || 'unknown';
    if (spec.direction === 'human-to-ai') { var dn = S.human.querySelector('.o-hnode'); if (dn) flash(dn, 'lit', 1200); S.humanPulseUntil = now + 1500; S.humanLabel = S.n.humanHandoff || '已收到你的決定 · 交 AI 團隊'; S.humanStatus.textContent = S.humanLabel; }
    if (spec.onArrive) setTimeout(spec.onArrive, dur);
    if (spec.from.indexOf('session:') === 0) { var nd = S.nodes.filter(function (x) { return 'session:' + x.key === spec.from; })[0]; if (nd) flash(nd.el, 'recent', 320); }
  }
  function addFloat(point, title, mint) {
    if (!point) return; var layer = S.stage; while (layer.querySelectorAll('.o-float').length >= 4) layer.querySelector('.o-float').remove();
    var f = el('div', 'o-float' + (mint ? ' mint' : ''), title); f.style.left = clamp(point.x, 90, S.W - 90) + 'px'; f.style.top = clamp(point.y - 30, 34, S.H - 40) + 'px'; layer.appendChild(f); setTimeout(function () { f.remove(); }, 3700);
    S.floats = S.floats.filter(function (x) { return x.until > performance.now(); }).concat([{ until: performance.now() + 3600 }]).slice(-4);
  }

  /* ---------- 慶祝三級（運作環內的部分；頁面層的橫幅、數字與事件行由頁面負責） ---------- */
  var FX = {};
  FX[1] = { dur: 1400,
    setup: function (c) { var i = c.info; c.task = S.tasks.filter(function (t) { return t.id === i.taskId; })[0] || S.tasks.filter(function (t) { return t.kind === 'task'; })[0] || null; c.sess = S.nodes.filter(function (x) { return x.key === i.sessionKey; })[0] || S.nodes.filter(function (x) { return x.working; })[0] || null; if (c.task) { c.flashEl = el('i', 'fxf'); c.sweepEl = el('i', 'fxs'); c.task.el.append(c.flashEl, c.sweepEl); } },
    update: function (p, c) { if (c.task) { var fl = p < .03 ? p / .03 : 1 - seg(p, .03, .2); c.flashEl.style.opacity = String(clamp(fl * .85, 0, 1)); var sw = seg(p, .05, .4); c.sweepEl.style.setProperty('--sx', lerp(-130, 330, E.io(sw)).toFixed(1) + '%'); c.sweepEl.style.opacity = sw > 0 && sw < 1 ? '1' : '0'; c.task.el.style.transform = 'translate(-50%,-50%) scale(' + (1 + .06 * E.bump(seg(p, 0, .2))).toFixed(3) + ')'; c.task.el.classList.toggle('done', p >= .12); } if (c.sess) c.sess.el.style.filter = 'brightness(' + (1 + .9 * E.bump(seg(p, .02, .4))).toFixed(2) + ')'; },
    draw: function (g, p, c) { if (c.sess) { ring(g, c.sess.x, c.sess.y, lerp(16, 52, E.out(seg(p, .02, .4))), (1 - seg(p, .02, .4)) * .9, 2.5 - 1.2 * seg(p, .02, .4)); ring(g, c.sess.x, c.sess.y, lerp(16, 44, E.out(seg(p, .12, .5))), (1 - seg(p, .12, .5)) * .6, 1.4); if (c.task) { var tp = anchor('task:' + c.task.id, c.sess); if (tp) { var path = mkPath([curve(c.sess, tp, .1)]), s = E.out(seg(p, 0, .22)) * path.len; strokePath(g, path, 'rgba(153,215,188,' + (.55 * (1 - seg(p, .15, .35))).toFixed(2) + ')', 1.6); trail(g, path, s, 3.2, '153,215,188', 8, 6); dot(g, at(path, s), 3.4, '#d9fff2', '#99d7bc'); } } } var k = seg(p, .2, .62); ringE(g, S.pAI.x, S.pAI.y + 8, lerp(34, 96, E.out(k)), lerp(15, 43, E.out(k)), (1 - k) * .85 * (p > .2 ? 1 : 0), 2.2 - 1.2 * k); },
    cleanup: function (c) { if (c.task) { c.flashEl.remove(); c.sweepEl.remove(); c.task.el.style.transform = ''; } if (c.sess) c.sess.el.style.filter = ''; } };
  FX[2] = { dur: 2000,
    setup: function (c) { var i = c.info, n = S.n; c.bn = el('div', 'o-bn o-bn2'); var ic = el('span', 'ic'); var s = sv('svg', { viewBox: '0 0 24 24' }); s.append(sv('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })); ic.append(s); c.bn.append(ic, el('span', 'k', n.objectiveDone || '條件達成'), el('span', 'z', i.text || ''), el('span', 'n', (n.metL || '達成') + ' ' + (i.k || 1) + ' / ' + (i.m || 1)), el('span', 'sw')); S.fxa.append(c.bn); c.sw = c.bn.querySelector('.sw'); c.lab = el('div', 'o-fl', n.awaitConfirm || '待你確認'); S.fxa.append(c.lab); if (S.ms) { c.glow = S.ms.querySelector('.mbar u'); } },
    update: function (p, c) { var bw = Math.max(320, S.W - S.tw - 34); c.bn.style.left = '0px'; c.bn.style.top = (S.gy0 + 6) + 'px'; c.bn.style.width = bw + 'px'; var ein = E.out(seg(p, 0, .14)), eout = E.in(seg(p, .64, .78)); c.bn.style.opacity = String(ein * (1 - eout)); c.bn.style.transform = 'translateX(' + (lerp(-70, 0, ein) + lerp(0, 80, eout)).toFixed(1) + 'px)'; c.sw.style.transform = 'translateX(' + lerp(-120, 420, E.io(seg(p, .04, .42))).toFixed(1) + '%) skewX(-18deg)'; var lb = seg(p, .8, .88) * (1 - seg(p, .97, 1)); c.lab.style.opacity = String(lb); c.lab.style.left = (S.pHuman.x + 80) + 'px'; c.lab.style.top = (S.pHuman.y - 8) + 'px'; if (c.glow) { var cs = E.in(seg(p, .08, .5)); c.glow.style.opacity = String(cs > 0 && cs < 1 ? 1 : 1 - seg(p, .5, .64)); } },
    draw: function (g, p) { var k = seg(p, .4, .62); ringE(g, S.pAI.x, S.pAI.y + 8, lerp(34, 84, E.out(k)), lerp(15, 38, E.out(k)), (1 - k) * .8 * (p > .4 ? 1 : 0), 2); var path = mkPath([curve(S.pAI, S.pHuman, .05)]), t = seg(p, .42, .82), head = E.io(t) * path.len; if (t > 0 && t < 1) { strokePath(g, path, 'rgba(153,215,188,' + (.25 * E.bump(t)).toFixed(2) + ')', 1.2); for (var i = 0; i < 9; i++) { var s = head - i * 13; if (s < 0 || s > path.len) continue; var a = 1 - i / 9; dot(g, at(path, s), lerp(1.8, 3.6, a), 'rgba(217,255,242,' + (a * .95).toFixed(2) + ')', '#99d7bc'); } } var hk = seg(p, .8, 1); ring(g, S.pHuman.x, S.pHuman.y, lerp(12, 52, E.out(hk)), (1 - hk) * .9 * (p > .8 ? 1 : 0), 2.2); ring(g, S.pHuman.x, S.pHuman.y, lerp(12, 40, E.out(seg(p, .86, 1))), (1 - seg(p, .86, 1)) * .6 * (p > .86 ? 1 : 0), 1.3); },
    cleanup: function (c) { c.bn.remove(); c.lab.remove(); if (c.glow) c.glow.style.opacity = '0'; } };
  FX[3] = { dur: 3000,
    setup: function (c) { var i = c.info, n = S.n; c.dim = el('div', 'o-dim'); S.fxa.append(c.dim); c.bn = el('div', 'o-bn o-bn3'); var fl = el('img', 'o-flag'); fl.src = '/assets/clay-fx-flag.webp'; fl.alt = ''; fl.addEventListener('error', function () { fl.remove(); }); c.bn.append(fl); ['a', 'b', 'c', 'd'].forEach(function (k) { c.bn.append(el('i', 'cn ' + k)); }); c.bn.append(el('span', 'sw'), el('div', 'eb', n.stageClearEyebrow || '里程碑已達成'), el('div', 'k', n.stageClear || '里程碑達成'), el('div', 's', (i.stageName || '') + (i.nextName ? ' → ' + (n.nextStage || '進入下一站') + '：' + i.nextName : ''))); S.fxa.append(c.bn); c.k = c.bn.querySelector('.k'); c.sw = c.bn.querySelector('.sw'); var maxD = Math.hypot(Math.max(S.pAI.x, S.W - S.pAI.x), Math.max(S.pAI.y, S.H - S.pAI.y)); c.pts = []; S.nodes.forEach(function (nd) { c.pts.push({ el: nd.el, x: nd.x, y: nd.y }); }); S.tasks.forEach(function (t) { c.pts.push({ el: t.el, x: t.tx, y: t.ty }); }); S.chips.forEach(function (ch) { var p = S.pChip[ch.kind]; if (p) c.pts.push({ el: ch.el, x: p.x, y: p.y }); }); c.pts.push({ el: S.human, x: S.pHuman.x, y: S.pHuman.y }); c.pts.forEach(function (q) { q.ta = .07 + .43 * (Math.hypot(q.x - S.pAI.x, q.y - S.pAI.y) / maxD); }); },
    update: function (p, c) { c.dim.style.opacity = String(seg(p, 0, .08) * (1 - seg(p, .78, .96))); var bw = Math.min(660, S.W - S.tw - 70); c.bn.style.width = bw + 'px'; c.bn.style.left = (S.cx - bw / 2) + 'px'; c.bn.style.top = Math.max(S.gy0 + 4, S.cy - 168) + 'px'; var ein = seg(p, .1, .26), eout = E.in(seg(p, .84, .97)); c.bn.style.opacity = String(E.out(ein) * (1 - eout)); c.bn.style.transform = 'translateY(' + (-10 * eout).toFixed(1) + 'px) scale(' + lerp(.9, 1, E.back(ein)).toFixed(3) + ')'; c.k.style.letterSpacing = lerp(.7, .28, E.out(seg(p, .1, .4))).toFixed(3) + 'em'; c.sw.style.transform = 'translateX(' + lerp(-120, 420, E.io(seg(p, .16, .52))).toFixed(1) + '%) skewX(-18deg)'; var sync = E.bump(seg(p, .5, .62)) * .5; c.pts.forEach(function (q) { var k = .9 * E.bump(seg(p, q.ta - .02, q.ta + .14)) + sync; q.el.style.filter = k > .01 ? 'brightness(' + (1 + k).toFixed(2) + ')' : ''; }); },
    draw: function (g, p, c) { var maxR = Math.hypot(Math.max(S.pAI.x, S.W - S.pAI.x), Math.max(S.pAI.y, S.H - S.pAI.y)) * 1.02, ax = S.pAI.x, ay = S.pAI.y + 8, burst = seg(p, .04, .3); if (burst > 0 && burst < 1) { var gr = g.createRadialGradient(ax, ay, 0, ax, ay, lerp(20, 170, E.out(burst))); gr.addColorStop(0, 'rgba(217,255,242,' + (.55 * (1 - burst)).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(153,215,188,0)'); g.fillStyle = gr; g.fillRect(0, 0, S.W, S.H); } [[.06, .52, .9, 3.4], [.13, .6, .62, 2.2], [.22, .68, .4, 1.4]].forEach(function (x) { var k = seg(p, x[0], x[1]); if (k > 0 && k < 1) ringE(g, ax, ay, E.out(k) * maxR, E.out(k) * maxR * .62, (1 - k * k) * x[2], x[3] * (1 - .5 * k)); }); c.pts.forEach(function (q) { var k = seg(p, q.ta - .02, q.ta + .2); if (k > 0 && k < 1) ring(g, q.x, q.y, lerp(8, 36, E.out(k)), (1 - k) * .85, 1.8); }); },
    cleanup: function (c) { c.dim.remove(); c.bn.remove(); c.pts.forEach(function (q) { q.el.style.filter = ''; }); } };
  function celebrate(level, info, freezeAt) {
    if (!S || !FX[level]) return; if (S.cur) { try { S.cur.def.cleanup(S.cur.c); } catch (e) { } S.cur = null; }
    if (S.paused || S.reduced || !S.fx || S.narrow) return;
    layoutDirty = true; layout(); placeNodes(0, true);
    var def = FX[level], c = { info: info || {} }; try { def.setup(c); } catch (e) { return; }
    S.cur = { def: def, c: c, t0: performance.now(), dur: def.dur, freeze: typeof freezeAt === 'number' ? clamp(freezeAt, 0, 1) : null };
    if (level >= 2 && freezeAt == null) burst(level);
  }
  function celebrateFrame(now) {
    var g = S.fctx, dpr = Math.min(2, devicePixelRatio || 1); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S.W, S.H);
    if (!S.cur) return; var cur = S.cur, p = cur.freeze != null ? cur.freeze : clamp((now - cur.t0) / cur.dur, 0, 1);
    try { cur.def.update(p, cur.c); cur.def.draw(g, p, cur.c); } catch (e) { S.cur = null; return; }
    if (cur.freeze == null && p >= 1) { try { cur.def.cleanup(cur.c); } catch (e) { } S.cur = null; g.clearRect(0, 0, S.W, S.H); }
  }

  /* ---------- 慶祝粒子（二級 40、三級 80，1.6 秒重力下落） ---------- */
  function burst(level) {
    if (document.body.classList.contains('paused')) return;
    var cv = document.createElement('canvas'); cv.className = 'burst'; document.body.append(cv); var ctx = cv.getContext('2d'); var W = cv.width = innerWidth, H = cv.height = Math.min(innerHeight, 420);
    var N = level >= 3 ? 80 : 40, ps = []; for (var i = 0; i < N; i++) ps.push({ x: W / 2, y: 70, vx: (Math.random() - .5) * 9, vy: -Math.random() * 7 - 2, c: Math.random() < .5 ? '232,141,79' : '153,215,188', r: 1.5 + Math.random() * 2 });
    var t0 = performance.now();
    (function f(now) { var t = (now - t0) / 1600; ctx.clearRect(0, 0, W, H); if (t >= 1) { cv.remove(); return; } ps.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.vy += .22; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fillStyle = 'rgba(' + p.c + ',' + (1 - t) + ')'; ctx.fill(); }); requestAnimationFrame(f); })(t0);
  }

  var api = {
    mount: mount, destroy: destroy, poseOf: poseOf, burst: burst, pulse: pulse, celebrate: celebrate,
    flashSession: function (key) { if (!S) return; var nd = S.nodes.filter(function (x) { return x.key === key; })[0]; if (nd) flash(nd.el, 'recent', 320); },
    setPaused: function (p) { if (S) { S.paused = !!p; loop(); } },
    setFx: function (on) { if (S) { S.fx = !!on; if (!on && S.cur) { try { S.cur.def.cleanup(S.cur.c); } catch (e) { } S.cur = null; } } },
    relayout: function () { layoutDirty = true; },
    state: function () { if (!S) return null; var ds = S.cv.dataset; return { level: ds.level, lit: ds.lit, particles: ds.particles, twoHop: ds.twoHop, sub: ds.sub, moving: ds.moving, floats: ds.floats, lastPulse: ds.lastPulse, sessions: S.nodes.length, working: S.nodes.filter(function (x) { return x.working; }).length, tasks: S.tasks.length, chips: S.chips.length }; }
  };
  window.ORBIT = api;
})();
