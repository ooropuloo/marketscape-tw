import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYuanta } from '../server/etf.mjs';
import { parseT86, parseTPEXInsti, parseMargin, parseSBL, parseTPEXMargin, parseTPEXSBL } from '../server/flows.mjs';
import { computeLayout, ridgePositions, MAP } from '../server/layout.mjs';
import { tradeDirection, intradayFrames } from '../server/quotes.mjs';
import { openDatabase } from '../server/db.mjs';
import { createUniverse } from '../server/universe.mjs';

const catalog = JSON.parse(readFileSync(new URL('../src/datasets/instruments.json', import.meta.url), 'utf8')).instruments;
const fund = JSON.parse(readFileSync(new URL('../src/datasets/0050.json', import.meta.url), 'utf8'));

test('parseYuanta reads the Nuxt payload: holdings, NAV date, name', () => {
  const html = `<html><head><title>(0056)元大台灣高股息證券投資信託基金 - 持股比重 | 元大投信</title></head><body><script>window.__NUXT__=(function(a,b){return {data:[{fileLinkData:{NAV_DATE:"2026/09/08"},weightData:{FundWeights:{Summary:{code:b,name:"元大高股息",fundsize:100},StockWeights:[{code:"2330",name:"台積電",weights:55,qty:100},{code:"2454",name:a,weights:4.2,qty:50},{code:"2317",name:"鴻海",weights:3.1,qty:10}]}}}]}}("聯發科","0056"));</script></body></html>`;
  const etf = parseYuanta(html, '0056');
  assert.equal(etf.asOf, '2026-09-08'); assert.equal(etf.name, '元大台灣高股息'); assert.equal(etf.holdings.length, 3); assert.equal(etf.holdings[1].name, '聯發科'); assert.equal(etf.stockWeightTotal, 62.3);
  assert.throws(() => parseYuanta('<html>no data</html>', '0000'), /找不到頁面資料/);
});
test('institutional and short-interest parsers pick the right columns', () => {
  const t86 = parseT86({ stat: 'OK', tables: [{ fields: ['證券代號', '證券名稱', 'a', 'b', '外陸資買賣超股數(不含外資自營商)', 'c', 'd', 'e', 'f', 'g', '投信買賣超股數', '自營商買賣超股數', 'h', 'i', 'j', 'k', 'l', 'm', '三大法人買賣超股數'], data: [['2330', '台積電', '', '', '1,000', '', '', '', '', '', '200', '-50', '', '', '', '', '', '', '1,150']] }] });
  assert.deepEqual(t86, [{ id: '2330', foreign: 1000, trust: 200, dealer: -50, total: 1150 }]);
  const otc = parseTPEXInsti({ stat: 'ok', tables: [{ data: [['4979', '華星光', ...Array(8).fill('0'), '5,000', '0', '0', '100', '0', '0', '0', '0', '0', '0', '0', '0', '-300', '4,800']] }] });
  assert.deepEqual(otc, [{ id: '4979', foreign: 5000, trust: 100, dealer: -300, total: 4800 }]);
  const margin = parseMargin({ stat: 'OK', tables: [{ fields: ['代號', '名稱', '買進', '賣出', '現金償還', '前日餘額', '今日餘額', '次一營業日限額', '買進', '賣出', '現券償還', '前日餘額', '今日餘額', '次一營業日限額', '資券互抵', '註記'], data: [['2330', '台積電', '1', '1', '0', '10', '10', '100', '5', '2', '0', '120', '123', '999', '0', '']] }] });
  assert.deepEqual(margin, [{ id: '2330', marginShortLots: 123 }]);
  const sbl = parseSBL({ stat: 'OK', tables: [{ fields: ['代號', '名稱', '前日餘額', '賣出', '買進', '現券', '今日餘額', '次一營業日限額', '前日餘額', '當日賣出', '當日還券', '當日調整', '當日餘額', '次一營業日可限額', '備註'], data: [['2330', '台積電', '0', '0', '0', '0', '0', '1', '2,000', '0', '0', '0', '2,500', '1', '']] }] });
  assert.deepEqual(sbl, [{ id: '2330', sblShares: 2500 }]);
  assert.deepEqual(parseTPEXMargin({ stat: 'ok', tables: [{ data: [['4979', 'x', ...Array(12).fill('0'), '77', '0', '0', '0', '0', '']] }] }), [{ id: '4979', marginShortLots: 77 }]);
  assert.deepEqual(parseTPEXSBL({ stat: 'ok', tables: [{ data: [['4979', 'x', ...Array(10).fill('0'), '9,000', '0', '']] }] }), [{ id: '4979', sblShares: 9000 }]);
});
test('tradeDirection: at/above previous ask = buyer, at/below previous bid = seller', () => {
  const prev = { last: 100, bid: 99.5, ask: 100, sourceDate: 'd' };
  assert.equal(tradeDirection(prev, { last: 100, sourceDate: 'd' }), 1); assert.equal(tradeDirection(prev, { last: 99.5, sourceDate: 'd' }), -1); assert.equal(tradeDirection(prev, { last: 99.8, sourceDate: 'd' }), -1);
  assert.equal(tradeDirection(prev, { last: 101, estimated: true, sourceDate: 'd' }), 0); assert.equal(tradeDirection(null, { last: 1 }), 0);
});
test('intradayFrames accumulates signed incremental turnover per bucket', () => {
  const day = '2026-09-09', at = hm => Date.parse(`${day}T${hm}:00+08:00`);
  const f = intradayFrames([{ id: '2330', ts: at('09:31'), last: 100, volume: 10, dir: 1 }, { id: '2330', ts: at('09:32'), last: 100, volume: 15, dir: 1 }, { id: '2330', ts: at('09:33'), last: 99, volume: 18, dir: -1 }], day);
  assert.equal(f.series['2330'].flow[6], 5 * 1000 * 100 - 3 * 1000 * 99); assert.equal(f.series['2330'].flow[7], 0);
});
test('layout: one position per stock, shared holdings sit between ridges, frozen positions stay', () => {
  const a = { id: 'A', slot: 0, holdings: [{ id: '1', weight: 10, industryCode: '24' }, { id: '2', weight: 5, industryCode: '24' }, { id: '3', weight: 5, industryCode: '17' }] };
  const b = { id: 'B', slot: 1, holdings: [{ id: '3', weight: 8, industryCode: '17' }, { id: '4', weight: 8, industryCode: '03' }] };
  const l = computeLayout({ etfs: [a, b], singles: ['9'] });
  assert.equal(l.positions.size, 5); const ra = ridgePositions(a, 0), rb = ridgePositions(b, 1); const p3 = l.positions.get('3');
  assert.ok(p3.z > ra.anchor.z - 20 && p3.z < ra.anchor.z + 5 && p3.z > rb.anchor.z, 'shared stock lies between the two ridges');
  for (const p of l.positions.values()) { assert.ok(Math.abs(p.x) <= MAP.halfW && Math.abs(p.z - MAP.cz) <= MAP.halfD); }
  const frozen = new Map([['1', { x: 1, z: 1 }]]); const l2 = computeLayout({ etfs: [a, b], singles: [], fixed: frozen }); assert.deepEqual({ x: l2.positions.get('1').x, z: l2.positions.get('1').z }, { x: 1, z: 1 });
});
test('universe: seeds 0050, adds a stock, adds a fetched ETF, removes it and drops orphan layout', async () => {
  const store = openDatabase(':memory:');
  const fake = async id => ({ id, name: '測試 ETF', issuer: 'yuanta', asOf: '2026-09-08', retrievedAt: 'now', source: 'x', stockWeightTotal: 20, holdings: [{ id: '2330', name: '台積電', weight: 10 }, { id: '2412', name: '中華電', weight: 5 }, { id: '9910', name: '豐泰', weight: 5 }] });
  const u = createUniverse(store, catalog, { fetch: fake, log: () => {} });
  const d0 = u.definition(); assert.equal(d0.etfs[0].id, fund.id); assert.equal(d0.etfs[0].holdings.length, fund.holdings.length); assert.ok(d0.ids.includes('2330'));
  const s = await u.add('2603'); assert.equal(s.kind, 'stock'); // 長榮 is a theme member already → still one hill
  const e = await u.add('0056'); assert.equal(e.kind, 'etf'); assert.equal(e.holdings, 3); assert.ok(e.definition.ids.includes('9910')); assert.ok(e.definition.positions['9910']);
  const shared = e.definition.etfs.filter(x => x.holdings.some(h => h.id === '2330')).length; assert.equal(shared, 2);
  const r = u.remove('0056'); assert.ok(r.orphaned.includes('9910')); assert.ok(!r.definition.ids.includes('9910')); assert.ok(r.definition.ids.includes('2330'));
  assert.throws(() => u.remove(fund.id), /預設山脈/); store.close();
});
