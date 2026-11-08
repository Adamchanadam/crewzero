// 0.41.0 團隊分工測試專用假 AI（roles-run-test.mjs 用）：按 job.json 的 type 做嘢，行為由 <SOS_DATA>/fake-plan.json 逐次指定（每種 type 一個隊列，用完即走預設）。
// 每次啟動記入 <SOS_DATA>/fake-calls.jsonl（type、沙盒名、taskId、teammateId、task.md 全文），測試用來核對次數、次序及工作說明。
import fs from 'node:fs';
import path from 'node:path';
const DATA = process.env.SOS_DATA || '';
const job = fs.existsSync('job.json') ? JSON.parse(fs.readFileSync('job.json', 'utf8')) : {};
const type = job.type || '';
const planFile = path.join(DATA, 'fake-plan.json');
function take(t) {
  let plan = {}; try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch { }
  const q = plan[t];
  if (!Array.isArray(q) || !q.length) return null;
  const x = q.shift(); fs.writeFileSync(planFile, JSON.stringify(plan)); return x;
}
const taskText = fs.existsSync('task.md') ? fs.readFileSync('task.md', 'utf8') : '';
const calls = path.join(DATA, 'fake-calls.jsonl');
fs.appendFileSync(calls, JSON.stringify({ type, sandbox: path.basename(process.cwd()), taskId: job.taskId || '', teammateId: job.teammateId || '', mode: job.mode || '', round: job.round || 0, task: taskText }) + '\n');
fs.mkdirSync('out', { recursive: true });
const done = () => { console.log(JSON.stringify({ is_error: false, total_cost_usd: 0, duration_ms: 10, permission_denials: [] })); process.exit(0); };
const fail = () => { console.log(JSON.stringify({ is_error: true, result: 'fake failure' })); process.exit(1); };
const w = (f, x) => fs.writeFileSync(path.join('out', f), typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const d = take(type) || {};
if (d.hook) { try { fs.writeFileSync(path.join(DATA, d.hook.file), typeof d.hook.data === 'string' ? d.hook.data : JSON.stringify(d.hook.data)); } catch { } }
if (d.fail) fail();
const ledger = fs.existsSync('ledger.json') ? JSON.parse(fs.readFileSync('ledger.json', 'utf8')) : {};
if (type === 'rhythm') {
  const first = (ledger.canDo || [])[0], title = first ? first.title : '下一個對外動作';
  if (d.blocked) { w('receipt.json', { summary: '測試：今次沒有新產出。', artifacts: [], founderNext: [], blockedOn: d.blockedOn || '等你回覆' }); done(); }
  const arts = d.artifacts || [{ title: '準備：' + title, type: 'checklist', audience: 'internal', text: '# 準備：' + title + '\n\n（測試產出 ' + Date.now() + '）\n\n依據：公司概覽\n' }];
  const list = arts.map((a, i) => { const file = '0' + (i + 1) + '-x.md'; w(file, a.text); return { file, title: a.title, ...(a.type ? { type: a.type } : {}), ...(a.audience ? { audience: a.audience } : {}) }; });
  w('receipt.json', { summary: '測試：做好 ' + list.length + ' 份。', artifacts: list, founderNext: [], for: { milestoneId: first ? first.milestoneId : '', text: '測試' }, blockedOn: '' });
  if (d.ask) w('ask.json', d.ask);
  done();
} else if (type === 'qa-rewrite') {
  const prev = fs.readdirSync('.').filter(f => /^previous-\d+\.md$/.test(f)).sort();
  const arts = d.artifacts || prev.map((f, i) => ({ title: '改正稿 ' + (i + 1), type: d.type || 'message', audience: 'external', text: fs.readFileSync(f, 'utf8') + '\n（已按校對意見改正）\n' }));
  const list = arts.map((a, i) => { const file = '0' + (i + 1) + '-rw.md'; w(file, a.text); return { file, title: a.title, ...(a.type ? { type: a.type } : {}), audience: a.audience || 'external' }; });
  w('receipt.json', { summary: '測試：已改正。', artifacts: list, founderNext: [] });
  done();
} else if (type === 'proofread') {
  if (d.raw !== undefined) { w('proofread.json', d.raw); done(); }
  const verdict = d.verdict || 'pass';
  const checks = ['facts', 'numbersDates', 'names', 'sources', 'deliverable', 'externalWording'].map(item => ({ item, ok: verdict === 'pass', note: '測試核對。' }));
  w('proofread.json', { verdict, checks, line: d.line || (verdict === 'return' ? '有兩處要改正。' : '核對無誤。'), issues: d.issues || (verdict === 'return' ? [{ where: '第二段', what: '價錢沒有來源。', fix: '刪去價錢或註明要確認。' }] : []) });
  done();
} else if (type === 'roles' || type === 'roles-repair') {
  if (d.raw !== undefined) { w('roles.json', d.raw); done(); }
  if (d.roles) { w('roles.json', d.roles); done(); }
  const input = JSON.parse(fs.readFileSync('roles-input.json', 'utf8'));
  const titles = ['社區拓展經理', '原料採購專員', '牌照保險主任', '內容策劃專員', '財務預算專員'];
  const st = input.stations.filter(s => s.pathStatus === 'confirmed' && !input.existingCards.some(c => c.milestoneIds.includes(s.id)));
  const n = Math.min(d.cards || 2, input.maxCards, st.length);
  const cards = st.slice(0, n).map((s, i) => ({ title: titles[(input.existingCards.length + i) % titles.length], mission: '負責' + s.short + '。', milestoneIds: [s.id], supports: [], targets: [], how: ['整理資料'], strategy: '先把' + s.short + '做穩。', sources: [], deliverables: d.deliverables || ['questions'], knowledge: [{ text: '完成條件見公司概覽。', source: 'confirmedPage' }], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '準備' + s.short + '的問題清單', deliverable: '一份問題清單。', milestoneId: s.id } }));
  const unassigned = st.slice(n).map(s => ({ milestoneId: s.id, why: '暫由統籌承擔。' }));
  w('roles.json', { summary: '測試：擬了 ' + cards.length + ' 張。', cards, unassigned });
  done();
} else if (type === 'people-sync' || type === 'people-sync-repair') {
  w('people.json', { summary: '測試', items: [] }); done();
} else if (type === 'rewrite') {
  done();
} else if (type === 'ask-continue') {
  w('01-updated.md', '# 更新\n\n按你的答案更新。\n'); w('receipt.json', { summary: '測試：已更新。', artifacts: [{ file: '01-updated.md', title: '更新稿' }], founderNext: [] }); done();
} else { w('receipt.json', { summary: '測試：沒有這種工作。', artifacts: [], founderNext: [] }); done(); }
