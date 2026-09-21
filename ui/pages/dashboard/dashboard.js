import { formatMs, localDayKey, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { drawBarChart, formatWithSmallSub, escapeHtml, navButton, faviconUrl, loadFaviconCache, attachInputClear, keyActivate } from '../../shared/utils.js';
import { eTLDPlus1 } from '../../background/siteResolution.js';
import { formatHostnameLabel } from '../../shared/labels.js';
import { seedTestData } from '../../data/seedTestData.js';
import { count as intervalRowCount } from '../../shared/rowStore.js';
import { createRangeDropdown, initRangeSelect } from '../../shared/rangeSelect.js';
import { createDevicePicker, initDevicePicker } from '../../shared/devicePicker.js';
import { mountHeaderFilters } from '../../shared/phoneHeader.js';
import { createHourlyChart } from '../../shared/hourlyChart.js';
import { subheadingText } from '../../shared/overview.js';
import { periodStats, formatPeriodStats } from '../../shared/periodStats.js';
import { runTour, readTourState, writeTourState, clearTourProgress, onwardStep } from '../../shared/tour.js';
import { clearMockModeCache } from '../../shared/tourMockData.js';
import { loadMergedTrackingData } from '../../data/mergeDataSources.js';
import { QUERY_SITES_BY_DAY, QUERY_AVG_PER_CLOCK_HOUR } from '../../shared/queryTypes.js';
import { PREF_CLOCK_FORMAT, PREF_HIDE_BRIEF } from '../../shared/prefKeys.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t, resolveLanguage } from '../../shared/i18n.js';
import { applyChartColorOverrides } from '../../shared/chartColors.js';
import { getUnseenChangelogEntries, markChangelogSeen } from '../../shared/changelog.js';
import { CHANGELOG_CATEGORIES } from '../../shared/changelogEntries.js';
import { host } from '../../shared/host.js';
const PREF_MERGE_MODE = 'mergeMode';
const PREF_GROUP_MODE = 'groupMode';
const PREF_SEARCH = 'siteSearch';

await initI18n();
applyI18n();
await applyChartColorOverrides();
document.title = `${t('popup_dashboardBtn')} - ${BRAND_NAME}`;

mountHeaderFilters(createRangeDropdown(), createDevicePicker());
navButton(document.querySelector('#timeline-link'), '../browsing-timeline/browsing-timeline.html');
navButton(document.querySelector('#rules-btn'), '../rules/rules.html');
navButton(document.querySelector('#settings-btn'), '../settings/settings.html');
const rangeSelect = document.querySelector('#range-select');
const dashboardTable = document.querySelector('#dashboard-table');
const tbody = document.querySelector('#dashboard-body');
const emptyMsg = document.querySelector('#empty-msg');
const entriesCount = document.querySelector('#entries-count');
const topChart = document.querySelector('#top-chart');
const topTooltip = document.querySelector('#top-tooltip');
const topChartContainer = document.querySelector('#top-chart-container');
const topNotRelevant = document.querySelector('#top-not-relevant');
const hourlyChart = document.querySelector('#hourly-chart');
const hourlyTooltip = document.querySelector('#hourly-tooltip');
const hourlyChartContainer = document.querySelector('#hourly-chart-container');
const hourlyNotRelevant = document.querySelector('#hourly-not-relevant');
const hourlySubheading = document.querySelector('#hourly-subheading');
const topSubheading = document.querySelector('#top-subheading');
const groupToggle = document.querySelector('#group-toggle');
const mergeToggle = document.querySelector('#merge-toggle');
const hideBriefToggle = document.querySelector('#hide-brief-toggle');
const siteSearchInput = document.querySelector('#site-search');
const siteSearchClearBtn = document.querySelector('#site-search-clear');
const changelogSubheader = document.querySelector('#changelog-subheader');
const changelogVersionBtn = document.querySelector('#changelog-version-btn');
const changelogDismissBtn = document.querySelector('#changelog-dismiss-btn');

await loadFaviconCache();
const clockFormatStored = await host.prefs.get(PREF_CLOCK_FORMAT);
const clockFormat = clockFormatStored[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;

const hourly = createHourlyChart({
  chart: hourlyChart,
  tooltip: hourlyTooltip,
  container: hourlyChartContainer,
  subheading: hourlySubheading,
  notRelevant: hourlyNotRelevant,
  allDaysLabel: t('dashboard_hourly_allDays'),
  getRangeValue: () => rangeSelect.dataset.value,
  loadAvgPerHour: (range) => loadMergedTrackingData({
    type: QUERY_AVG_PER_CLOCK_HOUR, siteIds: null, range,
  }),
  clockFormat,
});

let sortCol = 'time';
let sortDir = 'desc';
let currentRows = [];
let groupMode = sessionStorage.getItem(PREF_GROUP_MODE) === 'true';
groupToggle.checked = groupMode;
let mergeMode = sessionStorage.getItem(PREF_MERGE_MODE) !== 'false';
mergeToggle.checked = mergeMode;
let hideBrief = sessionStorage.getItem(PREF_HIDE_BRIEF) !== 'false';
hideBriefToggle.checked = hideBrief;
let searchQuery = sessionStorage.getItem(PREF_SEARCH) ?? '';
siteSearchInput.value = searchQuery;

const thName = document.querySelector('#th-name');
const thTime = document.querySelector('#th-time');
const thAudio = document.querySelector('#th-audio');
const thVisits = document.querySelector('#th-visits');

const TH_LABEL_KEYS = { name: 'dashboard_col_name', time: 'dashboard_col_time', audio: 'dashboard_col_audio', visits: 'dashboard_col_visits' };

const rootStyle = getComputedStyle(document.documentElement);

function updateHeaders() {
  for (const [col, th] of [['name', thName], ['time', thTime], ['audio', thAudio], ['visits', thVisits]]) {
    const isSorted = sortCol === col;
    const arrow = isSorted ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
    th.textContent = t(TH_LABEL_KEYS[col]) + arrow;
    th.classList.toggle('sorted', isSorted);
    th.setAttribute('aria-sort', isSorted ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none');
  }
}

[['name', thName], ['time', thTime], ['audio', thAudio], ['visits', thVisits]].forEach(([col, th]) => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    if (sortCol === col) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortCol = col;
      sortDir = col === 'name' ? 'asc' : 'desc';
    }
    renderTopChart();
    renderTable(filteredRows());
  });
  keyActivate(th);
});

function groupByEtld1(rows) {
  const groups = {};
  for (const row of rows) {
    const key = row.etld1;
    if (!groups[key]) groups[key] = {
      siteLabel: formatHostnameLabel(key),
      siteIds: [], hostnames: new Set(), etld1s: new Set([key]),
      activeMs: 0, audioMs: 0, visits: 0,
    };
    groups[key].siteIds.push(row.siteId);
    groups[key].hostnames.add(row.siteId);
    groups[key].activeMs += row.activeMs;
    groups[key].audioMs += row.audioMs;
    groups[key].visits += row.visits;
  }
  return Object.values(groups);
}

function mergeByLabel(rows) {
  const groups = {};
  for (const row of rows) {
    const key = row.siteLabel;
    if (!groups[key]) groups[key] = {
      siteLabel: key,
      siteIds: [], hostnames: new Set(), etld1s: new Set(),
      activeMs: 0, audioMs: 0, visits: 0,
    };
    groups[key].siteIds.push(...(row.siteIds ?? [row.siteId]));
    for (const h of (row.hostnames ?? [row.siteId])) groups[key].hostnames.add(h);
    for (const e of (row.etld1s ?? [row.etld1])) groups[key].etld1s.add(e);
    groups[key].activeMs += row.activeMs;
    groups[key].audioMs += row.audioMs;
    groups[key].visits += row.visits;
  }
  return Object.values(groups);
}

function getDisplayRows() {
  let rows = currentRows;
  if (groupMode) rows = groupByEtld1(rows);
  if (mergeMode) rows = mergeByLabel(rows);
  return hideBrief ? rows.filter(r => r.activeMs >= 60_000 || r.audioMs >= 60_000) : rows;
}

function sortedRows() {
  return [...getDisplayRows()].sort((a, b) => {
    let cmp;
    if (sortCol === 'name') cmp = a.siteLabel.localeCompare(b.siteLabel);
    else if (sortCol === 'time') cmp = a.activeMs - b.activeMs;
    else if (sortCol === 'audio') cmp = a.audioMs - b.audioMs;
    else cmp = a.visits - b.visits;
    return sortDir === 'desc' ? -cmp : cmp;
  });
}

function filteredRows() {
  const q = searchQuery.toLowerCase().trim();
  if (!q) return sortedRows();
  return sortedRows().filter(row => {
    if (row.siteLabel.toLowerCase().includes(q)) return true;
    if (row.siteId && row.siteId.toLowerCase().includes(q)) return true;
    if (row.hostnames) {
      for (const h of row.hostnames) {
        if (h.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });
}

function renderTable(rows) {
  if (rows.length === 0) {
    tbody.innerHTML = '';
    entriesCount.textContent = '';
    emptyMsg.textContent = searchQuery.trim() ? t('dashboard_noMatch') : t('dashboard_noData');
    dashboardTable.style.display = 'none';
    emptyMsg.style.display = 'flex';
    return;
  }
  dashboardTable.style.display = '';
  emptyMsg.style.display = 'none';
  tbody.innerHTML = rows.map(row => {
    const { siteLabel, activeMs, audioMs, visits } = row;
    const etld1Count = row.etld1s?.size ?? 0;
    const hostCount = row.hostnames?.size ?? 0;
    const faviconHost = row.etld1s ? [...row.hostnames][0] : row.siteId;
    let href, subtitle;
    if (!row.etld1s) {
      href = `../site/site.html?id=${encodeURIComponent(row.siteId)}`;
      subtitle = row.siteId;
    } else if (etld1Count === 1 && hostCount === 1) {
      const only = [...row.hostnames][0];
      href = `../site/site.html?id=${encodeURIComponent(only)}`;
      subtitle = only;
    } else if (etld1Count === 1) {
      const onlyEtld1 = [...row.etld1s][0];
      href = `../site/site.html?id=${encodeURIComponent(onlyEtld1)}`;
      subtitle = t('dashboard_subdomainsCount', [hostCount]);
    } else if (hostCount === etld1Count) {
      href = `../site/site.html?ids=${encodeURIComponent([...row.hostnames].join(','))}`;
      subtitle = t('dashboard_sitesCount', [etld1Count]);
    } else {
      href = `../site/site.html?ids=${encodeURIComponent([...row.hostnames].join(','))}`;
      subtitle = `${t('dashboard_sitesCount', [etld1Count])} · ${t('dashboard_subdomainsCount', [hostCount])}`;
    }
    return `<tr class="clickable" tabindex="0" data-href="${href}">
      <td><div class="site-cell-content"><img class="site-favicon" src="${faviconUrl(faviconHost)}" alt=""><div class="site-text"><span class="site-label">${escapeHtml(siteLabel)}</span><span class="site-id text-meta">${escapeHtml(subtitle)}</span></div></div></td>
      <td><span class="stat-value">${formatWithSmallSub(formatMs(activeMs))}</span></td>
      <td><span class="stat-value">${formatWithSmallSub(formatMs(audioMs))}</span></td>
      <td><span class="stat-value">${visits}</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.site-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
  tbody.querySelectorAll('tr.clickable').forEach(row => {
    navButton(row, row.dataset.href);
    keyActivate(row);
  });
  entriesCount.textContent = rows.length === 1 ? t('dashboard_entry_one', [rows.length]) : t('dashboard_entry_other', [rows.length]);
  updateHeaders();
}

let byDayCache = null;

initRangeSelect(rangeSelect, render);
initDevicePicker(document.querySelector('#device-picker'), () => {
  byDayCache = null;
  hourly.clearCache();
  loadAndRender();
});

groupToggle.addEventListener('change', () => {
  groupMode = groupToggle.checked;
  sessionStorage.setItem(PREF_GROUP_MODE, groupMode);
  render();
});

mergeToggle.addEventListener('change', () => {
  mergeMode = mergeToggle.checked;
  sessionStorage.setItem(PREF_MERGE_MODE, mergeMode);
  render();
});

hideBriefToggle.addEventListener('change', () => {
  hideBrief = hideBriefToggle.checked;
  sessionStorage.setItem(PREF_HIDE_BRIEF, hideBrief);
  render();
});

function applySearch() {
  searchQuery = siteSearchInput.value;
  sessionStorage.setItem(PREF_SEARCH, searchQuery);
  renderTable(filteredRows());
}
const syncSearchClear = attachInputClear(siteSearchInput, siteSearchClearBtn, applySearch);
syncSearchClear();

window.addEventListener('storage', (e) => {
  if (e.key === 'theme') render();
});

(async () => {
  if (new URLSearchParams(location.search).get('tour') === '1') {
    await maybeEnableMockMode();
  } else {
    // Mock data belongs to an in-progress tour only. Clear a leftover flag so a
    // real user isn't stuck on fixtures after abandoning the tour mid-way.
    const state = await readTourState();
    if (state.useMockData && !state.inProgress) {
      await writeTourState({ useMockData: false });
      clearMockModeCache();
    }
  }
  await loadAndRender();
})();

window.addEventListener('pageshow', () => {
  hideBrief = sessionStorage.getItem(PREF_HIDE_BRIEF) !== 'false';
  hideBriefToggle.checked = hideBrief;
  mergeMode = sessionStorage.getItem(PREF_MERGE_MODE) !== 'false';
  mergeToggle.checked = mergeMode;
  groupMode = sessionStorage.getItem(PREF_GROUP_MODE) === 'true';
  groupToggle.checked = groupMode;
  searchQuery = sessionStorage.getItem(PREF_SEARCH) ?? '';
  siteSearchInput.value = searchQuery;
  syncSearchClear();
  if (currentRows.length) render();
});

async function loadAndRender() {
  if (new URL(location.href).searchParams.has('seed')) {
    history.replaceState(null, '', location.pathname);
    await seedTestData();
  }
  byDayCache = await loadMergedTrackingData({ type: QUERY_SITES_BY_DAY });
  render();
}

document.querySelector('#seed-btn')?.addEventListener('click', async () => {
  await seedTestData();
  byDayCache = null;
  hourly.clearCache();
  await loadAndRender();
});


function dayKeys(range) {
  const keys = [];
  const now = new Date();
  if (range === 'all') return null;

  const days = range === 'today' ? 1 : parseInt(range);
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(localDayKey(d.getTime()));
  }
  return keys;
}

const TOP_SUBHEADING_KEYS = { time: 'dashboard_topSub_time', audio: 'dashboard_topSub_audio', visits: 'dashboard_topSub_visits' };
const TOP_COLOR = { 
  time: rootStyle.getPropertyValue('--color-chart-time'), 
  audio: rootStyle.getPropertyValue('--color-chart-audio'), 
  visits: rootStyle.getPropertyValue('--color-chart-visits') };

function renderTopChart() {
  const col = sortCol === 'name' ? 'time' : sortCol;
  // "(active time)" and "(last 7 days)" read as one note: "(active time, last 7 days)".
  const bare = (text) => text.replace(/^\(|\)$/g, '');
  topSubheading.textContent = `(${bare(t(TOP_SUBHEADING_KEYS[col]))}, ${bare(subheadingText(rangeSelect.dataset.value))})`;
  const getVal = col === 'audio' ? r => r.audioMs : col === 'visits' ? r => r.visits : r => r.activeMs;
  const fmt = col === 'visits' ? v => String(Math.round(v)) : formatMs;

  const top = [...getDisplayRows()].sort((a, b) => getVal(b) - getVal(a)).slice(0, 5).map(row => {
    const ids = row.siteIds ?? [row.siteId];
    const href = ids.length === 1
      ? `../site/site.html?id=${encodeURIComponent(ids[0])}`
      : `../site/site.html?ids=${encodeURIComponent(ids.join(','))}`;
    return { label: row.siteLabel, range: ids.join(', '), val: getVal(row), href, faviconDataUrl: faviconUrl(ids[0]) };
  });
  const hrefByRange = new Map(top.map(d => [d.range, d.href]));
  drawBarChart({
    svgEl: topChart,
    tooltipEl: topTooltip,
    data: top,
    maxVal: Math.max(...top.map(d => d.val), 1),
    getValue: d => d.val,
    formatVal: fmt,
    color: TOP_COLOR[col],
    onBarClick: r => { location.href = hrefByRange.get(r); },
  });
}

// The overview card: the popup's six stats, for the period and devices picked in the header.
// It loads hourly data, so it redraws only when the period or the loaded data changed.
let overviewRange = null;
let overviewData = null;
async function renderOverview(range) {
  if (overviewRange === range && overviewData === byDayCache) return;
  overviewRange = range;
  overviewData = byDayCache;
  document.querySelector('#overview-subheading').textContent = subheadingText(range);
  document.querySelector('#overview-vs-label').textContent = t(range === 'today' ? 'popup_statsVsAvg' : 'overview_vsPrev');
  document.querySelector('#overview-first-browse-label').textContent = t(range === 'today' ? 'popup_statsFirstBrowse' : 'overview_avgFirstBrowse');
  const stats = await periodStats(range, byDayCache ?? {});
  if (overviewRange !== range) return;
  const text = formatPeriodStats(stats, clockFormat);
  document.querySelector('#overview-sites').textContent = text.sites;
  document.querySelector('#overview-vs').textContent = text.vs;
  document.querySelector('#overview-peak-hour').textContent = text.peakHour;
  document.querySelector('#overview-first-browse').textContent = text.firstBrowse;
  document.querySelector('#overview-visits').textContent = text.visits;
  document.querySelector('#overview-idle').textContent = text.idle;
}

function render() {
  const range = rangeSelect.dataset.value;
  const byDay = byDayCache ?? {};
  renderOverview(range);

  const allowed = dayKeys(range);
  const totals = {};

  for (const [day, sites] of Object.entries(byDay)) {
    if (allowed && !allowed.includes(day)) continue;
    for (const [siteId, entry] of Object.entries(sites)) {
      totals[siteId] ??= { activeMs: 0, audioMs: 0, visits: 0 };
      totals[siteId].activeMs += entry.activeMs;
      totals[siteId].audioMs += entry.audioMs ?? 0;
      totals[siteId].visits += entry.visits;
    }
  }

  currentRows = Object.entries(totals).map(([siteId, { activeMs, audioMs, visits }]) => ({
    siteId,
    siteLabel: formatHostnameLabel(siteId),
    etld1: eTLDPlus1(siteId),
    activeMs, audioMs, visits,
  }));

  if (currentRows.length === 0) {
    tbody.innerHTML = '';
    entriesCount.textContent = '';
    dashboardTable.style.display = 'none';
    emptyMsg.textContent = t('dashboard_noData');
    emptyMsg.style.display = 'flex';
    topChartContainer.style.display = 'block';
    topChart.style.display = 'none';
    topSubheading.textContent = '';
    topNotRelevant.textContent = t('dashboard_noData');
    topNotRelevant.style.display = 'block';
    hourly.render(range);
    return;
  }

  emptyMsg.style.display = 'none';
  topChartContainer.style.display = 'block';
  topChart.style.display = 'block';
  topNotRelevant.style.display = 'none';
  hourly.render(range);

  renderTopChart();
  renderTable(filteredRows());
}

const tourBtn = document.querySelector('#tour-btn');

function dashboardTourSteps() { return [
  {
    selector: '#tour-btn',
    title: t('tour_dash_welcome_title', [BRAND_NAME]),
    body: t('tour_dash_welcome_body', [BRAND_NAME]),
  },
  {
    selector: '#range-select',
    title: t('tour_dash_range_title'),
    body: t('tour_dash_range_body'),
  },
  {
    selector: '#top-chart-container',
    title: t('tour_dash_topSites_title'),
    body: t('tour_dash_topSites_body'),
  },
  {
    selector: '#hourly-chart-container',
    title: t('tour_dash_hourly_title'),
    body: t('tour_dash_hourly_body'),
  },
  {
    selector: '#dashboard-table-col',
    focusSelector: '#dashboard-body tr',
    title: t('tour_dash_table_title'),
    body: t('tour_dash_table_body'),
  },
  {
    selector: '#dashboard-table-col',
    focusSelector: '#dashboard-body tr',
    title: t('tour_dash_drill_title'),
    body: t('tour_dash_drill_body'),
    handoff: { nextSurface: 'site', mode: 'inPage' },
  },
  onwardStep('timeline'),
  onwardStep('rules'),
  onwardStep('settings'),
  {
    selector: '#tour-btn',
    title: t('tour_dash_complete_title'),
    body: t('tour_dash_complete_body', [BRAND_NAME]),
  },
]; }

async function maybeEnableMockMode() {
  // Mock fixtures are shown during the tour only for a user with no real data.
  // Post-cutover the authoritative store is the interval log, so check it (the
  // frozen scalar buckets may be empty even when the user has interval history).
  const { sitesByDay = {} } = await host.prefs.get('sitesByDay');
  const hasData = Object.keys(sitesByDay).length > 0 || (await intervalRowCount()) > 0;
  if (!hasData) {
    await writeTourState({ useMockData: true });
    clearMockModeCache();
  }
}

let isTourRunning = false;
let currentTourHandle = null;

async function startDashboardTour(startIndex = 0, steps = dashboardTourSteps(), knownState = null) {
  if (isTourRunning) return;
  const tourState = knownState ?? await readTourState();
  if (tourState.completed && !tourState.inProgress) return;
  isTourRunning = true;
  if (startIndex === 0) {
    const wasMock = tourState.useMockData;
    await maybeEnableMockMode();
    const nowState = await readTourState();
    if (!wasMock && nowState.useMockData) {
      await loadAndRender();
    }
  }
  currentTourHandle = runTour({
    surface: 'dashboard',
    steps,
    startIndex,
    onClose: ({ skipped }) => {
      isTourRunning = false;
      currentTourHandle = null;
      clearMockModeCache();
      if (skipped) loadAndRender();
    },
  });
}

tourBtn.addEventListener('click', async () => {
  await writeTourState({ completed: false, inProgress: null });
  startDashboardTour(0);
});

async function checkResume() {
  const state = await readTourState();
  if (state.completed || state.inProgress?.surface !== 'dashboard') return;
  const wantedIndex = state.inProgress.stepIndex || 0;
  if (currentTourHandle) {
    if (currentTourHandle.getIndex() !== wantedIndex) {
      currentTourHandle.goto(wantedIndex);
    }
  } else if (!isTourRunning) {
    startDashboardTour(wantedIndex);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkResume();
});

host.prefs.onChanged((changes) => {
  if (changes.tourAdvanceRequest) checkResume();
});

(async () => {
  if (new URLSearchParams(location.search).get('tour') === '1') {
    history.replaceState(null, '', location.pathname);
    await clearTourProgress();
    startDashboardTour(0);
    return;
  }
  const state = await readTourState();
  if (state.inProgress?.surface === 'dashboard') {
    startDashboardTour(state.inProgress.stepIndex || 0, dashboardTourSteps(), state);
    return;
  }
  if (state.completed) return;
  const pendingSurface = state.inProgress?.surface;
  if (pendingSurface) {
    const handoffIdx = dashboardTourSteps().findIndex(s => s.handoff?.nextSurface === pendingSurface);
    if (handoffIdx >= 0) startDashboardTour(handoffIdx, dashboardTourSteps(), state);
  }
})();

function dismissChangelogBanner() {
  changelogSubheader.style.display = 'none';
  markChangelogSeen();
}

function mdBoldToHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

async function showChangelogModal(entries) {
  const lang = await resolveLanguage();
  const previouslyFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'changelog-modal-overlay';

  const modal = document.createElement('div');
  modal.id = 'changelog-modal';
  modal.className = 'modal-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'changelog-modal-title');
  modal.innerHTML = `
    <button id="changelog-modal-close" class="icon-btn">&times;</button>
    <h3 id="changelog-modal-title"></h3>
    <div id="changelog-modal-body"></div>
  `;
  modal.querySelector('#changelog-modal-title').textContent = t('changelog_modalTitle');
  const closeBtn = modal.querySelector('#changelog-modal-close');
  const closeBtnLabel = t('changelog_closeModal');
  closeBtn.title = closeBtnLabel;
  closeBtn.setAttribute('aria-label', closeBtnLabel);
  const body = modal.querySelector('#changelog-modal-body');
  for (const entry of entries) {
    const group = document.createElement('div');
    group.className = 'changelog-version-group';
    const label = document.createElement('div');
    label.className = 'changelog-version-label';
    label.textContent = entry.version;
    group.appendChild(label);
    for (const section of entry.sections) {
      const categoryLabel = document.createElement('div');
      categoryLabel.className = 'changelog-category-label';
      categoryLabel.textContent = t(CHANGELOG_CATEGORIES[section.category]);
      const list = document.createElement('ul');
      list.className = 'changelog-items';
      for (const item of section.items) {
        const li = document.createElement('li');
        li.innerHTML = mdBoldToHtml(item[lang] ?? item.en);
        list.appendChild(li);
      }
      group.append(categoryLabel, list);
    }
    body.appendChild(group);
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    modal.remove();
    overlay.remove();
    dismissChangelogBanner();
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }
  // Only one focusable element in the modal, so the trap just keeps focus pinned to it.
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
  }

  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  document.body.append(overlay, modal);
  closeBtn.focus();
}

(async () => {
  const unseen = await getUnseenChangelogEntries();
  if (!unseen.length) return;
  const latestVersion = unseen[unseen.length - 1].version;
  changelogVersionBtn.textContent = t('changelog_whatsNew', latestVersion);
  changelogSubheader.removeAttribute('hidden');
  changelogDismissBtn.addEventListener('click', dismissChangelogBanner);
  changelogVersionBtn.addEventListener('click', () => showChangelogModal(unseen));
})();
