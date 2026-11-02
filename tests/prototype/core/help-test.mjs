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
function writePack(p) {
  fs.writeFileSync(path.join(DATA, 'asks', p.id + '.json'), JSON.stringify(p, null, 2));
  return p;
}
function makeHelpPack(p, retries) {
  delete p.next; delete p.taskTitle;
  p.context = '這是求助回覆的測試內容。你可以先照建議做，或要求換一個方式解釋。';
  p.help = { noteId: p.help.noteId };
  if (retries) p.helpRetries = retries; else delete p.helpRetries;
  p.questions = [{
    id: 'how',
    priority: 1,
    ask: '你想怎樣做？',
    kind: 'choice',
    options: [{ text: '先按建議做', rec: true }, { text: helpStill }],
    value: '先按建議做',
    why: '先用最直接的方式處理。'
  }];
  return writePack(p);
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
  await cdp.go(BASE + '/dashboard', 1280, 1600);
  const dashboardHelp = await cdp.ev('(()=>{const b=document.getElementById("open-help");return b?b.textContent:""})()');
  ok('營運監察台共用同一個「需要幫助」入口', dashboardHelp === N.ui.helpOpen, dashboardHelp);

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
  const archived = await waitFor(() => archivedHelp(sent.j.id), 15000);
  ok('收件資料只保留允許的脈絡欄位', archived && /type: help/.test(archived) && /"page":"pending"/.test(archived) && /"packId":"p-1"/.test(archived) && !archived.includes('ignored'), archived && archived.slice(-500));

  const waiting = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && s.runs && s.runs.find(r => r.kind === 'note' && r.noteType === 'help' && r.state === 'waiting');
  });
  ok('AI 未設定：求助停在等待狀態而不是失敗，日後可接續', waiting && waiting.state === 'waiting', waiting && { state: waiting.state, error: waiting.error });

  const cert = await certify(BASE);
  ok('設定測試 AI 後認證完成', cert && cert.certify && cert.certify.state === 'passed', cert && cert.certify);
  const first = await waitFor(() => allPacks().find(p => p.help && p.help.noteId === sent.j.id), 45000);
  ok('補做：沒有公司概覽的求助仍產生問題包，保留 help 標記且不建立工作', first && JSON.stringify(first.help) === JSON.stringify({ noteId: sent.j.id }) && !(state().tasks || []).length, first && { help: first.help, request: first.request, tasks: state().tasks });

  const firstReady = first && makeHelpPack(first, 0);
  await cdp.go(BASE + '/#/ask/' + encodeURIComponent(firstReady.id), 1280, 1800);
  const qButton = await cdp.ev('(()=>{const b=document.querySelector(".q-help");return b?{text:b.textContent,disabled:b.disabled}:null})()');
  ok('每條問題有「不明白」入口', qButton && qButton.text === N.ui.helpNotClear && !qButton.disabled, qButton);
  await cdp.click('.q-help');
  const qSent = await waitFor(async () => {
    const value = await cdp.ev('(()=>{const b=document.querySelector(".q-help");return b?{text:b.textContent,disabled:b.disabled}:null})()');
    return value && value.disabled ? value : null;
  }, 5000);
  ok('題目求助送出後顯示已交出並避免重複送出', qSent && qSent.text === N.ui.helpAsked && qSent.disabled, qSent);

  const a1 = await answer(firstReady, helpStill);
  ok('第一次要求換方式：答案可送出', a1.code === 200, a1);
  const second = await waitFor(() => allPacks().find(p => p.help && p.helpRetries === 1), 45000);
  ok('第一次仍不明白：自動排入不同方式的求助，計數為 1', second && second.helpRetries === 1, second && { id: second.id, retries: second.helpRetries });

  const secondReady = second && makeHelpPack(second, 1);
  const a2 = secondReady && await answer(secondReady, helpStill);
  const third = await waitFor(() => allPacks().find(p => p.help && p.helpRetries === 2), 45000);
  ok('第二次仍不明白：只再自動重問一次，計數為 2', a2 && a2.code === 200 && third && third.helpRetries === 2, { answer: a2, third: third && { id: third.id, retries: third.helpRetries } });

  const thirdReady = third && makeHelpPack(third, 2);
  const a3 = thirdReady && await answer(thirdReady, helpStill);
  const limit = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && (s.runs || []).find(r => r.kind === 'ask' && r.result && r.result.summary === N.ui.helpRepeatLimit);
  });
  ok('第三次仍不明白：停止自動重問並保留回到 AI 對話的固定指引', a3 && a3.code === 200 && limit && limit.result.summary === N.ui.helpRepeatLimit && !allPacks().some(p => p.help && p.helpRetries > 2), limit && limit.result);

  const ordinaryRequest = await post('/api/intake', { kind: 'note', type: 'help', text: '我已明白，請記錄這個答案。' });
  const ordinary = ordinaryRequest.code === 202 && await waitFor(() => allPacks().find(p => p.help && p.help.noteId === ordinaryRequest.j.id), 45000);
  const ordinaryReady = ordinary && makeHelpPack(ordinary, 0);
  const normal = ordinaryReady && await answer(ordinaryReady, '先按建議做');
  const recorded = await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && (s.runs || []).find(r => r.kind === 'ask' && r.result && r.result.summary === N.ui.helpAnswerRecorded);
  });
  ok('一般回答：只記錄求助答案，不建立工作或再次提問', normal && normal.code === 200 && recorded && !(state().tasks || []).length, { normal, recorded: recorded && recorded.result, tasks: state().tasks });

  await waitFor(async () => {
    const s = (await get('/api/status')).j;
    return s && !s.busy && !(s.pending || []).length;
  }, 15000);
  const beforeStatus = tree(DATA);
  const status = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--status'], {
    cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', windowsHide: true
  });
  const afterStatus = tree(DATA);
  const lines = String(status.stdout || '').trim().split(/\r?\n/);
  ok('--status：只印目前、下一步、重新打開三行，且不改資料、不啟動頁面', status.status === 0 && lines.length === 3 && /^目前：/.test(lines[0] || '') && /^下一步：/.test(lines[1] || '') && /^重新打開：/.test(lines[2] || '') && JSON.stringify(beforeStatus) === JSON.stringify(afterStatus), { code: status.status, lines, stderr: status.stderr });
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
