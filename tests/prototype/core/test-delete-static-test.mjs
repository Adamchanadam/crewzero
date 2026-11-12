import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const exemptions = [
  { file: 'run-all.mjs', reason: '總測試輸出只委派 lib/test-output.mjs 的 safeRemove，逐層核對範圍及標記後才清理。' },
  { file: 'lib/test-output.mjs', reason: 'safeRemove 在遞迴清理前逐層核對邊界及標記，刪除對象不可能是測試以外的位置。' },
  { file: 'lib/out-guard.mjs', reason: '唯一守門實作；freshTestOut 只會刪除剛由 assertTestOut 核對的暫存資料夾。' },
  { file: 'core/test-delete-static-test.mjs', reason: '本檢查以文字樣本驗證偵測規則，不執行樣本內的刪除呼叫。' },
  { file: 'fixtures/v0400-inputs.mjs', reason: '舊版固定樣本，不會作為測試程式執行。' },
  { file: 'fixtures/legacy-0.32/demo-seed.mjs', reason: '舊版固定樣本，不會作為測試程式執行。' },
  { file: 'fixtures/legacy-0.32/update.mjs', reason: '舊版固定樣本，不會作為測試程式執行。' },
  { file: 'fixtures/legacy-0.32/install.mjs', reason: '舊版固定樣本，不會作為測試程式執行。' },
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const matchingParen = (text, open) => {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
};

const secondArgument = (body) => {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if ('([{'.includes(char)) {
      depth += 1;
    } else if (')]}'.includes(char)) {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      return body.slice(i + 1).trim();
    }
  }
  return null;
};

const recursiveCall = second => {
  if (second === null) return false;
  if (!second.startsWith('{')) return true;
  return /\brecursive\s*:/.test(second);
};

export const scanText = (text) => {
  const found = [];
  const calls = /\b(?:fs\.)?rmSync\s*\(|\bfs\.rm\s*\(|\b(?:fs\.)?promises\.rm\s*\(|\brmdirSync\s*\(/g;
  for (let match; (match = calls.exec(text)); ) {
    const open = text.indexOf('(', match.index);
    const close = matchingParen(text, open);
    const second = secondArgument(text.slice(open + 1, close));
    if (recursiveCall(second)) found.push({ line: lineOf(text, match.index), kind: match[0].trim() });
    calls.lastIndex = close + 1;
  }

  const shellPatterns = [
    [/\brimraf(?:\.sync)?\s*\(/g, 'rimraf'],
    [/\brm\s+-r(?:f)?\b/gi, 'rm -r'],
    [/\bRemove-Item\b[^\r\n;]*(?:\s-Recurse\b)/gi, 'Remove-Item -Recurse'],
    [/\b(?:rmdir|rd)\s+\/s\b/gi, 'rmdir /s'],
  ];
  for (const [pattern, kind] of shellPatterns) {
    for (let match; (match = pattern.exec(text)); ) {
      found.push({ line: lineOf(text, match.index), kind });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
};

const walk = directory => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (/\.(?:mjs|js|cjs|ps1|cmd|bat|sh)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
};

const guardWired = text => /from\s+['"][^'"]*out-guard\.mjs['"]/.test(text)
  && /\b(?:assertTestOut|freshTestOut|makeTestTemp)\s*\(/.test(text);

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const expectScan = (name, text, expected) => {
  const actual = scanText(text);
  check(name, JSON.stringify(actual.map(item => item.kind)) === JSON.stringify(expected), JSON.stringify(actual));
};

expectScan('rmSync 遞迴', 'fs.rmSync(out, { recursive: true });', ['fs.rmSync(']);
expectScan('rmSync 跨行遞迴', 'fs.rmSync(\n  out,\n  { recursive: true }\n);', ['fs.rmSync(']);
expectScan('fs.rm 變數選項', 'fs.rm(out, options);', ['fs.rm(']);
expectScan('promises.rm 遞迴', 'promises.rm(out, { recursive: true });', ['promises.rm(']);
expectScan('fs.promises.rm 變數選項', 'fs.promises.rm(out, options);', ['fs.promises.rm(']);
expectScan('rmdirSync 遞迴', 'rmdirSync(out, { recursive: true });', ['rmdirSync(']);
expectScan('rimraf', 'rimraf(out);', ['rimraf']);
expectScan('rm -rf', 'execSync("rm -rf output");', ['rm -r']);
expectScan('rm -r', 'execSync("rm -r output");', ['rm -r']);
expectScan('Remove-Item -Recurse', 'Remove-Item $out -Force -Recurse', ['Remove-Item -Recurse']);
expectScan('rmdir /s', 'rmdir /s /q output', ['rmdir /s']);
expectScan('rd /s', 'rd /s /q output', ['rmdir /s']);
expectScan('單檔刪除', 'fs.rmSync(file); fs.rmSync(file, { force: true });', []);

const exemptionMap = new Map(exemptions.map(item => [item.file, item]));
const safeRemoveExemptions = new Set(['run-all.mjs', 'lib/test-output.mjs']);
for (const file of walk(ROOT)) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8');
  const deletions = scanText(text);
  const exempt = exemptionMap.get(relative);
  if (exempt) {
    if (safeRemoveExemptions.has(relative)) {
      check(`豁免仍使用 safeRemove：${relative}`, /\bsafeRemove\s*\(/.test(text), exempt.reason);
    } else {
      check(`豁免仍有遞迴刪除：${relative}`, deletions.length > 0, exempt.reason);
    }
  } else if (deletions.length > 0) {
    check(`守門接線：${relative}`, guardWired(text), deletions.map(item => `第 ${item.line} 行 ${item.kind}`).join('；'));
  }
}

for (const result of results) {
  if (!result.pass) console.error(`FAIL ${result.name}${result.detail ? `：${result.detail}` : ''}`);
}
const passed = results.filter(result => result.pass).length;
console.log(`${passed}/${results.length} 通過`);
if (passed !== results.length) process.exitCode = 1;
