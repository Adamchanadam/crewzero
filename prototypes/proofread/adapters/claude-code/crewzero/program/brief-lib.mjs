// 八段自足工作說明：組裝與機械核對（0.41.0，設計稿；唯一定義處）。純函數：只收資料、回文字或判定；不讀寫檔。
// 方案 proposal-v2.md 第 5 節；狀態表 Z24–Z26。全部段落由外殼從公司紀錄填入，角色卡只供「範圍」「權限」「交付與驗收」底稿，AI 不填任何一段。

export const SECTIONS = ['目標', '範圍與排除', '必要來源位置', '輸入與進度', '權限', '第一步', '交付與驗收', '停止及回報條件'];
export const GLOSSARY_HEAD = '名詞表';
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
export const heading = i => `## ${NUM[i]}、${SECTIONS[i]}`;
// 禁用字眼（唯一定義處；state-table-041.md 同列）：說明必須自足，不可指向上一次工作。
// 多字片語直接比對；兩字詞（如前、如上、同上、同前）只在成詞收尾時算——後面是標點或句尾，而且前面不是「例」——「例如上網」「例如前期」不算，「範圍如前。」「做法同上」算（必修 7）。
export const FORBIDDEN = ['按上文', '照上文', '照舊', '如上所述', '如前所述', '見上次', '見上文', '見前文', '上次那樣', '照上次', '沿用上次', '之前那份', '之前那樣', '如之前', '同之前', '參考上次', '按之前', '如前', '如上', '同上', '同前'];
const SHORT = new Set(['如前', '如上', '同上', '同前']);
const PUNCT = '，。；：、！？（）()「」『』\\s';
export const forbiddenHits = text => { const t = String(text || ''); return FORBIDDEN.filter(w => SHORT.has(w) ? new RegExp(`(?<!例)${w}([${PUNCT}]|$)`, 'm').test(t) : t.includes(w)); };
export const FIRST_STEP_PREFIX = '先完整讀一次第三段列出的檔，再';
export const STOP_TEXT = ['做完即停，不做其他事。', '做不到時在收據寫清等候甚麼（等誰、等哪件事）。', '要創辦人決定或提供的事，一律寫成問題包，不寫在產出內等人發現。', '不可對外聯絡、發送或承諾任何事；訊息一律是草稿，開頭寫「草稿，未發送」。', '不假設文件沒有寫的事實；不知道就寫「要確認」。'];
const PROOFREAD_STOP = ['做完即停。', '來源內找不到便寫「未能核對」，不要猜。', '不提出新問題給創辦人。'];

const line = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const bullets = (arr, empty = '（沒有）') => { const l = (arr || []).map(line).filter(Boolean); return l.length ? l.map(x => '- ' + x).join('\n') : empty; };
// 引述的資料（創辦人的答案、退回原因、校對問題、未知事項、先前做過的件、今日已做的件）不是外殼寫的句子：包在反引號內，機械核對（禁用字眼、名詞表）不掃反引號內的字。
// 先把資料內的反引號換成單引號，創辦人的答案才不能拆開外殼的引述；外面再加「」，引述內容以「」結尾，不會被當成檔名（第三段的檔名核對只認副檔名結尾）。
const quoted = s => { const t = line(s).replace(/`/g, "'"); return t ? '`「' + t + '」`' : ''; };
const quotedBullets = (arr, empty) => bullets((arr || []).map(quoted).filter(Boolean), empty);

/* ---------- 組裝（Z24）。parts 由外殼從公司紀錄機械填入：
   { station: { short, event, doneWhen }, task: { title, next }, role: { title, deliverables, bounds, sources },
     exclude: [], files: [{ name, about }], web: { allowed, note }, progress: { before: [], answered: [], unknown: [], todayDone: [], rewriteIssues: [] },
     permissions: { self, tellAfter, askFirst }, deliver: { types, max, proofread: boolean, receiptFormat, acceptance }, glossary: [{ term, meaning }], kind: 'work'|'rewrite'|'proofread' } ---------- */
export function buildBrief(p = {}) {
  const st = p.station || {}, task = p.task || {}, role = p.role || {}, prog = p.progress || {}, perm = p.permissions || {}, dl = p.deliver || {};
  const roleName = line(role.title) || 'Zero 統籌';
  const out = [`# 工作說明：${quoted(task.title) || '今次的工作'}`, '', `負責崗位：${roleName}`, ''];
  out.push(heading(0), '', `這次為站「${line(st.short)}」服務；要令「${quoted(st.event)}」發生。`, `完成條件（原文）：${quoted(st.doneWhen) || '（公司紀錄未填）'}`, `這件工作：${quoted(task.title)}${task.next ? '——' + quoted(task.next) : ''}`, '');
  out.push(heading(1), '', '只做上述這一項工作。', '不做：', bullets(p.exclude, '- 其他崗位負責的站的工作\n- 恆常任務（名單整理、商機掃描、生意體檢）\n- 已完成並交付的產出'), '');
  out.push(heading(2), '', '隔離資料夾內的檔（只可讀這些）：', bullets((p.files || []).map(f => `\`${line(f.name)}\`：${line(f.about)}`), '（只有本說明）'), '', (p.web && p.web.allowed) ? `可以上網：只可讀取，${line(p.web.note) || '每條引用附出處網址，先開頁讀全文'}。` : '不可上網；只對照資料夾內的資料。', '');
  out.push(heading(3), '', p.kind === 'proofread' ? `這是第 ${prog.round || 1} 次校對。` : '之前為這一站做過：', ...(p.kind === 'proofread' ? [] : [quotedBullets(prog.before)]), '', '創辦人答過：', quotedBullets(prog.answered), '', '仍未知、不要再問：', quotedBullets(prog.unknown), '');
  if (prog.todayDone && prog.todayDone.length) out.push('今日已做的件（不要重做）：', quotedBullets(prog.todayDone), '');
  if (prog.rewriteIssues && prog.rewriteIssues.length) out.push('上次校對發回的問題（逐條改正）：', quotedBullets(prog.rewriteIssues), '');
  out.push(heading(4), '', '自己做：', bullets(perm.self), '', '做完再通知創辦人：', bullets([...(perm.tellAfter || []), ...((role.bounds && role.bounds.tellAfter) || [])]), '', '必須先問創辦人：', bullets([...(perm.askFirst || []), ...((role.bounds && role.bounds.askFirst) || [])]), '');
  out.push(heading(5), '', FIRST_STEP_PREFIX + (quoted(p.firstStep) || '按第一段的完成條件做這件工作。'), '');
  out.push(heading(6), '', `交付類型：${bullets(dl.types, '').replace(/\n?- /g, '、').replace(/^、/, '') || '文件'}。`, `最多 ${dl.max || 2} 份；每份創辦人兩分鐘內讀完；每份末段固定「依據」一欄，逐條列明來自哪份文件或哪個網址。`, dl.proofread ? '本產出會對外，交出後由 Zero 統籌先校對：不承諾價錢、日期、條件；每條事實附依據。' : '本產出屬內部準備，交出後由程式核對格式及依據。', `收據格式：${line(dl.receiptFormat) || 'out/receipt.json（summary、artifacts、founderNext、for、blockedOn）'}。`, `創辦人怎樣驗收：${quoted(dl.acceptance) || '按完成條件核對產出'}`, '');
  out.push(heading(7), '', bullets(p.kind === 'proofread' ? PROOFREAD_STOP : STOP_TEXT), '');
  out.push(`## ${GLOSSARY_HEAD}`, '', bullets((p.glossary || []).map(g => `${line(g.term)}：${line(g.meaning)}`), '（沒有）'), '');
  return out.join('\n');
}

/* ---------- 校對說明（第 2.4 節 (2)）：由同一組裝器做，固定內容 ---------- */
export function buildProofreadBrief({ artifactTitle, roleTitle, station, doneWhen, files = [], round = 1, lastIssues = [], glossary = [] } = {}) {
  return buildBrief({ kind: 'proofread', task: { title: `校對「${line(artifactTitle)}」`, next: `由「${line(roleTitle)}」為站「${line(station)}」交出` }, station: { short: station, event: `校對「${line(artifactTitle)}」`, doneWhen },
    exclude: ['只校對、不改寫', '不評論策略或方向', '不處理其他產出'], files, web: { allowed: false },
    progress: { round, rewriteIssues: round > 1 ? lastIssues : [], answered: [], unknown: [] },
    permissions: { self: ['只可寫校對結果檔 out/proofread.json'], tellAfter: [], askFirst: [] },
    firstStep: '逐條核對「依據」欄：每條引述在來源內是否真的存在、數字是否一致。',
    deliver: { types: ['校對結果'], max: 1, proofread: false, receiptFormat: 'out/proofread.json（verdict、checks 六項、line、issues）', acceptance: '結果一句不多於 40 字、書面語；畫面只顯示判定與結果一句' }, glossary });
}

/* ---------- 機械核對（Z25、Z26）。回 { ok, errors: [{ code, text }] }
   codes：missingSection（缺段）、forbidden（禁用字眼）、glossary（名稱未在名詞表）、file（提到的檔不在資料夾）、firstStep（第一步非固定句式）
   opts：{ files: ['檔名'...]（資料夾內實際的檔）, names: ['人名、機構名、站名'...]（文內會出現、必須在名詞表解釋的名稱） } ---------- */
export function checkBrief(text, { files = null, names = [] } = {}) {
  const t = String(text || ''), errors = [];
  const pos = SECTIONS.map((_, i) => t.indexOf(heading(i)));
  pos.forEach((x, i) => { if (x < 0) errors.push({ code: 'missingSection', text: `缺第${NUM[i]}段「${SECTIONS[i]}」` }); });
  const gpos = t.indexOf(`## ${GLOSSARY_HEAD}`);
  if (gpos < 0) errors.push({ code: 'missingSection', text: '缺名詞表' });
  const ordered = pos.every((x, i) => i === 0 || x < 0 || pos[i - 1] < 0 || x > pos[i - 1]);
  if (!ordered) errors.push({ code: 'missingSection', text: '八段次序不對' });
  // 禁用字眼只掃八段正文（名詞表及第三段檔名除外）
  const raw8 = gpos >= 0 ? t.slice(0, gpos) : t, body = raw8.replace(/`[^`\n]*`/g, '');
  for (const w of forbiddenHits(body)) errors.push({ code: 'forbidden', text: `含「${w}」：說明必須自足，寫清楚內容` });
  const glossary = gpos >= 0 ? t.slice(gpos) : '';
  for (const n of names || []) { const k = String(n || '').trim(); if (k && body.includes(k) && !glossary.includes(k + '：')) errors.push({ code: 'glossary', text: `「${k}」在名詞表沒有解釋` }); }
  if (Array.isArray(files)) { const have = new Set(files.map(String)); for (const m of raw8.matchAll(/`([^`\n]+)`/g)) { const f = m[1]; if (/\.(md|json|txt|pdf|docx|xlsx|pptx|csv|png|jpg)$/i.test(f) && !/^out\//.test(f) && !have.has(f)) errors.push({ code: 'file', text: `提到的檔「${f}」不在隔離資料夾內` }); } }
  const sixth = pos[5] >= 0 ? t.slice(pos[5], pos[6] > 0 ? pos[6] : undefined) : '';
  if (sixth && !sixth.includes(FIRST_STEP_PREFIX)) errors.push({ code: 'firstStep', text: '第六段須以固定句式開始' });
  return { ok: !errors.length, errors };
}
// 多件日：連續兩件說明核對不合格即停當日（Z26）。fails：當日逐件的核對結果（true＝不合格）
export const briefFailStreak = fails => { const f = fails || []; return f.length >= 2 && f[f.length - 1] === true && f[f.length - 2] === true; };
