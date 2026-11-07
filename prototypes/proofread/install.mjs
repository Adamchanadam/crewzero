// CrewZero 安裝命令（MVP 規格 2026-10-29 第 2 節第 1 項；規劃書附錄 B `sos install` 嘅最小版）
// 用法：node install.mjs <項目根>
// 將呢個程式資料夾複製去 <項目根>/crewzero/（排除清單見 bundle-rules.mjs），建空 data/，寫 VERSION、START-HERE.md、相容排程啟動檔同登入啟動檔。
// 目標已經有 crewzero/，或者有改名前裝嘅舊版 startup-os/，就拒絕，一個檔都唔改（結束碼 2）；舊版資料夾一律指去更新命令（update.mjs 會喺 startup-os/ 原位更新），唔另建 crewzero/。
// 排程登記另外一步（adapters/scheduler/install-schedule.mjs --register），要創辦人批准。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { programFiles, pluginVersion, INSTALL_SKIP, compareVersions, writeGenerated, INSTALL_DIR, LEGACY_INSTALL_DIR, findInstall } from './bundle-rules.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const say = s => console.log('[CrewZero] ' + s);
const UPDATE_CMD = 'Claude Code：/crewzero:update；Codex：$crewzero:update；Antigravity：/update';
const arg = process.argv[2];
if (!arg) { say('用法：node install.mjs <項目根>'); process.exit(1); }
const proj = path.resolve(arg);
let isDir = false; try { isDir = fs.statSync(proj).isDirectory(); } catch { }
if (!isDir) { say('找不到項目資料夾：' + proj); process.exit(1); }
const existing = findInstall(proj, '');
if (existing) {
  let v = ''; try { v = fs.readFileSync(path.join(existing, 'VERSION'), 'utf8').trim(); } catch { }
  const nv = pluginVersion(ROOT), older = compareVersions(v, nv) < 0;
  if (path.basename(existing) === LEGACY_INSTALL_DIR) {
    say(`這個項目已有舊版安裝：${existing}${v ? '（版本 ' + v + '）' : ''}。CrewZero 會沿用這個資料夾，不會另建 ${INSTALL_DIR}/；今次沒有改動任何檔案。要換成新版程式，請在對話輸入更新指令（${UPDATE_CMD}），公司資料不會改動。`);
    process.exit(2);
  }
  say(`已安裝：${existing}${v ? '（版本 ' + v + '）' : ''}。今次沒有改動任何檔案。${older ? '插件已有新版本 ' + nv + '，要更新程式請在對話輸入更新指令（' + UPDATE_CMD + '）。' : '要登記或移除排程，請在對話輸入「安裝排程」或「移除排程」。'}`);
  process.exit(2);
}
const target = path.join(proj, INSTALL_DIR);
if (path.resolve(ROOT).toLowerCase().startsWith(path.resolve(target).toLowerCase() + path.sep)) { say('不可以裝入程式自己的資料夾'); process.exit(1); }

const version = pluginVersion(ROOT);
const files = programFiles(ROOT, INSTALL_SKIP);
// 先複製去臨時資料夾，全部成功先改名做 crewzero/；失敗就清走臨時資料夾，唔留半套（臨時資料夾名沿用舊前綴）
const tmp = path.join(proj, `.startup-os-installing-${process.pid}`);
try {
  for (const f of files) {
    const dst = path.join(tmp, ...f.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...f.split('/')), dst);
  }
  fs.mkdirSync(path.join(tmp, 'data'));
  // VERSION、START-HERE.md、相容排程啟動檔同登入啟動檔（同更新命令共用同一個生成函數；全部用最終位置嘅絕對路徑）
  writeGenerated(tmp, target, ROOT, version);
  fs.renameSync(tmp, target);
} catch (e) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  // 創辦人會經 AI 聽到呢句：只講原因同做法；錯誤原文（英文、路徑）只寫去 stderr 供 AI 排查
  const c = e && e.code;
  const cause = c === 'EPERM' || c === 'EBUSY' || c === 'EACCES' ? '部分檔案正被其他程式使用，或這個資料夾不准寫入。請關閉正在開啟這個資料夾的程式，再安裝一次。'
    : c === 'ENOSPC' ? '電腦的儲存空間不足。請騰出空間後，再安裝一次。' : '電腦未能完成寫入檔案。請重新開機後，再安裝一次。';
  say('安裝未完成，項目沒有任何改動。原因：' + cause);
  console.error('（技術細節，只供 AI 排查，毋須交給創辦人）' + (e && e.message || e));
  process.exit(1);
}
say('CrewZero 已安裝完成，其他資料沒有改動。');
say('下一步可登記每日排程，再設定 AI 工具。');
say('以後在 AI 對話說「打開 CrewZero」，便可再次打開；想先和 Zero 討論，說「和 Zero 討論」。');
