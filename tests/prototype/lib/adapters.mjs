// 測試用 AI 設定：喺輸出資料夾寫三份（假 AI、可上網嘅假 AI、未安裝嘅 AI），路徑按呢個資料夾嘅位置計，唔寫死任何人嘅路徑。
// 假 AI（fake-ai.mjs）零費用：喺沙盒按工作類型交固定格式嘅產出。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(fileURLToPath(import.meta.url));
const chat = { args: [path.join(LIB, 'fake-chat.mjs'), '{system}', '{model}'], fastModel: 'fast', reviewModel: 'review' };
const base = { command: process.execPath, prompt: 'x', timeoutMinutes: 1, id: 'test', versionArgs: ['--version'], required: {}, chat,
  settingsProbe: { relative: '.claude/settings.local.json', content: '{"permissions":{"allow":["Bash"]}}' } };

export function writeAdapters(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    fake: { ...base, name: '測試 AI', label: '測試 AI', args: [path.join(LIB, 'fake-ai.mjs')] },
    web: { ...base, name: '測試 AI（上網）', label: '測試 AI（上網）',
      args: [path.join(LIB, 'fake-ai.mjs'), '--tools', 'Read,WebSearch,WebFetch', '--allowedTools', 'WebSearch', 'WebFetch', '--disallowedTools', 'WebFetch(domain:127.*.*.*)', 'WebFetch(domain:192.168.*.*)', '--strict-mcp-config'],
      required: { toolsFlag: '--tools', toolsAllowed: ['Read', 'WebSearch', 'WebFetch'], webTools: ['WebSearch', 'WebFetch'], mustDeny: ['127.*.*.*', '192.168.*.*'] },
      denialProof: { tool: 'WebFetch', methodField: 'method', urlField: 'url' } },
    codexLike: { ...base, id: 'codex', name: '測試 Codex', label: '測試 Codex',
      args: [path.join(LIB, 'fake-ai.mjs'), '--fake-output', 'jsonl', '--ignore-user-config', '--ignore-rules', '--json', '-c', 'web_search="disabled"'],
      outputFormat: 'jsonl', env: { CODEX_HOME: '{dataDir}/codex-home', HOME: '{dataDir}/codex-home', USERPROFILE: '{dataDir}/codex-home' },
      sandboxProbe: { command: process.execPath, args: [path.join(LIB, 'fake-ai.mjs'), '--sandbox-probe', '{target}', '{content}'] },
      settingsProbe: { absolute: '{codexHome}/config.toml', content: 'sandbox_mode = "danger-full-access"' }, loginProbe: { args: ['--version'], okExit: 0 },
      required: { mustHave: ['--ignore-user-config', '--ignore-rules', '--json', 'web_search="disabled"'] } },
    agyLike: { ...base, id: 'agy', name: '測試 Antigravity', label: '測試 Antigravity',
      args: [path.join(LIB, 'fake-ai.mjs'), '--fake-output', 'agy', '--output-format', 'stream-json', '--disable-slash-commands'],
      outputFormat: 'stream-json', denialProof: { streamToolEvent: { event: 'step_update', stepType: 'tool', rejectStates: ['FAILED', 'ERROR', 'DENIED', 'REJECTED'] } }, env: { HOME: '{dataDir}/agy-home', USERPROFILE: '{dataDir}/agy-home' },
      settingsProbe: { absolute: '{agyHome}/.gemini/antigravity-cli/settings.json', content: '{"toolPermission":"always-proceed"}' }, loginProbe: { args: ['--version'], okExit: 0 },
      required: { mustHave: ['--output-format', 'stream-json', '--disable-slash-commands'], mustNotHave: ['--dangerously-skip-permissions', '--add-dir', 'auto'] } },
    missing: { name: '未安裝嘅 AI', command: 'no-such-ai-tool-xyz', args: ['{prompt}'], prompt: 'x', timeoutMinutes: 1 }
  };
  const out = {};
  for (const [k, v] of Object.entries(files)) { out[k] = path.join(dir, 'adapter-' + k + '.json'); fs.writeFileSync(out[k], JSON.stringify(v, null, 2)); }
  return out;
}
