// Export the running local server's API responses into public/snapshot/ for the static GitHub Pages build.
// Usage: npm start (server on 5303) → npm run snapshot → npm run build:static. MS_ORIGIN overrides the server origin.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.MS_ORIGIN ?? 'http://127.0.0.1:5303';
const out = resolve(root, 'public', 'snapshot');
const RANGES = ['5d', '1m', '1y'];

const get = async path => { const res = await fetch(origin + path); if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`); return res.json(); };
let total = 0;
const save = async (name, data) => { const text = JSON.stringify(data); total += text.length; await writeFile(resolve(out, `${name}.json`), text); console.log(`${name}.json`.padEnd(18), `${(text.length / 1024).toFixed(0)} KB`); };
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const health = await get('/api/health');
if (health.history?.running || health.flows?.running) console.warn('[snapshot] 日線／法人回填還在跑，快照會缺資料：', JSON.stringify({ history: health.history, flows: health.flows }));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const def = await get('/api/landscape');
await save('health', { ...health, static: true, snapshotAt: new Date().toISOString() });
await save('landscape', def);

let quotes = null;
for (const ids of chunk(def.ids, 300)) { const r = await get(`/api/quotes?ids=${ids.join(',')}`); quotes = quotes ? { ...quotes, quotes: [...quotes.quotes, ...r.quotes] } : r; }
await save('quotes', quotes ?? { quotes: [] });

for (const range of RANGES) await save(`history-${range}`, await get(`/api/history?range=${range}`));
await save('intraday', await get('/api/intraday'));
await save('holders', await get('/api/holders'));
const detail = {};
for (const ids of chunk(def.ids, 10)) await Promise.all(ids.map(async id => { try { detail[id] = await get(`/api/holders?id=${id}`); } catch (e) { console.warn(`[snapshot] holders ${id}: ${e.message}`); } }));
await save('holder-detail', detail);
await save('short', await get('/api/short'));
await save('events', await get('/api/events?limit=100'));
await save('catalog', await get('/api/catalog'));

console.log(`snapshot done · ${def.ids.length} instruments · ${(total / 1024).toFixed(0)} KB total · ${out}`);
