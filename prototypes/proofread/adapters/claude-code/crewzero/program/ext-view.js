// 延伸功能分頁：只把宣告及資料當純文字繪畫，不載入或執行功能資料夾內容。
(function (root) {
  'use strict';

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const array = value => Array.isArray(value) ? value : [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const dateOK = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  const stageField = table => array(table?.fields).find(field => field?.type === 'stage');
  const fields = table => array(table?.fields);
  const fieldById = (table, id) => fields(table).find(field => field?.id === id);
  const stages = table => array(stageField(table)?.stages);
  const stageById = (table, id) => stages(table).find(stage => stage?.id === id);
  const safeString = value => value && typeof value === 'object' && own(value, 'raw') ? safeString(value.raw) : String(value ?? '');
  const textValue = value => value && typeof value === 'object' && own(value, 'name') ? safeString(value.name) : safeString(value);
  const selectRefreshItem = (items, folder) => array(items).find(item => item?.folder === folder) || null;
  function decideExtView(input = {}) {
    const items = array(input.items);
    const drafts = array(input.drafts).filter(draft => ['drafting', 'ready', 'failed'].includes(draft?.state));
    const current = input.current && typeof input.current === 'object' ? input.current : null;
    const userChoseIndex = !!input.userChoseIndex;
    const trigger = safeString(input.trigger);
    const target = safeString(input.target);
    const result = (view, folder = '', draftId = '', choseIndex = userChoseIndex) => ({ view, folder: safeString(folder), draftId: safeString(draftId), userChoseIndex: !!choseIndex });
    const newestDraft = () => drafts.slice().sort((left, right) => {
      const leftAt = Date.parse(left?.updatedAt || ''), rightAt = Date.parse(right?.updatedAt || '');
      const a = Number.isNaN(leftAt) ? -Infinity : leftAt, b = Number.isNaN(rightAt) ? -Infinity : rightAt;
      return b - a || safeString(right?.updatedAt).localeCompare(safeString(left?.updatedAt)) || safeString(right?.id).localeCompare(safeString(left?.id));
    })[0] || null;
    const initial = () => {
      if (drafts.length && !userChoseIndex) return result('draft', '', newestDraft()?.id || '');
      const enabled = items.filter(item => item?.state === 'enabled');
      if (!drafts.length && items.length === 1 && enabled.length === 1) return result('board', enabled[0].folder || '');
      return result('index');
    };

    if (trigger === 'enableSuccess' || trigger === 'applySuccess') return result('board', target, '', false);
    if (trigger === 'openCreate') return result('create', '', '', true);
    if (trigger === 'backToIndex') return result('index', '', '', true);
    if (trigger === 'openItem') return result('board', target, '', false);
    if (trigger === 'openDraft') return result('draft', '', target);
    if (trigger === 'draftCancelled' || trigger === 'initial') return initial();
    if (trigger === 'poll') {
      if (current?.kind === 'create') return result('create', '', '', true);
      if (current?.kind === 'board') {
        const selected = selectRefreshItem(items, current.folder);
        return selected?.state === 'enabled' ? result('board', selected.folder || '') : result('index');
      }
      if (current?.kind === 'draft') {
        const selected = drafts.find(draft => draft?.id === current.draftId);
        if (selected) return result('draft', '', selected.id || '');
        const enabled = selectRefreshItem(items, target || current.folder);
        return enabled?.state === 'enabled' ? result('board', enabled.folder || '', '', false) : initial();
      }
      return userChoseIndex ? result('index') : initial();
    }
    return initial();
  }
  const afterEnableSelection = (result, draft) => {
    const from = String(draft?.from || '');
    return safeString(result?.folder) || (from.startsWith('folder:') ? from.slice('folder:'.length) : '');
  };
  const rowProblemCount = result => Math.max(result?.bad ? 1 : 0, array(result?.problems).length);
  const formRow = (row, table) => {
    if (row) return clone(row);
    const field = stageField(table), first = stages(table)[0];
    return { v: field && first ? { [field.id]: first.id } : {} };
  };
  const peopleForForm = dashboard => array(dashboard?.people?.external);
  const hiddenFieldIds = table => fields(table).filter(field => field?.hidden).map(field => field.id);
  const canSaveForm = (saving, row) => !saving && !!row;
  const rowRequest = row => ({ op: row?.id ? 'update' : 'add', id: row?.id, rev: row?.rev, v: row?.v || {} });
  const latestRow = (rows, id) => array(rows).find(row => row?.id === id) || null;
  const moneyValue = (field, input, previous) => input === '' ? undefined : { amountCents: Math.round(Number(input) * 100), currency: previous?.currency || field?.currency || 'HKD' };

  function dueState(table, row, today) {
    if (row?.archived || isLastStage(table, row) || !dateOK(today)) return '';
    const due = row?.v?.[table?.due];
    if (!dateOK(due)) return '';
    const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return days < 0 ? 'overdue' : days <= 7 ? 'soon' : '';
  }
  function isLastStage(table, row) {
    const all = stages(table);
    return all.length > 0 && row?.v?.[stageField(table)?.id] === all.at(-1)?.id;
  }
  function nextStage(table, row) {
    const all = stages(table), index = all.findIndex(stage => stage.id === row?.v?.[stageField(table)?.id]);
    return index >= 0 && index < all.length - 1 ? all[index + 1].id : '';
  }
  function nextActionStage(table, row) {
    const field = stageField(table), current = row?.v?.[field?.id];
    if (!field) return '';
    return stageById(table, current) ? nextStage(table, row) : stages(table)[0]?.id || '';
  }
  function compareRows(table, left, right) {
    const due = table?.due;
    const a = safeString(left?.v?.[due]), b = safeString(right?.v?.[due]);
    const ad = dateOK(a) ? a : '9999-12-31', bd = dateOK(b) ? b : '9999-12-31';
    return ad.localeCompare(bd) || safeString(left?.createdAt).localeCompare(safeString(right?.createdAt)) || safeString(left?.id).localeCompare(safeString(right?.id));
  }
  function groupRows(table, rows, includeArchived = false) {
    const groups = Object.fromEntries(stages(table).map(stage => [stage.id, []]));
    groups.unsorted = [];
    for (const row of array(rows)) {
      if (!includeArchived && row?.archived) continue;
      const id = row?.v?.[stageField(table)?.id];
      (groups[own(groups, id) ? id : 'unsorted']).push(row);
    }
    Object.values(groups).forEach(list => list.sort((a, b) => compareRows(table, a, b)));
    return groups;
  }
  function overviewOrder(rows) {
    return array(rows).slice().sort((a, b) => Number(!!array(b.values).some(value => value?.warn)) - Number(!!array(a.values).some(value => value?.warn)) || safeString(a?.name).localeCompare(safeString(b?.name), 'zh-Hant'));
  }
  function swapHost(host) {
    const value = String(host || '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
    return value === '127.0.0.1' ? 'localhost' : '127.0.0.1';
  }
  function pageUrl(host, port) { return `http://${swapHost(host)}:${Number(port)}`; }
  function formatDate(value) {
    if (!dateOK(value)) return safeString(value);
    return new Intl.DateTimeFormat('zh-Hant', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  }
  function formatWhen(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return safeString(value);
    return new Intl.DateTimeFormat('zh-Hant', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function formatValue(field, value) {
    if (value && typeof value === 'object' && own(value, 'invalid')) return safeString(value.raw);
    if (field?.type === 'date') return formatDate(value);
    if (field?.type === 'money' && value && typeof value === 'object') {
      const cents = Number(value.amountCents || 0), amount = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
      const marks = { HKD: 'HK$', USD: 'US$', TWD: 'NT$', CNY: 'RMB ' };
      return `${marks[value.currency] || `${safeString(value.currency)} `}${amount}`;
    }
    if (field?.type === 'bool') return value ? '✓' : '—';
    if (field?.type === 'choice') return safeString(array(field.options).find(option => option.id === value)?.label || value);
    if (field?.type === 'stage') return safeString(stageById({ fields: [field] }, value)?.label || value);
    return textValue(value);
  }
  function hasHandoff(table, row) { return array(table?.handoff).find(item => item?.stage === row?.v?.[stageField(table)?.id]) || null; }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'htmlFor') node.htmlFor = value;
      else if (key === 'checked' || key === 'disabled') node[key] = !!value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }

  function mountTab(container, ctx) {
    const state = { data: null, item: null, draftId: '', draftFolder: '', userChoseIndex: false, tableId: '', rows: [], rowsBusy: false, rowsProblem: 0, form: null, formSaving: false, detail: null, view: 'index', boardView: 'board', selectedStage: '', sort: { id: '', dir: 1 }, filter: '', archived: false, more: new Set(), dragging: false, undo: null, notice: '', refreshInFlight: false, pendingRefresh: null, editMode: '', people: [], draftName: '', loaded: false };
    const T = (key, vars = {}) => {
      const names = ctx?.N || root.SOS_NAMES || {};
      let value = typeof names.t === 'function' ? names.t(key, vars) : names?.ui?.[key] ?? names?.[key];
      if (value === undefined || value === null) value = key;
      return String(value).replace(/\{([^}]+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
    };
    const mobile = () => typeof ctx?.mobile === 'function' ? !!ctx.mobile() : !!ctx?.mobile || window.matchMedia?.('(max-width: 700px)').matches;
    const notify = text => { state.notice = text; render(); };
    const apiResult = value => value?.json ?? value ?? {};
    const request = async (path, body) => apiResult(body === undefined ? await ctx.get(path) : await ctx.post(path, body));
    const selectedTable = () => state.item?.decl?.tables?.find(table => table.id === state.tableId) || state.item?.decl?.tables?.[0] || null;
    const currentExt = () => state.view === 'create' ? { kind: 'create' } : state.view === 'board' && state.item ? { kind: 'board', folder: state.item.folder } : state.view === 'draft' && state.draftId ? { kind: 'draft', folder: state.draftFolder, draftId: state.draftId } : { kind: 'index' };
    const applyExtDecision = (trigger, target = '') => {
      const decision = decideExtView({ items: state.data?.items, drafts: state.data?.drafts, current: currentExt(), userChoseIndex: state.userChoseIndex, trigger, target, mobile: mobile() });
      if (decision.view === 'board') {
        const folder = decision.folder;
        state.item = { folder }; state.view = 'board'; state.form = null;
        Object.assign(state.item, selectRefreshItem(state.data?.items, folder) || {});
      } else {
        state.item = null; state.view = decision.view; state.form = null;
      }
      state.draftId = decision.draftId;
      const selectedDraft = array(state.data?.drafts).find(draft => draft?.id === state.draftId);
      const from = safeString(selectedDraft?.from);
      state.draftFolder = state.view === 'draft' && from.startsWith('folder:') ? from.slice('folder:'.length) : '';
      state.userChoseIndex = decision.userChoseIndex;
      return decision;
    };
    const setBusyNotice = async (action, body) => {
      if (ctx?.demo) { notify(T('extDemo')); return { ok: true, demo: true }; }
      try {
        const result = await request('/api/ext', { action, ...body });
        if (!result?.ok) throw new Error(result?.message || T('extStale'));
        return result;
      } catch (error) { notify(error?.message || T('extStale')); return null; }
    };
    const loadRows = async () => {
      const item = state.item, table = selectedTable();
      if (!item || !table) { state.rows = []; return; }
      state.rowsBusy = true;
      try {
        const result = await request(`/api/ext/rows?folder=${encodeURIComponent(item.folder)}&table=${encodeURIComponent(table.id)}`);
        state.rows = array(result?.rows);
        state.rowsProblem = rowProblemCount(result);
      } catch (_) { state.rows = []; state.rowsProblem = 0; state.notice = T('extStale'); }
      state.rowsBusy = false;
    };
    const refresh = async (trigger = state.loaded ? 'poll' : 'initial', target = '') => {
      if (busy()) return;
      if (state.refreshInFlight) {
        if (trigger !== 'poll') state.pendingRefresh = { trigger, target };
        return;
      }
      state.refreshInFlight = true;
      try {
        state.data = await request('/api/ext');
      } catch (error) { state.data = { error: error?.message || T('extStale'), items: [], drafts: [] }; }
      try {
        const decision = applyExtDecision(trigger, target);
        if (decision.view === 'board' && state.item) {
          state.tableId = state.item.decl?.tables?.some(table => table.id === state.tableId) ? state.tableId : state.item.decl?.tables?.[0]?.id || '';
          await loadRows();
        } else { state.rows = []; state.rowsProblem = 0; }
        state.loaded = true;
      } finally {
        state.refreshInFlight = false;
        render();
        const pending = state.pendingRefresh;
        state.pendingRefresh = null;
        if (pending) void refresh(pending.trigger, pending.target);
      }
    };
    const busy = () => !!state.dragging || !!state.form || !!state.undo;
    const button = (key, click, primary = false, attrs = {}) => el('button', { type: 'button', class: `cx-button${primary ? ' cx-button-primary' : ''}${attrs.small ? ' cx-button-small' : ''}`, text: T(key, attrs.vars), onclick: click, disabled: attrs.disabled, ...attrs.data });
    const notice = () => state.notice ? el('div', { class: 'cx-notice', role: 'status', text: state.notice }) : null;

    function emptyView() {
      const data = state.data || {};
      const cards = array(data.templates).map(template => el('article', { class: 'cx-template' },
        el('div', { class: 'cx-mini' }, el('i'), el('i'), el('i'), el('i')),
        el('h3', { text: template.name || T(template.id === 'orders' ? 'extTplOrders' : template.id === 'bookings' ? 'extTplBookings' : 'extTplStock') }),
        el('p', { text: template.about || '' }),
        button('extUseTemplate', () => draftTemplate(template.id), template.id === 'orders', { data: { 'data-cx-template': template.id } })
      ));
      const textarea = el('textarea', { class: 'cx-textarea', placeholder: T('extAskPlaceholder'), 'data-cx-ask': '1' });
      const send = button('extAskSend', () => draftSentence(textarea.value), false, { disabled: !data.aiReady, data: { 'data-cx-ask-send': '1' } });
      return el('section', { class: 'cx-shell' },
        el('div', { class: 'cx-head' }, el('div', {}, el('div', { class: 'cx-title', text: T('extTab') })), array(data.items).length ? button('extAllExtensions', () => refresh('backToIndex')) : null),
        el('p', { class: 'cx-about', text: T('extIntro') }),
        el('h3', { text: T('extTemplates') }), el('div', { class: 'cx-card-grid' }, cards), el('h3', { text: T('extAsk') }),
        el('div', { class: 'cx-ask' }, textarea, el('div', {}, send, !data.aiReady ? el('p', { class: 'cx-muted', text: T('extNoAi') }) : null)),
        el('p', { class: 'cx-help', text: T('extAdvanced') })
      );
    }
    async function draftTemplate(id) { const result = await setBusyNotice('draftTemplate', { template: id }); if (result) await refresh(result.id && !result.demo ? 'openDraft' : undefined, result.id || ''); }
    async function draftSentence(ask) { if (!String(ask || '').trim()) return; const result = await setBusyNotice('draftSentence', { ask: String(ask).trim() }); if (result) await refresh(result.id && !result.demo ? 'openDraft' : undefined, result.id || ''); }

    function draftingView(draft) {
      const stuck = Date.now() - Date.parse(draft.updatedAt || '') > 10 * 60 * 1000;
      const actions = stuck ? [button('extRetry', () => draftAction('draftRetry', draft.id), true), button('extCancel', () => draftAction('draftCancel', draft.id))] : [button('extCancel', () => draftAction('draftCancel', draft.id))];
      return el('section', { class: 'cx-shell cx-progress' }, el('h2', { class: 'cx-title', text: T('extDrafting') }),
        draft.ask ? el('p', { class: 'cx-notice', text: draft.ask }) : null,
        el('div', { class: 'cx-progress-step cx-progress-done', text: T('extDraftStepRead') }),
        el('div', { class: 'cx-progress-step cx-progress-now', text: T('extDraftStepBuild') }),
        el('div', { class: 'cx-progress-step', text: T('extDraftStepCheck') }),
        el('div', { class: 'cx-progress-step', text: T('extDraftStepPreview') }),
        el('div', { class: 'cx-progress-bar' }, el('i')), el('p', { class: 'cx-help', text: T('extDraftingHint') }), el('div', { class: 'cx-actions' }, actions));
    }
    function failedView(draft) {
      return el('section', { class: 'cx-shell cx-progress' }, el('h2', { class: 'cx-title', text: T('extDrafting') }),
        el('p', { class: 'cx-error', text: T('extDraftFailed', { reason: draft.error || '' }) }),
        el('div', { class: 'cx-actions' }, button('extRetry', () => draftAction('draftRetry', draft.id), true), button('extUseTemplate', () => draftAction('draftCancel', draft.id))));
    }
    async function draftAction(action, id) { const result = await setBusyNotice(action, { id }); if (result) await refresh(action === 'draftCancel' ? 'draftCancelled' : 'poll', id); }

    function previewView(draft) {
      const decl = draft.preview || draft.base || {}, table = decl.tables?.[0];
      if (!table) return failedView({ error: T('extBadFormat', { reason: '' }) });
      const panel = el('aside', { class: 'cx-panel' }, el('h3', { text: T('extFieldsPanel') }), el('p', { class: 'cx-help', text: T('extDragHint') }),
        el('h4', { text: T('extFields') }), sortableFields(draft, table), el('h4', { text: T('extStages', { n: stages(table).length }) }), sortableStages(draft, table));
      const preview = el('div', { class: 'cx-preview-main' }, previewBoard(table, array(draft.sample)), mobile() ? previewCards(table, array(draft.sample)) : null);
      const actions = [button(draft.from?.startsWith('folder:') ? 'extApply' : 'extEnable', () => { state.draftName = decl.name || ''; render(); }, true), button('extRevise', () => { state.editMode = 'revise'; render(); }), button('extCancel', () => draftAction('draftCancel', draft.id))];
      const namePrompt = state.draftName !== '' ? el('div', { class: 'cx-form' }, el('label', { class: 'cx-field' }, el('span', { text: T('extName') }), el('input', { class: 'cx-input', value: state.draftName, oninput: event => { state.draftName = event.target.value; } })),
        el('div', { class: 'cx-actions' }, button('extSave', () => enableDraft(draft), true), button('extCancel', () => { state.draftName = ''; render(); }))) : null;
      const revise = state.editMode === 'revise' ? reviseBox(draft) : null;
      return el('section', { class: 'cx-shell' }, el('div', { class: 'cx-head' }, el('div', {}, el('div', { class: 'cx-eyebrow', text: T('extPreview') }), el('div', { class: 'cx-title', text: decl.name || '' }))),
        el('div', { class: 'cx-preview-grid' }, preview, panel), namePrompt, revise, el('div', { class: 'cx-actions' }, actions));
    }
    function previewBoard(table, sample) {
      const rows = array(sample).map((v, index) => ({ id: `sample-${index}`, v, archived: false }));
      return el('div', { class: 'cx-board' }, ...stages(table).map(stage => column(table, stage, groupRows(table, rows)[stage.id] || [], true)));
    }
    function previewCards(table, sample) {
      const title = fieldById(table, table.title), visible = fields(table).filter(field => !field.hidden && field.id !== table.title && field.type !== 'stage');
      return el('div', { class: 'cx-preview-cards' }, ...array(sample).map((value, index) => el('article', { class: 'cx-card', 'data-cx-preview-card': String(index + 1) },
        el('span', { class: 'cx-card-title', text: formatValue(title, value?.[table.title]) }),
        ...visible.map(field => el('span', { class: 'cx-card-line', text: `${field.label}：${formatValue(field, value?.[field.id])}` }))
      )));
    }
    function sortableFields(draft, table) {
      const list = el('div', { class: 'cx-panel-list', 'data-cx-field-list': '1' });
      const current = clone(draft.edits || {}), hidden = new Set(hiddenFieldIds(table));
      fields(table).forEach(field => {
        const locked = !!field.required || field.type === 'stage' || field.id === table.title;
        const input = el('input', { class: 'cx-input', value: field.label, 'data-cx-label': field.id, onblur: event => saveEdits(draft, { labels: { ...(current.labels || {}), [field.id]: event.target.value } }) });
        const show = el('input', { type: 'checkbox', checked: !hidden.has(field.id), disabled: locked, onchange: event => {
          const next = new Set(hidden); if (event.target.checked) next.delete(field.id); else next.add(field.id); saveEdits(draft, { hidden: [...next] });
        } });
        list.append(el('div', { class: 'cx-sort-item', 'data-cx-sort-item': '1', 'data-cx-id': field.id },
          el('button', { type: 'button', class: 'cx-sort-handle', text: '⋮⋮', 'data-cx-drag-handle': '1', 'aria-label': T('extDragHint') }), input,
          el('label', { class: 'cx-toggle' }, show, el('span', { text: locked ? T('extRequired') : T(!hidden.has(field.id) ? 'extShow' : 'extHide') }))));
      });
      root.CZDrag?.sortList(list, { onSort: order => saveEdits(draft, { fieldOrder: order }) });
      return list;
    }
    function sortableStages(draft, table) {
      const list = el('div', { class: 'cx-panel-list', 'data-cx-stage-list': '1' });
      const current = clone(draft.edits || {});
      stages(table).forEach(stage => list.append(el('div', { class: 'cx-sort-item', 'data-cx-sort-item': '1', 'data-cx-id': stage.id },
        el('button', { type: 'button', class: 'cx-sort-handle', text: '⋮⋮', 'data-cx-drag-handle': '1', 'aria-label': T('extDragHint') }),
        el('input', { class: 'cx-input', value: stage.label, 'data-cx-stage-label': stage.id, onblur: event => saveEdits(draft, { labels: { ...(current.labels || {}), [stage.id]: event.target.value } }) }))));
      root.CZDrag?.sortList(list, { onSort: order => saveEdits(draft, { stageOrder: order }) });
      return list;
    }
    async function saveEdits(draft, patch) {
      const edits = { ...(draft.edits || {}), ...patch, forRev: draft.baseRev };
      const result = await setBusyNotice('draftEdit', { id: draft.id, edits });
      if (result) await refresh();
    }
    function reviseBox(draft) {
      const input = el('textarea', { class: 'cx-textarea', placeholder: T('extRevisePlaceholder'), value: draft.revise || '' });
      return el('div', { class: 'cx-form' }, input, el('div', { class: 'cx-actions' }, button('extRevise', async () => { const result = await setBusyNotice('draftRevise', { id: draft.id, revise: input.value }); if (result) { state.editMode = ''; await refresh(); } }, true), button('extCancel', () => { state.editMode = ''; render(); })));
    }
    async function enableDraft(draft) {
      const action = draft.from?.startsWith('folder:') ? 'apply' : 'enable';
      const result = await setBusyNotice(action, action === 'apply' ? { id: draft.id } : { id: draft.id, name: state.draftName });
      if (result) {
        const folder = afterEnableSelection(result, draft);
        state.draftName = ''; await refresh(action === 'apply' ? 'applySuccess' : 'enableSuccess', folder);
      }
    }
    function viewTabs() { return el('div', { class: 'cx-tabs' }, button('extViewBoard', () => { state.boardView = 'board'; state.form = null; render(); }, false, { data: { 'data-cx-view': 'board' } }), button('extViewList', () => { state.boardView = 'list'; state.form = null; render(); }, false, { data: { 'data-cx-view': 'list' } }), button('extViewForm', () => openForm(), false, { data: { 'data-cx-view': 'form' } })); }

    function featureIndex() {
      const items = array(state.data?.items);
      return el('section', { class: 'cx-shell' }, el('div', { class: 'cx-head' }, el('div', { class: 'cx-title', text: T('extTab') }), button('extAddNew', () => refresh('openCreate'), false)),
        el('div', { class: 'cx-feature-grid' }, ...items.map(featureCard)));
    }
    function featureCard(item) {
      const invalid = item.state === 'bad', statusKey = item.state === 'enabled' ? 'extEnabled' : item.state === 'disabled' ? 'extDisabled' : 'extNewPending';
      const values = array(item.summary).flat().slice(0, 2).map(value => `${value.label || ''} ${value.value ?? ''}`).join(' · ');
      const actions = [];
      if (item.state === 'enabled') { actions.push(button('extOpenPage', () => { applyExtDecision('openItem', item.folder); state.tableId = state.item?.decl?.tables?.[0]?.id || ''; loadRows().then(render); }, true, { data: { 'data-cx-open': item.folder } })); actions.push(button('extModify', () => modify(item.folder))); actions.push(button('extDisable', () => enableState('disable', item.folder))); }
      else if (item.state === 'disabled') actions.push(button('extEnableAgain', () => enableState('enableAgain', item.folder), true));
      else if (item.state === 'pending') { actions.push(button('extEnable', () => enableState('enablePending', item.folder), true)); actions.push(button('extPreview', () => { state.previewItem = item; render(); })); }
      const page = item.decl?.page;
      const pageControl = page ? mobile() ? el('span', { class: 'cx-muted', text: T('extOpenOnComputer') }) : el('a', { class: 'cx-link', href: pageUrl(ctx.host, page.port), target: '_blank', rel: 'noopener', text: T('extOpenPage') }) : null;
      return el('article', { class: `cx-feature${invalid ? ' cx-error' : ''}` }, el('h3', {}, item.name || item.folder || ''), el('span', { class: `cx-status cx-status-${item.state}`, text: invalid ? T('extFeatureFormatProblem') : T(statusKey) }),
        invalid ? null : el('p', { text: item.decl?.about || values }), item.updatedAt ? el('p', { class: 'cx-muted', text: T('extUpdatedAt', { when: formatWhen(item.updatedAt) }) }) : null, el('div', { class: 'cx-feature-actions' }, actions, pageControl));
    }
    async function enableState(action, folder) { const result = await setBusyNotice(action, { folder }); if (result) { state.previewItem = null; await refresh('poll'); } }
    async function modify(folder) { const result = await setBusyNotice('modifyStart', { folder }); if (result) await refresh(result?.id ? 'openDraft' : 'poll', result?.id || ''); }
    function pendingPreview(item) {
      const table = item?.decl?.tables?.[0];
      return el('section', { class: 'cx-shell' }, el('div', { class: 'cx-head' }, el('div', {}, el('div', { class: 'cx-eyebrow', text: T('extPreview') }), el('div', { class: 'cx-title', text: item.name || item.decl?.name || '' }))),
        table ? previewBoard(table, []) : el('p', { class: 'cx-error', text: T('extBadFormat', { reason: item.error || '' }) }),
        el('div', { class: 'cx-actions' }, button('extEnable', () => enableState('enablePending', item.folder), true), button('extCancel', () => { state.previewItem = null; render(); })));
    }

    function activeView() {
      const item = state.item, table = selectedTable();
      if (!item || !table) return featureIndex();
      const tableButtons = item.decl.tables.length > 1 ? el('div', { class: 'cx-tabs' }, ...item.decl.tables.map(candidate => button(candidate.label, () => { state.tableId = candidate.id; loadRows().then(render); }, false, { data: { 'data-cx-table': candidate.id } }))) : null;
      const allFeatures = () => { applyExtDecision('backToIndex'); state.tableId = ''; state.rows = []; state.rowsProblem = 0; state.formSaving = false; state.detail = null; state.boardView = 'board'; state.selectedStage = ''; render(); };
      const controls = el('div', { class: 'cx-row' }, button('extAllExtensions', allFeatures, false, { data: { 'data-cx-all-extensions': '1' } }), tableButtons, viewTabs(), button('extNew', () => openForm(), true, { data: { 'data-cx-new': '1' } }));
      const main = state.boardView === 'list' ? listView(table) : state.form ? formView(table) : boardView(table);
      return el('section', { class: 'cx-shell' }, el('div', { class: 'cx-head' }, el('div', {}, el('div', { class: 'cx-eyebrow', text: T('extTab') }), el('div', { class: 'cx-title', text: item.name || item.decl.name || '' }), el('div', { class: 'cx-about', text: item.decl.about || '' })), controls), summaries(item, table), state.rowsProblem ? el('div', { class: 'cx-error', text: T('extRowsFormatProblem', { n: state.rowsProblem }) }) : null, main, state.detail ? detailView(table, state.detail) : null, undoView());
    }
    function summaries(item, table) {
      const values = array(item.summary?.[table.id] || item.summary).flat().slice(0, 4);
      return values.length ? el('div', { class: 'cx-summary' }, ...values.map(value => el('div', { class: `cx-summary-box${value.rule === 'overdue' && value.value ? ' cx-warn' : value.rule === 'dueWithin' && value.value ? ' cx-soon' : ''}` }, el('label', { text: value.label || '' }), el('b', { text: value.value ?? '' })))) : null;
    }
    function boardView(table) {
      const groups = groupRows(table, state.rows);
      if (mobile()) {
        const mobileStages = groups.unsorted.length ? [{ id: 'unsorted', label: T('extUnsorted') }, ...stages(table)] : stages(table), chosen = state.selectedStage || mobileStages[0]?.id || 'unsorted';
        return el('div', {}, el('div', { class: 'cx-stagebar' }, ...mobileStages.map(stage => el('button', { type: 'button', class: `cx-chip${stage.id === chosen ? ' cx-chip-on' : ''}`, text: `${stage.label} ${groups[stage.id]?.length || 0}`, onclick: () => { state.selectedStage = stage.id; render(); } }))),
          ...cardList(table, groups[chosen] || [], chosen));
      }
      const board = el('div', { class: 'cx-board', 'data-cx-board': '1' });
      if (groups.unsorted.length) board.append(column(table, { id: 'unsorted', label: T('extUnsorted') }, groups.unsorted, false));
      stages(table).forEach(stage => board.append(column(table, stage, groups[stage.id] || [], isLastStage(table, { v: { [stageField(table)?.id]: stage.id } }))));
      root.CZDrag?.boardDrag(board, { cardSelector: '[data-cx-card]', columnSelector: '[data-cx-stage]', disabled: mobile, onState: active => { state.dragging = active; }, onOpen: id => openDetail(id), onMove: (id, stage) => moveRow(id, stage) });
      return board;
    }
    function column(table, stage, rows, final = false) {
      const cap = final ? 10 : 30, key = stage.id, expanded = state.more.has(key), shown = rows.slice(0, expanded ? rows.length : cap);
      return el('section', { class: 'cx-column', 'data-cx-stage': stage.id }, el('div', { class: 'cx-column-head' }, el('span', { text: stage.label }), el('b', { text: rows.length })),
        ...cardList(table, shown, stage.id), rows.length > cap && !expanded ? button('extShowMore', () => { state.more.add(key); render(); }, false, { small: true, data: { 'data-cx-more': key } }) : null,
        final && rows.length ? button('extArchiveDone', () => archiveDone(table), false, { small: true, data: { 'data-cx-archive-done': '1' } }) : null);
    }
    function cardList(table, rows) { return rows.map(row => card(table, row)); }
    function card(table, row) {
      const title = fieldById(table, table.title), stage = dueState(table, row, ctx.today), extra = fields(table).filter(field => field.id !== table.title && field.type !== 'stage' && !field.hidden && own(row.v || {}, field.id)).slice(0, 2);
      const handoff = hasHandoff(table, row);
      return el('button', { type: 'button', class: `cx-card${stage ? ` cx-card-${stage}` : ''}`, 'data-cx-card': '1', 'data-cx-id': row.id, onclick: event => { if (!state.dragging) openDetail(row.id); } },
        el('span', { class: 'cx-card-title', text: formatValue(title, row.v?.[table.title]) }), ...extra.map(field => el('span', { class: 'cx-card-line', text: formatValue(field, row.v?.[field.id]) })),
        table.due ? el('span', { class: `cx-card-line${stage ? ` cx-${stage}` : ''}`, text: formatDate(row.v?.[table.due]) }) : null,
        stage ? el('span', { class: 'cx-card-tag', text: T(stage === 'overdue' ? 'extOverdue' : 'extDueSoon') }) : null,
        row.handedAt ? el('span', { class: 'cx-card-tag cx-card-handled', text: T('extHanded') }) : handoff && isLastStage(table, row) ? el('span', { class: 'cx-card-tag', text: T('extHandoff') }) : null);
    }
    function openDetail(id) {
      state.detail = state.rows.find(row => row.id === id) || null;
      state.moveOther = false;
      render();
      if (mobile()) requestAnimationFrame(() => container.querySelector('.cx-sheet')?.scrollIntoView?.({ block: 'nearest' }));
    }
    function detailView(table, row) {
      const next = nextActionStage(table, row), nextLabel = stageById(table, next)?.label || '', handoff = hasHandoff(table, row);
      const other = fields(table).find(field => field.id !== table.title && field.type !== 'stage' && !field.hidden && own(row.v || {}, field.id));
      const stage = stageById(table, row.v?.[stageField(table)?.id])?.label || '';
      const nextButton = next ? button('extNext', () => moveRow(row.id, next), true, { vars: { stage: nextLabel }, data: { 'data-cx-next': '1' } }) : null;
      const moveOther = button('extMoveOther', () => { state.moveOther = !state.moveOther; render(); });
      const edit = button('extEdit', () => openForm(row));
      return el('section', { class: 'cx-sheet cx-panel' }, el('div', { class: 'cx-sheet-grabber', 'aria-hidden': 'true' }), el('h3', { text: formatValue(fieldById(table, table.title), row.v?.[table.title]) }),
        el('p', { class: 'cx-sheet-now', text: `${other ? `${formatValue(other, row.v?.[other.id])} · ` : ''}${T('extNowStage', { stage })}` }),
        el('div', { class: 'cx-actions cx-sheet-actions' }, nextButton, el('div', { class: 'cx-sheet-secondary-actions' }, moveOther, edit)),
        handoff && isLastStage(table, row) && !row.handedAt ? handoffBox(table, row, handoff) : null,
        state.moveOther ? el('div', { class: 'cx-actions' }, ...stages(table).filter(stage => stage.id !== row.v?.[stageField(table)?.id]).map(stage => el('button', { type: 'button', class: 'cx-button cx-button-small', text: stage.label, onclick: () => moveRow(row.id, stage.id) }))) : null,
        button(row.archived ? 'extRestore' : 'extArchived', () => archiveRow(table, row), false));
    }
    function handoffBox(table, row, handoff) {
      const defaultText = String(handoff.text || '').replace(/\{(f\d+)\}/g, (_, id) => formatValue(fieldById(table, id), row.v?.[id]));
      const input = el('textarea', { class: 'cx-textarea', value: defaultText });
      return el('div', { class: 'cx-detail' }, el('p', { class: 'cx-help', text: T('extHandoffHint') }), input, button('extHandoff', async () => { const result = await setBusyNotice('handoff', { folder: state.item.folder, table: table.id, id: row.id, rev: row.rev, text: input.value }); if (result) { if (!result.demo) { await loadRows(); state.detail = latestRow(state.rows, row.id); } notify(T('extHanded')); } }, true, { data: { 'data-cx-handoff': '1' } }));
    }
    async function moveRow(id, toStage) {
      const table = selectedTable(), row = state.rows.find(item => item.id === id), field = stageField(table);
      if (!row || !field || row.v?.[field.id] === toStage) return;
      const from = row.v[field.id], before = clone(row);
      row.v[field.id] = toStage;
      render();
      if (ctx.demo) { showUndo(table, row, from, toStage); notify(T('extDemo')); return; }
      const result = await setBusyNotice('row', { folder: state.item.folder, table: table.id, op: 'update', id, rev: row.rev, v: { [field.id]: toStage } });
      if (!result) { Object.assign(row, before); await loadRows(); render(); return; }
      row.rev = result.row?.rev ?? Number(row.rev || 0) + 1;
      showUndo(table, row, from, toStage);
    }
    function showUndo(table, row, from, to) {
      clearTimeout(state.undo?.timer);
      state.undo = { row, from, to, timer: setTimeout(() => { state.undo = null; render(); }, 6000) };
      render();
    }
    function undoView() {
      if (!state.undo) return null;
      return el('div', { class: 'cx-undo', role: 'status' }, el('span', { text: T('extMovedUndo', { stage: stageById(selectedTable(), state.undo.to)?.label || '' }) }), el('i', { class: 'cx-undo-bar' }), button('extUndo', () => { const undo = state.undo; state.undo = null; moveRow(undo.row.id, undo.from); }));
    }
    async function archiveDone(table) { const result = await setBusyNotice('archiveDone', { folder: state.item.folder, table: table.id }); if (result) await loadRows().then(render); }
    async function archiveRow(table, row) { const result = await setBusyNotice('row', { folder: state.item.folder, table: table.id, op: row.archived ? 'restore' : 'archive', id: row.id, rev: row.rev, v: {} }); if (result) await loadRows().then(render); }

    async function openForm(row = null) {
      state.form = formRow(row, selectedTable());
      state.formSaving = false;
      state.detail = null;
      state.moreForm = false;
      state.boardView = 'form';
      if (!state.people.length) {
        try { const dashboard = await request('/api/dashboard'); state.people = peopleForForm(dashboard); } catch (_) { state.people = []; }
      }
      render();
    }
    function formView(table) {
      const row = state.form || { v: {} }, values = row.v || {}, allFields = fields(table), required = allFields.filter(field => field.required), optional = allFields.filter(field => !field.required), showMore = state.moreForm;
      const formFields = [...required, ...(showMore ? optional : [])].filter(field => field.type !== 'stage' || showMore);
      const grid = el('div', { class: 'cx-form-grid' }, ...formFields.map(field => inputField(table, field, values)));
      return el('section', { class: 'cx-form' }, el('h3', { text: row.id ? T('extEdit') : T('extNew') }), grid,
        !showMore && optional.length ? button('extMore', () => { state.moreForm = true; render(); }) : null,
        el('div', { class: 'cx-actions' }, button('extSave', () => saveForm(table), true, { disabled: state.formSaving, data: { 'data-cx-save': '1' } }), row.id && row.archived ? button('extRestore', () => { archiveRow(table, row); state.form = null; state.boardView = 'list'; }, false, { data: { 'data-cx-restore': '1' } }) : null, button('extCancel', () => { state.form = null; state.formSaving = false; state.moreForm = false; state.boardView = 'board'; render(); })));
    }
    function inputField(table, field, values) {
      const id = `cx-field-${field.id}`, value = values[field.id];
      const change = event => { state.form.v[field.id] = readInput(field, event.target, value); };
      let control;
      if (field.type === 'bool') control = el('input', { id, type: 'checkbox', checked: !!value, onchange: change });
      else if (field.type === 'choice' || field.type === 'stage') {
        control = el('select', { id, class: 'cx-select', onchange: change }, el('option', { value: '', text: '' }), ...array(field.type === 'choice' ? field.options : field.stages).map(option => el('option', { value: option.id, text: option.label, selected: option.id === value })));
      } else if (field.type === 'actor') {
        control = el('select', { id, class: 'cx-select', onchange: event => { const person = state.people.find(item => item.id === event.target.value); state.form.v[field.id] = person ? { id: person.id, name: person.name || person.label } : undefined; } }, el('option', { value: '', text: '' }), ...state.people.map(person => el('option', { value: person.id, text: person.name || person.label || '', selected: value?.id === person.id })));
      } else control = el('input', { id, class: 'cx-input', type: field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'money' ? 'number' : 'text', value: field.type === 'money' ? Number(value?.amountCents || 0) / 100 : value ?? '', oninput: change });
      return el('label', { class: 'cx-field', htmlFor: id }, el('span', {}, field.label, field.required ? el('b', { class: 'cx-required', text: T('extRequired') }) : null), control);
    }
    function readInput(field, input, previous) {
      if (field.type === 'bool') return !!input.checked;
      if (field.type === 'number') return input.value === '' ? undefined : Number(input.value);
      if (field.type === 'money') return moneyValue(field, input.value, previous);
      return input.value;
    }
    async function saveForm(table) {
      const row = state.form;
      if (!canSaveForm(state.formSaving, row)) return;
      state.formSaving = true;
      render();
      const result = await setBusyNotice('row', { folder: state.item.folder, table: table.id, ...rowRequest(row) });
      state.formSaving = false;
      if (result) { state.form = null; state.moreForm = false; state.boardView = 'board'; await loadRows(); }
      render();
    }
    function listView(table) {
      const groups = groupRows(table, state.rows, true), stage = stageField(table);
      let rows = state.rows.filter(row => state.archived ? !!row.archived : !row.archived);
      if (state.filter) rows = rows.filter(row => row.v?.[stage?.id] === state.filter);
      if (state.sort.id) {
        const field = fieldById(table, state.sort.id);
        rows.sort((a, b) => textValue(a.v?.[field.id]).localeCompare(textValue(b.v?.[field.id]), 'zh-Hant', { numeric: true }) * state.sort.dir);
      }
      const filter = el('select', { class: 'cx-select', onchange: event => { state.filter = event.target.value; render(); } }, el('option', { value: '', text: T('extAllStages') }), ...stages(table).map(item => el('option', { value: item.id, text: item.label, selected: item.id === state.filter })));
      const archived = el('button', { type: 'button', class: `cx-chip${state.archived ? ' cx-chip-on' : ''}`, text: T('extArchived'), onclick: () => { state.archived = !state.archived; render(); } });
      const head = field => el('th', {}, el('button', { type: 'button', text: field.label, onclick: () => { state.sort = { id: field.id, dir: state.sort.id === field.id ? -state.sort.dir : 1 }; render(); } }));
      return el('div', {}, el('div', { class: 'cx-row' }, filter, archived), el('div', { class: 'cx-list-wrap' }, el('table', { class: 'cx-table' }, el('thead', {}, el('tr', {}, ...fields(table).filter(field => !field.hidden).map(head))), el('tbody', {}, ...rows.map(row => el('tr', { 'data-cx-row': row.id, onclick: () => openForm(row) }, ...fields(table).filter(field => !field.hidden).map(field => el('td', { text: formatValue(field, row.v?.[field.id]) }))))))));
    }

    function render() {
      container.replaceChildren();
      const data = state.data || {};
      let screen;
      const draft = array(data.drafts).find(item => item?.id === state.draftId && ['drafting', 'ready', 'failed'].includes(item.state));
      if (data.error) screen = el('section', { class: 'cx-shell cx-error', text: data.error });
      else if (state.view === 'draft' && draft?.state === 'drafting') screen = draftingView(draft);
      else if (state.view === 'draft' && draft?.state === 'failed') screen = failedView(draft);
      else if (state.view === 'draft' && draft?.state === 'ready') screen = previewView(draft);
      else if (state.previewItem) screen = pendingPreview(state.previewItem);
      else if (state.view === 'create') screen = emptyView();
      else if (!array(data.items).length) screen = emptyView();
      else if (state.view === 'board' && state.item?.state === 'enabled') screen = activeView();
      else if (!state.item) screen = featureIndex();
      else screen = featureIndex();
      container.append(el('div', { class: 'cx-root' }, notice(), screen));
    }
    refresh();
    return { refresh, busy };
  }

  function overviewRows(container, data, ctx) {
    const T = (key, vars = {}) => {
      const names = ctx?.N || root.SOS_NAMES || {}; let value = typeof names.t === 'function' ? names.t(key, vars) : names?.ui?.[key] ?? names?.[key] ?? key;
      return String(value).replace(/\{([^}]+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
    };
    container.replaceChildren();
    const rows = overviewOrder(data?.rows).slice(0, 3);
    if (!rows.length) return;
    const block = el('section', { class: 'cx-root cx-overview' });
    rows.forEach(row => block.append(el('div', { class: 'cx-overview-row' }, el('button', { type: 'button', text: row.name || row.folder || '', onclick: () => ctx.go?.('ext') }), el('div', { class: 'cx-overview-values' }, ...array(row.values).slice(0, 2).map(value => el('span', { class: value.warn ? 'cx-warn' : '', text: `${value.label || ''} ${value.value ?? ''}` }))))));
    if (Number(data?.more || 0) > 0) block.append(el('button', { type: 'button', class: 'cx-button cx-overview-more', text: T('extMoreExt', { n: data.more }), onclick: () => ctx.go?.('ext') }));
    container.append(block);
  }

  root.CZExt = { mountTab, overviewRows, _pure: { dueState, isLastStage, nextStage, nextActionStage, compareRows, groupRows, overviewOrder, swapHost, pageUrl, formatDate, formatWhen, selectRefreshItem, decideExtView, afterEnableSelection, rowProblemCount, formRow, peopleForForm, hiddenFieldIds, canSaveForm, rowRequest, latestRow, moneyValue } };
})(typeof window === 'undefined' ? globalThis : window);
