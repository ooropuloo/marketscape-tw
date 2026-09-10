// Real money-flow inputs: institutional net buying (三大法人) and short interest (融券 / 借券賣出), daily, both exchanges.
import { getPublicJSON, createThrottle } from './http-source.mjs';
import { fmtTSE, fmtTPEX } from './history.mjs';

const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); if (!s || s === '--' || s === '-') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const id = v => String(v ?? '').trim();
// Some TWSE reports (T86, TWT93U) put fields/data at the top level instead of inside `tables`.
const table = (json, pred) => (Array.isArray(json?.tables) ? json.tables : [json]).find(t => t && Array.isArray(t.fields) && pred(t.fields));

// TWSE T86: last column = 三大法人買賣超股數
export function parseT86(json) {
  if (json?.stat !== 'OK') return []; const t = table(json, f => f.includes('三大法人買賣超股數')); if (!t) return [];
  const f = t.fields, iF = f.indexOf('外陸資買賣超股數(不含外資自營商)'), iT = f.indexOf('投信買賣超股數'), iD = f.indexOf('自營商買賣超股數'), iA = f.indexOf('三大法人買賣超股數');
  return t.data.map(r => ({ id: id(r[0]), foreign: num(r[iF]), trust: num(r[iT]), dealer: num(r[iD]), total: num(r[iA]) })).filter(r => r.id && r.total != null);
}
// TPEx dailyTrade (sect=EW): 外資合計買賣超=10, 投信=13, 自營合計=22, 合計=23
export function parseTPEXInsti(json) {
  if (json?.stat !== 'ok' && json?.stat !== 'OK') return []; const t = (json.tables ?? [])[0]; if (!t?.data?.length) return [];
  return t.data.map(r => ({ id: id(r[0]), foreign: num(r[10]), trust: num(r[13]), dealer: num(r[22]), total: num(r[23]) })).filter(r => r.id && r.total != null);
}
// TWSE MI_MARGN 融資融券彙總: 券 今日餘額 = index 12 (張)
export function parseMargin(json) {
  if (json?.stat !== 'OK') return []; const t = table(json, f => f.includes('代號') && f.length >= 15); if (!t) return [];
  return t.data.map(r => ({ id: id(r[0]), marginShortLots: num(r[12]) })).filter(r => r.id && r.marginShortLots != null);
}
// TWSE TWT93U 借券賣出: 當日餘額 = index 12 (股)
export function parseSBL(json) {
  if (json?.stat !== 'OK') return []; const t = table(json, f => f.includes('代號') && f.includes('當日餘額')); if (!t) return [];
  return t.data.map(r => ({ id: id(r[0]), sblShares: num(r[12]) })).filter(r => r.id && r.sblShares != null);
}
export function parseTPEXMargin(json) { if (json?.stat !== 'ok' && json?.stat !== 'OK') return []; const t = (json.tables ?? [])[0]; if (!t?.data?.length) return []; return t.data.map(r => ({ id: id(r[0]), marginShortLots: num(r[14]) })).filter(r => r.id && r.marginShortLots != null); }
export function parseTPEXSBL(json) { if (json?.stat !== 'ok' && json?.stat !== 'OK') return []; const t = (json.tables ?? [])[0]; if (!t?.data?.length) return []; return t.data.map(r => ({ id: id(r[0]), sblShares: num(r[12]) })).filter(r => r.id && r.sblShares != null); }

export function createFlowService(store, catalogIds, { fetchJSON = getPublicJSON, gapMs = 3000, log = console.log } = {}) {
  const throttle = createThrottle(gapMs), known = new Set(catalogIds);
  const progress = { running: false, done: 0, total: 0, lastError: null, lastDate: null };
  const get = url => throttle(() => fetchJSON(url));
  async function fetchDay(date) {
    const insti = [...parseT86(await get(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${fmtTSE(date)}&selectType=ALLBUT0999&response=json`)), ...parseTPEXInsti(await get(`https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${fmtTPEX(date)}&response=json`))];
    const short = new Map();
    for (const r of [...parseMargin(await get(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${fmtTSE(date)}&selectType=ALL&response=json`)), ...parseTPEXMargin(await get(`https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${fmtTPEX(date)}&response=json`))]) short.set(r.id, { id: r.id, marginShortLots: r.marginShortLots, sblShares: 0 });
    for (const r of [...parseSBL(await get(`https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${fmtTSE(date)}&response=json`)), ...parseTPEXSBL(await get(`https://www.tpex.org.tw/www/zh-tw/margin/sbl?date=${fmtTPEX(date)}&response=json`))]) { const s = short.get(r.id) ?? { id: r.id, marginShortLots: 0, sblShares: 0 }; s.sblShares = r.sblShares; short.set(r.id, s); }
    store.upsertInstitutional(insti.filter(r => known.has(r.id)).map(r => ({ ...r, date })));
    store.upsertShort([...short.values()].filter(r => known.has(r.id)).map(r => ({ ...r, date })));
    store.markFlowDay(date, insti.length);
    return { insti: insti.length, short: short.size };
  }
  // Fill every stored trading day that has no flow data yet (oldest first so the newest arrives last but nothing is skipped).
  async function backfill() {
    if (progress.running) return; const dates = store.tradingDatesWithoutFlows(60);
    progress.running = true; progress.done = 0; progress.total = dates.length; progress.lastError = null;
    try { for (const d of dates) { try { await fetchDay(d); progress.lastDate = d; } catch (e) { progress.lastError = `${d}: ${e.message}`; log('[flows]', d, e.message); } progress.done++; } }
    finally { progress.running = false; }
  }
  return { fetchDay, backfill, progress };
}
