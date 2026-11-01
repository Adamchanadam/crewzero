// startup-os Founder Desk：將 AI 產出嘅 Markdown 排好版顯示（標題、粗體、清單、表格、引言、分隔線、程式碼）。
// 一律用 DOM 建立、只放文字，唔用 innerHTML，AI 寫咩都唔會變成網頁程式；唔載外部程式。
// 「要確認／未確認／未答應／暫定／已答」呢類狀態字會自動變成有顏色嘅標記（標題除外），一眼睇到邊啲未定。
// 手機上（窄過 560px）表格每行變一張小卡：第一欄做標題，其餘逐行「欄名：內容」，唔使左右掃。
(function () {
  var MARK = /(要確認|未確認|未答應|創辦人已答|你已答|已答|暫定)/;
  var TONE = { '要確認': 'warn', '未確認': 'warn', '未答應': 'warn', '暫定': 'wait', '創辦人已答': 'ok', '你已答': 'ok', '已答': 'ok' };
  var CSS = [
    '.md{font:13.5px/1.7 var(--ui);color:var(--text);overflow-wrap:anywhere}',
    '.md>:first-child{margin-top:4px}',
    '.md p{margin:8px 0}',
    '.md .md-h1{font-size:17px;font-weight:700;margin:14px 0 6px;color:var(--text)}',
    '.md .md-h2{font-size:15px;font-weight:700;margin:18px 0 6px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--amber)}',
    '.md .md-h3{font-size:14px;font-weight:700;margin:14px 0 4px;color:var(--mint)}',
    '.md .md-h4{font-size:13.5px;font-weight:700;margin:10px 0 4px;color:var(--text)}',
    '.md strong{color:#fff;font-weight:700}',
    '.md code{font:12px var(--mono);padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.07)}',
    '.md ul,.md ol{margin:6px 0;padding-left:22px}',
    '.md li{margin:4px 0}',
    '.md li::marker{color:var(--amber)}',
    '.md hr{border:0;border-top:1px solid var(--line);margin:16px 0}',
    '.md blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--amber);background:rgba(232,141,79,.07);border-radius:0 6px 6px 0}',
    '.md .md-table{overflow-x:auto;margin:10px 0;border:1px solid var(--line);border-radius:8px}',
    '.md table{border-collapse:collapse;width:100%;min-width:520px;font-size:13px;line-height:1.55}',
    '.md th{background:rgba(255,255,255,.06);color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;white-space:nowrap}',
    '.md td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}',
    '.md tbody tr:nth-child(even) td{background:rgba(255,255,255,.022)}',
    '.md td:first-child{color:var(--text);font-weight:600;white-space:nowrap}',
    '.md .md-mark{display:inline-block;white-space:nowrap;font-size:11.5px;line-height:1.35;padding:1px 6px;border-radius:5px;margin:0 2px;font-weight:600;vertical-align:1px}',
    '.md .md-mark.warn{background:rgba(232,141,79,.18);color:var(--amber)}',
    '.md .md-mark.wait{background:rgba(239,179,127,.13);color:var(--wait)}',
    '.md .md-mark.ok{background:rgba(153,215,188,.15);color:var(--mint)}',
    '@media (max-width:560px){.md table{min-width:0}.md thead{display:none}.md tr{display:block;padding:6px 0;border-top:1px solid var(--line)}.md tbody tr:first-child{border-top:0}.md td{display:block;border:0;padding:2px 12px}.md td::before{content:attr(data-label) "：";color:var(--muted);font-weight:400}.md td:first-child{white-space:normal;padding-top:4px}.md td:first-child::before{content:none}.md tbody tr:nth-child(even) td{background:none}.md tbody tr:nth-child(even){background:rgba(255,255,255,.022)}}',
    '.md pre.md-code{font:12px/1.5 var(--mono);white-space:pre-wrap;background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:7px;padding:10px;margin:8px 0}'
  ].join('\n');

  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function marks(parent, text) {
    text.split(MARK).forEach(function (part, i) {
      if (!part) return;
      if (i % 2) { var s = el('span', 'md-mark ' + TONE[part]); s.textContent = part; parent.appendChild(s); }
      else parent.appendChild(document.createTextNode(part));
    });
  }
  // 行內：**粗體**、`字`；plain＝唔加狀態標記（標題用）
  function inline(parent, text, plain) {
    var put = plain ? function (p, s) { p.appendChild(document.createTextNode(s)); } : marks;
    var re = /\*\*([^*]+)\*\*|`([^`]+)`/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) put(parent, text.slice(last, m.index));
      var x = el(m[1] != null ? 'strong' : 'code');
      if (m[1] != null) put(x, m[1]); else x.textContent = m[2];
      parent.appendChild(x);
      last = re.lastIndex;
    }
    if (last < text.length) put(parent, text.slice(last));
    return parent;
  }
  function cells(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  function isSep(line) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line || ''); }
  var LIST = /^\s*([-*]|\d+[.)])\s+(.*)$/;

  function render(src) {
    var root = el('div', 'md'), lines = String(src || '').replace(/\r/g, '').split('\n'), i = 0, para = null, m;
    while (i < lines.length) {
      var t = lines[i].trim();
      if (!t) { para = null; i++; continue; }
      if (/^```/.test(t)) {
        para = null; var buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
        var pre = el('pre', 'md-code'); pre.textContent = buf.join('\n'); root.appendChild(pre); i++; continue;
      }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) { para = null; root.appendChild(inline(el('h' + (m[1].length + 2), 'md-h' + m[1].length), m[2], true)); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { para = null; root.appendChild(el('hr')); i++; continue; }
      if (t.charAt(0) === '|' && isSep(lines[i + 1])) {
        para = null;
        var wrap = el('div', 'md-table'), table = el('table'), head = el('tr'), body = el('tbody'), labels = cells(t);
        labels.forEach(function (c) { head.appendChild(inline(el('th'), c, true)); });
        var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
        i += 2;
        while (i < lines.length && lines[i].trim().charAt(0) === '|') {
          var tr = el('tr'); cells(lines[i]).forEach(function (c, k) { var td = inline(el('td'), c); td.setAttribute('data-label', (labels[k] || '').replace(/\*\*/g, '')); tr.appendChild(td); }); body.appendChild(tr); i++;
        }
        table.appendChild(body); wrap.appendChild(table); root.appendChild(wrap); continue;
      }
      if ((m = LIST.exec(t))) {
        para = null;
        var ordered = /\d/.test(m[1]), list = el(ordered ? 'ol' : 'ul');
        while (i < lines.length && (m = LIST.exec(lines[i])) && /\d/.test(m[1]) === ordered) { list.appendChild(inline(el('li'), m[2])); i++; }
        root.appendChild(list); continue;
      }
      if (t.charAt(0) === '>') { para = null; root.appendChild(inline(el('blockquote'), t.replace(/^>\s?/, ''))); i++; continue; }
      if (!para) { para = el('p'); root.appendChild(para); } else para.appendChild(el('br'));
      inline(para, t); i++;
    }
    return root;
  }

  var style = document.createElement('style');
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
  window.SOS_MD = render;
})();
