// 模型測試用工具；只讀隔離資料夾嘅合成控制檔，絕不開真 AI。
import fs from 'node:fs';
import path from 'node:path';
const data = process.env.SOS_DATA || path.resolve(process.cwd(), '..', '..');
let control = {}; try { control = JSON.parse(fs.readFileSync(path.join(data, 'model-tool.json'), 'utf8')); } catch { }
if (process.argv.includes('--version')) {
  console.log(control.version || 'fake-model 1.0');
  process.exit(0);
}
if (process.argv.includes('models')) {
  fs.appendFileSync(path.join(data, 'model-probes.log'), 'probe\n');
  if (control.probeFail) process.exit(1);
  for (const m of control.models || ['preferred', 'backup']) console.log(m + ' Available');
  process.exit(0);
}
const model = process.argv[process.argv.indexOf('--model') + 1];
fs.appendFileSync(path.join(data, 'model-tool-starts.log'), model + '\n');
if (control.delayMs) await new Promise(r => setTimeout(r, control.delayMs));
if (control.failAll || (control.failModels || []).includes(model)) {
  if (control.writeOnFailure) { fs.mkdirSync('out/nested', { recursive: true }); fs.writeFileSync('out/nested/partial.txt', 'partial'); }
  console.error('Model unavailable'); process.exit(1);
}
if (process.argv.includes('--model-task')) {
  const meta = control.meta || { modelUsage: { [control.actual || 'actual-v1']: { costUSD: 0.2 }, auxiliary: { costUSD: 0.01 } } };
  if (control.format === 'jsonl') console.log(JSON.stringify({ type: 'turn.completed', ...meta }));
  else if (control.format === 'stream-json' && control.initModel) { console.log(JSON.stringify({ event: 'init', init: { model: control.initModel } })); console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', usage: { tokens: 1 } } })); }
  else if (control.format === 'stream-json') console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', ...meta } }));
  else console.log(JSON.stringify(meta));
} else await import('./fake-ai.mjs');
