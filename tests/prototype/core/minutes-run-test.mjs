// 0.42.0 會議紀錄外殼測試：直接叫 run.mjs，用假 AI；不開瀏覽器、不經伺服器。
// 用法：node minutes-run-test.mjs <原型資料夾> <輸出資料夾> <port（不使用）>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeAdapters } from '../lib/adapters.mjs';
import { certifyDirect } from '../lib/testkit.mjs';

const [PROTO, OUT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = file => import(pathToFileURL(path.join(PROTO, file)).href);
const lib = await imp('ask-lib.mjs');
const minutes = await imp('minutes-lib.mjs');
const transcript = await imp('transcript-lib.mjs');
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 700))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let seq = 0;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const adapters = writeAdapters(path.join(OUT, 'adapters'));
const fake = read(adapters.fake);
fake.args = [path.join(HERE, '..', 'lib', 'fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'minutes-fake.json');
fs.writeFileSync(ADAPTER, JSON.stringify(fake, null, 2));

async function world(name) {
  const root = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  // 先讓外殼由舊安裝同步帳本（未認證 → 只同步帳本，不開工；做法同 roles-run-test）；認證後才會開假 AI。
  shell('--type', 'rhythm', '--trigger', 'manual');
  // 同步時外殼放上的深化站點、每週訪問題：清走，免得干擾本測試的題包
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(data, d))) fs.rmSync(path.join(data, d, f), { force: true }); } catch { } }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(data, 'ledger', 'state.json');
  const state = () => read(stateFile);
  const save = value => fs.writeFileSync(stateFile, JSON.stringify(value, null, 2));
  const s = state();
  s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; save(s);
  process.env.SOS_DATA = data;
  const DIR = lib.dataDirs(PROTO);
  return { data, DIR, shell, state, save, mode: text => fs.writeFileSync(path.join(data, 'fake-mode.txt'), text + '\n') };
}

function meeting(W, suffix = String(seq).padStart(3, '0')) {
  const id = `m-2026-11-10-100000-${suffix}`;
  const text = [
    '00:01  Speaker 1', '我們會先核對首批數量。', '',
    '00:12  Speaker 2', '我會在下星期提供資料。', '',
    '00:24  Speaker 1', '請你確認負責人。', '',
    '00:36  Speaker 2', '首批大概二百件。', '',
    '00:48  Speaker 1', '完成後再回覆。', ''
  ].join('\n');
  const folder = minutes.sourceDir(W.DIR, id); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'transcript.md'), text);
  minutes.createMinutes(W.DIR, { id, state: 'speakers', title: '首批安排', meetingDate: '2026-11-10', sources: [{ name: '逐字稿.txt', text: `ledger/minutes/${id}/transcript.md`, chars: text.length }], labels: [{ label: 'Speaker 1' }, { label: 'Speaker 2' }], suggest: { state: 'running', items: {} }, speakers: {}, version: 1, versions: [], inputId: '', error: '' });
  return { id, text };
}
function note(W, id, type, body = '') {
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.inbox, `${id}-note-${type}.md`), `kind: note\ntype: ${type}\nat: ${lib.localIso()}\n\n${body}`);
}
function runs(W) { try { return read(path.join(W.DIR.ledger, 'status.json')).runs || []; } catch { return []; } }
function latest(W) { return runs(W)[0] || null; }
function answer(W, pack, pick) {
  const answers = pack.questions.map(q => ({ id: q.id, value: pick ? pick(q) : q.value, ai: q.value, changed: false }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  return W.shell();
}
function packs(W) { try { return fs.readdirSync(W.DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(W.DIR.asks, f))); } catch { return []; } }

try {
  // 講者建議：合格、伺服器期間寫入 speakers 不被外殼蓋掉、壞 actorId／quote 退為 unknown。
  const A = await world('speakers'); const ma = meeting(A, '001');
  minutes.patchMinutes(A.DIR, ma.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' } } }, { who: 'server', from: 'speakers' });
  note(A, ma.id, 'minutes-speakers'); A.shell();
  let rec = minutes.readMinutes(A.DIR, ma.id);
  ok('講者建議合格：suggest.done，並保留伺服器期間寫入的 speakers', rec.suggest.state === 'done' && rec.suggest.items['Speaker 1'].kind === 'founder' && rec.suggest.items['Speaker 2'].actorId === 'pc-1' && rec.speakers['Speaker 1'].name === '我', rec);
  const B = await world('speakers-bad'); const mb = meeting(B, '002'); B.mode('minutes-speakers:bad'); note(B, mb.id, 'minutes-speakers'); B.shell();
  rec = minutes.readMinutes(B.DIR, mb.id);
  ok('不在名單的 actorId 或非原文 quote：外殼改為 unknown', Object.values(rec.suggest.items).every(item => item.kind === 'unknown'), rec.suggest);
  const C = await world('speakers-fail'); const mc = meeting(C, '003'); C.mode('minutes-speakers:fail'); note(C, mc.id, 'minutes-speakers'); C.shell();
  rec = minutes.readMinutes(C.DIR, mc.id);
  ok('講者建議 AI 失敗：suggest.state 為 failed', rec.suggest.state === 'failed', rec.suggest);

  // 草稿：固定結構、草稿檔、雜湊與說明行；壞模式修正一次後仍失敗。
  const aConfirmedFile = path.join(A.DIR.ledger, 'confirmed.json'), aConfirmed = read(aConfirmedFile);
  aConfirmed.values['canvas-value'] = '星塵慢烘禮盒'; delete aConfirmed.values['canvas-partners'];
  fs.writeFileSync(aConfirmedFile, JSON.stringify(aConfirmed, null, 2));
  const aPageFile = path.join(A.DIR.company, 'page.json'), aPage = read(aPageFile);
  aPage.detail.reading.find(field => field.id === 'canvas-partners').value = '銀杏速遞行';
  fs.writeFileSync(aPageFile, JSON.stringify(aPage, null, 2));
  const aState = A.state(); aState.company.actors[0].aliases = ['北角陳記', '', '   ', aState.company.actors[0].name, 123, '甲1', '甲2', '甲3', '甲4', '甲5', '甲6']; A.save(aState);
  minutes.patchMinutes(A.DIR, ma.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } }, state: 'drafting' }, { who: 'server', from: 'speakers' });
  note(A, ma.id, 'minutes-draft'); A.shell(); rec = minutes.readMinutes(A.DIR, ma.id);
  const draft = rec.file && fs.readFileSync(path.join(minutes.minutesDir(PROTO, A.DIR), rec.file), 'utf8');
  ok('草稿合格：ready、檔案、hash 與標示說明行齊全', rec.state === 'ready' && !!draft && rec.hash === minutes.sha256(draft) && /^> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 1 處）$/m.test(draft) && transcript.marks(draft).length === 2, { rec, marks: draft && transcript.marks(draft) });
  const aRun = latest(A), aSandbox = aRun && path.join(A.DIR.sandbox, aRun.id), aNames = aSandbox && path.join(aSandbox, 'company-names.md');
  ok('M1 已確認公司概覽名稱清單寫入草稿資料夾，包含公司及十二格的確認值', !!aNames && fs.existsSync(aNames) && fs.readFileSync(aNames, 'utf8').includes('月月鮮烘') && fs.readFileSync(aNames, 'utf8').includes('星塵慢烘禮盒'), aRun);
  ok('M2 名稱清單不退回頁面原值，且草稿資料夾沒有完整公司概覽', !!aNames && !fs.readFileSync(aNames, 'utf8').includes('銀杏速遞行') && !fs.existsSync(path.join(aSandbox, 'confirmed-page.md')), aSandbox);
  ok('M3 草稿工作說明列出公司名稱清單', !!aSandbox && fs.readFileSync(path.join(aSandbox, 'task-seen.md'), 'utf8').includes('company-names.md'), aSandbox);
  const aInput = aSandbox && fs.readFileSync(path.join(aSandbox, 'minutes-input.md'), 'utf8'), aRoster = (aInput && aInput.match(/^- 名單：(.*)$/m) || [])[1] || '';
  const aAliases = ((aRoster.match(/陳經理（(?:[^；）]*；)?別名：([^）]+)）/) || [])[1] || '').split('、').filter(Boolean);
  ok('M6 名單只列有效別名：略過數字、空白及正式名字，並按加入次序保留首五個', !!aInput && !aRoster.includes('123') && aAliases.join('、') === '北角陳記、甲1、甲2、甲3、甲4' && !/(?:別名：|、)\s*(?:、|）)/.test(aRoster), { roster: aRoster, aliases: aAliases });
  const D = await world('draft-bad'); const md = meeting(D, '004');
  minutes.patchMinutes(D.DIR, md.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } }, state: 'drafting' }, { who: 'server', from: 'speakers' });
  D.mode('minutes-draft:bad'); note(D, md.id, 'minutes-draft'); D.shell(); rec = minutes.readMinutes(D.DIR, md.id);
  ok('草稿連修正一次仍缺節：登記檔成為 failed', rec.state === 'failed' && rec.error, rec);
  const dRun = latest(D), dSandbox = dRun && path.join(D.DIR.sandbox, dRun.id);
  ok('M4 修正一次沿用同一草稿資料夾，名稱清單及工作說明仍在', !!dSandbox && fs.existsSync(path.join(dSandbox, 'company-names.md')) && fs.readFileSync(path.join(dSandbox, 'task-seen.md'), 'utf8').includes('修正一次') && fs.readFileSync(path.join(dSandbox, 'task-seen.md'), 'utf8').includes('company-names.md'), dRun);
  const M = await world('draft-no-overview'); const mm = meeting(M, '006');
  fs.rmSync(path.join(M.DIR.ledger, 'confirmed.json'), { force: true });
  minutes.patchMinutes(M.DIR, mm.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } }, state: 'drafting' }, { who: 'server', from: 'speakers' });
  note(M, mm.id, 'minutes-draft'); M.shell(); rec = minutes.readMinutes(M.DIR, mm.id);
  const mRun = latest(M), mSandbox = mRun && path.join(M.DIR.sandbox, mRun.id);
  ok('M5 沒有已確認公司概覽仍可完成草稿，且不寫空白名稱清單', rec.state === 'ready' && mRun && mRun.state !== 'failed' && mSandbox && !fs.existsSync(path.join(mSandbox, 'company-names.md')), { rec, run: mRun });
  const P = await world('draft-page-mismatch'); const mp = meeting(P, '007');
  const pConfirmedFile = path.join(P.DIR.ledger, 'confirmed.json'), pConfirmed = read(pConfirmedFile);
  pConfirmed.pageId = 'not-the-current-page'; fs.writeFileSync(pConfirmedFile, JSON.stringify(pConfirmed, null, 2));
  minutes.patchMinutes(P.DIR, mp.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } }, state: 'drafting' }, { who: 'server', from: 'speakers' });
  note(P, mp.id, 'minutes-draft'); P.shell(); rec = minutes.readMinutes(P.DIR, mp.id);
  const pRun = latest(P), pSandbox = pRun && path.join(P.DIR.sandbox, pRun.id);
  ok('M7 已確認頁面編號不符時草稿仍完成，且工作資料夾不寫名稱清單', rec.state === 'ready' && pRun && pRun.state !== 'failed' && pSandbox && !fs.existsSync(path.join(pSandbox, 'company-names.md')), { rec, run: pRun });

  // 定稿附件：四項分兩包，⚠️ 保留為確認題、✏️ 負責人不當作已知；每包答案均須實際寫入帳本。
  const E = await world('event-batches');
  // 對話路徑交來的定稿沒有會議資料：按格式要有標示說明行，外殼才當作 CrewZero 整理的會議紀錄
  const final = ['# 會議紀錄：測試（2026 年 11 月 10 日）', '> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 1 處）', '', '## 已發生的事實', '', '⚠️（數字不確定）對方口頭表示首批約二百件。', '', '## 待辦', '', '- ✏️（請補負責人）確認首批數量。', '- 供應商負責在 2026 年 11 月 24 日寄出首批樣本。', '', '## 改動清單', '', '沒有。', ''].join('\n');
  const eid = 'R20261110-100000-1';
  note(E, eid, 'event', '會議紀錄：測試');
  fs.writeFileSync(path.join(E.DIR.inbox, `${eid}-note-event-file-1-會議紀錄.md`), final);
  E.shell(); let input = E.state().inputs.find(x => x.id === 'in-' + eid); let first = read(path.join(E.DIR.asks, input.packId + '.json'));
  // 假 AI 交四項一般事項（假設、站點、兩項跟進），另加「下一個對外動作」（按現有設計另開一包問）
  ok('定稿事件：第一包最多三題，其餘兩項（第二條跟進及下一個對外動作）保留隊列，未答前沒有寫入', first.questions.length === 3 && Array.isArray(input.pendingEventItems) && input.pendingEventItems.length === 2 && (input.effects || []).length === 0, { questions: first.questions.map(q => q.id), pending: input.pendingEventItems, effects: input.effects });
  // 第一包：假設、站點及第一項日程均要實際生效。
  const seenPacks = new Set([first.id]), askedQ = [...first.questions.map(q => q.id)];
  const firstAssumption = first.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'setAssumptionGrade'));
  const firstMilestone = first.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'markDone'));
  answer(E, first, q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp') ? '2026-11-24' : q.value);
  let afterFirst = E.state(); input = afterFirst.inputs.find(x => x.id === 'in-' + eid);
  const second = input.packId && read(path.join(E.DIR.asks, input.packId + '.json'));
  ok('第一包答案已寫入帳本：假設、站點及指定日程均生效', !!firstAssumption && !!firstMilestone
    && afterFirst.company.assumptions.find(a => a.id === firstAssumption.options[0].apply.id).grade === firstAssumption.options[0].apply.grade
    && afterFirst.milestones.find(m => m.id === firstMilestone.options[0].apply.id).state === 'done'
    && afterFirst.tasks.some(task => task.dueAt === '2026-11-24'), { tasks: afterFirst.tasks.map(t => [t.title, t.dueAt]) });
  // 第二包一定使用另一組題號，否則 appliedQids 會把答案當成第一包已處理。
  seenPacks.add(second.id); askedQ.push(...second.questions.map(q => q.id));
  const secondFollow = second.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp'));
  const secondNext = second.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'setNextExternalAction'));
  answer(E, second, q => q === secondFollow ? '2026-12-01' : q.value);
  let afterSecond = E.state(); input = afterSecond.inputs.find(x => x.id === 'in-' + eid);
  ok('第二包答案有獨立帳本效果：題號不重用、第二日程及下一個對外動作均生效', !!secondFollow && !!secondNext
    && second.questions.every(q => !first.questions.some(old => old.id === q.id))
    && afterSecond.tasks.some(task => task.dueAt === '2026-12-01')
    && afterSecond.company.nextExternalAction.text === secondNext.options.find(o => o.rec).apply.text, { first: first.questions.map(q => q.id), second: second.questions.map(q => q.id), tasks: afterSecond.tasks.map(t => [t.title, t.dueAt]) });
  let pack = input.packId && !seenPacks.has(input.packId) && fs.existsSync(path.join(E.DIR.asks, input.packId + '.json')) ? read(path.join(E.DIR.asks, input.packId + '.json')) : null;
  for (let i = 0; i < 4 && pack && !seenPacks.has(pack.id); i++) {
    seenPacks.add(pack.id); askedQ.push(...pack.questions.map(q => q.id)); answer(E, pack);
    input = E.state().inputs.find(x => x.id === 'in-' + eid);
    pack = input.packId && !seenPacks.has(input.packId) && fs.existsSync(path.join(E.DIR.asks, input.packId + '.json')) ? read(path.join(E.DIR.asks, input.packId + '.json')) : null;
  }
  ok('四項一般事項沒有丟失：隊列清空，所有題號在同一件輸入內唯一', !input.pendingEventItems && (input.askedEventItemIds || []).length === 5 && new Set(askedQ).size === askedQ.length, { asked: input.askedEventItemIds, questions: askedQ });

  // nextAction 單獨交回時亦有穩定識別碼，不可在已問篩選前被靜默丟棄。
  const H = await world('next-action'); const hid = 'R20261110-100000-next'; H.mode('event:event-next-only'); note(H, hid, 'event', '已定下寄出樣本的下一步。'); H.shell();
  let hInput = H.state().inputs.find(x => x.id === 'in-' + hid), hPack = hInput && read(path.join(H.DIR.asks, hInput.packId + '.json'));
  answer(H, hPack); hInput = H.state().inputs.find(x => x.id === 'in-' + hid);
  ok('nextAction 單獨一項會出題並寫入帳本', hPack && hPack.realEvent.itemIds[0].startsWith('nextAction:') && H.state().company.nextExternalAction.text === '測試：先寄出樣本給對方', { itemIds: hPack && hPack.realEvent.itemIds, input: hInput });

  // ✏️ 實際日子／日期待定：AI 自行給的日期不得成為日程。
  const I = await world('unknown-date'); const iid = 'R20261110-100000-date'; I.mode('event:event-minute-unknown-date'); note(I, iid, 'event', '請整理會議紀錄。');
  fs.writeFileSync(path.join(I.DIR.inbox, `${iid}-note-event-file-1-會議紀錄.md`), '# 會議紀錄：測試\n> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 1 處）\n\n## 待辦\n\n- 寄出樣本；✏️（請補實際日子）日期待定。\n'); I.shell();
  const iInput = I.state().inputs.find(x => x.id === 'in-' + iid);
  ok('✏️ 日期待定不保留 AI 提出的具體日程', iInput && iInput.status === 'processed' && !I.state().tasks.some(task => task.dueAt === '2026-11-30'), { input: iInput, tasks: I.state().tasks });

  // 可唯一定位而且原文明確寫出日期時，仍須保留正常的加入日程確認題。
  const K = await world('known-date'); const kid = 'R20261110-100000-known-date'; K.mode('event:event-minute-known-date'); note(K, kid, 'event', '請整理會議紀錄。');
  fs.writeFileSync(path.join(K.DIR.inbox, `${kid}-note-event-file-1-會議紀錄.md`), '# 會議紀錄：測試\n> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）\n\n## 待辦\n\n- 供應商負責在 2026 年 11 月 30 日寄出樣本。\n'); K.shell();
  const kInput = K.state().inputs.find(x => x.id === 'in-' + kid), kPack = kInput && kInput.packId ? read(path.join(K.DIR.asks, kInput.packId + '.json')) : null;
  ok('可定位且明確日期的日程：仍會出加入日程題', kPack && kPack.questions.length === 1 && kPack.questions[0].options.some(option => option.apply && option.apply.op === 'addFollowUp' && option.apply.date === '2026-11-30'), { input: kInput, pack: kPack });

  // 項目文字出現未對照講者標籤，即使附件本身沒有標籤也必須退回。
  const J = await world('unmapped-item'); const jid = 'R20261110-100000-unmapped-item'; J.mode('event:event-unmapped-item\nevent-repair:event-unmapped-item'); note(J, jid, 'event', '請整理這次事件。'); J.shell();
  ok('AI 項目 why 含未對照講者：checkEvent 拒絕，沒有問題包', latest(J) && latest(J).state === 'failed' && !packs(J).some(pack => pack.realEvent && pack.realEvent.inputId === 'in-' + jid), latest(J));

  // 未對照標籤必須阻止事件包；對話同樣只靠附件也走同一守門。
  const F = await world('unmapped'); const fid = 'R20261110-100000-2';
  note(F, fid, 'event', '請整理附件'); fs.writeFileSync(path.join(F.DIR.inbox, `${fid}-note-event-file-1-會議紀錄.md`), final + '\nSpeaker 9：未確認。\n'); F.shell();
  ok('會議紀錄含未對照標籤：checkEvent 拒絕，沒有問題包', latest(F) && latest(F).state === 'failed' && !packs(F).some(pack => pack.realEvent && pack.realEvent.inputId === 'in-' + fid), latest(F));

  // 修改版全流程：第一版交出並確認，第二版機讀區以 revisionOf 指向第一件輸入；不可手設舊 inputId。
  const G = await world('revision'); const mg = meeting(G, '005');
  const gs = G.state(); for (const assumption of gs.company.assumptions || []) assumption.grade = 'guess'; G.save(gs);
  minutes.patchMinutes(G.DIR, mg.id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } } }, { who: 'server', from: 'speakers' });
  fs.writeFileSync(path.join(minutes.sourceDir(G.DIR, mg.id), 'v1.md'), '# 會議紀錄：首版\n\n首版內容：對方已作出實際行動。\n');
  const oldId = 'R20261110-100000-old'; G.mode('event:event-revision');
  note(G, oldId, 'event', '首版內容\n\n```json\n' + JSON.stringify({ minutes: { id: mg.id, version: 1 } }) + '\n```');
  fs.writeFileSync(path.join(G.DIR.inbox, `${oldId}-note-event-file-1-會議紀錄.md`), '# 會議紀錄：首版\n\n首版內容：對方已作出實際行動。\n'); G.shell();
  let oldInput = G.state().inputs.find(input => input.id === 'in-' + oldId), oldPack = read(path.join(G.DIR.asks, oldInput.packId + '.json'));
  answer(G, oldPack); oldInput = G.state().inputs.find(input => input.id === 'in-' + oldId);
  const affected = oldInput.effects.find(effect => effect.targetKind === 'assumption');
  const gid = 'R20261110-100000-3';
  G.mode('event:event-revision'); note(G, gid, 'event', '修訂內容\n\n```json\n' + JSON.stringify({ minutes: { id: mg.id, version: 2, revisionOf: oldInput.id } }) + '\n```');
  fs.writeFileSync(path.join(G.DIR.inbox, `${gid}-note-event-file-1-會議紀錄.md`), '# 會議紀錄：新版\n\n修訂內容：對方改為只作口頭表示。\n\n修訂內容：另一項建議不屬舊版已寫入事項。\n'); G.shell();
  const revised = G.state().inputs.find(input => input.id === 'in-' + gid), revisedPack = revised && revised.packId ? read(path.join(G.DIR.asks, revised.packId + '.json')) : null;
  ok('修改版只問牽動已寫入項目，並在新輸入保留 previous', affected && revised && revised.minutes.revisionOf === oldInput.id && Array.isArray(revised.previous) && revised.previous.some(entry => /v1\.md$/.test(entry.file)) && revisedPack && revisedPack.questions.length === 1 && revisedPack.realEvent.itemIds[0] === 'assumption:' + affected.targetId, { oldInput, revised, revisedPack });

  // 修改版的跟進事項要按站點／原來源行對應上一版，而非用會改動的日期或文字作識別。
  async function revisedFollowUp(name, mode, before, after, pickOld) {
    const W = await world(name), mt = meeting(W);
    const oldRef = 'R20261110-100000-' + name + '-old'; W.mode('event:' + mode);
    note(W, oldRef, 'event', '首版\n\n```json\n' + JSON.stringify({ minutes: { id: mt.id, version: 1 } }) + '\n```');
    fs.writeFileSync(path.join(minutes.sourceDir(W.DIR, mt.id), 'v1.md'), before);
    fs.writeFileSync(path.join(W.DIR.inbox, `${oldRef}-note-event-file-1-會議紀錄.md`), before); W.shell();
    let oldInput = W.state().inputs.find(input => input.id === 'in-' + oldRef), oldPack = read(path.join(W.DIR.asks, oldInput.packId + '.json'));
    answer(W, oldPack, pickOld); oldInput = W.state().inputs.find(input => input.id === 'in-' + oldRef);
    const newRef = 'R20261110-100000-' + name + '-new'; W.mode('event:' + mode);
    note(W, newRef, 'event', '修訂版\n\n```json\n' + JSON.stringify({ minutes: { id: mt.id, version: 2, revisionOf: oldInput.id } }) + '\n```');
    fs.writeFileSync(path.join(W.DIR.inbox, `${newRef}-note-event-file-1-會議紀錄.md`), after); W.shell();
    const revisedInput = W.state().inputs.find(input => input.id === 'in-' + newRef), revisedPack = revisedInput && revisedInput.packId ? read(path.join(W.DIR.asks, revisedInput.packId + '.json')) : null;
    return { W, oldInput, revisedInput, revisedPack };
  }
  const dateChange = await revisedFollowUp('rev-date', 'event-revision-followup-date', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n', '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n');
  const dateQuestion = dateChange.revisedPack && dateChange.revisedPack.questions[0];
  ok('修改待辦日期：仍會出修訂確認題', dateQuestion && /11 月 20 日改為 11 月 27 日/.test(dateQuestion.ask) && dateQuestion.options.some(option => option.apply && option.apply.revisionOfTaskId), { input: dateChange.revisedInput, pack: dateChange.revisedPack });
  answer(dateChange.W, dateChange.revisedPack);
  const dateTasks = dateChange.W.state().tasks.filter(task => task && task.title === '寄出樣本');
  ok('同意修改日期後：原有日程更新，不新增重複項目', dateTasks.length === 1 && dateTasks[0].dueAt === '2026-11-27', dateTasks);

  const textChange = await revisedFollowUp('rev-text', 'event-revision-followup-text', '# 會議紀錄：首版\n\n- 供應商負責寄出樣本。\n', '# 會議紀錄：修訂版\n\n- 供應商負責預約試用。\n');
  const textQuestion = textChange.revisedPack && textChange.revisedPack.questions[0];
  ok('修改待辦文字：仍會出修訂確認題', textQuestion && /寄出樣本.*預約試用/.test(textQuestion.ask), { input: textChange.revisedInput, pack: textChange.revisedPack });

  const unrelated = await revisedFollowUp('rev-unrelated', 'event-revision-followup-unrelated', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n- 備註：首版。\n', '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n- 備註：只改這一句。\n');
  ok('不相關文字修改：不出題，修改版標為已處理', unrelated.revisedInput && unrelated.revisedInput.status === 'processed' && !unrelated.revisedPack, { input: unrelated.revisedInput });

  // 前面插入空行不會把同站另一項待辦當成修訂目標。
  const shifted = await revisedFollowUp('rev-shift', 'event-revision-followup-shift', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n', '# 會議紀錄：修訂版\n\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n');
  const shiftedQuestion = shifted.revisedPack && shifted.revisedPack.questions[0];
  answer(shifted.W, shifted.revisedPack);
  const shiftedTasks = shifted.W.state().tasks.filter(task => task && /^(寄出樣本|回覆報價)$/.test(task.title));
  ok('插入空行後只更新寄出樣本：同站回覆報價不被覆寫、沒有重複日程', shiftedQuestion && shifted.revisedPack.questions.length === 1 && shiftedQuestion.options.some(option => option.apply && option.apply.revisionOfTaskId)
    && shiftedTasks.filter(task => task.title === '寄出樣本').length === 1 && shiftedTasks.find(task => task.title === '寄出樣本').dueAt === '2026-11-27'
    && shiftedTasks.filter(task => task.title === '回覆報價').length === 1 && shiftedTasks.find(task => task.title === '回覆報價').dueAt === '2026-11-21', shiftedTasks);

  // 最後核對必修：兩項之間原有空行，再在修改行前插入空行，修訂題不可消失（空行不作對齊錨點）
  const blankShift = await revisedFollowUp('rev-blank', 'event-revision-followup-shift', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n', '# 會議紀錄：修訂版\n\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n');
  const blankQuestion = blankShift.revisedPack && blankShift.revisedPack.questions[0];
  if (blankShift.revisedPack) answer(blankShift.W, blankShift.revisedPack);
  const blankTasks = blankShift.W.state().tasks.filter(task => task && /^(寄出樣本|回覆報價)$/.test(task.title));
  ok('原有空行再加空行：仍出一條修訂題，同意後只更新寄出樣本', !!blankQuestion && blankShift.revisedPack.questions.length === 1 && blankQuestion.options.some(option => option.apply && option.apply.revisionOfTaskId)
    && blankTasks.filter(task => task.title === '寄出樣本').length === 1 && blankTasks.find(task => task.title === '寄出樣本').dueAt === '2026-11-27'
    && blankTasks.find(task => task.title === '回覆報價').dueAt === '2026-11-21', { pack: blankShift.revisedPack && blankShift.revisedPack.questions.map(q => q.ask), tasks: blankTasks });

  // 最後核對必修：上一版拒絕「寄出樣本」、只接受同站「回覆報價」；修訂版把寄樣改為 27 日，不可改到報價日程
  const notAdd = q => { const keep = (q.options || []).find(o => !(o.apply && o.apply.op === 'addFollowUp')); return keep ? keep.text : q.value; };
  const rejected = await revisedFollowUp('rev-rejected', 'event-revision-followup-shift', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n', '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n', q => /寄出樣本/.test(q.ask || '') ? notAdd(q) : q.value);
  const rejectedBefore = rejected.W.state().tasks.filter(task => task && task.title === '回覆報價').map(task => task.id + ':' + task.dueAt).join();
  if (rejected.revisedPack) answer(rejected.W, rejected.revisedPack);
  const rejectedTasks = rejected.W.state().tasks.filter(task => task && /^(寄出樣本|回覆報價)$/.test(task.title));
  ok('上一版拒絕寄樣、只接受報價：修訂版改寄樣日期不會改到報價日程', rejectedTasks.filter(task => task.title === '回覆報價').length === 1 && rejectedTasks.find(task => task.title === '回覆報價').dueAt === '2026-11-21' && rejectedTasks.filter(task => task.title === '回覆報價').map(task => task.id + ':' + task.dueAt).join() === rejectedBefore
    && !(rejected.revisedPack && rejected.revisedPack.questions.some(q => (q.options || []).some(o => o.apply && o.apply.revisionOfTaskId && rejectedBefore.includes(o.apply.revisionOfTaskId)))), { tasks: rejectedTasks, pack: rejected.revisedPack && rejected.revisedPack.questions.map(q => q.ask) });

  // 最後核對必修：下一個對外動作改動後，修訂題要能真正更新（不是只有「維持」）
  const nextRev = await revisedFollowUp('rev-next', 'event-revision-next', '# 會議紀錄：首版\n\n下一步：先寄出樣本給對方。\n', '# 會議紀錄：修訂版\n\n下一步：先為對方預約試用。\n');
  const nextQ = nextRev.revisedPack && nextRev.revisedPack.questions.find(q => (q.options || []).some(o => o.apply && /NextExternalAction|nextAction/i.test(String(o.apply.op || ''))));
  if (nextRev.revisedPack) answer(nextRev.W, nextRev.revisedPack);
  const nextNow = (nextRev.W.state().company || {}).nextExternalAction || {};
  ok('下一個對外動作的修訂題可更新，答「採用」後改為新動作', !!nextQ && /預約試用/.test(String(nextNow.text || '')), { pack: nextRev.revisedPack && nextRev.revisedPack.questions.map(q => ({ ask: q.ask, ops: (q.options || []).map(o => o.apply && o.apply.op) })), nextAction: nextNow });

  // 沒有站點時也以來源行內容對齊，不可依行號丟掉這一項。
  const noStation = await revisedFollowUp('rev-no-station', 'event-revision-followup-no-station', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n', '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n');
  const noStationQuestion = noStation.revisedPack && noStation.revisedPack.questions[0];
  answer(noStation.W, noStation.revisedPack);
  const noStationTasks = noStation.W.state().tasks.filter(task => task && task.title === '寄出樣本');
  ok('沒有站點的日期修改仍正確對應，不會丟失或重複日程', noStationQuestion && noStationQuestion.options.some(option => option.apply && option.apply.revisionOfTaskId)
    && noStationTasks.length === 1 && noStationTasks[0].dueAt === '2026-11-27', noStationTasks);

  // 同一差異區塊兩行同時改，不能憑站點或行號猜配；帳本保持原狀，交由一般修訂題核對。
  const multi = await revisedFollowUp('rev-multi', 'event-revision-followup-multi', '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n- 供應商負責在 2026 年 11 月 21 日回覆報價。\n', '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n- 供應商負責在 2026 年 11 月 28 日回覆報價。\n');
  const multiTasks = multi.W.state().tasks.filter(task => task && /^(寄出樣本|回覆報價)$/.test(task.title));
  ok('同區塊兩行修改不猜配：出一般修訂題而帳本未改', multi.revisedPack && multi.revisedPack.questions.length === 2
    && multi.revisedPack.questions.every(question => question.revisionAmbiguity)
    && multiTasks.filter(task => task.title === '寄出樣本').length === 1 && multiTasks.find(task => task.title === '寄出樣本').dueAt === '2026-11-20'
    && multiTasks.filter(task => task.title === '回覆報價').length === 1 && multiTasks.find(task => task.title === '回覆報價').dueAt === '2026-11-21', { pack: multi.revisedPack, tasks: multiTasks });

  // 第六輪必修：有多項可選的修訂題，創辦人自行填日期而沒有選定哪一項——任何日程都不改，回饋寫明未有改動
  const tasksBefore = JSON.stringify(multi.W.state().tasks);
  if (multi.revisedPack) answer(multi.W, multi.revisedPack, q => q.id === multi.revisedPack.questions[1].id ? '2026-11-30' : q.value);
  const multiAfter = multi.W.state(), multiInput = multiAfter.inputs.find(input => input.id === (multi.revisedInput || {}).id) || {};
  ok('多項可選的修訂題自行填日期：不套用到任何一項，日程原封不動，回饋寫明未能確定', JSON.stringify(multiAfter.tasks) === tasksBefore
    && (multiInput.effects || []).some(effect => /未能確定要更新哪一項日程/.test(effect.change || '')), { tasks: multiAfter.tasks, effects: multiInput.effects });

  // 第六輪必修：下一個對外動作修訂題自行填寫新內容，要寫入，不可只記「維持不變」
  const nextOwn = await revisedFollowUp('rev-next-own', 'event-revision-next', '# 會議紀錄：首版\n\n下一步：先寄出樣本給對方。\n', '# 會議紀錄：修訂版\n\n下一步：先為對方預約試用。\n');
  const ownQ = nextOwn.revisedPack && nextOwn.revisedPack.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'setNextExternalAction'));
  if (nextOwn.revisedPack) answer(nextOwn.W, nextOwn.revisedPack, q => ownQ && q.id === ownQ.id ? '先約對方試飲新豆' : q.value);
  const ownNow = (nextOwn.W.state().company || {}).nextExternalAction || {};
  ok('下一個對外動作修訂題自行填寫：以填寫內容作為新的下一個對外動作', !!ownQ && ownNow.text === '先約對方試飲新豆', { nextAction: ownNow });

  // 真實 AI 走查發現：創辦人只改待辦一行的日期，AI 沿用其他段落的舊日期或不交回事項，修改就被沉默忽略。外殼保底不可沉默。
  const baseText = '# 會議紀錄：首版\n\n## 雙方決定\n\n雙方決定：供應商在 2026 年 11 月 20 日前寄出樣本。\n\n## 待辦\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n';
  const movedText = baseText.replace('# 會議紀錄：首版', '# 會議紀錄：修訂版').replace('- 供應商負責在 2026 年 11 月 20 日寄出樣本。', '- 供應商負責在 2026 年 11 月 27 日寄出樣本。');
  const sampleTasks = W => W.state().tasks.filter(task => task && task.title === '寄出樣本');
  const silent = await revisedFollowUp('rev-silent', 'event-revision-silent', baseText, movedText);
  const silentFirst = sampleTasks(silent.W)[0] || {}, silentQs = (silent.revisedPack || {}).questions || [];
  ok('修訂版 AI 沒有交回事項：外殼按改動行出一條日期修訂題（精確日程編號），同一行的下一步在回饋寫明沒有自動更新',
    silentQs.length === 1 && /11 月 20 日改為 11 月 27 日/.test(silentQs[0].ask) && silentQs[0].options.some(o => o.apply && o.apply.revisionOfTaskId === silentFirst.id)
    && ((silent.revisedInput || {}).effects || []).some(effect => /下一個對外動作.*沒有自動更新/.test(effect.change || '')), { tasks: sampleTasks(silent.W), pack: silentQs.map(q => q.ask), effects: (silent.revisedInput || {}).effects });
  if (silent.revisedPack) answer(silent.W, silent.revisedPack);
  const silentAfter = sampleTasks(silent.W);
  ok('同意保底修訂題：同一項日程改為 27 日，沒有新增', silentAfter.length === 1 && silentAfter[0].id === silentFirst.id && silentAfter[0].dueAt === '2026-11-27', silentAfter);
  const silentEffects = ((silent.W.state().inputs || []).find(input => input.id === (silent.revisedInput || {}).id) || {}).effects || [];
  ok('同意後回饋寫「已更新日程」而不是「已加入日程」', silentEffects.some(effect => /^已更新日程：11 月 27 日/.test(effect.change || '') && effect.targetId === silentFirst.id) && !silentEffects.some(effect => /^已加入日程/.test(effect.change || '')), silentEffects);

  const stale = await revisedFollowUp('rev-stale', 'event-revision-stale', baseText, movedText);
  const staleQs = (stale.revisedPack || {}).questions || [];
  const sandboxes = fs.readdirSync(path.join(stale.W.data, 'sandbox')).map(d => path.join(stale.W.data, 'sandbox', d, 'event.md')).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8'));
  const toldAi = sandboxes.find(md => md.includes('修訂版')) || '';
  ok('修改版交給 AI 時寫明第幾版及改動行（舊行→新行）', /創辦人修改後的第 2 版/.test(toldAi) && toldAi.includes('「- 供應商負責在 2026 年 11 月 20 日寄出樣本。」改為「- 供應商負責在 2026 年 11 月 27 日寄出樣本。」'), toldAi.slice(0, 900));
  ok('AI 沿用舊日期並引用未改動的行：仍出一條日期修訂題，不會沉默', staleQs.length === 1 && /11 月 20 日改為 11 月 27 日/.test(staleQs[0].ask), staleQs.map(q => q.ask));
  if (stale.revisedPack) answer(stale.W, stale.revisedPack, q => ((q.options || []).find(o => !(o.apply && o.apply.op === 'addFollowUp')) || {}).text || q.value);
  const staleAfter = sampleTasks(stale.W);
  ok('保底修訂題答「不更新」：日程維持 20 日，沒有新增', staleAfter.length === 1 && staleAfter[0].dueAt === '2026-11-20', staleAfter);

  // 第二次修改：第二版正常更新到 27 日；第三版改為 30 日而 AI 不交回事項，仍按日程記下的來源行出題，同意後仍是同一項
  const chain = await revisedFollowUp('rev-chain', 'event-revision-chain', baseText, movedText);
  const chainFirst = sampleTasks(chain.W)[0] || {};
  if (chain.revisedPack) answer(chain.W, chain.revisedPack);
  const thirdText = movedText.replace('# 會議紀錄：修訂版', '# 會議紀錄：第三版').replace('2026 年 11 月 27 日寄出樣本。', '2026 年 11 月 30 日寄出樣本。');
  const chainMt = chain.revisedInput.minutes.id, thirdRef = 'R20261110-100000-rev-chain-third';
  fs.writeFileSync(path.join(minutes.sourceDir(chain.W.DIR, chainMt), 'v2.md'), movedText);
  chain.W.mode('event:event-revision-chain');
  note(chain.W, thirdRef, 'event', '第三版\n\n```json\n' + JSON.stringify({ minutes: { id: chainMt, version: 3, revisionOf: chain.revisedInput.id } }) + '\n```');
  fs.writeFileSync(path.join(chain.W.DIR.inbox, `${thirdRef}-note-event-file-1-會議紀錄.md`), thirdText); chain.W.shell();
  const thirdInput = chain.W.state().inputs.find(input => input.id === 'in-' + thirdRef) || {}, thirdPack = thirdInput.packId ? read(path.join(chain.W.DIR.asks, thirdInput.packId + '.json')) : null;
  const thirdQs = (thirdPack || {}).questions || [];
  ok('第三版（AI 不交回事項）：仍出一條日期修訂題，對應最初的同一項日程', sampleTasks(chain.W).length === 1 && sampleTasks(chain.W)[0].dueAt === '2026-11-27' && thirdQs.length === 1 && /11 月 27 日改為 11 月 30 日/.test(thirdQs[0].ask) && thirdQs[0].options.some(o => o.apply && o.apply.revisionOfTaskId === chainFirst.id), { tasks: sampleTasks(chain.W), pack: thirdQs.map(q => q.ask) });
  if (thirdPack) answer(chain.W, thirdPack);
  const chainAfter = sampleTasks(chain.W);
  ok('第三版同意後：同一項日程改為 30 日，沒有重複', chainAfter.length === 1 && chainAfter[0].id === chainFirst.id && chainAfter[0].dueAt === '2026-11-30', chainAfter);

  // Sol 第七輪：下一版的通用做法（寫入上一版原文，交出新一版）
  let extraSeq = 0;
  function nextVersion(W, prevInput, version, prevText, nextText, mode) {
    const mt = prevInput.minutes.id, ref = 'R20261110-100000-x' + (++extraSeq) + '-v' + version;
    fs.writeFileSync(path.join(minutes.sourceDir(W.DIR, mt), 'v' + (version - 1) + '.md'), prevText);
    W.mode('event:' + mode);
    note(W, ref, 'event', '第三版\n\n```json\n' + JSON.stringify({ minutes: { id: mt, version, revisionOf: prevInput.id } }) + '\n```');
    fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event-file-1-會議紀錄.md`), nextText); W.shell();
    const input = W.state().inputs.find(x => x.id === 'in-' + ref) || {};
    return { input, pack: input.packId ? read(path.join(W.DIR.asks, input.packId + '.json')) : null };
  }
  const changesOf = input => (input.effects || []).map(effect => effect.change || '');

  // Sol 第七輪必修 1：同一行兩項日程，只改日期而不知屬哪一項——不出題、不改任何一項，兩項都寫明未有更新
  const sharedBase = '# 會議紀錄：首版\n\n## 待辦\n\n- 供應商在 2026 年 11 月 20 日寄出樣本及回覆報價。\n';
  const shared = await revisedFollowUp('rev-shared', 'event-revision-shared', sharedBase, sharedBase.replace('首版', '修訂版').replace('11 月 20 日', '11 月 27 日'));
  const sharedTasks = shared.W.state().tasks.filter(task => task && /^(寄出樣本|回覆報價)$/.test(task.title));
  ok('同一行兩項日程只改日期：不出題、兩項維持 20 日、回饋兩項都寫明未有更新', !shared.revisedPack && sharedTasks.length === 2 && sharedTasks.every(task => task.dueAt === '2026-11-20')
    && ['寄出樣本', '回覆報價'].every(name => changesOf(shared.revisedInput || {}).some(change => change.includes('「' + name + '」') && /沒有自動更新/.test(change))), { pack: shared.revisedPack, tasks: sharedTasks, effects: changesOf(shared.revisedInput || {}) });

  // Sol 第七輪必修 2a：第二版只改字眼（日期相同）→ 寫明未有更新；第三版再改日期而 AI 不交回 → 仍出題（來源行已跟住前移）
  const wordText = movedText.replace('2026 年 11 月 27 日寄出樣本。', '2026 年 11 月 20 日寄出全部樣本。');
  const word = await revisedFollowUp('rev-word', 'event-revision-silent', baseText, wordText);
  const wordFirst = sampleTasks(word.W)[0] || {};
  ok('第二版只改字眼：沒有日期題，回饋寫明未有自動更新', !(word.revisedPack && word.revisedPack.questions.some(q => q.options.some(o => o.apply && o.apply.op === 'addFollowUp'))) && changesOf(word.revisedInput || {}).some(change => /「寄出樣本」.*沒有自動更新/.test(change)), changesOf(word.revisedInput || {}));
  if (word.revisedPack) answer(word.W, word.revisedPack);
  const word3 = nextVersion(word.W, word.revisedInput, 3, wordText, wordText.replace('2026 年 11 月 20 日寄出全部樣本。', '2026 年 11 月 30 日寄出全部樣本。'), 'event-revision-silent');
  const word3Qs = (word3.pack || {}).questions || [];
  ok('第三版改日期（第二版只改字眼）：出一條日期修訂題，對應原日程', word3Qs.filter(q => q.options.some(o => o.apply && o.apply.revisionOfTaskId === wordFirst.id)).length === 1 && /11 月 20 日改為 11 月 30 日/.test((word3Qs[0] || {}).ask || ''), { pack: word3Qs.map(q => q.ask), effects: changesOf(word3.input) });

  // Sol 第七輪必修 2b：第二版改日期但答「不更新」；第三版再改日期 → 仍出題
  const no2 = await revisedFollowUp('rev-no2', 'event-revision-silent', baseText, movedText);
  const no2First = sampleTasks(no2.W)[0] || {};
  if (no2.revisedPack) answer(no2.W, no2.revisedPack, q => ((q.options || []).find(o => !(o.apply && o.apply.op === 'addFollowUp')) || {}).text || q.value);
  const no3 = nextVersion(no2.W, no2.revisedInput, 3, movedText, movedText.replace('2026 年 11 月 27 日寄出樣本。', '2026 年 11 月 30 日寄出樣本。'), 'event-revision-silent');
  const no3Qs = (no3.pack || {}).questions || [];
  ok('第二版答「不更新」後第三版再改日期：仍出一條題，由 20 日改為 30 日', sampleTasks(no2.W)[0].dueAt === '2026-11-20' && no3Qs.filter(q => q.options.some(o => o.apply && o.apply.revisionOfTaskId === no2First.id)).length === 1 && /11 月 20 日改為 11 月 30 日/.test((no3Qs[0] || {}).ask || ''), { pack: no3Qs.map(q => q.ask), effects: changesOf(no3.input) });

  // Sol 第七輪必修 3：刪除已入帳事項的來源行 → 寫明未有更新；日程不變
  const del = await revisedFollowUp('rev-del', 'event-revision-silent', baseText, baseText.replace('首版', '修訂版').replace('- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n', ''));
  ok('刪除來源行：日程不變，回饋寫明內容已刪除及下一步沒有自動更新', sampleTasks(del.W).length === 1 && sampleTasks(del.W)[0].dueAt === '2026-11-20'
    && changesOf(del.revisedInput || {}).some(change => /「寄出樣本」.*已刪除/.test(change)) && changesOf(del.revisedInput || {}).some(change => /下一個對外動作.*沒有自動更新/.test(change)), { pack: del.revisedPack && del.revisedPack.questions.map(q => q.ask), effects: changesOf(del.revisedInput || {}) });

  // 建議：不存在的日子（2 月 30 日）不當作新日期，寫明未有更新
  const bad = await revisedFollowUp('rev-baddate', 'event-revision-silent', baseText, baseText.replace('首版', '修訂版').replace('2026 年 11 月 20 日寄出樣本。', '2026 年 2 月 30 日寄出樣本。'));
  ok('不存在的日子：不出日期題，日程不變，寫明未有更新', !(bad.revisedPack && bad.revisedPack.questions.some(q => /2 月 30 日|3 月 2 日/.test(q.ask || ''))) && sampleTasks(bad.W)[0].dueAt === '2026-11-20' && changesOf(bad.revisedInput || {}).some(change => /「寄出樣本」.*沒有自動更新/.test(change)), { pack: bad.revisedPack && bad.revisedPack.questions.map(q => q.ask), effects: changesOf(bad.revisedInput || {}) });
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
}

const pass = results.filter(result => result.pass).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
