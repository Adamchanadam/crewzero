// 測試用假 AI：喺 cwd（沙盒）工作，按 job.json 嘅 type 做嘢；冇 job.json 就用舊做法（按檔案判斷）。
// 測試可以喺 <SOS_DATA>/fake-mode.txt 寫一次性模式（讀完即刪）：
//   fail 失敗、timeout 超時、certify-escape 認證時寫出界、intake-bad 第一次擬錯格式、
//   intake-jargon 擬嘅內容有內部術語（改寫會改好）、jargon-stuck 內部術語改寫都改唔走
import fs from 'node:fs';
import path from 'node:path';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIX = process.env.SOS_FAKE_PAGE || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'fixtures', 'farm-page.js');
// 一行一個模式；「工作類型:模式」只畀嗰類工作用（例如 intake:intake-bad），冇前綴就畀下一個任何工作用
function mode(type) {
  const f = process.env.SOS_DATA && path.join(process.env.SOS_DATA, 'fake-mode.txt');
  if (!f || !fs.existsSync(f)) return '';
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const i = lines.findIndex(l => !l.includes(':') || l.split(':')[0] === type);
  if (i < 0) return '';
  const m = lines.splice(i, 1)[0];
  if (lines.length) fs.writeFileSync(f, lines.join('\n') + '\n'); else fs.rmSync(f, { force: true });
  return m.includes(':') ? m.split(':')[1] : m;
}
const outputMode = process.argv.includes('--fake-output') ? process.argv[process.argv.indexOf('--fake-output') + 1] : '';
function done(extra) {
  const value = { is_error: false, total_cost_usd: 0, duration_ms: 1200, permission_denials: [], ...extra };
  if (outputMode === 'jsonl') {
    console.log(JSON.stringify({ type: 'turn.started' }));
    for (const d of value.commandExecutions || []) console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'failed', exit_code: 1, aggregated_output: 'Access denied', ...d } }));
    console.log(JSON.stringify({ type: 'turn.completed', ...value }));
  } else if (outputMode === 'agy') {
    // agy-generic-error：只有一般參數錯誤（唔係權限拒絕），唔可以當成被擋
    for (const d of value.permission_denials || []) console.log(JSON.stringify({ event: 'step_update', step_update: M === 'agy-generic-error' ? { state: 'ERROR', step_type: 'tool', tool_name: d.tool_name, error: { code: 'INVALID_ARGUMENT', message: 'invalid argument' }, tool_info: { parameters: d.tool_input } } : { state: 'DENIED', step_type: 'tool', tool_name: d.tool_name, tool_info: { parameters: d.tool_input } } }));
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', ...value } }));
  }
  else console.log(JSON.stringify(value));
}
function ready(p) {
  const T = { by: 'ai', until: '2026-11-20', test: '測試：問對方' };
  p.glance.rows.splice(1, 0, { id: 'g2', plan: 'G2', label: '下一個檢查期', kind: 'text', value: '四星期內：兩個農場書面答覆是否供貨', origin: 'ai', tentative: T },
    { id: 'g3', plan: 'G3', label: '怎樣才算有進展', kind: 'text', value: '有農場簽供應協議', origin: 'ai', tentative: T });
  p.glance.rows.push({ id: 'g6', plan: 'G6', label: '已有人負責的事', kind: 'text', value: '送貨：表哥（已確定）', origin: 'ai', tentative: T },
    { id: 'g9', plan: 'G9', label: '產品或服務的要求與特色', kind: 'text', value: '每箱註明農場來源', origin: 'ai', tentative: T });
  p.detail = p.detail || {};
  p.detail.rules = [{ id: 'ru7', plan: 'G7', label: 'AI 可自行處理的事', kind: 'text', value: '用預設', origin: 'default', boxes: { auto: ['撰寫草稿'], tellAfter: ['整理紀錄'], askFirst: ['對外聯絡', '花錢'] } },
    { id: 'ru8', plan: 'G8', label: '經營節奏', kind: 'text', value: '用預設', origin: 'default' }, { id: 'ru10', plan: 'G10', label: '業務線數目', kind: 'text', value: '一條業務線', origin: 'default' }];
  for (const m of p.path.milestones) for (const [k, plan, v] of [['actor', 'milestone.actor', '對方負責人'], ['witness', 'milestone.witness', '對方負責人'], ['proof', 'milestone.evidence', '書面紀錄']]) if (!m[k]) m[k] = { id: m.id + '-' + k, plan, label: k, kind: 'text', value: v, origin: 'ai' };
  p.path.milestones.forEach((m, i) => { m.kind = i === 2 ? 'task' : 'real'; });
  return p;
}
function farmPage() { return JSON.parse(fs.readFileSync(FIX, 'utf8').trim().replace(/^window\.STARTUP_OS_PAGE\s*=\s*/, '').replace(/;\s*$/, '')); }

const sandboxAt = process.argv.indexOf('--sandbox-probe');
if (sandboxAt >= 0) {
  const target = process.argv[sandboxAt + 1] || '', content = process.argv[sandboxAt + 2] || '';
  let probeMode = ''; try { probeMode = fs.readFileSync(path.resolve(process.cwd(), '..', '..', 'fake-mode.txt'), 'utf8').trim(); } catch { }
  const inWorkspace = path.resolve(target).startsWith(path.resolve(process.cwd()) + path.sep);
  // 模擬真 Codex 沙盒：擋住時印權限拒絕字句；壞咗就印一般錯誤；no-attempt＝冇試寫、結束碼 0（唔可以當被擋）
  if (probeMode === 'sandbox-broken') { console.error('The filename, directory name, or volume label syntax is incorrect.'); process.exitCode = 1; }
  else if (!inWorkspace && probeMode === 'sandbox-no-attempt') process.exitCode = 0;
  else if (!inWorkspace && probeMode !== 'sandbox-allows-escape') { console.error(`Set-Content : Access to the path '${target}' is denied.`); process.exitCode = 1; }
  else fs.writeFileSync(target, content + '\n');
  process.exit();
}
const job = fs.existsSync('job.json') ? JSON.parse(fs.readFileSync('job.json', 'utf8')) : null;
const M = mode(job ? job.type : '');
if (M === 'fail') { console.log(JSON.stringify({ is_error: true, result: 'fake failure' })); process.exit(1); }
if (M === 'timeout') { await sleep(10 * 60 * 1000); }
await sleep(1200);
fs.mkdirSync('out', { recursive: true });
fs.readFileSync('task.md', 'utf8');
// 記低啟動參數（測試核對研究工作有冇加網上讀取）
fs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));

const type = job && job.type;
// 留低今次收到嘅工作說明（外殼之後叫改寫會覆寫 task.md；測試要核對 AI 原本收到乜）
if (type !== 'rewrite') fs.copyFileSync('task.md', 'task-seen.md');
// 模擬 Codex 已知問題：Windows 一般權限安全模式拒絕分開的可寫位置，一條指令都執行不到
if (type === 'certify' && M === 'codex-split-root') { console.error('ERROR codex_core::tools::router: error=exec_command failed: windows unelevated restricted-token sandbox cannot enforce split writable root sets directly; refusing to run unsandboxed'); process.exit(0); }
if (type === 'certify') {
  fs.writeFileSync('probe-ok.txt', 'ok');
  if (M === 'certify-escape' && job.outside) { fs.mkdirSync(path.dirname(job.outside), { recursive: true }); fs.writeFileSync(job.outside, 'escaped'); }
  if (M === 'certify-settings-escape' && job.settingsPath) { fs.mkdirSync(path.dirname(job.settingsPath), { recursive: true }); fs.writeFileSync(job.settingsPath, 'escaped'); }
  fs.writeFileSync('probe-report.json', JSON.stringify({ t1: '成功', t2: M === 'certify-escape' ? '成功' : '被拒', t3: M === 'certify-settings-escape' ? '成功' : '被拒', t4: M === 'certify-report-adjacent-success' ? '搜尋被拒' : '冇呢個工具', t5: M === 'certify-report-adjacent-success' ? '其他步驟成功' : '被拒', t6: '被拒' }));
  // 上網宿主（job 有 publicUrl）：讀公開網頁寫標題；本機同私人網段被拒（模式 web-local-hit／web-lan-hit 真係連、web-nopublic 讀唔到公開網頁）
  const webDen = [];
  if (job.publicUrl) {
    if (M !== 'web-nopublic') fs.writeFileSync(path.join('out', 'public.txt'), 'Example Domain');
    if (M === 'web-local-hit') { try { await fetch(job.probeUrl); } catch { } } else webDen.push({ tool_name: 'WebFetch', tool_input: { url: job.probeUrl, method: 'GET' } });
    if (job.lanUrl) { if (M === 'web-lan-hit') { try { await fetch(job.lanUrl, { signal: AbortSignal.timeout(3000) }); } catch { } } else webDen.push({ tool_name: 'WebFetch', tool_input: { url: job.lanUrl, method: 'GET' } }); }
  }
  const isWebHost = process.argv.includes('--tools');
  const passDen = [];
  if (job.readUrl && job.writeUrl && !['certify-no-pass-attempt', 'certify-self-report', 'agy-no-self-test'].includes(M)) {
    if (isWebHost) {
      passDen.push({ tool_name: 'WebFetch', tool_input: { url: job.readUrl, method: 'GET' } }, { tool_name: 'WebFetch', tool_input: { url: job.writeUrl, method: M === 'certify-wrong-method' ? 'GET' : 'POST' } });
    } else {
      try { await fetch(job.readUrl); } catch { }
      try { await fetch(job.writeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'proofread', ref: 'fake', text: 'kind: proofread' }) }); } catch { }
    }
  }
  // 扮 Claude：試寫出界同改權限設定都被拒，留低拒絕紀錄；其餘兩種模式用同一假結果驗證 JSONL／status 解析。
  const settingsDenial = ['certify-settings-escape', 'agy-no-self-test'].includes(M) ? [] : [{ tool_name: 'Write', tool_input: { file_path: job.settingsPath || path.join(process.cwd(), '.claude', 'settings.local.json') } }];
  const writeDenial = ['certify-escape', 'agy-no-self-test'].includes(M) ? [] : [{ tool_name: 'Write', tool_input: { file_path: job.outside } }];
  const denialList = [...writeDenial, ...settingsDenial, ...webDen, ...passDen];
  done({ attempts: { settings: M === 'certify-settings-escape' ? 'changed' : 'denied', ...(M === 'certify-no-pass-attempt' ? {} : { read: 'refused', write: 'refused' }) }, permission_denials: denialList,
    ...(outputMode === 'jsonl' ? { permission_denials: [], commandExecutions: denialList.filter(d => d.tool_input?.file_path).map(d => ({ command: `cmd /c echo escaped> \"${d.tool_input.file_path}\"` })) } : {}) });
} else if (type === 'intake' || type === 'intake-repair') {
  const page = M === 'intake-noready' || fs.existsSync('noready') ? farmPage() : ready(farmPage());
  if (M === 'intake-noready') fs.writeFileSync('noready', '1');
  if (type === 'intake' && M === 'intake-bad') delete page.path;
  if (M === 'intake-jargon' || M === 'jargon-stuck') page.glance.rows[0].value = '季末 G1：三間餐廳連續四週每週下單（run 計）';
  fs.writeFileSync('out/company-page.json', JSON.stringify(page, null, 2));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '已按你提交的資料擬好公司概覽，請你校對。', artifacts: [], founderNext: [], needsFounder: [] }));
  if (M === 'jargon-stuck') fs.writeFileSync('jargon-stuck', '1');
  done();
} else if (type === 'rewrite') {
  const stuck = fs.existsSync('jargon-stuck');
  if (!stuck) {
    for (const f of fs.readdirSync('out')) {
      const p = path.join('out', f);
      let t = fs.readFileSync(p, 'utf8');
      t = t.replace(/\bG(10|[1-9])\b[：:]?\s*/g, '').replace(/[（(]\s*run 計\s*[）)]/g, '').replace(/\brun\b/g, '工作');
      fs.writeFileSync(p, t);
    }
  }
  done();
} else if (type === 'practice-prep') {
  const sc = JSON.parse(fs.readFileSync('example-scenario.json', 'utf8'));
  const req = fs.readFileSync('request.md', 'utf8');
  const who = (/對方：(.+)/.exec(req) || [])[1] || '測試對象';
  sc.title = '測試練習：' + who.slice(0, 20); sc.counterpart = { name: who.slice(0, 30), role: '測試身分' };
  sc.docsSeen = fs.existsSync('docs') ? fs.readdirSync('docs') : [];
  if (M !== 'prep-bad') fs.writeFileSync('out/scenario.json', JSON.stringify(sc));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：準備好場景。', artifacts: [], founderNext: [] }));
  done();
} else if (type === 'debrief') {
  fs.writeFileSync('out/ask.json', JSON.stringify({ format: 'startup-os.ask/0.1', title: '會後跟進：測試', questions: [
    { id: 'lv', priority: 1, ask: '對方目前的證據程度是甚麼？（' + fs.readFileSync('debrief.md', 'utf8').split(/\r?\n/).filter(Boolean).pop().slice(0, 16) + '）', options: [{ text: '升到實際行動', rec: true }, { text: '維持口頭表示' }], value: '升到實際行動', why: '測試理由' },
    { id: 'next', priority: 2, ask: '下一步何時跟進？', kind: 'date', value: '2026-11-12', why: '測試理由' }] }));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：擬好會後問題。', artifacts: [], founderNext: [] }));
  done();
} else if (type === 'event' || type === 'event-repair') {
  // 真實事件：揀第一條仲係「假設」嘅假設升一級到實際行動、第一個未完成嘅站標完成。模式：event-bad 第一次交錯格式（修正一次後改好）、event-none 冇影響、event-pick-<站 id> 指定標完成嘅站
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8'));
  const said = fs.readFileSync('event.md', 'utf8').split('## 創辦人原話').pop().trim().slice(0, 40);
  const a = L.assumptions.find(x => x.grade === 'guess');
  const pick = /^event-pick-/.test(M) ? M.slice(11) : '';
  const m = pick ? L.milestones.find(x => x.id === pick) : L.milestones.find(x => !x.done && /伙伴|介紹/.test(x.name)) || L.milestones.find(x => !x.done);
  const items = [];
  if (a) items.push({ kind: 'assumption', id: a.id, grade: 'did', why: '對方答應介紹餐廳並約定再談，屬對方採取的實際行動。' });
  if (m) items.push({ kind: 'milestone', id: m.id, done: true, why: '會面已舉行並有會後紀錄，符合這一站的完成標準。' });
  if (M === 'event-next') items.push({ kind: 'nextAction', text: '測試：與對方約定下次會面', milestoneId: (L.milestones.find(x => !x.done && x.id !== (m && m.id)) || {}).id, why: '測試理由：會面已舉行，下一步是約下次會面。' });
  const ev = { summary: '測試 AI：' + said, grade: 'did', items: M === 'event-none' ? [] : items };
  if (type === 'event' && M === 'event-bad') ev.items = [{ kind: 'assumption', id: 'H99', grade: 'great' }];
  fs.writeFileSync('out/event.json', JSON.stringify(ev, null, 2));
  done();
} else if (type === 'rhythm') {
  // 日常工作：按紀錄做一份準備；內容只跟紀錄，紀錄冇變就同上次一樣（外殼會判定冇新產出）。
  // 模式：rhythm-blocked 冇得做、rhythm-second 建議開第二站、rhythm-ask 出一條問題
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8'));
  const act = L.milestones.find(m => m.state === 'active'), nea = L.nextExternalAction, first = L.canDo.find(t => t.firstBatch) || L.canDo[0];
  const rc = { summary: '', artifacts: [], founderNext: [], for: { milestoneId: act ? act.id : '', text: act ? '為「' + act.short + '」做準備' : '' }, blockedOn: '等你回覆或現實世界的進展' };
  if (M !== 'rhythm-blocked' && (first || nea)) {
    fs.writeFileSync('out/01-daily.md', '# 準備：' + (first ? first.title : nea.text) + '\n\n' + (act ? '進行中的一站：' + act.short + '\n' : '') + (nea ? '下一個對外動作：' + nea.text + '\n' : '') + '\n（測試 AI 產出）\n');
    rc.artifacts.push({ file: '01-daily.md', title: '日常準備：' + String(first ? first.title : '下一個對外動作').slice(0, 20) });
    rc.summary = '測試 AI：按紀錄做好一份準備。';
  } else rc.summary = '測試 AI：今次沒有可推進的工作。';
  if (M === 'rhythm-second' && L.secondStationAllowed) fs.writeFileSync('out/decisions.json', JSON.stringify([{ type: 'openSecond', milestoneId: L.secondStationAllowed.id, why: '測試理由：兩站互不依賴，可同時推進。' }]));
  // 每個對象嘅下一步（規劃書 4.6 客戶推進）：模式 rhythm-noprospect 唔交
  if (M !== 'rhythm-noprospect' && Array.isArray(L.prospects) && L.prospects.length) fs.writeFileSync('out/prospects.json', JSON.stringify(L.prospects.map(p => ({ prospectId: p.id, next: '（測試）準備與' + p.name + '見面的問題清單', why: '（測試）推前一格' })).concat([{ prospectId: 'pr-nobody', next: '（測試）不存在的對象' }])));
  if (M === 'rhythm-ask') fs.writeFileSync('out/ask.json', JSON.stringify({ format: 'startup-os.ask/0.1', title: '測試：日常工作要你決定的事', questions: [{ id: 'd1', priority: 1, ask: '測試：下星期先跟進哪一方？', options: [{ text: '先跟進第一方', rec: true }, { text: '先跟進第二方' }], value: '先跟進第一方', why: '測試理由' }] }));
  fs.writeFileSync('out/receipt.json', JSON.stringify(rc));
  done();
} else if (type === 'prefill') {
  // 由文件預填：q1 文件原句；q2 按文件推斷（唔係原句）；q3 扮原句但文件冇（外殼要降為推斷）；q4 文件冇講（留空）；q5 第二份文件原句（冇就第一份第二句）
  // 模式：prefill-bad 交錯格式；prefill-empty 全部留空
  const docs = fs.readdirSync('files').filter(f => /\.(md|txt)$/i.test(f)).map(f => ({ f, lines: fs.readFileSync(path.join('files', f), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('-')) }));
  const any = fs.readdirSync('files')[0] || '';
  const d1 = docs[0], d2 = docs[1];
  const e = { text: '', quote: false, source: '', at: '' };
  const ans = M === 'prefill-empty' ? { q1: e, q2: e, q3: e, q4: e, q5: e } : {
    q1: d1 && d1.lines[0] ? { text: d1.lines[0], quote: true, source: d1.f, at: '第一段' } : { text: '（測試）文件讀不到文字', quote: true, source: any, at: '' },
    q2: { text: '（測試推斷）按文件所述，由客戶定期付款。', quote: false, source: d1 ? d1.f : any, at: '' },
    q3: { text: '（測試）文件沒有的一句：已有十間機構付款。', quote: true, source: d1 ? d1.f : any, at: '進展' },
    q4: e,
    q5: d2 && d2.lines[0] ? { text: d2.lines[0], quote: true, source: d2.f, at: '第一段' } : d1 && d1.lines[1] ? { text: d1.lines[1], quote: true, source: d1.f, at: '第二段' } : e
  };
  fs.writeFileSync('out/prefill.json', M === 'prefill-bad' ? '{"answers": 3' : JSON.stringify({ answers: ans }, null, 2));
  done();
} else if (type === 'checkup') {
  // 生意體檢：揀頭兩條仲係假設級嘅假設做弱位；摘要寫明考慮咗幾多條意見。模式：checkup-bad 交錯格式；checkup-new 最便宜測試換新字（測試更新規則）
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8')), fbN = job.feedback || 0;
  const weak = L.assumptions.filter(a => a.grade === 'guess').slice(0, 2).map(a => ({ title: '（測試）未有證據：' + a.text, assumptionId: a.id, why: '測試理由：公司紀錄未有對方做過任何事的證據。', cheapestTest: M === 'checkup-new' ? '（測試新）本週請對方試用一次' : '（測試）本週約對方見面，請對方書面答覆', stop: '（測試）兩星期內沒有答覆就改做法' }));
  const ck = { summary: '（測試）按紀錄找出 ' + weak.length + ' 個最弱環節' + (fbN ? '；已考慮你的 ' + fbN + ' 條意見' : ''), weak, unseen: [{ text: '（測試）送貨時間未有人負責' }], notNow: [{ text: '（測試）暫時不做網上零售', why: '測試理由：本季未有客戶' }] };
  fs.writeFileSync('out/checkup.json', M === 'checkup-bad' ? '{"weak": 1' : JSON.stringify(ck, null, 2));
  done();
} else if (type === 'opportunities') {
  // 商機掃描：兩項測試機會（附出處）；模式 opp-bad 交錯格式；opp-code 理由夾帶假設編號（外殼要換成假設內容先放上 Founder Desk）
  const fbN = job.feedback || 0;
  const op = { summary: '（測試）找到 2 個時間窗' + (fbN ? '；已考慮你的 ' + fbN + ' 條意見' : ''), list: [
    { kind: '時間窗', as: 'task', title: '（測試）換季菜單前一個月', why: M === 'opp-code' ? '測試理由：同 H1 有關。' : '測試理由：主廚會試用新食材。', firstTest: '（測試）本週發三個試食邀請', window: '下個月前', source: '（測試）外部事實：測試資料，查閱日期 ' + job.today },
    { kind: '資助', as: 'path', title: '（測試）本地農業資助計劃', why: '測試理由：可抵銷冷藏成本。', firstTest: '（測試）下載申請指引', window: '未定', source: '（測試）外部事實：測試資料', url: 'https://example.com/test' }] };
  fs.writeFileSync('out/opportunities.json', M === 'opp-bad' ? '{"list": 1' : JSON.stringify(op, null, 2));
  done();
} else if (type === 'revise') {
  const card = fs.readFileSync('card.md', 'utf8'), say = fs.readFileSync('note.md', 'utf8');
  fs.writeFileSync('out/revised.md', '# 修改版\n\n' + card.split(/\r?\n/).slice(1).join('\n') + '\n\n按你意見：' + say.split(/\r?\n/).filter(Boolean).pop() + '\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：按意見改好。', artifacts: [{ file: 'revised.md', title: '修改版：測試卡' }], founderNext: [] }));
  done();
} else if (type === 'note') {
  // 創辦人要求：擬問題包（note-noask：唔交問題；note-badorder：次序選項唔齊）
  const route = JSON.parse(fs.readFileSync('route.json', 'utf8'));
  const said = fs.readFileSync('note.md', 'utf8').split(/\r?\n/).filter(Boolean).pop().slice(0, 20);
  let ask = null;
  if (job.noteType === 'order') {
    const order = route.map(r => r.id); order.splice(1, 0, 'new');
    if (M === 'note-badorder') order.pop();
    ask = { format: 'startup-os.ask/0.1', title: '新增一站：廚師試食會', context: '測試 AI 按你的要求擬好新次序。', questions: [
      { id: 'route', priority: 1, ask: '照你意思改路線嗎？（' + said + '）', kind: 'choice', effect: 'now', options: [
        { text: '採用新次序', rec: true, apply: { order, add: { short: '廚師試食會', event: '五位主廚出席試食會', evidence: '出席名單', targetDate: '2026-11-20' } } },
        { text: '維持現有次序', apply: { keep: true } }], value: '採用新次序', why: '測試理由' }] };
  } else {
    ask = { format: 'startup-os.ask/0.1', title: '臨時工作：測試單張', taskTitle: '測試推廣單張', afterConfirm: '確認後 AI 會擬好單張文字。', next: { task: '按答案擬好推廣單張文字' }, questions: [
      { id: 'deliver', priority: 1, ask: '「' + said + '」要交甚麼？', options: [{ text: '一頁文字稿', rec: true }, { text: '只要中文' }], value: '一頁文字稿', why: '測試理由' },
      { id: 'due', priority: 2, ask: '何時需要？', kind: 'date', value: '2026-11-06', why: '測試理由' }] };
  }
  if (M !== 'note-noask') fs.writeFileSync('out/ask.json', JSON.stringify(ask));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：擬好問題。', artifacts: [], founderNext: [] }));
  done();
} else if (type === 'certify-research') {
  // 研究工作認證：讀公開網頁（寫標題）；本機位址被拒（留拒絕紀錄）。模式：web-local-hit 真係連本機、web-nopublic 讀唔到公開網頁
  if (M !== 'web-nopublic') fs.writeFileSync('out/public.txt', 'Example Domain');
  if (M === 'web-local-hit') { try { await fetch(job.probeUrl); } catch { } fs.writeFileSync('out/local.txt', 'ok'); }
  fs.writeFileSync('out/probe-report.json', JSON.stringify({ public: M === 'web-nopublic' ? '失敗' : '成功', local: M === 'web-local-hit' ? '成功' : '被拒' }));
  done(M === 'web-local-hit' ? {} : { permission_denials: [{ tool_name: 'WebFetch', tool_input: { url: job.probeUrl } }] });
} else if (type && type.startsWith('debate-')) {
  // 紅藍對打各回合：由格式例子（虛構）出；身份換成今場席位。模式：debate-bad 交唔到格式、strengthen-allbad 全部卡唔合格、reattack-fall 再攻全部倒下
  const pass = type.slice(7), ex = n => JSON.parse(fs.readFileSync(path.join('example', n), 'utf8'));
  const seats = job.seats && job.seats.length ? job.seats : ['測試身份'];
  const w = (n, o) => fs.writeFileSync(path.join('out', n), JSON.stringify(o, null, 2));
  if (M === 'debate-bad') { w(pass + '.json', { nothing: true }); done(); process.exit(0); }
  if (pass === 'blue') w('blue.json', { ...ex('blue.json'), thesis: '測試主張：' + (fs.readFileSync('topic.md', 'utf8').match(/題目：(.+)/) || [])[1] });
  else if (pass === 'red') { const r = ex('red.json'); r.attacks.forEach((a, i) => { a.persona = seats[i % seats.length]; }); r.seats = seats.map(s => ({ persona: s, cares: '測試：' + s + '最在意成本' })); w('red.json', r); }
  else if (pass === 'rebuttal') w('rebuttal.json', ex('rebuttal.json'));
  else if (pass === 'judge') w('judge.json', ex('judge.json'));
  else if (pass === 'rejudge') {
    const ids = (fs.readFileSync('challenge.md', 'utf8').match(/^- (B\d+)/gm) || ['- B2']).map(s => s.slice(2)).slice(0, 3);
    w('rejudge.json', { verdicts: ids.map(id => ({ claimId: id, verdict: '受傷', reason: '測試：聽完創辦人原話，改判受傷' })) });
  } else if (pass === 'strengthen') {
    const s = ex('strengthen.json');
    if (M === 'strengthen-allbad') s.cards.forEach(c => { c.handling = '亂寫'; });
    // strengthen-aitest：T1 寫成 AI 自己做但冇查、仲叫你做；T3 外部事實冇網址
    if (M === 'strengthen-aitest') { s.cards[0].test.testBy = 'ai'; delete s.cards[0].test.aiChecked; s.cards[2].test.aiChecked = [{ finding: '測試發現', label: 'fact', sources: [{ title: '冇網址', url: '', readOn: '' }], minutes: 3 }]; }
    w('strengthen.json', s); fs.writeFileSync('out/04-轉強.md', '# 轉強（測試）\n\n四張卡。\n');
  } else if (pass === 'reattack-red') {
    const s = JSON.parse(fs.readFileSync('strengthen.json', 'utf8'));
    w('reattack-red.json', { attacks: s.cards.map((c, i) => ({ cardId: c.id, persona: seats[i % seats.length], attack: '測試再攻（第 ' + job.round + ' 輪）：' + c.id + ' 是否做得到？', severity: '中' })) });
  } else if (pass === 'reattack-judge') {
    const r = JSON.parse(fs.readFileSync('reattack-red.json', 'utf8'));
    w('reattack-judge.json', { verdicts: r.attacks.map((a, i) => ({ cardId: a.cardId, verdict: M === 'reattack-fall' ? '倒下' : ['受傷', '倒下', '企得住', '企得住'][i % 4], reason: '測試判卡' })) });
  }
  done({ total_cost_usd: 0.01 });
} else if (type === 'ask-continue' || (!type && fs.existsSync('pack.json'))) {
  const ans = fs.readFileSync('answers.md', 'utf8');
  // 只抽題目同答案（answers.md 係畀 AI 睇嘅說明，唔直接抄入產出）
  const qa = []; let q = '';
  for (const l of ans.split(/\r?\n/)) { if (l.startsWith('## ')) q = l.slice(3).trim(); else if (l.startsWith('- 答案：') && q) qa.push('- ' + q + '：' + l.slice(5).trim()); }
  fs.writeFileSync('out/01-updated.md', '草稿，未發送\n\n按你的答案更新：\n\n' + qa.join('\n') + '\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：已按你的答案更新草稿。', artifacts: [{ file: '01-updated.md', title: '按答案更新的草稿' }], founderNext: ['查看已更新的草稿'], needsFounder: [] }));
  done();
} else {
  const page = fs.existsSync('confirmed-page.md') ? fs.readFileSync('confirmed-page.md', 'utf8') : '';
  fs.writeFileSync('out/01-message-draft.md', '草稿，未發送\n\n測試訊息。\n');
  fs.writeFileSync('out/02-meeting-brief.md', '測試簡介\n\n' + page.split('\n').slice(0, 4).join('\n') + '\n');
  fs.writeFileSync('out/03-questions.md', '1. 測試問題\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：已寫好三份草稿，有 4 條問題要你決定。', artifacts: [{ file: '01-message-draft.md', title: '約見訊息草稿' }, { file: '02-meeting-brief.md', title: '見面一頁簡介' }, { file: '03-questions.md', title: '見面問題清單' }], founderNext: ['回答 AI 的問題'], needsFounder: [] }));
  fs.writeFileSync('out/ask.json', JSON.stringify({
    format: 'startup-os.ask/0.1', title: '測試：見面之前要你決定的事', context: '測試 AI 出題。', afterConfirm: '測試 AI 會照答案更新草稿',
    next: { task: '照創辦人答案更新約見訊息草稿' },
    questions: [
      { id: 'meet-date', priority: 2, ask: '測試：何時見面？', kind: 'date', value: '2026-11-05', why: '測試理由' },
      { id: 'who', priority: 1, ask: '測試：誰一同前往？', options: [{ text: '我自己', rec: true }, { text: '我與顧問' }], value: '我自己', why: '測試理由' },
      { id: 'offer', priority: 3, ask: '測試：可否答應試用一個月？', effect: 'now', options: [{ text: '可以', rec: true }, { text: '不可以' }], value: '可以', why: '測試理由' },
      { id: 'topics', priority: 4, ask: '測試：見面討論哪幾項？', kind: 'multi', options: [{ text: '價錢' }, { text: '分工' }, { text: '時間表' }], value: ['分工', '時間表'], why: '測試理由' }
    ]
  }));
  done();
}
