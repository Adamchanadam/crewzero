// startup-os 安裝命令（MVP 規格 2026-10-29 第 2 節第 1 項；規劃書附錄 B `sos install` 嘅最小版）
// 用法：node install.mjs <項目根>
// 將呢個程式資料夾複製去 <項目根>/startup-os/（排除清單見 bundle-rules.mjs），建空 data/，寫 VERSION、START-HERE.md、排程啟動檔。
// 目標已經有 startup-os/ 就拒絕，一個檔都唔改（結束碼 2）；裝咗嘅版本舊過插件就指去更新命令（update.mjs）。排程登記另外一步（adapters/scheduler/install-schedule.mjs --register），要創辦人批准。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { programFiles, pluginVersion, INSTALL_SKIP, compareVersions, writeGenerated } from './bundle-rules.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const say = s => console.log('[startup-os] ' + s);
const arg = process.argv[2];
if (!arg) { say('用法：node install.mjs <項目根>'); process.exit(1); }
const proj = path.resolve(arg);
let isDir = false; try { isDir = fs.statSync(proj).isDirectory(); } catch { }
if (!isDir) { say('找不到項目資料夾：' + proj); process.exit(1); }
const target = path.join(proj, 'startup-os');
if (fs.existsSync(target)) {
  let v = ''; try { v = fs.readFileSync(path.join(target, 'VERSION'), 'utf8').trim(); } catch { }
  const nv = pluginVersion(ROOT), older = compareVersions(v, nv) < 0;
  say(`已安裝：${target}${v ? '（版本 ' + v + '）' : ''}。今次沒有改動任何檔案。${older ? '插件已有新版本 ' + nv + '，要更新程式請在對話輸入 /startup-os:update。' : '要登記或移除排程，請在對話輸入「安裝排程」或「移除排程」。'}`);
  process.exit(2);
}
if (path.resolve(ROOT).toLowerCase().startsWith(path.resolve(target).toLowerCase() + path.sep)) { say('不可以裝入程式自己的資料夾'); process.exit(1); }

const version = pluginVersion(ROOT);
const files = programFiles(ROOT, INSTALL_SKIP);
// 先複製去臨時資料夾，全部成功先改名做 startup-os/；失敗就清走臨時資料夾，唔留半套
const tmp = path.join(proj, `.startup-os-installing-${process.pid}`);
try {
  for (const f of files) {
    const dst = path.join(tmp, ...f.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...f.split('/')), dst);
  }
  fs.mkdirSync(path.join(tmp, 'data'));
  fs.writeFileSync(path.join(tmp, 'VERSION'), (version || '0.0.0') + '\n');
  const d = new Date(), date = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  fs.writeFileSync(path.join(tmp, 'START-HERE.md'), fs.readFileSync(path.join(ROOT, 'start-here-template.md'), 'utf8').replace('{version}', version || '未知').replace('{date}', date));
  // 排程啟動檔：絕對路徑叫執行環境同同一資料夾嘅 run.mjs，唔靠環境變數，避開排程器命令長度上限
  const node = process.execPath, run = path.join(target, 'run.mjs');
  fs.writeFileSync(path.join(tmp, 'run-schedule.cmd'), ['@echo off', 'chcp 65001 >nul', `cd /d "${target}"`, `"${node}" "${run}" --type auto --trigger schedule`, ''].join('\r\n'));
  if (process.platform !== 'win32') { fs.writeFileSync(path.join(tmp, 'run-schedule.sh'), `#!/bin/sh\ncd "${target}" && exec "${node}" "${run}" --type auto --trigger schedule\n`); fs.chmodSync(path.join(tmp, 'run-schedule.sh'), 0o755); }
  fs.renameSync(tmp, target);
} catch (e) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  say('安裝未完成，已清走半套檔案：' + (e && e.message || e));
  process.exit(1);
}
say(`已安裝 startup-os ${version || ''}：${target}（${files.length} 個程式檔；空的 data/；VERSION；START-HERE.md；排程啟動檔）。`);
say('沒有改動項目的其他檔案。建議把 startup-os/data/ 排除在版本控制之外。');
say('下一步：登記每日排程（要你批准），然後打開 Founder Desk 設定 AI。');
