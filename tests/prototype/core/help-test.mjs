// 求助鏈：未有公司概覽或 AI 都可收件；AI 設定後接續；重問最多兩次；兩個頁面入口都只交求助。
// 用法：node help-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { certify, usePass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';

const argv = process.argv.slice(2);
const [CHROME, OUT, PROTO, a, b] = argv;
const ADAPTER = b ? a : process.env.SOS_TEST_FAKE || '';
const PORT = Number(b || a);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(OUT, 'data');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const fence = String.fromCharCode(96).repeat(3);
const helpStill = N.ui.helpStill;

fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
fs.mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], {
  cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
let cdp = null;

const get = async p => {
  const r = await fetch(BASE + p);
  let j = null; try { j = await r.json(); } catch {}
  return { code: r.status, j };
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { code: r.status, j };
};
async function waitFor(fn, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(350);
  }
  return null;
}
function allPacks() {
  const dir = path.join(DATA, 'asks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
function pack(id) {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'asks', id + '.json'), 'utf8'));
}
async function answer(p, value) {
  const q = p.questions[0];
  const machine = {
    format: 'startup-os.ask-reply/0.1',
    pack: p.id,
    confirmedAt: lib.localIso(),
    batch: [q.id],
    answers: [{ id: q.id, value, ai: q.value, changed: value !== q.value }]
  };
  const head = ['kind: ask-answer', 'ref: ' + p.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'ask-answer', ref: p.id, text: head.join('\n') + '\n\n# 答案\n\n' + fence + 'json\n' + JSON.stringify(machine) + '\n' + fence + '\n' });
}
function tree(root) {
  const rows = [];
  const visit = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), sub = rel ? rel + '/' + name : name, stat = fs.statSync(file);
      if (stat.isDirectory()) { rows.push(sub + '/'); visit(file, sub); }
      else rows.push(sub + ':' + stat.size + ':' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    }
  };
  visit(root, '');
  return rows;
}
function archivedHelp(id) {
  const root = path.join(DATA, 'founder', 'archive');
  let found = '';
  const visit = dir => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.statSync(file);
      if (stat.isDirectory()) visit(file);
      else if (name.startsWith(id + '-note-help.')) found = fs.readFileSync(file, 'utf8');
    }
  };
  visit(root);
  return found;
}
const state = () => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')); } catch { return {}; }
};

try {
  await usePass(BASE);
  const started = await waitFor(async () => (await get('/api/status')).j);
  ok('伺服器已啟動，AI 尚未設定', started && started.ai && started.ai.ready === false, started && started.ai);

  cdp = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 5);
  await usePass(BASE, cdp);
  await cdp.go(BASE + '/', 1280, 2200);
  const headerHelp = await cdp.ev('(()=>{const b=document.getElementById("open-help");return b?{first:document.querySelector(".tool-right button")===b,text:b.textContent}:null})()');
  ok('Founder Desk 頁頭最前有「需要幫助」按鈕', headerHelp && headerHelp.first && headerHelp.text === N.ui.helpOpen, headerHelp);
  await cdp.click('#open-help');
  const dialog = await cdp.ev('(()=>{const d=document.getElementById("help-modal");return d?{text:d.innerText,focus:document.activeElement&&document.activeElement.id}:null})()');
  ok('頁頭有「需要幫助」：對話框自動聚焦輸入欄，說明不含技術術語', dialog && dialog.focus === 'help-text' && !/PNG|MB|埠|伺服器|JSON|run|sandbox/i.test(dialog.text), dialog);
  await cdp.type('#help-text', '我不知道這一步應該怎樣開始。');
  await cdp.click('#help-send');
  const noAi = await waitFor(async () => {
    const value = await cdp.ev('(()=>{const e=document.getElementById("help-note");return e?{text:e.innerText,href:(e.querySelector("a")||{}).getAttribute("href")}:null})()');
    return value && value.text.includes('已收到') ? value : null;
  }, 5000);
  ok('AI 未設定：照樣收到求助，說明會自動處理並有前往設定連結', noAi && noAi.text.includes('已收到') && noAi.text.includes('設定') && noAi.href === '/#/setup', noAi);
  await cdp.ev('document.getElementById("help-modal")?.remove()');
  await cdp.go(BASE + '/dashboard/system', 1280, 1600);
  const dashboardHelp = await cdp.ev('(()=>{const b=document.getElementById("open-help");return b?b.textContent:""})()');
  ok('營運監察台共用同一個「需要幫助」入口', dashboardHelp === N.ui.helpOpen, dashboardHelp);
  await cdp.click('#open-help');
  const dashboardNext = await waitFor(async () => await cdp.ev('(()=>{const a=document.querySelector("#help-next a");return a&&a.getAttribute("href")})()'), 5000);
  await cdp.click('#help-next a');
  const dashboardDestination = await cdp.ev('location.pathname + location.hash');
  ok('從營運監察台的求助框按下一步，會打開 Founder Desk 對應頁', dashboardNext === '/#/setup' && dashboardDestination === '/#/setup', { href: dashboardNext, destination: dashboardDestination });

  await cdp.go(BASE + '/', 1280, 1300);
  await cdp.click('#open-help');
  await cdp.ev('window.__helpFetch=window.fetch;window.fetch=function(u,o){return String(u).includes("/api/intake")?Promise.resolve(new Response(JSON.stringify({error:"invalid",message:"請用一句話寫下你卡住的地方。"}),{status:400,headers:{"Content-Type":"application/json"}})):window.__helpFetch.call(this,u,o)}');
  await cdp.type('#help-text', '模擬錯誤。');
  await cdp.click('#help-send');
  const uiError = await waitFor(async () => {
    const value = await cdp.ev('(document.getElementById("help-note")||{}).innerText||""');
    return /請用一句話/.test(value || '') ? value : null;
  }, 5000);
  ok('求助送出失敗：只顯示中文原因，不洩漏技術原文', /請用一句話/.test(uiError || '') && !/invalid|400|Error|Failed/i.test(uiError || ''), uiError);
  await cdp.ev('window.fetch=window.__helpFetch;document.getElementById("help-modal")?.remove()');

  const blank = await post('/api/intake', { kind: 'note', type: 'help', text: '  ' });
  const long = await post('/api/intake', { kind: 'note', type: 'help', text: '字'.repeat(2001) });
  ok('求助入口：空白及超過 2000 字均以中文拒收', blank.code === 400 && long.code === 400 && /一句話/.test(blank.j && blank.j.message || '') && /2000/.test(long.j && long.j.message || ''), { blank, long });

  const sent = await post('/api/intake', {
    kind: 'note', type: 'help', text: '公司概覽尚未建立時，我仍然不知道下一步。',
    context: { page: 'pending', packId: 'p-1', packTitle: '測試題目', ask: '這題怎樣回答？', ignored: '不可寫入' }
  });
  ok('未有公司概覽：求助仍被收件，沒有被一般要求入口擋住', sent.code === 202 && sent.j && sent.j.id, sent);
  const inboxFile = sent.j && path.join(DATA, 'founder', 'inbox', sent.j.id + '-note-help.md');
  ok('正常求助先寫入收件匣，檔名及類型正確', inboxFile && fs.existsSync(inboxFile) && fs.readFileSync(inboxFile, 'utf8').includes('type: help'), inboxFile);
  const received = inboxFile && fs.readFileSync(inboxFile, 'utf8');
  ok('收件資料只保留允許的脈絡欄位', received && /type: help/.test(received) && /"page":"pending"/.test(received) && /"packId":"p-1"/.test(received) && !received.includes('ignored'), received && received.slice(-500));

  const waiting = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && s.runs && s.runs.find(r => r.kind === 'note' && r.noteType === 'help' && r.state === 'waiting');
  });
  ok('AI 未設定：求助停在等待狀態而不是失敗，日後可接續', waiting && waiting.state === 'waiting', waiting && { state: waiting.state, error: waiting.error });

  const cert = await certify(BASE);
  ok('設定測試 AI 後認證完成', cert && cert.certify && cert.certify.state === 'passed', cert && cert.certify);
  const first = await waitFor(() => allPacks().find(p => p.help && p.help.noteId === sent.j.id), 45000);
  ok('設定 AI 後重試求助：沿用原工作資料產生固定問題和原題關聯，不建立工作', first && JSON.stringify(first.help) === JSON.stringify({ noteId: sent.j.id, packId: 'p-1' }) && first.questions.length === 1 && first.questions[0].ask === '你想怎樣做？' && first.questions[0].options.at(-1).text === helpStill && !(state().tasks || []).length, first && { help: first.help, questions: first.questions, tasks: state().tasks });

  await cdp.go(BASE + '/#/', 1280, 1800);
  const firstHome = await cdp.ev('(()=>{const a=document.querySelector(".hero a.btn.primary.big");return a?{href:a.getAttribute("href"),text:a.textContent,screen:document.body.innerText}:null})()');
  ok('未有公司概覽而已有求助回覆：首頁顯示待決事項並保留交資料入口', firstHome && firstHome.href === '#/ask/' + first.id && firstHome.screen.includes(N.ui.goIntake), firstHome);
  await cdp.click('.hero a.btn.primary.big');
  const qButton = await cdp.ev('(()=>{const b=document.querySelector(".q-help");return b?{text:b.textContent,disabled:b.disabled}:null})()');
  ok('每條問題有「不明白」入口', qButton && qButton.text === N.ui.helpNotClear && !qButton.disabled, qButton);
  await cdp.click('.q-help');
  const qSent = await waitFor(async () => {
    const value = await cdp.ev('(()=>{const b=document.querySelector(".q-help");return b?{text:b.textContent,disabled:b.disabled}:null})()');
    return value && value.disabled ? value : null;
  }, 5000);
  ok('題目求助送出後顯示已交出並避免重複送出', qSent && qSent.text === N.ui.helpAsked && qSent.disabled, qSent);

  const a1 = await answer(first, helpStill);
  ok('第一次要求換方式：答案可送出', a1.code === 200, a1);
  const second = await waitFor(() => allPacks().find(p => p.help && p.helpRetries === 1), 45000);
  ok('第一次仍不明白：自動排入不同方式的求助，計數為 1', second && second.helpRetries === 1, second && { id: second.id, retries: second.helpRetries });

  const a2 = second && await answer(second, helpStill);
  const third = await waitFor(() => allPacks().find(p => p.help && p.helpRetries === 2), 45000);
  ok('第二次仍不明白：只再自動重問一次，計數為 2', a2 && a2.code === 200 && third && third.helpRetries === 2, { answer: a2, third: third && { id: third.id, retries: third.helpRetries } });

  const a3 = third && await answer(third, helpStill);
  const limit = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && (s.runs || []).find(r => r.kind === 'ask' && r.result && r.result.summary === N.ui.helpRepeatLimit);
  });
  ok('第三次仍不明白：停止自動重問並保留回到 AI 對話的固定指引', a3 && a3.code === 200 && limit && limit.result.summary === N.ui.helpRepeatLimit && !allPacks().some(p => p.help && p.helpRetries > 2), limit && limit.result);

  const ordinaryRequest = await post('/api/intake', { kind: 'note', type: 'help', text: '我已明白，請記錄這個答案。' });
  const ordinary = ordinaryRequest.code === 202 && await waitFor(() => allPacks().find(p => p.help && p.help.noteId === ordinaryRequest.j.id), 45000);
  const normal = ordinary && await answer(ordinary, '先按建議做');
  const recorded = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && (s.runs || []).find(r => r.kind === 'ask' && r.result && r.result.summary === N.ui.helpAnswerRecorded);
  });
  ok('一般回答：只記錄求助答案，不建立工作或再次提問', normal && normal.code === 200 && recorded && !(state().tasks || []).length, { normal, recorded: recorded && recorded.result, tasks: state().tasks });

  const documentRequest = await post('/api/intake', { kind: 'note', type: 'help', text: '請幫我製作文件。' });
  const documentPack = documentRequest.code === 202 && await waitFor(() => allPacks().find(p => p.help && p.help.noteId === documentRequest.j.id && p.next && p.next.task), 45000);
  const documentAnswer = documentPack && await answer(documentPack, '先按建議做');
  const documentFollow = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && (s.runs || []).find(r => r.kind === 'ask' && r.ref === documentPack.id && r.state === 'done' && r.result && r.result.summary !== N.ui.helpAnswerRecorded);
  }, 45000);
  ok('求助內同意製作文件：按確認後啟動後續 AI 工作', documentAnswer && documentAnswer.code === 200 && !!documentFollow, { answer: documentAnswer, follow: documentFollow && documentFollow.result });

  await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && !s.busy && !(s.pending || []).length;
  }, 15000);
  fs.copyFileSync(path.join(PROTO, 'fixtures', 'example-company-page.json'), path.join(DATA, 'company', 'page.json'));
  const beforeStatus = tree(DATA);
  const status = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--status'], {
    cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', windowsHide: true
  });
  const afterStatus = tree(DATA);
  const lines = String(status.stdout || '').trim().split(/\r?\n/);
  ok('--status：有認證及公司概覽時不會要求設定 AI，只印三行且不改資料、不啟動頁面', status.status === 0 && lines.length === 3 && /^目前：/.test(lines[0] || '') && /^下一步：/.test(lines[1] || '') && /^重新打開：/.test(lines[2] || '') && !lines.join('\n').includes(N.ui.goSetup) && JSON.stringify(beforeStatus) === JSON.stringify(afterStatus), { code: status.status, lines, stderr: status.stderr });
  ok('頁面沒有程式錯誤', !cdp.errors.length, cdp.errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  try { cdp && cdp.close(); } catch {}
  try { srv.kill(); } catch {}
  await sleep(250);
}

for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info || null).slice(0, 1000)));
console.log('\n' + results.filter(r => r.pass).length + '/' + results.length + ' passed');
fs.writeFileSync(path.join(OUT, 'server-log.txt'), log);
process.exit(results.every(r => r.pass) ? 0 : 1);
