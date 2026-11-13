// 生意模式圖的純函數；同時供瀏覽器畫面和 Node 外殼使用。
(function (g) {
  'use strict';
  var CELLS = Object.freeze([
    Object.freeze({ key: 'partners', plan: 'canvas.partners', area: 'pa' }),
    Object.freeze({ key: 'activities', plan: 'canvas.activities', area: 'ac' }),
    Object.freeze({ key: 'resources', plan: 'canvas.resources', area: 're' }),
    Object.freeze({ key: 'value', plan: 'canvas.value', area: 'va' }),
    Object.freeze({ key: 'relationship', plan: 'canvas.relationship', area: 'cr' }),
    Object.freeze({ key: 'channel', plan: 'canvas.channel', area: 'ch' }),
    Object.freeze({ key: 'customer', plan: 'canvas.customer', area: 'cu' }),
    Object.freeze({ key: 'cost', plan: 'canvas.cost', area: 'co' }),
    Object.freeze({ key: 'revenue', plan: 'canvas.revenue', area: 'rv' })
  ]);
  var SUB = Object.freeze({ customer: Object.freeze(['problem', 'alternatives']) });
  var GOALS = Object.freeze(['fast', 'steady', 'scale', 'raise', 'open']);
  var EV = ['guess', 'said', 'did', 'paid', 'stuck'];
  var OLD_EV = { none: 0, '未發生': 0, '未有人講過': 0, '有人講過': 1, '有人做過': 2, '有人付出代價': 3, '冇咗會痛': 4 };
  var own = function (value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); };
  var clone = function (value) { return JSON.parse(JSON.stringify(value == null ? null : value)); };
  var text = function (value) { return String(value == null ? '' : value); };
  var cellKeys = CELLS.map(function (cell) { return cell.key; });

  function gradeIndex(value) {
    if (value == null || value === '') return -1;
    var s = text(value).trim();
    if (/^[0-4]$/.test(s)) return Number(s);
    if (EV.indexOf(s) >= 0) return EV.indexOf(s);
    return own(OLD_EV, s) ? OLD_EV[s] : -1;
  }

  function short(value) {
    var chars = Array.from(text(value));
    return chars.length > 40 ? chars.slice(0, 40).join('') + '…' : chars.join('');
  }

  function reading(page, plan) {
    var fields = Array.isArray(page && page.detail && page.detail.reading) ? page.detail.reading : [];
    return fields.find(function (field) { return field && field.plan === plan; }) || null;
  }

  function confirmed(field, values) {
    if (!field) return { id: '', value: '', origin: 'missing' };
    if (!values || !own(values, field.id)) return field;
    var override = values[field.id];
    return override && typeof override === 'object' && !Array.isArray(override) ? Object.assign({}, field, override) : Object.assign({}, field, { value: override });
  }

  // 根據欄位來源，回傳畫面使用的出處標籤鍵。
  function originTag(field) {
    var value = text(field && field.value).trim();
    if (!field || field.origin === 'missing' || value === '待你補充' || value === '未定') return 'open';
    if (field.origin === 'doc') return 'mine';
    if (field.origin === 'ai' && field.picked === true) return 'pick';
    if (field.origin === 'ai' || field.origin === 'default') return 'zero';
    return 'open';
  }

  // 從公司概覽及已確認欄位，建立尚未寫入帳本的生意模式圖。
  function canvasFromPage(page, values) {
    var cells = {};
    CELLS.forEach(function (cell) {
      var field = confirmed(reading(page, cell.plan), values);
      cells[cell.key] = { text: text(field.value), tag: originTag(field), fieldId: field.id || '' };
      if (cell.key === 'customer') {
        var sub = {};
        SUB.customer.forEach(function (key) {
          var subField = confirmed(reading(page, 'canvas.' + key), values);
          sub[key] = { text: text(subField.value), tag: originTag(subField) };
        });
        cells[cell.key].sub = sub;
      }
    });
    var type = confirmed(reading(page, 'biz.type'), values), goal = confirmed(reading(page, 'biz.goal'), values);
    return { type: text(type.value), goal: goal.id ? text(goal.value) : '', model: page && page.detail && page.detail.model ? page.detail.model : null, cells: cells };
  }

  // 計算各格由假設支持的最高證據級數和相應原話。
  function cellLevels(assumptions) {
    var best = {};
    cellKeys.forEach(function (key) { best[key] = { raw: -1, text: '' }; });
    (Array.isArray(assumptions) ? assumptions : []).forEach(function (item) {
      var key = item && item.cell;
      if (key === 'problem' || key === 'alternatives') key = 'customer';
      if (!own(best, key)) return;
      var level = gradeIndex(item.grade);
      if (level > best[key].raw) best[key] = { raw: level, text: text(item.text) };
    });
    var result = {};
    cellKeys.forEach(function (key) {
      var item = best[key], raw = item.raw;
      result[key] = { level: key === 'revenue' && raw < 3 ? 0 : Math.max(0, raw), why: raw < 0 ? '' : short(item.text) };
    });
    return result;
  }

  // 按畫面次序找出尚未有證據支持的格。
  function weakest(levels) {
    return CELLS.filter(function (cell) { return Number(levels && levels[cell.key] && levels[cell.key].level) === 0; }).map(function (cell) { return cell.key; });
  }

  function blankView() {
    var cells = {};
    CELLS.forEach(function (cell) {
      cells[cell.key] = { text: '', tag: 'open' };
      if (cell.key === 'customer') cells[cell.key].sub = { problem: { text: '', tag: 'open' }, alternatives: { text: '', tag: 'open' } };
    });
    return { rev: 0, cells: cells, history: [], suggestions: [] };
  }

  function targetOf(cells, target) {
    if (cellKeys.indexOf(target) >= 0) return { value: cells[target] || { text: '', tag: 'open' }, set: function (next) { cells[target] = next; } };
    var match = /^customer\.(problem|alternatives)$/.exec(text(target));
    if (!match) return null;
    var key = match[1];
    if (cells.customer && cells.customer.sub) return { value: cells.customer.sub[key] || { text: '', tag: 'open' }, set: function (next) { cells.customer.sub[key] = next; } };
    return { value: cells[key] || { text: '', tag: 'open' }, set: function (next) { cells[key] = next; } };
  }

  function suggestionTarget(value) {
    return value === 'problem' || value === 'alternatives' ? 'customer.' + value : value;
  }

  function saveHistory(view, at, why) {
    view.history.unshift({ at: text(at || ''), rev: view.rev, cells: clone(view.cells), why: text(why || '') });
    view.history = view.history.slice(0, 20);
  }

  function edit(view, target, value, at, why, tag) {
    var hit = targetOf(view.cells, target);
    if (!hit) return false;
    saveHistory(view, at, why);
    hit.set(Object.assign({}, clone(hit.value), { text: text(value), tag: tag || 'mine' }));
    view.rev += 1;
    return true;
  }

  // 合併已確認模式圖與待處理的創辦人操作，產生不改輸入的最新檢視。
  function canvasView(base, ops) {
    var original = base && typeof base === 'object' ? clone(base) : blankView();
    var view = {
      rev: Number.isInteger(original.rev) ? original.rev : 0,
      cells: original.cells && typeof original.cells === 'object' ? original.cells : blankView().cells,
      history: Array.isArray(original.history) ? original.history : [],
      suggestions: Array.isArray(original.suggestions) ? original.suggestions : []
    };
    var used = {};
    (Array.isArray(ops) ? ops : []).forEach(function (operation) {
      if (!operation || !operation.id || used[operation.id]) return;
      used[operation.id] = true;
      if (operation.op === 'canvasEdit') {
        var value = operation.value || {};
        if (value.forRev === view.rev) edit(view, operation.target, value.text, operation.at, '創辦人修改', 'mine');
        return;
      }
      if (operation.op !== 'canvasSugAnswer') return;
      var answer = operation.value || {}, suggestion = view.suggestions.find(function (item) { return item && item.id === operation.target; });
      if (!suggestion || suggestion.state !== 'open') return;
      if (answer.action === 'reject') { suggestion.state = 'rejected'; return; }
      if (answer.action === 'adopt') {
        // 創辦人採用 Zero 的建議寫法：出處同「你選的」（接口文件第 4 節）
        if (edit(view, suggestionTarget(suggestion.cell), suggestion.text, operation.at, suggestion.why, 'pick')) suggestion.state = 'adopted';
      } else if (answer.action === 'edit') {
        if (edit(view, suggestionTarget(suggestion.cell), answer.text, operation.at, suggestion.why, 'mine')) suggestion.state = 'edited';
      }
    });
    return view;
  }

  // 讀取指定次序的上一版；0 是最近一次修改前的版本。
  function historyEntry(view, n) {
    var item = view && Array.isArray(view.history) ? view.history[n] : null;
    return item ? { at: text(item.at), rev: item.rev, cells: clone(item.cells) } : null;
  }

  // 由畫面顯示名稱找回目標鍵，找不到時保持未定。
  function goalKeyOf(label, names) {
    for (var index = 0; index < GOALS.length; index++) {
      var key = GOALS[index];
      if (names && names.ui && names.ui['goal_' + key] === label) return key;
    }
    return 'open';
  }

  var api = { CELLS: CELLS, SUB: SUB, GOALS: GOALS, originTag: originTag, canvasFromPage: canvasFromPage, cellLevels: cellLevels, weakest: weakest, canvasView: canvasView, historyEntry: historyEntry, goalKeyOf: goalKeyOf };
  g.SOS_CANVAS = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
