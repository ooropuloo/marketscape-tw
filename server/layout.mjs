// Deterministic layout: one hill per stock. Each ETF owns a ridge (anchor + direction); a stock's home is the
// weight-weighted mean of its position on every ridge it belongs to, so shared holdings sit between ranges.
// Existing positions are frozen; only new stocks are placed and relaxed against everything else.
export const MAP = { halfW: 48, halfD: 46, cz: 4 };
const ANCHORS = [ // slot → [x, z, angle]. ETF band is the northern half (z −40…22); market districts live at z ≥ 28 (src/universe.js).
  [0, -12, 0], [-24, -31, 0.22], [24, -31, -0.22], [-27, 8, 0.18], [27, 8, -0.18], [0, 22, 0], [-30, -20, 0.5], [30, -20, -0.5]];
export const WATCH_ROW = { x0: -44, z: 46, step: 5.2 };

const industryOrder = holdings => Object.values(holdings.reduce((all, h) => { (all[h.industryCode ?? '??'] ??= { code: h.industryCode ?? '??', weight: 0, items: [] }).items.push(h); all[h.industryCode ?? '??'].weight += h.weight; return all; }, {})).sort((a, b) => b.weight - a.weight);

// Positions for one ETF ridge, keyed by stock id. Mirrors the v1 0050 layout (industries along a sine spine, 3-column offsets).
export function ridgePositions(etf, slot) {
  const [ax, az, angle] = ANCHORS[slot % ANCHORS.length]; const groups = industryOrder(etf.holdings); const n = groups.length;
  const L = Math.max(18, Math.min(52, 8 + Math.sqrt(etf.holdings.length) * 6)); const cos = Math.cos(angle), sin = Math.sin(angle);
  const spine = Array.from({ length: 49 }, (_, i) => { const t = i / 48 - .5; const u = t * L, v = Math.sin((t + .5) * Math.PI * 1.45) * 3.6 - .6; return { x: ax + u * cos - v * sin, z: az + u * sin + v * cos }; });
  const at = t => { const u = t * L, v = Math.sin((t + .5) * Math.PI * 1.45) * 3.6 - .6; return { x: ax + u * cos - v * sin, z: az + u * sin + v * cos }; };
  const pos = new Map(); const sectors = [];
  groups.forEach((g, gi) => { const t = n === 1 ? 0 : gi / (n - 1) - .5; const c = at(t); sectors.push({ code: g.code, x: c.x, z: c.z, weight: +g.weight.toFixed(2), count: g.items.length });
    g.items.sort((a, b) => b.weight - a.weight).forEach((h, i) => { const row = Math.floor(i / 3), col = i % 3; const ox = i === 0 ? 0 : (col - 1) * 1.3, oz = i === 0 ? 0 : (row + 1) * 1.9 * (i % 2 ? 1 : -1); pos.set(h.id, { x: c.x + ox * cos - oz * sin, z: c.z + ox * sin + oz * cos }); }); });
  return { anchor: { x: ax, z: az, angle }, spine, sectors, pos };
}

export function computeLayout({ etfs, singles = [], fixed = new Map() }) {
  const ridges = etfs.map((e, i) => ({ id: e.id, slot: e.slot ?? i, ...ridgePositions(e, e.slot ?? i) }));
  const home = new Map(); // id → {x,z,wsum}
  for (const r of ridges) { const etf = etfs.find(e => e.id === r.id); for (const h of etf.holdings) { const p = r.pos.get(h.id); const w = Math.max(.05, h.weight); const cur = home.get(h.id) ?? { x: 0, z: 0, w: 0 }; home.set(h.id, { x: cur.x + p.x * w, z: cur.z + p.z * w, w: cur.w + w }); } }
  const out = new Map(); for (const [id, h] of home) out.set(id, { x: h.x / h.w, z: h.z / h.w, movable: !fixed.has(id) });
  singles.forEach((id, i) => { if (!out.has(id)) out.set(id, { x: WATCH_ROW.x0 + (i % 15) * WATCH_ROW.step, z: WATCH_ROW.z + Math.floor(i / 15) * 3.4, movable: !fixed.has(id) }); });
  for (const [id, p] of fixed) if (out.has(id)) Object.assign(out.get(id), { x: p.x, z: p.z, movable: false });
  // Relax: movable points repel everything closer than 2.3 units, pulled back to their home.
  const ids = [...out.keys()], homes = new Map(ids.map(id => [id, { x: out.get(id).x, z: out.get(id).z }]));
  for (let iter = 0; iter < 60; iter++) {
    for (const a of ids) { const pa = out.get(a); if (!pa.movable) continue; let fx = (homes.get(a).x - pa.x) * .08, fz = (homes.get(a).z - pa.z) * .08;
      for (const b of ids) { if (a === b) continue; const pb = out.get(b); const dx = pa.x - pb.x, dz = pa.z - pb.z, d = Math.hypot(dx, dz) || .01; if (d < 2.3) { const push = (2.3 - d) / d * .5; fx += dx * push; fz += dz * push; } }
      pa.x = Math.max(-MAP.halfW, Math.min(MAP.halfW, pa.x + fx)); pa.z = Math.max(MAP.cz - MAP.halfD, Math.min(MAP.cz + MAP.halfD, pa.z + fz)); }
  }
  return { positions: out, ridges: ridges.map(r => ({ id: r.id, slot: r.slot, anchor: r.anchor, spine: r.spine, sectors: r.sectors })) };
}
