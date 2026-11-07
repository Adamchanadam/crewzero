// 只接受指定網址的工具完成事件。
export function codexWebTried(events, target) {
  return Array.isArray(events) && events.some(e => e?.type === 'item.completed' && e.item?.type === 'web_search' && e.item?.action?.type === 'open_page' && e.item.action.url === target);
}
export function codexLocalHits(lines, token) { return lines.filter(line => line === token || line === `${token} refused GET /api/probe`); }
export function codexWebProbe(ok, hits, attempted) { return !!ok && hits === 0 && attempted; }
export function codexPublicRead(ok, events, target) {
  let hostname; try { hostname = new URL(target).hostname; } catch { return false; }
  return !!ok && Array.isArray(events) && events.some(e => codexWebTried([e], target) && Array.isArray(e.item.results) && e.item.results.some(r => {
    if (!r || typeof r.title !== 'string' || !/Example Domain/i.test(r.title)) return false;
    let host = ''; try { host = new URL(r.url).hostname; } catch { }
    return host === hostname || r.domain === hostname;
  }));
}
