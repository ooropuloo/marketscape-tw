// Client-side landscape: a dynamic definition from /api/landscape (ETFs, singles, frozen positions) plus per-frame snapshots.
import { THEMES, COLLAPSE, amplitudeBand } from './universe.js';

export const BOUNDS = { width: 100, depth: 96, cx: 0, cz: 4 };
export const ETF_COLORS = ['#e0b95a', '#6fd3c9', '#c78bf0', '#f29a6b', '#8fc4ff', '#b4e07a', '#ff8fb1', '#d7d2a3'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export let layout = { stocks: [], sectors: [], etfs: [], ridges: [], stockById: new Map(), definition: null };

function hull(points) { // Andrew monotone chain, then push each vertex 3.2 units away from the centroid
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z); if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = []; for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  const upper = []; for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)]; const cx = h.reduce((a, q) => a + q.x, 0) / h.length, cz = h.reduce((a, q) => a + q.z, 0) / h.length;
  return h.map(q => { const dx = q.x - cx, dz = q.z - cz, d = Math.hypot(dx, dz) || 1; return { x: q.x + dx / d * 3.2, z: q.z + dz / d * 3.2 }; });
}

export function setDefinition(def) {
  const byId = new Map();
  const etfs = def.etfs.map(e => ({ ...e, color: ETF_COLORS[e.slot % ETF_COLORS.length], ridge: def.ridges.find(r => r.id === e.id) ?? null, members: e.holdings.map(h => h.id) }));
  const sectors = [];
  for (const e of etfs) {
    if (!e.visible) continue;
    for (const sec of e.ridge?.sectors ?? []) { const members = e.holdings.filter(h => (h.industryCode ?? '??') === sec.code); sectors.push({ id: `${e.id}:${sec.code}`, etf: e.id, etfName: e.name, name: members[0]?.industryName ?? sec.code, code: sec.code, x: sec.x, z: sec.z, color: e.color, weight: sec.weight, members: members.map(h => [h.id, h.name]), note: `${e.id} · ${sec.weight.toFixed(2)}%`, labelVisible: false }); }
    for (const h of e.holdings) { const p = def.positions[h.id]; if (!p) continue; const s = byId.get(h.id) ?? { id: h.id, name: h.name, x: p.x, z: p.z, industryCode: h.industryCode, industryName: h.industryName, exchange: h.exchange, etfs: [], themes: [], weight: 0, single: false }; s.etfs.push({ id: e.id, name: e.name, weight: h.weight, color: e.color }); s.weight = Math.max(s.weight, h.weight); s.sector ??= `${e.id}:${h.industryCode ?? '??'}`; s.color ??= e.color; byId.set(h.id, s); }
  }
  for (const t of THEMES) { const members = []; t.members.forEach(([id, name], i) => { const existing = byId.get(id); if (existing) { existing.themes.push(t.id); members.push([id, name]); return; } byId.set(id, { id, name, x: t.x + (i === 0 ? 0 : Math.cos(i * 2.3) * 3.6), z: t.z + (i === 0 ? 0 : Math.sin(i * 2.3) * 3.2), industryName: t.name, etfs: [], themes: [t.id], weight: null, sector: t.id, color: t.color, single: false }); members.push([id, name]); });
    sectors.push({ id: t.id, etf: null, name: t.name, x: t.x, z: t.z, color: t.color, weight: null, members, note: '市場區段', labelVisible: true }); }
  const singles = []; for (const s of def.singles) { if (!s.visible) continue; const p = def.positions[s.id]; if (byId.has(s.id) || !p) continue; byId.set(s.id, { id: s.id, name: s.name, x: p.x, z: p.z, industryCode: s.industryCode, industryName: s.industryName, exchange: s.exchange, etfs: [], themes: [], weight: null, sector: 'watch', color: '#b6c7c7', single: true }); singles.push([s.id, s.name]); }
  if (singles.length) sectors.push({ id: 'watch', etf: null, name: '自選個股', x: -20, z: 46, color: '#b6c7c7', weight: null, members: singles, note: '單獨山峰', labelVisible: true });
  const stocks = [...byId.values()].map(s => ({ ...s, sectorName: sectors.find(g => g.id === s.sector)?.name ?? s.industryName, width: s.weight ? .62 + Math.sqrt(s.weight) * .31 : 1.6 }));
  for (const e of etfs) { e.hull = e.visible ? hull(e.members.map(id => byId.get(id)).filter(Boolean)) : []; e.shared = e.members.filter(id => byId.get(id)?.etfs.length > 1).length; }
  layout = { stocks, sectors, etfs, ridges: def.ridges.filter(r => etfs.find(e => e.id === r.id)?.visible), stockById: new Map(stocks.map(s => [s.id, s])), definition: def };
  return layout;
}

export const gauss = (x, z, items) => { let h = 0; for (const s of items) { const dx = x - s.x, dz = z - s.z, w2 = s.width * s.width; if (dx * dx + dz * dz > w2 * 10) continue; h += s.height * Math.exp(-(dx * dx + dz * dz) / (2 * w2)); } return h; };
export const spineItems = () => layout.ridges.flatMap(r => r.spine.map(p => ({ x: p.x, z: p.z, height: 1.05, width: 2.5 })));
export function terrainHeight(x, z, snap) { return gauss(x, z, snap.stocks) + gauss(x, z, spineItems()) * .3; }
export function fieldValue(x, z, items, key) { let v = 0, w = 0; for (const s of items) { const d2 = (x - s.x) ** 2 + (z - s.z) ** 2; if (d2 > 160) continue; const a = Math.exp(-d2 / 18); v += (s[key] ?? 0) * a; w += a; } return w > .03 ? v / w : 0; }
export function heightFor(s, change) { const c = change == null ? 0 : clamp(change, -10, 10); return s.weight ? Math.max(.15, .3 + Math.sqrt(s.weight) * .95 + c * .35) : Math.max(.15, 2 + c * .45); }

// data: /api/intraday (1d) or /api/history. quotes: Map id→quote (live frame). holders: Map id→{big}. shorts: Map id→{daysToCover,…}
export function buildSnapshot({ range, frame, data, quotes = new Map(), holders = new Map(), shorts = new Map(), live = false }) {
  const n = data?.labels?.length ?? 0; const f = clamp(frame, 0, Math.max(0, n - 1));
  const items = layout.stocks.map(s => {
    const row = data?.series?.[s.id]; const q = live ? quotes.get(s.id) : null;
    let price = null, change = null, volume = null, amplitude = null, estimated = false, cum = null, previousClose = null, high = null, low = null, flow = 0, insti = null, shortShares = null;
    if (range === '1d') {
      price = q?.last ?? row?.last?.[f] ?? null; change = q?.changePct ?? row?.changePct?.[f] ?? null; volume = q?.volumeLots ?? row?.volume?.[f] ?? null; estimated = q ? !!q.estimated : !!row?.est?.[f];
      previousClose = q?.previousClose ?? (price != null && change != null ? price / (1 + change / 100) : null); high = q?.high ?? null; low = q?.low ?? null; if (volume != null) volume *= 1000;
      amplitude = high != null && low != null && previousClose > 0 ? (high - low) / previousClose * 100 : null; cum = change;
      if (row?.flow) for (let i = 0; i <= f; i++) flow += row.flow[i] ?? 0; flow /= 1e8; // cumulative aggressor-signed turnover, 億
    } else if (row) {
      price = row.close[f]; change = row.change[f]; volume = row.volume[f]; high = row.high[f]; low = row.low[f]; insti = row.insti?.[f] ?? null; shortShares = row.shortShares?.[f] ?? null;
      amplitude = high != null && low != null && price > 0 ? (high - low) / price * 100 : null; cum = row.baseline > 0 && price != null ? +((price / row.baseline - 1) * 100).toFixed(2) : null;
      flow = insti?.total != null && price != null ? insti.total * price / 1e8 : 0; // 三大法人淨買賣超 × 收盤, 億
    }
    const h = holders.get(s.id), sh = shorts.get(s.id);
    const avgVol = row?.avgVolume ?? sh?.avgVolume ?? null; const shortNow = shortShares ?? sh?.shortShares ?? null; const daysToCover = shortNow != null && avgVol > 0 ? shortNow / avgVol : sh?.daysToCover ?? null;
    const band = amplitudeBand(amplitude);
    const heat = change == null ? 0 : clamp(50 + change * 8, 0, 100), volatility = amplitude == null ? 0 : clamp(amplitude * 12, 0, 100), pressure = h?.big ?? 0;
    const amount = price != null && volume != null ? price * volume : 0;
    return { ...s, price, change, cum, volume, amount, flow, insti, high, low, previousClose, amplitude, band, estimated, heat, volatility, pressure, holders: h ?? null, shortShares: shortNow, daysToCover, dig: daysToCover == null ? 0 : clamp((daysToCover - 3) / 6, 0, 1),
      height: heightFor(s, change), contribution: s.etfs.map(e => ({ etf: e.id, value: change != null ? e.weight * change / 100 : null })), collapse: change != null && change <= COLLAPSE[range], quote: q ?? null };
  });
  const byId = new Map(items.map(s => [s.id, s]));
  const groupsOut = layout.sectors.map(g => {
    const members = g.members.map(([id]) => byId.get(id)).filter(Boolean), valid = members.filter(m => m.change != null);
    const wsum = valid.reduce((a, m) => a + (m.weight ?? 1), 0), wmean = k => valid.length ? valid.reduce((a, m) => a + (m.weight ?? 1) * (m[k] ?? 0), 0) / wsum : null;
    const amp = members.filter(m => m.amplitude != null);
    return { ...g, membersData: members, change: wmean('change'), heat: wmean('heat') ?? 0, amplitude: amp.length ? amp.reduce((a, m) => a + m.amplitude, 0) / amp.length : null, volatility: valid.length ? valid.reduce((a, m) => a + m.volatility, 0) / valid.length : 0,
      pressure: members.length ? members.reduce((a, m) => a + m.pressure, 0) / members.length : 0, flow: members.reduce((a, m) => a + m.flow, 0), amount: members.reduce((a, m) => a + m.amount, 0), collapses: members.filter(m => m.collapse).length, dig: members.reduce((a, m) => a + m.dig, 0) };
  });
  const withFlow = groupsOut.filter(g => g.flow !== 0);
  const source = withFlow.length ? withFlow.reduce((a, b) => a.flow < b.flow ? a : b) : null, mouth = withFlow.length ? withFlow.reduce((a, b) => a.flow > b.flow ? a : b) : null;
  const stormSector = groupsOut.filter(g => g.amplitude != null).sort((a, b) => b.amplitude - a.amplitude)[0] ?? null;
  const etfsOut = layout.etfs.map(e => { const members = e.members.map(id => byId.get(id)).filter(Boolean); const covered = members.filter(m => m.change != null); const w = h => e.holdings.find(x => x.id === h.id)?.weight ?? 0;
    const row = data?.series?.[e.id]; const q = quotes.get(e.id) ?? null; const price = range === '1d' ? (live ? q?.last : null) ?? row?.last?.[f] ?? null : row?.close?.[f] ?? null; const change = range === '1d' ? (live ? q?.changePct : null) ?? row?.changePct?.[f] ?? null : row?.change?.[f] ?? null;
    return { ...e, price, change, quote: q, estimated: live ? !!q?.estimated : !!row?.est?.[f], contribution: covered.reduce((a, m) => a + w(m) * m.change / 100, 0), coveredWeight: covered.reduce((a, m) => a + w(m), 0), collapses: members.filter(m => m.collapse).length }; });
  const valid = items.filter(s => s.change != null);
  return { range, frame: f, frames: n, label: data?.labels?.[f] ?? '—', date: range === '1d' ? data?.date ?? null : data?.dates?.[f] ?? null, live, stocks: items, sectors: groupsOut, etfs: etfsOut, ridges: layout.ridges,
    river: source && mouth && source !== mouth && source.flow < 0 && mouth.flow > 0 ? { from: source, to: mouth, amount: mouth.flow - source.flow, note: data?.flowNote ?? '', estimate: range === '1d' } : null,
    storm: stormSector && stormSector.amplitude > 0 ? { sector: stormSector, intensity: clamp(stormSector.amplitude / 6, 0, 1) } : null,
    collapses: items.filter(s => s.collapse), threshold: COLLAPSE[range], flowNote: data?.flowNote ?? null,
    hottest: [...valid].sort((a, b) => b.change - a.change)[0] ?? null, coldest: [...valid].sort((a, b) => a.change - b.change)[0] ?? null, quoteCount: valid.length, source: data?.source ?? null };
}
