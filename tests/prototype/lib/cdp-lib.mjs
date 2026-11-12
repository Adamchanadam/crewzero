// 無頭 Chrome 小工具：開頁、等、撳、截圖（元素範圍）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// Windows 上只停主程序會留下無頭瀏覽器的子程序：連整個程序樹一併停止
const stopTree = child => { if (process.platform === 'win32' && child.pid) { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; } catch { } } child.kill(); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function openChrome(CHROME, profile, cport) {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${cport}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  async function json(u) { for (let i = 0; i < 80; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
  const pg = (await json(`http://127.0.0.1:${cport}/json/list`)).find(t => t.type === 'page');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  // 連線要有時限：除錯埠連到已關閉或不回應的瀏覽器時，不可永遠等下去
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('devtools 連線逾時（' + cport + '）')), 30000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('devtools 連線失敗（' + cport + '）')); }; });
  let seq = 0; const pend = new Map(); const errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); clearTimeout(p.t); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  // 頁面關閉或崩潰：所有等候中的指令即時失敗，不等到整組逾時
  ws.onclose = () => { for (const [i, p] of pend) { pend.delete(i); clearTimeout(p.t); p.rej(new Error('devtools 連線已關閉（' + cport + '）')); } };
  // 每個指令預設 30 秒逾時（CDP_SEND_TIMEOUT_MS 可調）；逾時就拒絕，讓測試明確失敗而不是空等
  const SEND_MS = Number(process.env.CDP_SEND_TIMEOUT_MS) || 30000;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++seq;
    if (ws.readyState !== 1) return rej(new Error('devtools 連線已關閉（' + cport + '）：' + method));
    const ms = /^Page.(captureScreenshot|printToPDF)$/.test(method) ? Math.max(SEND_MS, 90000) : SEND_MS;   // 超高頁面截圖較慢，另給 90 秒
    const t = setTimeout(() => { if (pend.delete(i)) rej(new Error('devtools 指令逾時（' + method + '，' + ms + ' 毫秒）')); }, ms);
    pend.set(i, { res, rej, t });
    try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { pend.delete(i); clearTimeout(t); rej(e); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(e.slice(0, 80) + ' -> ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  let W = 1440;
  const H = w => w === 390 ? 844 : w === 1024 ? 768 : 900;
  async function go(url, w = 1440, wait = 1600) { W = w; await send('Emulation.setDeviceMetricsOverride', { width: w, height: H(w), deviceScaleFactor: 1, mobile: w < 600 }); await send('Page.navigate', { url }); await sleep(wait); }
  async function click(sel) {
    await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(150);
    const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500);
  }
  async function type(sel, text) { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value='';})()`); await send('Input.insertText', { text }); await ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new Event('input',{bubbles:true}))`); }
  // 截圖：sel 有就影嗰個元素（可以好長）；冇就影而家畫面；full 就影整頁
  async function shot(file, sel, { full = false, pad = 12, maxH = 9000, height = 0 } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (sel || full) {
      const box = await ev(`(()=>{const e=${sel ? `document.querySelector(${JSON.stringify(sel)})` : 'document.documentElement'};const r=e.getBoundingClientRect();return {y:r.top+window.scrollY,h:${sel ? 'r.height' : 'document.documentElement.scrollHeight'}}})()`);
      const total = await ev('document.documentElement.scrollHeight');
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(Math.max(total, H(W)), 16000), deviceScaleFactor: 1, mobile: W < 600 });
      await sleep(400);
      const y = Math.max(0, box.y - pad), h = Math.min(height || box.h + pad * 2, maxH, total - Math.max(0, box.y - pad));
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: W, height: h, scale: 1 } });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H(W), deviceScaleFactor: 1, mobile: W < 600 }); await sleep(250);
      return;
    }
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  return { send, ev, go, click, type, shot, errors, close: () => { try { ws.close(); } catch { } stopTree(chrome); }, width: () => W };
}
