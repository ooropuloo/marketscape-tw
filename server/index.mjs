import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createQuoteService, intradayFrames } from './quotes.mjs';
import { createHistoryService } from './history.mjs';
import { createHolderService } from './tdcc.mjs';
import { createFlowService } from './flows.mjs';
import { createUniverse } from './universe.mjs';
import { taipei } from './http-source.mjs';

export const VERSION = '2.1.0';
const PORT = Number(process.env.PORT ?? 5303);
const HOSTS = (process.env.HOSTS ?? '127.0.0.1').split(',').map(s => s.trim()).filter(Boolean);
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const catalog = JSON.parse(await readFile(new URL('../src/datasets/instruments.json', import.meta.url), 'utf8'));
const catalogIds = catalog.instruments.map(s => s.id);
const store = openDatabase();
const universe = createUniverse(store, catalog.instruments);
let def = universe.definition();
const quotes = createQuoteService(catalog.instruments, def.ids, { store });
const history = createHistoryService(store, catalogIds);
const holders = createHolderService(store, catalogIds);
const flows = createFlowService(store, catalogIds);
universe.subscribe(d => { def = d; quotes.setIds(d.ids); broadcast('universe', { ids: d.ids.length }); });
const startedAt = new Date().toISOString();

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
const validIds = ids => ids.length && ids.length <= 400 && ids.every(id => /^[0-9A-Z]{4,6}$/.test(id));
const readBody = req => new Promise((ok, fail) => { let s = ''; req.on('data', c => { s += c; if (s.length > 2e6) fail(new Error('body too large')); }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(new Error('invalid JSON')); } }); req.on('error', fail); });

const sseClients = new Set();
const broadcast = (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const res of sseClients) res.write(msg); };
quotes.subscribe(payload => broadcast('quotes', { checkedAt: new Date().toISOString(), events: payload.events, inSession: taipei.inSession() }));

const shortSummary = () => { const rows = store.latestShort(def.ids); if (!rows.length) return { date: null, items: [] }; const since = store.tradingDates(21).sort()[0]; const acc = new Map(); if (since) for (const b of store.barsForIds(def.ids, since)) { if (b.volume == null) continue; const a = acc.get(b.id) ?? { n: 0, v: 0 }; a.n++; a.v += b.volume; acc.set(b.id, a); }
  return { date: rows[0].date, note: '融券餘額＋借券賣出餘額 ÷ 20 日均量 ＝ 回補天數', items: rows.map(r => { const shares = (r.margin_short_lots ?? 0) * 1000 + (r.sbl_shares ?? 0); const a = acc.get(r.id); const avg = a ? a.v / a.n : null; return { id: r.id, shortShares: shares, marginShortLots: r.margin_short_lots, sblShares: r.sbl_shares, avgVolume: avg, daysToCover: avg > 0 ? +(shares / avg).toFixed(2) : null }; }) }; };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`); const p = url.pathname;
    if (p.startsWith('/api/watch')) {
      // Local write API for the observation list. Only reachable from the hosts the server binds to.
      const id = p.split('/')[3];
      if (req.method === 'POST' && p === '/api/watch') { const body = await readBody(req); try { return json(res, 200, await universe.add(body.id)); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'POST' && p === '/api/watch/import') { const body = await readBody(req); try { return json(res, 200, universe.importETF(body)); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'DELETE' && id) { try { return json(res, 200, universe.remove(id)); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'PATCH' && id) { const body = await readBody(req); return json(res, 200, { definition: universe.setVisible(id, body.visible !== false) }); }
      if (req.method === 'POST' && id && p.endsWith('/refresh')) { try { return json(res, 200, { definition: await universe.refreshETF(id) }); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'GET' && p === '/api/watch') return json(res, 200, def);
      return json(res, 405, { error: 'Unsupported' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Read-only endpoint' });
    if (p === '/api/health') return json(res, 200, { ok: true, version: VERSION, startedAt, now: new Date().toISOString(), taipei: { date: taipei.date(), time: taipei.time(), inSession: taipei.inSession() }, refreshMs: 60000,
      quotes: quotes.status, history: history.progress, flows: flows.progress, holders: holders.status, intraday: store.intradayDates(), tradingDays: store.tradingDates(3), flowDays: store.flowDates(3), universe: { ids: def.ids.length, etfs: def.etfs.map(e => e.id), singles: def.singles.length } });
    if (p === '/api/catalog') return json(res, 200, catalog);
    if (p === '/api/landscape') return json(res, 200, def);
    if (p === '/api/quotes') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean); if (!validIds(ids)) return json(res, 400, { error: 'Invalid symbols' });
      return json(res, 200, await quotes.getQuotes(ids));
    }
    if (p === '/api/history') {
      const range = url.searchParams.get('range') ?? '5d'; if (!['5d', '1m', '1y'].includes(range)) return json(res, 400, { error: 'range must be 5d, 1m or 1y' });
      return json(res, 200, { ...history.frames(range, new Set(def.ids)), progress: history.progress, flowProgress: flows.progress });
    }
    if (p === '/api/intraday') {
      const date = url.searchParams.get('date') ?? taipei.date(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Invalid date' });
      return json(res, 200, intradayFrames(store.samplesForDate(date), date));
    }
    if (p === '/api/holders') {
      const id = url.searchParams.get('id'); if (!id) return json(res, 200, holders.summary(def.ids));
      if (!/^[0-9A-Z]{4,6}$/.test(id)) return json(res, 400, { error: 'Invalid symbol' });
      return json(res, 200, holders.distribution(id));
    }
    if (p === '/api/short') return json(res, 200, shortSummary());
    if (p === '/api/search') { const q = (url.searchParams.get('q') ?? '').trim().toLowerCase(); if (q.length < 2) return json(res, 200, { items: [] }); return json(res, 200, { items: catalog.instruments.filter(s => s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)).slice(0, 12).map(s => ({ ...s, inUniverse: def.ids.includes(s.id), isETF: s.industryCode === 'ETF' })) }); }
    if (p === '/api/events') return json(res, 200, { events: store.recentEvents(Math.min(100, Number(url.searchParams.get('limit') ?? 20) || 20)) });
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Unknown endpoint' });
    const pathname = decodeURIComponent(p); const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) return json(res, 403, { error: 'Forbidden' });
    const info = await stat(target); if (!info.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': pathname.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(target));
  } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Not found' : 'Request unavailable: ' + error.message }); }
});

for (const host of HOSTS) server.listen(PORT, host, () => console.log(`MarketScape TW ${VERSION} · http://${host}:${PORT} · ${def.ids.length} instruments · ${def.etfs.length} ETF · quotes every 60 s in session`));
quotes.start();
(async () => { try { await history.backfill(); await flows.backfill(); } catch (e) { console.log('[backfill]', e.message); } })();
holders.refresh().catch(e => console.log('[tdcc]', e.message));
setInterval(async () => { try { if (taipei.isWeekday() && taipei.time() >= '15:05:00') { await history.ensureDay(taipei.date()); await flows.backfill(); } await holders.refresh(); } catch {} }, 30 * 60_000);
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25_000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { quotes.stop(); server.close(); store.close(); process.exit(0); });
