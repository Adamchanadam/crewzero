import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertTestOut, freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';

const [PROTO, OUT] = process.argv.slice(2);
if (!PROTO || !OUT) throw new Error('用法：node out-guard-test.mjs <原型資料夾> <輸出資料夾>');
freshTestOut(OUT);

const results = [];
const check = (name, pass, info = '') => {
  results.push({ name, pass, info });
  if (!pass) console.error(`FAIL ${name}${info ? `：${info}` : ''}`);
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const marker = dir => path.join(dir, '.cz-test-tmp');
const rawTemp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const expectReject = (name, action) => {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  check(name, rejected);
};
const restore = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};
const withTempRoot = (root, action) => {
  const oldTemp = process.env.TEMP;
  const oldTmp = process.env.TMP;
  try {
    process.env.TEMP = root;
    process.env.TMP = root;
    action();
  } finally {
    restore('TEMP', oldTemp);
    restore('TMP', oldTmp);
  }
};

const root = makeTestTemp('cz-out-guard-test-');
let junction = '';
try {
  // 甲：有內容但沒有標記的暫存資料夾不可被清除。
  const alpha = rawTemp('cz-out-guard-alpha-');
  const alphaFile = path.join(alpha, 'keep.txt');
  fs.writeFileSync(alphaFile, '不可清除');
  const alphaHash = hash(alphaFile);
  expectReject('甲：非空且沒有標記會拒絕', () => assertTestOut(alpha));
  check('甲：拒絕後檔案不變', hash(alphaFile) === alphaHash);

  // 乙：仿真資料結構同樣不可被清除。
  const beta = rawTemp('cz-out-guard-data-');
  const state = path.join(beta, 'ledger', 'state.json');
  const ask = path.join(beta, 'asks', 'a.md');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.mkdirSync(path.dirname(ask), { recursive: true });
  fs.writeFileSync(state, '{"state":"keep"}');
  fs.writeFileSync(ask, '保留問題');
  const betaHashes = [hash(state), hash(ask)];
  expectReject('乙：仿 data 資料夾會拒絕 assertTestOut', () => assertTestOut(beta));
  expectReject('乙：仿 data 資料夾會拒絕 freshTestOut', () => freshTestOut(beta));
  check('乙：拒絕後仿 data 檔案不變', hash(state) === betaHashes[0] && hash(ask) === betaHashes[1]);

  // 丙、丁：系統暫存以外、暫存根本身及磁碟根都不可作輸出。
  expectReject('丙：原型 data 資料夾會拒絕', () => assertTestOut(path.join(PROTO, 'data')));
  expectReject('丙：原型根目錄會拒絕', () => assertTestOut(PROTO));
  expectReject('丙：磁碟根目錄會拒絕', () => assertTestOut(path.parse(path.resolve(PROTO)).root));
  expectReject('丁：系統暫存根目錄會拒絕', () => assertTestOut(os.tmpdir()));

  // 戊：環境把暫存根改成過大位置時，也必須拒絕。
  withTempRoot(path.parse(path.resolve(PROTO)).root, () => {
    expectReject('戊：暫存根是磁碟根目錄會拒絕', () => assertTestOut(path.join(os.tmpdir(), 'cz-unsafe-root')));
  });
  withTempRoot(os.homedir(), () => {
    expectReject('戊：暫存根是使用者家目錄會拒絕', () => assertTestOut(path.join(os.tmpdir(), 'cz-unsafe-home')));
  });

  // 己：就算位置在暫存內，任何 .git 邊界都不可越過。
  const gitParent = path.join(root, 'git-parent');
  const gitTarget = path.join(gitParent, 'child');
  fs.mkdirSync(path.join(gitParent, '.git'), { recursive: true });
  fs.mkdirSync(gitTarget);
  expectReject('己：上層含 .git 會拒絕', () => assertTestOut(gitTarget));

  // 庚：junction 指向暫存外時不可通過；清理時只解除 junction 自身。
  junction = path.join(root, 'outside-junction');
  try {
    fs.symlinkSync(PROTO, junction, 'junction');
    expectReject('庚：指向暫存外的 junction 會拒絕', () => assertTestOut(junction));
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      console.log(`略過庚：無權建立 junction（${error.code}）`);
    } else {
      throw error;
    }
  } finally {
    if (junction && fs.existsSync(junction)) fs.rmdirSync(junction);
    junction = '';
  }

  // 辛：可清除的三種狀態及新建暫存資料夾都會有標記。
  const empty = rawTemp('cz-out-guard-empty-');
  check('辛：空資料夾通過', assertTestOut(empty) === path.resolve(empty));
  const missing = path.join(root, 'missing-output');
  check('辛：不存在的資料夾通過', assertTestOut(missing) === path.resolve(missing));
  freshTestOut(missing);
  check('辛：freshTestOut 後有標記', fs.existsSync(marker(missing)));
  const marked = rawTemp('cz-out-guard-marked-');
  fs.writeFileSync(marker(marked), 'CrewZero test temporary output\n');
  check('辛：已有標記的資料夾通過', assertTestOut(marked) === path.resolve(marked));
  freshTestOut(marked);
  check('辛：已有標記資料夾清新後仍有標記', fs.existsSync(marker(marked)));
  const generated = makeTestTemp('cz-out-guard-made-');
  check('辛：makeTestTemp 即時寫入標記', fs.existsSync(marker(generated)));

  // 壬：真實已接線測試收到甲的資料夾時，必須拒絕而不改資料。
  const moneyTest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'money-lib-test.mjs');
  const beforeChild = hash(alphaFile);
  const child = spawnSync(process.execPath, [moneyTest, PROTO, alpha], { encoding: 'utf8', windowsHide: true });
  if (child.error && (child.error.code === 'EPERM' || child.error.code === 'EACCES')) {
    console.log(`略過壬：沙盒不准開子程序（${child.error.code}）`);
  } else {
    check('壬：真實測試拒絕未標記輸出資料夾', child.status !== 0, `退出碼 ${child.status}`);
    check('壬：真實測試拒絕後甲檔案不變', hash(alphaFile) === beforeChild);
  }
} catch (error) {
  check('守門測試執行', false, String(error?.stack || error));
} finally {
  if (junction && fs.existsSync(junction)) fs.rmdirSync(junction);
  assertTestOut(root);
  fs.rmSync(root, { recursive: true, force: true });
}

const passed = results.filter(result => result.pass).length;
console.log(`${passed}/${results.length} 通過`);
if (passed !== results.length) process.exitCode = 1;
