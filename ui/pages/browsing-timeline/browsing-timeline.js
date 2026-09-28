import { formatMs, localDayKey, formatTimeOfDay, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { faviconUrl, loadFaviconCache, escapeHtml, keyActivate } from '../../shared/utils.js';
import { formatHostnameLabel, iconId } from '../../shared/labels.js';
import { displayPath } from '../../shared/paths.js';
import { periodLevel, formatPeriodLabel, stepPeriod, periodBounds, levelUp, levelDown } from '../../shared/period.js';
import { PREF_CLOCK_FORMAT, PREF_MERGE_MODE } from '../../shared/prefKeys.js';
import { allIntervals } from '../../data/intervalLog.js';
import { SESSION_GAP_MS } from '../../shared/rowStore.js';
import { createDevicePicker, initDevicePicker, deviceLabeler } from '../../shared/devicePicker.js';
import { autoStartIfMatches, PHONE_WIDTH, onwardStep } from '../../shared/tour.js';
import { isMockMode, mockIntervals } from '../../shared/tourMockData.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t as i18nT, getLocale } from '../../shared/i18n.js';
import { applyChartColorOverrides } from '../../shared/chartColors.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
await applyChartColorOverrides();
document.title = `${i18nT('tl_pageTitle')} - ${BRAND_NAME}`;

// Visualization only (not in the spec): a horizontal browsing timeline of the top
// sites, navigated period-by-period (day / week / month) like the drill views. Each
// site is one overlapped band — active at full height, audio inset over it, idle a
// thin base track — mirroring the dashboard time chart, laid along the time axis.

document.querySelector('#back-btn').href = '../dashboard/dashboard.html';
keyActivate(document.querySelector('#back-btn'), [' ']);
const svg = document.querySelector('#timeline-chart');
const axisSvg = document.querySelector('#timeline-axis');
const scrollDiv = document.querySelector('#tl-scroll');
const tooltip = document.querySelector('#timeline-tooltip');
const empty = document.querySelector('#timeline-empty');
const labelEl = document.querySelector('#tl-label');

const KIND_LABEL_KEYS = { active: 'legend_active_lc', audio: 'legend_audio_lc', idle: 'legend_idle' };

const LABEL_W = 180;
const LABEL_W_NARROW = 110;   // site column on a phone-width chart
const NARROW_W = 520;         // chart width below which the narrow layout applies
const TICK_LABEL_PX = 40;     // room one axis label needs
const PAD_R = 0;
const BAND_H = 20;        // overlapped band height (active = full band)
const ROW_H = 30;         // one site row
const AXIS_H = 22;
const TOP_PAD = 8;

const SHORT_DAY_FMT = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' });

let rows = [];                       // interval rows of the selected devices
let allRows = [];                    // every interval row
let deviceLabel = (id) => id;        // device id -> cached name
let multiDevice = false;             // two or more devices own rows: the tooltip names them
const daysWithData = new Set();      // day-keys that have any row (for level-down seeking)
let currentPeriod = sessionStorage.getItem('tl-period') || localDayKey(Date.now());
// Clip the window to active hours. A phone-width screen starts trimmed: the full day does not fit.
let clipActive = (sessionStorage.getItem('tl-clip') ?? String(matchMedia('(max-width: 700px)').matches)) === 'true';
let lastTop = [];                    // sites in the current render, indexed by row
let hoverCtx = null;                 // { winStart, span, x0, plotW } for cursor->time mapping
let cursorLine = null;               // the crosshair <line>, repositioned on mousemove
let clockFormat = DEFAULT_CLOCK_FORMAT;   // user's 12h/24h setting, loaded at startup
let lastW = 0;                       // last measured scroll-area width (resize guard)

function hasDay(dayKey) { return daysWithData.has(dayKey); }

// Parent-period breadcrumb above the nav, like the drill's month link: day shows
// its week, week shows its month, click zooms out one level. Hidden at month.
const parentLink = document.querySelector('#tl-parent-link');
function updateParentLink() {
  if (periodLevel(currentPeriod) === 'month') { parentLink.style.display = 'none'; return; }
  const parent = levelUp(currentPeriod);
  parentLink.textContent = formatPeriodLabel(parent);
  parentLink.style.display = '';
  parentLink.onclick = () => { currentPeriod = parent; afterNav(); };
}

function afterNav() {
  sessionStorage.setItem('tl-period', currentPeriod);
  labelEl.textContent = formatPeriodLabel(currentPeriod);
  updateParentLink();
  render();
}

document.querySelector('#tl-prev').addEventListener('click', () => { currentPeriod = stepPeriod(currentPeriod, -1); afterNav(); });
document.querySelector('#tl-next').addEventListener('click', () => { currentPeriod = stepPeriod(currentPeriod, 1); afterNav(); });

// Same key as the dashboard's toggle, on by default. A site and its app (reddit.com,
// com.reddit.frontpage) then share one lane.
let mergeMode = sessionStorage.getItem(PREF_MERGE_MODE) !== 'false';
const laneKey = (domain) => (mergeMode ? formatHostnameLabel(domain) : domain);

const mergeToggle = document.querySelector('#tl-merge');
mergeToggle.checked = mergeMode;
mergeToggle.addEventListener('change', () => {
  mergeMode = mergeToggle.checked;
  sessionStorage.setItem(PREF_MERGE_MODE, mergeMode);
  render();
});

// A page restored by Back keeps its old state: read the choice again, it may have changed on the dashboard.
window.addEventListener('pageshow', () => {
  mergeMode = sessionStorage.getItem(PREF_MERGE_MODE) !== 'false';
  mergeToggle.checked = mergeMode;
  if (rows.length) render();
});

const clipToggle = document.querySelector('#tl-clip');
clipToggle.checked = clipActive;
clipToggle.addEventListener('change', () => {
  clipActive = clipToggle.checked;
  sessionStorage.setItem('tl-clip', clipActive);
  render();
});

const keysBtn = document.querySelector('#tl-keys-btn');
const keysPopup = document.querySelector('#tl-keys-popup');
let keysOpen = true;   // open by default, like the drill view
keysBtn.addEventListener('click', () => {
  keysOpen = !keysOpen;
  keysPopup.style.display = keysOpen ? 'flex' : 'none';
  keysBtn.innerHTML = keysOpen ? '&times;' : '?';
  keysBtn.setAttribute('aria-label', i18nT(keysOpen ? 'common_hideShortcuts' : 'common_showShortcuts'));
});

window.addEventListener('keydown', (e) => {
  if (document.querySelector('#tour-overlay')) return;  // tour owns the arrow keys
  if (e.key === 'ArrowLeft') { e.preventDefault(); currentPeriod = stepPeriod(currentPeriod, -1); afterNav(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); currentPeriod = stepPeriod(currentPeriod, 1); afterNav(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); currentPeriod = levelUp(currentPeriod); afterNav(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); currentPeriod = levelDown(currentPeriod, hasDay); afterNav(); }
  else if (e.key === 'Escape') { e.preventDefault(); currentPeriod = localDayKey(Date.now()); afterNav(); }
});

function clip(from, to, lo, hi) {
  const f = Math.max(from, lo), t = Math.min(to, hi);
  return t > f ? [f, t] : null;
}

function unionLen(ranges) {
  if (ranges.length === 0) return 0;
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0, [cs, ce] = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const [s, e] = ranges[i];
    if (s > ce) { total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}

// Merge overlapping/abutting ranges into disjoint blocks. Path-level rows of a
// domain are unioned per kind; sub-second seams (< SESSION_GAP_MS, the same
// threshold the row-coalesce uses) are joined, a real gap stays a gap.
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [ranges[0].slice()];
  for (let i = 1; i < ranges.length; i++) {
    const [s, e] = ranges[i], last = out[out.length - 1];
    if (s <= last[1] + SESSION_GAP_MS) { if (e > last[1]) last[1] = e; }
    else out.push([s, e]);
  }
  return out;
}

// Tick marks + day separators for an arbitrary [winStart, winEnd] window (so it
// works clipped or full). day: clock-hour gridlines (step widens with span);
// week/month: one per local-midnight day boundary, labels thinned at month level.
function buildTicks(level, winStart, winEnd, plotW) {
  const ticks = [];
  const maxLabels = Math.max(1, Math.floor(plotW / TICK_LABEL_PX));
  if (level === 'day') {
    const spanH = (winEnd - winStart) / 3600000;
    const wanted = spanH > 14 ? 3 : spanH > 7 ? 2 : 1;
    const step = [1, 2, 3, 4, 6, 12].find(s => s >= wanted && spanH / s <= maxLabels) ?? 12;
    const mid = new Date(winStart); mid.setHours(0, 0, 0, 0);
    for (let h = 0; ; h += step) {
      const t = mid.getTime() + h * 3600000;
      if (t > winEnd) break;
      if (t >= winStart) ticks.push({ t, labelT: t, label: `${String(new Date(t).getHours()).padStart(2, '0')}:00` });
    }
  } else {
    const days = (winEnd - winStart) / 86400000;
    const weekLong = days <= maxLabels;                       // "Mon 15" fits, else "15"
    const monthEvery = Math.max(3, Math.ceil(days / maxLabels));
    const d0 = new Date(winStart); d0.setHours(0, 0, 0, 0);
    let i = 0;
    for (let t = d0.getTime(); t <= winEnd; i++) {
      const dd = new Date(t);
      if (t >= winStart) {
        const label = level === 'week'
          ? (weekLong ? `${SHORT_DAY_FMT.format(dd)} ${dd.getDate()}` : String(dd.getDate()))
          : (i % monthEvery === 0 ? String(dd.getDate()) : '');   // thin month labels, keep every separator
        // Gridline on the day boundary, label centered in the day's column (+12h).
        ticks.push({ t, labelT: t + 12 * 3600000, label });
      }
      const nd = new Date(t); nd.setDate(nd.getDate() + 1); t = nd.getTime();
    }
  }
  return ticks;
}

function render() {
  let [winStart, winEnd] = periodBounds(currentPeriod);
  const level = periodLevel(currentPeriod);
  // "Active hours only": shrink the window to the span of recorded presence
  // (active, audio AND idle) within the period, trimming only the empty edges —
  // idle at the start/end of a session is part of it and stays.
  if (clipActive) {
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      if (r.kind !== 'active' && r.kind !== 'audio' && r.kind !== 'idle') continue;
      const f = Math.max(r.from, winStart), t = Math.min(r.to, winEnd);
      if (t > f) { if (f < lo) lo = f; if (t > hi) hi = t; }
    }
    if (lo < hi) { winStart = lo; winEnd = hi; }
  }
  const span = Math.max(1, winEnd - winStart);

  // One lane per key; `msByDomain` orders its domains by time, for the link and the icon.
  const byKey = new Map();
  for (const r of rows) {
    if (r.kind !== 'active' && r.kind !== 'audio' && r.kind !== 'idle') continue;
    const c = clip(r.from, r.to, winStart, winEnd);
    if (!c) continue;
    const key = laneKey(r.domain);
    let d = byKey.get(key);
    if (!d) { d = { active: [], audio: [], idle: [], msByDomain: new Map() }; byKey.set(key, d); }
    d[r.kind].push(c);
    d.msByDomain.set(r.domain, (d.msByDomain.get(r.domain) ?? 0) + c[1] - c[0]);
  }

  const top = [...byKey.entries()]
    .map(([key, { msByDomain, ...d }]) => {
      const domains = [...msByDomain.keys()].sort((a, b) => msByDomain.get(b) - msByDomain.get(a));
      return { key, domain: domains[0], domains, ...d, total: unionLen([...d.active, ...d.audio]) };
    })
    .sort((a, b) => b.total - a.total);

  if (top.length === 0) {
    svg.innerHTML = '';
    axisSvg.innerHTML = '';
    svg.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  svg.style.display = '';
  empty.style.display = 'none';

  // Set the chart height FIRST (it depends only on the row count), so any vertical
  // scrollbar appears before we measure the width. Then W = the scroll area's real
  // content width (minus that scrollbar). Measuring width before setting the height
  // would read a stale (no-scrollbar) width, and the viewBox/element mismatch would
  // letterbox the svg vertically — leaving a gap between the gridlines and the border.
  const rowsH = top.length * ROW_H;
  const H = TOP_PAD + rowsH;
  svg.style.height = `${H}px`;

  const W = scrollDiv.clientWidth || 900;
  lastW = W;
  const x0 = W < NARROW_W ? LABEL_W_NARROW : LABEL_W, x1 = W - PAD_R;
  const plotW = Math.max(1, x1 - x0);
  const xOf = (t) => x0 + ((t - winStart) / span) * plotW;

  const style = getComputedStyle(document.documentElement);
  const colActive = style.getPropertyValue('--color-chart-time').trim();
  const colAudio = style.getPropertyValue('--color-chart-audio').trim();
  const colIdle = style.getPropertyValue('--color-chart-idle').trim();
  const colNow = style.getPropertyValue('--color-accent').trim();
  const colText = style.getPropertyValue('--color-text-secondary').trim();
  const colBorder = style.getPropertyValue('--color-border').trim();

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  axisSvg.setAttribute('viewBox', `0 0 ${W} ${AXIS_H}`);
  axisSvg.style.height = `${AXIS_H}px`;
  axisSvg.style.width = `${W}px`;
  // Click a day to drill in (week/month only); plot + axis share the cursor hint.
  const drillCursor = level === 'day' ? 'default' : 'pointer';
  axisSvg.style.cursor = drillCursor;
  svg.style.cursor = drillCursor;

  lastTop = top;
  hoverCtx = { winStart, span, x0, plotW };

  const parts = [];
  // Axis labels live in a separate sticky svg so they stay visible while the rows
  // scroll; the gridlines stay in the scrolling chart, aligned by the same xOf. The
  // axis carries the top border (mimicking the row separators); the chart skips its
  // last-row separator so the two don't double up at the bottom.
  const axisParts = [`<line x1="0" y1="0.5" x2="${x1}" y2="0.5" stroke="${colBorder}" stroke-width="0.5"/>`];

  for (const { t, labelT, label } of buildTicks(level, winStart, winEnd, plotW)) {
    const x = xOf(t);
    // Skip a gridline sitting on the right plot edge — it would butt against the scrollbar.
    if (x < x1 - 0.5) parts.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}" stroke="${colBorder}" stroke-width="0.5"/>`);
    if (label) {
      const lx = xOf(labelT);
      const anchor = lx <= x0 + 1 ? 'start' : lx >= x1 - 1 ? 'end' : 'middle';
      axisParts.push(`<text x="${lx.toFixed(1)}" y="${AXIS_H - 7}" text-anchor="${anchor}" font-size="10" fill="${colText}">${label}</text>`);
    }
  }
  // In trim mode the window starts mid-hour, so no tick lands on the left edge —
  // add a boundary gridline there to replace the trimmed-off one.
  if (clipActive) parts.push(`<line x1="${x0}" y1="0" x2="${x0}" y2="${H}" stroke="${colBorder}" stroke-width="0.5"/>`);

  const lane = (ranges, laneY, h, color, rx = 0) => {
    for (const [f, t] of ranges) {
      const bx = xOf(f), bw = Math.max(1, xOf(t) - bx);
      parts.push(`<rect x="${bx.toFixed(1)}" y="${laneY}" width="${bw.toFixed(1)}" height="${h}" fill="${color}" rx="${rx}"/>`);
    }
  };

  const audioH = Math.round(BAND_H / 3);
  const idleH = 4;

  let y = TOP_PAD;
  top.forEach((site, i) => {
    const label = formatHostnameLabel(site.domain);
    const bandY = y + (ROW_H - BAND_H) / 2;
    // Overlapped band, like the dashboard time chart: active is the solid base bar,
    // audio a narrower strip along the bottom edge, idle a thin strip along the top.
    lane(mergeRanges(site.active), bandY, BAND_H, colActive, 2);
    lane(mergeRanges(site.audio), bandY + BAND_H - audioH, audioH, colAudio);
    lane(mergeRanges(site.idle), bandY, idleH, colIdle);
    // Label cell (first column only): one clickable <a> with favicon + name + duration
    // and a dashboard-style hover background. Click-through to the site page is here.
    const href = site.domains.length === 1
      ? `../site/site.html?id=${encodeURIComponent(site.domain)}`
      : `../site/site.html?ids=${encodeURIComponent(site.domains.join(','))}`;
    parts.push(`<foreignObject x="0" y="${y}" width="${x0}" height="${ROW_H}"><a xmlns="http://www.w3.org/1999/xhtml" class="tl-rowlabel" href="${href}" title="${escapeHtml(label)}"><img class="tl-rowfav" src="${faviconUrl(iconId(site.domains))}" width="16" height="16"/><span class="tl-rowname">${escapeHtml(label)}</span><span class="tl-rowdur">${formatMs(site.total)}</span></a></foreignObject>`);
    if (i < top.length - 1) parts.push(`<line x1="0" y1="${y + ROW_H}" x2="${x1}" y2="${y + ROW_H}" stroke="${colBorder}" stroke-width="0.5"/>`);
    y += ROW_H;
  });

  // Now marker, on top of the bands (non-interactive so it doesn't steal hover).
  const now = Date.now();
  if (now >= winStart && now < winEnd) {
    const x = xOf(now).toFixed(1);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${colNow}" stroke-width="1.5" stroke-dasharray="3 2" pointer-events="none"/>`);
  }

  // Cursor crosshair: a soft translucent band (same --color-hover-bg as the bar-hover
  // highlight on the regular charts), repositioned on mousemove, hidden until hover.
  parts.push(`<rect class="tl-cursor" x="0" y="0" width="6" height="${H}" pointer-events="none" style="display:none"/>`);

  svg.innerHTML = parts.join('');
  axisSvg.innerHTML = axisParts.join('');
  cursorLine = svg.querySelector('.tl-cursor');
}

// Map a clientX over the svg to a viewBox x coordinate.
function vbXAtClientX(clientX) {
  const box = svg.getBoundingClientRect();
  const vbW = svg.viewBox.baseVal.width || box.width;
  return (clientX - box.left) / box.width * vbW;
}

// Crosshair: a vertical line follows the cursor and a single tooltip lists every
// site present at that instant (the timelines the line crosses).
function onCursorMove(e) {
  if (!hoverCtx || !cursorLine) return;
  const vbX = vbXAtClientX(e.clientX);
  const xEnd = hoverCtx.x0 + hoverCtx.plotW;
  if (vbX < hoverCtx.x0 || vbX > xEnd) { hideCursor(); return; }
  cursorLine.setAttribute('x', (vbX - 3).toFixed(1));
  cursorLine.style.display = '';
  const t = hoverCtx.winStart + ((vbX - hoverCtx.x0) / hoverCtx.plotW) * hoverCtx.span;
  showCursorTip(t, e);
}

function hideCursor() {
  if (cursorLine) cursorLine.style.display = 'none';
  tooltip.style.display = 'none';
}

// One pass over the rows: each domain present at the cursor instant (active row
// preferred for the shown path) plus the kinds it has there; listed in lastTop's
// descending-time order.
function showCursorTip(t, e) {
  const byDom = new Map();
  for (const r of rows) {
    if (r.from > t || r.to < t) continue;
    if (r.kind !== 'active' && r.kind !== 'audio' && r.kind !== 'idle') continue;
    const key = laneKey(r.domain);
    let d = byDom.get(key);
    if (!d) { d = { row: null, kinds: new Set(), devices: new Set() }; byDom.set(key, d); }
    d.kinds.add(r.kind);
    d.devices.add(r.deviceId);
    if (r.kind === 'active' || !d.row) d.row = r;
  }
  const entries = [];
  for (const site of lastTop) {
    const d = byDom.get(site.key);
    if (!d) continue;
    const name = escapeHtml(formatHostnameLabel(site.domain));
    const path = escapeHtml(displayPath(d.row.path));
    const range = `${formatTimeOfDay(d.row.from, clockFormat)}–${formatTimeOfDay(d.row.to, clockFormat)}`;
    const kindLabels = [...d.kinds].map(k => i18nT(KIND_LABEL_KEYS[k])).join('/');
    const devices = multiDevice ? escapeHtml([...d.devices].map(deviceLabel).join(', ')) : '';
    entries.push({ html: `<span class="tl-tip-name">${name}</span> <span class="text-meta">${range} (${kindLabels}) ${path}</span>`, devices });
  }
  if (entries.length === 0) { tooltip.style.display = 'none'; return; }
  // One shared device set goes in the head, beside the date; mixed sets stay on each line.
  const shared = entries.every(x => x.devices === entries[0].devices) ? entries[0].devices : '';
  const lines = entries.map(x => {
    const device = !shared && x.devices ? `<span class="tl-tip-device text-meta">${x.devices}</span>` : '';
    return `<div class="tl-tip-path"><span class="tl-tip-main">${x.html}</span>${device}</div>`;
  });
  const time = formatTimeOfDay(t, clockFormat);
  const date = new Date(t).toLocaleDateString(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const hint = periodLevel(currentPeriod) === 'day' ? '' : `<div class="tl-tip-hint text-meta">${i18nT('tl_clickToOpenDay')}</div>`;
  const deviceHead = shared ? `<span class="tl-tip-device text-meta">${shared}</span>` : '';
  tooltip.innerHTML = `<div class="tl-tip-head"><span>${date} ${time}</span>${deviceHead}</div>${lines.join('')}${hint}`;
  tooltip.style.display = 'block';
  // Flip to the other side of the cursor and clamp so it never spills off-screen.
  const ttW = tooltip.offsetWidth, ttH = tooltip.offsetHeight;
  let left = e.clientX + 14;
  if (left + ttW > window.innerWidth - 4) left = e.clientX - 14 - ttW;
  let top = e.clientY + 12;
  if (top + ttH > window.innerHeight - 4) top = e.clientY - 12 - ttH;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${Math.max(4, top)}px`;
}

svg.addEventListener('mousemove', onCursorMove);
svg.addEventListener('mouseleave', hideCursor);

// Click a day — anywhere in the plot or on the axis — to drill into it (down a
// level), mirroring the drill's click-to-go-deeper. Day level is the floor. Clicks
// in the label gutter (vbX < x0) are ignored here and fall through to the site link.
function drillAtClientX(clientX) {
  if (!hoverCtx || periodLevel(currentPeriod) === 'day') return;
  const vbX = vbXAtClientX(clientX);
  if (vbX < hoverCtx.x0 || vbX > hoverCtx.x0 + hoverCtx.plotW) return;
  const t = hoverCtx.winStart + ((vbX - hoverCtx.x0) / hoverCtx.plotW) * hoverCtx.span;
  currentPeriod = localDayKey(t);
  afterNav();
}
svg.addEventListener('click', (e) => drillAtClientX(e.clientX));
axisSvg.addEventListener('click', (e) => drillAtClientX(e.clientX));

// Re-render when the scroll area's width actually changes. Covers the initial
// layout settling (the first synchronous render can measure a pre-scrollbar width,
// which letterboxes the svg) and window resizes. Guarded on a real width change so
// the vertical scrollbar that render itself toggles doesn't cause a feedback loop.
const ro = new ResizeObserver(() => { if (rows.length && scrollDiv.clientWidth !== lastW) render(); });
ro.observe(scrollDiv);

await loadFaviconCache();
clockFormat = (await host.prefs.get(PREF_CLOCK_FORMAT))[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;
allRows = await isMockMode() ? mockIntervals() : await allIntervals();
rows = allRows;
for (const r of rows) { daysWithData.add(localDayKey(r.from)); daysWithData.add(localDayKey(r.to)); }
const deviceIds = [...new Set(allRows.map(r => r.deviceId).filter(Boolean))];
multiDevice = deviceIds.length >= 2;
deviceLabel = await deviceLabeler(deviceIds);
const devicePicker = createDevicePicker();
document.querySelector('#tl-left').appendChild(devicePicker);
initDevicePicker(devicePicker, (list) => {
  const set = list && new Set(list);
  rows = set ? allRows.filter(r => set.has(r.deviceId)) : allRows;
  daysWithData.clear();
  for (const r of rows) { daysWithData.add(localDayKey(r.from)); daysWithData.add(localDayKey(r.to)); }
  render();
}, deviceIds);
labelEl.textContent = formatPeriodLabel(currentPeriod);
updateParentLink();
render();
document.body.classList.remove('is-loading');

function timelineTourSteps() { return [
  {
    selector: '#tl-chart-wrapper',
    title: i18nT('tour_tl_plotted_title'),
    body: i18nT('tour_tl_plotted_body'),  },
  {
    selector: '#tl-nav',
    title: i18nT('tour_tl_move_title'),
    body: i18nT('tour_tl_move_body'),  },
  // At phone widths the next dashboard step shows here: its target is in the bottom nav.
  PHONE_WIDTH ? onwardStep('rules') : {
    selector: '#back-btn',
    title: i18nT('tour_tl_back_title'),
    body: i18nT('tour_tl_back_body', [BRAND_NAME]),
    handoff: { nextSurface: 'dashboard', nextStepIndex: 7, mode: 'inPage' },
  },
]; }

autoStartIfMatches('timeline', timelineTourSteps());
