// 更新清單核對：拒絕越界或公司資料路徑，並在更新前停止。
// 用法：node update-manifest-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';

const [PROTO, outArg] = process.argv.slice(2);
const OUT = freshTestOut(outArg);
const rules = await import(pathToFileURL(path.join(PROTO, 'bundle-rules.mjs')).href);
const results = [];
const skipped = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tree = root => {
  const out = {};
  (function walk(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = rel ? `${rel}/${entry.name}` : entry.name, file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) out[item] = 'link:' + fs.readlinkSync(file); // 連結點只記指向，不跟隨
      else if (entry.isDirectory()) walk(file, item); else out[item] = sha(file);
    }
  })(root);
  return out;
};

for (const rel of ['../x', 'a/../b', 'a\\b', 'C:\\x', '/etc/x', 'C:x', '', 'data/x', 'Data/x', 'DEMO-DATA/x']) {
  ok(`拒絕清單項目：${rel || '空字串'}`, !!rules.manifestEntryProblem(rel, OUT));
}
for (const rel of ['server.mjs', 'adapters/hosts/agy.json', 'fixtures/demo-shop/a.json', '開始.cmd']) {
  ok(`接受正常清單項目：${rel}`, rules.manifestEntryProblem(rel, OUT) === '');
}

const SOURCE = path.join(OUT, 'source');
fs.cpSync(PROTO, SOURCE, { recursive: true });
const sourceFiles = rules.programFiles(SOURCE, [...rules.INSTALL_SKIP, 'MANIFEST.sha256']);
fs.writeFileSync(path.join(SOURCE, 'MANIFEST.sha256'), rules.manifestOf(SOURCE, sourceFiles).join('\n') + '\n');
const PROJECT = path.join(OUT, 'project'), TARGET = path.join(PROJECT, 'crewzero');
fs.mkdirSync(path.join(TARGET, 'Data'), { recursive: true });
fs.writeFileSync(path.join(TARGET, 'ask.mjs'), 'export {};\n');
fs.writeFileSync(path.join(TARGET, 'VERSION'), '0.0.0\n');
fs.writeFileSync(path.join(TARGET, 'Data', 'keep.json'), '{"keep":true}\n');
fs.writeFileSync(path.join(TARGET, 'untouched.txt'), '安裝內其他檔\n');
fs.writeFileSync(path.join(PROJECT, 'outside.txt'), '安裝資料夾外的檔\n');
const zero = '0'.repeat(64);
fs.writeFileSync(path.join(TARGET, 'MANIFEST.sha256'), `${zero}  ../outside.txt\n${zero}  Data/keep.json\n`);
const backup = path.join(TARGET, '.backup-0.0.0');
fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'ask.mjs'), 'export {};\n');
const beforeTarget = tree(TARGET), beforeOutside = sha(path.join(PROJECT, 'outside.txt'));
const runUpdate = args => spawnSync(process.execPath, [path.join(SOURCE, 'update.mjs'), PROJECT, ...args], { encoding: 'utf8', timeout: 30000 });
const updateChild = runUpdate(['--apply']), rollbackChild = runUpdate(['--rollback', '--apply']);
if ([updateChild, rollbackChild].some(child => child.error && ['EPERM', 'EACCES'].includes(child.error.code))) {
  skipped.push(`子程序受沙盒限制而略過：${[updateChild, rollbackChild].find(child => child.error)?.error?.code || '未知原因'}`);
} else {
  const unchanged = JSON.stringify(tree(TARGET)) === JSON.stringify(beforeTarget) && sha(path.join(PROJECT, 'outside.txt')) === beforeOutside;
  ok('損壞清單令更新以非零停止，資料、外部檔及安裝檔均原封不動', updateChild.status !== 0 && /更新已停止：安裝資料夾內的程式清單內容不符/.test(updateChild.stdout) && unchanged, { status: updateChild.status, stdout: updateChild.stdout, stderr: updateChild.stderr });
  ok('損壞清單令還原以非零停止，資料、外部檔及安裝檔均原封不動', rollbackChild.status !== 0 && /更新已停止：安裝資料夾內的程式清單內容不符/.test(rollbackChild.stdout) && unchanged, { status: rollbackChild.status, stdout: rollbackChild.stdout, stderr: rollbackChild.stderr });
}

// 獨立審閱第一輪的兩個反例（主會話收貨標準）：每個反例各用一個假安裝，清單只有該一項，確保真正驗到該項
for (const [name, line, setup] of [
  ['../outside.txt', '../outside.txt', (target, project) => { fs.writeFileSync(path.join(project, 'outside.txt'), '安裝資料夾外的檔\n'); }],
  ['Data/keep.json', 'Data/keep.json', target => { fs.mkdirSync(path.join(target, 'Data'), { recursive: true }); fs.writeFileSync(path.join(target, 'Data', 'keep.json'), '{"keep":true}\n'); }],
  ['./data/keep.json', './data/keep.json', target => { fs.mkdirSync(path.join(target, 'data'), { recursive: true }); fs.writeFileSync(path.join(target, 'data', 'keep.json'), '{"keep":true}\n'); }],
  ['連結點指向安裝資料夾外', 'linked/keep.txt', (target, project) => { const outside = path.join(project, 'outside-dir'); fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'keep.txt'), '安裝資料夾外的檔\n'); fs.symlinkSync(outside, path.join(target, 'linked'), 'junction'); }]
]) {
  const project = path.join(OUT, 'case-' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 8)), target = path.join(project, 'crewzero');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'ask.mjs'), 'export {};\n');
  fs.writeFileSync(path.join(target, 'VERSION'), '0.0.0\n');
  setup(target, project);
  fs.writeFileSync(path.join(target, 'MANIFEST.sha256'), `${zero}  ${line}\n`);
  fs.mkdirSync(path.join(target, '.backup-0.0.0')); fs.writeFileSync(path.join(target, '.backup-0.0.0', 'ask.mjs'), 'export {};\n');
  const before = JSON.stringify(tree(project));
  const run = args => spawnSync(process.execPath, [path.join(SOURCE, 'update.mjs'), project, ...args], { encoding: 'utf8', timeout: 30000 });
  const up = run(['--apply']), back = run(['--rollback', '--apply']);
  if ([up, back].some(child => child.error && ['EPERM', 'EACCES'].includes(child.error.code))) { skipped.push(`${name}：子程序受沙盒限制而略過`); continue; }
  const same = JSON.stringify(tree(project)) === before;
  ok(`實跑：清單項目「${name}」令更新及還原都以非零停止，所有檔案雜湊不變`, up.status !== 0 && back.status !== 0 && /更新已停止：安裝資料夾內的程式清單內容不符/.test(up.stdout) && /更新已停止：安裝資料夾內的程式清單內容不符/.test(back.stdout) && same, { up: up.status, back: back.status, same, stdout: up.stdout.slice(0, 300) });
  const link = path.join(target, 'linked');
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmdirSync(link); // 只解除連結點本身，不跟隨
}

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${JSON.stringify(result.detail)}`}`);
for (const reason of skipped) console.log(`SKIP ${reason}`);
console.log(`\n${passed}/${results.length} 通過${skipped.length ? `（${skipped.length} 項略過）` : ''}`);
process.exit(passed === results.length ? 0 : 1);
