// TDCC shareholder distribution (集保戶股權分散表), weekly CSV. Kept only for the landscape universe.
import { getPublicText } from './http-source.mjs';

export const TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
export const LEVELS = ['1-999 股', '1-5 張', '5-10 張', '10-15 張', '15-20 張', '20-30 張', '30-40 張', '40-50 張', '50-100 張', '100-200 張', '200-400 張', '400-600 張', '600-800 張', '800-1000 張', '1000 張以上'];

export function parseTDCC(csv, wanted) {
  const rows = []; let date = null;
  for (const line of csv.split(/\r?\n/)) {
    const c = line.replace(/^﻿/, '').split(',');
    if (c.length < 6 || !/^\d{8}$/.test(c[0])) continue;
    const id = c[1].trim(); if (!wanted.has(id)) continue;
    date ??= `${c[0].slice(0, 4)}-${c[0].slice(4, 6)}-${c[0].slice(6, 8)}`;
    rows.push({ id, date, level: Number(c[2]), holders: Number(c[3]), shares: Number(c[4]), pct: Number(c[5]) });
  }
  return { date, rows };
}

export function createHolderService(store, universeIds, { fetchText = getPublicText, log = console.log } = {}) {
  const wanted = new Set(universeIds);
  const status = { date: store.getMeta('tdcc_date'), fetchedAt: store.getMeta('tdcc_fetched_at'), error: null, running: false };
  async function refresh(force = false) {
    if (status.running) return;
    const scoped = store.getMeta('tdcc_scope') === String(wanted.size);
    if (!force && scoped && status.fetchedAt && Date.now() - Date.parse(status.fetchedAt) < 6 * 86_400_000) return;
    status.running = true;
    try {
      const { date, rows } = parseTDCC(await fetchText(TDCC_URL, { timeout: 180 }), wanted);
      if (!date || !rows.length) throw new Error('TDCC CSV 沒有可用資料');
      store.upsertHolders(rows); store.setMeta('tdcc_date', date); store.setMeta('tdcc_fetched_at', new Date().toISOString()); store.setMeta('tdcc_scope', String(wanted.size));
      status.date = date; status.fetchedAt = store.getMeta('tdcc_fetched_at'); status.error = null; log('[tdcc]', date, rows.length, 'rows');
    } catch (e) { status.error = e.message; log('[tdcc]', e.message); }
    finally { status.running = false; }
  }
  function distribution(id) {
    const { date, levels } = store.holdersFor(id);
    const rows = levels.filter(l => l.level >= 1 && l.level <= 15).map(l => ({ ...l, label: LEVELS[l.level - 1] }));
    const big = rows.filter(l => l.level >= 12).reduce((a, l) => a + l.pct, 0), retail = rows.filter(l => l.level <= 4).reduce((a, l) => a + l.pct, 0);
    return { id, date, levels: rows, bigHolderPct: +big.toFixed(2), retailPct: +retail.toFixed(2), holders: rows.reduce((a, l) => a + l.holders, 0), source: TDCC_URL };
  }
  return { refresh, distribution, status, summary: ids => ({ date: status.date, items: store.bigHolders(ids) }) };
}
