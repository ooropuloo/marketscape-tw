// Thin client for the local observer server, plus a static-snapshot mode for the public GitHub Pages build.
// Live mode works at / (5303) and behind any path-prefixed reverse proxy (e.g. /marketscape/).
// Static mode (vite build --mode static) reads the JSON exported by `npm run snapshot` from ./snapshot/ instead of /api/.
export const STATIC = typeof __STATIC__ !== 'undefined' && __STATIC__ === true;
const base = location.pathname.replace(/\/[^/]*$/, '');
const READ_ONLY = '公開展示版是靜態快照，觀測清單無法修改。要即時資料與加入 ETF，請在本機執行 npm start。';

async function call(path, init) {
  const res = await fetch(base + path, { cache: 'no-store', ...init });
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body?.error ?? `${path}: ${res.statusText}`);
  return body;
}
const post = (path, data) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });
const live = {
  health: () => call('/api/health'),
  landscape: () => call('/api/landscape'),
  quotes: ids => call(`/api/quotes?ids=${ids.join(',')}`),
  history: range => call(`/api/history?range=${range}`),
  intraday: date => call(`/api/intraday${date ? `?date=${date}` : ''}`),
  holders: id => call(`/api/holders${id ? `?id=${id}` : ''}`),
  short: () => call('/api/short'),
  search: q => call(`/api/search?q=${encodeURIComponent(q)}`),
  events: (limit = 20) => call(`/api/events?limit=${limit}`),
  addWatch: id => post('/api/watch', { id }),
  importETF: payload => post('/api/watch/import', payload),
  removeWatch: id => call(`/api/watch/${id}`, { method: 'DELETE' }),
  setVisible: (id, visible) => call(`/api/watch/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible }) }),
  refreshETF: id => post(`/api/watch/${id}/refresh`),
  stream(handlers) {
    if (!('EventSource' in window)) return () => {};
    const es = new EventSource(base + '/api/stream');
    for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, e => { try { fn(JSON.parse(e.data)); } catch {} });
    return () => es.close();
  },
};

// ---------- static snapshot mode ----------
const cache = new Map();
function file(name) {
  if (!cache.has(name)) cache.set(name, fetch(`${base}/snapshot/${name}.json`).then(async res => {
    if (!res.ok) throw new Error(`快照 ${name}.json 不存在（${res.status}）`);
    return res.json();
  }).catch(e => { cache.delete(name); throw e; }));
  return cache.get(name);
}
const readOnly = async () => { throw new Error(READ_ONLY); };
const snapshot = {
  health: () => file('health'),
  landscape: () => file('landscape'),
  quotes: async ids => { const r = await file('quotes'); const want = new Set(ids); return { ...r, quotes: r.quotes.filter(q => want.has(q.id)) }; },
  history: range => file(`history-${range}`),
  intraday: () => file('intraday'),
  holders: async id => { if (!id) return file('holders'); const all = await file('holder-detail'); if (!all[id]) throw new Error(`快照沒有 ${id} 的股權分散資料`); return all[id]; },
  short: () => file('short'),
  search: async q => {
    q = String(q ?? '').trim().toLowerCase(); if (q.length < 2) return { items: [] };
    const [catalog, def] = await Promise.all([file('catalog'), file('landscape')]);
    return { items: catalog.instruments.filter(s => s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)).slice(0, 12).map(s => ({ ...s, inUniverse: def.ids.includes(s.id), isETF: s.industryCode === 'ETF' })) };
  },
  events: async (limit = 20) => { const r = await file('events'); return { events: (r.events ?? []).slice(0, limit) }; },
  addWatch: readOnly, importETF: readOnly, removeWatch: readOnly, setVisible: readOnly, refreshETF: readOnly,
  stream: () => () => {},
};

export const api = STATIC ? snapshot : live;
