import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTSE, parseTPEX, recentWeekdays, monthEndCandidates, createHistoryService } from '../server/history.mjs';
import { normalizeQuote, collapseTrigger, intradayFrames, createQuoteService } from '../server/quotes.mjs';
import { parseTDCC } from '../server/tdcc.mjs';
import { openDatabase } from '../server/db.mjs';
import { buildSnapshot, setDefinition, layout, terrainHeight } from '../src/landscape.js';
import { UNIVERSE_IDS, COLLAPSE, FUND } from '../src/universe.js';
import { computeLayout } from '../server/layout.mjs';

const NOON = Date.parse('2026-09-09T04:00:00Z'); // 12:00 Taipei, Wednesday

test('parseTSE reads the all-stocks table and signs the change', () => {
  const rows = parseTSE({ stat: 'OK', tables: [{ fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差'], data: [
    ['2330', '台積電', '28,931,697', '106,768', '71,769,230,740', '2,465.00', '2,505.00', '2,460.00', '2,470.00', '<p style= color:red>+</p>', '10.00'],
    ['2881', '富邦金', '1', '1', '1', '150', '150', '149', '149.00', '<p style= color:green>-</p>', '1.00'],
    ['0000', 'X', '--', '--', '--', '--', '--', '--', '--', '<p> </p>', '0.00']] }] });
  assert.equal(rows.length, 2); assert.equal(rows[0].close, 2470); assert.equal(rows[0].change, 10); assert.equal(rows[0].volume, 28931697); assert.equal(rows[1].change, -1);
});
test('parseTPEX reads signed change and volume columns', () => {
  const rows = parseTPEX({ stat: 'ok', tables: [{ data: [['4979', '華星光', '600.00', '-9.00 ', '609.00', '613.00', '595.00', '600.1', '2,166,000', '1,299,680,000', '4,623'], ['9999', 'X', '---', '', '', '', '', '', '', '', '']] }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].change, -9); assert.equal(rows[0].volume, 2166000); assert.equal(rows[0].high, 613);
});
test('candidate dates skip weekends and exclude today before publication', () => {
  const days = recentWeekdays(NOON, 10); assert.equal(days[0], '2026-09-08'); assert.ok(!days.includes('2026-09-06') && !days.includes('2026-09-05'));
  const late = recentWeekdays(Date.parse('2026-09-09T08:00:00Z'), 10); assert.equal(late[0], '2026-09-09');
  const months = monthEndCandidates(NOON, 2); assert.equal(months[0][0], '2026-08-31'); assert.equal(months[1][0], '2026-07-31'); assert.equal(months[0].length, 5);
});
test('normalizeQuote falls back z → pz → retained → bid/ask midpoint', () => {
  const base = { c: '2330', n: '台積電', ex: 'tse', d: '20260909', t: '12:00:00', tlong: String(NOON), y: '2470.0000', b: '2465.0000_2460.0000_', a: '2470.0000_2475.0000_', h: '2490', l: '2460', o: '2480', v: '10000', ts: '0' };
  const trade = normalizeQuote({ ...base, z: '2480.0000' }, null, NOON); assert.equal(trade.last, 2480); assert.equal(trade.availability, 'trade'); assert.equal(trade.changePct, +((10 / 2470) * 100).toFixed(4));
  const pz = normalizeQuote({ ...base, z: '-', pz: '2475.0000' }, null, NOON); assert.equal(pz.last, 2475); assert.equal(pz.availability, 'previous-trade');
  const retained = normalizeQuote({ ...base, z: '-', pz: '-' }, trade, NOON); assert.equal(retained.last, 2480); assert.equal(retained.availability, 'retained');
  const est = normalizeQuote({ ...base, z: '-', pz: '-' }, null, NOON); assert.equal(est.last, 2467.5); assert.equal(est.estimated, true); assert.equal(est.availability, 'estimated');
  const indicative = normalizeQuote({ ...base, z: '2400', ts: '1' }, null, NOON); assert.equal(indicative.last, null); assert.equal(indicative.indicative, true);
});
test('collapseTrigger fires once at the daily threshold and on fast drops', () => {
  const q = (last, changePct, tradeAt) => ({ last, changePct, tradeAt, error: null, indicative: false });
  assert.ok(collapseTrigger(q(100, -4.9, '2026-09-09T01:00:00Z'), q(94, -5.2, '2026-09-09T01:01:00Z')));
  assert.equal(collapseTrigger(q(94, -5.2, '2026-09-09T01:00:00Z'), q(93, -5.5, '2026-09-09T01:01:00Z')), null);
  assert.ok(collapseTrigger(q(100, 1, '2026-09-09T01:00:00Z'), q(97.5, -1.5, '2026-09-09T01:02:00Z')));
  assert.equal(collapseTrigger(q(100, 1, '2026-09-09T01:00:00Z'), q(97.5, -1.5, '2026-09-09T02:00:00Z')), null);
});
test('intradayFrames buckets 60 s samples into 55 five-minute frames and carries values forward', () => {
  const day = '2026-09-09', at = hm => Date.parse(`${day}T${hm}:00+08:00`);
  const f = intradayFrames([{ id: '2330', ts: at('09:31'), last: 100, change_pct: 1 }, { id: '2330', ts: at('09:32'), last: 101, change_pct: 2 }, { id: '2330', ts: at('09:47'), last: 99, change_pct: -1 }, { id: '2454', ts: at('09:47'), last: 50, change_pct: 0 }], day);
  assert.equal(f.labels.length, 55); assert.equal(f.labels[0], '09:00'); assert.equal(f.labels[54], '13:30');
  assert.equal(f.firstFrame, 6); assert.equal(f.lastFrame, 9); assert.equal(f.series['2330'].last[6], 101); assert.equal(f.series['2330'].last[7], 101); assert.equal(f.series['2330'].last[9], 99); assert.equal(f.series['2330'].last[10], null);
});
test('quote service stores intraday samples and events in SQLite', async () => {
  const store = openDatabase(':memory:'); let call = 0;
  const raw = z => ({ rtcode: '0000', msgArray: [{ c: '2330', n: '台積電', ex: 'tse', d: '20260909', t: '12:00:00', tlong: String(NOON), y: '100', z, b: '95_', a: '96_', v: '1', ts: '0' }] });
  const svc = createQuoteService([{ id: '2330', name: '台積電', exchange: 'tse' }], ['2330'], { store, fetchJSON: async () => raw(++call === 1 ? '100' : '94'), now: () => NOON, log: () => {} });
  await svc.refresh(true); await svc.refresh(true);
  assert.equal(store.samplesForDate('2026-09-09').length, 1); // same ts → replaced
  assert.equal(store.recentEvents().length, 1); assert.equal(store.recentEvents()[0].detail, `日跌幅達 ${COLLAPSE['1d']}%`);
  const r = await svc.getQuotes(['2330']); assert.equal(r.quotes[0].last, 94); store.close();
});
test('history frames from SQLite: 5d / 1m consecutive days, 1y month ends', async () => {
  const store = openDatabase(':memory:'); const svc = createHistoryService(store, ['2330'], { fetchJSON: async () => ({ stat: 'OK', tables: [] }), gapMs: 0, log: () => {} });
  const dates = ['2026-07-30', '2026-07-31', '2026-08-03', '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08'];
  store.upsertBars(dates.map((d, i) => ({ id: '2330', date: d, open: 1, high: 2, low: 1, close: 100 + i, change: 1, volume: 10 }))); for (const d of dates) store.markDay(d, 1, 1);
  const f5 = svc.frames('5d', new Set(['2330'])); assert.deepEqual(f5.dates, dates.slice(-5)); assert.equal(f5.series['2330'].close.length, 5); assert.equal(f5.series['2330'].baseline, 105);
  const fy = svc.frames('1y', new Set(['2330'])); assert.deepEqual(fy.dates, ['2026-08-31', '2026-09-08']); assert.equal(fy.series['2330'].change[0], +((104 / 101 - 1) * 100).toFixed(4));
  store.close();
});
test('parseTDCC keeps only wanted ids and reads the date', () => {
  const r = parseTDCC('資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%\n20260904,2330,1,2503823,292113655,1.12\n20260904,9999,1,1,1,1\n', new Set(['2330']));
  assert.equal(r.date, '2026-09-04'); assert.equal(r.rows.length, 1); assert.equal(r.rows[0].pct, 1.12);
});
test('landscape: one hill per stock, collapse flag per range threshold', () => {
  const etf = { id: FUND.id, name: FUND.name, slot: 0, visible: true, asOf: FUND.asOf, holdings: FUND.holdings };
  const l = computeLayout({ etfs: [etf], singles: [] });
  setDefinition({ etfs: [etf], singles: [], ridges: l.ridges, positions: Object.fromEntries([...l.positions].map(([id, p]) => [id, { x: p.x, z: p.z }])), ids: UNIVERSE_IDS, max: 300 });
  assert.equal(layout.stocks.length, UNIVERSE_IDS.length - 1); assert.ok(layout.stocks.every(s => Number.isFinite(s.x) && Number.isFinite(s.z)));
  const data = { labels: ['09/07', '09/08'], dates: ['2026-09-07', '2026-09-08'], series: { '2330': { close: [100, 94], change: [1, -6], volume: [1, 1], high: [101, 96], low: [99, 93], baseline: 99 } } };
  const snap = buildSnapshot({ range: '5d', frame: 1, data }); const tsmc = snap.stocks.find(s => s.id === '2330');
  assert.equal(tsmc.collapse, true); assert.equal(tsmc.change, -6); assert.equal(tsmc.band.name, '高波動'); assert.ok(tsmc.height < buildSnapshot({ range: '5d', frame: 0, data }).stocks.find(s => s.id === '2330').height);
  assert.equal(snap.collapses.length, 1); assert.equal(snap.sectors.length, layout.sectors.length); assert.ok(terrainHeight(tsmc.x, tsmc.z, snap) > 0); assert.equal(snap.etfs[0].id, FUND.id);
  const y = buildSnapshot({ range: '1y', frame: 1, data: { ...data, series: { '2330': { ...data.series['2330'], change: [1, -10] } } } }); assert.equal(y.stocks.find(s => s.id === '2330').collapse, false);
});
