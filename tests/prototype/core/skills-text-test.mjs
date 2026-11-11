// 插件指令（技能）及創辦人看得到的說明文字：四個技能齊、desk 已移除、只用 CrewZero 一個名字；純本機檔案檢查，不啟動伺服器、瀏覽器或 AI。
// node skills-text-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
const [PROTO, OUT] = process.argv.slice(2);
const REPO = path.resolve(PROTO, '..', '..');
const SKILLS = path.join(PROTO, 'adapters', 'claude-code', 'crewzero', 'skills');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const NAMES = ['install', 'dashboard', 'discuss', 'update'];
const dirs = fs.existsSync(SKILLS) ? fs.readdirSync(SKILLS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : [];
ok('四個技能齊（install、dashboard、discuss、update），沒有其他技能', dirs.join() === [...NAMES].sort().join(), dirs);
ok('desk 技能已移除', !fs.existsSync(path.join(SKILLS, 'desk')), dirs);

const text = {};
for (const n of NAMES) text[n] = read(path.join(SKILLS, n, 'SKILL.md'));

for (const n of NAMES) {
  const s = text[n].replace(/\r\n/g, '\n');
  const fm = (s.match(/^---\n([\s\S]*?)\n---\n/) || [])[1] || '';
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
  ok(`${n}：有 frontmatter name 與 description`, name && name.trim() === n && desc && desc.trim().length > 20, { name, desc: desc && desc.slice(0, 60) });
  ok(`${n}：沒有本機絕對路徑`, !/(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\/Users\/|\/home\/|\\Users\\/.test(s), (s.match(/(?:^|[^A-Za-z])[A-Za-z]:[\\/]\S*|\/Users\/\S*|\/home\/\S*/) || [])[0]);
}

const d = text.discuss;
ok('discuss：用 --brief 取背景、用 --tell 交結論', d.includes('--brief') && d.includes('--tell'));
ok('discuss：交給 Zero 前先問「要不要把以下內容交給 Zero」', d.includes('要不要把以下內容交給 Zero'));
ok('discuss：會議逐字稿觸發詞齊全', ['會議逐字稿', '轉會議紀錄', '整理會議紀錄', '逐字稿'].every(k => d.includes(k)));
ok('discuss：會議紀錄先讀檔、逐位確認講者、依規格寫草稿及核實相對日期', d.includes('--read') && /每位都確認前，不可整理草稿/.test(d) && d.includes('meeting-minutes-format.md') && d.includes('相對日期先以會議日期核實'));
ok('discuss：會議紀錄交出前詢問、正文帶講者對照，附件名稱正確', d.includes('要不要把以下內容交給 Zero') && d.includes('formatMap()') && d.includes('會議紀錄.md'));
ok('TS1 會議紀錄技能寫明常用名稱表、公司概覽、改動清單及逐字稿邊界，命令白名單沒有新增', d.includes('常用名稱表') && d.includes('公司概覽') && d.includes('記住這個名稱') && d.includes('要不要交給 Zero') && d.includes('改動清單') && d.includes('會議紀錄只可寫逐字稿的內容') && !/--(?:term|names|remember)\b/.test(d));
const minutesFormat = read(path.join(PROTO, 'meeting-minutes-format.md'));
ok('TS2 會議紀錄規格列明名單、常用名稱表、公司概覽的次序，別名校正及逐字稿邊界', ['錯字及專有名詞只可按名單、常用名稱表及已確認公司概覽校正', '次序為名單、常用名稱表、公司概覽', '包括名單列出的別名，改用正式名字', '逐字稿出現常用名稱表列出的「另一個寫法」時，改用正式名稱', '不可寫入會議紀錄'].every(k => minutesFormat.includes(k)), minutesFormat);
ok('TS3 會議紀錄規格寫明同音或近似名稱的上下文判斷及正式寫法', ['讀音相同或只差一兩個字', '視為同一個名稱'].every(k => minutesFormat.includes(k)), minutesFormat);
const minutesTask = read(path.join(PROTO, 'ai-minutes-draft.md'));
ok('S3 草稿工作說明提及名稱清單、明示不是會議內容，不誤列完整概覽或重抄人名規則', minutesTask.includes('company-names.md') && minutesTask.includes('不是會議內容') && !minutesTask.includes('confirmed-page.md') && !minutesTask.includes('人名以名單為準'), minutesTask);
ok('discuss：三種工具打法齊全（含描述）', ['/crewzero:discuss', '$crewzero:discuss', '/discuss'].every(k => d.includes(k)) && /description:.*\/crewzero:discuss.*\$crewzero:discuss.*\/discuss/.test(d.replace(/\r\n/g, '\n')));
ok('discuss：三類草稿類型、草稿存系統暫存資料夾並於成功後刪走', ['event', 'adhoc', 'order'].every(k => d.includes(k)) && /系統暫存資料夾/.test(d) && /唔好存喺項目資料夾/.test(d) && /刪走/.test(d) && /crewzero-tell-/.test(d));
ok('discuss：守則（稱 Zero、不拍板、不手改 data、不自開其他命令、可上網但不夾帶私人資料）', /Zero/.test(d) && /唔替創辦人拍板/.test(d) && /唔手改 `<安裝>\/data\/`/.test(d) && /唔自行開其他 CrewZero 命令/.test(d) && /上網/.test(d) && /私人資料/.test(d));
ok('discuss：第一次使用判斷方法、結束回顧、答「唔使」不寫任何嘢', /第一次使用/.test(d) && /最近交給 Zero 的事/.test(d) && /重點回顧/.test(d) && /甚麼都唔寫/.test(d));

ok('discuss：先讀 VERSION 查程式夠不夠新；輸出含「用法：」「未有放上」當程式太舊，請更新後停，不改稿重試', /<安裝>\/VERSION/.test(d) && /0\.13\.0/.test(d) && /用法：/.test(d) && /未有放上/.test(d) && /唔好改稿/.test(d) && /絕對唔好改稿再試/.test(d));
const dash = text.dashboard;
ok('dashboard：description 保留舊叫法作觸發別名（Founder Desk、營運監察台、決定紀錄），並說明打開的是 CrewZero', /description:.*Founder Desk.*營運監察台.*決定紀錄.*CrewZero/.test(dash.replace(/\r\n/g, '\n')));
const pj = JSON.parse(read(path.join(SKILLS, '..', '.claude-plugin', 'plugin.json')) || '{}');
ok('plugin.json：四個指令 install、update、dashboard、discuss，沒有 desk／Founder Desk／營運監察台／founder-desk', ['install', 'update', 'dashboard', 'discuss'].every(k => (pj.description || '').includes(k)) && !/desk|Desk|營運監察台/.test((pj.description || '') + (pj.keywords || []).join(' ')), pj.description);
ok('dashboard：描述為打開 CrewZero，併入卡住時的 --status 與問題包做法，生意問題指向 discuss', /description:.*打開 CrewZero/.test(dash) && dash.includes('--status') && dash.includes('問題包') && dash.includes('/crewzero:discuss') && dash.includes('$crewzero:discuss') && dash.includes('/discuss') && !/需要幫助/.test(dash.replace(/唔好叫佢去頁面按「需要幫助」/, '')));
ok('dashboard：保留示範與生意大腦試驗', dash.includes('--dashboard --demo') && dash.includes('--brain'));

// 創辦人看得到的文字：只用 CrewZero 一個名字、不再提 desk 指令
const banned = [/Founder Desk/, /營運監察台/, /crewzero:desk/, /\$crewzero:desk/, /\/desk(?![A-Za-z])/];
const targets = [
  // dashboard 的 description 刻意保留舊叫法作觸發別名（只給 AI 看），所以只檢查技能正文
  ...NAMES.map(n => [`skills/${n}/SKILL.md`, n === 'dashboard' ? text[n].replace(/^description:.*$/m, '') : text[n]]),
  ['README.md', read(path.join(REPO, 'README.md'))],
  ['插件 README.md', read(path.join(PROTO, 'adapters', 'claude-code', 'crewzero', 'README.md'))],
  ['site/index.html', read(path.join(REPO, 'site', 'index.html'))],
  ['welcome.html', read(path.join(PROTO, 'welcome.html'))],
  ['start-here-template.md', read(path.join(PROTO, 'start-here-template.md'))],
  ['FIRST-WEEK.md', read(path.join(PROTO, 'FIRST-WEEK.md'))],
  ['install.mjs', read(path.join(PROTO, 'install.mjs'))],
  ['update.mjs', read(path.join(PROTO, 'update.mjs'))]
];
for (const [name, s] of targets) {
  const hit = banned.filter(re => re.test(s)).map(String);
  ok(`${name}：有內容，且沒有 Founder Desk／營運監察台／desk 指令字樣`, s.length > 200 && !hit.length, hit);
}

const readme = read(path.join(REPO, 'README.md')), site = read(path.join(REPO, 'site', 'index.html'));
ok('README：指令表有 install、dashboard、discuss、update 三種工具打法', ['/crewzero:install', '$crewzero:install', '/install', '/crewzero:dashboard', '$crewzero:dashboard', '/dashboard', '/crewzero:discuss', '$crewzero:discuss', '/discuss', '/crewzero:update', '$crewzero:update', '/update'].every(k => readme.includes(k)) && /和 Zero 討論/.test(readme) && /發生了一件事/.test(readme) && /請 Zero 做一件事/.test(readme) && /想改計劃/.test(readme));
ok('介紹頁：四個指令齊、介紹和 Zero 討論及三類輸入、署名、授權及支持連結', ['/crewzero:discuss', '$crewzero:discuss', '/discuss', '/crewzero:dashboard'].every(k => site.includes(k)) && /和 Zero 討論/.test(site) && /發生了一件事/.test(site) && /由 Adam Chan 開發/.test(site) && /Apache-2\.0/.test(site) && site.includes('buymeacoffee.com/adamchan'));
// 插件目錄以插件資料夾的 README 作介紹（最少 40 個字，不計程式碼區塊），並要寫明插件在電腦上做的事
const pr = read(path.join(PROTO, 'adapters', 'claude-code', 'crewzero', 'README.md'));
const prWords = pr.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(w => /[A-Za-z]/.test(w)).length;
ok('插件 README：四個指令、英文段落至少 40 個英文字、列明本機伺服器、啟動 AI 工具、自動開工及網絡連線', ['/crewzero:install', '/crewzero:dashboard', '/crewzero:discuss', '/crewzero:update'].every(k => pr.includes(k)) && prWords >= 40 && ['127.0.0.1', 'docs.google.com', 'example.com', 'LaunchAgent', 'No analytics'].every(k => pr.includes(k)) && !/陶土|clay/i.test(pr), { englishWords: prWords });
const sh = read(path.join(PROTO, 'start-here-template.md')), wl = read(path.join(PROTO, 'welcome.html'));
ok('開始說明與歡迎頁：只教 dashboard 一個日常入口，並提到和 Zero 討論', sh.includes('/crewzero:dashboard') && sh.includes('/crewzero:discuss') && wl.includes('/crewzero:dashboard') && /和 Zero 討論/.test(wl) && /和 Zero 討論/.test(sh));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
