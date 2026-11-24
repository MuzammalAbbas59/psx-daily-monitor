# PSX Daily Monitor

A live momentum board for a 36-stock Pakistan Stock Exchange watchlist. It streams quotes
from [PSX Terminal](https://psxterminal.com/) and flags stocks whose daily % change is
accelerating right now. Read-only: no trades, no logins, no API keys.

Momentum watch signals only — not buy recommendations. Verify prices in your broker app
(e.g. JS Investor) before acting.

## What it does

- **Hot stocks panel** — up to 5 stocks whose daily % change rose at least 0.25 pp over the
  last 3 minutes, didn't drop in the last minute, and rose over the last 5 minutes (when
  available). Ranked by the 5-minute change. Excludes stale quotes, capped stocks, WTL and
  the `flagged` list. A manual crude-oil setting hides cement (oil up) or refinery (oil down).
- **Main table** — all 36 symbols with price, % change, 5/10/15-minute history, bid/ask,
  high/low, circuit cap and quote time. Search, filter by list, and sort by any column.
- **Dismiss / Bought** — hides a stock from both tables until the next trading day.
- **CSV export** — every quote observed today.

Observations run 09:20–16:00 PKT Mon–Thu and 09:05–16:00 on Fri, while the tab is open.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `styles.css` | Theme (white and Pakistan green) |
| `config.js` | **Watchlist and sector groups — edit this to change symbols** |
| `storage.js` | localStorage persistence (JSON) |
| `app.js` | Data feed, momentum logic and rendering |

## Saved in the browser (localStorage, JSON)

- Crude direction, search, source filter and sort order
- Today's observed quotes, so CSV export survives a reload
- Dismissed stocks for today

Momentum history is intentionally **not** restored after a reload: signals only trust data
from the current connection, so the hot panel needs ~3 minutes of fresh data after a reload.

## Running every morning

Leave the tab open. It reconnects automatically, reloads itself once at 09:00 PKT on
weekdays, and starts observing when the market window opens. Keep the computer awake and
the tab in the foreground: browsers slow down timers in background tabs and sleeping
machines drop the connection, which leaves gaps in the momentum history.

## Run locally

Any static server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy on Vercel

Import this repo in Vercel and deploy with the defaults. Framework preset: **Other**,
no build command, output directory: root. It's plain static files.
