// 程式隨插件附帶（MVP 規格 2026-10-29 第 2 節第 6 項）：將原型程式複製去插件資料夾入面嘅 program/，寫 program/MANIFEST.sha256。
// 原型仍然係唯一來源，program/ 只係生成物：每次換入正式版嘅最後一步重跑一次。排除清單同安裝命令共用（bundle-rules.mjs）。
// 用法：node adapters/claude-code/build-plugin.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'crewzero', 'program');
const { programFiles, pluginVersion } = await import(new URL('../../bundle-rules.mjs', import.meta.url).href);

// 生成物：先清走舊嘅 program/（只限呢個資料夾）
if (path.basename(OUT) !== 'program' || !OUT.startsWith(path.join(HERE, 'crewzero'))) throw new Error('輸出位置不正確');
fs.rmSync(OUT, { recursive: true, force: true });
const files = programFiles(PROTO);
const lines = [];
for (const f of files) {
  const src = path.join(PROTO, ...f.split('/')), dst = path.join(OUT, ...f.split('/'));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const buf = fs.readFileSync(src);
  fs.writeFileSync(dst, buf);
  lines.push(crypto.createHash('sha256').update(buf).digest('hex') + '  ' + f);
}
fs.writeFileSync(path.join(OUT, 'MANIFEST.sha256'), lines.join('\n') + '\n');
console.log(`已生成 program/：${files.length} 個程式檔，版本 ${pluginVersion(PROTO) || '未知'}；清單 program/MANIFEST.sha256`);
