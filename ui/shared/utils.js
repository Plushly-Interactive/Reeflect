import { t } from './i18n.js';
import { host } from './host.js';

// Functions, not consts: t() must resolve after initI18n() has loaded any
// language override, which happens after this module is evaluated.
export function statLabels() {
  return {
    today: t('stat_today'),
    dailyAvg: t('stat_dailyAvg'),
    peakDay: t('stat_peakDay'),
    totalTime: t('stat_totalTime'),
    visits: t('stat_visits'),
    avgSession: t('stat_avgSession'),
  };
}

export function chartLegendHtml() {
  return `<span><span class="chart-legend-time"></span> ${t('chart_activeBrowsing')}</span><span><span class="chart-legend-audio"></span> ${t('chart_audioPlayback')}</span>`;
}

export function timeChartHtml() {
  return `<div id="time-chart-container" class="chart-container">
  <div class="chart-header">
    <h2 class="chart-heading">${t('chart_timeSpent')}</h2>
    <div id="time-legend" class="time-legend text-meta" style="display: none"></div>
  </div>
  <svg id="time-chart" class="chart-svg"></svg>
  <div id="time-tooltip" class="tooltip text-meta"></div>
  <p id="time-no-data" class="text-meta" style="display:none">${t('dashboard_noData')}</p>
</div>`;
}

export function visitsChartHtml() {
  return `<div id="visits-chart-container" class="chart-container">
  <h2 class="chart-heading">${t('stat_visits')}</h2>
  <svg id="visits-chart" class="chart-svg"></svg>
  <div id="visits-tooltip" class="tooltip text-meta"></div>
  <p id="visits-no-data" class="text-meta" style="display:none">${t('dashboard_noData')}</p>
</div>`;
}

export function hourlyChartHtml() {
  return `<div id="hourly-chart-container" class="chart-container">
  <h2 class="chart-heading">${t('dashboard_avgPerHour')} <span id="hourly-subheading" class="chart-subheading text-meta"></span></h2>
  <svg id="hourly-chart" class="chart-svg"></svg>
  <div id="hourly-tooltip" class="tooltip text-meta"></div>
  <p id="hourly-not-relevant" class="text-meta" style="display:none"></p>
</div>`;
}

export function attachInputClear(input, clearBtn, onChange, { escStopPropagation = false } = {}) {
  function sync() {
    clearBtn.style.display = input.value ? 'block' : 'none';
  }
  input.addEventListener('input', () => { sync(); onChange(); });
  if (input.type === 'search') {
    input.addEventListener('search', () => { sync(); onChange(); });
  } else {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        sync();
        onChange();
        if (escStopPropagation) e.stopPropagation();
      }
    });
  }
  clearBtn.addEventListener('click', () => {
    input.value = '';
    sync();
    onChange();
    input.focus();
  });
  return sync;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _faviconCache = new Map();

export async function loadFaviconCache() {
  const { faviconCache = {} } = await host.prefs.get('faviconCache');
  for (const [k, v] of Object.entries(faviconCache)) _faviconCache.set(k, v.dataUrl);
}

export function faviconUrl(hostname) {
  if (_faviconCache.has(hostname)) return _faviconCache.get(hostname);
  return host.faviconUrl(`https://${hostname}`);
}

// Make a <button> navigate like a link: plain click → same tab, middle-click or
// ctrl/cmd-click → new tab (so we don't lose those affordances by not using <a>).
export function navButton(btnEl, url) {
  btnEl.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) window.open(url, '_blank');
    else window.location.href = url;
  });
  btnEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // suppress middle-click autoscroll
  });
  btnEl.addEventListener('auxclick', (e) => {
    if (e.button === 1) window.open(url, '_blank'); // middle click
  });
}

// Forwards Enter/Space to an element's existing click handler, so non-native
// clickable elements (tr, th, div) become keyboard-operable without duplicating
// their click logic.
export function keyActivate(el, keys = ['Enter', ' ']) {
  el.addEventListener('keydown', (e) => {
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    el.click();
  });
}

// Tab/Shift+Tab wraps between a modal/overlay's first and last focusable element
// so keyboard focus can't escape to the page behind it while it's open.
export function trapFocusWithin(container, e) {
  if (e.key !== 'Tab') return;
  const focusable = [...container.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// An info tooltip (a position: fixed .tooltip): it opens on hover, and on a tap or a click, so a
// touch screen can reveal it; a tap anywhere else closes it. `text` may supply the content and
// returns nothing when there is none to show.
export function attachInfoTooltip(trigger, tooltip, text) {
  const show = (e) => {
    if (text) {
      const value = text();
      if (!value) return;
      tooltip.textContent = value;
    }
    tooltip.style.display = 'block';
    // A hover follows the cursor; a tap sits centred above the trigger, clear of the finger.
    const box = trigger.getBoundingClientRect();
    const tapped = e.type === 'click';
    const left = tapped ? box.left + (box.width - tooltip.offsetWidth) / 2 : e.clientX + 12;
    const top = tapped ? box.top - tooltip.offsetHeight - 6 : e.clientY - 30;
    tooltip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => { tooltip.style.display = 'none'; };
  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mousemove', show);
  trigger.addEventListener('mouseleave', hide);
  trigger.addEventListener('click', show);
  document.addEventListener('click', (e) => { if (!trigger.contains(e.target)) hide(); });
}

export function showNotification(message, durationMs = 3000) {
  const el = document.querySelector('#notification');
  // #notification is role="status" (aria-live). Un-hide before setting text (and
  // clear text on hide) so the content change happens while the region is
  // already in the accessibility tree — some screen readers won't announce a
  // live-region update that happens in the same tick as un-hiding it.
  el.removeAttribute('hidden');
  el.textContent = message;
  setTimeout(() => { el.setAttribute('hidden', ''); el.textContent = ''; }, durationMs);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export async function renderStorageBar() {
  const used = await host.prefs.bytesInUse();
  const quota = host.prefs.quota;
  document.querySelector('#storage-bar-label').textContent = `${formatBytes(used)} / ${formatBytes(quota)}`;
}

export const QUOTA_WARN_PCT = 80;

export async function getQuotaUsage() {
  const totalBytes = await host.prefs.bytesInUse();
  const quota = host.prefs.quota;
  return { totalBytes, quota, pct: totalBytes / quota * 100 };
}

export function formatWithSmallSub(text) {
  const match = text.match(/^(.+?)(\s*\(.+\))?$/);
  return match[2] ? `${match[1]}<span class="stat-sub">${match[2]}</span>` : text;
}

export function formatWithSmallSubSvg(text) {
  const match = text.match(/^(.+?)(\s*\(.+\))?$/);
  if (!match[2]) return text;
  return `${match[1]}<tspan style="font-size: var(--stat-sub-size, 0.75em)">${match[2]}</tspan>`;
}

const chartOpts = new WeakMap();

export function drawBarChart(opts) {
  chartOpts.set(opts.svgEl, opts);
  if (!opts.svgEl.dataset.chartObserved) {
    opts.svgEl.dataset.chartObserved = '1';
    new ResizeObserver(() => {
      const o = chartOpts.get(opts.svgEl);
      if (o) _drawBarChart(o);
    }).observe(opts.svgEl);
  }
  _drawBarChart(opts);
}

function _drawBarChart({ svgEl, tooltipEl, data, maxVal, getValue, formatVal, formatTooltip = formatVal, hideMidTicks = () => false, color, series, onBarClick, scale = 'linear', gridLineWidth = 1, labelEvery: labelEveryProp }) {
  const rect = svgEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const W = rect.width, H = rect.height;
  const padLeft = 60, padRight = 8, padTop = 10, padBottom = 40;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  if (innerW <= 0 || innerH <= 0) return;
  const gap = innerW / data.length;
  const is24h = data.length === 24;
  // A narrow chart shows fewer labels: each one keeps the room its text needs.
  const minLabelPx = is24h ? 44 : 28;
  let labelEvery = labelEveryProp ?? (is24h ? 6 : Math.ceil(data.length / 10));
  while (labelEvery * gap < minLabelPx && labelEvery < data.length) labelEvery *= 2;
  const isDateLabel = !is24h && /^\d{2}-\d{2}$|^\d{4}-\d{2}(?:-\d{2})?$/.test(data[0]?.label ?? '');

  const rootStyle = getComputedStyle(document.documentElement);
  const gridColor = rootStyle.getPropertyValue('--color-border').trim() || '#f0f0f0';

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const toFrac = scale === 'sqrt'
    ? v => maxVal > 0 ? Math.sqrt(v / maxVal) : 0
    : v => maxVal > 0 ? v / maxVal : 0;

  const yTicks = [0, 1/3, 2/3, 1].map(t => ({
    val: maxVal * t,
    y: padTop + innerH - Math.round(toFrac(maxVal * t) * innerH),
  }));

  const hideMid = hideMidTicks(maxVal);
  const gridlines = yTicks.map(({ y, val }, i) => {
    const isMid = i === 1 || i === 2;
    const label = hideMid && isMid ? '' : `<text x="${padLeft - 6}" y="${y + 4}" text-anchor="end" class="chart-axis-label" fill="var(--color-text-secondary)">${formatWithSmallSubSvg(formatVal(val))}</text>`;
    return `<line x1="${padLeft}" y1="${y}" x2="${W - padRight}" y2="${y}" stroke="${gridColor}" stroke-width="${gridLineWidth}"/>${label}`;
  }).join('');

  let rects;
  if (series) {
    rects = data.map((d, i) => {
      const showLabel = i % labelEvery === 0 || (i === data.length - 1 && !is24h);
      const labelX = is24h ? padLeft + i * gap - (i > 0 ? 1 : 0) : padLeft + i * gap + gap / 2;
      const labelAnchor = is24h ? (i === 0 ? 'start' : 'middle') : 'middle';
      const labelText = isDateLabel && i !== 0 && i !== data.length - 1 ? d.label.slice(-2) : d.label;
      const labelHtml = showLabel ? `<text x="${labelX}" y="${H - 8}" text-anchor="${labelAnchor}" class="chart-axis-label" fill="var(--color-text-secondary)">${labelText}</text>` : '';

      const nonZeroBars = series.filter(s => s.getValue(d) > 0);
      const hasAnyData = nonZeroBars.length > 0;

      let bars = series.map((s, idx) => {
        const val = s.getValue(d);
        if (val === 0) return '';
        const barH = Math.round(toFrac(val) * innerH);
        const y = padTop + innerH - barH;

        let x, barWidth;
        if (idx === 0) {
          x = padLeft + i * gap;
          barWidth = gap - 2;
          return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${s.color}" rx="2"></rect>`;
        } else {
          barWidth = Math.max(2, Math.floor((gap - 2) / 3));
          x = padLeft + i * gap + (gap - 2) - barWidth;
          const borderColor = rootStyle.getPropertyValue('--color-bg').trim() || '#f0f0f0';
          return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${s.color}" rx="2"></rect>
            <path d="M ${x+2} ${y} L ${x+barWidth-2} ${y} A 2 2 0 0 1 ${x+barWidth} ${y+2} L ${x+barWidth} ${y+barH-2} A 2 2 0 0 1 ${x+barWidth-2} ${y+barH} L ${x+2} ${y+barH} A 2 2 0 0 1 ${x} ${y+barH-2} L ${x} ${y+2} A 2 2 0 0 1 ${x+2} ${y}" fill="none" stroke="${borderColor}" stroke-width="0.5"></path>`;
        }
      }).join('');

      if (hasAnyData) {
        const seriesData = nonZeroBars.map(s => {
          const val = s.getValue(d);
          const formatted = s.formatVal ? s.formatVal(val) : formatVal(val);
          return `${s.label}: ${formatted}`;
        }).join('\n');
        bars += `<rect x="${padLeft + i * gap}" y="${padTop}" width="${gap - 2}" height="${innerH}" fill="transparent"
          data-range="${d.range}" data-all-series="true" data-series-list="${seriesData}"></rect>`;
      } else {
        bars += `<rect x="${padLeft + i * gap}" y="${padTop}" width="${gap - 2}" height="${innerH}" fill="transparent"
          data-range="${d.range}" data-val="0"></rect>`;
      }
      return bars + labelHtml;
    }).join('');
  } else {
    const barW = Math.max(2, Math.floor(gap) - 2);
    rects = data.map((d, i) => {
      const val = getValue(d);
      const barH = Math.round(toFrac(val) * innerH);
      const x = padLeft + i * gap;
      const y = padTop + innerH - barH;
      const cx = padLeft + i * gap + gap / 2;
      const showLabel = i % labelEvery === 0 || (i === data.length - 1 && !is24h);
      let faviconEl = '', labelEl = '';
      if (showLabel) {
        if (d.faviconDataUrl) {
          const maxChars = Math.max(3, Math.floor((gap - 4 - 16 - 4) / 7));
          const truncated = d.label.length > maxChars;
          const label = truncated ? d.label.slice(0, maxChars - 1) + '…' : d.label;
          const groupX = cx - (16 + 4 + label.length * 7) / 2;
          faviconEl = `<image href="${d.faviconDataUrl}" x="${groupX}" y="${H - 21}" width="16" height="16"/>`;
          labelEl = `<text x="${groupX + 20}" y="${H - 8}" text-anchor="start" class="chart-axis-label" fill="var(--color-text-secondary)">${truncated ? `<title>${d.label}</title>` : ''}${label}</text>`;
        } else {
          const lx = is24h ? padLeft + i * gap - (i > 0 ? 1 : 0) : cx;
          const anchor = is24h ? (i === 0 ? 'start' : 'middle') : 'middle';
          const lt = isDateLabel && i !== 0 && i !== data.length - 1 ? d.label.slice(-2) : d.label;
          labelEl = `<text x="${lx}" y="${H - 8}" text-anchor="${anchor}" class="chart-axis-label" fill="var(--color-text-secondary)">${lt}</text>`;
        }
      }
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="2"></rect>
        <rect x="${x}" y="${padTop}" width="${barW}" height="${innerH}" fill="transparent"
          data-range="${d.range}" data-val="${val}"></rect>
        ${faviconEl}${labelEl}
      `;
    }).join('');
  }

  const closingLabel = is24h
    ? `<text x="${W - padRight}" y="${H - 8}" text-anchor="end" class="chart-axis-label" fill="var(--color-text-secondary)">${data[0].label}</text>`
    : '';
  svgEl.innerHTML = gridlines + rects + closingLabel;

  let hoverOverlay = null;

  svgEl.querySelectorAll('rect[data-range]').forEach(rect => {
    if (onBarClick) {
      rect.style.cursor = 'pointer';
      rect.tabIndex = 0;
      rect.setAttribute('role', 'button');
      rect.setAttribute('aria-label', rect.dataset.range);
      rect.addEventListener('click', () => onBarClick(rect.dataset.range));
      // Prevent mouse clicks from focusing the bar — Chromium paints its default
      // focus ring on click-focused SVG elements (its :focus-visible heuristic
      // misfires on SVG). Keyboard focus (Tab) is unaffected and keeps the ring.
      rect.addEventListener('mousedown', (e) => e.preventDefault());
      rect.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        // Dispatch a real click rather than calling onBarClick directly, so it
        // bubbles like a mouse click would — anything listening for a click on
        // an ancestor (e.g. the tour's advanceOn: 'click' steps) still fires.
        // SVGElement has no native .click() (that's HTMLElement-only), so this
        // has to be a manual event dispatch rather than rect.click().
        rect.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
    rect.addEventListener('mouseenter', () => {
      let html;
      if (rect.dataset.allSeries) {
        const seriesLines = rect.dataset.seriesList.split('\n');
        const seriesHtml = seriesLines.map(line => formatWithSmallSub(line)).join('<br>');
        html = `${seriesHtml}<br>${rect.dataset.range}`;
        if (onBarClick) html += `<br><span class="text-hint">${t('chart_clickToOpen')}</span>`;
        tooltipEl.innerHTML = html;
      } else if (rect.dataset.series) {
        const text = `${rect.dataset.series}: ${rect.dataset.format} / ${rect.dataset.range}`;
        if (onBarClick) {
          tooltipEl.innerHTML = `${text}<br><span class="text-hint">${t('chart_clickToOpen')}</span>`;
        } else {
          tooltipEl.textContent = text;
        }
      } else {
        const val = Number(rect.dataset.val);
        let text = val === 0 ? rect.dataset.range : formatWithSmallSub(formatTooltip(val)) + '<br>' + rect.dataset.range;
        if (onBarClick) text += `<br><span class="text-hint">${t('chart_clickToOpen')}</span>`;
        if (onBarClick || val > 0) {
          tooltipEl.innerHTML = text;
        } else {
          tooltipEl.textContent = text;
        }
      }
      tooltipEl.style.display = 'block';

      if (hoverOverlay) hoverOverlay.remove();
      hoverOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hoverOverlay.setAttribute('x', rect.getAttribute('x'));
      hoverOverlay.setAttribute('y', rect.getAttribute('y'));
      hoverOverlay.setAttribute('width', rect.getAttribute('width'));
      hoverOverlay.setAttribute('height', rect.getAttribute('height'));
      hoverOverlay.setAttribute('fill', rootStyle.getPropertyValue('--color-hover-bg'));
      hoverOverlay.setAttribute('pointer-events', 'none');
      hoverOverlay.setAttribute('rx', '2');
      const firstRect = svgEl.querySelector('rect');
      svgEl.insertBefore(hoverOverlay, firstRect);
    });
    rect.addEventListener('mousemove', (e) => {
      const box = svgEl.getBoundingClientRect();
      const ttW = tooltipEl.offsetWidth;
      const flipLeft = e.clientX + 10 + ttW > window.innerWidth;
      tooltipEl.style.left = flipLeft
        ? `${e.clientX - box.left - ttW - 10}px`
        : `${e.clientX - box.left + 10}px`;
      tooltipEl.style.top = `${e.clientY - box.top - 28}px`;
    });
    rect.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
      if (hoverOverlay) {
        hoverOverlay.remove();
        hoverOverlay = null;
      }
    });
  });
}
