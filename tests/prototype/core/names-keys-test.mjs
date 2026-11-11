// 頁面字句鍵靜態核對：只檢查字面鍵，不啟動伺服器或瀏覽器。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(process.argv[2] || path.join(HERE, '..', '..', '..', 'prototypes', 'proofread'));
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });

function aliases(source, page) {
  const init = source.match(/var N = window\.SOS_NAMES,([^;]+);/);
  if (!init) return { error: page + ' 找不到 SOS_NAMES 初始化行' };
  const value = init[1], found = {};
  if (/\bD\s*=\s*N\.dash\b/.test(value)) found.D = 'dash';
  if (/\bd\s*=\s*N\.d\b/.test(value)) found.d = 'dash';
  if (/\bT\s*=\s*N\.t\b/.test(value)) found.T = 'ui';
  return found;
}

function literalKeys(source, alias, page) {
  const patterns = [
    ['D.', /\bD\.([A-Za-z_$][\w$]*)\b/g, alias.D],
    ["d('", /\bd\(\s*'([A-Za-z_$][\w$]*)'/g, alias.d],
    ['N.ui.', /\bN\.ui\.([A-Za-z_$][\w$]*)\b/g, 'ui'],
    ["N.t('", /\bN\.t\(\s*'([A-Za-z_$][\w$]*)'/g, 'ui'],
    ["T('", /\bT\(\s*'([A-Za-z_$][\w$]*)'/g, alias.T],
    ['N.dash.', /\bN\.dash\.([A-Za-z_$][\w$]*)\b/g, 'dash'],
    ["N.d('", /\bN\.d\(\s*'([A-Za-z_$][\w$]*)'/g, 'dash']
  ];
  // 0.42.0 已有：act_done 不在 dash；recFeedback 有 inFeedback 後備，今次不改。
  const oldExceptions = new Set(page === 'dashboard.html' ? ['D.|act_done', 'N.ui.|recFeedback'] : []);
  const missing = [];
  for (const [style, pattern, group] of patterns) {
    const matches = [...source.matchAll(pattern)];
    if (!matches.length) continue;
    if (!group) { missing.push({ page, style, key: '(別名未能判斷)' }); continue; }
    for (const match of matches) {
      const key = match[1];
      if (oldExceptions.has(style + '|' + key)) continue;
      if (!Object.prototype.hasOwnProperty.call(N[group], key)) missing.push({ page, style, key });
    }
  }
  return missing;
}

const dashboard = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8');
const ask = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8');
const dashboardAliases = aliases(dashboard, 'dashboard.html');
const askAliases = aliases(ask, 'ask.html');
const dashboardMissing = literalKeys(dashboard, dashboardAliases, 'dashboard.html');
const askMissing = literalKeys(ask, askAliases, 'ask.html');

ok('TK1 dashboard.html 所有字面字句鍵存在', dashboardAliases.D === 'dash' && dashboardAliases.d === 'dash' && dashboardMissing.length === 0, { aliases: dashboardAliases, missing: dashboardMissing });
ok('TK2 ask.html 所有字面字句鍵存在', askAliases.T === 'ui' && askMissing.length === 0, { aliases: askAliases, missing: askMissing });
ok('TK3 dashboard.html 沒有錯讀 dash 組的名稱表鍵', !dashboard.includes('D.term_') && !dashboard.includes("d('term_"), { hasDTerm: dashboard.includes('D.term_'), hasdTerm: dashboard.includes("d('term_") });

const pass = results.filter(result => result.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
