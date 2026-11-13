// K1：人物改類別及角色寫入的純函數測試。不啟動伺服器，只寫指定輸出資料夾。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO_ARG, OUT_ARG] = process.argv.slice(2);
if (!PROTO_ARG || !OUT_ARG) throw new Error('用法：node people-kind-test.mjs <原型資料夾> <輸出資料夾>');
const PROTO = path.resolve(PROTO_ARG), OUT = path.resolve(OUT_ARG);
const { ROLE_MAX, applyActorOp, setActorRole } = await import(pathToFileURL(path.join(PROTO, 'people-ops.mjs')).href);

const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info))); };
const actor = more => ({ id: 'p-1', name: '陳嘉慧', label: '陳嘉慧', kind: 'advisor', aliases: [], status: 'active', ...more });
const stateOf = person => ({ company: { actors: [person] }, milestones: [], tasks: [] });

try {
  const base = stateOf(actor());
  const first = setActorRole(base, 'p-1', '營運及採購負責人', { basisDate: '2026-11-12', basisFrom: 'founder' });
  const firstActor = first.company.actors[0];
  ok('角色首次寫入會保存角色、依據及舊值紀錄', first !== base && firstActor.role === '營運及採購負責人' && firstActor.roleBasisDate === '2026-11-12' && firstActor.roleBasisFrom === 'founder' && firstActor.roleHistory.length === 1 && firstActor.roleHistory[0].oldRole === '' && firstActor.roleHistory[0].oldBasisDate === '' && firstActor.roleHistory[0].newBasisDate === '2026-11-12', firstActor);
  ok('原狀態不會被角色寫入改動', !('role' in base.company.actors[0]), base.company.actors[0]);

  const changed = setActorRole(first, 'p-1', '採購負責人', { basisDate: '2026-11-13', basisFrom: 'founder' });
  const changedActor = changed.company.actors[0];
  ok('角色變更會保留上一個角色及依據日期', changedActor.role === '採購負責人' && changedActor.roleHistory.length === 2 && changedActor.roleHistory[1].oldRole === '營運及採購負責人' && changedActor.roleHistory[1].oldBasisDate === '2026-11-12' && changedActor.roleHistory[1].newBasisDate === '2026-11-13', changedActor.roleHistory);

  const replay = setActorRole(changed, 'p-1', '採購負責人', { basisDate: '2026-11-14', basisFrom: 'founder' });
  ok('同值重播不重寫角色歷史', JSON.stringify(replay) === JSON.stringify(changed), replay.company.actors[0].roleHistory);

  const atLimit = setActorRole(base, 'p-1', '甲'.repeat(ROLE_MAX), { basisDate: '2026-11-12', basisFrom: 'founder' });
  const overLimit = setActorRole(base, 'p-1', '甲'.repeat(ROLE_MAX + 1), { basisDate: '2026-11-12', basisFrom: 'founder' });
  ok('角色最多 40 字，超出上限不寫入', atLimit.company.actors[0].role.length === ROLE_MAX && overLimit === base, { limit: ROLE_MAX, overLimitSameState: overLimit === base });

  const contact = setActorRole(base, 'p-1', 'contact@example.com', { basisDate: '2026-11-12', basisFrom: 'founder' });
  ok('角色含聯絡資料不寫入', contact === base, contact);

  const teamResult = applyActorOp(base, 'actorKind', { id: 'p-1', kind: 'team', role: '營運及採購負責人', teamType: 'fulltime', basisDate: '2026-11-12', basisFrom: 'founder' });
  const teamActor = teamResult.state.company.actors[0];
  ok('回歸 7：顧問改為團隊成員會有角色、依據及完整 team 結構', teamResult.ok && teamActor.kind === 'team' && teamActor.role === '營運及採購負責人' && teamActor.roleBasisDate === '2026-11-12' && teamActor.team && teamActor.team.type === 'fulltime' && teamActor.team.state === 'active' && Array.isArray(teamActor.team.owns) && teamActor.team.owns.length === 0, teamActor);

  const teamReplay = applyActorOp(teamResult.state, 'actorKind', { id: 'p-1', kind: 'team', role: '營運及採購負責人', teamType: 'fulltime', basisDate: '2026-11-12', basisFrom: 'founder' });
  ok('回歸 7：同一改類別請求重播不重複寫角色歷史', teamReplay.ok && teamReplay.state.company.actors[0].roleHistory.length === teamActor.roleHistory.length, teamReplay.state.company.actors[0].roleHistory);

  const owned = stateOf(actor({ kind: 'team', role: '營運及採購負責人', roleBasisDate: '2026-11-12', roleBasisFrom: 'founder', roleHistory: [{ oldRole: '', oldBasisDate: '', newBasisDate: '2026-11-12' }], team: { type: 'fulltime', state: 'active', owns: ['m-1', 't-1'] } }));
  const away = applyActorOp(owned, 'actorKind', { id: 'p-1', kind: 'advisor' });
  const back = applyActorOp(away.state, 'actorKind', { id: 'p-1', kind: 'team', role: '營運及採購負責人', teamType: 'fulltime', basisDate: '2026-11-12', basisFrom: 'founder' });
  const restored = back.state.company.actors[0];
  ok('回歸 8：成員改為顧問再改回會還原負責的站及工作', away.ok && away.state.company.actors[0].team.dormant === true && back.ok && restored.kind === 'team' && !('dormant' in restored.team) && JSON.stringify(restored.team.owns) === JSON.stringify(['m-1', 't-1']), restored);
} catch (error) {
  ok('測試程式本身沒有拋錯', false, String(error && error.stack || error));
}

const passed = results.filter(row => row.pass).length;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'people-kind-results.json'), JSON.stringify({ passed, total: results.length, results }, null, 2) + '\n', 'utf8');
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
