// SQLite via node:sqlite (Node 22.12 needs --experimental-sqlite).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../.runtime/', import.meta.url));
mkdirSync(dir, { recursive: true });

export function openDatabase(path = dir + 'marketscape.sqlite') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS daily_bars(
      id TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL,
      change REAL, volume INTEGER, amount REAL, PRIMARY KEY(id, date));
    CREATE INDEX IF NOT EXISTS daily_bars_date ON daily_bars(date);
    CREATE TABLE IF NOT EXISTS trading_days(date TEXT PRIMARY KEY, tse INTEGER NOT NULL, otc INTEGER NOT NULL, fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS intraday(
      id TEXT NOT NULL, ts INTEGER NOT NULL, date TEXT NOT NULL, last REAL, change_pct REAL,
      volume INTEGER, high REAL, low REAL, est INTEGER DEFAULT 0, PRIMARY KEY(id, ts));
    CREATE INDEX IF NOT EXISTS intraday_date ON intraday(date);
    CREATE TABLE IF NOT EXISTS holders(
      id TEXT NOT NULL, date TEXT NOT NULL, level INTEGER NOT NULL, holders INTEGER, shares INTEGER, pct REAL,
      PRIMARY KEY(id, date, level));
    CREATE TABLE IF NOT EXISTS events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
      detail TEXT, change_pct REAL, range TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS etfs(id TEXT PRIMARY KEY, name TEXT, issuer TEXT, as_of TEXT, retrieved_at TEXT, source TEXT, stock_weight_total REAL, slot INTEGER NOT NULL, added_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS etf_holdings(etf TEXT NOT NULL, id TEXT NOT NULL, name TEXT, weight REAL NOT NULL, quantity INTEGER, PRIMARY KEY(etf, id));
    CREATE TABLE IF NOT EXISTS watch(id TEXT PRIMARY KEY, kind TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS layout(id TEXT PRIMARY KEY, x REAL NOT NULL, z REAL NOT NULL, fixed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS institutional(id TEXT NOT NULL, date TEXT NOT NULL, foreign_net INTEGER, trust_net INTEGER, dealer_net INTEGER, total_net INTEGER, PRIMARY KEY(id, date));
    CREATE TABLE IF NOT EXISTS short_interest(id TEXT NOT NULL, date TEXT NOT NULL, margin_short_lots INTEGER, sbl_shares INTEGER, PRIMARY KEY(id, date));
    CREATE TABLE IF NOT EXISTS flow_days(date TEXT PRIMARY KEY, rows INTEGER NOT NULL, fetched_at TEXT NOT NULL);
  `);
  for (const col of ['bid REAL', 'ask REAL', 'dir INTEGER DEFAULT 0']) { try { db.exec(`ALTER TABLE intraday ADD COLUMN ${col}`); } catch {} }
  const stmt = {
    upsertBar: db.prepare(`INSERT INTO daily_bars(id,date,open,high,low,close,change,volume,amount) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id,date) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,amount=excluded.amount`),
    markDay: db.prepare('INSERT OR REPLACE INTO trading_days(date,tse,otc,fetched_at) VALUES(?,?,?,?)'),
    getDay: db.prepare('SELECT * FROM trading_days WHERE date=?'),
    tradingDates: db.prepare('SELECT date FROM trading_days WHERE tse>0 ORDER BY date DESC LIMIT ?'),
    barsForDates: db.prepare('SELECT id,date,open,high,low,close,change,volume FROM daily_bars WHERE date IN (SELECT value FROM json_each(?)) ORDER BY date'),
    barsForIds: db.prepare('SELECT id,date,close,volume FROM daily_bars WHERE id IN (SELECT value FROM json_each(?)) AND date>=? ORDER BY date'),
    insertSample: db.prepare('INSERT OR REPLACE INTO intraday(id,ts,date,last,change_pct,volume,high,low,est,bid,ask,dir) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),
    samplesForDate: db.prepare('SELECT id,ts,last,change_pct,volume,est,bid,ask,dir FROM intraday WHERE date=? ORDER BY ts'),
    intradayDates: db.prepare('SELECT date, COUNT(*) n, MIN(ts) first, MAX(ts) last FROM intraday GROUP BY date ORDER BY date DESC LIMIT 10'),
    upsertHolder: db.prepare('INSERT OR REPLACE INTO holders(id,date,level,holders,shares,pct) VALUES(?,?,?,?,?,?)'),
    holdersFor: db.prepare('SELECT level,holders,shares,pct FROM holders WHERE id=? AND date=(SELECT MAX(date) FROM holders WHERE id=?) ORDER BY level'),
    holderDate: db.prepare('SELECT MAX(date) date FROM holders WHERE id=?'),
    bigHolders: db.prepare(`SELECT id, date, SUM(CASE WHEN level BETWEEN 12 AND 15 THEN pct ELSE 0 END) big, SUM(CASE WHEN level BETWEEN 1 AND 4 THEN pct ELSE 0 END) retail,
      SUM(CASE WHEN level BETWEEN 1 AND 15 THEN holders ELSE 0 END) holders FROM holders WHERE date=(SELECT MAX(date) FROM holders) AND id IN (SELECT value FROM json_each(?)) GROUP BY id`),
    insertEvent: db.prepare('INSERT INTO events(id,ts,kind,detail,change_pct,range) VALUES(?,?,?,?,?,?)'),
    recentEvents: db.prepare('SELECT seq,id,ts,kind,detail,change_pct,range FROM events ORDER BY ts DESC, seq DESC LIMIT ?'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key=?'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)'),
    // ETF / watch / layout
    upsertETF: db.prepare(`INSERT INTO etfs(id,name,issuer,as_of,retrieved_at,source,stock_weight_total,slot,added_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,as_of=excluded.as_of,retrieved_at=excluded.retrieved_at,source=excluded.source,stock_weight_total=excluded.stock_weight_total`),
    deleteHoldings: db.prepare('DELETE FROM etf_holdings WHERE etf=?'),
    insertHolding: db.prepare('INSERT OR REPLACE INTO etf_holdings(etf,id,name,weight,quantity) VALUES(?,?,?,?,?)'),
    etfs: db.prepare('SELECT * FROM etfs ORDER BY slot'),
    etf: db.prepare('SELECT * FROM etfs WHERE id=?'),
    holdings: db.prepare('SELECT id,name,weight,quantity FROM etf_holdings WHERE etf=? ORDER BY weight DESC'),
    nextSlot: db.prepare('SELECT COALESCE(MAX(slot),-1)+1 slot FROM etfs'),
    deleteETF: db.prepare('DELETE FROM etfs WHERE id=?'),
    upsertWatch: db.prepare('INSERT INTO watch(id,kind,visible,added_at) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET visible=1'),
    setVisible: db.prepare('UPDATE watch SET visible=? WHERE id=?'),
    deleteWatch: db.prepare('DELETE FROM watch WHERE id=?'),
    watch: db.prepare('SELECT id,kind,visible,added_at FROM watch ORDER BY added_at'),
    layout: db.prepare('SELECT id,x,z FROM layout'),
    setLayout: db.prepare('INSERT OR IGNORE INTO layout(id,x,z,fixed_at) VALUES(?,?,?,?)'),
    deleteLayout: db.prepare('DELETE FROM layout WHERE id=?'),
    // flows
    upsertInsti: db.prepare('INSERT OR REPLACE INTO institutional(id,date,foreign_net,trust_net,dealer_net,total_net) VALUES(?,?,?,?,?,?)'),
    upsertShort: db.prepare('INSERT OR REPLACE INTO short_interest(id,date,margin_short_lots,sbl_shares) VALUES(?,?,?,?)'),
    markFlowDay: db.prepare('INSERT OR REPLACE INTO flow_days(date,rows,fetched_at) VALUES(?,?,?)'),
    tradingDatesWithoutFlows: db.prepare('SELECT date FROM trading_days WHERE tse>0 AND date NOT IN (SELECT date FROM flow_days) ORDER BY date ASC LIMIT ?'),
    instiForDates: db.prepare('SELECT id,date,foreign_net,trust_net,dealer_net,total_net FROM institutional WHERE date IN (SELECT value FROM json_each(?))'),
    shortForDates: db.prepare('SELECT id,date,margin_short_lots,sbl_shares FROM short_interest WHERE date IN (SELECT value FROM json_each(?))'),
    latestShort: db.prepare('SELECT s.id, s.date, s.margin_short_lots, s.sbl_shares FROM short_interest s WHERE s.date=(SELECT MAX(date) FROM short_interest) AND s.id IN (SELECT value FROM json_each(?))'),
    flowDates: db.prepare('SELECT date FROM flow_days ORDER BY date DESC LIMIT ?'),
  };
  const now = () => new Date().toISOString();
  return {
    db,
    transaction(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    upsertBars(rows) { this.transaction(() => { for (const r of rows) stmt.upsertBar.run(r.id, r.date, r.open, r.high, r.low, r.close, r.change, r.volume, r.amount ?? null); }); },
    markDay(date, tse, otc) { stmt.markDay.run(date, tse, otc, now()); },
    getDay(date) { return stmt.getDay.get(date) ?? null; },
    tradingDates(limit) { return stmt.tradingDates.all(limit).map(r => r.date); },
    barsForDates(dates) { return stmt.barsForDates.all(JSON.stringify(dates)); },
    barsForIds(ids, since) { return stmt.barsForIds.all(JSON.stringify(ids), since); },
    insertSamples(rows) { this.transaction(() => { for (const r of rows) stmt.insertSample.run(r.id, r.ts, r.date, r.last, r.changePct, r.volume, r.high, r.low, r.est ?? 0, r.bid ?? null, r.ask ?? null, r.dir ?? 0); }); },
    samplesForDate(date) { return stmt.samplesForDate.all(date); },
    intradayDates() { return stmt.intradayDates.all(); },
    upsertHolders(rows) { this.transaction(() => { for (const r of rows) stmt.upsertHolder.run(r.id, r.date, r.level, r.holders, r.shares, r.pct); }); },
    holdersFor(id) { return { date: stmt.holderDate.get(id)?.date ?? null, levels: stmt.holdersFor.all(id, id) }; },
    bigHolders(ids) { return stmt.bigHolders.all(JSON.stringify(ids)); },
    insertEvent(e) { stmt.insertEvent.run(e.id, e.ts, e.kind, e.detail ?? null, e.changePct ?? null, e.range); },
    recentEvents(limit = 20) { return stmt.recentEvents.all(limit); },
    getMeta(key) { return stmt.getMeta.get(key)?.value ?? null; },
    setMeta(key, value) { stmt.setMeta.run(key, String(value)); },
    saveETF(e) { this.transaction(() => { const slot = stmt.etf.get(e.id)?.slot ?? stmt.nextSlot.get().slot; stmt.upsertETF.run(e.id, e.name, e.issuer, e.asOf, e.retrievedAt, e.source, e.stockWeightTotal, slot, now()); stmt.deleteHoldings.run(e.id); for (const h of e.holdings) stmt.insertHolding.run(e.id, h.id, h.name, h.weight, h.quantity ?? null); }); },
    etfs() { return stmt.etfs.all().map(e => ({ id: e.id, name: e.name, issuer: e.issuer, asOf: e.as_of, retrievedAt: e.retrieved_at, source: e.source, stockWeightTotal: e.stock_weight_total, slot: e.slot, addedAt: e.added_at, holdings: stmt.holdings.all(e.id) })); },
    etf(id) { const e = stmt.etf.get(id); return e ? { ...e, holdings: stmt.holdings.all(id) } : null; },
    removeETF(id) { this.transaction(() => { stmt.deleteETF.run(id); stmt.deleteHoldings.run(id); }); },
    watch() { return stmt.watch.all(); },
    addWatch(id, kind) { stmt.upsertWatch.run(id, kind, now()); },
    setWatchVisible(id, visible) { stmt.setVisible.run(visible ? 1 : 0, id); },
    removeWatch(id) { stmt.deleteWatch.run(id); },
    layout() { return new Map(stmt.layout.all().map(r => [r.id, { x: r.x, z: r.z }])); },
    saveLayout(entries) { this.transaction(() => { for (const [id, p] of entries) stmt.setLayout.run(id, p.x, p.z, now()); }); },
    dropLayout(ids) { this.transaction(() => { for (const id of ids) stmt.deleteLayout.run(id); }); },
    upsertInstitutional(rows) { this.transaction(() => { for (const r of rows) stmt.upsertInsti.run(r.id, r.date, r.foreign, r.trust, r.dealer, r.total); }); },
    upsertShort(rows) { this.transaction(() => { for (const r of rows) stmt.upsertShort.run(r.id, r.date, r.marginShortLots, r.sblShares); }); },
    markFlowDay(date, rows) { stmt.markFlowDay.run(date, rows, now()); },
    tradingDatesWithoutFlows(limit) { return stmt.tradingDatesWithoutFlows.all(limit).map(r => r.date); },
    instiForDates(dates) { return stmt.instiForDates.all(JSON.stringify(dates)); },
    shortForDates(dates) { return stmt.shortForDates.all(JSON.stringify(dates)); },
    latestShort(ids) { return stmt.latestShort.all(JSON.stringify(ids)); },
    flowDates(limit = 3) { return stmt.flowDates.all(limit).map(r => r.date); },
    close() { db.close(); },
  };
}
