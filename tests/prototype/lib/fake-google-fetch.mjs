// 測試用假 Google：伺服器經 SOS_FETCH_MODULE 載入，取代 fetch（不連外網）。
// 文件編號決定行為（前綴）：okdoc／oksheet／okslides＝公開可讀；closed＝轉去登入頁（未分享）；missing＝404。
// 狀態檔（環境變數 FAKE_GOOGLE_STATE，JSON）：{ version: 1|2, down: true } — version 改變內容，down＝全部連線失敗。
// 每次匯出：先 307 轉去 *.googleusercontent.com，再 200 回內容（與真實 Google 一樣）。
import fs from 'node:fs';
import { docxOf, xlsxOf } from './zip-fixture.mjs';

const state = () => { try { return JSON.parse(fs.readFileSync(process.env.FAKE_GOOGLE_STATE, 'utf8')); } catch { return { version: 1 }; } };
const res = (status, body, headers = {}) => new Response(body, { status, headers });

export default async function fakeFetch(url) {
  const u = new URL(String(url)), st = state();
  if (st.down) throw new TypeError('fetch failed');
  if (u.hostname.endsWith('.googleusercontent.com')) {
    const [, id, fmt] = /^\/x\/([^/]+)\/([^/]+)$/.exec(u.pathname) || [];
    const v = st.version || 1;
    if (id.startsWith('okdoc')) {
      if (fmt === 'md') return res(200, `# 預算說明（第 ${v} 版）\n\n十一月二十日前須回覆甲餐廳的報價。`, { 'content-type': 'text/x-markdown; charset=utf-8', 'content-disposition': `attachment; filename="Doc.md"; filename*=UTF-8''%E9%A0%90%E7%AE%97%E8%AA%AA%E6%98%8E.md` });
      return res(200, Buffer.from(`%PDF-1.4 doc v${v}`), { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''%E9%A0%90%E7%AE%97%E8%AA%AA%E6%98%8E.pdf` });
    }
    if (id.startsWith('oksheet')) return res(200, xlsxOf([['項目', '金額'], ['租金', 8000 + v], ['材料', 3500]], '預算'), { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''%E6%9C%88%E9%A0%90%E7%AE%97.xlsx` });
    if (id.startsWith('okslides')) {
      if (fmt === 'txt') return res(200, `推介簡報第 ${v} 版：三間餐廳試單`, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''%E6%8E%A8%E4%BB%8B.txt` });
      return res(200, Buffer.from(`%PDF-1.4 slides v${v}`), { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''%E6%8E%A8%E4%BB%8B.pdf` });
    }
    return res(404, 'x');
  }
  const m = /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)\/export(?:\/(pdf|txt))?$/.exec(u.pathname);
  if (u.hostname !== 'docs.google.com' || !m) return res(404, 'x');
  const id = m[2], fmt = m[3] || u.searchParams.get('format') || '';
  if (id.startsWith('closed')) return res(302, '', { location: 'https://accounts.google.com/ServiceLogin?x=1' });
  if (id.startsWith('missing')) return res(404, 'x');
  return res(307, '', { location: `https://doc-0k-${m[1]}.googleusercontent.com/x/${id}/${fmt}` });
}
