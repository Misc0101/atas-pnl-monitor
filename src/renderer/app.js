/* ═══════════════════════════════════════════════
   ATAS PnL Monitor  —  Renderer / app.js
   ═══════════════════════════════════════════════ */

'use strict';

// ── Column keys (avoid literal cc sequences in source) ──
// 'AccountID'  →  split to avoid source-level substitution
const KEY_AID   = ['A','c','c','ountID'].join('');   // "AccountID"
const KEY_SEC   = 'SecurityId';
const KEY_CT    = 'CloseTime';
const KEY_PNL   = 'PnL';
const KEY_COMM  = 'Commission';
const KEY_MISS  = 'MissingDataCase';

// Default column positions (fallback when header parse fails)
const DEF_AID   = 1;
const DEF_SEC   = 2;
const DEF_CT    = 6;
const DEF_PNL   = 9;
const DEF_COMM  = 12;
const DEF_MISS  = 15;

// ── Application State ────────────────────────────
const S = {
  trades:      [],          // parsed trade records
  allAids:     [],          // all distinct account-IDs (active first)
  liveAids:    new Set(),   // active in last 24 h
  selAids:     new Set(),   // currently selected account-IDs
  selSym:      'all',       // selected symbol ('all' or a specific ID)
  tStart:      null,        // display-tz timestamp ms for start filter
  tEnd:        null,        // display-tz timestamp ms for end filter
  untilNow:    true,
  curveOnly:   false,
  pinned:      false,
  tzOff:       8,
  dirty:       false,
  spanH:        0,
  sessionGapH:  8,   // 交易时段间隔阈值（小时）
  // 两个模式各自的窗口快照 { x, y, w, h }，x=null 表示尚无记录
  layouts: {
    full:  { x: null, y: null, w: 1100, h: 800 },
    curve: { x: null, y: null, w: 420,  h: 320 }
  }
};

let chartInst  = null;
let resizeObs  = null;

// ── Utilities ────────────────────────────────────
function offMs()  { return S.tzOff * 3600000; }

// Parse ATAS datetime string "MM/DD/YYYY HH:mm:ss" as UTC → epoch ms
function parseDT(s) {
  if (!s || !s.trim()) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[1]-1, +m[2], +m[4], +m[5], +m[6]);
}

// "2026-05-16T13:00" → epoch ms (treated as display-tz local time)
function parseInput(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
}

// epoch ms (display-tz) → "2026-05-16T13:00"
function fmtInput(ts) {
  const d = new Date(ts);
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth()+1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  return `${Y}-${M}-${D}T${h}:${m}`;
}

// epoch ms (pre-shifted display ts) → "HH:mm" or "MM/DD HH:mm"
function fmtAxis(ts, multiDay) {
  const d = new Date(ts);
  const H = pad(d.getUTCHours()), m = pad(d.getUTCMinutes());
  if (multiDay) {
    return `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())} ${H}:${m}`;
  }
  return `${H}:${m}`;
}

// Full datetime for tooltip
function fmtFull(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
    + ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function hasSavedPosition(layout) {
  return Number.isFinite(layout?.x) && Number.isFinite(layout?.y);
}

function defaultCurveLayout() {
  return { x: null, y: null, w: 420, h: 320 };
}

function fmtUsd(v) {
  return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) { return (v * 100).toFixed(1) + '%'; }

function signFmt(v) { return (v >= 0 ? '+' : '-') + fmtUsd(v); }

// ── CSV Parser ───────────────────────────────────
function parseLine(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    while (i < n && line[i] === ' ') i++;
    if (i > n) break;
    if (i === n) { out.push(''); break; }
    if (line[i] === '"') {
      i++;
      let v = '';
      while (i < n) {
        if (line[i] === '"') {
          if (line[i+1] === '"') { v += '"'; i += 2; }
          else { i++; break; }
        } else { v += line[i++]; }
      }
      out.push(v);
    } else {
      let v = '';
      while (i < n && line[i] !== ',') v += line[i++];
      out.push(v.trim());
    }
    while (i < n && line[i] === ' ') i++;
    if (i < n && line[i] === ',') i++;
    else break;
  }
  return out;
}

// ── File Parser ──────────────────────────────────
function parseFile(content) {
  const lines = content.split(/\r?\n/);

  let startIdx = -1;
  let colBuf   = '';
  let inCols   = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const tr  = raw.trim();
    if (tr === 'StartData') { startIdx = i; break; }
    if (tr.startsWith('Columns:')) { colBuf = tr; inCols = true; }
    else if (inCols && (raw[0] === ' ' || raw[0] === '\t')) { colBuf += ' ' + tr; }
    else if (inCols) { inCols = false; }
  }

  if (startIdx < 0) return [];

  // Build column index map from parsed header
  const colNames = parseLine(colBuf.replace(/^Columns:\s*/, ''));
  const colMap   = Object.create(null);
  colNames.forEach((name, idx) => { colMap[name.trim()] = idx; });

  // Resolve column indices
  const iAid  = (KEY_AID  in colMap) ? colMap[KEY_AID]  : DEF_AID;
  const iSec  = (KEY_SEC  in colMap) ? colMap[KEY_SEC]  : DEF_SEC;
  const iCt   = (KEY_CT   in colMap) ? colMap[KEY_CT]   : DEF_CT;
  const iPnl  = (KEY_PNL  in colMap) ? colMap[KEY_PNL]  : DEF_PNL;
  const iComm = (KEY_COMM in colMap) ? colMap[KEY_COMM] : DEF_COMM;
  const iMiss = (KEY_MISS in colMap) ? colMap[KEY_MISS] : DEF_MISS;

  const trades = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    const f = parseLine(ln);

    const ctStr = (f[iCt] || '').trim();
    if (!ctStr) continue;  // skip open positions

    const miss = (f[iMiss] || '').trim();
    if (miss === 'Opening') continue;  // skip incomplete data

    const ct = parseDT(ctStr);
    if (ct === null) continue;

    const pnl  = parseFloat(f[iPnl]  || '0') || 0;
    const comm = parseFloat(f[iComm] || '0') || 0;

    trades.push({
      aid:  (f[iAid]  || '').trim(),   // account ID
      sym:  (f[iSec]  || '').trim(),   // symbol
      ct,                               // close timestamp UTC ms
      pnl,                              // PnL without commission
      comm,                             // commission (negative)
      net:  pnl + comm                  // net PnL
    });
  }

  return trades;
}

// ── Max Drawdown ─────────────────────────────────
function maxDD(vals) {
  if (!vals || vals.length < 2) return { dd: 0, si: -1, ei: -1 };
  let peak = vals[0], pkIdx = 0, best = 0, si = 0, ei = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > peak) { peak = vals[i]; pkIdx = i; }
    const dd = peak - vals[i];
    if (dd > best) { best = dd; si = pkIdx; ei = i; }
  }
  return { dd: best, si, ei };
}

// ── Filter ───────────────────────────────────────
function filtered() {
  return S.trades.filter(t => {
    if (S.selAids.size > 0 && !S.selAids.has(t.aid)) return false;
    if (S.selSym !== 'all' && t.sym !== S.selSym)    return false;
    const dts = t.ct + offMs();  // trade time in display-tz
    if (S.tStart !== null && dts < S.tStart)          return false;
    if (!S.untilNow && S.tEnd !== null && dts > S.tEnd) return false;
    return true;
  });
}

// ── Chart ────────────────────────────────────────
function renderChart(trades) {
  if (!chartInst) return;

  const nodata = document.getElementById('nodata');

  if (trades.length === 0) {
    chartInst.clear();
    nodata.classList.add('show');
    return;
  }
  nodata.classList.remove('show');

  const sorted = [...trades].sort((a, b) => a.ct - b.ct);

  let c1 = 0, c2 = 0;
  const d1 = [], d2 = [];  // [xTs, cumulative]

  for (const t of sorted) {
    const x = t.ct + offMs();
    c1 += t.pnl;
    c2 += t.net;
    d1.push([x, +c1.toFixed(2)]);
    d2.push([x, +c2.toFixed(2)]);
  }

  const multiDay = (d1[d1.length-1][0] - d1[0][0]) > 86400000;
  const dd = maxDD(d2.map(p => p[1]));
  const ddSts = dd.si >= 0 ? d2[dd.si][0] : null;
  const ddEts = dd.ei >= 0 ? d2[dd.ei][0] : null;

  const mArea = (dd.dd > 0 && ddSts !== null) ? {
    silent: true,
    itemStyle: { color: 'rgba(239,68,68,0.13)', borderWidth: 0 },
    label: { show: false },
    data: [[ { xAxis: ddSts }, { xAxis: ddEts } ]]
  } : undefined;

  const curveOnly = document.body.classList.contains('curve-only');
  const chartFs = curveOnly ? 11 : 13;
  const showCurveNet = curveOnly && d2.length > 0;
  const netVal = showCurveNet ? d2[d2.length - 1][1] : 0;
  const netGraphic = showCurveNet ? {
    type: 'text',
    left: dd.dd > 0 ? 190 : 6,
    top: dd.dd > 0 ? 34 : 14,
    style: {
      text: `\u51c0\u76c8\u4e8f  ${signFmt(netVal)}`,
      fill: netVal >= 0 ? '#4ade80' : '#f87171',
      fontSize: chartFs,
      fontFamily: 'monospace'
    }
  } : null;

  const opt = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 72, right: 24, top: dd.dd > 0 ? 58 : 36, bottom: 40 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#383838' } },
      axisTick: { lineStyle: { color: '#383838' } },
      axisLabel: {
        color: '#666', fontSize: chartFs,
        formatter: v => fmtAxis(v, multiDay)
      },
      splitLine: { show: false },
      minInterval: 60000
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#666', fontSize: chartFs,
        formatter: v => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
      },
      splitLine: { show: true, lineStyle: { type: 'dashed', color: '#272727', width: 1 } },
      axisPointer: { show: false }     // 隐藏横线
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e1e',
      borderColor: '#333',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#d4d4d4', fontSize: chartFs },
      axisPointer: {
        type: 'line',                  // 只显示竖线
        lineStyle: { color: '#ff2d78', width: 1, type: 'solid' },
        label: { show: false }
      },
      formatter(params) {
        const ts = params[0].value[0];
        let h = `<div style="color:#666;font-size:10px;margin-bottom:6px">${fmtFull(ts)}</div>`;
        for (const p of params) {
          const v = p.value[1];
          const col = v >= 0 ? '#4ade80' : '#f87171';
          h += `<div style="display:flex;justify-content:space-between;gap:16px;margin:2px 0">` +
            `<span><span style="color:${p.color}">● </span><span style="color:#888">${p.seriesName}</span></span>` +
            `<span style="color:${col};font-weight:600">${signFmt(v)}</span></div>`;
        }
        return h;
      }
    },
    legend: {
      top: 6, right: 16,
      textStyle: { color: '#666', fontSize: chartFs },
      itemWidth: 14, itemHeight: 14, icon: 'circle'
    },
    graphic: [],
    series: [
      {
        name: '盈亏曲线（不含手续费）', type: 'line', data: d1,
        showSymbol: true, symbolSize: 5, symbol: 'circle',
        lineStyle: { color: '#e8756a', width: 2 },
        itemStyle: { color: '#e8756a' },
        emphasis: { scale: false },
        markArea: mArea
      },
      {
        name: '净盈亏（含手续费）', type: 'line', data: d2,
        showSymbol: true, symbolSize: 5, symbol: 'circle',
        lineStyle: { color: '#7aabdb', width: 2 },
        itemStyle: { color: '#7aabdb' },
        emphasis: { scale: false }
      }
    ]
  };

  if (dd.dd > 0) {
    opt.graphic = [{
      type: 'text', left: 6, top: 34,
      style: { text: `最大回撤  −${fmtUsd(dd.dd)}`, fill: '#f87171', fontSize: chartFs, fontFamily: 'monospace' }
    }];
  }

  if (netGraphic) opt.graphic.push(netGraphic);

  chartInst.setOption(opt, { notMerge: true });
}

// ── Sharpe Ratio ─────────────────────────────────
function calcSharpe(trades) {
  const dayMap = Object.create(null);
  for (const t of trades) {
    const key = new Date(t.ct).toISOString().slice(0, 10);
    dayMap[key] = (dayMap[key] || 0) + t.net;
  }
  const daily = Object.values(dayMap);
  const n = daily.length;
  if (n < 2) return null;
  const mean = daily.reduce((s, v) => s + v, 0) / n;
  const std  = Math.sqrt(daily.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (std === 0) return null;
  return (mean / std) * Math.sqrt(252);
}

// ── Summary bar ──────────────────────────────────
function renderSumbar(trades) {
  const el = document.getElementById('sumbar');
  if (!trades.length) { el.innerHTML = ''; return; }

  const gross = trades.reduce((s, t) => s + t.pnl, 0);
  const net   = trades.reduce((s, t) => s + t.net, 0);
  const comm  = trades.reduce((s, t) => s + t.comm, 0);
  const cnt   = trades.length;
  const wins  = trades.filter(t => t.net > 0).length;
  const wr    = cnt ? wins / cnt : 0;

  const gc = gross >= 0 ? 'p' : 'n';
  const nc = net   >= 0 ? 'p' : 'n';

  const sharpe    = calcSharpe(trades);
  const sharpeHtml = sharpe !== null
    ? `<div class="si"><span class="si-lbl">夏普</span><span class="si-val ${sharpe >= 0 ? 'p' : 'n'}">${sharpe.toFixed(2)}</span></div>`
    : '';

  el.innerHTML =
    `<div class="si"><span class="si-lbl">毛盈亏</span><span class="si-val ${gc}">${signFmt(gross)}</span></div>` +
    `<div class="si"><span class="si-lbl">净盈亏</span><span class="si-val ${nc}">${signFmt(net)}</span></div>` +
    `<div class="si"><span class="si-lbl">手续费</span><span class="si-val n">${fmtUsd(comm)}</span></div>` +
    `<div class="si"><span class="si-lbl">笔数</span><span class="si-val d">${cnt}</span></div>` +
    `<div class="si"><span class="si-lbl">胜率</span><span class="si-val d">${fmtPct(wr)}</span></div>` +
    sharpeHtml;
}

// ── Stats Table ──────────────────────────────────
function renderStats(trades) {
  const tbody = document.getElementById('stats-body');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-td">暂无数据</td></tr>';
    return;
  }

  const byS = Object.create(null);
  for (const t of trades) {
    if (!byS[t.sym]) byS[t.sym] = [];
    byS[t.sym].push(t);
  }

  const rows = Object.keys(byS).sort().map(sym => {
    const ts  = byS[sym];
    const cnt = ts.length;
    const pos = ts.filter(t => t.net > 0);
    const neg = ts.filter(t => t.net < 0);
    const wr  = cnt ? pos.length / cnt : 0;
    const avgPos = pos.length ? pos.reduce((s, t) => s + t.net, 0) / pos.length : 0;
    const avgNeg = neg.length ? Math.abs(neg.reduce((s, t) => s + t.net, 0) / neg.length) : 0;
    const pf     = avgNeg > 0 ? avgPos / avgNeg : (avgPos > 0 ? Infinity : 0);
    const pfStr  = isFinite(pf) ? pf.toFixed(2) : (pf === Infinity ? '∞' : '—');
    const gross  = ts.reduce((s, t) => s + t.pnl, 0);
    const net    = ts.reduce((s, t) => s + t.net, 0);
    const gc = gross >= 0 ? 'cp' : 'cn';
    const nc = net   >= 0 ? 'cp' : 'cn';

    return `<tr>
      <td>${sym}</td>
      <td class="r">${cnt}</td>
      <td class="r">${fmtPct(wr)}</td>
      <td class="r">${pfStr}</td>
      <td class="r cp">${avgPos > 0 ? fmtUsd(avgPos) : '—'}</td>
      <td class="r cn">${avgNeg > 0 ? '-' + fmtUsd(avgNeg) : '—'}</td>
      <td class="r ${gc}">${signFmt(gross)}</td>
      <td class="r ${nc}">${signFmt(net)}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

// ── Aid List UI (sidebar – live only) ────────────
function renderAidList() {
  const liveEl = document.getElementById('aid-list');
  const hRow   = document.getElementById('hist-row');
  const hCount = document.getElementById('hist-count');

  const liveArr = S.allAids.filter(a =>  S.liveAids.has(a));
  const histArr = S.allAids.filter(a => !S.liveAids.has(a));

  liveEl.innerHTML = '';
  if (liveArr.length === 0) {
    liveEl.innerHTML = '<span class="ph">无活跃账户</span>';
  } else {
    liveArr.forEach(aid => {
      const lbl = document.createElement('label');
      lbl.className = 'chk-row live';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.value = aid; chk.checked = S.selAids.has(aid);
      chk.addEventListener('change', () => {
        if (chk.checked) S.selAids.add(aid);
        else             S.selAids.delete(aid);
        schedRefresh(); persistCfg();
      });
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode(' ' + aid));
      liveEl.appendChild(lbl);
    });
  }

  hRow.style.display = S.allAids.length > 0 ? 'block' : 'none';
  hCount.textContent = S.allAids.length > 0 ? `(${S.allAids.length})` : '';
}

// ── 历史账户弹窗 ──────────────────────────────────
function getAidSessions(aid) {
  const gapMs  = S.sessionGapH * 3600000;
  const trades = S.trades.filter(t => t.aid === aid).sort((a, b) => a.ct - b.ct);
  if (!trades.length) return [];
  const sessions = [];
  let sStart = trades[0].ct, sEnd = trades[0].ct;
  for (let i = 1; i < trades.length; i++) {
    if (trades[i].ct - trades[i-1].ct > gapMs) {
      sessions.push({ start: sStart, end: sEnd });
      sStart = trades[i].ct;
    }
    sEnd = trades[i].ct;
  }
  sessions.push({ start: sStart, end: sEnd });
  return sessions.reverse();
}

function fmtSession(startCt, endCt) {
  const s  = new Date(startCt + offMs());
  const e  = new Date(endCt   + offMs());
  const sm = `${pad(s.getUTCMonth()+1)}/${pad(s.getUTCDate())}`;
  const em = `${pad(e.getUTCMonth()+1)}/${pad(e.getUTCDate())}`;
  const st = `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
  const et = `${pad(e.getUTCHours())}:${pad(e.getUTCMinutes())}`;
  return sm === em ? `${sm}  ${st} — ${et}` : `${sm} ${st} — ${em} ${et}`;
}

function jumpToSession(aid, startCt, endCt) {
  S.tStart   = startCt + offMs();
  S.tEnd     = endCt   + offMs();
  S.untilNow = false;
  const elS = document.getElementById('dt-start');
  const elE = document.getElementById('dt-end');
  elS.value = fmtInput(S.tStart); elE.value = fmtInput(S.tEnd); elE.disabled = false;
  setSpan(null);
  S.selAids = new Set([aid]);
  renderAidList(); schedRefresh(); persistCfg();
  closeAidPopup();
}

function jumpToFull(aid) {
  const ts = S.trades.filter(t => t.aid === aid).sort((a, b) => a.ct - b.ct);
  if (!ts.length) return;

  S.tStart   = ts[0].ct + offMs();
  S.tEnd     = ts[ts.length - 1].ct + offMs();
  S.untilNow = false;

  const elS = document.getElementById('dt-start');
  const elE = document.getElementById('dt-end');
  elS.value = fmtInput(S.tStart); elE.value = fmtInput(S.tEnd); elE.disabled = false;
  setSpan(null);
  S.selAids = new Set([aid]);
  renderAidList(); schedRefresh(); persistCfg();
  closeAidPopup();
}

function mkAidRow(aid, isLive) {
  const wrap = document.createElement('div');
  const row  = document.createElement('div');
  row.className = 'pa-row';

  const lbl = document.createElement('label');
  lbl.className = 'pa-chk-lbl' + (S.selAids.has(aid) ? ' checked' : '');
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.value = aid; chk.checked = S.selAids.has(aid);
  chk.addEventListener('change', () => {
    if (chk.checked) { S.selAids.add(aid); lbl.classList.add('checked'); }
    else             { S.selAids.delete(aid); lbl.classList.remove('checked'); }
    renderAidList(); schedRefresh(); persistCfg();
  });
  lbl.appendChild(chk);
  if (isLive) { const dot = document.createElement('span'); dot.className = 'pa-live-dot'; dot.title = '活跃账户：过去 24 小时内有成交记录'; lbl.appendChild(dot); }
  const nameEl = document.createElement('span');
  nameEl.className = 'pa-name'; nameEl.textContent = aid;
  lbl.appendChild(nameEl);

  const fullBtn = document.createElement('button');
  fullBtn.className = 'pa-full-btn'; fullBtn.textContent = '全程';
  fullBtn.title = '将时间范围设为该账户第一笔至最后一笔成交，查看完整盈亏曲线';
  fullBtn.addEventListener('click', () => jumpToFull(aid));

  const expBtn = document.createElement('button');
  expBtn.className = 'pa-expand'; expBtn.title = '展开交易日期';
  expBtn.innerHTML = '<svg viewBox="0 0 8 8" fill="none"><polyline points="2,1 6,4 2,7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const datesEl = document.createElement('div');
  datesEl.className = 'pa-dates';
  datesEl.dataset.aid = aid;

  expBtn.addEventListener('click', () => {
    const open = datesEl.classList.toggle('show');
    expBtn.classList.toggle('open', open);
    expBtn.title = open ? '收起' : '展开交易时段';
    if (open && !datesEl.children.length) {
      const sessions = getAidSessions(aid);
      if (!sessions.length) {
        datesEl.innerHTML = '<div style="color:var(--tx3);font-size:11px;padding:2px 4px">无记录</div>';
      } else {
        sessions.forEach(sess => {
          const dr = document.createElement('div');
          dr.className = 'pa-date-row';
          const dlbl = document.createElement('span');
          dlbl.className = 'pa-date-lbl'; dlbl.textContent = fmtSession(sess.start, sess.end);
          const viewBtn = document.createElement('button');
          viewBtn.className = 'pa-day-btn'; viewBtn.textContent = '查看';
          viewBtn.addEventListener('click', () => jumpToSession(aid, sess.start, sess.end));
          dr.appendChild(dlbl); dr.appendChild(viewBtn);
          datesEl.appendChild(dr);
        });
      }
    }
  });

  row.appendChild(lbl); row.appendChild(fullBtn); row.appendChild(expBtn);
  wrap.appendChild(row); wrap.appendChild(datesEl);
  return wrap;
}

// 仅刷新当前已展开面板的时段内容（不折叠）
function refreshExpandedPanels() {
  document.querySelectorAll('.pa-dates.show').forEach(datesEl => {
    const aid = datesEl.dataset.aid;
    if (!aid) return;
    datesEl.innerHTML = '';
    const sessions = getAidSessions(aid);
    if (!sessions.length) {
      datesEl.innerHTML = '<div style="color:var(--tx3);font-size:11px;padding:2px 4px">无记录</div>';
      return;
    }
    sessions.forEach(sess => {
      const dr = document.createElement('div');
      dr.className = 'pa-date-row';
      const dlbl = document.createElement('span');
      dlbl.className = 'pa-date-lbl'; dlbl.textContent = fmtSession(sess.start, sess.end);
      const viewBtn = document.createElement('button');
      viewBtn.className = 'pa-day-btn'; viewBtn.textContent = '查看';
      viewBtn.addEventListener('click', () => jumpToSession(aid, sess.start, sess.end));
      dr.appendChild(dlbl); dr.appendChild(viewBtn);
      datesEl.appendChild(dr);
    });
  });
}

function renderPopupList(filter) {
  const liveArr = S.allAids.filter(a =>  S.liveAids.has(a));
  const histArr = S.allAids.filter(a => !S.liveAids.has(a));
  const q       = (filter || '').trim().toLowerCase();
  const shownLive = q ? liveArr.filter(a => a.toLowerCase().includes(q)) : liveArr;
  const shownHist = q ? histArr.filter(a => a.toLowerCase().includes(q)) : histArr;
  const listEl  = document.getElementById('aid-popup-list');
  listEl.innerHTML = '';

  if (!shownLive.length && !shownHist.length) {
    listEl.innerHTML = '<div class="aid-popup-empty">无匹配账户</div>';
    return;
  }

  if (shownLive.length > 0) {
    const hd = document.createElement('div');
    hd.className = 'pa-section-hd'; hd.textContent = '活跃账户'; hd.title = '过去 24 小时内有成交记录的账户';
    listEl.appendChild(hd);
    shownLive.forEach(aid => listEl.appendChild(mkAidRow(aid, true)));
  }

  if (shownHist.length > 0) {
    if (shownLive.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'pa-section-sep';
      listEl.appendChild(sep);
    }
    const hd = document.createElement('div');
    hd.className = 'pa-section-hd'; hd.textContent = '历史账户';
    listEl.appendChild(hd);
    shownHist.forEach(aid => listEl.appendChild(mkAidRow(aid, false)));
  }
}

function openAidPopup() {
  const searchEl = document.getElementById('aid-search');
  searchEl.value = '';
  document.getElementById('aid-cfg-row').classList.remove('show');
  document.getElementById('aid-popup-cfg').classList.remove('on');
  document.getElementById('cfg-gap-h').value = S.sessionGapH;
  renderPopupList('');
  document.getElementById('aid-overlay').classList.add('show');
  document.getElementById('aid-popup').classList.add('show');
  setTimeout(() => searchEl.focus(), 50);
}

function closeAidPopup() {
  document.getElementById('aid-overlay').classList.remove('show');
  document.getElementById('aid-popup').classList.remove('show');
}

// ── Symbol List UI ───────────────────────────────
function renderSymList() {
  const filtered0 = S.trades.filter(t =>
    S.selAids.size === 0 || S.selAids.has(t.aid)
  );
  const syms = [...new Set(filtered0.map(t => t.sym))].sort();

  const el = document.getElementById('sym-list');
  el.innerHTML = '';

  const mkRadio = (val, label) => {
    const lbl = document.createElement('label');
    lbl.className = 'rd-row' + (S.selSym === val ? ' sel' : '');
    const rd = document.createElement('input');
    rd.type = 'radio'; rd.name = 'sym'; rd.value = val;
    if (S.selSym === val) rd.checked = true;
    rd.addEventListener('change', () => {
      S.selSym = val;
      document.querySelectorAll('.rd-row').forEach(l => l.classList.remove('sel'));
      lbl.classList.add('sel');
      schedRefresh();
    });
    lbl.appendChild(rd);
    lbl.appendChild(document.createTextNode(' ' + label));
    el.appendChild(lbl);
  };

  mkRadio('all', '全部');
  syms.forEach(s => mkRadio(s, s));
}

// ── Full Refresh ─────────────────────────────────
function refresh() {
  const ft = filtered();
  renderChart(ft);
  renderSumbar(ft);
  renderStats(ft);
}

function schedRefresh() {
  if (S.dirty) return;
  S.dirty = true;
  requestAnimationFrame(() => { S.dirty = false; renderSymList(); refresh(); });
}

// ── Status ───────────────────────────────────────
function setStatus(txt, type) {
  document.getElementById('stat-txt').textContent = txt;
  const dot = document.getElementById('stat-dot');
  dot.className = 'stat-dot' + (type === 'live' ? ' live' : type === 'err' ? ' err' : '');
}

// ── Config ───────────────────────────────────────
async function loadCfg() {
  const cfg = await window.api.getConfig();
  S.tzOff = (cfg.timezoneOffset !== undefined) ? cfg.timezoneOffset : 8;
  if (cfg.selActIds && Array.isArray(cfg.selActIds)) {
    S.selAids = new Set(cfg.selActIds);
  }
  if (cfg.fullLayout)       S.layouts.full   = cfg.fullLayout;
  if (cfg.curveLayout)      S.layouts.curve  = cfg.curveLayout;
  if (cfg.sessionGapHours)  S.sessionGapH    = cfg.sessionGapHours;
  document.getElementById('sel-tz').value = String(S.tzOff);
}

async function persistCfg() {
  await window.api.saveConfig({
    timezoneOffset:  S.tzOff,
    selActIds:       [...S.selAids],
    fullLayout:      S.layouts.full,
    curveLayout:     S.layouts.curve,
    sessionGapHours: S.sessionGapH
  });
}

// ── Time Inputs ──────────────────────────────────

// 设置活跃跨度按钮高亮（h: 0=至今, 4/8/24=小时, null=自定义）
function setSpan(h) {
  S.spanH = h;
  document.querySelectorAll('.span-btn').forEach(btn => {
    btn.classList.toggle('on', parseInt(btn.dataset.h, 10) === h);
  });
}

function initTimePicker() {
  const nowDisp = Date.now() + offMs();
  S.tStart   = nowDisp;
  S.untilNow = true;
  S.spanH    = 0;
  document.getElementById('dt-start').value  = fmtInput(nowDisp);
  document.getElementById('dt-end').value    = '';
  document.getElementById('dt-end').disabled = true;
  setSpan(0);
}

function bindTimePicker() {
  const elStart = document.getElementById('dt-start');
  const elEnd   = document.getElementById('dt-end');

  elStart.addEventListener('change', e => {
    S.tStart = parseInput(e.target.value);
    // 如果有活跃的固定跨度，自动联动更新结束时间
    if (S.spanH !== null && S.spanH > 0 && S.tStart !== null) {
      const endTs = S.tStart + S.spanH * 3600000;
      S.tEnd = endTs;
      elEnd.value = fmtInput(endTs);
    }
    schedRefresh();
  });

  elEnd.addEventListener('change', e => {
    S.tEnd = parseInput(e.target.value);
    setSpan(null); // 手动改结束时间 → 取消跨度高亮
    schedRefresh();
  });

  // 快捷跨度按钮
  document.querySelectorAll('.span-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = parseInt(btn.dataset.h, 10);
      setSpan(h);
      if (h === 0) {
        // 至今
        S.untilNow = true;
        elEnd.disabled = true;
        elEnd.value    = '';
        S.tEnd = null;
      } else {
        S.untilNow     = false;
        elEnd.disabled = false;
        if (S.tStart !== null) {
          const endTs = S.tStart + h * 3600000;
          S.tEnd = endTs;
          elEnd.value = fmtInput(endTs);
        }
      }
      schedRefresh();
    });
  });
}

// ── 数据文件区块 UI ──────────────────────────────
async function renderFileSection(readOk) {
  const info     = await window.api.getFileInfo();
  const pathEl   = document.getElementById('df-path');
  const errEl    = document.getElementById('df-err');
  const resetBtn = document.getElementById('btn-reset-file');

  pathEl.textContent = info.current;

  if (readOk === false) {
    errEl.textContent = '文件不存在或无法读取，请点击"更改"选择正确的文件。';
    errEl.classList.add('show');
  } else {
    errEl.classList.remove('show');
    errEl.textContent = '';
  }

  resetBtn.style.display = info.isDefault ? 'none' : '';
}

// ── Data Load ────────────────────────────────────
async function loadData(isRld) {
  setStatus('读取文件…', '');

  const res = await window.api.readFile();
  if (!res.ok) {
    setStatus(res.err || '读取失败', 'err');
    renderFileSection(false);
    return;
  }

  S.trades = parseFile(res.data);

  // Determine live (active in last 24h)
  const ago24 = Date.now() - 86400000;
  S.liveAids = new Set(S.trades.filter(t => t.ct >= ago24).map(t => t.aid));

  // All IDs: live first, then historical
  const allSet  = new Set(S.trades.map(t => t.aid));
  S.allAids = [
    ...[...S.liveAids].sort(),
    ...[...allSet].filter(a => !S.liveAids.has(a)).sort()
  ];

  // First load: default selection = live aids
  if (!isRld && S.selAids.size === 0) {
    S.selAids = new Set(S.liveAids);
  }

  renderAidList();
  renderSymList();
  refresh();
  renderFileSection(true);

  setStatus(`共 ${S.trades.length} 笔`, 'live');
}

// ── Curve-Only Mode ──────────────────────────────
async function enterCurveOnly() {
  // 保存当前完整界面的位置+尺寸
  const b = await window.api.getBounds();
  if (b) S.layouts.full = b;

  S.curveOnly = true;
  document.body.classList.add('curve-only');
  document.getElementById('btn-curve-only').classList.add('on');
  document.getElementById('btn-curve-only').title = '完整界面';

  // 瞬跳到曲线模式快照（若无记录则用默认尺寸，位置由系统决定）
  const cl = S.layouts.curve || defaultCurveLayout();
  if (hasSavedPosition(cl)) {
    window.api.setBounds(cl);
  } else {
    window.api.setBounds({ w: cl.w || 420, h: cl.h || 320 });
  }

  setTimeout(() => { if (chartInst) { chartInst.resize(); refresh(); } }, 120);
  await persistCfg();
}

async function exitCurveOnly() {
  // 保存当前曲线模式的位置+尺寸
  const b = await window.api.getBounds();
  if (b) S.layouts.curve = b;

  S.curveOnly = false;
  document.body.classList.remove('curve-only');
  document.getElementById('btn-curve-only').classList.remove('on');
  document.getElementById('btn-curve-only').title = '仅看曲线';

  // 瞬跳回完整界面快照
  window.api.setBounds(S.layouts.full);

  setTimeout(() => { if (chartInst) { chartInst.resize(); refresh(); } }, 120);
  await persistCfg();
}

// ── Chart Init ───────────────────────────────────
function initChart() {
  const el = document.getElementById('chart-el');
  chartInst = echarts.init(el, null, { renderer: 'canvas' });

  resizeObs = new ResizeObserver(() => {
    if (chartInst) chartInst.resize();
  });
  resizeObs.observe(el);
}

// ── Event Bindings ───────────────────────────────
function bindEvents() {
  // Window controls
  document.getElementById('btn-min').addEventListener('click',
    () => window.api.minimize());

  document.getElementById('btn-close').addEventListener('click', async () => {
    // 关闭前保存当前模式的位置+尺寸
    const b = await window.api.getBounds();
    if (b) {
      if (S.curveOnly) S.layouts.curve = b;
      else             S.layouts.full  = b;
    }
    await persistCfg();
    window.api.close();
  });

  // Curve-only toggle
  document.getElementById('btn-curve-only').addEventListener('click', () => {
    if (S.curveOnly) exitCurveOnly();
    else             enterCurveOnly();
  });

  document.getElementById('btn-reset-curve-layout').addEventListener('click', async () => {
    S.layouts.curve = defaultCurveLayout();
    await persistCfg();
    setStatus('已重置仅看曲线位置', 'live');
  });

  // Pin toggle
  document.getElementById('btn-pin').addEventListener('click', () => {
    S.pinned = !S.pinned;
    window.api.setTop(S.pinned);
    const btn = document.getElementById('btn-pin');
    if (S.pinned) { btn.classList.add('on'); btn.title = '取消置顶'; }
    else          { btn.classList.remove('on'); btn.title = '置顶'; }
  });

  // Aid select-all / clear
  document.getElementById('btn-all-aids').addEventListener('click', () => {
    S.selAids = new Set(S.liveAids);
    renderAidList(); schedRefresh(); persistCfg();
  });
  document.getElementById('btn-clr-aids').addEventListener('click', () => {
    S.selAids = new Set();
    renderAidList(); schedRefresh(); persistCfg();
  });

  // Sidebar: collapse button (inside panel)
  (function () {
    const collapseBtn = document.getElementById('btn-collapse');
    const handle      = document.getElementById('panel-toggle');
    const icon        = document.getElementById('toggle-icon');
    const panel       = document.getElementById('filter-panel');
    let savedW        = null;

    function doCollapse() {
      savedW = panel.getBoundingClientRect().width;
      panel.style.width = '';          // 清除 inline width，让 CSS width:0 生效
      panel.classList.add('collapsed');
      handle.classList.add('collapsed-handle');
      icon.style.display = '';
      handle.title = '展开侧边栏';
      setTimeout(() => chartInst && chartInst.resize(), 240);
    }

    function doExpand() {
      panel.classList.remove('collapsed');
      if (savedW) panel.style.width = savedW + 'px';
      handle.classList.remove('collapsed-handle');
      icon.style.display = 'none';
      handle.title = '';
      setTimeout(() => chartInst && chartInst.resize(), 240);
    }

    // 收起按钮（侧边栏内顶部）
    collapseBtn.addEventListener('click', doCollapse);

    // resize handle：展开时拖拽改宽，折叠时点击展开
    let isDrag = false;
    handle.addEventListener('mousedown', e => {
      if (panel.classList.contains('collapsed')) return;
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      isDrag = false;

      function onMove(e) {
        const dx = e.clientX - startX;
        if (!isDrag && Math.abs(dx) > 4) isDrag = true;
        if (!isDrag) return;
        const newW = Math.max(160, Math.min(380, startW + dx));
        panel.style.width = newW + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    handle.addEventListener('click', () => {
      if (isDrag) { isDrag = false; return; }
      if (panel.classList.contains('collapsed')) doExpand();
    });
  })();

  // 所有账户弹窗
  document.getElementById('btn-pop-open').addEventListener('click', openAidPopup);
  document.getElementById('aid-popup-close').addEventListener('click', closeAidPopup);
  document.getElementById('aid-overlay').addEventListener('click', closeAidPopup);
  document.getElementById('aid-search').addEventListener('input', e => renderPopupList(e.target.value));
  document.getElementById('aid-popup-cfg').addEventListener('click', () => {
    const row = document.getElementById('aid-cfg-row');
    const btn = document.getElementById('aid-popup-cfg');
    const show = row.classList.toggle('show');
    btn.classList.toggle('on', show);
    if (show) setTimeout(() => document.getElementById('cfg-gap-h').focus(), 50);
  });
  function applyGapChange(el) {
    const v = parseInt(el.value, 10);
    if (v >= 1 && v <= 48) {
      S.sessionGapH = v;
      persistCfg();
      refreshExpandedPanels();
    } else {
      el.value = S.sessionGapH;
    }
  }
  document.getElementById('cfg-gap-h').addEventListener('change', e => applyGapChange(e.target));
  document.getElementById('cfg-gap-h').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyGapChange(e.target); }
  });
  document.getElementById('pop-all').addEventListener('click', () => {
    S.selAids = new Set(S.allAids);
    renderAidList(); renderPopupList(document.getElementById('aid-search').value);
    schedRefresh(); persistCfg();
  });
  document.getElementById('pop-clr').addEventListener('click', () => {
    S.selAids = new Set();
    renderAidList(); renderPopupList(document.getElementById('aid-search').value);
    schedRefresh(); persistCfg();
  });

  // Timezone
  document.getElementById('sel-tz').addEventListener('change', e => {
    S.tzOff = parseInt(e.target.value, 10);
    initTimePicker();   // 重置到「当前时刻 + 至今」
    schedRefresh();
    persistCfg();
  });

  // File change from main process
  window.api.onFileChange(() => loadData(true));

  // 品种统计面板拖动调整高度
  (function () {
    const handle     = document.getElementById('resize-handle');
    const statsPanel = document.getElementById('stats-panel');
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = statsPanel.getBoundingClientRect().height;
      function onMove(e) {
        const newH = Math.max(60, Math.min(520, startH + (startY - e.clientY)));
        statsPanel.style.height = newH + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // 品种统计横向滚动：鼠标滚轮转为横向
  (function () {
    const statsScroll = document.querySelector('.stats-scroll');
    statsScroll.addEventListener('wheel', e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      statsScroll.scrollLeft += e.deltaY;
    }, { passive: false });
  })();

  // 数据文件：更改
  document.getElementById('btn-choose-file').addEventListener('click', async () => {
    const p = await window.api.chooseFile();
    if (!p) return;
    await window.api.setDataFile(p);
    await loadData(true);
  });

  // 数据文件：恢复默认
  document.getElementById('btn-reset-file').addEventListener('click', async () => {
    await window.api.setDataFile(null);
    await loadData(true);
  });
}

// ── Bootstrap ────────────────────────────────────
async function boot() {
  await loadCfg();
  initChart();
  initTimePicker();
  bindTimePicker();
  bindEvents();
  await loadData(false);
}

boot().catch(e => {
  console.error('boot error:', e);
  setStatus('启动失败: ' + e.message, 'err');
});
