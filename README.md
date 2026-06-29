[English](README.md) | [简体中文](README.zh-CN.md)

# ATAS PnL Monitor

**Real-time cumulative P&L curve for ATAS 8.x — restoring the chart that v8 removed.**

ATAS 8.0 dropped the built-in P&L curve that traders relied on in v7.x. This tool fills that gap: it reads ATAS's trade history file directly and renders a live, always-on-top P&L chart you can keep floating in a corner while you trade.

---

![Preview](./assets/image-20260521014610563.png)

![Preview](./assets/image-20260521014627201.png)

---

## Features

- **Real-time** — detects file changes instantly, no manual refresh
- **Two curves** — gross P&L (excl. fees) and net P&L (incl. fees), side by side
- **Current net P&L overlay** — always visible in curve-only mode, even when trades cluster into a vertical line
- **Max drawdown** — auto-calculated, shaded region + dollar annotation
- **Sharpe ratio** — annualized Sharpe displayed in the summary bar alongside other metrics; formula: `(mean daily net P&L / sample std) × √252`, risk-free rate assumed zero; auto-hidden when fewer than 2 trading days are in the current filter
- **Trade ID filtering** — active trading IDs shown in sidebar; full history popup with per-ID session breakdown
- **Symbol filter** — view all instruments combined or drill into one
- **Time range** — quick presets (4 h / 8 h / 24 h / until now) or custom start/end
- **Curve-only mode** — hides all panels, chart fills the window
- **Always-on-top** — float above your trading platform independently of curve-only mode
- **Dual layout memory** — window size and position saved separately for each mode; auto-recenters if the saved position falls outside all connected displays (e.g. after disconnecting a portable monitor)
- **Timezone offset** — shift the X-axis to any UTC offset for correct local-time display
- **Dark frameless UI** — minimal, distraction-free

---

## Download

Head to [**Releases**](../../releases) and grab the latest build:

| File | Notes |
|------|-------|
| `ATAS-PnL-Monitor-portable.exe` | Portable — no install, just run |
| `ATAS PnL Monitor Setup 1.2.0.exe` | NSIS installer, creates desktop shortcut |

No runtime required. The packaged app is self-contained.

---

## User Guide

Full usage instructions: [**docs/user-guide.md**](docs/user-guide.md)

---

## Data File

The app reads ATAS's trade history file. Default path:

```
%APPDATA%\ATAS\Database\HistoryMyTrade.cdb
```

Equivalent to:

```
C:\Users\<YourName>\AppData\Roaming\ATAS\Database\HistoryMyTrade.cdb
```

If the file is not found at the default location, click **Change** in the sidebar to select the correct path manually.

> Requires ATAS 8.0 or later to be installed on the same machine.

---

## Build from Source

**Requirements:** Windows 10/11 x64 · Node.js 18+

```bash
git clone https://github.com/Misc0101/atas-pnl-monitor.git
cd atas-pnl-monitor/src

npm install        # install dependencies (first time only)
npm start          # launch in dev mode
npm run build      # package → src/dist/
```

Packaged output in `src/dist/`:

| File | Description |
|------|-------------|
| `ATAS-PnL-Monitor-portable.exe` | Single-file portable build |
| `ATAS PnL Monitor Setup 1.2.0.exe` | NSIS installer |

> `src/build/icon.ico` is pre-generated and committed. Re-run `npm run icon` only if you modify `src/build/icon.svg`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Electron 29](https://www.electronjs.org/) |
| Charts | [ECharts 5](https://echarts.apache.org/) |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Packaging | [electron-builder 24](https://www.electron.build/) |

---

## License

[MIT](LICENSE)
