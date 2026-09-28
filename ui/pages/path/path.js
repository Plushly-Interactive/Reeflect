import { localDayKey, dayKeysForRange, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { statLabels, chartLegendHtml, timeChartHtml, visitsChartHtml, hourlyChartHtml, showHeaderFavicon, openSiteLink, loadFaviconCache, navButton, keyActivate } from '../../shared/utils.js';
import { formatHostnameLabel, idsSummary, iconId } from '../../shared/labels.js';
import { siteHeaderIds } from '../../shared/siteHeader.js';
import { createRangeDropdown, initRangeSelect } from '../../shared/rangeSelect.js';
import { createDevicePicker, initDevicePicker } from '../../shared/devicePicker.js';
import { mountHeaderFilters } from '../../shared/phoneHeader.js';
import { displayPath, stripQuery } from '../../shared/paths.js';
import { initDrill, isInDrillMode, enterDrill } from '../../shared/drill.js';
import { createHourlyChart } from '../../shared/hourlyChart.js';
import { buildOverviewData, drawOverviewCharts, subheadingText, renderBaseStats } from '../../shared/overview.js';
import { autoStartIfMatches, PHONE_WIDTH, onwardStep } from '../../shared/tour.js';
import { clearMockModeCache } from '../../shared/tourMockData.js';
import { loadMergedTrackingData } from '../../data/mergeDataSources.js';
import { onRefreshed } from '../../data/intervalAggregates.js';
import { QUERY_SUBPAGES_BY_DAY, QUERY_SUBPAGES_BY_HOUR } from '../../shared/queryTypes.js';
import { PREF_CLOCK_FORMAT } from '../../shared/prefKeys.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { applyChartColorOverrides } from '../../shared/chartColors.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
await applyChartColorOverrides();

const drillParams = new URLSearchParams(location.search);
if (!drillParams.has('ids') || !drillParams.has('path')) {
  location.href = '../dashboard/dashboard.html';
}

const siteIds = drillParams.get('ids').split(',');
const path = drillParams.get('path');
const prefix = drillParams.get('prefix') === '1';
const stripParams = drillParams.get('stripParams') === '1';
const siteId = siteIds[0];
const isMerged = siteIds.length > 1;
// Interval log is authoritative; loadMergedTrackingData serves interval days and
// merges frozen legacy buckets underneath.
const fetchData = loadMergedTrackingData;
const DASH = '../dashboard/dashboard.html';

mountHeaderFilters(createRangeDropdown(), createDevicePicker());
const limitBtn = document.querySelector('#limit-btn');
function wireLimit(host) {
  navButton(limitBtn, `../rules/rules.html?target=${encodeURIComponent(host + stripQuery(path))}`);
  limitBtn.style.display = '';
}
if (isMerged) limitBtn.style.display = 'none';
else wireLimit(siteId);
const chartsGrid = document.querySelector('#charts-grid');
chartsGrid.insertAdjacentHTML('afterbegin', timeChartHtml());
chartsGrid.insertAdjacentHTML('beforeend', visitsChartHtml());
chartsGrid.insertAdjacentHTML('beforeend', hourlyChartHtml());
const rangeSelect = document.querySelector('#range-select');
const timeChart = document.querySelector('#time-chart');
const timeTooltip = document.querySelector('#time-tooltip');
const timeLegend = document.querySelector('#time-legend');
const timeNoData = document.querySelector('#time-no-data');
const visitsChart = document.querySelector('#visits-chart');
const visitsTooltip = document.querySelector('#visits-tooltip');
const visitsNoData = document.querySelector('#visits-no-data');
const statsList = document.querySelector('#stats-list');
const backBtn = document.querySelector('#back-btn');
keyActivate(backBtn, [' ']);
const crumbSite = document.querySelector('#path-crumb-site');

await loadFaviconCache();
const siteLabel = formatHostnameLabel(siteId);
document.querySelector('#site-label').textContent = siteLabel;
siteHeaderIds()(siteIds);
showHeaderFavicon(document.querySelector('#site-favicon'), iconId(siteIds));
document.title = `${siteLabel} ${displayPath(path)} - ${BRAND_NAME}`;
const crumbPath = document.querySelector('#path-crumb-path');
const spacedPath = displayPath(path).replace(/\//g, ' / ').trimStart() + (prefix ? ' *' : '');
crumbPath.textContent = spacedPath;
crumbPath.title = displayPath(path) + (prefix ? '*' : '');

function setCrumbDomain(domain) {
  crumbSite.textContent = domain ?? idsSummary(siteIds);
  if (domain) {
    crumbPath.href = `https://${domain}${path}`;
  } else {
    crumbPath.removeAttribute('href');
    crumbPath.removeAttribute('target');
  }
}
setCrumbDomain(isMerged ? null : siteId);

function resolveOwningDomain() {
  const owners = new Set();
  for (const sites of Object.values(byDayCache ?? {})) {
    for (const sid of siteIds) {
      const sitePaths = sites[sid];
      if (!sitePaths) continue;
      for (const k of Object.keys(sitePaths)) {
        if (matchesPath(k)) { owners.add(sid); break; }
      }
    }
  }
  return owners.size === 1 ? [...owners][0] : null;
}

const pathLinks = document.querySelector('#path-links');
const pathLinksToggle = document.querySelector('#path-links-toggle');
const pathLinksToggleLabel = document.querySelector('#path-links-toggle-label');

let singleLink = null;

function togglePathLinks(e) {
  e.stopPropagation();
  e.preventDefault();
  const open = pathLinks.classList.toggle('open');
  pathLinksToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function handleCrumbClick(e) {
  if (singleLink) {
    e.preventDefault();
    openSiteLink(singleLink.domain, singleLink.fullPath);
    return;
  }
  if (pathLinksToggle.style.display !== 'none') togglePathLinks(e);
}

pathLinksToggle.addEventListener('click', handleCrumbClick);
crumbPath.addEventListener('click', handleCrumbClick);

document.addEventListener('click', (e) => {
  if (pathLinks.contains(e.target)) return;
  if (e.target === pathLinksToggle || pathLinksToggle.contains(e.target)) return;
  if (e.target === crumbPath && pathLinksToggle.style.display !== 'none') return;
  pathLinks.classList.remove('open');
  pathLinksToggle.setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pathLinks.classList.remove('open');
    pathLinksToggle.setAttribute('aria-expanded', 'false');
  }
});

function resolveOwningEntries() {
  const totals = new Map();
  for (const sites of Object.values(byDayCache ?? {})) {
    for (const sid of siteIds) {
      const sitePaths = sites[sid];
      if (!sitePaths) continue;
      for (const [k, d] of Object.entries(sitePaths)) {
        if (!matchesPath(k)) continue;
        const key = `${sid}\0${k}`;
        const cur = totals.get(key) ?? { domain: sid, fullPath: k, activeMs: 0, visits: 0 };
        cur.activeMs += d.activeMs || 0;
        cur.visits += d.visits || 0;
        totals.set(key, cur);
      }
    }
  }
  const entries = [...totals.values()].filter(e => e.activeMs > 0 || e.visits > 0);
  entries.sort((a, b) => a.domain.localeCompare(b.domain) || a.fullPath.localeCompare(b.fullPath));
  return entries;
}

function chipLabel(fullPath) {
  return displayPath(fullPath);
}

function renderPathLinks(entries) {
  pathLinks.replaceChildren();
  singleLink = null;
  if (entries.length === 0) {
    pathLinksToggle.style.display = 'none';
    return;
  }
  pathLinksToggle.style.display = '';
  pathLinksToggleLabel.textContent = entries.length === 1 ? t('path_clickToOpen') : t('path_clickToSeeLinks');
  if (entries.length === 1) {
    const { domain, fullPath } = entries[0];
    singleLink = { domain, fullPath };
    crumbPath.href = `https://${domain}${fullPath}`;
    return;
  }
  for (const { domain, fullPath } of entries) {
    const chip = document.createElement('a');
    chip.className = 'path-link-chip';
    chip.tabIndex = 0;
    chip.href = `https://${domain}${fullPath}`;
    chip.title = `https://${domain}${displayPath(fullPath)}`;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      openSiteLink(domain, fullPath);
    });
    const dom = document.createElement('span');
    dom.className = 'path-link-chip-domain';
    dom.textContent = domain;
    chip.append(dom, chipLabel(fullPath));
    pathLinks.appendChild(chip);
  }
}

const siteHref = isMerged
  ? `../site/site.html?ids=${encodeURIComponent(siteIds.join(','))}`
  : `../site/site.html?id=${encodeURIComponent(siteId)}`;
backBtn.href = DASH;
crumbSite.href = siteHref;

const labels = statLabels();
const stats = [
  { label: labels.totalTime, id: 'stat-total-time' },
  { label: labels.dailyAvg, id: 'stat-daily-avg' },
  { label: labels.visits, id: 'stat-visits' },
];
stats.forEach(s => {
  const item = document.createElement('div');
  item.className = 'stat-item';
  item.innerHTML = `<span class="stat-label">${s.label}</span><span class="stat-value" id="${s.id}"></span>`;
  statsList.appendChild(item);
});

timeLegend.innerHTML = chartLegendHtml();

const drillView = document.querySelector('#drill-view');

let byDayCache = null;
let byHourCache = null;

function matchesPath(key) {
  const k = stripParams ? stripQuery(key) : key;
  return prefix ? (k === path || k.startsWith(path + '/')) : k === path;
}

function entryFor(cache, key) {
  const acc = { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 };
  const data = cache?.[key];
  if (!data) return acc;
  for (const sid of siteIds) {
    const sitePaths = data[sid];
    if (!sitePaths) continue;
    for (const [k, d] of Object.entries(sitePaths)) {
      if (!matchesPath(k)) continue;
      acc.activeMs += d.activeMs || 0;
      acc.audioMs += d.audioMs || 0;
      acc.overlapMs += d.overlapMs || 0;
      acc.visits += d.visits || 0;
    }
  }
  return acc;
}

const getDayEntry = (dayKey) => entryFor(byDayCache, dayKey);
const getHourEntry = (hourKey) => entryFor(byHourCache, hourKey);

function avgPerClockHour(dayKeys) {
  if (dayKeys.length === 0) return new Array(24).fill(0);
  const sums = new Array(24).fill(0);
  for (const dayKey of dayKeys) {
    for (let h = 0; h < 24; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      sums[h] += getHourEntry(hourKey).activeMs;
    }
  }
  return sums.map(s => s / dayKeys.length);
}

const clockFormatStored = await host.prefs.get(PREF_CLOCK_FORMAT);
const clockFormat = clockFormatStored[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;

const hourly = createHourlyChart({
  chart: document.querySelector('#hourly-chart'),
  tooltip: document.querySelector('#hourly-tooltip'),
  container: document.querySelector('#hourly-chart-container'),
  subheading: document.querySelector('#hourly-subheading'),
  notRelevant: document.querySelector('#hourly-not-relevant'),
  allDaysLabel: t('site_hourly_allDays'),
  getRangeValue: () => rangeSelect.dataset.value,
  loadAvgPerHour: (range) => {
    const todayKey = localDayKey(Date.now());
    return avgPerClockHour(dayKeysForRange(range, byDayCache).filter(d => d !== todayKey));
  },
  clockFormat,
});

initDrill({
  chartsGrid,
  drillView,
  rangeSelect,
  clockFormat,
  getDayEntry,
  getHourEntriesForDay: (dayKey) => {
    const result = {};
    for (let h = 0; h < 24; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      result[hourKey] = getHourEntry(hourKey);
    }
    return result;
  },
  getAvgPerClockHour: avgPerClockHour,
  render,
});

initRangeSelect(rangeSelect, render);
initDevicePicker(document.querySelector('#device-picker'), () => {
  byDayCache = null;
  byHourCache = null;
  hourly.clearCache();
  loadAndRender();
});
onRefreshed(() => {
  byDayCache = null;
  byHourCache = null;
  hourly.clearCache();
  loadAndRender(true);
});
window.addEventListener('storage', (e) => { if (e.key === 'theme') render(); });

const loadAndRenderPromise = loadAndRender();

// `quiet`: a background refresh replaced the saved copy; draw again without the loading look.
async function loadAndRender(quiet = false) {
  if (!quiet) document.body.classList.add('is-loading');
  [byDayCache, byHourCache] = await Promise.all([
    fetchData({ type: QUERY_SUBPAGES_BY_DAY, domains: siteIds }),
    fetchData({ type: QUERY_SUBPAGES_BY_HOUR, domains: siteIds }),
  ]);
  if (isMerged) {
    const owner = resolveOwningDomain();
    setCrumbDomain(owner);
    if (owner) wireLimit(owner);
  }
  renderPathLinks(resolveOwningEntries());
  render();
  document.body.classList.remove('is-loading');
}

function render() {
  if (isInDrillMode()) return;
  const range = rangeSelect.dataset.value;
  const dayKeys = dayKeysForRange(range, byDayCache);
  const data = buildOverviewData({ range, dayKeys, clockFormat, getDayEntry, getHourEntry });
  drawOverviewCharts({
    data, range,
    timeChart, timeTooltip, timeLegend, timeNoData,
    visitsChart, visitsTooltip, visitsNoData,
    onEnterDrill: (r, metric) => enterDrill(r, null, metric),
  });
  renderStats(data, range);
  hourly.render(range);
}

function renderStats(data, range) {
  renderBaseStats(data, range, byDayCache);
  document.querySelector('#overview-subheading').textContent = subheadingText(range);
}

function pathTourSteps() { return [
  {
    selector: '#path-subheader',
    title: t('tour_path_details_title'),
    body: t('tour_path_details_body'),
  },
  // At phone widths the next dashboard step shows here: its target is in the bottom nav.
  PHONE_WIDTH ? onwardStep('timeline') : {
    selector: '#back-btn',
    title: t('tour_path_back_title'),
    body: t('tour_path_back_body'),
    handoff: { nextSurface: 'dashboard', nextStepIndex: 6, mode: 'inPage' },
  },
]; }

loadAndRenderPromise.then(() => autoStartIfMatches('path', pathTourSteps(), {
  onClose: ({ skipped }) => {
    if (skipped) {
      clearMockModeCache();
      byDayCache = null;
      byHourCache = null;
      loadAndRender();
    }
  },
}));
