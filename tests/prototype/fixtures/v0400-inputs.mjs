// 0.40.0 入口重整的虛構資料（公司「從田間到餐桌」）：在一個獨立資料夾生成帳本、問題包、附件及公司概覽。
// 由 demo-seed.mjs 打底（公司概覽已確認、里程碑、決定紀錄），再換上本版要展示的「交給 Zero 的事」。
// 只寫傳入的資料夾；絕不碰真實 data/。附件是自行產生的小 PDF、PNG、純文字，沒有任何真實內容。
// 用法：import { buildV0400 } from './v0400-inputs.mjs'; buildV0400(dir, PROTO, { confirmed: true });
// 狀態覆蓋：等你確認（A）、已更新紀錄含改動前後及已加入日程（B）、沒有影響含原因（C）、Zero 處理中（D）、
// 文件類 PDF＋Word 轉文字版（E／A）、Google 試算表連結及來自討論（F）、更新前的舊紀錄（G）、想改計劃（H）；跨兩個月。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const pad = n => String(n).padStart(2, '0');
const localIso = d => { const off = -d.getTimezoneOffset(), a = Math.abs(off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; };
const dayText = iso => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso); return (+m[2]) + ' 月 ' + (+m[3]) + ' 日'; };

// 小 PDF（一頁一行字，純 ASCII；內容只是示意）
export function tinyPdf(lines) {
  const text = lines.map((l, i) => `BT /F1 14 Tf 50 ${760 - i * 22} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// 小 PNG（純色加橫條，示意用的「訂單截圖」）
export function tinyPng(w = 360, h = 220, rgb = [236, 232, 222]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const bar = y % 40 > 28 && x > 24 && x < w - 24, o = y * (w * 3 + 1) + 1 + x * 3; const c = bar ? [120, 150, 130] : rgb; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function buildV0400(dir, PROTO, { confirmed = true, now = new Date(), adapter = '' } = {}) {
  const demo = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
  const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  demo.seedDemo(dir, { reset: true, now });
  const ledger = path.join(dir, 'ledger'), W = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o, null, 2)); };
  const R = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const at = (back, hh = 9, mm = 0) => localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hh, mm, 0));
  const ymd = (back) => at(back).slice(0, 10);
  // 示範帳本換成一般帳本：相對時間按今日算好，不再標示範
  let st = dash.resolveTimes(R(path.join(ledger, 'state.json')), now);
  delete st.demo;
  st.runs = (st.runs || []).filter(r => r.state !== 'running');
  for (const k of Object.keys(st.health || {})) if (k === 'warnings') st.health.warnings = [];
  // 舊問題包全部移走，只留本版要展示的
  for (const f of fs.readdirSync(path.join(dir, 'asks'))) fs.rmSync(path.join(dir, 'asks', f));
  // ---- 附件（歸檔位置 archive/<年-月>/；檔名照現行規則 <編號>-note-event-file-NN-名稱）----
  const arch = id => path.join(dir, 'archive', id.slice(0, 7));
  const rel = f => path.relative(dir, f).replace(/\\/g, '/');
  const stampOf = (back, hh, mm, n) => `${ymd(back)}-${pad(hh)}${pad(mm)}00-${String(n).padStart(3, '0')}`;
  const mk = (stamp, type, files, body, back, hh, mm) => {
    const a = arch(stamp), note = path.join(a, `${stamp}-note-${type}.md`);
    W(note, `kind: note\ntype: ${type}\nat: ${at(back, hh, mm)}\n\n${body}\n`);
    const stored = files.map((f, i) => { const p = path.join(a, `${stamp}-note-${type}-file-${pad(i + 1)}-${f.name}`); W(p, f.bytes); return rel(p); });
    return { note: rel(note), stored };
  };
  const pdf = n => tinyPdf(['Meeting record ' + n, 'Supply: 10 boxes next week, trial sale', 'Price: 380 per box', 'Reply to company A before Nov 20']);
  // ---- 八件交給 Zero 的事 ----
  const inputs = [], packs = [], answers = {}, runs = [];
  const q = (id, ask, rec, opts, why) => ({ id, priority: +id.slice(1), about: ask, ask, judge: '只計對方的行動；沒有紀錄時，建議先不標示完成。', kind: 'choice', effect: 'now', options: opts.map((o, i) => ({ text: o, ...(i === 0 ? { rec: true } : {}), apply: { op: 'keep' } })), value: rec, why });
  const pack = (id, title, back, hh, mm, qs, extra = {}) => { const p = { format: 'startup-os.ask/0.1', id, title, context: '', afterConfirm: '確認的項目即時更新公司紀錄', next: null, askedBy: 'AI', askedAt: at(back, hh, mm), fromRun: null, todoType: 'decision', questions: qs, ...extra }; packs.push(p); return p; };
  const run = (ref, back, hh, mm, label, detail, summary) => runs.push({ id: 'R-' + ref, kind: 'note', ref, noteType: 'event', state: 'done', startedAt: at(back, hh, mm), endedAt: at(back, hh, mm + 2), label, steps: [{ key: 'applied', label: '登記你的要求', state: 'done', detail: '' }, { key: 'ai', label, state: 'done', detail }], result: { summary, artifacts: [], founderNext: [] } });

  // B：已更新紀錄（含改動前後、已加入日程、附件 PNG；事件日期 3 日前、昨晚才記錄）
  { const stamp = stampOf(1, 22, 5, 11), m = mk(stamp, 'event', [{ name: '餐廳乙訂單截圖.png', bytes: tinyPng() }], '餐廳乙試用一週後下了第二張單，付了訂金，說以後逢星期二落單。', 1, 22, 5);
    const ev = ymd(4); const id = 'in-' + stamp;
    pack('ask-v4-b', '確認發生了一件事（' + dayText(ev) + '）', 1, 22, 20, [q('q1', '「餐廳願意為可追溯來源付較高價錢」現在到了哪個程度？', '付出成本', ['付出成本', '維持實際行動'], '對方已付訂金，屬付出成本。'), q('q2', '「餐廳試單」這一站是否已經完成？', '已完成，以這次紀錄作證明', ['已完成，以這次紀錄作證明', '尚未完成'], '訂單截圖可作證明。')]);
    answers['ask-v4-b'] = { answers: { q1: { value: '付出成本', changed: false, at: at(0, 7, 5) }, q2: { value: '已完成，以這次紀錄作證明', changed: false, at: at(0, 7, 5) } } };
    inputs.push({ id, kind: 'inbox', via: 'event', title: '發生了一件事（' + dayText(ev) + '）：餐廳乙試用一週後下了第二張單', file: m.note, files: m.stored, eventDate: ev, receivedAt: at(1, 22, 5), status: 'processed', processedAt: at(0, 7, 6), packId: 'ask-v4-b', summary: '餐廳乙在試用一週後下了第二張單並付訂金。',
      read: { summary: '讀了你的原話和 1 份附件；對照公司紀錄的 5 個站點和 4 條假設，找到 2 項可能受影響：假設「餐廳願意為可追溯來源付較高價錢」、站點「餐廳試單」。', highlights: [] },
      effects: [{ targetKind: 'assumption', targetId: 'H1', change: '假設「餐廳願意為可追溯來源付較高價錢」', before: '口頭表示', after: '付出成本' }, { targetKind: 'milestone', targetId: 'm2', change: '站點「餐廳試單」', before: '進行中', after: '已完成（證明：餐廳乙訂單截圖.png）' },
        { targetKind: 'decision', targetId: 'ask-v4-b', change: '下一個對外動作：維持「約農場主丙簽供應協議」' }, { targetKind: 'followUp', targetId: 'f-v4-1', change: '回覆甲公司', dueAt: ymd(-13) }] });
    st.tasks = (st.tasks || []).concat([{ id: 'f-v4-1', title: '回覆甲公司', owner: 'founder', milestoneId: 'm1', status: 'planned', dueAt: ymd(-13) + 'T10:00:00+08:00', next: '回覆甲公司報價', updatedAt: at(0, 7, 6) }]);
    run('v4-b', 1, 22, 6, 'Zero 擬定對方做到哪一步及站點進度的確認問題', '已擬定 2 條確認題，等你確認', '讀了餐廳乙的訂單截圖，擬了 2 條確認題。'); }
  // D：Zero 處理中（請 Zero 做一件事；昨晚送出，未有工作紀錄）
  { const stamp = stampOf(1, 20, 13, 21), m = mk(stamp, 'adhoc', [], '請擬一張聖誕節餐廳推廣單張，下星期五前交付。', 1, 20, 13);
    inputs.push({ id: 'in-' + stamp, kind: 'inbox', via: 'adhoc', title: '請 Zero 做一件事：聖誕節餐廳推廣單張，下星期五前交付', file: m.note, files: [], receivedAt: at(1, 20, 13), status: 'unprocessed', effects: [] }); }
  // A：等你確認（PDF 會議紀錄，文件重點每句附頁碼；兩題未答）
  { const stamp = stampOf(1, 18, 40, 31), m = mk(stamp, 'event', [{ name: '農場甲會議紀錄.pdf', bytes: pdf('A') }], '農場甲陳先生今日書面確認，下星期先供應十箱試賣；分帳約定下次再談。', 1, 18, 40);
    const ev = ymd(1), id = 'in-' + stamp;
    pack('ask-v4-a', '確認發生了一件事（' + dayText(ev) + '）', 1, 18, 55, [q('q1', '「兩個農場可以每週穩定供貨」現在到了哪個程度？', '實際行動', ['實際行動', '維持口頭表示'], '對方書面確認供貨，屬實際行動。'), q('q2', '下一個對外動作要改成甚麼？', '約農場主丙簽供應協議', ['約農場主丙簽供應協議', '維持現狀'], '農場甲已確認，下一步是簽約。')]);
    inputs.push({ id, kind: 'inbox', via: 'event', title: '發生了一件事（' + dayText(ev) + '）：農場甲陳先生書面確認下星期供應十箱試賣', file: m.note, files: m.stored, eventDate: ev, receivedAt: at(1, 18, 40), status: 'awaitingFounder', awaitingFounderText: '請確認這件事對對方做到哪一步及站點進度的影響', packId: 'ask-v4-a', summary: '農場甲書面確認下星期先供應十箱試賣。',
      read: { summary: '讀了你的原話和 1 份附件；對照公司紀錄的 5 個站點和 4 條假設，找到 2 項可能受影響：假設「兩個農場可以每週穩定供貨」、下一個對外動作。', highlights: [
        { text: '日期：農場甲同意由 ' + dayText(ymd(-7)) + ' 起供應試賣十箱。', page: 1 }, { text: '金額：每箱 380 元，月結。', page: 2 }, { text: '責任：農場甲負責裝箱，並送到集貨點。', page: 2 }, { text: '跟進：' + dayText(ymd(-13)) + ' 前要回覆甲公司報價。', page: 3 }] },
      effects: [] });
    run('v4-a', 1, 18, 42, 'Zero 擬定對方做到哪一步及站點進度的確認問題', '已擬定 2 條確認題，等你確認', '讀了農場甲的會議紀錄，擬了 2 條確認題。'); }
  // F：來自與 Zero 的討論，附 Google 試算表連結（另有一個連結讀不到）；已更新紀錄
  { const stamp = stampOf(2, 21, 30, 41), m = mk(stamp, 'event', [{ name: '預算表.xlsx', bytes: Buffer.from('PK fake spreadsheet for prototype') }, { name: '預算表.xlsx.md', bytes: Buffer.from('# 預算表\n\n| 項目 | 金額 |\n|---|---|\n| 包裝 | 4,500 |\n| 送貨 | 3,200 |\n') }], '與 Zero 討論後確認：第一季預算以三個月計，包裝及送貨先各佔四成。', 2, 21, 30);
    const ev = ymd(2), id = 'in-' + stamp;
    inputs.push({ id, kind: 'inbox', via: 'event', source: 'chat', title: '第一季預算以三個月計，包裝及送貨先各佔四成', file: m.note, files: [m.stored[0]], eventDate: ev, receivedAt: at(2, 21, 30), status: 'processed', processedAt: at(2, 21, 40), summary: '第一季預算按三個月計。',
      fileInfo: [{ file: m.stored[0], text: m.stored[1], url: 'https://docs.google.com/spreadsheets/d/EXAMPLE-ID/edit', readOn: ymd(0), kind: 'google-sheet', convert: 'ok' }],
      linkErrors: [{ url: 'https://docs.google.com/document/d/PRIVATE-ID/edit', kind: 'google-doc', reason: 'not-shared' }],
      read: { summary: '讀了討論結論和 1 份 Google 試算表；試算表列出包裝及送貨兩項支出，與討論一致。', highlights: [{ text: '金額：包裝 4,500 元、送貨 3,200 元。', page: 1 }] },
      effects: [{ targetKind: 'decision', targetId: 'ask-v4-f', change: '下一個對外動作', before: '約農場主丙簽供應協議', after: '約農場主丙簽供應協議（附預算表）' }] }); }
  // C：沒有影響（含原因）
  { const stamp = stampOf(2, 9, 12, 51), m = mk(stamp, 'event', [], '朋友介紹一位做包裝的設計師，之後可能有用。', 2, 9, 12); const ev = ymd(2);
    inputs.push({ id: 'in-' + stamp, kind: 'inbox', via: 'event', title: '發生了一件事（' + dayText(ev) + '）：朋友介紹一位做包裝的設計師', file: m.note, files: [], eventDate: ev, receivedAt: at(2, 9, 12), status: 'processed', processedAt: at(2, 9, 16), summary: '朋友介紹了包裝設計師。',
      read: { summary: '讀了你的原話；對照公司紀錄的 5 個站點和 4 條假設。', highlights: [] }, reason: '這件事沒有改變任何對方的行動（沒有餐廳或農場做了或答應了甚麼），所以對方做到哪一步和站點進度都不變；已記入紀錄，Zero 日後擬見面簡介時會參考。', effects: [] }); }
  // E：只附文件、沒有文字（Word 轉文字版）
  { const stamp = stampOf(3, 10, 10, 61), m = mk(stamp, 'doc', [{ name: '供應協議草稿.docx', bytes: Buffer.from('PK fake docx for prototype') }, { name: '供應協議草稿.docx.md', bytes: Buffer.from('# 供應協議草稿\n\n1. 供應期：首三個月。\n2. 價格：按當週市價。\n') }], '（沒有補充）', 3, 10, 10); const ev = ymd(3);
    inputs.push({ id: 'in-' + stamp, kind: 'inbox', via: 'doc', title: '文件（' + dayText(ev) + '）：供應協議草稿', file: m.note, files: [m.stored[0]], eventDate: ev, receivedAt: at(3, 10, 10), status: 'processed', processedAt: at(3, 10, 14), summary: '協議草稿列明供應期及價格。',
      fileInfo: [{ file: m.stored[0], text: m.stored[1], convert: 'ok' }],
      read: { summary: '讀了 1 份 Word 文件的文字及表格；文件只寫明供應期及價格，沒有公司以外已發生的事。', highlights: [{ text: '日期：供應期為首三個月。' }, { text: '金額：按當週市價計算。' }] },
      effects: [{ targetKind: 'decision', targetId: 'ask-v4-e', change: '下一個對外動作：維持「約農場主丙簽供應協議」' }] }); }
  // G：更新前送出的舊紀錄（沒有新欄位；上個月）
  { const stamp = stampOf(9, 16, 20, 71), ev = ymd(9);
    inputs.push({ id: 'in-' + stamp, kind: 'inbox', via: 'event', title: '真實事件（' + dayText(ev) + '）：與農場乙通話，對方表示考慮兩星期', file: '', files: [], eventDate: ev, receivedAt: at(9, 16, 20), status: 'processed', processedAt: at(9, 16, 30), summary: '農場乙表示會考慮兩星期。', effects: [{ targetKind: 'assumption', targetId: 'H2', change: '「兩個農場可以每週穩定供貨」維持「口頭表示」' }] }); }
  // H：想改計劃（上個月）
  { const stamp = stampOf(11, 11, 0, 81), m = mk(stamp, 'order', [], '牌照與保險須於任何送貨前辦妥；另想新增一站「廚師試食會」。', 11, 11, 0);
    inputs.push({ id: 'in-' + stamp, kind: 'inbox', via: 'order', title: '想改計劃：牌照與保險須於任何送貨前辦妥，並新增「廚師試食會」一站', file: m.note, files: [], receivedAt: at(11, 11, 0), status: 'processed', processedAt: at(11, 11, 20), summary: '路線次序已按你的要求調整。',
      read: { summary: '讀了你的要求；對照現有 5 個站點，擬了 1 條路線確認題。', highlights: [] }, effects: [{ targetKind: 'milestone', targetId: 'm4', change: '站點「牌照與保險」', before: '第 3 站', after: '第 1 站' }] }); }

  st.inputs = inputs;
  for (const p of packs) W(path.join(dir, 'asks', p.id + '.json'), p);
  for (const [id, a] of Object.entries(answers)) W(path.join(ledger, 'answers', id + '.json'), a);
  W(path.join(ledger, 'state.json'), st);
  W(path.join(ledger, 'status.json'), { runs: runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))) });
  // 公司概覽未確認（用來截門檻畫面）：公司概覽已擬好，但沒有確認紀錄
  if (!confirmed) fs.rmSync(path.join(ledger, 'confirmed.json'), { force: true });
  // 公司概覽「Zero 依據」：來源加網址、讀取日期、存檔（第 12 張截圖）
  const pageFile = path.join(dir, 'company', 'page.json'), page = R(pageFile);
  const snap = path.join(dir, 'archive', ymd(20).slice(0, 7), 'intake-v4'); fs.mkdirSync(snap, { recursive: true });
  W(path.join(snap, '商業計劃.pdf'), pdf('plan')); W(path.join(snap, '預算表.xlsx'), Buffer.from('PK fake spreadsheet'));
  page.sources = [{ id: 's1', title: '商業計劃', date: ymd(20), note: '創辦人提供的商業計劃書', file: rel(path.join(snap, '商業計劃.pdf')) },
    { id: 's2', title: '預算表（Google 試算表）', date: ymd(5), note: '創辦人貼上的 Google 連結', url: 'https://docs.google.com/spreadsheets/d/EXAMPLE-ID/edit', readOn: ymd(5), file: rel(path.join(snap, '預算表.xlsx')) },
    { id: 's3', title: '農場訪問紀錄', date: ymd(12), note: '創辦人口述，由 Zero 整理' }];
  W(pageFile, page);
  // AI 工具認證：用標示為 Claude Code 的測試設定（只認證，不會啟動任何真實 AI）
  if (adapter) {
    const host = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
    const h = { ...R(adapter), file: path.resolve(adapter) }; h.id = h.id || 'test';
    W(path.join(ledger, 'adapter-cert.json'), { host: h.file, label: h.label || h.name, certifiedAt: new Date().toISOString(), version: host.version(h), argsHash: host.hashHost(h), results: [] });
  }
  return { dir, inputs: inputs.map(i => i.id), packs: packs.map(p => p.id) };
}
