// Watch list + ETF holdings + frozen layout → the landscape definition the client renders.
import { FUND, THEMES } from '../src/universe.js';
import { computeLayout } from './layout.mjs';
import { fetchETF, looksLikeETF } from './etf.mjs';

export const MAX_INSTRUMENTS = 300;

export function createUniverse(store, catalog, { fetch = fetchETF, log = console.log } = {}) {
  const directory = new Map(catalog.map(s => [s.id, s]));
  const listeners = new Set();
  // Seed: the bundled 0050 snapshot becomes the first ETF on first run.
  if (!store.etf(FUND.id)) { store.saveETF({ id: FUND.id, name: FUND.name, issuer: 'yuanta', asOf: FUND.asOf, retrievedAt: FUND.retrievedAt, source: FUND.source, stockWeightTotal: FUND.stockWeightTotal, holdings: FUND.holdings }); store.addWatch(FUND.id, 'etf'); }

  function themeMembers() { return THEMES.flatMap(t => t.members.map(([id]) => id)); }
  function definition() {
    const watch = store.watch(); const etfs = store.etfs().map(e => ({ ...e, visible: watch.find(w => w.id === e.id)?.visible !== 0, holdings: e.holdings.map(h => ({ ...h, ...(directory.get(h.id) ? { industryCode: directory.get(h.id).industryCode, industryName: directory.get(h.id).industryName, exchange: directory.get(h.id).exchange } : {}) })) }));
    const singles = watch.filter(w => w.kind === 'stock').map(w => ({ id: w.id, visible: w.visible !== 0, ...(directory.get(w.id) ?? { name: w.id }) }));
    const layoutIn = computeLayout({ etfs, singles: singles.map(s => s.id), fixed: store.layout() });
    const fresh = [...layoutIn.positions].filter(([, p]) => p.movable); if (fresh.length) store.saveLayout(fresh);
    const positions = Object.fromEntries([...layoutIn.positions].map(([id, p]) => [id, { x: +p.x.toFixed(3), z: +p.z.toFixed(3) }]));
    const ids = new Set([...etfs.filter(e => e.visible).flatMap(e => e.holdings.map(h => h.id)), ...singles.filter(s => s.visible).map(s => s.id), ...themeMembers(), ...etfs.map(e => e.id)]);
    return { etfs, singles, themes: THEMES, ridges: layoutIn.ridges, positions, ids: [...ids].filter(id => directory.has(id)), watch, max: MAX_INSTRUMENTS };
  }
  const notify = () => { const d = definition(); for (const fn of listeners) fn(d); return d; };

  async function add(id) {
    id = String(id).trim().toUpperCase();
    if (!/^[0-9A-Z]{4,6}$/.test(id)) throw new Error('代碼格式不對');
    const meta = directory.get(id); if (!meta) throw new Error(`${id} 不在證交所／櫃買公司名單中`);
    const current = definition(); if (current.ids.length >= MAX_INSTRUMENTS) throw new Error(`已達 ${MAX_INSTRUMENTS} 檔上限，請先移除一些`);
    if (meta.industryCode === 'ETF' || looksLikeETF(id)) {
      let etf;
      try { etf = await fetch(id); } catch (e) { throw new Error(`${id} ${meta.name}：抓不到官方持股（${e.message}）。第一版只支援元大系列 ETF；其他發行商可用 JSON 匯入。`); }
      etf.holdings = etf.holdings.filter(h => directory.has(h.id)); if (etf.holdings.length < 3) throw new Error(`${id} 的持股多為非台股，無法畫成山脈`);
      store.saveETF(etf); store.addWatch(id, 'etf'); log('[universe] ETF', id, etf.name, etf.holdings.length, 'holdings', etf.asOf);
      return { kind: 'etf', id, name: etf.name, holdings: etf.holdings.length, asOf: etf.asOf, definition: notify() };
    }
    store.addWatch(id, 'stock'); log('[universe] stock', id, meta.name);
    return { kind: 'stock', id, name: meta.name, definition: notify() };
  }
  function importETF(payload) { // manual JSON for issuers without a scraper: {id,name,asOf,source,holdings:[{id,name,weight,quantity}]}
    if (!payload?.id || !Array.isArray(payload.holdings)) throw new Error('JSON 需要 id 與 holdings[]');
    const holdings = payload.holdings.filter(h => h?.id && directory.has(String(h.id)) && Number(h.weight) > 0).map(h => ({ id: String(h.id), name: h.name ?? directory.get(String(h.id)).name, weight: Number(h.weight), quantity: Number(h.quantity) || null }));
    if (holdings.length < 3) throw new Error('有效持股不足 3 檔');
    const etf = { id: String(payload.id).toUpperCase(), name: payload.name ?? payload.id, issuer: payload.issuer ?? 'manual', asOf: payload.asOf ?? null, retrievedAt: new Date().toISOString(), source: payload.source ?? 'manual-import', stockWeightTotal: +holdings.reduce((a, h) => a + h.weight, 0).toFixed(2), holdings };
    store.saveETF(etf); store.addWatch(etf.id, 'etf'); return { kind: 'etf', id: etf.id, name: etf.name, holdings: holdings.length, definition: notify() };
  }
  function remove(id) {
    if (id === FUND.id) throw new Error('0050 是預設山脈，只能隱藏不能移除');
    const etf = store.etf(id); const before = definition();
    if (etf) store.removeETF(id); store.removeWatch(id);
    const after = definition(); const gone = before.ids.filter(x => !after.ids.includes(x)); if (gone.length) store.dropLayout(gone); // orphan hills lose their frozen spot
    return { removed: id, orphaned: gone, definition: notify() };
  }
  function setVisible(id, visible) { store.setWatchVisible(id, visible); return notify(); }
  async function refreshETF(id) { const etf = await fetch(id); etf.holdings = etf.holdings.filter(h => directory.has(h.id)); store.saveETF(etf); return notify(); }
  return { definition, add, importETF, remove, setVisible, refreshETF, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
