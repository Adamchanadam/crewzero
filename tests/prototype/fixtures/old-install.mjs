// 舊安裝夾具（虛構公司「從田間到餐桌」）：舊格式公司概覽、已成頁確認、帳本未有里程碑。真實事件測試同公司概覽遷移測試用。
// 由原型自帶嘅虛構例子 fixtures/example-company-page.json 加：一項「目前進展」、三條 AI 假設、三格權限、交資料封存資料夾。
// linkStatus：「目前進展」嗰項連住第一站、標文件出處（測試由目前進展推導站點完成）。
import fs from 'node:fs';
import path from 'node:path';

export function oldInstall(DATA, PROTO, { linkStatus = false, statusGrade = 'did' } = {}) {
  const p = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'example-company-page.json'), 'utf8'));
  delete p.page.schema;
  // 例子第二站寫「並畀回饋」（口語）；會變成畫面文字嘅值用書面語
  for (const m of p.path.milestones) if (m.event && typeof m.event.value === 'string') m.event.value = m.event.value.replace(/畀/g, '提供');
  p.glance.status.items.push({ id: 's3', plan: 'G4', kind: 'grade', label: statusGrade === 'said' ? '農場甲表示有興趣' : '農場甲已簽供應意向書', value: statusGrade, origin: linkStatus ? 'doc' : 'ai', ...(linkStatus ? { milestone: 'm1', src: [{ from: 'intake', at: '目前進展' }] } : {}) });
  p.detail = {
    ...(p.detail || {}),
    assumptions: { title: 'AI 假設（未證實）', test: '成本最低的測試', items: [
      { id: 'a1', label: '餐廳願意為當季來源多付一成價錢', value: '', origin: 'ai', kind: 'text' },
      { id: 'a2', label: '農場可以每週穩定出貨', value: '', origin: 'ai', kind: 'text' },
      { id: 'a3', label: '一個人足夠應付首月送貨', value: '', origin: 'ai', kind: 'text' }] },
    rules: { title: 'AI 可自行處理的事', items: [{ id: 'ru1', label: 'AI 可自行處理的事', value: '用預設', origin: 'default', kind: 'text' }],
      boxes: { auto: ['撰寫草稿', '整理紀錄'], tellAfter: ['更新內部清單'], askFirst: ['對外聯絡', '花錢', '作出承諾'] } }
  };
  // 成頁確認：每個有 id、label、value 嘅欄照 AI 擬嘅值
  const values = {};
  (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'label' in o && 'value' in o) values[o.id] = String(o.value ?? ''); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(p);
  const order = p.path.milestones.map(m => m.id);
  const confirmed = { company: p.company.name, pageId: p.page.id, confirmedAt: '2026-10-20T10:00:00+08:00', replyFile: '', order, orderChanged: false, nextActionMilestone: 'm1', edits: [], stillMissing: [], note: '', values };
  for (const k of ['company', 'ledger']) fs.mkdirSync(path.join(DATA, k), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(p, null, 2));
  fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify(confirmed, null, 2));
  // 交資料封存資料夾（目前進展推導站點完成時作證明）
  const arch = path.join(DATA, 'archive', '2026-10', p.page.id);
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, 'intake.md'), '# 交資料（虛構測試）\n\n農場甲已簽供應意向書。\n');
  return { pageId: p.page.id, milestones: order.length, assumptions: p.detail.assumptions.items.length };
}
