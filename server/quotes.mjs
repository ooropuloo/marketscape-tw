// Live quotes from the TWSE MIS public feed, refreshed every 60 s during the session.
// Every tick is written to SQLite so today's landscape can be replayed.
import { getPublicJSON, taipei } from './http-source.mjs';
import { COLLAPSE } from '../src/universe.js';

export const REFRESH_MS = 60_000;
const number = v => v == null || v === '' || v === '-' || v === 'NaN' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const price = v => { const n = number(v); return n > 0 ? n : null; };

export function normalizeQuote(raw, previous = null, now = Date.now()) {
  const date = /^\d{8}$/.test(raw.d ?? '') ? `${raw.d.slice(0, 4)}-${raw.d.slice(4, 6)}-${raw.d.slice(6, 8)}` : null;
  const quoteAt = number(raw.tlong) > 0 ? new Date(Number(raw.tlong)).toISOString() : date && /^\d{2}:\d{2}:\d{2}$/.test(raw.t ?? '') ? new Date(`${date}T${raw.t}+08:00`).toISOString() : null;
  const indicative = raw.ts === '1'; const validTrade = indicative ? null : price(raw.z);
  // MIS only fills z for a trade inside the latest matching cycle. Fall back to pz (previous trade), then the
  // retained last trade of this session, then the bid/ask midpoint flagged as estimated.
  const previousTrade = indicative ? null : price(raw.pz);
  const bid = price(raw.b?.split('_')[0]), ask = price(raw.a?.split('_')[0]);
  const retain = validTrade === null && previousTrade === null && previous?.last != null && previous.sourceDate === date && !previous.estimated;
  const mid = bid != null && ask != null ? +((bid + ask) / 2).toFixed(2) : bid ?? ask;
  const estimated = validTrade === null && previousTrade === null && !retain && mid != null && !indicative;
  const last = validTrade ?? previousTrade ?? (retain ? previous.last : estimated ? mid : null);
  const tradeAt = validTrade !== null || previousTrade !== null ? quoteAt : retain ? previous.tradeAt : estimated ? quoteAt : null;
  const previousClose = price(raw.y), change = last != null && previousClose != null ? +(last - previousClose).toFixed(4) : null;
  return { id: raw.c, name: raw.n, exchange: raw.ex, sourceDate: date, quoteAt, tradeAt, checkedAt: new Date(now).toISOString(), last, previousClose,
    change, changePct: change != null ? +(change / previousClose * 100).toFixed(4) : null, bid, ask, estimated,
    high: price(raw.h), low: price(raw.l), open: price(raw.o), volumeLots: number(raw.v), limitUp: price(raw.u), limitDown: price(raw.w), indicative,
    availability: indicative ? 'indicative' : validTrade != null ? 'trade' : previousTrade != null ? 'previous-trade' : retain ? 'retained' : estimated ? 'estimated' : 'no-trade', retained: retain, source: 'TWSE MIS', sourceURL: 'https://mis.twse.com.tw/stock/', error: null };
}

// Aggressor side between two samples (內外盤): trades at/above the previous ask are buyer-initiated, at/below the bid seller-initiated.
export function tradeDirection(before, after) {
  if (!before || after?.last == null || after.estimated || before.sourceDate !== after.sourceDate) return 0;
  if (before.ask != null && after.last >= before.ask) return 1; if (before.bid != null && after.last <= before.bid) return -1;
  if (before.last != null) return Math.sign(after.last - before.last); return 0;
}
export function collapseTrigger(before, after) {
  if (after?.last == null || after.error || after.indicative) return null;
  if (after.changePct <= COLLAPSE['1d'] && (before?.changePct == null || before.changePct > COLLAPSE['1d'])) return `日跌幅達 ${COLLAPSE['1d']}%`;
  const dt = Date.parse(after.tradeAt) - Date.parse(before?.tradeAt);
  if (before?.last > 0 && dt > 0 && dt <= 180_000 && (after.last / before.last - 1) * 100 <= -2) return '三分鐘內急跌 2%';
  return null;
}

export function createQuoteService(catalog, universeIds, { store = null, fetchJSON = getPublicJSON, now = Date.now, log = console.log } = {}) {
  const directory = new Map(catalog.map(s => [s.id, s]));
  let ids = universeIds.filter(id => directory.has(id));
  const cache = new Map(); let inflight = null, failures = 0, blockedUntil = 0;
  const status = { lastTickAt: null, lastSuccessAt: null, upstreamCalls: 0, error: null, samplesToday: 0, universe: ids.length };
  const listeners = new Set();

  async function fetchBatch(batch) {
    const channels = batch.map(id => `${directory.get(id).exchange}_${id}.tw`).join('|');
    const url = new URL('https://mis.twse.com.tw/stock/api/getStockInfo.jsp');
    url.search = new URLSearchParams({ ex_ch: channels, json: '1', delay: '0', _: String(now()), lang: 'zh_tw' }).toString();
    status.upstreamCalls++;
    const response = await fetchJSON(url.href, { timeout: 20 });
    if (response.rtcode !== '0000' || !Array.isArray(response.msgArray)) throw new Error('Invalid MIS response');
    return response.msgArray;
  }
  async function refresh(force = false) {
    if (inflight) return inflight;
    if (!force && now() < blockedUntil) return;
    inflight = (async () => {
      const t = now(); status.lastTickAt = new Date(t).toISOString();
      try {
        const raws = []; for (let i = 0; i < ids.length; i += 100) raws.push(...await fetchBatch(ids.slice(i, i + 100)));
        const samples = [], events = [], today = taipei.date(t);
        for (const raw of raws) {
          const meta = directory.get(raw.c); if (!meta || raw.ex !== meta.exchange) continue;
          const before = cache.get(raw.c)?.quote ?? null; const quote = normalizeQuote(raw, before, t);
          cache.set(raw.c, { quote, fetchedAt: t });
          if (quote.last != null && quote.sourceDate === today && taipei.inSession(t)) samples.push({ id: quote.id, ts: t, date: today, last: quote.last, changePct: quote.changePct, volume: quote.volumeLots, high: quote.high, low: quote.low, est: quote.estimated ? 1 : 0, bid: quote.bid, ask: quote.ask, dir: tradeDirection(before, quote) });
          const trigger = collapseTrigger(before, quote); if (trigger) events.push({ id: quote.id, ts: t, kind: 'collapse', detail: trigger, changePct: quote.changePct, range: '1d' });
        }
        if (store) { if (samples.length) { store.insertSamples(samples); status.samplesToday += samples.length; } for (const e of events) store.insertEvent(e); }
        failures = 0; blockedUntil = 0; status.error = null; status.lastSuccessAt = new Date(t).toISOString();
        for (const fn of listeners) fn({ quotes: snapshot(), events });
      } catch (e) {
        failures++; blockedUntil = now() + Math.min(300_000, REFRESH_MS * 2 ** (failures - 1)); status.error = `官方報價暫時無法取得（${e.message}），保留舊報價。`; log('[quotes]', e.message);
      } finally { inflight = null; }
    })();
    return inflight;
  }
  function snapshot(list = ids) {
    const t = now();
    return list.map(id => { const q = cache.get(id)?.quote, meta = directory.get(id); return q ? { ...q, stale: !!status.error || (!!q.tradeAt && taipei.inSession(t) && t - Date.parse(q.tradeAt) > 180_000) } : { id, name: meta?.name ?? id, exchange: meta?.exchange ?? null, last: null, changePct: null, availability: 'unavailable', stale: true }; });
  }
  async function getQuotes(list) {
    const unique = [...new Set(list)]; if (unique.some(id => !directory.has(id))) throw new Error('Invalid instrument list');
    if (!status.lastSuccessAt) await refresh(true);
    return { quotes: snapshot(unique), checkedAt: new Date(now()).toISOString(), refreshMs: REFRESH_MS, inSession: taipei.inSession(now()), taipeiTime: taipei.time(now()), source: 'TWSE MIS 公開行情', sourceURL: 'https://mis.twse.com.tw/stock/', error: status.error, lastSuccessAt: status.lastSuccessAt };
  }
  // 60 s in session; every 10 min outside so the previous close stays fresh without hammering the feed.
  let timer = null;
  function schedule() { clearTimeout(timer); const t = now(); const gap = taipei.inSession(t) ? REFRESH_MS : 600_000; timer = setTimeout(async () => { await refresh(); schedule(); }, Math.max(gap, blockedUntil - t)); }
  function start() { refresh(true).finally(schedule); }
  function stop() { clearTimeout(timer); }
  return { getQuotes, refresh, start, stop, status, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, get ids() { return ids; },
    setIds(list) { ids = [...new Set(list)].filter(id => directory.has(id)); status.universe = ids.length; if (ids.some(id => !cache.has(id))) refresh(true); } };
}

// Bucket today's samples into 5-minute frames from 09:00 to 13:30 (Taipei).
export function intradayFrames(samples, date, now = Date.now()) {
  const start = Date.parse(`${date}T09:00:00+08:00`), step = 5 * 60_000, n = 55;
  const labels = Array.from({ length: n }, (_, i) => { const m = 9 * 60 + i * 5; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
  const series = {};
  for (const s of samples) {
    const k = Math.min(n - 1, Math.max(0, Math.floor((s.ts - start) / step)));
    const row = series[s.id] ??= { last: Array(n).fill(null), changePct: Array(n).fill(null), volume: Array(n).fill(null), est: Array(n).fill(null), flow: Array(n).fill(0), _prevVol: null };
    row.last[k] = s.last; row.changePct[k] = s.change_pct ?? s.changePct ?? null; row.volume[k] = s.volume; row.est[k] = s.est ?? 0;
    // Incremental turnover (lots → shares) signed by aggressor side, accumulated per bucket. Cumulative flow is summed client-side.
    if (row._prevVol != null && s.volume != null && s.volume >= row._prevVol && s.last != null) row.flow[k] += (s.volume - row._prevVol) * 1000 * s.last * (s.dir ?? 0);
    if (s.volume != null) row._prevVol = s.volume;
  }
  for (const r of Object.values(series)) delete r._prevVol;
  // Carry the last known value forward inside the captured window so scrubbing never shows holes.
  let lastFilled = -1; for (let i = 0; i < n; i++) if (Object.values(series).some(r => r.last[i] != null)) lastFilled = i;
  for (const r of Object.values(series)) for (let i = 1; i <= lastFilled; i++) if (r.last[i] == null && r.last[i - 1] != null) { r.last[i] = r.last[i - 1]; r.changePct[i] = r.changePct[i - 1]; r.volume[i] = r.volume[i - 1]; r.est[i] = r.est[i - 1]; }
  const firstFilled = labels.findIndex((_, i) => Object.values(series).some(r => r.last[i] != null));
  return { range: '1d', date, labels, series, firstFrame: firstFilled, lastFrame: lastFilled, generatedAt: new Date(now).toISOString(), source: 'TWSE MIS 60 秒取樣', flowNote: '盤中估計：每分鐘增量成交 × 內外盤方向' };
}
