// startup-os 情景演練：場景、練習紀錄、對手引擎（AI 扮對方逐句回應）同覆盤。
// 原型試行（主線同創辦人已認同）：伺服器以子程序開已認證嘅 AI 工具扮對方——冇工具、冇寫檔權、唔讀設定、清走密鑰類環境變數同 MCP、
// 工作資料夾係空資料夾、只收場景同對話紀錄。正式規則（伺服器可唔可以直接開 AI）等創辦人決定。
// 場景：<資料夾>/practice/scenarios/<id>.json（示範由 demo-seed 放；真實由外殼叫 AI 由準備文件生成）
// 練習紀錄：<資料夾>/founder/practice/<練習 id>.json（創辦人嘅練習，伺服器寫）；一律「練習 · 不算證據」
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJSON, writeJSON, localIso, stamp } from './ask-lib.mjs';
import { cleanEnv, resolveCommand } from './host-lib.mjs';

export const LEVELS = { easy: '友善', normal: '一般', hard: '難搞' };
export const PERSONA_KEYS = ['identity', 'background', 'stance', 'interests', 'decision', 'concerns', 'style'];
const dirs = DIR => ({ sc: path.join(DIR.data, 'practice', 'scenarios'), se: path.join(DIR.data, 'founder', 'practice'), run: path.join(DIR.sandbox, 'practice') });
const okId = id => /^[\w-]{1,60}$/.test(String(id || ''));

/* ---------- 場景同紀錄 ---------- */
export function listScenarios(DIR) {
  const d = dirs(DIR).sc;
  if (!fs.existsSync(d)) return [];
  // 有真實會面日期嘅排先、最近嗰個先；其餘照名
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(d, f), null)).filter(s => s && s.id && s.counterpart)
    .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || '').localeCompare(String(b.date || '')) || a.id.localeCompare(b.id));
}
export function loadScenario(DIR, id) { return okId(id) ? readJSON(path.join(dirs(DIR).sc, id + '.json'), null) : null; }
export function listSessions(DIR) {
  const d = dirs(DIR).se;
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(d, f), null)).filter(Boolean)
    .map(s => ({ id: s.id, scenarioId: s.scenarioId, level: s.level, startedAt: s.startedAt, endedAt: s.endedAt || '', turns: s.turns.length, goal: s.state.goal, review: s.review ? { goalMet: s.review.goal && s.review.goal.met } : null }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}
export function loadSession(DIR, id) { return okId(id) ? readJSON(path.join(dirs(DIR).se, id + '.json'), null) : null; }
function saveSession(DIR, s) { fs.mkdirSync(dirs(DIR).se, { recursive: true }); writeJSON(path.join(dirs(DIR).se, s.id + '.json'), s); }

/* ---------- 提示詞 ---------- */
function personaText(sc, persona) {
  const L = { identity: '身分同職位', background: '背景', stance: '立場（對今次提議嘅預設態度）', interests: '利益（想得到乜、怕失去乜）', decision: '點樣做決定', concerns: '顧慮同底線', style: '講嘢風格' };
  return PERSONA_KEYS.map(k => persona[k] && persona[k].text ? `- ${L[k]}：${persona[k].text}` : '').filter(Boolean).join('\n');
}
function systemPrompt(sc, session) {
  const lv = { easy: '友善：願意傾，有合理理由就肯讓步。', normal: '一般：謹慎，要聽到具體理由先肯行一步。', hard: '難搞：守住自己利益，唔輕易讓步，會質疑同施壓，要創辦人真係解決你嘅顧慮先肯承諾。' }[session.level] || '';
  return [
    `你而家扮演「${sc.counterpart.name}」（${sc.counterpart.role}），同創辦人做一次練習會面。呢個係練習，唔係真實會面。`,
    '', '## 你嘅人物卡', personaText(sc, session.persona),
    '', '## 你心底嘅顧慮（創辦人事前唔知；唔好主動講，被問中或者被觸碰到先慢慢透露）', ...(sc.hidden || []).map(h => `- ${h.id}：${h.text}`),
    '', `## 難度`, lv,
    '', '## 創辦人今次想爭取嘅承諾', sc.goal.text + (sc.goal.fallback ? `（爭取唔到嘅後備：${sc.goal.fallback}）` : ''),
    '', '## 創辦人準備咗嘅問題（判斷佢問中未）', ...(sc.questions || []).map(q => `- ${q.id}：${q.text}`),
    '', '## 你可能提出嘅反對意見（你可以用，亦可以用自己嘅）', ...(sc.objections || []).map(o => `- ${o.id}：${o.text}`),
    '', '## 規則',
    '1. 每一句都由你嘅利益、立場同顧慮出發，計清楚呢單嘢對你值唔值、會唔會影響你嘅關係同資源；唔好做好好先生，唔好幫創辦人講嘢。',
    '2. 只用廣東話口語，一至三句；唔好列點、唔好客套總結。',
    '3. 唔好跳出角色，唔好提及你係 AI 或者練習系統。',
    '4. 你講完之後另起一行寫「#旁白」，再下一行寫一行 JSON（呢部分係練習系統嘅記錄，唔影響你嘅立場）；JSON 入面嘅 mood 同 hint 會顯示畀創辦人睇，一律用商用書面語（繁體中文）寫：',
    '{"mood":"一個詞形容你而家嘅情緒","moodScore":-2到2嘅整數,"raised":["你今次提出嘅反對意見編號"],"handled":["創辦人上一句有效應對咗嘅反對意見編號"],"asked":["創辦人上一句問中嘅問題編號"],"goal":0到3（0 未推進、1 接近、2 你答應咗後備、3 你答應咗目標）,"suggestions":["創辦人下一句可以點講，三個唔同方向，每個一句，用創辦人口吻"],"hint":"一句：你其實想知乜，或者創辦人應該爭取乜"}'
  ].join('\n');
}
function transcriptText(session) { return session.turns.map(t => (t.who === 'you' ? '創辦人：' : '你：') + t.text).join('\n'); }
function parseReply(raw) {
  const s = String(raw || '');
  const i = s.indexOf('#旁白');
  // 清走開頭嘅講者名、格式符號同包住成句嘅引號
  const text = (i >= 0 ? s.slice(0, i) : s).trim().replace(/^[*#>\s]+/, '').replace(/^[^：:「]{1,12}[：:]\s*/, m => /創辦人/.test(m) ? m : '').replace(/^[*\s]+|[*\s]+$/g, '').replace(/^「([\s\S]*)」$/, '$1');
  let tags = {};
  const j = i >= 0 ? s.slice(i) : s;
  const a = j.indexOf('{'), b = j.lastIndexOf('}');
  if (a >= 0 && b > a) { try { tags = JSON.parse(j.slice(a, b + 1)); } catch { tags = {}; } }
  const arr = x => Array.isArray(x) ? x.map(String).slice(0, 8) : [];
  return { text: text.split(/\r?\n/).filter(Boolean).join(' ').slice(0, 400), tags: { mood: String(tags.mood || '').slice(0, 12), moodScore: Math.max(-2, Math.min(2, Number(tags.moodScore) || 0)), raised: arr(tags.raised), handled: arr(tags.handled), asked: arr(tags.asked), goal: Math.max(0, Math.min(3, Number(tags.goal) || 0)), suggestions: arr(tags.suggestions).slice(0, 3).map(x => x.slice(0, 120)), hint: String(tags.hint || '').slice(0, 200) } };
}

/* ---------- 對手引擎：每個練習一個預先開定嘅程式，逐句送入 ---------- */
const live = new Map();
setInterval(() => { for (const [id, e] of live) if (Date.now() - e.lastUsed > 15 * 60000) stop(id); }, 60000).unref();
function stop(id) { const e = live.get(id); if (!e) return; live.delete(id); try { e.child.stdin.end(); } catch { } setTimeout(() => { try { e.child.kill(); } catch { } }, 2000); }
function spawnChat(host, cwd, systemFile, model) {
  const args = host.chat.args.map(a => a.replaceAll('{system}', systemFile).replaceAll('{model}', model));
  const c = resolveCommand(host.command);
  const child = spawn(c.command, [...c.prefix, ...args], { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const e = { child, buf: '', waiters: [], lastUsed: Date.now(), primed: false, dead: false };
  child.stdout.on('data', d => {
    e.buf += d; let i;
    while ((i = e.buf.indexOf('\n')) >= 0) {
      const line = e.buf.slice(0, i); e.buf = e.buf.slice(i + 1);
      let j = null; try { j = JSON.parse(line); } catch { }
      // 逐字串流：對方講完（見到旁白記號）就先交出去，唔使等埋建議講法
      const w0 = e.waiters[0];
      if (j && j.type === 'stream_event' && w0 && j.event && j.event.delta && typeof j.event.delta.text === 'string') {
        w0.acc = (w0.acc || '') + j.event.delta.text;
        if (!w0.replied && w0.acc.includes('#旁白')) { w0.replied = true; if (w0.onReply) w0.onReply(w0.acc); }
      }
      if (j && j.type === 'result') { const w = e.waiters.shift(); if (w) w(j); }
    }
  });
  child.stderr.on('data', () => { });
  const die = () => { e.dead = true; for (const w of e.waiters.splice(0)) w(null); };
  child.on('error', die); child.on('close', die);
  return e;
}
function send(e, text, ms, onReply) {
  return new Promise(resolve => {
    const t = setTimeout(() => { const k = e.waiters.indexOf(done); if (k >= 0) e.waiters.splice(k, 1); resolve(null); }, ms);
    function done(r) { clearTimeout(t); resolve(r); }
    done.onReply = onReply;
    e.waiters.push(done);
    try { e.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'); } catch { clearTimeout(t); resolve(null); }
  });
}
function engineFor(DIR, host, session, sc) {
  let e = live.get(session.id);
  if (e && !e.dead) return e;
  const cwd = path.join(dirs(DIR).run, session.id);
  fs.mkdirSync(cwd, { recursive: true });
  const sys = path.join(cwd, 'system.txt');
  fs.writeFileSync(sys, systemPrompt(sc, session));
  e = spawnChat(host, cwd, 'system.txt', host.chat.fastModel || 'haiku');
  live.set(session.id, e);
  return e;
}

/* ---------- 對外：開始、講一句、收回、完、覆盤 ---------- */
export function startSession(DIR, host, sc, level, edits) {
  const persona = JSON.parse(JSON.stringify(sc.persona || {}));
  for (const k of PERSONA_KEYS) if (edits && typeof edits[k] === 'string' && edits[k].trim() && persona[k] && edits[k].trim() !== persona[k].text) persona[k] = { text: edits[k].trim().slice(0, 400), source: '你原話（練習前改）' };
  const s = { id: 'P' + stamp() + '-' + String(Date.now() % 1000).padStart(3, '0'), scenarioId: sc.id, level: LEVELS[level] ? level : 'normal', startedAt: localIso(), persona,
    turns: [{ who: 'them', text: sc.opening || '你好，坐低傾吓。', at: localIso() }],
    state: { mood: '', moodScore: 0, goal: 0, asked: [], handled: [], raised: [] }, suggestions: (sc.openers || []).slice(0, 3), hint: sc.goal ? '本次只爭取：' + sc.goal.text : '', timing: [], label: '練習 · 不算證據' };
  saveSession(DIR, s);
  if (host) engineFor(DIR, host, s, sc); // 預先開定，創辦人諗緊點講嗰陣程式已經準備好
  return s;
}
export async function say(DIR, host, session, sc, text) {
  const line = String(text || '').trim().slice(0, 600);
  if (!line) return { error: '請先輸入發言內容。' };
  if (session.endedAt) return { error: '此次練習已結束。' };
  session.turns.push({ who: 'you', text: line, at: localIso() });
  const e = engineFor(DIR, host, session, sc);
  e.lastUsed = Date.now();
  // 新開嘅程式（重開或者收回之後）要先交返之前嘅對話做背景
  const msg = e.primed ? line : `（之前嘅對話，你係${sc.counterpart.name}）\n${transcriptText({ turns: session.turns.slice(0, -1) })}\n\n創辦人而家講：${line}`;
  const t0 = Date.now();
  let early; const first = new Promise(r => { early = r; });
  const full = send(e, msg, 30000, acc => early({ acc }));
  full.then(r => early({ r }));
  const got = await first;
  if (got.r !== undefined && (!got.r || got.r.is_error)) { session.turns.pop(); stop(session.id); return { error: '對方暫時未能回應，請再發送一次。' }; }
  e.primed = true;
  const ms = Date.now() - t0;
  if (got.acc !== undefined) {
    // 對方講完：先顯示；建議講法、提示同記錄等成句完先補（通常再一兩秒）
    const turn = { who: 'them', text: parseReply(got.acc).text || '……', at: localIso(), ms };
    session.turns.push(turn); session.pending = true; session.timing.push(ms);
    saveSession(DIR, session);
    const done = full.then(r => {
      const cur = loadSession(DIR, session.id) || session;
      cur.pending = false;
      if (r && !r.is_error) { const p = parseReply(r.result); const last = cur.turns[cur.turns.length - 1]; if (last && last.who === 'them') { last.tags = p.tags; last.fullMs = Date.now() - t0; } applyTags(cur, p.tags); cur.cost = (cur.cost || 0) + (r.total_cost_usd || 0); }
      saveSession(DIR, cur);
    });
    return { session, done };
  }
  const r = got.r;
  const p = parseReply(r.result);
  session.turns.push({ who: 'them', text: p.text || '……', at: localIso(), ms, tags: p.tags });
  session.timing.push(ms);
  applyTags(session, p.tags);
  session.cost = (session.cost || 0) + (r.total_cost_usd || 0);
  saveSession(DIR, session);
  return { session, done: Promise.resolve() };
}
function applyTags(session, tags) {
  const p = { tags };
  const st = session.state, add = (k, v) => { for (const x of v) if (!st[k].includes(x)) st[k].push(x); };
  add('asked', p.tags.asked); add('handled', p.tags.handled); add('raised', p.tags.raised);
  st.mood = p.tags.mood || st.mood; st.moodScore = p.tags.moodScore; st.goal = Math.max(st.goal, p.tags.goal);
  if (p.tags.suggestions.length) session.suggestions = p.tags.suggestions;
  if (p.tags.hint) session.hint = p.tags.hint;
}
export function undo(DIR, session) {
  if (session.endedAt) return { error: '此次練習已結束。' };
  const last = session.turns.map(t => t.who).lastIndexOf('you');
  if (last < 0) return { error: '尚未有可撤回的發言。' };
  session.turns = session.turns.slice(0, last);
  stop(session.id); // 對方要當冇聽過：重開程式，下一句連返之前對話交俾佢
  saveSession(DIR, session);
  return { session };
}
export async function finish(DIR, host, session, sc) {
  if (session.review) return { session };
  stop(session.id);
  session.endedAt = localIso();
  const cwd = path.join(dirs(DIR).run, session.id + '-review');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'system.txt'), '你係一位會面教練，幫創辦人覆盤一次練習會面。內容一律用商用書面語（繁體中文、香港商業語體）撰寫，引述對話原句除外；具體、短；唔好客套、唔好總結式空話；唔好提內部系統字眼。只輸出一個 JSON，唔好有其他字。');
  const prompt = [
    `## 練習對象：${sc.counterpart.name}（${sc.counterpart.role}）  難度：${LEVELS[session.level]}`,
    '## 人物卡', personaText(sc, session.persona),
    '## 對方心底顧慮（練習時創辦人唔知）', ...(sc.hidden || []).map(h => `- ${h.id}：${h.text}`),
    '## 會議目標', sc.goal.text,
    '## 問題清單', ...(sc.questions || []).map(q => `- ${q.id}：${q.text}`),
    '## 反對意見清單', ...(sc.objections || []).map(o => `- ${o.id}：${o.text}（準備咗嘅應對：${o.response || ''}）`),
    '## 對話', session.turns.map(t => (t.who === 'you' ? '創辦人：' : sc.counterpart.name + '：') + t.text).join('\n'),
    '', '請輸出 JSON：',
    '（goal.met：答應目標寫 yes；只答應後備或者部分寫 partly；乜都冇答應寫 no）',
    '{"summary":"對方反應摘要，兩三句","goal":{"met":"yes|partly|no","why":"一句"},"questions":[{"id":"Q1","asked":true,"note":"一句"}],"objections":[{"id":"O1","raised":true,"handled":"good|weak|missed","note":"一句"}],"why":[{"moment":"對方講咗乜（短引）","reason":"點解咁反應","personaKey":"identity|background|stance|interests|decision|concerns|style"}],"hidden":[{"id":"H1","surfaced":true,"note":"創辦人有冇觸碰到，點睇得出"}],"fixes":["要改嘅位，最多三個"],"betterLines":[{"instead":"創辦人講咗嘅一句","try":"可以改講"}],"card":{"opening":"開場一句","questions":["最多五條，最重要排先"],"objections":[{"if":"佢話……","say":"你答……"}],"closing":"收尾一句，爭取今次嘅承諾"}}'
  ].join('\n');
  const e = spawnChat(host, cwd, 'system.txt', host.chat.reviewModel || host.chat.fastModel || 'haiku');
  const t0 = Date.now();
  const r = await send(e, prompt, 120000);
  try { e.child.stdin.end(); } catch { }
  setTimeout(() => { try { e.child.kill(); } catch { } }, 2000);
  let rv = null;
  if (r && !r.is_error) { const s = String(r.result || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}'); try { rv = JSON.parse(s.slice(a, b + 1)); } catch { rv = null; } }
  session.reviewMs = Date.now() - t0;
  if (!rv) { session.reviewError = '覆盤未能完成，請按下方按鈕重試。'; session.review = null; saveSession(DIR, session); return { session }; }
  delete session.reviewError;
  session.review = rv;
  session.cost = (session.cost || 0) + ((r && r.total_cost_usd) || 0);
  saveSession(DIR, session);
  return { session };
}
export function stopAll() { for (const id of [...live.keys()]) stop(id); }
