// Daily history from official after-trading reports.
// TSE: MI_INDEX (all listed, one request per trading day). OTC: TPEx dailyQuotes (one request per day).
import { getPublicJSON, createThrottle, taipei } from './http-source.mjs';

const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); if (!s || s === '--' || s === '---' || s === 'X' || s === '-') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const id = v => String(v ?? '').trim();

export function parseTSE(json) {
  if (json?.stat !== 'OK') return [];
  const table = (json.tables ?? []).find(t => Array.isArray(t.fields) && t.fields.includes('證券代號') && t.fields.includes('收盤價'));
  if (!table) return [];
  const f = table.fields, ix = k => f.indexOf(k);
  const iId = ix('證券代號'), iOpen = ix('開盤價'), iHigh = ix('最高價'), iLow = ix('最低價'), iClose = ix('收盤價'), iSign = ix('漲跌(+/-)'), iDiff = ix('漲跌價差'), iVol = ix('成交股數'), iAmt = ix('成交金額');
  return table.data.map(r => {
    const sign = /\+/.test(r[iSign] ?? '') ? 1 : /-/.test(r[iSign] ?? '') ? -1 : 0;
    const diff = num(r[iDiff]);
    return { id: id(r[iId]), open: num(r[iOpen]), high: num(r[iHigh]), low: num(r[iLow]), close: num(r[iClose]), change: diff == null ? null : sign * diff, volume: num(r[iVol]), amount: num(r[iAmt]) };
  }).filter(r => r.id && r.close != null);
}

export function parseTPEX(json) {
  if (json?.stat !== 'ok' && json?.stat !== 'OK') return [];
  const table = (json.tables ?? [])[0];
  if (!table?.data?.length) return [];
  // fields: 代號,名稱,收盤,漲跌,開盤,最高,最低,均價,成交股數,成交金額,成交筆數,...
  return table.data.map(r => ({ id: id(r[0]), close: num(r[2]), change: num(r[3]), open: num(r[4]), high: num(r[5]), low: num(r[6]), volume: num(r[8]), amount: num(r[9]) })).filter(r => r.id && r.close != null);
}

export const fmtTSE = d => d.replace(/-/g, '');
export const fmtTPEX = d => d.replace(/-/g, '/');
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const isWeekday = d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

// Reports for day D are published after ~14:30 Taipei. Before that, D is not a candidate.
export function recentWeekdays(now = Date.now(), calendarDays = 45) {
  const today = taipei.date(now); let d = new Date(today + 'T00:00:00Z');
  if (taipei.time(now) < '15:00:00') d = addDays(d, -1);
  const out = []; const stop = addDays(new Date(today + 'T00:00:00Z'), -calendarDays);
  for (; d >= stop; d = addDays(d, -1)) if (isWeekday(d)) out.push(iso(d));
  return out;
}
// Candidate dates for the last trading day of each of the previous `months` months (descending inside each month).
export function monthEndCandidates(now = Date.now(), months = 13) {
  const today = new Date(taipei.date(now) + 'T00:00:00Z'); const out = [];
  for (let m = 1; m <= months; m++) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m + 1, 1)); // first day of following month
    const cands = []; let d = addDays(first, -1);
    while (cands.length < 5) { if (isWeekday(d)) cands.push(iso(d)); d = addDays(d, -1); }
    out.push(cands);
  }
  return out;
}

export function createHistoryService(store, catalogIds, { fetchJSON = getPublicJSON, gapMs = 3000, log = console.log } = {}) {
  const throttle = createThrottle(gapMs);
  const known = new Set(catalogIds);
  const progress = { running: false, done: 0, total: 0, lastDate: null, lastError: null, startedAt: null, finishedAt: null };
  let queued = null;

  async function fetchDay(date) {
    const tse = parseTSE(await throttle(() => fetchJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${fmtTSE(date)}&type=ALLBUT0999&response=json`)));
    let otc = [];
    if (tse.length) otc = parseTPEX(await throttle(() => fetchJSON(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${fmtTPEX(date)}&response=json`)));
    const rows = [...tse, ...otc].filter(r => known.has(r.id)).map(r => ({ ...r, date }));
    store.upsertBars(rows);
    return { tse: tse.length, otc: otc.length, stored: rows.length };
  }
  // Returns true when `date` is a trading day with data.
  async function ensureDay(date, now = Date.now()) {
    const existing = store.getDay(date);
    if (existing && (existing.tse > 0 || date < taipei.date(now))) return existing.tse > 0;
    const r = await fetchDay(date);
    if (r.tse > 0 || date < taipei.date(now)) store.markDay(date, r.tse, r.otc);
    progress.lastDate = date;
    return r.tse > 0;
  }
  async function backfill(now = Date.now()) {
    if (progress.running) return queued ??= progress.current.then(() => backfill());
    const days = recentWeekdays(now), months = monthEndCandidates(now);
    progress.running = true; progress.done = 0; progress.total = days.length + months.length; progress.lastError = null; progress.startedAt = new Date().toISOString(); progress.finishedAt = null;
    progress.current = (async () => {
      try {
        for (const d of days) { try { await ensureDay(d, now); } catch (e) { progress.lastError = `${d}: ${e.message}`; log('[history]', d, e.message); } progress.done++; }
        for (const cands of months) { for (const d of cands) { try { if (await ensureDay(d, now)) break; } catch (e) { progress.lastError = `${d}: ${e.message}`; log('[history]', d, e.message); break; } } progress.done++; }
      } finally { progress.running = false; progress.finishedAt = new Date().toISOString(); queued = null; }
    })();
    return progress.current;
  }
  const pct = b => b.close != null && b.change != null && b.close - b.change > 0 ? +(b.change / (b.close - b.change) * 100).toFixed(4) : null;

  // Frames for the time machine. 5d / 1m: consecutive trading days; 1y: last trading day of each month.
  function frames(range, ids, now = Date.now()) {
    let dates;
    if (range === '1y') {
      const all = store.tradingDates(400).sort();
      const byMonth = new Map(); for (const d of all) byMonth.set(d.slice(0, 7), d); // ascending → keeps last date per month
      dates = [...byMonth.values()].slice(-13);
    } else dates = store.tradingDates(range === '5d' ? 6 : 23).sort();
    const bars = store.barsForDates(dates); const byId = new Map();
    for (const b of bars) { if (!ids.has(b.id)) continue; (byId.get(b.id) ?? byId.set(b.id, new Map()).get(b.id)).set(b.date, b); }
    const instiMap = new Map(store.instiForDates(dates).map(r => [r.id + '|' + r.date, r])), shortMap = new Map(store.shortForDates(dates).map(r => [r.id + '|' + r.date, r]));
    // 20-day average volume (shares) per stock for days-to-cover.
    const avgVol = new Map(); { const since = store.tradingDates(21).sort()[0]; if (since) { const acc = new Map(); for (const b of store.barsForIds([...ids], since)) { if (b.volume == null) continue; const a = acc.get(b.id) ?? { n: 0, v: 0 }; a.n++; a.v += b.volume; acc.set(b.id, a); } for (const [k, a] of acc) avgVol.set(k, a.v / a.n); } }
    const series = {};
    for (const [sid, m] of byId) {
      let prev = null; const close = [], change = [], volume = [], high = [], low = [], insti = [], shortShares = [];
      dates.forEach((d, i) => { const b = m.get(d) ?? null; close.push(b?.close ?? null); volume.push(b?.volume ?? null); high.push(b?.high ?? null); low.push(b?.low ?? null);
        if (!b) change.push(null); else if (range === '1y') change.push(prev?.close > 0 ? +((b.close / prev.close - 1) * 100).toFixed(4) : null); else change.push(pct(b));
        const ins = instiMap.get(sid + '|' + d); insti.push(ins ? { foreign: ins.foreign_net, trust: ins.trust_net, dealer: ins.dealer_net, total: ins.total_net } : null);
        const sh = shortMap.get(sid + '|' + d); shortShares.push(sh ? (sh.margin_short_lots ?? 0) * 1000 + (sh.sbl_shares ?? 0) : null);
        if (b) prev = b; });
      series[sid] = { close: close.slice(1), change: change.slice(1), volume: volume.slice(1), high: high.slice(1), low: low.slice(1), insti: insti.slice(1), shortShares: shortShares.slice(1), avgVolume: avgVol.get(sid) ?? null, baseline: close[0] };
    }
    const labels = dates.slice(1).map(d => range === '1y' ? d.slice(0, 7).replace('-', '/') : d.slice(5).replace('-', '/'));
    return { range, dates: dates.slice(1), labels, baselineDate: dates[0] ?? null, series, generatedAt: new Date(now).toISOString(), source: 'TWSE MI_INDEX / TPEx dailyQuotes', flowNote: range === '1y' ? '三大法人買賣超（月底當日）' : '三大法人買賣超（證交所 T86 / 櫃買）', flowDates: store.flowDates(3) };
  }
  return { backfill, ensureDay, frames, progress, fetchDay };
}
