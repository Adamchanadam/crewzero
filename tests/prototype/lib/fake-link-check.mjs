// 測試用假外部連結試開：run.mjs 經 SOS_LINKCHECK_MODULE 載入，取代 fetch／DNS（不連外網）。
// 網址含 schs 的回 404（明確打不開），其餘回 200。
export const fetchImpl = async url => new Response('', { status: /schs/.test(String(url)) ? 404 : 200 });
export const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
