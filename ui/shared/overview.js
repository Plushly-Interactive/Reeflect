import { localDayKey, formatMs, formatHourLabel, formatHourRange } from './timeUtils.js';
import { drawBarChart, formatWithSmallSub } from './utils.js';
import { t } from './i18n.js';

const SUBHEADING_KEYS = {
  today: 'overview_sub_today',
  '7': 'overview_sub_7',
  '30': 'overview_sub_30',
  '180': 'overview_sub_180',
  '365': 'overview_sub_365',
  all: 'overview_sub_all',
};

export function subheadingText(range) {
  return SUBHEADING_KEYS[range] ? t(SUBHEADING_KEYS[range]) : '';
}

export function activeDaysFromRange(range, byDayCache) {
  if (range === 'today') return 0;
  if (range === 'all') {
    const allDays = Object.keys(byDayCache ?? {}).sort();
    if (allDays.length === 0) return 0;
    const [y1, m1, d1] = allDays[0].split('-').map(Number);
    const [y2, m2, d2] = allDays[allDays.length - 1].split('-').map(Number);
    const start = new Date(y1, m1 - 1, d1);
    const end = new Date(y2, m2 - 1, d2);
    return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
  }
  return parseInt(range);
}

export function buildOverviewData({ range, dayKeys, getDayEntry, getHourEntry, clockFormat = '24h' }) {
  if (range === 'today') {
    const dayKey = localDayKey(Date.now());
    return Array.from({ length: 24 }, (_, h) => {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      return { label: formatHourLabel(h, clockFormat), range: formatHourRange(h, ' - ', clockFormat), ...getHourEntry(hourKey) };
    });
  }
  if (range === 'all' || parseInt(range) > 90) {
    let monthKeys;
    if (range === 'all') {
      monthKeys = [...new Set(dayKeys.map(d => d.slice(0, 7)))].sort();
    } else {
      const numMonths = Math.round(parseInt(range) / 30);
      const now = new Date();
      monthKeys = Array.from({ length: numMonths }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (numMonths - 1 - i), 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
    }
    return monthKeys.map(month => {
      const days = dayKeys.filter(d => d.startsWith(month));
      const totals = days.reduce((acc, d) => {
        const e = getDayEntry(d);
        return {
          activeMs: acc.activeMs + e.activeMs,
          audioMs: acc.audioMs + e.audioMs,
          overlapMs: acc.overlapMs + (e.overlapMs ?? 0),
          visits: acc.visits + e.visits,
        };
      }, { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 });
      return { label: month, range: month, ...totals };
    });
  }
  const shortLabel = parseInt(range) <= 30;
  return dayKeys.map(d => ({ label: shortLabel ? d.slice(5) : d, range: d, ...getDayEntry(d) }));
}

export function drawTimeChart({ svgEl, tooltipEl, legendEl, data, maxVal, formatVal, onBarClick, scale, gridLineWidth, labelEvery }) {
  const rootStyle = getComputedStyle(document.documentElement);
  const hasAudio = data.some(d => d.audioMs > 0);
  if (legendEl) legendEl.style.display = hasAudio ? 'flex' : 'none';

  const series = hasAudio
    ? [
        { label: t('legend_active'), getValue: d => d.activeMs, color: rootStyle.getPropertyValue('--color-chart-time'), formatVal: formatMs },
        { label: t('legend_audio'), getValue: d => d.audioMs, color: rootStyle.getPropertyValue('--color-chart-audio'), formatVal: formatMs },
      ]
    : undefined;

  drawBarChart({
    svgEl,
    tooltipEl,
    data,
    maxVal: maxVal ?? Math.max(...data.map(d => Math.max(d.activeMs, d.audioMs || 0))),
    getValue: d => d.activeMs,
    formatVal: formatVal ?? (ms => formatMs(ms)),
    color: rootStyle.getPropertyValue('--color-chart-time'),
    series,
    onBarClick,
    scale,
    gridLineWidth,
    labelEvery,
  });
}

export function buildHourlyBuckets(avgPerHours, clockFormat = '24h') {
  return avgPerHours.map((avgMs, h) => ({
    label: formatHourLabel(h, clockFormat),
    range: formatHourRange(h, ' - ', clockFormat),
    activeMs: avgMs,
  }));
}

export function drawHourlyChart({ svgEl, tooltipEl, data, maxVal, scale, gridLineWidth, labelEvery }) {
  const rootStyle = getComputedStyle(document.documentElement);
  drawBarChart({
    svgEl,
    tooltipEl,
    data,
    maxVal: maxVal ?? Math.max(...data.map(d => d.activeMs), 1),
    getValue: d => d.activeMs,
    formatVal: ms => formatMs(ms),
    color: rootStyle.getPropertyValue('--color-chart-hourly'),
    scale,
    gridLineWidth,
    labelEvery,
  });
}

export function drawVisitsChart({ svgEl, tooltipEl, data, maxVal, onBarClick, scale, gridLineWidth, labelEvery }) {
  const rootStyle = getComputedStyle(document.documentElement);
  drawBarChart({
    svgEl,
    tooltipEl,
    data,
    maxVal: maxVal ?? Math.max(...data.map(d => d.visits), 1),
    getValue: d => d.visits,
    formatVal: v => `${Math.round(v)}`,
    formatTooltip: v => { const n = Math.round(v); return n === 1 ? t('visits_one', [n]) : t('visits_other', [n]); },
    hideMidTicks: maxV => maxV < 3,
    color: rootStyle.getPropertyValue('--color-chart-visits'),
    onBarClick,
    scale,
    gridLineWidth,
    labelEvery,
  });
}

export function renderBaseStats(data, range, byDayCache) {
  const totalMs = data.reduce((s, d) => s + d.activeMs + (d.audioMs ?? 0) - (d.overlapMs ?? 0), 0);
  const totalVisits = data.reduce((s, d) => s + d.visits, 0);
  const activeDays = activeDaysFromRange(range, byDayCache);
  const avgMs = activeDays > 0 ? totalMs / activeDays : 0;

  const totalTimeEl = document.querySelector('#stat-total-time');
  if (totalMs > 0) totalTimeEl.innerHTML = formatWithSmallSub(formatMs(totalMs));
  else totalTimeEl.textContent = '—';

  const dailyAvgEl = document.querySelector('#stat-daily-avg');
  if (activeDays > 0 && totalMs > 0) dailyAvgEl.innerHTML = formatWithSmallSub(formatMs(avgMs));
  else dailyAvgEl.textContent = '—';

  document.querySelector('#stat-visits').textContent = totalVisits > 0 ? totalVisits : '—';

  return { totalMs, totalVisits, activeDays, avgMs };
}

export function drawOverviewCharts({
  data,
  range,
  timeChart, timeTooltip, timeLegend, timeNoData,
  visitsChart, visitsTooltip, visitsNoData,
  onEnterDrill,
}) {
  const hasData = data.some(d => d.activeMs > 0 || d.visits > 0);
  timeLegend.style.display = 'none';
  timeChart.style.display = hasData ? 'block' : 'none';
  visitsChart.style.display = hasData ? 'block' : 'none';
  timeNoData.style.display = hasData ? 'none' : 'block';
  visitsNoData.style.display = hasData ? 'none' : 'block';
  if (!hasData) return;

  const drillable = range !== 'today';
  drawTimeChart({
    svgEl: timeChart, tooltipEl: timeTooltip, legendEl: timeLegend, data,
    onBarClick: drillable ? r => onEnterDrill(r, 'time') : null,
  });
  drawVisitsChart({
    svgEl: visitsChart, tooltipEl: visitsTooltip, data,
    onBarClick: drillable ? r => onEnterDrill(r, 'visits') : null,
  });
}
