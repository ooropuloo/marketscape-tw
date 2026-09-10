// Official ETF holdings. First supported issuer: Yuanta (元大), whose product page embeds the holdings in the Nuxt payload.
import vm from 'node:vm';
import { getPublicText } from './http-source.mjs';

export const ISSUERS = {
  yuanta: { name: '元大投信', url: id => `https://www.yuantaetfs.com/product/detail/${id}/ratio` },
};

// Yuanta-listed ETF codes are not enumerable without scraping the index; treat any 00xx/00xxx/00xxxB style code as a candidate and let the page decide.
export const looksLikeETF = id => /^00\d{2,3}[A-Z]?$/.test(id) || id === '0050' || id === '0051' || id === '0052' || id === '0053' || id === '0055' || id === '0056' || id === '0057' || id === '0061';

export function parseYuanta(html, id) {
  const start = html.indexOf('window.__NUXT__='); if (start < 0) throw new Error('找不到頁面資料（不是元大 ETF 頁面？）');
  const end = html.indexOf('</script>', start); const script = html.slice(start, end);
  const sandbox = { window: {} }; vm.runInNewContext(script, sandbox, { timeout: 5000 });
  let weights = null; const seen = new Set();
  (function walk(v, depth) { if (weights || !v || typeof v !== 'object' || depth > 14 || seen.has(v)) return; seen.add(v); if (Array.isArray(v.StockWeights) && v.Summary) { weights = v; return; } for (const x of Object.values(v)) walk(x, depth + 1); })(sandbox.window.__NUXT__, 0);
  if (!weights) throw new Error('頁面沒有持股權重資料');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const name = title.match(/\(\d{4,6}[A-Z]?\)([^-|]+)/)?.[1]?.trim().replace(/證券投資信託基金$/, '') ?? weights.Summary.name ?? id;
  let navDate = null; (function walk(v, depth) { if (navDate || !v || typeof v !== 'object' || depth > 8) return; if (typeof v.NAV_DATE === 'string') { navDate = v.NAV_DATE; return; } for (const x of Object.values(v)) walk(x, depth + 1); })(sandbox.window.__NUXT__, 0);
  const date = (navDate ?? '').match(/(\d{4})\/(\d{2})\/(\d{2})/) ?? html.match(/交易日期[:：]?\s*(\d{4})\/(\d{2})\/(\d{2})/); const asOf = date ? `${date[1]}-${date[2]}-${date[3]}` : null;
  const holdings = weights.StockWeights.filter(s => s && s.code && Number.isFinite(Number(s.weights)) && Number(s.weights) > 0).map(s => ({ id: String(s.code).trim(), name: String(s.name ?? '').trim(), weight: Number(s.weights), quantity: Number(s.qty) || null }));
  if (holdings.length < 3) throw new Error(`持股只有 ${holdings.length} 檔，疑似非股票型 ETF`);
  const total = +holdings.reduce((a, h) => a + h.weight, 0).toFixed(2); if (total < 30 || total > 105) throw new Error(`股票權重合計 ${total}% 不合理`);
  return { id, name, issuer: 'yuanta', asOf, source: ISSUERS.yuanta.url(id), stockWeightTotal: total, fundNAV: Number(weights.Summary.fundsize) || null, stockAssetValue: Number(weights.Summary.stkvalues) || null, holdings };
}

export async function fetchETF(id, { fetchText = getPublicText } = {}) {
  const html = await fetchText(ISSUERS.yuanta.url(id), { timeout: 40 });
  return { ...parseYuanta(html, id), retrievedAt: new Date().toISOString() };
}
