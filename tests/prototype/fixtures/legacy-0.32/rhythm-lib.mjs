// 經營節奏（規劃書 3.6、3.9、附錄 A rhythm）：外殼、伺服器、監察台、排程安裝程式共用嘅計時規則，唯一定義處。
// 星期：1＝星期一 … 7＝星期日（同監察台 WD[(n) % 7] 一致）；時間一律用本機牆鐘（模擬實例用模擬時鐘）。
import { pad } from './ask-lib.mjs';

// 時區：原型按本機牆鐘計時，所以預設記低本機時區（唔係另一個時區）
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Hong_Kong'; } catch { return 'Asia/Hong_Kong'; } })();
export const RHYTHM_DEFAULT = { runCadence: 'daily', runTime: '21:00', timezone: LOCAL_TZ, interviewWeekday: 1, runCapMinutes: 30, triggeredRunsPerHour: 6, aiStartsPerDay: 40 };
export const rhythmOf = s => ({ ...RHYTHM_DEFAULT, ...((s && s.company && s.company.rhythm) || {}) });
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const jsDay = wd => (Number(wd) || 1) % 7;
const noon = day => new Date(day + 'T12:00:00');
export const addDays = (day, n) => ymd(new Date(noon(day).getTime() + n * 86400000));

export function isRunDay(r, d) {
  const g = d.getDay();
  return r.runCadence === 'weekdays' ? g >= 1 && g <= 5 : r.runCadence === 'weekly' ? g === jsDay(r.interviewWeekday) : true;
}
export function slotOf(r, d) {
  const [h, m] = String(r.runTime || '21:00').split(':').map(Number);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setHours(h || 0, m || 0, 0, 0);
  return t;
}
// 下一次排程開工（嚴格喺 now 之後）
export function nextRunAt(r, now) {
  for (let i = 0; i < 9; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!isRunDay(r, d)) continue;
    const t = slotOf(r, d);
    if (t > now) return t;
  }
  return null;
}
// 到咗時間、未過 6 小時嘅排程（漏跑不補，只在 6 小時內補跑一次）；回該次排程時間
export function dueSlot(r, now) {
  for (const back of [0, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (!isRunDay(r, d)) continue;
    const t = slotOf(r, d);
    if (now >= t && now - t <= 6 * 3600000) return t;
  }
  return null;
}
// 某日之後（不含當日）嘅下一個訪問日
export function nextWeekday(day, weekday) {
  for (let i = 1; i <= 7; i++) { const x = new Date(noon(day).getTime() + i * 86400000); if (x.getDay() === jsDay(weekday)) return ymd(x); }
  return null;
}
export const isWeekday = (day, weekday) => noon(day).getDay() === jsDay(weekday);

// 開局答案「經營節奏」嘅文字 → 節奏；認唔到嘅部分用預設（例：「每日晚上 9 時工作一次；逢星期一了解近況；每次最多 30 分鐘」）
const WDN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
export function rhythmFromText(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const r = { ...RHYTHM_DEFAULT };
  if (/平日|工作日|(?:星期|週|周)一至(?:星期|週|周)?五/.test(t)) r.runCadence = 'weekdays';
  else if (/每(?:星期|週|周|禮拜)(?:工作)?一次/.test(t)) r.runCadence = 'weekly';
  let m = /(\d{1,2}):(\d{2})/.exec(t);
  if (m) r.runTime = pad(Math.min(23, Number(m[1]))) + ':' + pad(Math.min(59, Number(m[2])));
  else if ((m = /(早上|上午|中午|下午|晚上|夜晚|凌晨)?(\d{1,2})(?:時|點)(半)?/.exec(t))) {
    let h = Number(m[2]);
    if (['下午', '晚上', '夜晚'].includes(m[1]) && h < 12) h += 12;
    if (h <= 23) r.runTime = pad(h) + ':' + (m[3] ? '30' : '00');
  }
  if ((m = /(?:逢|每)(?:星期|週|周|禮拜)([一二三四五六日天])(?!次)/.exec(t))) r.interviewWeekday = WDN[m[1]];
  if ((m = /最多(\d{2})分鐘/.exec(t))) { const n = Number(m[1]); r.runCapMinutes = n <= 37 ? 30 : n <= 52 ? 45 : 60; }
  return r;
}
