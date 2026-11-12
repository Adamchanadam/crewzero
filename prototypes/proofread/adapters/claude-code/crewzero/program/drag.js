// 延伸功能共用拖放：清單排序及看板跨欄移動。
(function (root) {
  'use strict';

  const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const childId = element => element && (element.dataset.cxId || element.dataset.id || '');
  const closest = (node, selector) => node && node.closest ? node.closest(selector) : null;

  function sortList(listEl, opts = {}) {
    if (!listEl) return () => {};
    const itemSelector = opts.itemSelector || '[data-cx-sort-item]';
    const handleSelector = opts.handleSelector || '[data-cx-drag-handle]';
    const state = { drag: null };
    const order = () => Array.from(listEl.querySelectorAll(`:scope > ${itemSelector}`)).map(childId).filter(Boolean);
    const finish = (event, cancelled) => {
      const drag = state.drag;
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      state.drag = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      drag.item.classList.remove('cx-sorting');
      drag.item.style.transform = '';
      if (!cancelled && drag.changed) opts.onSort?.(order());
    };
    const cancel = event => finish(event, true);
    const move = event => {
      const drag = state.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const delta = event.clientY - drag.lastY;
      drag.lastY = event.clientY;
      drag.offset += delta;
      if (Math.abs(drag.offset) > 3) drag.moved = true;
      drag.item.style.transform = `translateY(${drag.offset}px)`;
      const middle = drag.item.getBoundingClientRect().top + drag.item.getBoundingClientRect().height / 2;
      const previous = drag.item.previousElementSibling;
      const next = drag.item.nextElementSibling;
      if (next && next.matches(itemSelector) && middle > next.getBoundingClientRect().top + next.getBoundingClientRect().height / 2) {
        listEl.insertBefore(next, drag.item);
        drag.offset -= next.offsetHeight;
        drag.changed = true;
      } else if (previous && previous.matches(itemSelector) && middle < previous.getBoundingClientRect().top + previous.getBoundingClientRect().height / 2) {
        listEl.insertBefore(drag.item, previous);
        drag.offset += previous.offsetHeight;
        drag.changed = true;
      }
      drag.item.style.transform = `translateY(${drag.offset}px)`;
    };
    const down = event => {
      const handle = closest(event.target, handleSelector);
      const item = handle && closest(handle, itemSelector);
      if (!item || !listEl.contains(item) || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      state.drag = { item, pointerId: event.pointerId, lastY: event.clientY, offset: 0, moved: false, changed: false };
      item.classList.add('cx-sorting');
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    };
    const keydown = event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const handle = closest(event.target, handleSelector);
      const item = handle && closest(handle, itemSelector);
      if (!item || !listEl.contains(item)) return;
      const sibling = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
      if (!sibling || !sibling.matches(itemSelector)) return;
      event.preventDefault();
      if (event.key === 'ArrowUp') listEl.insertBefore(item, sibling);
      else listEl.insertBefore(sibling, item);
      opts.onSort?.(order());
      handle.focus();
    };
    listEl.addEventListener('pointerdown', down);
    listEl.addEventListener('keydown', keydown);
    return () => {
      finish(null, true);
      listEl.removeEventListener('pointerdown', down);
      listEl.removeEventListener('keydown', keydown);
    };
  }

  function boardDrag(boardEl, opts = {}) {
    if (!boardEl) return () => {};
    const cardSelector = opts.cardSelector || '[data-cx-card]';
    const columnSelector = opts.columnSelector || '[data-cx-stage]';
    const threshold = Number(opts.threshold || 6);
    const disabled = () => !!(typeof opts.disabled === 'function' ? opts.disabled() : opts.disabled) || window.matchMedia?.('(max-width: 700px)').matches;
    let drag = null;
    const setOver = column => {
      if (drag?.over && drag.over !== column) drag.over.classList.remove('cx-drop-target');
      if (column) column.classList.add('cx-drop-target');
      if (drag) drag.over = column || null;
    };
    const cleanup = () => {
      if (!drag) return;
      drag.card.classList.remove('cx-dragging');
      drag.ghost?.remove();
      setOver(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
      drag = null;
      opts.onState?.(false);
    };
    const scroll = event => {
      const rect = boardEl.getBoundingClientRect();
      const edge = Math.max(28, Number(opts.edge || 42));
      if (event.clientX > rect.right - edge) boardEl.scrollLeft += Number(opts.scrollStep || 24);
      else if (event.clientX < rect.left + edge) boardEl.scrollLeft -= Number(opts.scrollStep || 24);
    };
    const move = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        if (pointDistance({ x: event.clientX, y: event.clientY }, drag.start) < threshold) return;
        drag.started = true;
        drag.card.classList.add('cx-dragging');
        drag.ghost = drag.card.cloneNode(true);
        drag.ghost.classList.add('cx-drag-ghost');
        drag.ghost.removeAttribute('id');
        document.body.appendChild(drag.ghost);
        opts.onState?.(true);
      }
      event.preventDefault();
      drag.ghost.style.left = `${event.clientX - 20}px`;
      drag.ghost.style.top = `${event.clientY - 16}px`;
      drag.ghost.style.display = 'none';
      const under = document.elementFromPoint(event.clientX, event.clientY);
      drag.ghost.style.display = '';
      setOver(closest(under, columnSelector));
      scroll(event);
    };
    const up = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const result = { id: childId(drag.card), stage: drag.over?.dataset.cxStage || drag.over?.dataset.stage || '', started: drag.started };
      cleanup();
      if (!result.started) opts.onOpen?.(result.id);
      else if (result.stage) opts.onMove?.(result.id, result.stage);
    };
    const cancel = event => {
      if (drag && (!event || event.pointerId === drag.pointerId)) cleanup();
    };
    const escape = event => { if (event.key === 'Escape') cleanup(); };
    const down = event => {
      if (disabled() || (event.button !== undefined && event.button !== 0)) return;
      const card = closest(event.target, cardSelector);
      if (!card || !boardEl.contains(card)) return;
      drag = { card, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, started: false, ghost: null, over: null };
      try { card.setPointerCapture(event.pointerId); } catch (_) {}
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape);
    };
    boardEl.addEventListener('pointerdown', down);
    return () => { cleanup(); boardEl.removeEventListener('pointerdown', down); };
  }

  root.CZDrag = { sortList, boardDrag };
})(typeof window === 'undefined' ? globalThis : window);
