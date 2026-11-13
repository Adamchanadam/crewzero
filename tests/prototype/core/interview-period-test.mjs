// 每週訪問下一期（brief-f2 第 4.4a 節）：舊一期只剩「不用你答」的題時，下一期要如期出現；仍有必答題未答時，不出下一期。
// 直接叫外殼（run.mjs），模擬時鐘、隔離資料夾、不開瀏覽器、不經伺服器；未認證 AI，所以全程零次 AI（日常工作跳過，但外殼仍按帳本出訪問題）。
// 訪問包一律由外殼 placeInterviewIfDue 出（時鐘推到訪問日前兩天內，跑 --type rhythm），不手寫題包。
// 三個世界：
//   甲（正例）：只答必答題（現時只有「本週成果」），其餘「暫按 Zero 建議」不答；推到下一期 → 應出第二期。現行程式因舊一期仍算「未答完」而不出（4.4a 未實作）。
//   乙（反例）：必答題不答、其餘全答；創辦人改訪問日（founder-ops 的 setRhythm，與系統頁同一通道）令下次訪問日與舊一期不同，
//               只剩「舊一期仍有必答題」這一個阻擋 → 不應出第二期。
//   丙（對照）：全部答完 → 第二期如期出現（現行程式及修正後都應通過，證明測試流程本身正確）。
// 必答題的判斷：有 ask-lib 的 requiresFounder 就用它（4.4a 新增）；未有就用 run.mjs 現有後台定義的副本（requiresFounderAnswer）。
// 用法：node interview-period-test.mjs <原型資料夾> <輸出資料夾> <port（不使用）>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { writeAdapters } from '../lib/adapters.mjs';

const [PROTO, OUT, , MODE] = process.argv.slice(2);
// 創辦人批核（2026-11-12，brief-f2 3A 節 F2-7）：修正只在「已代你收起」開關打開（或甲放入本版）時生效；關閉時維持 0.43.0 行為。
// 第四個參數 on：以開關打開跑；否則明確設 SOS_FACT_MERGE=0 以關閉跑（發佈版預設打開，關閉即 B 退路）。
process.env.SOS_FACT_MERGE = MODE === 'on' ? '1' : '0';
const FIX_ON = MODE === 'on';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 700))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// 後台「必須由你答」：4.4a 之後以 ask-lib 為準；之前用 run.mjs 第 3843 行一帶的定義
const requiresFounder = typeof lib.requiresFounder === 'function' ? (pack, q) => !!lib.requiresFounder(pack, q)
  : (pack, q) => !!(q && (pack.ideate || q.effect === 'now' || q.conflict || q.bind === 'results' || pack.actionConfirm || pack.acceptance && q.id === 'accept'));
const hasValue = a => !!a && String(a.value ?? '').trim() !== '';
// 2026-11-02 是星期一；例子公司的經營節奏訪問日是星期一，第一次同步後下次訪問日為 11 月 9 日（離起點超過兩天，起點不會出題）
const START = '2026-11-02T12:00:00';
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const AD = writeAdapters(path.join(OUT, 'adapters'));
let seq = 0;

function world(name) {
  const root = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), data = path.join(root, 'data');
  oldInstall(data, PROTO);
  fs.mkdirSync(path.join(data, 'founder', 'desk'), { recursive: true });
  const clock = iso => fs.writeFileSync(path.join(data, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: Date.parse(iso) - Date.now(), at: new Date().toISOString() }));
  clock(START);
  const env = { ...process.env, SOS_SIM: '1', SOS_DATA: data, SOS_ADAPTER: AD.fake, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => { const r = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) console.log('外殼結束碼 ' + r.status + '：' + String(r.stderr || '').slice(-400)); return r; };
  const rhythm = () => shell('--type', 'rhythm', '--trigger', 'manual');
  // 本程序寫回覆時要用同一個模擬時鐘（localIso）同同一份資料夾
  const use = () => { process.env.SOS_SIM = '1'; process.env.SOS_DATA = data; return lib.dataDirs(PROTO); };
  const DIR = use();
  const state = () => read(path.join(DIR.ledger, 'state.json'));
  const packs = () => { try { return fs.readdirSync(DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(DIR.asks, f))); } catch { return []; } };
  const interviews = () => packs().filter(p => p.rhythm && p.rhythm.kind === 'interview');
  const answers = id => { try { return read(path.join(DIR.answers, id + '.json')).answers || {}; } catch { return {}; } };
  const lastRun = () => { try { return (read(path.join(DIR.ledger, 'status.json')).runs || [])[0] || null; } catch { return null; } };
  return { data, DIR, clock, shell, rhythm, use, state, packs, interviews, answers, lastRun };
}
// 寫一份問題包回覆（同頁面送出的格式），再叫外殼處理；pick(q) 回答案，undefined＝這題不答
function answer(W, pack, pick) {
  W.use();
  const done = W.answers(pack.id);
  const list = pack.questions.filter(q => !done[q.id]).map(q => { const v = pick(q); return v === undefined ? null : { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; }).filter(Boolean);
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: false', 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  W.shell();
  return list.map(a => a.id);
}
// 必答題要有實際內容：本週成果寫一句，其他必答題照 AI 建議
const requiredValue = q => q.bind === 'results' ? '本週完成三次送貨（測試）' : q.value;
const requiredLeft = (pack, ans) => pack.questions.filter(q => requiresFounder(pack, q) && !hasValue(ans[q.id]));
const unansweredLeft = (pack, ans) => pack.questions.filter(q => !ans[q.id]);

// 共同起步：同步帳本 → 推到訪問日前一天 → 外殼出第一期
function firstPeriod(W, tag) {
  W.rhythm();
  const iv0 = W.state().interviews || {};
  ok(tag + '：起點同步後有下次訪問日、未出訪問包', /^\d{4}-\d{2}-\d{2}$/.test(iv0.nextOn || '') && W.interviews().length === 0, { interviews: iv0, packs: W.interviews().map(p => p.id) });
  W.clock(addDays(iv0.nextOn, -1) + 'T12:00:00');
  W.rhythm();
  const s = W.state(), list = W.interviews(), iv = list[0];
  ok(tag + '：第一期由外殼按帳本出題（placeInterviewIfDue）', list.length === 1 && iv.rhythm.on === iv0.nextOn && s.interviews.packFor === iv0.nextOn && s.interviews.packId === iv.id, { interviews: s.interviews, packs: list.map(p => [p.id, p.rhythm.on]) });
  return iv;
}

try {
  /* ---------- 甲（正例）：只答必答題，其餘暫按 Zero 建議 ---------- */
  {
    const W = world('required-only');
    const iv = firstPeriod(W, '甲');
    if (!iv) throw new Error('甲：第一期未出，無法續測');
    const req = iv.questions.filter(q => requiresFounder(iv, q));
    ok('甲：第一期有必答題，亦有不用你答的題', req.length > 0 && req.length < iv.questions.length, { required: req.map(q => q.id), all: iv.questions.map(q => q.id) });
    answer(W, iv, q => requiresFounder(iv, q) ? requiredValue(q) : undefined);
    const ans = W.answers(iv.id), s = W.state(), run = W.lastRun();
    const applied = run && (run.steps || []).find(x => x.key === 'applied');
    ok('甲：必答題已全部答，餘題未答（前提）', requiredLeft(iv, ans).length === 0 && unansweredLeft(iv, ans).length > 0, { requiredLeft: requiredLeft(iv, ans).map(q => q.id), left: unansweredLeft(iv, ans).length });
    ok('甲：作答結果寫明其餘「暫按 Zero 建議」（產品自己說不用答）', !!applied && String(applied.detail || '').includes('暫按 Zero 建議'), applied);
    ok('甲：帳本已把這一期記為完成、下次訪問日已推後（前提）', s.interviews.lastFor === iv.rhythm.on && s.interviews.nextOn > iv.rhythm.on && s.interviews.packFor !== s.interviews.nextOn, s.interviews);
    const next = s.interviews.nextOn;
    W.clock(addDays(next, -2) + 'T12:00:00');
    W.rhythm();
    const after = W.state(), rr = (after.runs || []).slice(-1)[0] || {};
    ok('甲：外殼已在下一期訪問日前兩天內跑過日常工作（前提）', String(rr.startedAt || '').slice(0, 10) >= addDays(next, -2) && String(rr.startedAt || '').slice(0, 10) <= next, { run: rr, next });
    const second = W.interviews().find(p => p.id !== iv.id && p.rhythm.on === next);
    if (FIX_ON) ok('甲（開關打開）：舊一期只剩不用答的題 → 下一期訪問如期出現', !!second && after.interviews.packFor === next, { next, interviews: after.interviews, packs: W.interviews().map(p => [p.id, p.rhythm.on, unansweredLeft(p, W.answers(p.id)).length + ' 題未答']) });
    else ok('甲（開關關閉）：維持 0.43.0 行為，舊一期仍有未答題 → 不出下一期', !second && W.interviews().length === 1, { next, packs: W.interviews().map(p => [p.id, p.rhythm.on]) });
    ok('甲：全程沒有開 AI', (after.runs || []).every(r => !r.aiStarted), (after.runs || []).map(r => [r.id, r.aiStarted]));
  }

  /* ---------- 乙（反例）：必答題未答 → 不出下一期 ---------- */
  {
    const W = world('required-pending');
    const iv = firstPeriod(W, '乙');
    if (!iv) throw new Error('乙：第一期未出，無法續測');
    answer(W, iv, q => requiresFounder(iv, q) ? undefined : q.value);
    let ans = W.answers(iv.id), s = W.state();
    ok('乙：其餘題已答、必答題仍未答（前提）', requiredLeft(iv, ans).length > 0 && unansweredLeft(iv, ans).every(q => requiresFounder(iv, q)), { requiredLeft: requiredLeft(iv, ans).map(q => q.id), left: unansweredLeft(iv, ans).map(q => q.id) });
    ok('乙：必答題未答，帳本未把這一期記為完成', s.interviews.lastFor !== iv.rhythm.on && s.interviews.nextOn === iv.rhythm.on, s.interviews);
    // 創辦人在系統頁改訪問日（星期一改星期三）：與伺服器 rhythmSetup 同一格式寫入 founder-ops，外殼開工時合併
    W.use();
    const r0 = s.company.rhythm, weekday = r0.interviewWeekday === 3 ? 4 : 3;
    fs.writeFileSync(path.join(W.DIR.ledger, 'founder-ops.json'), JSON.stringify([{ id: 'fo-test-rhythm', at: lib.localIso(), op: 'setRhythm', value: { runCadence: r0.runCadence, runTime: r0.runTime, interviewWeekday: weekday } }], null, 2));
    W.shell();
    s = W.state();
    const next = s.interviews.nextOn;
    ok('乙：改訪問日後下次訪問日與舊一期不同（只剩舊一期未答這一個阻擋，前提）', s.company.rhythm.interviewWeekday === weekday && next !== iv.rhythm.on && s.interviews.packFor === iv.rhythm.on, { rhythm: s.company.rhythm, interviews: s.interviews });
    W.clock(addDays(next, -1) + 'T12:00:00');
    W.rhythm();
    const after = W.state(), rr = (after.runs || []).slice(-1)[0] || {};
    ok('乙：外殼已在新訪問日前兩天內跑過日常工作（前提）', String(rr.startedAt || '').slice(0, 10) >= addDays(next, -2) && String(rr.startedAt || '').slice(0, 10) <= next, { run: rr, next });
    ans = W.answers(iv.id);
    ok('乙：舊一期仍有必答題未答 → 不出下一期', W.interviews().length === 1 && W.interviews()[0].id === iv.id && requiredLeft(iv, ans).length > 0, { packs: W.interviews().map(p => [p.id, p.rhythm.on]), interviews: after.interviews });
  }

  /* ---------- 丙（對照）：全部答完 → 下一期如期出現 ---------- */
  {
    const W = world('all-answered');
    const iv = firstPeriod(W, '丙');
    if (!iv) throw new Error('丙：第一期未出，無法續測');
    answer(W, iv, q => requiresFounder(iv, q) ? requiredValue(q) : undefined);
    answer(W, iv, q => q.value);
    const ans = W.answers(iv.id), s = W.state();
    ok('丙：第一期全部答完（前提）', unansweredLeft(iv, ans).length === 0, unansweredLeft(iv, ans).map(q => q.id));
    const next = s.interviews.nextOn;
    W.clock(addDays(next, -2) + 'T12:00:00');
    W.rhythm();
    const second = W.interviews().find(p => p.id !== iv.id && p.rhythm.on === next);
    ok('丙：舊一期全部答完 → 下一期訪問如期出現（對照）', !!second, { next, packs: W.interviews().map(p => [p.id, p.rhythm.on]) });
    ok('丙：全程沒有開 AI', (W.state().runs || []).every(r => !r.aiStarted));
  }
} catch (e) {
  ok('測試出錯', false, String(e && e.stack || e));
} finally {
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} 通過`);
  try { fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1)); } catch { }
  process.exit(pass === results.length ? 0 : 1);
}
