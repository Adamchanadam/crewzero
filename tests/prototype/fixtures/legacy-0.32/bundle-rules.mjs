// 程式檔清單（MVP 規格 2026-10-29 第 2 節第 1、6 項）：安裝（install.mjs）同插件打包（build-plugin.mjs）共用同一張排除清單。
// 次序：先排除插件資料夾本身同市集資訊資料夾（避免將插件複製入插件），再排除資料、示範、設計稿、截圖、交接筆記。
// fixtures/ 唔排除：交資料、情景演練、紅藍對打、示範種子都要讀入面嘅虛構範本（「從田間到餐桌」），排除咗交資料會失敗。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const EXCLUDE_PATHS = ['adapters/claude-code/startup-os', 'adapters/claude-code/.claude-plugin'];
export const EXCLUDE_TOP = ['data', 'demo-data', 'mockups', 'screenshots', 'PROTOTYPE-HANDOFF.md', 'node_modules', '.git'];
// 安裝時另外唔帶嘅開發用檔（安裝後由安裝命令自己生成或者用唔着）
export const INSTALL_SKIP = ['VERSION', 'START-HERE.md', 'run-schedule.cmd', 'run-schedule.sh', '開始.cmd', 'start-here-template.md'];

// 列出程式檔（相對路徑，用「/」分隔，按字母排）
export function programFiles(root, extraSkip = []) {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (EXCLUDE_PATHS.includes(r)) continue;
      if (!rel && (EXCLUDE_TOP.includes(e.name) || extraSkip.includes(e.name))) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, r); else if (e.isFile()) out.push(r);
    }
  })(root, '');
  return out.sort();
}

// 版本號：插件資訊檔（喺插件入面行：program/../.claude-plugin；喺原型行：adapters/claude-code/startup-os/.claude-plugin）
export function pluginVersion(root) {
  for (const f of [path.join(root, '..', '.claude-plugin', 'plugin.json'), path.join(root, 'adapters', 'claude-code', 'startup-os', '.claude-plugin', 'plugin.json'), path.join(root, 'VERSION')]) {
    try {
      const t = fs.readFileSync(f, 'utf8');
      const v = f.endsWith('.json') ? JSON.parse(t).version : t.trim();
      if (/^\d+\.\d+\.\d+$/.test(String(v))) return String(v);
    } catch { }
  }
  return '';
}

// 版本比較（安裝同更新共用）：三節數字逐節比，a 新過 b 回 1、舊過回 -1、一樣回 0；唔似版本號當 0.0.0
export function compareVersions(a, b) {
  const n = v => (/^\d+\.\d+\.\d+$/.test(String(v || '').trim()) ? String(v).trim() : '0.0.0').split('.').map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

// 安裝／更新時由命令自己生成嘅檔（唔計入程式檔清單；更新時重新生成，保持同一套絕對路徑）
export const GENERATED = ['VERSION', 'START-HERE.md', 'run-schedule.cmd', 'run-schedule.sh', 'MANIFEST.sha256'];

// 寫生成檔去 dir（安裝時係臨時資料夾，更新時係暫存資料夾）；target 係最終嘅 startup-os/ 絕對路徑（排程啟動檔要寫入去）
export function writeGenerated(dir, target, root, version) {
  fs.writeFileSync(path.join(dir, 'VERSION'), (version || '0.0.0') + '\n');
  const d = new Date(), date = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  fs.writeFileSync(path.join(dir, 'START-HERE.md'), fs.readFileSync(path.join(root, 'start-here-template.md'), 'utf8').replace('{version}', version || '未知').replace('{date}', date));
  // 排程啟動檔：絕對路徑叫執行環境同同一資料夾嘅 run.mjs，唔靠環境變數，避開排程器命令長度上限
  const node = process.execPath, run = path.join(target, 'run.mjs');
  fs.writeFileSync(path.join(dir, 'run-schedule.cmd'), ['@echo off', 'chcp 65001 >nul', `cd /d "${target}"`, `"${node}" "${run}" --type auto --trigger schedule`, ''].join('\r\n'));
  if (process.platform !== 'win32') { fs.writeFileSync(path.join(dir, 'run-schedule.sh'), `#!/bin/sh\ncd "${target}" && exec "${node}" "${run}" --type auto --trigger schedule\n`); fs.chmodSync(path.join(dir, 'run-schedule.sh'), 0o755); }
}

// 檔案雜湊清單（同 build-plugin.mjs 嘅 MANIFEST.sha256 同一格式：「<sha256>  <相對路徑>」每行一個）
export function manifestOf(root, files) {
  return files.map(f => sha256(fs.readFileSync(path.join(root, ...f.split('/')))) + '  ' + f);
}
export function parseManifest(text) {
  const out = {};
  for (const l of String(text || '').trim().split(/\r?\n/)) { const m = l.match(/^([a-f0-9]{64})  (.+)$/); if (m) out[m[2]] = m[1]; }
  return out;
}
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
