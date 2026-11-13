// 生意模式圖畫面元件：開局、公司現況及公司概覽共用；所有外來文字均以 textContent 寫入。
(function (g) {
  'use strict';
  var C = g.SOS_CANVAS || {}, N = g.SOS_NAMES || { ui: {} }, U = N.ui || {};
  var CELLS = C.CELLS || [
    { key: 'partners', area: 'pa' }, { key: 'activities', area: 'ac' }, { key: 'resources', area: 're' },
    { key: 'value', area: 'va' }, { key: 'relationship', area: 'cr' }, { key: 'channel', area: 'ch' },
    { key: 'customer', area: 'cu' }, { key: 'cost', area: 'co' }, { key: 'revenue', area: 'rv' }
  ];
  var faces = ['charge', 'form', 'scale'];
  function t(key, data) { return (data && data[key]) || U[key] || key; }
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = String(text); return node; }
  function fieldTag(tag) { return el('span', 'cv-tag ' + tag, t('origin_' + tag)); }
  function cellName(key) { return t('cell_' + key); }
  function faceName(key) { return t('face_' + key); }
  function valueOf(view, key) {
    var cells = view && view.cells || {}, cell = cells[key] || {};
    return { text: String(cell.text || ''), tag: cell.tag || 'open', fieldId: cell.fieldId || '', sub: cell.sub || {} };
  }
  function addStyle() {
    if (document.getElementById('sos-canvas-style')) return;
    var style = document.createElement('style'); style.id = 'sos-canvas-style';
    style.textContent = '.sos-canvas{min-width:0}.cv-head{display:flex;gap:8px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}.cv-faces{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.cv-face{display:inline-flex;gap:6px;align-items:baseline;border:1px solid var(--line);border-radius:8px;padding:4px 9px;background:rgba(255,255,255,.02);font-size:var(--fs-sub)}.cv-face small{color:var(--muted);font-size:var(--fs-label)}.cv-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:8px;margin-top:10px}.cv-cell{min-width:0;display:flex;flex-direction:column;gap:6px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:rgba(14,15,19,.9)}.cv-cell.cv-open{border-style:dashed;border-color:rgba(239,179,127,.65)}.cv-cell h4{display:flex;justify-content:space-between;gap:6px;align-items:flex-start;margin:0;color:var(--amber);font-size:var(--fs-sub)}.cv-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-sub);line-height:1.55}.cv-sub-k{display:block;color:var(--muted);font-size:var(--fs-label);margin-top:4px}.cv-tag{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:6px;padding:2px 6px;color:var(--muted);font-size:var(--fs-label);font-weight:400;white-space:nowrap}.cv-tag.mine,.cv-tag.pick{color:var(--mint);border-color:rgba(153,215,188,.65)}.cv-tag.zero{color:var(--amber);border-color:rgba(232,141,79,.7)}.cv-tag.open{color:var(--wait);border-style:dashed}.cv-pa{grid-column:1/3;grid-row:1/3}.cv-ac{grid-column:3/5;grid-row:1}.cv-re{grid-column:3/5;grid-row:2}.cv-va{grid-column:5/7;grid-row:1/3}.cv-cr{grid-column:7/9;grid-row:1}.cv-ch{grid-column:7/9;grid-row:2}.cv-cu{grid-column:9/11;grid-row:1/3}.cv-co{grid-column:1/6;grid-row:3}.cv-rv{grid-column:6/11;grid-row:3}.cv-level{margin-top:auto;padding-top:7px;border-top:1px dashed var(--line);font-size:var(--fs-label);color:var(--muted)}.cv-level b{font-weight:600}.cv-level.l0 b{color:#a9b0bd}.cv-level.l1 b{color:#c2d6fa}.cv-level.l2 b{color:#efb37f}.cv-level.l3 b{color:#99d7bc}.cv-level.l4 b{color:#5fd3a0}.cv-bars{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-top:4px}.cv-bars i{height:4px;border-radius:2px;background:rgba(255,255,255,.08)}.cv-bars.l0 i:first-child{background:#5d6473}.cv-bars.l1 i:nth-child(-n+2){background:#c2d6fa}.cv-bars.l2 i:nth-child(-n+3){background:#efb37f}.cv-bars.l3 i:nth-child(-n+4){background:#99d7bc}.cv-bars.l4 i{background:#5fd3a0}.cv-actions,.cv-sug-actions,.cv-inline-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:auto}.cv-actions .btn,.cv-sug-actions .btn,.cv-inline-actions .btn{font-size:var(--fs-label)}.cv-inline-editor{display:grid;gap:7px;margin-top:4px}.cv-inline-editor textarea{width:100%;min-height:82px;box-sizing:border-box;resize:vertical}.cv-alt-charge{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cv-alt-charge>div{min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px}.cv-alt-charge .cv-alt-zero{border-color:rgba(232,141,79,.5)}.cv-alt-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.cv-mini{grid-auto-rows:28px;gap:3px}.cv-mini .cv-cell{padding:2px;border-radius:5px;display:grid;place-items:center;text-align:center;font-size:10px;line-height:1.1;overflow:hidden}.cv-mini .cv-cell h4{display:block;color:inherit;font-size:10px}.cv-mini .cv-cell .cv-text,.cv-mini .cv-cell .cv-tag,.cv-mini .cv-cell .cv-level{display:none}.cv-mini .cv-cell.l0{border-style:dashed}.cv-mini .cv-cell.l1{background:rgba(194,214,250,.12);border-color:rgba(194,214,250,.35)}.cv-mini .cv-cell.l2{background:rgba(239,179,127,.16);border-color:rgba(239,179,127,.45)}.cv-mini .cv-cell.l3{background:rgba(153,215,188,.2);border-color:rgba(153,215,188,.6)}.cv-mini .cv-cell.l4{background:rgba(95,211,160,.28);border-color:rgba(95,211,160,.8)}.cv-legend{display:flex;gap:9px;flex-wrap:wrap;margin:9px 0;font-size:var(--fs-label);color:var(--muted)}.cv-note{font-size:var(--fs-sub);color:var(--muted);margin:8px 0 0}.cv-suggestion{border-color:rgba(232,141,79,.6);background:rgba(232,141,79,.045)}.cv-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cv-compare>div{border:1px solid var(--line);border-radius:8px;padding:8px}.cv-compare .new{border-color:rgba(232,141,79,.5)}.cv-compare small{display:block;color:var(--muted);font-size:var(--fs-label);margin-bottom:3px}.cv-edit{all:unset;cursor:pointer;display:block}.cv-model-notes{margin-top:8px;font-size:var(--fs-sub);color:var(--muted)}.cv-model-notes p{margin:5px 0}.cv-prev{margin-top:8px}.cv-hidden-level{font-size:var(--fs-sub);color:var(--muted);margin-top:8px}@media(max-width:600px){.cv-grid:not(.cv-mini){grid-template-columns:1fr 1fr}.cv-grid:not(.cv-mini) .cv-cell{grid-column:auto;grid-row:auto}.cv-grid:not(.cv-mini) .cv-cu,.cv-grid:not(.cv-mini) .cv-va,.cv-grid:not(.cv-mini) .cv-re,.cv-grid:not(.cv-mini) .cv-co,.cv-grid:not(.cv-mini) .cv-rv{grid-column:1/3!important}.cv-compare,.cv-alt-charge{grid-template-columns:1fr}}';
    style.textContent += '.cv-legends{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:9px 0}.cv-legends .cv-legend{margin:0}.cv-legend{align-items:center}.cv-legend-item{display:inline-flex;gap:5px;align-items:center}.cv-level-swatch{width:8px;height:8px;border-radius:2px;background:#5d6473}.cv-level-swatch.l1{background:#c2d6fa}.cv-level-swatch.l2{background:#efb37f}.cv-level-swatch.l3{background:#99d7bc}.cv-level-swatch.l4{background:#5fd3a0}.cv-legend-label{color:var(--muted)}.cv-level-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.cv-mini .cv-cu{display:grid;place-items:center;text-align:center;overflow:hidden}.cv-mini .cv-cu h4{font-size:10px;line-height:1.15}.cv-mini .cv-cu .cv-sub-k,.cv-mini .cv-cu .cv-sub-k~*{display:none}.cv-mini .cv-cu .cv-text{display:none}.cv-full-head{margin-bottom:8px}.cv-head-actions{display:inline-flex;gap:7px;align-items:center;flex-wrap:wrap}.cv-journey-legend{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;font-size:var(--fs-label);color:var(--muted)}';
    style.textContent += '.cv-cell-tags{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.cv-mini .cv-cell.cv-suggestion{border-color:var(--amber);color:#ffd3ae}.cv-compare .new ins{text-decoration:none;color:#ffd3ae;background:rgba(232,141,79,.14);border-radius:3px;padding:0 2px}.cv-level-head>span{white-space:nowrap}.cv-note .cv-weak-cells{color:var(--amber);font-weight:600}.cv-sug-actions .small{color:var(--muted);font-size:var(--fs-label)}.cv-confirmed{display:inline-flex;gap:6px;align-items:center;margin-left:auto}.cv-mini-foot{justify-content:space-between;width:100%;margin-top:12px}@media(min-width:601px){.cv-grid:not(.cv-mini) .cv-cell.cv-open{min-height:150px}.cv-cell.cv-open .cv-text{color:var(--muted)}}@media(max-width:600px){.cv-confirmed{width:100%;justify-content:flex-end;margin-left:0}}';
    // 原型對照第二輪：未定標籤橙色虛線框、未定格格名用等候色；圖例「假設」空心虛線；手機級別名不斷行；完整九格每行最少 150px，成本收入 118px
    style.textContent += '.cv-tag.open{border-color:var(--wait)}.cv-cell.cv-open h4{color:var(--wait)}.cv-level-swatch:not(.l1):not(.l2):not(.l3):not(.l4){background:transparent;border:1px dashed rgba(255,255,255,.35)}.cv-level-head b{white-space:nowrap}@media(min-width:601px){.cv-grid:not(.cv-mini){grid-auto-rows:minmax(150px,auto)}.cv-grid:not(.cv-mini) .cv-co,.cv-grid:not(.cv-mini) .cv-rv{min-height:118px}}';
    document.head.append(style);
  }
  function modelNotes(data) {
    var cards = Array.isArray(data && data.cards) ? data.cards : [];
    if (!cards.length) return null;
    var d = el('details', 'cv-model-notes'), s = el('summary', '', t('cvModelNotes'));
    d.append(s); cards.forEach(function (card) {
      var name = card.en ? String(t('cvModelNameEn')).replace('{name}', card.name || '').replace('{en}', card.en) : (card.name || '');
      d.append(el('p', '', name + (card.logic ? '：' + card.logic : '')));
    }); return d;
  }
  function evidenceName(level) { return typeof N.evName === 'function' ? N.evName(Number(level || 0)) : ''; }
  function evidenceLegend(labeled) {
    var box = el('div', 'cv-legend');
    if (labeled) box.append(el('span', 'cv-legend-label', t('cvLevel') + '：'));
    for (var i = 0; i < 5; i++) { var item = el('span', 'cv-legend-item l' + i); item.append(el('i', 'cv-level-swatch l' + i), document.createTextNode(evidenceName(i))); box.append(item); }
    return box;
  }
  function originLegend() {
    var box = el('div', 'cv-legend cv-origin-legend');
    box.append(el('span', 'cv-legend-label', t('cvOrigin')), fieldTag('mine'), fieldTag('pick'), fieldTag('zero'));
    return box;
  }
  function legends() { var box = el('div', 'cv-legends'); box.append(originLegend(), evidenceLegend(true)); return box; }
  function appendFaces(root, data, opts) {
    var model = data && data.model, list = [];
    if (model && model.faces) faces.forEach(function (face) { var picked = model.faces[face]; if (Array.isArray(picked) && picked[0]) list.push([face, picked[0].name || '']); });
    if (data && data.type) list.unshift(['type', data.type]);
    if (data && data.goal && data.goal !== 'open') list.push(['goal', t(typeof data.goal === 'string' && /^goal_/.test(data.goal) ? data.goal : 'goal_' + data.goal)]);
    if (!list.length) return;
    var box = el('div', 'cv-faces'); list.forEach(function (item) { var p = el('span', 'cv-face'); p.append(el('small', '', faceName(item[0])), document.createTextNode(item[1])); box.append(p); }); root.append(box);
    if (opts && opts.notes) { var notes = modelNotes(data); if (notes) root.append(notes); }
  }
  function levelBlock(level) {
    var node = el('div', 'cv-level l' + Number(level && level.level || 0));
    var head = el('div', 'cv-level-head');
    head.append(el('span', '', t('cvLevel')), el('b', '', Number(level && level.level || 0) === 0 ? t('cvVNoLinks') : evidenceName(level.level)));
    node.append(head);
    var bars = el('div', 'cv-bars l' + Number(level && level.level || 0)); for (var i = 0; i < 5; i++) bars.append(el('i')); node.append(bars);
    if (level && level.why) node.append(el('span', '', String(t('cvLevelWhy')).replace('{why}', level.why)));
    return node;
  }
  // max：與伺服器一致的字數上限（呼叫者傳入）。onSave 回傳 promise 時，儲存成功才關閉；失敗保留編輯框及內容（原因由呼叫者提示）
  function inlineEditor(cell, initial, onSave, max) {
    var old = cell.querySelector('.cv-inline-editor'); if (old) old.remove();
    var form = el('div', 'cv-inline-editor'), input = document.createElement('textarea'), actions = el('div', 'cv-inline-actions');
    input.rows = 4; input.value = String(initial || ''); input.setAttribute('aria-label', t('cvOwnEdit'));
    if (max > 0) input.maxLength = max;
    function close() { form.remove(); }
    function save() {
      var text = input.value.trim(); if (!text) { input.focus(); return; }
      var done = onSave(text);
      if (!done || typeof done.then !== 'function') { close(); return; }
      submit.disabled = true;
      done.then(close, function () { submit.disabled = false; input.focus(); });
    }
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.preventDefault(); close(); } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); } });
    var submit = el('button', 'btn primary', t('jrCellSave')), cancel = el('button', 'btn', t('jrCellCancel'));
    submit.type = 'button'; cancel.type = 'button'; submit.addEventListener('click', save); cancel.addEventListener('click', close);
    actions.append(submit, cancel); form.append(input, actions); cell.append(form); input.focus();
  }
  function editableText(cell, value, opts, target) {
    var text = el('div', 'cv-text', value.text || t('origin_open'));
    if (opts && typeof opts.onEdit === 'function') { text.classList.add('cv-edit'); text.tabIndex = 0; text.title = U.cvEditHint || ''; text.addEventListener('click', function () { inlineEditor(cell, value.text, function (next) { return opts.onEdit(target, value, next); }, opts.editMax); }); text.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); inlineEditor(cell, value.text, function (next) { opts.onEdit(target, value, next); }); } }); }
    cell.append(text);
  }
  function appendChangedText(node, before, after) {
    before = String(before || ''); after = String(after || '');
    var start = 0, end = 0;
    while (start < before.length && start < after.length && before.charAt(start) === after.charAt(start)) start++;
    while (end < before.length - start && end < after.length - start && before.charAt(before.length - 1 - end) === after.charAt(after.length - 1 - end)) end++;
    node.append(document.createTextNode(after.slice(0, start)));
    var changed = after.slice(start, after.length - end);
    if (changed) node.append(el('ins', '', changed));
    node.append(document.createTextNode(after.slice(after.length - end)));
  }
  function suggestionCell(cell, item, value, opts) {
    cell.classList.add('cv-suggestion');
    cell.append(el('p', 'cv-note', item.why || ''));
    var cmp = el('div', 'cv-compare'), now = el('div', 'now'), next = el('div', 'new');
    var nextText = el('div', '');
    now.append(el('small', '', t('cvNowText')), el('div', '', value.text || item.now || '')); appendChangedText(nextText, value.text || item.now || '', item.text); next.append(el('small', '', t('cvNewText')), nextText); cmp.append(now, next); cell.append(cmp);
    var actions = el('div', 'cv-sug-actions');
    [['adopt', 'cvAdopt'], ['reject', 'cvReject'], ['edit', 'cvOwnEdit']].forEach(function (spec) { var b = el('button', spec[0] === 'adopt' ? 'btn primary' : spec[0] === 'edit' ? 'btn link' : 'btn', t(spec[1])); b.type = 'button'; b.addEventListener('click', function () { if (!opts || typeof opts.onSuggestion !== 'function') return; if (spec[0] === 'edit') inlineEditor(cell, item.text, function (next) { return opts.onSuggestion(item, 'edit', next); }, opts.editMax); else opts.onSuggestion(item, spec[0], ''); }); actions.append(b); }); actions.append(el('span', 'small muted', t('cvSugNote'))); cell.append(actions);
  }
  function alternativeCharge(data, spec, value, opts) {
    var alt = opts && opts.altCharge && spec.key === 'revenue' && data && data.model && data.model.altCharge;
    if (!alt || !alt.text) return null;
    var box = el('div', 'cv-alt-charge'), current = el('div', 'cv-alt-current'), next = el('div', 'cv-alt-zero'), head = el('div', 'cv-alt-head', t('cvAltCharge'));
    editableText(current, value, opts, spec.key);
    head.append(fieldTag('zero'));
    next.append(head, el('div', 'cv-text', alt.text), el('p', 'cv-note', t('cvAltChargeNote')));
    box.append(current, next); return box;
  }
  function journeyOpenValue(value, opts, key) {
    return value && value.tag === 'open' && opts && opts.journey ? Object.assign({}, value, { text: t('jrVOpen_' + key) }) : value;
  }
  function card(data, spec, opts) {
    var view = data && data.view ? data.view : data || {}, value = valueOf(view, spec.key), levels = data && data.levels || {}, level = levels[spec.key] || { level: 0, why: '' };
    var cell = el('article', 'cv-cell cv-' + spec.area + ' cv-' + value.tag + ((opts && opts.levelsShown) ? ' l' + Number(level.level || 0) : ''));
    var suggestions = view.suggestions || [], suggestion = suggestions.find(function (x) { return x && x.state === 'open' && (x.cell === spec.key || (spec.key === 'customer' && (x.cell === 'problem' || x.cell === 'alternatives'))); });
    var showSuggestion = suggestion && opts && opts.suggestions && !opts.mini, miniSuggestion = suggestion && opts && opts.mini, title = el('h4'), tags = el('span', 'cv-cell-tags');
    if (miniSuggestion) cell.classList.add('cv-suggestion');
    title.append(el('span', '', cellName(spec.key) + (miniSuggestion ? ' · ' + t('cvVAdjustment') : '')));
    if (showSuggestion) tags.append(el('span', 'cv-tag zero', t('cvSugTag')), fieldTag(value.tag)); else tags.append(fieldTag(value.tag));
    title.append(tags); cell.append(title);
    if (showSuggestion) {
      var current = spec.key === 'customer' && (suggestion.cell === 'problem' || suggestion.cell === 'alternatives') ? value.sub && value.sub[suggestion.cell] || { text: suggestion.now || '' } : value;
      suggestionCell(cell, suggestion, current, opts);
    } else { var displayValue = journeyOpenValue(value, opts, spec.key), alternative = alternativeCharge(data, spec, displayValue, opts); if (alternative) cell.append(alternative); else editableText(cell, displayValue, opts, spec.key); }
    if (spec.key === 'customer') ['problem', 'alternatives'].forEach(function (sub) { var x = value.sub && value.sub[sub] || { text: '', tag: 'open' }; cell.append(el('span', 'cv-sub-k', cellName(sub))); editableText(cell, journeyOpenValue(x, opts, sub), opts, 'customer.' + sub); });
    if (opts && opts.levelsShown) cell.append(levelBlock(level));
    if (value.tag === 'open' && opts && opts.journey) { var acts = el('div', 'cv-actions'); [['zero', 'jrCellZero'], ['own', 'jrCellOwn']].forEach(function (pair) { var b = el('button', pair[0] === 'zero' ? 'btn zero' : 'btn link', t(pair[1])); b.type = 'button'; b.addEventListener('click', function () { if (pair[0] === 'zero' && opts.onZero) opts.onZero(spec.key); if (pair[0] === 'own' && opts.onOwn) inlineEditor(cell, value.text, function (next) { return opts.onOwn(spec.key, next); }, opts.editMax); }); acts.append(b); }); cell.append(acts); }
    return cell;
  }
  function cellsGrid(data, opts) { var grid = el('div', 'cv-grid' + (opts && opts.mini ? ' cv-mini' : '')); CELLS.forEach(function (spec) { grid.append(card(data, spec, opts)); }); return grid; }
  function weakNote(data) {
    var weakest = data && data.weakest || [];
    if (!weakest.length) return null;
    var p = el('p', 'cv-note'), parts = String(t('cvWeakest')).split('{cells}');
    p.append(document.createTextNode(parts[0] || ''), el('b', 'cv-weak-cells', weakest.map(cellName).join('、')), document.createTextNode(parts[1] || ''));
    var suggestions = data && data.view && data.view.suggestions || [], suggestion = suggestions.find(function (item) { return item && item.state === 'open' && item.cell; });
    if (suggestion) p.append(document.createTextNode(String(t('cvSuggestPending')).replace('{cell}', cellName(suggestion.cell))));
    return p;
  }
  function render(elm, data, opts) {
    opts = opts || {}; addStyle(); elm.replaceChildren(); elm.className = (elm.className ? elm.className + ' ' : '') + 'sos-canvas';
    if (!data || data.confirmed === false) { elm.append(el('p', 'cv-note', t('cvEmpty'))); return elm; }
    if (opts.mode === 'mini') {
      var mh = el('div', 'cv-head'); mh.append(el('h2', '', t('cvTitle')), el('span', 'small muted', t('cvLevel'))); elm.append(mh, cellsGrid(data, { mini: true, levelsShown: data.levelsShown !== false, suggestions: true }));
      if (data.levelsShown === false) elm.append(el('p', 'cv-hidden-level', t('cvLevelsHidden'))); else elm.append(evidenceLegend());
      appendFaces(elm, data, {}); if (data.levelsShown !== false) { var miniWeakest = weakNote(data); if (miniWeakest) elm.append(miniWeakest); }
      if (opts.onSeeAll) { var foot = el('div', 'cv-actions cv-mini-foot'); var see = el('button', 'btn primary', t('cvSeeAll')); see.type = 'button'; see.addEventListener('click', opts.onSeeAll); foot.append(el('span', 'small muted', t('cvConfirmedVer')), see); elm.append(foot); } return elm;
    }
    if (opts.mode === 'full') {
      var fullHead = el('div', 'cv-head cv-full-head'); fullHead.append(el('h2', '', t('cvTitle')));
      elm.append(fullHead); if (!opts.previous) elm.append(el('p', 'cv-note', t('cvEditHint'))); appendFaces(elm, data, { notes: true });
      var confirmed = null;
      if (opts.onPrevious) { var prev = el('button', 'btn link', t('cvPrevVer')); prev.type = 'button'; prev.addEventListener('click', opts.onPrevious); confirmed = el('span', 'cv-confirmed'); confirmed.append(el('span', 'small muted', t('cvConfirmedVer')), prev); }
      if (!opts.hideLevels && data.levelsShown !== false) { var fullLegends = legends(); if (confirmed) fullLegends.append(confirmed); elm.append(fullLegends); } else if (confirmed) elm.append(confirmed);
      if (opts.previous) { var previous = el('div', 'cv-prev'), back = el('button', 'btn link', t('cvBackNow')); back.type = 'button'; if (typeof opts.onBackNow === 'function') back.addEventListener('click', opts.onBackNow); previous.append(back); elm.append(previous); }
      elm.append(cellsGrid(data, { levelsShown: !opts.hideLevels && data.levelsShown !== false, onEdit: opts.onEdit, editMax: opts.editMax, suggestions: !!opts.suggestions, onSuggestion: opts.onSuggestion, altCharge: !!opts.altCharge }));
      if (!opts.hideLevels && data.levelsShown === false) elm.append(el('p', 'cv-hidden-level', t('cvLevelsHidden')));
      elm.append(el('p', 'cv-note', t('cvCredit'))); return elm;
    }
    elm.append(cellsGrid(data, { journey: true, onEdit: opts.onEdit, editMax: opts.editMax || 1000, onZero: opts.onZero, onOwn: opts.onOwn }));
    var journeyLegend = el('div', 'cv-journey-legend'); journeyLegend.append(fieldTag('mine'), fieldTag('pick'), fieldTag('zero'), fieldTag('open'), el('span', '', t('jrUndNote'))); elm.append(journeyLegend); return elm;
  }
  g.SOS_CANVAS_UI = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
