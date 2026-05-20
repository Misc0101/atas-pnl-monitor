[English](user-guide.md) | [简体中文](user-guide.zh-CN.md)

# ATAS PnL Monitor — User Guide

## Requirements

- Windows 10 / 11 (x64)
- [ATAS](https://atas.net/) 8.0 or later, installed and has recorded at least one trade

---

## Installation

### Option A: Portable (recommended)

1. Go to [Releases](../../../releases) and download `ATAS-PnL-Monitor-portable.exe`
2. Place it anywhere you like — no installation needed
3. Double-click to launch

### Option B: Installer

1. Download `ATAS PnL Monitor Setup x.x.x.exe` from [Releases](../../../releases)
2. Run the installer — it will create a desktop shortcut automatically
3. Launch from the desktop shortcut or Start Menu

---

## First Launch

On first launch the app automatically:

- Locates the ATAS trade history file at `%APPDATA%\ATAS\Database\HistoryMyTrade.cdb`
- Sets the start time to the current moment and enables **Until Now** mode
- Selects all trading IDs that have trades in the past 24 hours

If no data appears, check the **Data File** section in the sidebar (see below).

---

## Interface Overview

```
┌─ Titlebar ──────────────────────────────────────┐
│  ATAS PnL Monitor  v1.0  [Curve Only]  [Pin]  [─][×] │
├─ Sidebar ──┬─ Summary bar ───────────────────────┤
│            │  Gross P&L  Net P&L  Fees  Count  Win% │
│  Filters   ├─ Chart ────────────────────────────┤
│            │                                     │
│            │   (cumulative P&L curve)            │
│            │                                     │
│            ├─ Resize handle ────────────────────┤
│            │  Symbol stats table                 │
└────────────┴─────────────────────────────────────┘
```

---

## Sidebar — Filters

### Active Accounts

Lists trading IDs that have had a closed trade in the past 24 hours.

| Button | Action |
|--------|--------|
| **Select All** | Check all active IDs |
| **Clear** | Uncheck all IDs |
| **All Accounts (N)** | Open the full ID popup |

**Full ID popup** — shows all IDs (active + historical), grouped. Each row has:
- Checkbox to include/exclude that ID from the chart
- **Full** button — sets the time range to the first and last trade for that ID
- **▶** button — expands the list of trading sessions for that ID; each session has a **View** button to jump to it

> **Session gap threshold** (gear icon in popup): trades are automatically grouped into sessions by detecting gaps between them. Default 8 hours. Adjust to match your trading schedule.

### Symbol

Select **All** to see combined P&L across all instruments, or pick a specific symbol to isolate it.

### Time Range

| Control | Description |
|---------|-------------|
| **Start** datetime | Beginning of the display window |
| **4h / 8h / 24h** | Set start to N hours before now; end switches to Until Now |
| **Until Now** | End time tracks the current moment; chart extends automatically when new trades arrive |
| **End** datetime | Manual end time; deactivates Until Now |

### Timezone Offset

All times in the ATAS data file are UTC+0. Set this to your local UTC offset so that the X-axis shows the time as you experienced the trades.

*Example: UTC+8 — a trade recorded at UTC 12:00 appears as 20:00 on the chart.*

### Data File

Shows the current data file path. If the file cannot be read, an error message appears in red.

| Button | Action |
|--------|--------|
| **Change** | Browse for a different `.cdb` file |
| **Reset to Default** | Restore the default ATAS path (visible only when a custom path is set) |

---

## Chart

### Two Curves

| Curve | Color | Value |
|-------|-------|-------|
| Gross P&L (excl. fees) | Coral red | Cumulative sum of `PnL` field |
| Net P&L (incl. fees) | Steel blue | Cumulative sum of `PnL + Commission` |

Hover anywhere on the chart to see a tooltip with exact values for both curves at that time.

### Max Drawdown

When a drawdown exists, a translucent red region marks the peak-to-trough interval, and the dollar amount is shown in the top-left corner of the chart.

### Net P&L Overlay (Curve-Only Mode)

In Curve-Only mode a live **Net P&L** value is displayed inside the chart area (green = profit, red = loss). This is useful when multiple trades close at nearly the same time, compressing the curve into a near-vertical line that is hard to read from the Y-axis.

---

## Curve-Only Mode

Click **Curve Only** in the titlebar to hide the sidebar, summary bar, and stats table — leaving only the chart. The window shrinks to a compact size.

- The window size and position in this mode are saved **independently** from the full-mode layout
- All filters remain active; switch back to full mode at any time without losing settings
- Combine with **Pin** to float the chart above your trading platform

---

## Always-on-Top (Pin)

Click **Pin** to keep the window above all other windows. Works independently of Curve-Only mode — you can pin in either mode.

---

## Symbol Stats Table

Below the chart, trades are broken down by instrument:

| Column | Description |
|--------|-------------|
| Symbol | Instrument name |
| Trades | Number of closed positions |
| Win Rate | Trades with net P&L > 0 ÷ total trades |
| P&L Ratio | Average win ÷ average loss (absolute) |
| Avg Win | Average net P&L of winning trades |
| Avg Loss | Average net P&L of losing trades (shown negative) |
| Gross P&L | Sum of `PnL` for this symbol |
| Net P&L | Sum of `PnL + Commission` for this symbol |

Drag the handle above the table to resize it. Scroll horizontally with the scrollbar or mouse wheel.

---

## Troubleshooting

**No data shown / "No data under current filters"**
- Check that at least one trading ID is checked in the sidebar
- Verify the time range covers the period when trades occurred
- Confirm the data file path is correct (sidebar → Data File section)

**File not found error**
- ATAS must be installed and have written at least one trade
- If you moved the ATAS data folder, click **Change** to point the app to the new location

**Times on the X-axis look wrong**
- Adjust the **Timezone Offset** in the sidebar to match your local UTC offset
