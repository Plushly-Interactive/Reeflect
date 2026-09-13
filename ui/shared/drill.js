import { formatMs, formatMsAsDays, formatHourLabel, formatHourRange } from './timeUtils.js';
import { weekKeyForDate, daysInWeek } from './weekStart.js';
import { formatPeriodLabel, stepPeriod } from './period.js';
import { formatWithSmallSub, statLabels, chartLegendHtml } from './utils.js';
import { drawTimeChart, drawVisitsChart, drawHourlyChart, buildHourlyBuckets } from './overview.js';
import { t, getLocale } from './i18n.js';

let drillPeriod = null;
let drillPrevPeriod = null;
let drillDepth = 0;
let drillMetric = 'time';
let drillScale = 'linear';
let exitingDrill = false;

let ctx = null;

function drillInnerHtml() {
  return `
  <div id="drill-top">
    <button id="nav-close" class="link-btn">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
      ${t('rules_overview')}
    </button>
    <button id="drill-month-link" class="link-btn" style="display:none"></button>
  </div>
  <div id="drill-controls">
    <div id="nav-strip" class="nav-strip">
      <button id="nav-prev" class="link-btn nav-arrow-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
      <span id="nav-label" class="nav-period-label"></span>
      <button id="nav-next" class="link-btn nav-arrow-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
    </div>
    <div id="drill-legend" class="time-legend text-meta" style="display: none;">${chartLegendHtml()}</div>
    <label id="drill-scale-label" class="text-meta"><input type="checkbox" id="drill-scale-btn"> ${t('drill_enhanceReadability')}</label>
    <div id="drill-stats" class="text-meta"></div>
    <div id="drill-toggle" class="seg-control" role="radiogroup">
      <button id="drill-time-btn" class="drill-toggle-btn seg-btn active" role="radio" aria-checked="true">${t('site_sortTime')}</button>
      <button id="drill-visits-btn" class="drill-toggle-btn seg-btn" role="radio" aria-checked="false">${t('site_sortVisits')}</button>
      <button id="drill-hour-btn" class="drill-toggle-btn seg-btn" role="radio" aria-checked="false">${t('drill_hourlyAvg')}</button>
    </div>
  </div>
  <div id="drill-chart-wrapper">
    <button id="drill-keys-btn" class="square-btn" aria-label="${t('common_hideShortcuts')}">&times;</button>
    <div id="drill-keys-popup" class="tooltip text-meta">
      <div id="drill-keys-title">${t('drill_keyboardShortcuts')}</div>
      <div><kbd>&larr;</kbd><kbd>&rarr;</kbd> ${t('drill_navigatePeriod')}</div>
      <div><kbd>&uarr;</kbd> ${t('drill_goUpLevel')}</div>
      <div><kbd>&darr;</kbd> ${t('drill_goToFirst')}</div>
      <div><kbd>Space</kbd> ${t('drill_toggleMode')}</div>
      <div><kbd>Esc</kbd> ${t('drill_exitToOverview')}</div>
    </div>
    <svg id="drill-chart"></svg>
    <div id="drill-tooltip" class="tooltip text-meta"></div>
    <p id="drill-no-data" class="text-meta" style="display:none">${t('dashboard_noData')}</p>
  </div>
`;
}

export function initDrill(context) {
  ctx = context;
  ctx.drillView.innerHTML = drillInnerHtml();
  ctx.navPrev = ctx.drillView.querySelector('#nav-prev');
  ctx.navNext = ctx.drillView.querySelector('#nav-next');
  ctx.navClose = ctx.drillView.querySelector('#nav-close');
  ctx.navLabel = ctx.drillView.querySelector('#nav-label');
  ctx.drillTimeBtn = ctx.drillView.querySelector('#drill-time-btn');
  ctx.drillVisitsBtn = ctx.drillView.querySelector('#drill-visits-btn');
  ctx.drillHourBtn = ctx.drillView.querySelector('#drill-hour-btn');
  ctx.drillChart = ctx.drillView.querySelector('#drill-chart');
  ctx.drillTooltip = ctx.drillView.querySelector('#drill-tooltip');
  ctx.drillLegend = ctx.drillView.querySelector('#drill-legend');
  ctx.drillNoData = ctx.drillView.querySelector('#drill-no-data');
  ctx.drillMonthLink = ctx.drillView.querySelector('#drill-month-link');
  ctx.drillStats = ctx.drillView.querySelector('#drill-stats');
  ctx.drillScaleBtn = ctx.drillView.querySelector('#drill-scale-btn');
  ctx.drillKeysBtn = ctx.drillView.querySelector('#drill-keys-btn');
  ctx.drillKeysPopup = ctx.drillView.querySelector('#drill-keys-popup');

  ctx.navPrev.addEventListener('click', () => navigatePeriod(-1));
  ctx.navNext.addEventListener('click', () => navigatePeriod(1));
  ctx.navClose.addEventListener('click', exitDrillCompletely);

  ctx.drillTimeBtn.addEventListener('click', () => {
    drillMetric = 'time';
    updateDrillButtons();
    renderDrillChart();
  });

  ctx.drillVisitsBtn.addEventListener('click', () => {
    drillMetric = 'visits';
    updateDrillButtons();
    renderDrillChart();
  });

  ctx.drillHourBtn.addEventListener('click', () => {
    drillMetric = 'hour';
    updateDrillButtons();
    renderDrillChart();
  });

  ctx.drillScaleBtn.addEventListener('change', () => {
    drillScale = ctx.drillScaleBtn.checked ? 'sqrt' : 'linear';
    renderDrillChart();
  });

  ctx.drillKeysBtn.addEventListener('click', () => {
    const visible = ctx.drillKeysPopup.style.display !== 'none';
    ctx.drillKeysPopup.style.display = visible ? 'none' : 'flex';
    ctx.drillKeysBtn.innerHTML = visible ? '?' : '&times;';
    ctx.drillKeysBtn.setAttribute('aria-label', t(visible ? 'common_showShortcuts' : 'common_hideShortcuts'));
  });

  window.addEventListener('keydown', (e) => {
    if (!drillPeriod) return;
    if (document.body.classList.contains('tour-drill-step')) return;
    if (e.key === ' ') {
      e.preventDefault();
      const modes = drillPeriod.length === 10 ? ['time', 'visits'] : ['time', 'visits', 'hour'];
      drillMetric = modes[(modes.indexOf(drillMetric) + 1) % modes.length];
      updateDrillButtons();
      renderDrillChart();
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePeriod(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigatePeriod(1); }
    else if (e.key === 'ArrowUp') {
      if (drillPeriod.length === 10) {
        e.preventDefault();
        const [y, m, d] = drillPeriod.split('-').map(Number);
        enterDrill(weekKeyForDate(new Date(y, m - 1, d)), null, drillMetric);
      } else if (drillPeriod.length === 11) {
        e.preventDefault();
        enterDrill(drillPeriod.slice(0, 7), null, drillMetric);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitDrillCompletely();
    } else if (e.key === 'ArrowDown') {
      if (drillPeriod.length === 7) {
        e.preventDefault();
        const [y, m] = drillPeriod.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
          const dayKey = `${drillPeriod}-${String(i).padStart(2, '0')}`;
          const entry = ctx.getDayEntry(dayKey);
          if (entry.activeMs > 0 || entry.visits > 0) {
            enterDrill(weekKeyForDate(new Date(y, m - 1, i)), null, drillMetric);
            break;
          }
        }
      } else if (drillPeriod.length === 11) {
        e.preventDefault();
        for (const dayKey of daysInWeek(drillPeriod)) {
          const entry = ctx.getDayEntry(dayKey);
          if (entry.activeMs > 0 || entry.visits > 0) {
            enterDrill(dayKey, drillPeriod, drillMetric);
            break;
          }
        }
      }
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'theme' && drillPeriod) renderDrillChart();
  });

  window.addEventListener('popstate', (e) => {
    if (exitingDrill) {
      exitingDrill = false;
      return;
    }
    if (e.state?.drill) {
      drillPeriod = e.state.period;
      drillPrevPeriod = e.state.prevPeriod;
      drillDepth = e.state.depth ?? 1;
      ctx.chartsGrid.style.display = 'none';
      ctx.drillView.style.display = 'flex';
      ctx.rangeSelect.style.display = 'none';
      ctx.navLabel.textContent = formatPeriodLabel(drillPeriod);
      renderDrillChart();
    } else if (drillPeriod) {
      drillDepth = 0;
      drillPeriod = null;
      drillPrevPeriod = null;
      ctx.chartsGrid.style.display = '';
      ctx.drillView.style.display = 'none';
      ctx.rangeSelect.style.display = '';
      ctx.render();
    }
  });
}

export function isInDrillMode() {
  return drillPeriod !== null;
}

export function enterDrill(period, fromPeriod, metric = 'time') {
  drillPrevPeriod = fromPeriod ?? null;
  drillPeriod = period;
  drillDepth++;
  drillMetric = metric;
  ctx.chartsGrid.style.display = 'none';
  ctx.drillView.style.display = 'flex';
  ctx.rangeSelect.style.display = 'none';
  ctx.navLabel.textContent = formatPeriodLabel(drillPeriod);
  history.pushState({ drill: true, period, prevPeriod: fromPeriod ?? null, depth: drillDepth }, '');
  updateDrillButtons();
  renderDrillChart();
}

export function exitDrillCompletely() {
  const depth = drillDepth;
  drillDepth = 0;
  drillPeriod = null;
  drillPrevPeriod = null;
  ctx.chartsGrid.style.display = '';
  ctx.drillView.style.display = 'none';
  ctx.rangeSelect.style.display = '';
  ctx.render();
  if (depth > 0) {
    exitingDrill = true;
    history.go(-depth);
  }
}

function updateDrillButtons() {
  ctx.drillTimeBtn.classList.toggle('active', drillMetric === 'time');
  ctx.drillTimeBtn.setAttribute('aria-checked', drillMetric === 'time' ? 'true' : 'false');
  ctx.drillVisitsBtn.classList.toggle('active', drillMetric === 'visits');
  ctx.drillVisitsBtn.setAttribute('aria-checked', drillMetric === 'visits' ? 'true' : 'false');
  ctx.drillHourBtn.classList.toggle('active', drillMetric === 'hour');
  ctx.drillHourBtn.setAttribute('aria-checked', drillMetric === 'hour' ? 'true' : 'false');
}

function navigatePeriod(dir) {
  drillPeriod = stepPeriod(drillPeriod, dir);
  ctx.navLabel.textContent = formatPeriodLabel(drillPeriod);
  renderDrillChart();
}

async function renderDrillChart() {
  const isMonthDrill = drillPeriod.length === 7;
  const isWeekDrill = drillPeriod.length === 11;
  const isDayDrill = drillPeriod.length === 10;
  ctx.drillHourBtn.style.display = isDayDrill ? 'none' : 'block';
  if (isDayDrill && drillMetric === 'hour') {
    drillMetric = 'time';
    updateDrillButtons();
  }
  let data;

  if (isMonthDrill) {
    const [y, m] = drillPeriod.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    data = Array.from({ length: daysInMonth }, (_, i) => {
      const dayKey = `${drillPeriod}-${String(i + 1).padStart(2, '0')}`;
      return { label: String(i + 1), range: dayKey, ...ctx.getDayEntry(dayKey) };
    });
  } else if (isWeekDrill) {
    data = daysInWeek(drillPeriod).map(dayKey => {
      const [y, m, d] = dayKey.split('-').map(Number);
      const shortDayFmt = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' });
      return { label: `${shortDayFmt.format(new Date(y, m - 1, d))} ${d}`, range: dayKey, ...ctx.getDayEntry(dayKey) };
    });
  } else {
    const hourData = await ctx.getHourEntriesForDay(drillPeriod);
    data = Array.from({ length: 24 }, (_, h) => {
      const hourKey = `${drillPeriod}T${String(h).padStart(2, '0')}`;
      return { label: formatHourLabel(h, ctx.clockFormat), range: formatHourRange(h, '–', ctx.clockFormat), ...(hourData[hourKey] ?? { activeMs: 0, audioMs: 0, visits: 0 }) };
    });
  }

  if (isMonthDrill) {
    ctx.drillMonthLink.style.display = 'none';
  } else if (isWeekDrill) {
    const monthKey = drillPeriod.slice(0, 7);
    ctx.drillMonthLink.textContent = formatPeriodLabel(monthKey);
    ctx.drillMonthLink.style.display = 'block';
    ctx.drillMonthLink.onclick = () => enterDrill(monthKey, null, drillMetric);
  } else {
    const [y, m, d] = drillPeriod.split('-').map(Number);
    const weekKey = weekKeyForDate(new Date(y, m - 1, d));
    ctx.drillMonthLink.textContent = formatPeriodLabel(weekKey);
    ctx.drillMonthLink.style.display = 'block';
    ctx.drillMonthLink.onclick = () => enterDrill(weekKey, null, drillMetric);
  }

  const hasData = data.some(d => d.activeMs > 0 || d.visits > 0);
  ctx.drillNoData.style.display = hasData ? 'none' : 'block';
  ctx.drillChart.style.display = hasData ? 'block' : 'none';
  ctx.drillLegend.style.display = 'none';

  const totalMs = data.reduce((s, d) => s + d.activeMs + (d.audioMs ?? 0) - (d.overlapMs ?? 0), 0);
  const totalVisits = data.reduce((s, d) => s + d.visits, 0);
  const labels = statLabels();
  const stats = [];
  if (totalMs > 0) stats.push({ label: labels.totalTime, value: formatMs(totalMs) });
  if (totalVisits > 0) stats.push({ label: labels.visits, value: totalVisits });
  if (totalMs > 0 && totalVisits > 0) stats.push({ label: labels.avgSession, value: formatMs(totalMs / totalVisits) });
  ctx.drillStats.innerHTML = stats.map(s => {
    const isTimeValue = s.label === labels.totalTime || s.label === labels.avgSession;
    const displayValue = isTimeValue ? formatWithSmallSub(s.value) : s.value;
    return `<div><span class="stat-label">${s.label}</span> <span class="stat-value">${displayValue}</span></div>`;
  }).join('');

  if (!hasData) return;

  const onBarClick = !isDayDrill ? r => enterDrill(r, drillPeriod, drillMetric) : null;
  const maxTimeMs = isDayDrill ? 3600000 : 24 * 3600000;

  if (drillMetric === 'time') {
    const formatValForAxis = isDayDrill
      ? formatMs
      : (val) => Math.abs(val - maxTimeMs) < 1 ? formatMsAsDays(val) : formatMs(val);
    drawTimeChart({
      svgEl: ctx.drillChart,
      tooltipEl: ctx.drillTooltip,
      legendEl: ctx.drillLegend,
      data,
      maxVal: maxTimeMs,
      formatVal: formatValForAxis,
      onBarClick,
      scale: drillScale,
      gridLineWidth: 0.5,
      labelEvery: isDayDrill ? 3 : undefined,
    });
  } else if (drillMetric === 'visits') {
    ctx.drillLegend.style.display = 'none';
    drawVisitsChart({
      svgEl: ctx.drillChart,
      tooltipEl: ctx.drillTooltip,
      data,
      onBarClick,
      scale: drillScale,
      gridLineWidth: 0.5,
      labelEvery: isDayDrill ? 3 : undefined,
    });
  } else if (drillMetric === 'hour') {
    ctx.drillLegend.style.display = 'none';
    let dayKeys;
    if (isMonthDrill) {
      const [y, m] = drillPeriod.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      dayKeys = [];
      for (let i = 1; i <= daysInMonth; i++) {
        dayKeys.push(`${drillPeriod}-${String(i).padStart(2, '0')}`);
      }
    } else if (isWeekDrill) {
      dayKeys = daysInWeek(drillPeriod);
    } else {
      dayKeys = [drillPeriod];
    }

    const hourlyData = buildHourlyBuckets(await ctx.getAvgPerClockHour(dayKeys), ctx.clockFormat);
    const hasHourlyData = hourlyData.some(d => d.activeMs > 0);
    ctx.drillNoData.style.display = hasHourlyData ? 'none' : 'block';
    ctx.drillChart.style.display = hasHourlyData ? 'block' : 'none';
    if (!hasHourlyData) return;

    drawHourlyChart({
      svgEl: ctx.drillChart,
      tooltipEl: ctx.drillTooltip,
      data: hourlyData,
      maxVal: 3600000,
      scale: drillScale,
      gridLineWidth: 0.5,
      labelEvery: 3,
    });
  }
}
