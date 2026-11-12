import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = '.cz-test-tmp';
const registered = new Set();

const refuse = (target, reason) => {
  throw new Error(`拒絕清除：${target}（${reason}）`);
};

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const isDiskRoot = target => samePath(target, path.parse(target).root);

const safeTmpRoot = () => {
  let tmp;
  try {
    tmp = fs.realpathSync(os.tmpdir());
  } catch {
    refuse(String(os.tmpdir()), '系統暫存資料夾無法解析');
  }

  let home;
  try {
    home = fs.realpathSync(os.homedir());
  } catch {
    home = path.resolve(os.homedir());
  }
  if (isDiskRoot(tmp)) refuse(tmp, '系統暫存資料夾不可是磁碟根目錄');
  if (samePath(tmp, home)) refuse(tmp, '系統暫存資料夾不可是使用者家目錄');
  return tmp;
};

const hasGitBoundary = target => {
  let cursor = target;
  while (true) {
    if (fs.existsSync(path.join(cursor, '.git'))) return true;
    const parent = path.dirname(cursor);
    if (samePath(parent, cursor)) return false;
    cursor = parent;
  }
};

const realPathFor = (target) => {
  const missing = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (samePath(parent, cursor)) return null;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(fs.realpathSync(cursor), ...missing);
};

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const markOnExit = (target) => {
  if (registered.has(target)) return;
  registered.add(target);
  process.on('exit', () => {
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        fs.writeFileSync(path.join(target, MARKER), 'CrewZero test temporary output\n');
      }
    } catch {
      // 結束時不可遮蓋原本的測試結果。
    }
  });
};

export const assertTestOut = (dir) => {
  let target;
  try {
    target = path.resolve(dir);
  } catch {
    refuse(String(dir), '路徑無效');
  }

  const tmp = safeTmpRoot();
  const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
  if (stat?.isSymbolicLink()) refuse(target, '不可使用連結或 junction');
  if (stat && !stat.isDirectory()) refuse(target, '不是資料夾');

  const actual = realPathFor(target);
  if (!actual || !isInside(tmp, actual)) refuse(target, '不在系統暫存資料夾內');
  if (hasGitBoundary(target) || hasGitBoundary(actual)) refuse(target, '目標或上層資料夾含有 .git');
  if (stat && fs.readdirSync(target).length !== 0 && !fs.existsSync(path.join(target, MARKER))) {
    refuse(target, `資料夾非空且沒有 ${MARKER} 標記`);
  }

  markOnExit(target);
  return target;
};

export const freshTestOut = (dir) => {
  const target = assertTestOut(dir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, MARKER), 'CrewZero test temporary output\n');
  return target;
};

export const makeTestTemp = (prefix) => {
  const tmp = safeTmpRoot();
  if (hasGitBoundary(tmp)) refuse(tmp, '系統暫存資料夾或上層資料夾含有 .git');
  const target = fs.mkdtempSync(path.join(tmp, prefix));
  fs.writeFileSync(path.join(target, MARKER), 'CrewZero test temporary output\n');
  return target;
};
