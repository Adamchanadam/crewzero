// Codex 網上工具的邊界證據：只接受指定網址的事件或該步驟明確記錄失敗。
export function codexWebTried(events, report, target, step) {
  const line = report && typeof report === 'object' ? String(report[String(step)] ?? report['t' + step] ?? '') : '';
  return (events || []).some(e => e.type === 'item.completed' && e.item?.type === 'web_search' && e.item?.action?.type === 'open_page' && e.item.action.url === target) ||
    (!/(?:未|沒|冇|沒有|未能|無法|不能|沒有實際)\s*(?:嘗試|使用工具)|not\s+(?:attempted|tried)|未能證實|無法(?:核對|驗證|證實)/i.test(line) &&
      /(?:失敗|被拒|無法開啟|無法讀取|不能開啟|拒絕|invalid ref_id|failed|denied|error)/i.test(line));
}
export function codexLocalHits(lines, token) { return lines.filter(line => line === token || line === `${token} refused GET /api/probe`); }
export function codexWebProbe(ok, hits, attempted) { return !!ok && hits === 0 && attempted; }
export function codexPublicRead(ok, text) { return !!ok && /Example Domain/i.test(text || ''); }
