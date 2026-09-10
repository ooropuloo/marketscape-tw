import './style.css';
import { RANGES, COLLAPSE, AMPLITUDE_BANDS } from './universe.js';
import { buildSnapshot, setDefinition, layout } from './landscape.js';
import { api, STATIC } from './api.js';
import { createWorld } from './world.js';
import { createUnderground } from './underground.js';

export const BUILD = `MS-TW 2.1.0 · ${__BUILD_TIME__}`;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = n => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const num = (n, d = 2) => n == null ? '—' : n.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
const lots = n => n == null ? '—' : Math.round(n / 1000).toLocaleString('en');
const yi = n => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)} 億`;
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const cls = n => n == null ? '' : n >= 0 ? 'up' : 'down';

const params = new URLSearchParams(location.search);
const state = { range: RANGES.some(r => r.id === params.get('range')) ? params.get('range') : '1d', frame: 0, live: true, playing: false, speed: 900, mode: 'terrain', selected: params.get('stock') ?? '2330', layers: { flow: true, wind: true, storm: true, short: true }, query: '', slice: 6 };
const data = { def: null, intraday: null, history: {}, quotes: new Map(), holders: new Map(), shorts: new Map(), health: null, events: [], holderDetail: new Map() };
let world, underground, snap, playTimer, quoteTimer, statusTimer, searchTimer;

$('#app').innerHTML = `
<header class="masthead">
  <a class="brand" href="./"><svg viewBox="0 0 46 32" aria-hidden="true"><path d="M2 28 16 4 27 23 33 12 44 28M9 28l7-12 7 12"/></svg><span>MarketScape <b>TW</b><small>台股 3D 市場數位孿生</small></span></a>
  <div class="stat"><small>ETF 山脈群</small><strong id="stat-ranges">—</strong><span id="stat-ranges-note">一檔股票只有一座山</span></div>
  <div class="stat"><small>最熱 / 最冷山峰</small><strong id="stat-hot">—</strong><span id="stat-cold">—</span></div>
  <div class="stat"><small id="contrib-label">估算持股貢獻</small><strong id="contrib">—</strong><span id="contrib-note">持股權重 × 漲跌，不含現金期貨</span></div>
  <div class="stat fund"><small id="fund-label">0050</small><strong id="fund-price">—</strong><span id="fund-note">等待官方報價</span><canvas id="spark" width="120" height="34" aria-hidden="true"></canvas></div>
  <div class="live"><b id="live-dot" class="dot"></b><div><strong id="live-title">連接觀測站…</strong><small id="live-note">每 60 秒更新</small></div></div>
</header>
<main class="workspace">
<aside class="side left" aria-label="觀測設定">
  <section class="panel"><div class="panel-head"><span>Stock / ETF Search</span><small>加入山脈或山峰</small></div><label class="search"><span>⌕</span><input id="search" placeholder="代碼或名稱，如 0056、2330" aria-label="搜尋股票或 ETF" autocomplete="off"></label><div id="search-results" hidden></div></section>
  <section class="panel"><div class="panel-head"><span>觀測清單</span><small id="watch-count"></small></div><div id="watch-list" class="watch"></div><label class="ghost file">匯入 ETF 持股 JSON（其他發行商）<input id="import-etf" type="file" accept="application/json" hidden></label></section>
  <section class="panel"><div class="panel-head"><span>地形模式</span><small id="hill-count"></small></div><div class="modes">${[['terrain', '△', '3D 地形'], ['heat', '◉', '熱度切片'], ['underground', '◈', '地下籌碼']].map(([id, icon, name]) => `<button data-mode="${id}" class="${id === 'terrain' ? 'active' : ''}" aria-pressed="${id === 'terrain'}"><i>${icon}</i>${name}</button>`).join('')}</div>
    <div class="layers">${[['flow', '資金河流', '法人淨賣超區 → 淨買超區'], ['wind', '氣壓圖與風場', '區段漲跌 · 等壓線 0.5%'], ['storm', '雲雨區', '振幅最大的區段'], ['short', '放空工地車', '融券＋借券 ÷ 20 日均量']].map(([id, name, desc]) => `<label class="toggle"><span>${name}<small>${desc}</small></span><input type="checkbox" data-layer="${id}" checked><i></i></label>`).join('')}</div></section>
  <section class="panel"><div class="panel-head"><span>Heat Slice</span><small>Height <output id="slice-value">6.0</output></small></div><input id="slice" type="range" min="1" max="12" step=".5" value="6" aria-label="切面高度"><div class="panel-head"><span>Underground Mode</span><label class="switch"><input id="underground-toggle" type="checkbox"><i></i></label></div><div class="mini-head"><span>股東人數分佈 <em class="tag">示意</em></span><small id="holder-date">集保週資料</small></div><div id="underground" aria-label="股東人數分佈 3D"></div><div id="holder-summary" class="holder-summary"></div></section>
  <section class="panel"><div class="panel-head"><span>地質活動</span><small>山崩紀錄</small></div><div id="event-list" class="events"></div><button id="demo-collapse" class="ghost">▼ 示範山崩（僅視覺）</button></section>
</aside>
<section class="map" aria-label="三維市場地形">
  <div class="map-top"><div><span class="eyebrow">TAIWAN EQUITY LANDSCAPE</span><h1 id="map-title">ETF 山脈群</h1><small id="map-sub"></small></div><div class="session"><span id="session-label">觀測日</span> <b id="map-time">—</b></div></div>
  <div id="world" tabindex="0" role="application" aria-label="3D 市場；方向鍵旋轉，WASD 平移，加減縮放，R 重設，空白鍵回放"><div id="loading">正在建立市場地形…</div><div id="labels"></div><div id="tooltip" hidden></div><div id="river-label" class="river-label"></div></div>
  <div class="map-controls"><button id="zoom-in" aria-label="放大">＋</button><button id="zoom-out" aria-label="縮小">−</button><button id="top-view" aria-label="俯視">⊙</button><button id="reset" aria-label="重設視角">⌂</button></div>
  <div class="map-bottom"><div class="legends"><div class="legend" id="legend-amp"><b>振幅</b>${AMPLITUDE_BANDS.map((b, i) => `<span><i style="background:${b.color}"></i>${b.name}<small>${i === 0 ? '<1.5%' : i === 3 ? '≥6%' : `${AMPLITUDE_BANDS[i - 1].max}–${b.max}%`}</small></span>`).join('')}</div><div class="legend" id="legend-wind"><b>氣壓</b><i class="bar"></i><small>−4%</small><small>0</small><small>+4%</small><small>· 白線＝等壓線 0.5%</small></div><div class="legend" id="legend-note"></div></div><span class="compass">N ↑</span></div>
  <div class="map-hint">拖曳旋轉 · 右鍵平移 · 滾輪縮放 · 點選山峰鑽取</div>
</section>
<aside class="side right" aria-label="個股與持股">
  <div class="crumb"><span>持股摘要 / 台股</span><b id="crumb-time">—</b></div>
  <section id="stock-detail" aria-live="polite"></section>
  <section class="panel"><div class="panel-head"><span>ETF 山脈群</span><small id="etf-count"></small></div><div id="etf-panels"></div></section>
  <section class="panel"><div class="panel-head"><span>市場區段</span><small>編輯性分組</small></div><div id="themes" class="holdings"></div></section>
</aside>
</main>
<section class="timeline" aria-label="時間回放">
  <div class="tm-head"><span class="eyebrow">TIME MACHINE</span><div class="ranges" role="group" aria-label="時間區段">${RANGES.map(r => `<button data-range="${r.id}" class="${r.id === state.range ? 'active' : ''}" aria-pressed="${r.id === state.range}">${r.label}</button>`).join('')}</div><small id="range-desc"></small></div>
  <div class="tm-body"><div class="speeds">${[[1800, '1x'], [900, '2x'], [450, '4x']].map(([v, l]) => `<button data-speed="${v}" class="${v === state.speed ? 'active' : ''}">${l}</button>`).join('')}</div><button id="play" aria-label="開始回放">▶</button><button id="pause" aria-label="暫停">⏸</button><button id="stop" aria-label="停止並回到最新">■</button>
    <div class="scrubber"><div class="time-labels" id="time-labels"></div><input id="timeline" type="range" min="0" max="0" value="0" aria-label="回放時間"></div><div class="tm-status"><b id="tm-status">—</b><small id="tm-note"></small></div></div>
</section>
<footer><span id="foot-build">${BUILD}</span><span id="foot-data">資料：TWSE MIS 即時 · MI_INDEX / TPEx 日線 · T86 三大法人 · 融券借券 · TDCC 集保 · 元大 ETF 持股</span><span>觀測工具 · 非投資建議</span></footer>
<div id="toast" role="status" hidden></div>`;

// ---------- data ----------
const currentData = () => state.range === '1d' ? data.intraday : data.history[state.range];
const lastFrame = () => { const d = currentData(); if (!d) return 0; return state.range === '1d' ? Math.max(0, d.lastFrame) : Math.max(0, d.labels.length - 1); };
const firstFrame = () => { const d = currentData(); return state.range === '1d' && d ? Math.max(0, d.firstFrame) : 0; };
async function loadRange(range) { try { if (range === '1d') data.intraday = await api.intraday(); else data.history[range] = await api.history(range); } catch (e) { toast(`載入 ${range} 失敗：${e.message}`); } }
async function loadQuotes() { try { const ids = data.def?.ids ?? []; if (!ids.length) return; const r = await api.quotes(ids); data.quotes = new Map(r.quotes.map(q => [q.id, q])); data.quoteMeta = r; } catch (e) { data.quoteMeta = { error: e.message }; } }
async function loadHolders() { try { const r = await api.holders(); data.holders = new Map(r.items.map(h => [h.id, h])); data.holderDate = r.date; } catch {} }
async function loadShorts() { try { const r = await api.short(); data.shorts = new Map(r.items.map(s => [s.id, s])); data.shortDate = r.date; } catch {} }
async function loadEvents() { try { data.events = (await api.events(12)).events; renderEvents(); } catch {} }
async function loadHolderDetail(id) { if (data.holderDetail.has(id)) return data.holderDetail.get(id); try { const d = await api.holders(id); data.holderDetail.set(id, d); return d; } catch { return null; } }
async function loadLandscape(def) { data.def = def ?? await api.landscape(); setDefinition(data.def); }
async function reloadAll() { data.history = {}; await Promise.all([loadQuotes(), loadRange(state.range), loadHolders(), loadShorts()]); if (state.live && !state.playing) state.frame = lastFrame(); render(); }
async function refreshLive() {
  await Promise.all([loadQuotes(), state.range === '1d' ? loadRange('1d') : Promise.resolve(), api.health().then(h => data.health = h).catch(() => {})]);
  if (state.live && !state.playing) state.frame = lastFrame();
  render();
}

// ---------- render ----------
function render() {
  const d = currentData(); const live = state.range === '1d' && state.frame >= lastFrame();
  snap = buildSnapshot({ range: state.range, frame: state.frame, data: d, quotes: data.quotes, holders: data.holders, shorts: data.shorts, live });
  if (!snap.stocks.length) return;
  const s = snap.stocks.find(x => x.id === state.selected) ?? snap.stocks[0]; state.selected = s.id;
  const prim = snap.etfs.find(e => e.visible) ?? snap.etfs[0];
  const rangeLabel = RANGES.find(r => r.id === state.range).label;
  const visibleETFs = snap.etfs.filter(e => e.visible); const shared = snap.stocks.filter(x => x.etfs.length > 1).length;
  $('#stat-ranges').textContent = `${visibleETFs.length} 個 ETF · ${snap.stocks.length} 座山`; $('#stat-ranges-note').textContent = shared ? `${shared} 座山同屬多個 ETF · 一檔股票只有一座山` : '一檔股票只有一座山';
  $('#stat-hot').innerHTML = snap.hottest ? `${esc(snap.hottest.name)} <em class="up">${pct(snap.hottest.change)}</em>` : '—'; $('#stat-cold').innerHTML = snap.coldest ? `最冷 ${esc(snap.coldest.name)} <b class="down">${pct(snap.coldest.change)}</b>` : '—';
  $('#contrib-label').textContent = prim ? `${prim.id} 估算持股貢獻` : '估算持股貢獻'; $('#contrib').textContent = prim && prim.coveredWeight ? `${prim.contribution >= 0 ? '+' : ''}${prim.contribution.toFixed(2)} 個百分點` : '—'; $('#contrib-note').textContent = prim && prim.coveredWeight ? `${snap.label} · 覆蓋權重 ${prim.coveredWeight.toFixed(2)}%` : '等待資料';
  $('#fund-label').textContent = prim ? `${prim.id} ${prim.name}` : 'ETF'; $('#fund-price').innerHTML = prim?.price != null ? `${num(prim.price)} <em class="${cls(prim.change)}">${pct(prim.change)}</em>` : '—';
  $('#fund-note').textContent = !prim || prim.price == null ? '等待官方報價' : state.range === '1d' ? (prim.estimated ? '買賣中價估計 · ' : '官方成交 · ') + (live ? hhmm(prim.quote?.quoteAt) : snap.label) : `${snap.date} 收盤 · ${rangeLabel}變動`;
  drawSpark(prim?.id);
  const h = data.health, qm = data.quoteMeta; const inSession = h?.taipei?.inSession ?? qm?.inSession;
  $('#live-dot').className = 'dot ' + (qm?.error || h?.quotes?.error ? 'err' : inSession ? 'on' : 'idle');
  $('#live-title').textContent = qm?.error ? '報價來源異常' : inSession ? 'LIVE · 每 60 秒更新' : '非交易時段 · 顯示最近報價';
  $('#live-note').textContent = qm?.error ?? (h?.quotes?.lastSuccessAt ? `上次官方更新 ${hhmm(h.quotes.lastSuccessAt)} · 今日已存 ${h.quotes.samplesToday} 筆取樣` : '每 60 秒更新');
  // map
  $('#map-title').textContent = { terrain: visibleETFs.length > 1 ? 'ETF 山脈群' : `${prim?.id ?? ''} · ETF 山脈`, heat: '熱度切片', underground: '地下籌碼分布' }[state.mode];
  const riverText = snap.river ? `資金河流：${snap.river.from.name} → ${snap.river.to.name}（${snap.river.estimate ? '盤中估計' : '三大法人'} ${yi(snap.river.amount)}）` : `資金河流：${state.range === '1d' ? '等待盤中成交方向資料' : '尚無法人資料'}`;
  $('#map-sub').textContent = state.mode === 'underground' ? '暖色＝大戶（400 張以上）持股比例高 · 集保週資料（示意指標）' : state.mode === 'heat' ? `切面 ${state.slice.toFixed(1)} · 暖色＝當期漲幅高` : `${riverText}${snap.storm ? ` · 雲雨區：${snap.storm.sector.name} 振幅 ${snap.storm.sector.amplitude.toFixed(1)}%` : ''}`;
  $('#session-label').textContent = state.range === '1d' ? (live ? 'LIVE' : '回放') : '收盤';
  $('#map-time').textContent = state.range === '1d' ? `${snap.date ?? ''} ${snap.label}` : snap.date ?? '—';
  $('#legend-amp').hidden = state.mode !== 'terrain'; $('#legend-wind').hidden = !(state.mode === 'terrain' && state.layers.wind);
  $('#legend-note').textContent = state.mode === 'underground' ? '地下暖色＝大戶持股比例（示意）' : state.mode === 'heat' ? '截平高山 · 暖色＝過熱' : `山崩門檻 ${COLLAPSE[state.range]}% · 紅褐＝疤痕 · ⛏＝放空回補天數高`;
  const rl = $('#river-label'); rl.hidden = !(snap.river && state.layers.flow && state.mode !== 'underground'); if (snap.river) rl.innerHTML = `${esc(snap.river.from.name)} → ${esc(snap.river.to.name)}<small>${snap.river.estimate ? '盤中估計 · 內外盤' : '三大法人買賣超'} ${yi(snap.river.amount)}</small>`;
  $('#crumb-time').textContent = state.range === '1d' ? `${live ? 'LIVE ' : ''}${snap.label}` : snap.date ?? '—';
  // detail
  const q = s.quote, status = state.range !== '1d' ? `${snap.date} 官方收盤 · ${rangeLabel}變動` : s.price == null ? '等待官方報價' : q ? (q.indicative ? '試撮合 · 非成交價' : q.availability === 'estimated' ? `買賣中價估計 ${q.bid ?? '—'} / ${q.ask ?? '—'}` : q.availability === 'retained' ? '保留前次成交' : `官方成交 ${hhmm(q.tradeAt)}`) : (s.estimated ? '取樣：買賣中價估計' : '取樣：官方成交');
  const band = s.band;
  $('#stock-detail').innerHTML = `<div class="kicker"><span>${s.etfs.length ? s.etfs.map(e => e.id).join(' + ') + ' 成分股' : esc(s.sectorName)} / ${s.id}</span><i style="background:${s.color}"></i></div>
    <h2>${esc(s.name)}<small>${esc(s.industryName ?? s.sectorName)}${s.etfs.length ? ` · ${s.etfs.map(e => `${e.id} ${e.weight.toFixed(2)}%`).join(' · ')}` : ''}</small></h2>
    <div class="price"><strong>${s.price == null ? '—' : num(s.price)}</strong><span class="${cls(s.change)}">${pct(s.change)}</span>${s.collapse ? '<b class="tag-collapse">山崩</b>' : ''}${band ? `<b class="tag-band" style="--band:${band.color}">${band.name}</b>` : ''}</div>
    <div class="status">${esc(status)}</div>
    <div class="metrics">${[['振幅 · 緊張程度', s.volatility, 'vol', s.amplitude == null ? '振幅無資料' : `振幅 ${s.amplitude.toFixed(2)}%（真實高低差 / 前收）`, band?.color], ['市場熱度', s.heat, 'heat', '50 ＋ 漲跌 × 8', null], ['籌碼壓力（示意）', s.pressure, 'pressure', `集保大戶 ≥400 張 ${s.pressure.toFixed(1)}%`, null]].map(([l, v, c, note, col]) => `<div><span>${l}<b>${Math.round(v)}<small> / 100</small></b></span><div class="meter ${c}"><i style="width:${Math.max(0, Math.min(100, v))}%${col ? `;background:${col}` : ''}"></i></div><small>${note}</small></div>`).join('')}</div>
    <dl class="facts">${[['成交量', s.volume == null ? '—' : `${lots(s.volume)} 張`], [state.range === '1d' ? '今高 / 今低' : '高 / 低', s.high != null ? `${num(s.high)} / ${num(s.low)}` : '—'], [state.range === '1d' ? '昨收' : '區間累計', state.range === '1d' ? num(s.previousClose) : pct(s.cum)],
      [state.range === '1d' ? '盤中資金（估計）' : '三大法人買賣超', state.range === '1d' ? yi(s.flow) : s.insti ? `${(s.insti.total / 1000).toLocaleString('en', { maximumFractionDigits: 0 })} 張 (${yi(s.flow)})` : '—'],
      ['放空回補天數', s.daysToCover == null ? '—' : `${s.daysToCover.toFixed(1)} 天${s.dig > 0 ? ' ⛏' : ''}`], ['融券＋借券', s.shortShares == null ? '—' : `${lots(s.shortShares)} 張`]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${s.etfs.length ? `<div class="memberships">${s.etfs.map(e => { const c = s.contribution.find(x => x.etf === e.id); return `<span style="--c:${e.color}"><i></i>${e.id} 權重 ${e.weight.toFixed(2)}%${c?.value != null ? ` · 貢獻 ${c.value >= 0 ? '+' : ''}${c.value.toFixed(3)}` : ''}</span>`; }).join('')}</div>` : ''}
    <p class="note">${s.etfs.length ? `同一座山同時屬於 ${s.etfs.map(e => e.id).join('、')}；山基取最大權重。貢獻＝官方權重 × 漲跌，不含費用、現金與期貨。` : s.single ? '自選單股，不屬於任何 ETF 山脈。' : '市場區段為編輯性分組。'}放空回補天數＝（融券餘額＋借券賣出餘額）÷ 20 日均量，≥3 天出現工地車。</p>
    <button id="focus-stock" class="ghost">定位這座山峰 ↗</button>`;
  $('#focus-stock').onclick = () => world?.focus(s.x, s.z);
  $('#etf-count').textContent = `${snap.etfs.length} 個`;
  $('#etf-panels').innerHTML = snap.etfs.map(e => `<details class="etf" ${e.id === prim?.id ? 'open' : ''} style="--c:${e.color}"><summary><i></i><b>${e.id}</b> ${esc(e.name)}<em class="${cls(e.change)}">${pct(e.change)}</em><small>${e.holdings.length} 檔 · 共同 ${e.shared}${e.visible ? '' : ' · 已隱藏'}</small></summary><div class="etf-body"><div class="etf-facts"><span>最新 <b>${e.price == null ? '—' : num(e.price)}</b></span><span>估算貢獻 <b>${e.coveredWeight ? `${e.contribution >= 0 ? '+' : ''}${e.contribution.toFixed(2)}` : '—'}</b></span><span>持股日 <b>${e.asOf ?? '—'}</b></span></div><div class="holdings">${e.holdings.slice().sort((a, b) => b.weight - a.weight).map(hh => { const x = snap.stocks.find(y => y.id === hh.id); return `<button data-stock="${hh.id}" aria-pressed="${hh.id === s.id}"><span>${esc(hh.name)}<small>${hh.id}${x?.etfs.length > 1 ? ' · ' + x.etfs.map(z => z.id).filter(z => z !== e.id).join('+') : ''}</small></span><b>${hh.weight.toFixed(2)}%</b><em class="${cls(x?.change)}">${pct(x?.change)}</em></button>`; }).join('')}</div><p class="note">來源：<a href="${e.source}" target="_blank" rel="noreferrer">${e.issuer === 'yuanta' ? '元大投信' : e.issuer}</a> · 權重合計 ${e.stockWeightTotal?.toFixed(2) ?? '—'}%</p></div></details>`).join('');
  $('#themes').innerHTML = snap.sectors.filter(g => !g.etf).map(g => `<div class="theme"><header><i style="background:${g.color}"></i>${esc(g.name)}<em class="${cls(g.change)}">${pct(g.change)}</em></header>${g.membersData.map(x => `<button data-stock="${x.id}" aria-pressed="${x.id === s.id}"><span>${esc(x.name)}<small>${x.id}${x.etfs.length ? ' · ' + x.etfs.map(e => e.id).join('+') : ''}</small></span><b>${x.price == null ? '—' : num(x.price)}</b><em class="${cls(x.change)}">${pct(x.change)}</em></button>`).join('')}</div>`).join('');
  $('#hill-count').textContent = `${snap.stocks.length} 座山`;
  renderWatch(); renderTimeline(); renderHolderPanel(s);
  world?.update(snap, state);
}
function renderWatch() {
  const def = data.def; if (!def) return;
  $('#watch-count').textContent = `${def.ids.length} / ${def.max} 檔`;
  $('#watch-list').innerHTML = [...layout.etfs.map(e => `<div class="watch-row ${e.visible ? '' : 'off'}" style="--c:${e.color}"><i></i><span data-stock="${e.members[0]}"><b>${e.id}</b> ${esc(e.name)}<small>ETF 山脈 · ${e.holdings.length} 檔 · ${e.asOf ?? ''}</small></span><label class="switch mini" title="顯示／隱藏"><input type="checkbox" data-visible="${e.id}" ${e.visible ? 'checked' : ''}><i></i></label>${e.id === '0050' ? '' : `<button data-remove="${e.id}" title="移除">✕</button>`}</div>`),
    ...def.singles.map(s => `<div class="watch-row ${s.visible ? '' : 'off'}" style="--c:#b6c7c7"><i></i><span data-stock="${s.id}"><b>${s.id}</b> ${esc(s.name)}<small>單股山峰 · ${esc(s.industryName ?? '')}</small></span><label class="switch mini"><input type="checkbox" data-visible="${s.id}" ${s.visible ? 'checked' : ''}><i></i></label><button data-remove="${s.id}" title="移除">✕</button></div>`)].join('') || '<p class="note">搜尋 ETF 代碼加入山脈，或股票代碼加入單座山峰。</p>';
}
function renderTimeline() {
  const d = currentData(), n = d?.labels?.length ?? 0, lf = lastFrame(), ff = firstFrame();
  const tl = $('#timeline'); tl.max = Math.max(0, n - 1); tl.min = 0; tl.value = state.frame; tl.disabled = !n;
  const r = RANGES.find(x => x.id === state.range); $('#range-desc').textContent = r.long;
  const labels = d?.labels ?? []; const picks = state.range === '1d' ? [0, 18, 36, 54] : n <= 6 ? labels.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round((n - 1) * 2 / 3), n - 1];
  $('#time-labels').innerHTML = picks.filter(i => labels[i] != null).map(i => `<span style="left:${n > 1 ? i / (n - 1) * 100 : 0}%">${labels[i]}</span>`).join('');
  const live = state.range === '1d' && state.frame >= lf;
  $('#tm-status').textContent = !n ? '尚無資料' : state.playing ? `回放中 · ${labels[state.frame]}` : live ? `LIVE · ${labels[state.frame] ?? ''}` : `${labels[state.frame] ?? ''}`;
  $('#tm-note').textContent = !d ? '' : state.range === '1d' ? (d.firstFrame < 0 ? `今日尚未收到盤中取樣（${d.date}）` : `全部山峰同步回放 · 取樣自 ${labels[ff]} 起至 ${labels[lf]} · 每 60 秒寫入 SQLite`) : `全部山峰同步回放 · ${d.dates?.[0] ?? ''} → ${d.dates?.at(-1) ?? ''} · ${d.progress?.running ? `日線回填中 ${d.progress.done}/${d.progress.total}` : d.flowProgress?.running ? `法人／放空回填中 ${d.flowProgress.done}/${d.flowProgress.total}` : '官方日線＋三大法人'}`;
  $('#play').hidden = state.playing; $('#pause').hidden = !state.playing;
}
async function renderHolderPanel(s) {
  const d = await loadHolderDetail(s.id); if (state.selected !== s.id) return;
  $('#holder-date').textContent = d?.date ? `集保 ${d.date}` : '集保資料尚未載入';
  $('#holder-summary').innerHTML = d ? `<span>大戶 ≥400 張 <b>${d.bigHolderPct.toFixed(2)}%</b></span><span>散戶 ≤15 張 <b>${d.retailPct.toFixed(2)}%</b></span><span>股東人數 <b>${d.holders.toLocaleString('en')}</b></span>` : '';
  underground?.set(d?.levels ?? []);
}
function renderEvents() {
  $('#event-list').innerHTML = data.events.length ? data.events.map(e => { const s = layout.stockById.get(e.id); return `<button data-stock="${e.id}"><span>${esc(s?.name ?? e.id)}<small>${new Date(e.ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(e.detail ?? e.kind)}</small></span><em class="down">${pct(e.change_pct)}</em></button>`; }).join('') : '<p class="note">尚無山崩事件。盤中日跌幅達 −5% 或三分鐘急跌 2% 時記錄。</p>';
}
async function renderSearch() {
  const box = $('#search-results'); box.hidden = !state.query; if (!state.query) return;
  const local = snap?.stocks.filter(s => (s.id + s.name + (s.industryName ?? '')).toLowerCase().includes(state.query)).slice(0, 6) ?? [];
  let remote = []; try { remote = (await api.search(state.query)).items.filter(r => !local.some(l => l.id === r.id) && !layout.etfs.some(e => e.id === r.id)); } catch {}
  if (state.query !== $('#search').value.trim().toLowerCase()) return;
  box.innerHTML = [...local.map(s => `<button data-stock="${s.id}">${s.id} ${esc(s.name)}<span>${pct(s.change)}</span></button>`), ...remote.map(r => `<button data-add="${r.id}" class="add">${r.id} ${esc(r.name)}<small>${r.isETF ? 'ETF · 加入山脈' : esc(r.industryName ?? '') + ' · 加入山峰'}</small><span>＋</span></button>`)].join('') || '<p>沒有符合的代碼或名稱。</p>';
}
function drawSpark(id) {
  const c = $('#spark'), ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); if (!id) return;
  const d = currentData(); const row = d?.series?.[id]; const vals = (state.range === '1d' ? row?.last : row?.close)?.filter(v => v != null) ?? [];
  if (vals.length < 2) return; const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  ctx.beginPath(); vals.forEach((v, i) => { const x = i / (vals.length - 1) * (c.width - 2) + 1, y = c.height - 3 - (v - min) / span * (c.height - 6); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = vals.at(-1) >= vals[0] ? '#f0c96b' : '#ff7a6b'; ctx.lineWidth = 1.5; ctx.stroke();
}
let toastTimer; function toast(text, ms = 5000) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, ms); }

// ---------- playback ----------
function stopPlay(toLive = false) { clearInterval(playTimer); state.playing = false; if (toLive) { state.live = true; state.frame = lastFrame(); } render(); }
function play() {
  const lf = lastFrame(); if (!currentData() || lf <= 0) return;
  if (state.frame >= lf) state.frame = firstFrame(); state.live = false; state.playing = true; render();
  clearInterval(playTimer); playTimer = setInterval(() => { if (state.frame >= lastFrame()) { stopPlay(state.range === '1d'); return; } state.frame++; render(); }, state.speed);
}
async function setRange(range) {
  clearInterval(playTimer); state.playing = false; state.range = range; $$('[data-range]').forEach(b => { b.classList.toggle('active', b.dataset.range === range); b.setAttribute('aria-pressed', String(b.dataset.range === range)); });
  const url = new URL(location.href); if (range === '1d') url.searchParams.delete('range'); else url.searchParams.set('range', range); history.replaceState(null, '', url);
  if (!currentData()) await loadRange(range); state.live = true; state.frame = lastFrame(); render();
}
function select(id, focus = true) { state.selected = id; state.query = ''; $('#search').value = ''; $('#search-results').hidden = true; render(); if (focus) { const s = snap.stocks.find(x => x.id === id); if (s) world?.focus(s.x, s.z); } }
async function applyDefinition(def, message) { await loadLandscape(def); await reloadAll(); if (message) toast(message); }
async function addWatch(id) { toast(`正在加入 ${id}…`, 20000); try { const r = await api.addWatch(id); await applyDefinition(r.definition, r.kind === 'etf' ? `已加入 ETF 山脈 ${r.id} ${r.name}：${r.holdings} 檔持股（${r.asOf ?? '日期未知'}）` : `已加入單股山峰 ${r.id} ${r.name}`); if (r.kind === 'stock') select(r.id); else { const first = layout.etfs.find(e => e.id === r.id)?.members[0]; if (first) select(first); } } catch (e) { toast(e.message, 8000); } }

// ---------- events ----------
$('#play').onclick = play; $('#pause').onclick = () => stopPlay(false); $('#stop').onclick = () => stopPlay(true);
$$('[data-speed]').forEach(b => b.onclick = () => { state.speed = Number(b.dataset.speed); $$('[data-speed]').forEach(x => x.classList.toggle('active', x === b)); if (state.playing) play(); });
$('#timeline').oninput = e => { clearInterval(playTimer); state.playing = false; state.frame = Number(e.target.value); state.live = state.range === '1d' && state.frame >= lastFrame(); render(); };
$$('[data-range]').forEach(b => b.onclick = () => setRange(b.dataset.range));
$$('[data-mode]').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; $$('[data-mode]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); $('#underground-toggle').checked = state.mode === 'underground'; render(); });
$('#underground-toggle').onchange = e => $(`[data-mode="${e.target.checked ? 'underground' : 'terrain'}"]`).click();
$$('[data-layer]').forEach(el => el.onchange = () => { state.layers[el.dataset.layer] = el.checked; render(); });
$('#slice').oninput = e => { state.slice = Number(e.target.value); $('#slice-value').textContent = state.slice.toFixed(1); world?.setSlice(state.slice); if (state.mode !== 'heat') $('[data-mode="heat"]').click(); else render(); };
$('#search').oninput = e => { state.query = e.target.value.trim().toLowerCase(); clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 180); };
$('#search').onkeydown = e => { if (e.key === 'Enter' && state.query) { const local = snap?.stocks.find(s => s.id.toLowerCase() === state.query); if (local) select(local.id); else addWatch(state.query.toUpperCase()); } };
document.addEventListener('click', async e => {
  const add = e.target.closest('[data-add]'); if (add) { addWatch(add.dataset.add); return; }
  const rm = e.target.closest('[data-remove]'); if (rm) { try { const r = await api.removeWatch(rm.dataset.remove); await applyDefinition(r.definition, `已移除 ${rm.dataset.remove}${r.orphaned.length ? `，${r.orphaned.length} 座山退場` : ''}`); } catch (err) { toast(err.message); } return; }
  const el = e.target.closest('[data-stock]'); if (el) select(el.dataset.stock);
});
document.addEventListener('change', async e => { const v = e.target.closest('[data-visible]'); if (v) { try { const r = await api.setVisible(v.dataset.visible, v.checked); await applyDefinition(r.definition); } catch (err) { toast(err.message); } } });
$('#import-etf').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const payload = JSON.parse(await f.text()); const r = await api.importETF(payload); await applyDefinition(r.definition, `已匯入 ${r.id} ${r.name}：${r.holdings} 檔`); } catch (err) { toast(`匯入失敗：${err.message}`, 8000); } e.target.value = ''; };
$('#reset').onclick = () => world?.reset(); $('#zoom-in').onclick = () => world?.zoom(.8); $('#zoom-out').onclick = () => world?.zoom(1.25); $('#top-view').onclick = () => world?.top();
$('#demo-collapse').onclick = () => { world?.demoCollapse(state.selected); toast(`示範：${snap.stocks.find(s => s.id === state.selected)?.name} 山崩動畫（不改動任何資料）`); };
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(playTimer), state.playing = false; else refreshLive(); });

// ---------- boot ----------
(async () => {
  try { world = createWorld($('#world'), { onSelect: id => select(id, false), onPlay: play, onCollapse: s => toast(`⛰ ${s.name} 山崩：${pct(s.change)}`) }); $('#loading').remove(); }
  catch (e) { console.error(e); $('#loading').innerHTML = '<strong>3D 地圖無法啟動</strong><br>請使用支援 WebGL 2 的瀏覽器並啟用硬體加速。'; }
  try { underground = createUnderground($('#underground')); } catch (e) { console.error(e); }
  try { await loadLandscape(); } catch (e) { toast(`載入山脈定義失敗：${e.message}`); }
  await Promise.all([loadQuotes(), loadRange(state.range), loadHolders(), loadShorts(), loadEvents(), api.health().then(h => data.health = h).catch(() => {})]);
  state.frame = lastFrame(); render();
  window.__ms = { state, data, get snap() { return snap; }, get layout() { return layout; }, world, render };
  if (STATIC) { // public GitHub Pages build: one frozen snapshot, no polling, no SSE, no write API
    const at = data.health?.snapshotAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(data.health.snapshotAt)) : '—';
    $('#foot-build').textContent = `${BUILD} · 靜態快照 ${at}`; toast(`公開展示版：資料為 ${at}（台北時間）的快照，不會即時更新；觀測清單無法修改。`, 9000); return;
  }
  quoteTimer = setInterval(refreshLive, 60_000);
  api.stream({ quotes: payload => { if (payload.events?.length) loadEvents(); refreshLive(); }, universe: () => applyDefinition() });
  statusTimer = setInterval(async () => { try { const h = await api.health(); const was = data.health; data.health = h; if ((was?.history?.running && !h.history.running) || (was?.flows?.running && !h.flows.running)) { data.history = {}; await loadRange(state.range); await loadShorts(); render(); toast('官方日線／法人資料回填完成'); } } catch {} }, 30_000);
})();
