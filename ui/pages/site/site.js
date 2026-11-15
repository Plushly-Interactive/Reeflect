import { getGroups, groupForId, groupLabel } from '../../shared/groups.js';
import { formatMs, localDayKey, dayKeysForRange, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { statLabels, escapeHtml, chartLegendHtml, navButton, timeChartHtml, visitsChartHtml, hourlyChartHtml, showHeaderFavicon, openSiteLink, loadFaviconCache, attachInputClear, keyActivate, attachInfoTooltip } from '../../shared/utils.js';
import { eTLDPlus1 } from '../../background/siteResolution.js';
import { appLabel, formatHostnameLabel, resourceIconUrl, resolveFavicons } from '../../shared/labels.js';
import { siteHeaderIds } from '../../shared/siteHeader.js';
import { initDrill, isInDrillMode, enterDrill, exitDrillCompletely } from '../../shared/drill.js';
import { createRangeDropdown, initRangeSelect } from '../../shared/rangeSelect.js';
import { createDevicePicker, initDevicePicker, deviceLabeler } from '../../shared/devicePicker.js';
import { createCheckboxDropdown, renderCheckboxOptions } from '../../shared/dropdown.js';
import { mountHeaderFilters, mountTableControls } from '../../shared/phoneHeader.js';
import { createHourlyChart } from '../../shared/hourlyChart.js';
import { mergePaths, displayPath, stripQuery } from '../../shared/paths.js';
import { buildOverviewData, drawOverviewCharts, subheadingText, renderBaseStats } from '../../shared/overview.js';
import { autoStartIfMatches } from '../../shared/tour.js';
import { clearMockModeCache } from '../../shared/tourMockData.js';
import { loadMergedTrackingData } from '../../data/mergeDataSources.js';
import { onRefreshed, usageBreakdown } from '../../data/intervalAggregates.js';
import {
  QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY,
  QUERY_SITES_BY_HOUR_FOR_DAY, QUERY_SUBPAGES_BY_DAY,
  QUERY_AVG_PER_CLOCK_HOUR,
} from '../../shared/queryTypes.js';
import { PREF_CLOCK_FORMAT, PREF_HIDE_BRIEF, PREF_RESOURCE_GROUPS } from '../../shared/prefKeys.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { applyChartColorOverrides } from '../../shared/chartColors.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
await applyChartColorOverrides();

const PREF_STRIP_PARAMS = 'subpagesStripParams';
const PREF_SUBPAGE_SEARCH = 'subpageSearch';

const params = new URLSearchParams(location.search);
const siteId = params.get('id');
const resourceGroupList = await getGroups();
const resourceGroup = resourceGroupList.find(g => g.id === params.get('group'));
host.prefs.onChanged(changes => {
  if (params.has('group') && changes[PREF_RESOURCE_GROUPS]) location.reload();
});
const siteIds = resourceGroup
  ? resourceGroup.members.map(m => m.target)
  : params.get('ids')?.split(',') ?? null;
const isMerged = !!siteIds;
// Interval log is authoritative; loadMergedTrackingData serves interval days and
// falls back to frozen legacy buckets for pre-interval days.
const fetchData = loadMergedTrackingData;
const DASH = '../dashboard/dashboard.html';
let effectiveSiteIds = isMerged ? siteIds : [siteId];
let availableSiteIds = [...effectiveSiteIds];
const selectedResources = new Set();
let breakdownRender = 0;
let isAggregatedEtld1 = false;
const resourcePicker = createCheckboxDropdown({ id: 'resource-picker', buttonId: 'resource-select', labelId: 'resource-filter-label', menuId: 'resource-menu', label: t('site_allAppsWebsites'), ariaLabel: t('site_appsWebsites'), wide: true });
mountHeaderFilters(createRangeDropdown(), createDevicePicker(), resourcePicker);
mountTableControls(document.querySelector('#subpages-footer'), document.querySelector('#subpages-heading'));
const chartsGrid = document.querySelector('#charts-grid');
chartsGrid.insertAdjacentHTML('afterbegin', timeChartHtml());
chartsGrid.insertAdjacentHTML('beforeend', visitsChartHtml());
chartsGrid.insertAdjacentHTML('beforeend', hourlyChartHtml());
const limitBtn = document.querySelector('#limit-btn');
const deleteSiteBtn = document.querySelector('#delete-site-btn');
if (resourceGroup) {
  deleteSiteBtn.style.display = 'none';
  limitBtn.textContent = t('groups_limit');
  navButton(limitBtn, `../rules/rules.html?group=${encodeURIComponent(resourceGroup.id)}`);
  const manage = document.querySelector('#manage-group-link');
  manage.style.display = '';
  navButton(manage, `../groups/groups.html?id=${encodeURIComponent(resourceGroup.id)}`);
} else {
  // A merged entry sends every id, comma-separated; no host or app id holds a comma.
  const ids = encodeURIComponent((siteIds ?? [siteId]).join(','));
  navButton(limitBtn, `../rules/rules.html?target=${ids}`);
  navButton(deleteSiteBtn, `../storage-management/storage-management.html?site=${ids}`);
}
const rangeSelect = document.querySelector('#range-select');
const timeChart = document.querySelector('#time-chart');
const timeTooltip = document.querySelector('#time-tooltip');
const timeLegend = document.querySelector('#time-legend');
const visitsChart = document.querySelector('#visits-chart');
const visitsTooltip = document.querySelector('#visits-tooltip');
const timeNoData = document.querySelector('#time-no-data');
const visitsNoData = document.querySelector('#visits-no-data');
const peakTooltip = document.querySelector('#peak-tooltip');

const statsList = document.querySelector('#stats-list');

const labels = statLabels();

const topStats = [
  { label: labels.today, id: 'stat-today' },
  { label: labels.dailyAvg, id: 'stat-daily-avg' },
  { label: labels.peakDay, id: 'stat-peak' },
];

const bottomStats = [
  { label: labels.totalTime, id: 'stat-total-time' },
  { label: labels.visits, id: 'stat-visits' },
  { label: labels.avgSession, id: 'stat-avg-session' },
];

topStats.forEach((stat, i) => {
  const item = document.createElement('div');
  item.className = 'stat-item';
  if (i === 2) {
    item.id = 'stat-peak-item';
    item.innerHTML = `<span class="stat-label">${stat.label}</span><span class="stat-value-row"><span class="stat-value" id="${stat.id}"></span><span id="stat-peak-info" class="stat-info" style="display:none" title="">ⓘ</span></span>`;
  } else {
    item.innerHTML = `<span class="stat-label">${stat.label}</span><span class="stat-value" id="${stat.id}"></span>`;
  }
  statsList.appendChild(item);
});

const divider = document.createElement('hr');
divider.id = 'stats-divider';
statsList.appendChild(divider);

bottomStats.forEach(stat => {
  const item = document.createElement('div');
  item.className = 'stat-item';
  item.innerHTML = `<span class="stat-label">${stat.label}</span><span class="stat-value" id="${stat.id}"></span>`;
  statsList.appendChild(item);
});

const peakItem = document.querySelector('#stat-peak-item');
const peakInfo = document.querySelector('#stat-peak-info');

attachInfoTooltip(peakItem, peakTooltip, () => peakInfo.dataset.date);

function entrySum(obj) {
  const zero = { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 };
  if (!obj) return zero;
  return effectiveSiteIds.reduce((acc, id) => {
    const e = obj[id];
    if (!e) return acc;
    return {
      activeMs: acc.activeMs + (e.activeMs ?? 0),
      audioMs: acc.audioMs + (e.audioMs ?? 0),
      overlapMs: acc.overlapMs + (e.overlapMs ?? 0),
      visits: acc.visits + (e.visits ?? 0),
    };
  }, { ...zero });
}

const setHeaderIds = siteHeaderIds();

function applyHeader() {
  if (!siteId && !siteIds) return;
  const primary = siteId ?? siteIds[0];
  const label = resourceGroup ? groupLabel(resourceGroup) : formatHostnameLabel(primary);
  document.querySelector('#site-label').textContent = label;
  const ids = isMerged ? effectiveSiteIds : isAggregatedEtld1 ? effectiveSiteIds : [siteId];
  setHeaderIds(ids);
  if (!ids.length) document.querySelector('#site-id').textContent = t('dashboard_noData');
  document.title = `${label} - ${BRAND_NAME}`;
  showHeaderFavicon(document.querySelector('#site-favicon'), resourceIconUrl(ids.length ? ids : ['']));
  resolveFavicons(document.querySelector('#header-center'));
}
await loadFaviconCache();
applyHeader();

let byDayCache = null;
let byHourCache = null;
let subpagesByDayCache = null;
let currentDepth = null;
let currentSort = 'time';
let subpageSearch = sessionStorage.getItem(PREF_SUBPAGE_SEARCH) ?? '';
const subpageSearchInput = document.querySelector('#subpage-search');
const subpageSearchClearBtn = document.querySelector('#subpage-search-clear');
subpageSearchInput.value = subpageSearch;
const syncSubpageSearchClear = attachInputClear(subpageSearchInput, subpageSearchClearBtn, () => {
  subpageSearch = subpageSearchInput.value;
  sessionStorage.setItem(PREF_SUBPAGE_SEARCH, subpageSearch);
  renderSubpages(rangeSelect.dataset.value);
});
syncSubpageSearchClear();

let stripParams = sessionStorage.getItem(PREF_STRIP_PARAMS) !== 'false';
const stripParamsToggle = document.querySelector('#strip-params-toggle');
stripParamsToggle.checked = stripParams;
stripParamsToggle.addEventListener('change', () => {
  stripParams = stripParamsToggle.checked;
  sessionStorage.setItem(PREF_STRIP_PARAMS, stripParams);
  renderSubpages(rangeSelect.dataset.value);
});

let hideBriefSubpages = sessionStorage.getItem(PREF_HIDE_BRIEF) !== 'false';
const hideBriefSubpagesToggle = document.querySelector('#hide-brief-subpages-toggle');
hideBriefSubpagesToggle.checked = hideBriefSubpages;
hideBriefSubpagesToggle.addEventListener('change', () => {
  hideBriefSubpages = hideBriefSubpagesToggle.checked;
  sessionStorage.setItem(PREF_HIDE_BRIEF, hideBriefSubpages);
  renderSubpages(rangeSelect.dataset.value);
});

const drillView = document.querySelector('#drill-view');
const backBtn = document.querySelector('#back-btn');
keyActivate(backBtn, [' ']);

const hourlyChart = document.querySelector('#hourly-chart');
const hourlyTooltip = document.querySelector('#hourly-tooltip');
const hourlyChartContainer = document.querySelector('#hourly-chart-container');
const hourlyNotRelevant = document.querySelector('#hourly-not-relevant');
const hourlySubheading = document.querySelector('#hourly-subheading');

timeLegend.innerHTML = chartLegendHtml();

const clockFormatStored = await host.prefs.get(PREF_CLOCK_FORMAT);
const clockFormat = clockFormatStored[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;

const hourly = createHourlyChart({
  chart: hourlyChart,
  tooltip: hourlyTooltip,
  container: hourlyChartContainer,
  subheading: hourlySubheading,
  notRelevant: hourlyNotRelevant,
  allDaysLabel: t('site_hourly_allDays'),
  getRangeValue: () => rangeSelect.dataset.value,
  loadAvgPerHour: (range) => fetchData({
    type: QUERY_AVG_PER_CLOCK_HOUR, siteIds: effectiveSiteIds, range,
  }),
  clockFormat,
});

initRangeSelect(rangeSelect, render);
const deviceSelection = initDevicePicker(document.querySelector('#device-picker'), () => {
  byDayCache = null;
  subpagesByDayCache = null;
  byHourCache = null;
  hourly.clearCache();
  return loadAndRender();
});

onRefreshed(() => {
  byDayCache = null;
  subpagesByDayCache = null;
  byHourCache = null;
  hourly.clearCache();
  loadAndRender(true);
});

window.addEventListener('storage', (e) => {
  if (e.key === 'theme') render();
});

backBtn.href = DASH;
backBtn.addEventListener('click', (e) => {
  if (!isInDrillMode()) return;
  e.preventDefault();
  location.href = DASH;
});

initDrill({
  chartsGrid,
  drillView,
  rangeSelect,
  clockFormat,
  getDayEntry: (dayKey) => entrySum(byDayCache?.[dayKey]),
  getHourEntriesForDay: async (dayKey) => {
    const hourData = await fetchData({ type: QUERY_SITES_BY_HOUR_FOR_DAY, dayKey });
    const result = {};
    for (let h = 0; h < 24; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      result[hourKey] = entrySum(hourData?.[hourKey]);
    }
    return result;
  },
  getAvgPerClockHour: (dayKeys) => fetchData({
    type: QUERY_AVG_PER_CLOCK_HOUR, siteIds: effectiveSiteIds, range: null, dayKeys,
  }),
  render,
});

const loadAndRenderPromise = loadAndRender();

window.addEventListener('pageshow', () => {
  hideBriefSubpages = sessionStorage.getItem(PREF_HIDE_BRIEF) !== 'false';
  hideBriefSubpagesToggle.checked = hideBriefSubpages;
  stripParams = sessionStorage.getItem(PREF_STRIP_PARAMS) !== 'false';
  stripParamsToggle.checked = stripParams;
  subpageSearch = sessionStorage.getItem(PREF_SUBPAGE_SEARCH) ?? '';
  subpageSearchInput.value = subpageSearch;
  syncSubpageSearchClear();
  if (subpagesByDayCache) renderSubpages(rangeSelect.dataset.value);
});

// `quiet`: a background refresh replaced the saved copy; draw again without the loading look.
async function loadAndRender(quiet = false) {
  if (!quiet) document.body.classList.add('is-loading');
  byDayCache = await fetchData({ type: QUERY_SITES_BY_DAY });
  if (resourceGroup) {
    effectiveSiteIds = [...new Set([...siteIds, ...Object.values(byDayCache ?? {}).flatMap(sites => Object.keys(sites))])].filter(id => groupForId(id, resourceGroupList).id === resourceGroup.id);
    applyHeader();
  } else effectiveSiteIds = isMerged ? siteIds : [siteId];
  subpagesByDayCache = await fetchData({ type: QUERY_SUBPAGES_BY_DAY, domains: siteDomains() });
  resolveAggregationMode();
  availableSiteIds = [...effectiveSiteIds];
  for (const id of selectedResources) if (!availableSiteIds.includes(id)) selectedResources.delete(id);
  applyResourceSelection();
  renderResourcePicker();
  if (rangeSelect.dataset.value === 'today') await loadByHour();
  render();
  document.body.classList.remove('is-loading');
}

// The domains whose paths this page can show: the merged ones, or the site with its subdomains. Every
// domain with a path also has its day totals, so the day totals name them all.
function siteDomains() {
  if (isMerged || !siteId) return effectiveSiteIds;
  const hosts = new Set([siteId]);
  for (const sites of Object.values(byDayCache ?? {}))
    for (const host of Object.keys(sites))
      if (eTLDPlus1(host) === siteId) hosts.add(host);
  return [...hosts];
}

function resolveAggregationMode() {
  if (isMerged || !siteId) return;
  const matched = new Set();
  for (const cache of [byDayCache, subpagesByDayCache])
    for (const sites of Object.values(cache ?? {}))
      for (const host of Object.keys(sites))
        if (host === siteId || eTLDPlus1(host) === siteId) matched.add(host);
  if (matched.size > 1) {
    effectiveSiteIds = [...matched];
    isAggregatedEtld1 = true;
    applyHeader();
  }
}

async function loadByHour() {
  if (byHourCache) return;
  byHourCache = await fetchData({ type: QUERY_SITES_BY_HOUR_TODAY });
}

function siteDayKeysForRange(range) {
  if (range === 'today') return [localDayKey(Date.now())];
  if (range === 'all') {
    const allDays = Object.keys(byDayCache ?? {}).sort();
    const daysWithSiteData = allDays.filter(day => {
      const entry = entrySum(byDayCache[day]);
      return entry.activeMs > 0 || entry.visits > 0;
    });
    if (daysWithSiteData.length === 0) return [];
    const [y1, m1, d1] = daysWithSiteData[0].split('-').map(Number);
    const today = new Date();
    const [y2, m2, d2] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
    const out = [];
    for (let date = new Date(y1, m1 - 1, d1); date <= new Date(y2, m2 - 1, d2); date.setDate(date.getDate() + 1)) {
      out.push(localDayKey(date.getTime()));
    }
    return out;
  }
  return dayKeysForRange(range, byDayCache);
}

function render() {
  if (isInDrillMode()) return;
  const range = rangeSelect.dataset.value;
  const dayKeys = siteDayKeysForRange(range);
  renderBreakdowns(dayKeys);
  if (range === 'today' && !byHourCache) { loadByHour().then(render); return; }
  const data = buildOverviewData({
    range, dayKeys, clockFormat,
    getDayEntry: (dayKey) => entrySum(byDayCache?.[dayKey]),
    getHourEntry: (hourKey) => entrySum(byHourCache?.[hourKey]),
  });
  drawOverviewCharts({
    data, range,
    timeChart, timeTooltip, timeLegend, timeNoData,
    visitsChart, visitsTooltip, visitsNoData,
    onEnterDrill: (r, metric) => enterDrill(r, null, metric),
  });
  hourly.render(range);
  renderStats(data, range);
  renderSubpages(range);
}

function resourceName(id) {
  const member = resourceGroupList.flatMap(group => group.members).find(member =>
    member.target === id && (member.source === 'app' || member.source === 'desktop'));
  return appLabel(id) || member?.label || id;
}

function applyResourceSelection() {
  effectiveSiteIds = selectedResources.size ? availableSiteIds.filter(id => selectedResources.has(id)) : [...availableSiteIds];
  hourly.clearCache();
}

function renderResourcePicker() {
  resourcePicker.style.display = availableSiteIds.length > 1 ? '' : 'none';
  const menu = resourcePicker.querySelector('#resource-menu');
  menu.replaceChildren();
  const options = [{ id: null, label: t('site_allAppsWebsites') }, ...availableSiteIds.map(id => ({ id, label: resourceName(id) }))];
  renderCheckboxOptions(menu, options,
    id => selectedResources.size === 0 || (id !== null && selectedResources.has(id)),
    (id, checked) => {
      if (id === null) selectedResources.clear();
      else {
        if (!selectedResources.size) availableSiteIds.forEach(value => selectedResources.add(value));
        if (checked) selectedResources.add(id);
        else selectedResources.delete(id);
        if (selectedResources.size === availableSiteIds.length) selectedResources.clear();
      }
      applyResourceSelection();
      renderResourcePicker();
      if (isInDrillMode()) exitDrillCompletely();
      render();
      menu.querySelectorAll('input')[options.findIndex(option => option.id === id)]?.focus();
    });
  resourcePicker.querySelector('#resource-filter-label').textContent = !selectedResources.size ? t('site_allAppsWebsites')
    : selectedResources.size === 1 ? resourceName([...selectedResources][0]) : t('site_selectedAppsWebsites', [String(selectedResources.size)]);
}

for (const kind of ['resources', 'devices']) {
  const bar = document.querySelector(`#${kind}-breakdown`);
  const tooltip = document.querySelector(`#${kind}-tooltip`);
  const setText = e => {
    const segment = e.target.closest('.usage-segment');
    if (segment) bar.dataset.tooltip = segment.getAttribute('aria-label');
  };
  bar.addEventListener('mouseover', setText);
  bar.addEventListener('mousemove', setText);
  bar.addEventListener('click', setText);
  attachInfoTooltip(bar, tooltip, () => {
    if (!bar.dataset.tooltip) return;
    const [details, hint] = bar.dataset.tooltip.split('\n');
    const content = document.createDocumentFragment();
    const hintText = document.createElement('span');
    hintText.className = 'text-hint';
    hintText.textContent = hint;
    content.append(document.createTextNode(details), document.createElement('br'), hintText);
    return content;
  });
  bar.addEventListener('click', async e => {
    const segment = e.target.closest('.usage-segment');
    if (!segment) return;
    tooltip.style.display = 'none';
    if (kind === 'resources') {
      selectedResources.clear();
      selectedResources.add(segment.dataset.id);
      applyResourceSelection();
      renderResourcePicker();
      render();
    } else {
      const select = await deviceSelection;
      await select?.([segment.dataset.id]);
    }
  });
  bar.addEventListener('focusin', e => {
    setText(e);
    const box = e.target.getBoundingClientRect();
    bar.dispatchEvent(new MouseEvent('mouseenter', { clientX: box.left, clientY: box.top }));
  });
  bar.addEventListener('focusout', () => { tooltip.style.display = 'none'; });
  bar.addEventListener('keydown', e => { if (e.key === 'Escape') tooltip.style.display = 'none'; });
}

async function renderBreakdowns(dayKeys) {
  const request = ++breakdownRender;
  const container = document.querySelector('#usage-breakdowns');
  container.style.display = resourceGroup || isMerged || isAggregatedEtld1 ? '' : 'none';
  document.querySelector('#stats-container').classList.toggle('has-breakdowns', container.style.display !== 'none');
  if (container.style.display === 'none') return;
  const status = document.querySelector('#breakdowns-status');
  container.setAttribute('aria-busy', 'true');
  status.textContent = t('site_loadingBreakdown');
  for (const kind of ['resources', 'devices']) {
    const bar = document.querySelector(`#${kind}-breakdown`);
    bar.replaceChildren();
    delete bar.dataset.tooltip;
    document.querySelector(`#${kind}-tooltip`).style.display = 'none';
  }
  try {
    const cells = Object.fromEntries(dayKeys.map(day => [day, Object.fromEntries(effectiveSiteIds.filter(id => byDayCache?.[day]?.[id]).map(id => [id, byDayCache[day][id]]))]));
    const data = await usageBreakdown(effectiveSiteIds, dayKeys, cells);
    const deviceName = await deviceLabeler(data.devices.map(part => part.id), { refresh: false });
    if (request !== breakdownRender) return;
    status.textContent = '';
    const palette = ['--color-chart-time', '--color-chart-hourly', '--color-chart-idle', '--color-chart-audio', '--color-chart-visits'];
    for (const kind of ['resources', 'devices']) {
      const bar = document.querySelector(`#${kind}-breakdown`);
      bar.closest('.usage-breakdown').style.display = data[kind].length > 1 ? '' : 'none';
      for (const [index, part] of data[kind].entries()) {
        const label = kind === 'resources' ? resourceName(part.id) : deviceName(part.id);
        const tooltipLabel = kind === 'resources' && label !== part.id ? `${label} (${part.id})` : label;
        const segment = document.createElement('button');
        segment.className = 'usage-segment';
        segment.type = 'button';
        segment.dataset.id = part.id;
        segment.style.flexBasis = `${part.percent}%`;
        segment.style.background = index < palette.length ? `var(${palette[index]})` : `hsl(${index * 137.508 % 360} 45% 45%)`;
        if (part.percent >= 7) {
          const text = document.createElement('span');
          text.className = 'usage-segment-label';
          text.textContent = label;
          segment.append(text);
        }
        segment.setAttribute('aria-label', `${tooltipLabel}: ${formatMs(part.ms)} · ${new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 }).format(part.percent)}%\n${t(kind === 'resources' ? 'site_clickToFilterResource' : 'site_clickToFilterDevice')}`);
        segment.setAttribute('aria-describedby', `${kind}-tooltip`);
        bar.append(segment);
      }
    }
    if (!data.resources.length) status.textContent = t('dashboard_noData');
    const showBreakdowns = data.resources.length > 1 || data.devices.length > 1 || !data.resources.length;
    container.style.display = showBreakdowns ? '' : 'none';
    document.querySelector('#stats-container').classList.toggle('has-breakdowns', showBreakdowns);
  } catch {
    if (request === breakdownRender) status.textContent = t('site_breakdownError');
  } finally {
    if (request === breakdownRender) container.setAttribute('aria-busy', 'false');
  }
}


function renderStats(data, range) {
  const { totalMs, totalVisits } = renderBaseStats(data, range, byDayCache);

  const todayKey = localDayKey(Date.now());
  const todayEntry = entrySum(byDayCache?.[todayKey]);
  const todayMs = todayEntry.activeMs + todayEntry.audioMs - (todayEntry.overlapMs ?? 0);
  document.querySelector('#stat-today').textContent = formatMs(todayMs) || '0m';

  let peakMs = 0, peakLabel = '';
  if (range !== 'today' && byDayCache) {
    const cutoff = range === 'all' ? null : (() => {
      const d = new Date();
      d.setDate(d.getDate() - (parseInt(range) - 1));
      return localDayKey(d.getTime());
    })();
    for (const [day, sites] of Object.entries(byDayCache)) {
      if (cutoff && day < cutoff) continue;
      const e = entrySum(sites);
      const ms = e.activeMs + e.audioMs - (e.overlapMs ?? 0);
      if (ms > peakMs) { peakMs = ms; peakLabel = day; }
    }
  }
  const peakEl = document.querySelector('#stat-peak');
  peakEl.textContent = peakMs > 0 ? formatMs(peakMs) : '—';
  peakEl.classList.remove('has-tooltip');
  peakInfo.style.display = peakMs > 0 ? 'inline' : 'none';
  peakInfo.dataset.date = peakMs > 0 ? peakLabel : '';
  peakInfo.title = '';

  document.querySelector('#stat-avg-session').textContent = totalVisits > 0 ? formatMs(totalMs / totalVisits) : '—';

  document.querySelector('#overview-subheading').textContent = subheadingText(range);
}

function aggregateSubpages(range) {
  const out = {};
  if (!subpagesByDayCache) return out;
  const dayKeys = dayKeysForRange(range, subpagesByDayCache);
  for (const dayKey of dayKeys) {
    const dayData = subpagesByDayCache[dayKey];
    if (!dayData) continue;
    for (const sid of effectiveSiteIds) {
      const sitePaths = dayData[sid];
      if (!sitePaths) continue;
      for (const [path, d] of Object.entries(sitePaths)) {
        const key = stripParams ? stripQuery(path) : path;
        out[key] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 };
        out[key].activeMs += d.activeMs || 0;
        out[key].audioMs += d.audioMs || 0;
        out[key].overlapMs += d.overlapMs || 0;
        out[key].visits += d.visits || 0;
      }
    }
  }
  return out;
}

function buildDepthToggle(paths) {
  const actualMax = Math.max(...paths.map(p => p.split('/').filter(Boolean).length));
  const shownMax = Math.min(5, actualMax - 1);
  const toggle = document.querySelector('#depth-toggle');
  toggle.setAttribute('role', 'radiogroup');
  toggle.innerHTML = '';
  for (let d = 1; d <= shownMax; d++) {
    const btn = document.createElement('button');
    btn.className = 'seg-btn depth-num-btn';
    btn.setAttribute('role', 'radio');
    btn.textContent = String(d);
    btn.onclick = () => setDepth(d, btn);
    const isActive = currentDepth === d;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    toggle.appendChild(btn);
  }
  const full = document.createElement('button');
  full.className = 'seg-btn';
  full.setAttribute('role', 'radio');
  full.textContent = t('site_depthFull');
  full.onclick = () => setDepth(null, full);
  const fullActive = currentDepth === null;
  full.classList.toggle('active', fullActive);
  full.setAttribute('aria-checked', fullActive ? 'true' : 'false');
  toggle.appendChild(full);
}

function setDepth(depth, btn) {
  currentDepth = depth;
  document.querySelectorAll('#depth-toggle .seg-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
  btn.classList.add('active');
  btn.setAttribute('aria-checked', 'true');
  renderSubpages(rangeSelect.dataset.value);
}

const sortTimeBtn = document.querySelector('#sort-time-btn');
const sortVisitsBtn = document.querySelector('#sort-visits-btn');
sortTimeBtn.onclick = () => setSort('time');
sortVisitsBtn.onclick = () => setSort('visits');

function setSort(sort) {
  currentSort = sort;
  sortTimeBtn.classList.toggle('active', sort === 'time');
  sortTimeBtn.setAttribute('aria-checked', sort === 'time' ? 'true' : 'false');
  sortVisitsBtn.classList.toggle('active', sort === 'visits');
  sortVisitsBtn.setAttribute('aria-checked', sort === 'visits' ? 'true' : 'false');
  renderSubpages(rangeSelect.dataset.value);
}

function renderSubpages(range) {
  const raw = aggregateSubpages(range);
  const paths = Object.keys(raw);
  if (paths.length === 0) {
    chartsGrid.classList.remove('has-subpages');
    return;
  }
  chartsGrid.classList.add('has-subpages');

  const getTotalMs = (r) => r.activeMs + r.audioMs - (r.overlapMs ?? 0);
  if (hideBriefSubpages && !mergePaths(raw, currentDepth).some(r => getTotalMs(r) >= 60_000)) {
    const actualMax = Math.max(...paths.map(p => p.split('/').filter(Boolean).length));
    const shownMax = Math.min(5, actualMax - 1);
    for (let d = shownMax; d >= 1; d--) {
      if (mergePaths(raw, d).some(r => getTotalMs(r) >= 60_000)) { currentDepth = d; break; }
    }
  }

  buildDepthToggle(paths);

  let merged = mergePaths(raw, currentDepth);
  merged.sort((a, b) => currentSort === 'time' ? getTotalMs(b) - getTotalMs(a) : b.visits - a.visits);
  if (hideBriefSubpages) merged = merged.filter(r => getTotalMs(r) >= 60_000);
  if (subpageSearch) {
    const q = subpageSearch.toLowerCase();
    merged = merged.filter(r => r.path.toLowerCase().includes(q) || displayPath(r.path).toLowerCase().includes(q));
  }

  const pathSiteMs = {};
  if (effectiveSiteIds.length > 1) {
    for (const dayKey of dayKeysForRange(range, subpagesByDayCache)) {
      const dayData = subpagesByDayCache?.[dayKey];
      if (!dayData) continue;
      for (const sid of effectiveSiteIds) {
        for (const [p, d] of Object.entries(dayData[sid] ?? {})) {
          const key = stripParams ? stripQuery(p) : p;
          pathSiteMs[key] ??= {};
          pathSiteMs[key][sid] = (pathSiteMs[key][sid] ?? 0) + (d.activeMs || 0);
        }
      }
    }
  }

  function domainForPath(path) {
    if (effectiveSiteIds.length === 1) return effectiveSiteIds[0];
    const siteMs = pathSiteMs[path];
    if (!siteMs) return effectiveSiteIds[0];
    return effectiveSiteIds.reduce((best, sid) => (siteMs[sid] ?? 0) > (siteMs[best] ?? 0) ? sid : best);
  }

  const list = document.querySelector('#subpages-list');
  list.innerHTML = '';
  for (const row of merged) {
    const li = document.createElement('li');
    const decoded = displayPath(row.path);
    const display = escapeHtml(decoded);
    const star = row.truncated ? '<span class="subpage-truncated">*</span>' : '';
    const num = currentSort === 'time'
      ? formatMs(row.activeMs + row.audioMs - (row.overlapMs ?? 0))
      : (row.visits === 1 ? t('visits_one', [row.visits]) : t('visits_other', [row.visits]));
    li.title = decoded + (row.truncated ? '*' : '');
    const drill = document.createElement('div');
    drill.className = 'subpage-drill';
    drill.tabIndex = 0;
    drill.innerHTML = `<span class="subpage-path">${display}${star}</span><span class="subpage-num">${num}</span>`;
    const params = new URLSearchParams();
    params.set('ids', effectiveSiteIds.join(','));
    params.set('path', row.path);
    if (row.truncated) params.set('prefix', '1');
    if (stripParams) params.set('stripParams', '1');
    const pathHref = `../path/path.html?${params}`;
    navButton(drill, pathHref);
    keyActivate(drill);
    let openPath = row.path;
    if (row.truncated) {
      const prefix = row.path + '/';
      let bestMs = -1;
      for (const [p, d] of Object.entries(raw)) {
        if (p.startsWith(prefix) && (d.activeMs || 0) > bestMs) {
          bestMs = d.activeMs || 0;
          openPath = p;
        }
      }
    }
    const openBtn = document.createElement('a');
    openBtn.className = 'subpage-open-btn';
    openBtn.href = `https://${domainForPath(openPath)}${openPath}`;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = t('site_openLink');
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openSiteLink(domainForPath(openPath), openPath);
    });
    li.appendChild(drill);
    li.appendChild(openBtn);
    list.appendChild(li);
  }
  const noMatch = merged.length === 0;
  list.style.display = noMatch ? 'none' : '';
  document.querySelector('#subpages-controls').style.display = noMatch ? 'none' : '';
  document.querySelector('#subpages-empty').style.display = noMatch ? 'flex' : 'none';
  document.querySelector('#subpages-count').textContent = merged.length === 1 ? t('site_pages_one', [merged.length]) : t('site_pages_other', [merged.length]);
}

function ensureDrillOpen() {
  if (isInDrillMode()) return;
  const days = Object.keys(byDayCache ?? {}).sort();
  const pick = days[days.length - 1];
  if (pick) enterDrill(pick, null, 'time');
}

function siteTourSteps() { return [
  {
    selector: '#site-title',
    title: t('tour_site_details_title'),
    body: t('tour_site_details_body', [BRAND_NAME]),
  },
  {
    selector: '#charts-grid',
    title: t('tour_site_charts_title'),
    body: t('tour_site_charts_body'),
  },
  {
    selector: '#time-chart-container',
    title: t('tour_site_drillDay_title'),
    body: t('tour_site_drillDay_body'),
    advanceOn: 'click',
  },
  {
    selector: '#drill-controls',
    title: t('tour_site_dailyDetail_title'),
    body: t('tour_site_dailyDetail_body'),
    drillStep: true,
    onEnter: ensureDrillOpen,
    onExit: ({ direction }) => {
      if (direction === 'backward' && isInDrillMode()) exitDrillCompletely();
    },
  },
  {
    selector: '#nav-close',
    title: t('tour_site_backOverview_title'),
    body: t('tour_site_backOverview_body'),
    advanceOn: 'click',
    drillStep: true,
    onEnter: ensureDrillOpen,
  },
  {
    selector: '#subpages-container',
    focusSelector: '#subpages-list .subpage-drill',
    title: t('tour_site_pageActivity_title'),
    body: t('tour_site_pageActivity_body'),
    handoff: { nextSurface: 'path', mode: 'inPage' },
  },
]; }

loadAndRenderPromise.then(() => autoStartIfMatches('site', siteTourSteps(), {
  onClose: ({ skipped }) => {
    if (skipped) {
      clearMockModeCache();
      byDayCache = null;
      subpagesByDayCache = null;
      byHourCache = null;
      loadAndRender();
    }
  },
}));
