# v2.1 資料契約

## API（127.0.0.1:5303，或任何子路徑的反向代理之下）

| 端點 | 回傳 |
|---|---|
| `GET /api/health` | 版本、台北時間、交易時段、報價／日線／法人回填進度、TDCC 日期、universe 概況 |
| `GET /api/landscape` | 山脈定義：`etfs[]`（含 holdings、slot、visible、asOf、source）、`singles[]`、`themes[]`、`ridges[]`（anchor、spine、sectors）、`positions{id:{x,z}}`、`ids[]`、`max` |
| `POST /api/watch {id}` | 加入 ETF（抓官方持股）或單股；回 `{kind,id,name,holdings,asOf,definition}`；失敗 400 附原因 |
| `POST /api/watch/import {id,name,asOf,holdings[]}` | 手動匯入 ETF 持股 |
| `DELETE /api/watch/:id` | 移除；回 `orphaned[]`（退場的山）與新定義 |
| `PATCH /api/watch/:id {visible}` | 隱藏／顯示 |
| `POST /api/watch/:id/refresh` | 重抓 ETF 持股 |
| `GET /api/search?q=` | 目錄搜尋，`inUniverse`、`isETF` 旗標 |
| `GET /api/quotes?ids=` | 盤中報價（`bid/ask/estimated/availability` 等） |
| `GET /api/intraday?date=` | 55 格 5 分鐘：`series[id].{last[],changePct[],volume[],est[],flow[]}`；`flow` 為該格增量成交 × 內外盤方向（元） |
| `GET /api/history?range=5d\|1m\|1y` | `series[id].{close[],change[],volume[],high[],low[],insti[]{foreign,trust,dealer,total},shortShares[],avgVolume,baseline}` |
| `GET /api/short` | 最新融券＋借券、20 日均量、回補天數 |
| `GET /api/holders[?id=]` | 集保大戶／散戶比例；單檔 15 級距 |
| `GET /api/events` | 山崩事件 |
| `GET /api/stream` | SSE：`quotes`（每 tick）、`universe`（清單變更） |

## SQLite

```
daily_bars, trading_days, intraday(+bid, ask, dir), holders, events, meta   （同 2.0）
etfs(id, name, issuer, as_of, retrieved_at, source, stock_weight_total, slot, added_at)
etf_holdings(etf, id, name, weight, quantity)
watch(id, kind etf|stock, visible, added_at)
layout(id, x, z, fixed_at)                 凍結座標；移除後無人共用的股票才刪
institutional(id, date, foreign_net, trust_net, dealer_net, total_net)   股
short_interest(id, date, margin_short_lots 張, sbl_shares 股)
flow_days(date, rows, fetched_at)          已抓法人／放空的日期
```

## 佈局規則（server/layout.mjs）

- ETF 依 `slot` 取錨點：0 → (0,−12)、1 → (−24,−31)、2 → (24,−31)、3 → (−27,8)、4 → (27,8)…；市場區段固定在 z ≥ 28，自選單股在 z 46 一列。
- 每個 ETF 的稜線：產業依權重排序沿正弦稜線分佈，股票 3 欄偏移（沿用 v1 0050 佈局）。
- 股票座標＝Σ(權重 × 稜線位置) / Σ權重，之後 60 輪互斥鬆弛（最小距離 2.3），已凍結的不動。

## 前端快照新增欄位

每檔：`etfs[]{id,name,weight,color}`、`themes[]`、`single`、`band{name,color}`（振幅四段）、`flow`（億，1d 為累計估計、日線為法人）、`insti`、`shortShares`、`daysToCover`、`dig`（0–1）、`contribution[]{etf,value}`。
整體：`etfs[]`（price/change/contribution/coveredWeight/shared/hull）、`river{from,to,amount,note,estimate}`、`storm`、`flowNote`。
