// Shared between server and client. Defines which instruments form the landscape.
// 0050 official holdings form the main ridge; thematic groups from the v1 scenario
// remain as separate "market districts" but now carry real quotes and history.
import fund from './datasets/0050.json' with { type: 'json' };

export const FUND = fund;

// Thematic districts outside the ETF ridge. Names identify real instruments; the grouping is editorial.
export const THEMES = [
  { id: 'ai', name: 'AI 伺服器', x: -12, z: 34, color: '#e6bd7b', members: [['2382', '廣達'], ['3231', '緯創'], ['6669', '緯穎'], ['2356', '英業達']] },
  { id: 'cpo', name: 'CPO 光通訊', x: 8, z: 32, color: '#7fd7c8', members: [['4979', '華星光'], ['3363', '上詮'], ['6442', '光聖'], ['3163', '波若威']] },
  { id: 'power', name: '重電儲能', x: 26, z: 36, color: '#d69269', members: [['1519', '華城'], ['1503', '士電'], ['1513', '中興電'], ['1514', '亞力']] },
  { id: 'shipping', name: '航運', x: -30, z: 32, color: '#8ba1ad', members: [['2603', '長榮'], ['2609', '陽明'], ['2615', '萬海']] },
  { id: 'solo', name: '獨立行情', x: 40, z: 26, color: '#e7cc9f', members: [['3661', '世芯-KY']] },
];

const etfIds = new Set(fund.holdings.map(h => h.id));
export const THEME_IDS = THEMES.flatMap(t => t.members.map(m => m[0])).filter(id => !etfIds.has(id));
export const UNIVERSE_IDS = [...fund.holdings.map(h => h.id), ...THEME_IDS, fund.id];

// Amplitude (振幅) bands: blue-grey calm, yellow warming, orange high, magenta extreme. Values are % of previous close.
export const AMPLITUDE_BANDS = [
  { max: 1.5, name: '平穩', color: '#5b7390' }, { max: 3, name: '升溫', color: '#e3c25a' }, { max: 6, name: '高波動', color: '#f08a3c' }, { max: Infinity, name: '劇烈波動', color: '#e0409a' }];
export const amplitudeBand = a => a == null ? null : AMPLITUDE_BANDS.find(b => a < b.max);

// Collapse ("landslide") thresholds per time range, in percent of the step change.
export const COLLAPSE = { '1d': -5, '5d': -5, '1m': -5, '1y': -15 };

export const RANGES = [
  { id: '1d', label: '今日', long: '今日盤中 · 5 分鐘切片' },
  { id: '5d', label: '5 日', long: '最近 5 個交易日 · 日收盤' },
  { id: '1m', label: '1 月', long: '最近 22 個交易日 · 日收盤' },
  { id: '1y', label: '1 年', long: '最近 12 個月 · 月底收盤' },
];
