import { scanSiteBucket, scanSubpageBucket, applySiteDeletions, applySubpageDeletions } from '../../data/prune.js';
import { applySiteHourlyRangeDeletion, applySiteDailyReductions, applySubpageHourlyRangeDeletion, applySubpageDailyReductions, applyDirectDailyRangeDeletion, applyDirectSubpageDailyRangeDeletion, deleteSiteAllTime } from '../../data/targetedDelete.js';
import { formatMs, formatSpan, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { showNotification, formatBytes, escapeHtml, attachInputClear, navButton, keyActivate, trapFocusWithin } from '../../shared/utils.js';
import { confirmDialog } from '../../shared/confirmDialog.js';
import { PREF_LAST_EXPORT_AT, PREF_CLOCK_FORMAT } from '../../shared/prefKeys.js';
import { downloadBackupExport } from '../../data/exportPayload.js';
import { checkHealth, applyRepairs } from '../../data/healthCheck.js';
import { buildDatePicker, getDateValue, buildHourDropdown, getHourValue } from '../../shared/datePicker.js';
import { enhanceNumberInput } from '../../shared/numberInput.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
document.title = `${t('legacy_pageTitle')} - ${BRAND_NAME}`;

navButton(document.querySelector('#overview-back-btn'), '../storage-management/storage-management.html');
keyActivate(document.querySelector('#back-btn'), [' ']);

let _cbId = 0;
let cachedStores = { sitesByDay: {}, sitesByHour: {}, subpagesByDay: {}, subpagesByHour: {} };
let cachedBytes  = { siteHour: 0, subHour: 0, total: 0 };
let cachedIssues = [];

const ISSUE_TYPE_LABELS = {
  'drift':        'legacy_issue_drift',
  'orphan':       'legacy_issue_orphan',
  'future-dated': 'legacy_issue_futureDated',
  'invalid':      'legacy_issue_invalid',
};

async function initHourDropdowns() {
  const stored = await host.prefs.get(PREF_CLOCK_FORMAT);
  const clockFormat = stored[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;
  buildHourDropdown('range-from-hour', 0, clockFormat, () => syncDeleteRangeBtn(), { labelledBy: 'range-from-label' });
  buildHourDropdown('range-to-hour', 24, clockFormat, () => syncDeleteRangeBtn(), { labelledBy: 'range-to-label' });
  buildHourDropdown('repeat-from-hour', 9, clockFormat, () => syncDeleteRangeBtn(), { labelledBy: 'repeat-hours-label' });
  buildHourDropdown('repeat-to-hour', 17, clockFormat, () => syncDeleteRangeBtn(), { labelledBy: 'repeat-hours-label' });
  buildDatePicker('range-from-date', '', syncDeleteRangeBtn, { labelledBy: 'range-from-label' });
  buildDatePicker('range-to-date', '', syncDeleteRangeBtn, { labelledBy: 'range-to-label' });
  buildDatePicker('repeat-from-date', '', syncDeleteRangeBtn, { labelledBy: 'repeat-dates-label' });
  buildDatePicker('repeat-to-date', '', syncDeleteRangeBtn, { labelledBy: 'repeat-dates-label' });
  syncDeleteRangeBtn();
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
});

const spanChip = document.querySelector('#span-chip');
const spanTooltip = document.querySelector('#span-tooltip');
spanChip.addEventListener('mouseenter', () => { spanTooltip.style.display = 'block'; });
spanChip.addEventListener('mousemove', e => {
  spanTooltip.style.left = `${e.clientX + 12}px`;
  spanTooltip.style.top = `${e.clientY - 30}px`;
});
spanChip.addEventListener('mouseleave', () => { spanTooltip.style.display = 'none'; });

const contiguousForm = document.querySelector('#range-form-row');
const repeatForm = document.querySelector('#repeat-form');
const modeRepeatBtn = document.querySelector('#mode-repeat-btn');
document.querySelector('#mode-contiguous-btn').addEventListener('click', () => {
  contiguousForm.style.display = '';
  repeatForm.style.display = 'none';
  document.querySelector('#mode-contiguous-btn').classList.add('active');
  document.querySelector('#mode-contiguous-btn').setAttribute('aria-selected', 'true');
  modeRepeatBtn.classList.remove('active');
  modeRepeatBtn.setAttribute('aria-selected', 'false');
  syncDeleteRangeBtn();
});
modeRepeatBtn.addEventListener('click', () => {
  contiguousForm.style.display = 'none';
  repeatForm.style.display = '';
  modeRepeatBtn.classList.add('active');
  modeRepeatBtn.setAttribute('aria-selected', 'true');
  document.querySelector('#mode-contiguous-btn').classList.remove('active');
  document.querySelector('#mode-contiguous-btn').setAttribute('aria-selected', 'false');
  syncDeleteRangeBtn();
});

const siteInput = document.querySelector('#site-filter-input');
const deleteAllBtn = document.querySelector('#delete-all-site-btn');

function syncDeleteAllBtn() { deleteAllBtn.disabled = !siteInput.value.trim(); }
attachInputClear(siteInput, document.querySelector('#site-filter-clear'), syncDeleteAllBtn);

function syncDeleteRangeBtn() {
  const btn = document.querySelector('#delete-range-btn');
  const isRepeat = modeRepeatBtn.classList.contains('active');
  if (isRepeat) {
    const fromDate = getDateValue('repeat-from-date');
    const toDate   = getDateValue('repeat-to-date');
    btn.disabled = !fromDate || !toDate || fromDate > toDate || getHourValue('repeat-from-hour') >= getHourValue('repeat-to-hour');
  } else {
    const fromDate = getDateValue('range-from-date');
    const toDate   = getDateValue('range-to-date');
    const fromKey  = fromDate ? `${fromDate}T${String(getHourValue('range-from-hour')).padStart(2, '0')}` : '';
    const toKey    = toDate   ? `${toDate}T${String(getHourValue('range-to-hour')).padStart(2, '0')}`     : '';
    btn.disabled = !fromDate || !toDate || fromKey >= toKey;
  }
}

deleteAllBtn.addEventListener('click', async () => {
  const siteId = siteInput.value.trim();
  const ok = await confirmDialog({
    message: t('legacy_confirmDeleteAllData', [siteId]),
    confirmLabel: t('storage_deleteBtn'),
  });
  if (!ok) return;

  const beforeBytes = await host.prefs.bytesInUse();
  const data = await host.prefs.get(['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour']);
  const sitesByDay     = data.sitesByDay     ?? {};
  const sitesByHour    = data.sitesByHour    ?? {};
  const subpagesByDay  = data.subpagesByDay  ?? {};
  const subpagesByHour = data.subpagesByHour ?? {};

  deleteSiteAllTime(sitesByDay, siteId);
  deleteSiteAllTime(sitesByHour, siteId);
  deleteSiteAllTime(subpagesByDay, siteId);
  deleteSiteAllTime(subpagesByHour, siteId);

  await host.prefs.set({ sitesByDay, sitesByHour, subpagesByDay, subpagesByHour });

  const afterBytes = await host.prefs.bytesInUse();
  showNotification(t('legacy_allDataDeletedFreed', [siteId, formatBytes(Math.max(0, beforeBytes - afterBytes))]));
  loadStats();
});

document.querySelector('#delete-range-btn').addEventListener('click', async () => {
  const isRepeat = modeRepeatBtn.classList.contains('active');
  const siteId   = siteInput.value.trim() || null;
  const scope    = siteId ? t('storage_forSite', [siteId]) : '';

  let confirmMsg, rangePairs;

  if (isRepeat) {
    const fromDate = getDateValue('repeat-from-date');
    const toDate   = getDateValue('repeat-to-date');
    const fromHour = getHourValue('repeat-from-hour');
    const toHour   = getHourValue('repeat-to-hour');
    rangePairs = buildRepeatPairs(fromDate, toDate, fromHour, toHour);
    confirmMsg = t('legacy_confirmDeleteRepeat', [scope, String(fromHour).padStart(2, '0'), String(toHour).padStart(2, '0'), fromDate, toDate]);
  } else {
    const fromDate = getDateValue('range-from-date');
    const toDate   = getDateValue('range-to-date');
    const fromHour = getHourValue('range-from-hour');
    const toHour   = getHourValue('range-to-hour');
    const fromKey  = `${fromDate}T${String(fromHour).padStart(2, '0')}`;
    const toKey    = `${toDate}T${String(toHour).padStart(2, '0')}`;
    rangePairs = [[fromKey, toKey]];
    confirmMsg = t('legacy_confirmDeleteContiguous', [scope, fromDate, String(fromHour).padStart(2, '0'), toDate, String(toHour).padStart(2, '0')]);
  }

  const ok = await confirmDialog({ message: confirmMsg, confirmLabel: t('storage_deleteBtn') });
  if (!ok) return;

  const beforeBytes = await host.prefs.bytesInUse();
  const data = await host.prefs.get(['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour']);
  const sitesByDay     = data.sitesByDay     ?? {};
  const sitesByHour    = data.sitesByHour    ?? {};
  const subpagesByDay  = data.subpagesByDay  ?? {};
  const subpagesByHour = data.subpagesByHour ?? {};

  const siteRed    = {};
  const subpageRed = {};
  for (const [from, to] of rangePairs) {
    mergeSiteReductions(siteRed,    applySiteHourlyRangeDeletion(sitesByHour, from, to, siteId));
    mergeSubpageReductions(subpageRed, applySubpageHourlyRangeDeletion(subpagesByHour, from, to, siteId));
    applyDirectDailyRangeDeletion(sitesByDay, from, to, siteId);
    applyDirectSubpageDailyRangeDeletion(subpagesByDay, from, to, siteId);
  }
  applySiteDailyReductions(sitesByDay, siteRed);
  applySubpageDailyReductions(subpagesByDay, subpageRed);

  await host.prefs.set({ sitesByDay, sitesByHour, subpagesByDay, subpagesByHour });

  const afterBytes = await host.prefs.bytesInUse();
  showNotification(t('legacy_rangeDeletedFreed', [formatBytes(Math.max(0, beforeBytes - afterBytes))]));
  loadStats();
});

function buildRepeatPairs(fromDate, toDate, fromHour, toHour) {
  const pairs = [];
  const cur = new Date(fromDate + 'T12:00:00');
  const end = new Date(toDate + 'T12:00:00');
  while (cur <= end) {
    const d = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    pairs.push([`${d}T${String(fromHour).padStart(2, '0')}`, `${d}T${String(toHour).padStart(2, '0')}`]);
    cur.setDate(cur.getDate() + 1);
  }
  return pairs;
}

function mergeSiteReductions(target, source) {
  for (const [day, sites] of Object.entries(source)) {
    target[day] ??= {};
    for (const [sid, amounts] of Object.entries(sites)) {
      target[day][sid] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
      for (const f of ['activeMs', 'audioMs', 'overlapMs', 'idleMs']) target[day][sid][f] += amounts[f];
    }
  }
}

function mergeSubpageReductions(target, source) {
  for (const [day, sites] of Object.entries(source)) {
    target[day] ??= {};
    for (const [sid, paths] of Object.entries(sites)) {
      target[day][sid] ??= {};
      for (const [path, amounts] of Object.entries(paths)) {
        target[day][sid][path] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        for (const f of ['activeMs', 'audioMs', 'overlapMs', 'idleMs']) target[day][sid][path][f] += amounts[f];
      }
    }
  }
}

function updateHourlyCallout() {
  const { sitesByHour, subpagesByHour } = cachedStores;
  const { siteHour, subHour, total } = cachedBytes;

  const siteIds = new Set();
  for (const b of Object.values(sitesByHour)) for (const id of Object.keys(b)) siteIds.add(id);

  const subPages = new Set();
  for (const b of Object.values(subpagesByHour))
    for (const [sid, paths] of Object.entries(b))
      for (const p of Object.keys(paths)) subPages.add(`${sid}\n${p}`);

  const pct = b => total > 0 ? ` (${(b / total * 100).toFixed(0)}%)` : '';
  const hourlyTotal = siteHour + subHour;

  document.querySelector('#callout-sites-hour').innerHTML =
    t('legacy_calloutSites', [formatBytes(siteHour) + pct(siteHour), t(siteIds.size === 1 ? 'storage_unit_site_one' : 'storage_unit_site_other', [siteIds.size])]);
  document.querySelector('#callout-sub-hour').innerHTML =
    t('legacy_calloutSubpages', [formatBytes(subHour) + pct(subHour), t(subPages.size === 1 ? 'site_pages_one' : 'site_pages_other', [subPages.size])]);
  document.querySelector('#callout-hourly-total').textContent =
    t('legacy_totalHourly', [formatBytes(hourlyTotal), formatBytes(total), total > 0 ? (hourlyTotal / total * 100).toFixed(0) : 0]);
}

function updateDropEstimate() {
  const days = parseInt(document.querySelector('#drop-days-input').value, 10);
  const el = document.querySelector('#drop-estimate');
  if (isNaN(days) || days <= 0) { el.textContent = ''; return 0; }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const scopeSites = document.querySelector('#drop-scope-sites').checked;
  const scopeSub   = document.querySelector('#drop-scope-subpages').checked;

  let bytes = 0;
  if (scopeSites)
    for (const [k, v] of Object.entries(cachedStores.sitesByHour))
      if (k.slice(0, 10) < cutoffKey) bytes += JSON.stringify(v).length;
  if (scopeSub)
    for (const [k, v] of Object.entries(cachedStores.subpagesByHour))
      if (k.slice(0, 10) < cutoffKey) bytes += JSON.stringify(v).length;

  el.textContent = bytes > 0 ? `~${formatBytes(bytes)}` : '0 B';
  return bytes;
}

function syncDropBtn() {
  const val = document.querySelector('#drop-days-input').value;
  const num = parseInt(val, 10);
  const valid = val !== '' && !isNaN(num) && num > 0;
  const scopeOk = document.querySelector('#drop-scope-sites').checked || document.querySelector('#drop-scope-subpages').checked;
  const bytes = updateDropEstimate();
  document.querySelector('#drop-hourly-btn').disabled = !valid || !scopeOk || bytes === 0;
}

document.querySelector('#drop-days-input').addEventListener('input', syncDropBtn);
document.querySelector('#drop-scope-sites').addEventListener('change', syncDropBtn);
document.querySelector('#drop-scope-subpages').addEventListener('change', syncDropBtn);

document.querySelector('#drop-hourly-btn').addEventListener('click', async () => {
  const days = parseInt(document.querySelector('#drop-days-input').value, 10);
  const scopeSites = document.querySelector('#drop-scope-sites').checked;
  const scopeSub   = document.querySelector('#drop-scope-subpages').checked;
  const scope = [scopeSites && t('storage_sites'), scopeSub && t('storage_subpages')].filter(Boolean).join(' + ');

  const ok = await confirmDialog({
    message: t(days === 1 ? 'legacy_confirmDropHourly_one' : 'legacy_confirmDropHourly_other', [scope, days]),
    confirmLabel: t('legacy_dropHourlyBtn'),
  });
  if (!ok) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const beforeBytes = await host.prefs.bytesInUse();
  const data = await host.prefs.get(['sitesByHour', 'subpagesByHour']);
  const sitesByHour    = data.sitesByHour    ?? {};
  const subpagesByHour = data.subpagesByHour ?? {};

  if (scopeSites)
    for (const k of Object.keys(sitesByHour))    if (k.slice(0, 10) < cutoffKey) delete sitesByHour[k];
  if (scopeSub)
    for (const k of Object.keys(subpagesByHour)) if (k.slice(0, 10) < cutoffKey) delete subpagesByHour[k];

  await host.prefs.set({ sitesByHour, subpagesByHour });

  const afterBytes = await host.prefs.bytesInUse();
  showNotification(t(days === 1 ? 'legacy_hourlyDroppedFreed_one' : 'legacy_hourlyDroppedFreed_other', [days, formatBytes(Math.max(0, beforeBytes - afterBytes))]));
  loadStats();
});

function loadHealthCard() {
  cachedIssues = checkHealth(cachedStores);
  const dot        = document.querySelector('#health-dot');
  const statusText = document.querySelector('#health-status-text');
  const repairBtn  = document.querySelector('#repair-btn');

  if (cachedIssues.length === 0) {
    dot.className = 'health-dot ok';
    statusText.innerHTML = `<strong>${t('legacy_allChecksPassed')}</strong>`;
    repairBtn.style.display = 'none';
  } else {
    dot.className = 'health-dot';
    const types = [...new Set(cachedIssues.map(i => t(ISSUE_TYPE_LABELS[i.type])))].join(', ');
    statusText.innerHTML = `<strong>${t(cachedIssues.length === 1 ? 'legacy_issuesFound_one' : 'legacy_issuesFound_other', [cachedIssues.length])}</strong> — ${types}`;
    repairBtn.style.display = '';
  }
}

function buildRepairOverlay(issues) {
  const n = issues.length;
  document.querySelector('#repair-count').textContent = t(n === 1 ? 'legacy_issuesDetected_one' : 'legacy_issuesDetected_other', [n]);
  document.querySelector('#repair-footer-count').textContent = t(n === 1 ? 'legacy_issuesReconciled_one' : 'legacy_issuesReconciled_other', [n]);

  const resultsEl = document.querySelector('#repair-results');
  resultsEl.innerHTML = '';

  const grouped = {};
  for (const issue of issues) (grouped[issue.type] ??= []).push(issue);

  for (const [type, typeIssues] of Object.entries(grouped)) {
    const isFuture = type === 'future-dated';
    const siteLabel = isFuture ? t('legacy_colStore') : t('rules_col_site');
    const dateLabel = isFuture ? t('legacy_colKey') : t('legacy_colDate');
    const sortState = { col: 'date', dir: 'asc' };

    const details = document.createElement('details');
    details.className = 'result-group';
    details.open = true;
    details.innerHTML = `
      <summary class="result-group-title">${t(ISSUE_TYPE_LABELS[type])} (${typeIssues.length})</summary>
      <table class="data-table">
        <thead><tr>
          <th class="td-site" data-col="site" data-label="${escapeHtml(siteLabel)}">${siteLabel}</th>
          <th class="td-date" data-col="date" data-label="${escapeHtml(dateLabel)}">${dateLabel}</th>
          <th class="td-desc" data-col="detail" data-label="${escapeHtml(t('legacy_colDetail'))}">${t('legacy_colDetail')}</th>
        </tr></thead>
        <tbody></tbody>
      </table>`;

    rerenderRepairGroupBody(details, typeIssues, isFuture, sortState);

    details.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        sortState.dir = sortState.col === col && sortState.dir === 'asc' ? 'desc' : 'asc';
        sortState.col = col;
        rerenderRepairGroupBody(details, typeIssues, isFuture, sortState);
      });
    });

    resultsEl.appendChild(details);
  }
}

function rerenderRepairGroupBody(details, issues, isFuture, sortState) {
  const getVal = issue =>
    sortState.col === 'site'   ? (isFuture ? issue.store : (issue.siteId ?? '')).toLowerCase() :
    sortState.col === 'detail' ? issue.desc.toLowerCase() :
    (issue.hourKey ?? issue.dayKey ?? '');

  const sorted = [...issues].sort((a, b) => {
    const cmp = getVal(a) < getVal(b) ? -1 : getVal(a) > getVal(b) ? 1 : 0;
    return sortState.dir === 'asc' ? cmp : -cmp;
  });

  details.querySelectorAll('th[data-col]').forEach(th => {
    const isSorted = th.dataset.col === sortState.col;
    th.textContent = th.dataset.label + (isSorted ? (sortState.dir === 'desc' ? ' ↓' : ' ↑') : '');
    th.classList.toggle('sorted', isSorted);
  });

  const tbody = details.querySelector('tbody');
  tbody.innerHTML = '';
  for (const issue of sorted) {
    const tr = document.createElement('tr');
    const siteCell = isFuture ? escapeHtml(issue.store) :
      issue.path
        ? `<span class="site-label truncate">${escapeHtml(issue.siteId)}</span><span class="text-meta truncate">${escapeHtml(issue.path)}</span>`
        : `<span class="truncate">${escapeHtml(issue.siteId)}</span>`;
    tr.innerHTML = `<td class="td-site">${siteCell}</td><td class="td-date">${escapeHtml(issue.hourKey ?? issue.dayKey ?? '')}</td><td class="td-desc">${escapeHtml(issue.desc)}</td>`;
    tbody.appendChild(tr);
  }
}

const repairOverlay = document.querySelector('#repair-overlay');
document.querySelector('#repair-btn').addEventListener('click', async () => {
  const data = await host.prefs.get(['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour']);
  cachedIssues = checkHealth({
    sitesByDay:     data.sitesByDay     ?? {},
    sitesByHour:    data.sitesByHour    ?? {},
    subpagesByDay:  data.subpagesByDay  ?? {},
    subpagesByHour: data.subpagesByHour ?? {},
  });
  buildRepairOverlay(cachedIssues);
  repairOverlay.style.display = '';
  document.querySelector('#repair-overlay-close').focus();
});
document.querySelector('#repair-overlay-close').addEventListener('click', () => { repairOverlay.style.display = 'none'; });
document.querySelector('#repair-overlay-cancel-btn').addEventListener('click', () => { repairOverlay.style.display = 'none'; });
document.addEventListener('keydown', e => {
  if (repairOverlay.style.display === 'none') return;
  if (e.key === 'Escape') repairOverlay.style.display = 'none';
  trapFocusWithin(repairOverlay, e);
});

document.querySelector('#repair-all-btn').addEventListener('click', async () => {
  const data = await host.prefs.get(['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour']);
  const stores = {
    sitesByDay:     data.sitesByDay     ?? {},
    sitesByHour:    data.sitesByHour    ?? {},
    subpagesByDay:  data.subpagesByDay  ?? {},
    subpagesByHour: data.subpagesByHour ?? {},
  };

  applyRepairs(stores, cachedIssues);
  await host.prefs.set({ sitesByDay: stores.sitesByDay, sitesByHour: stores.sitesByHour, subpagesByDay: stores.subpagesByDay, subpagesByHour: stores.subpagesByHour });

  repairOverlay.style.display = 'none';
  const n = cachedIssues.length;
  showNotification(t(n === 1 ? 'legacy_issuesRepaired_one' : 'legacy_issuesRepaired_other', [n]));
  loadStats();
});

document.querySelector('#export-btn').addEventListener('click', async () => {
  await downloadBackupExport();
  await loadStats();
});

const DEFAULT_THRESHOLD_S = 30;
let pruneState = null; // { groups, stores, thresholdMs }

async function loadPruneSettings() {
  const { pruneThresholdSeconds } = await host.prefs.get('pruneThresholdSeconds');
  document.querySelector('#threshold-input').value = pruneThresholdSeconds ?? DEFAULT_THRESHOLD_S;
  syncScanBtn();
}

async function savePruneThreshold(val) {
  await host.prefs.set({ pruneThresholdSeconds: val });
}

function syncScanBtn() {
  const val = document.querySelector('#threshold-input').value;
  const num = Number(val);
  const validThreshold = val !== '' && !isNaN(num) && num > 0;
  const scopeOk = document.querySelector('#insig-scope-sites').checked || document.querySelector('#insig-scope-subpages').checked;
  document.querySelector('#scan-btn').disabled = !validThreshold || !scopeOk;
}

document.querySelector('#threshold-input').addEventListener('input', async () => {
  syncScanBtn();
  const num = Number(document.querySelector('#threshold-input').value);
  if (num > 0) savePruneThreshold(num);
});
document.querySelector('#insig-scope-sites').addEventListener('change', syncScanBtn);
document.querySelector('#insig-scope-subpages').addEventListener('change', syncScanBtn);

const scanOverlay = document.querySelector('#scan-overlay');
document.querySelector('#scan-btn').addEventListener('click', runScan);
document.querySelector('#overlay-close').addEventListener('click', () => { scanOverlay.style.display = 'none'; });
document.addEventListener('keydown', e => {
  if (scanOverlay.style.display === 'none') return;
  if (e.key === 'Escape') scanOverlay.style.display = 'none';
  trapFocusWithin(scanOverlay, e);
});
document.querySelector('#overlay-delete-btn').addEventListener('click', deleteSelected);

async function runScan() {
  const thresholdMs = Number(document.querySelector('#threshold-input').value) * 1000;
  const scanSites = document.querySelector('#insig-scope-sites').checked;
  const scanSubpages = document.querySelector('#insig-scope-subpages').checked;

  const keys = [];
  if (scanSites) keys.push('sitesByDay', 'sitesByHour');
  if (scanSubpages) keys.push('subpagesByDay', 'subpagesByHour');

  const data = await host.prefs.get(keys);
  const sitesByDay = data.sitesByDay ?? {};
  const sitesByHour = data.sitesByHour ?? {};
  const subpagesByDay = data.subpagesByDay ?? {};
  const subpagesByHour = data.subpagesByHour ?? {};

  const groups = [];

  if (scanSites) {
    const results = [
      ...scanSiteBucket(sitesByDay, thresholdMs, 'sitesByDay'),
      ...scanSiteBucket(sitesByHour, thresholdMs, 'sitesByHour'),
    ];
    groups.push({ label: t('storage_sites'), isSubpage: false, results, sortCol: 'lastVisit', sortDir: 'desc', selectedKeys: new Set(results.map(rowKey)) });
  }

  if (scanSubpages) {
    const results = [
      ...scanSubpageBucket(subpagesByDay, thresholdMs, 'subpagesByDay'),
      ...scanSubpageBucket(subpagesByHour, thresholdMs, 'subpagesByHour'),
    ];
    groups.push({ label: t('storage_subpages'), isSubpage: true, results, sortCol: 'lastVisit', sortDir: 'desc', selectedKeys: new Set(results.map(rowKey)) });
  }

  pruneState = { groups, stores: { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour }, storeKeys: keys, thresholdMs };
  renderScanResults();
  scanOverlay.style.display = '';
  document.querySelector('#overlay-close').focus();
}

function rowKey(r) {
  return `${r.store}\n${r.siteId}\n${r.path ?? ''}`;
}

function formatLastVisit(dateKey) {
  const tIdx = dateKey.indexOf('T');
  return tIdx !== -1 ? `${dateKey.slice(0, tIdx)} ${dateKey.slice(tIdx + 1)}h` : dateKey;
}

function renderScanResults() {
  const { groups, thresholdMs } = pruneState;
  const scanSites = document.querySelector('#insig-scope-sites').checked;
  const scanSubpages = document.querySelector('#insig-scope-subpages').checked;

  const types = [];
  if (scanSites) types.push(t('storage_sites'));
  if (scanSubpages) types.push(t('storage_subpages'));
  document.querySelector('#overlay-params').textContent = `${thresholdMs / 1000}s · ${types.join(' + ')}`;

  const resultsEl = document.querySelector('#overlay-results');
  resultsEl.innerHTML = '';

  const hasAny = groups.some(g => g.results.length > 0);

  if (!hasAny) {
    const msg = document.createElement('p');
    msg.className = 'text-meta';
    msg.style.cssText = 'padding: 20px; text-align: center;';
    msg.textContent = t('legacy_noRecordsBelowThreshold');
    resultsEl.appendChild(msg);
    document.querySelector('#overlay-delete-btn').style.display = 'none';
    document.querySelector('#overlay-summary').textContent = '';
    return;
  }

  document.querySelector('#overlay-delete-btn').style.display = '';

  for (const group of groups) {
    if (group.results.length > 0) resultsEl.appendChild(buildGroupEl(group));
  }

  updateScanSummary();
}

function buildGroupEl(group) {
  const details = document.createElement('details');
  details.className = 'result-group';
  details.open = true;

  const colHeader = group.isSubpage ? t('storage_colPage') : t('rules_col_site');
  details.innerHTML = `
    <summary class="result-group-title">${group.label} (${group.results.length})</summary>
    <table class="data-table">
      <thead><tr>
        <th class="td-site" data-col="siteId" data-label="${escapeHtml(colHeader)}">${colHeader}</th>
        <th class="td-narrow" data-col="lastVisit" data-label="${escapeHtml(t('storage_colLastVisit'))}">${t('storage_colLastVisit')}</th>
        <th class="td-narrow" data-col="totalActive" data-label="${escapeHtml(t('legend_active'))}">${t('legend_active')}</th>
        <th class="td-narrow" data-col="totalAudio" data-label="${escapeHtml(t('legend_audio'))}">${t('legend_audio')}</th>
        <th class="td-narrow" data-col="recordCount" data-label="${escapeHtml(t('legacy_records'))}">${t('legacy_records')}</th>
        <th class="td-check"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="scan-all-${group.label.toLowerCase()}" class="group-all-check"> ${t('storage_allCheckbox')}</label></th>
      </tr></thead>
      <tbody></tbody>
    </table>`;

  rerenderGroupBody(group, details);

  details.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      group.sortDir = group.sortCol === col && group.sortDir === 'asc' ? 'desc' : 'asc';
      group.sortCol = col;
      rerenderGroupBody(group, details);
    });
  });

  details.querySelector('.group-all-check').addEventListener('change', e => {
    if (e.target.checked) group.results.forEach(r => group.selectedKeys.add(rowKey(r)));
    else group.selectedKeys.clear();
    rerenderGroupBody(group, details);
    updateScanSummary();
  });

  return details;
}

function rerenderGroupBody(group, details) {
  const sorted = [...group.results].sort((a, b) => {
    let av = a[group.sortCol], bv = b[group.sortCol];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return group.sortDir === 'asc' ? cmp : -cmp;
  });

  details.querySelectorAll('th[data-col]').forEach(th => {
    const isSorted = th.dataset.col === group.sortCol;
    th.textContent = th.dataset.label + (isSorted ? (group.sortDir === 'desc' ? ' ↓' : ' ↑') : '');
    th.classList.toggle('sorted', isSorted);
  });

  const tbody = details.querySelector('tbody');
  tbody.innerHTML = '';
  for (const r of sorted) tbody.appendChild(buildRowEl(r, group, details));

  syncGroupAllCheck(group, details);
}

function buildRowEl(r, group, details) {
  const key = rowKey(r);
  const checked = group.selectedKeys.has(key);
  const tr = document.createElement('tr');
  if (!checked) tr.classList.add('unchecked');

  const siteCell = group.isSubpage
    ? `<td class="td-site"><span class="site-label truncate" title="${escapeHtml(r.siteId)}">${escapeHtml(r.siteId)}</span><span class="text-meta truncate" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span></td>`
    : `<td class="td-site"><span class="truncate" title="${escapeHtml(r.siteId)}">${escapeHtml(r.siteId)}</span></td>`;

  tr.innerHTML = `${siteCell}<td>${formatLastVisit(r.lastVisit)}</td><td>${formatMs(r.totalActive)}</td><td>${formatMs(r.totalAudio)}</td><td>${r.recordCount}</td><td class="td-check"><input type="checkbox" id="scan-row-${++_cbId}" ${checked ? 'checked' : ''}></td>`;

  tr.querySelector('input[type="checkbox"]').addEventListener('change', e => {
    if (e.target.checked) { group.selectedKeys.add(key); tr.classList.remove('unchecked'); }
    else { group.selectedKeys.delete(key); tr.classList.add('unchecked'); }
    syncGroupAllCheck(group, details);
    updateScanSummary();
  });

  return tr;
}

function syncGroupAllCheck(group, details) {
  const total = group.results.length;
  const selected = group.results.filter(r => group.selectedKeys.has(rowKey(r))).length;
  const check = details.querySelector('.group-all-check');
  check.checked = selected === total && total > 0;
  check.indeterminate = selected > 0 && selected < total;
}

function groupByStore(results) {
  const out = {};
  for (const r of results) (out[r.store] ??= []).push(r);
  return out;
}

function updateScanSummary() {
  let totalIdentities = 0;
  let totalRecords = 0;
  const totalResults = pruneState.groups.reduce((s, g) => s + g.results.length, 0);

  for (const group of pruneState.groups) {
    for (const r of group.results) {
      if (group.selectedKeys.has(rowKey(r))) {
        totalIdentities++;
        totalRecords += r.recordCount;
      }
    }
  }

  const deleteBtn = document.querySelector('#overlay-delete-btn');
  const summaryEl = document.querySelector('#overlay-summary');

  if (totalIdentities === 0) {
    summaryEl.textContent = t('storage_nothingSelected');
    deleteBtn.disabled = true;
    return;
  }

  deleteBtn.disabled = false;
  const estimated = estimateSavedBytes();
  const bytesStr = estimated > 0 ? t('legacy_approxBytes', [formatBytes(estimated)]) : '';
  summaryEl.textContent = t('legacy_selectedSummary', [totalIdentities, totalResults, totalRecords, bytesStr]);
}

function estimateSavedBytes() {
  const { groups, stores } = pruneState;
  const clones = {};
  for (const [key, store] of Object.entries(stores)) clones[key] = JSON.parse(JSON.stringify(store));

  const before = JSON.stringify(clones).length;

  for (const group of groups) {
    const selected = group.results.filter(r => group.selectedKeys.has(rowKey(r)));
    for (const [store, identities] of Object.entries(groupByStore(selected))) {
      if (group.isSubpage) applySubpageDeletions(clones[store], identities);
      else applySiteDeletions(clones[store], identities);
    }
  }

  return Math.max(0, before - JSON.stringify(clones).length);
}

async function deleteSelected() {
  const ok = await confirmDialog({
    message: t('legacy_confirmDeleteSelectedRecords'),
    confirmLabel: t('storage_deleteBtn'),
  });
  if (!ok) return;

  const { groups, stores, storeKeys } = pruneState;

  const beforeBytes = await host.prefs.bytesInUse();

  const updated = {};
  for (const key of storeKeys) updated[key] = JSON.parse(JSON.stringify(stores[key]));

  for (const group of groups) {
    const selected = group.results.filter(r => group.selectedKeys.has(rowKey(r)));
    for (const [store, identities] of Object.entries(groupByStore(selected))) {
      if (group.isSubpage) applySubpageDeletions(updated[store], identities);
      else applySiteDeletions(updated[store], identities);
    }
  }

  await host.prefs.set(updated);

  const afterBytes = await host.prefs.bytesInUse();

  scanOverlay.style.display = 'none';
  showNotification(t('legacy_insigDeletedFreed', [formatBytes(Math.max(0, beforeBytes - afterBytes))]));
  loadStats();
}

async function loadStats() {
  const keys = ['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour', PREF_LAST_EXPORT_AT];
  const [data, siteDayBytes, siteHourBytes, subDayBytes, subHourBytes, totalBytes] = await Promise.all([
    host.prefs.get(keys),
    host.prefs.bytesInUse('sitesByDay'),
    host.prefs.bytesInUse('sitesByHour'),
    host.prefs.bytesInUse('subpagesByDay'),
    host.prefs.bytesInUse('subpagesByHour'),
    host.prefs.bytesInUse(),
  ]);

  const sitesByDay = data.sitesByDay ?? {};
  const sitesByHour = data.sitesByHour ?? {};
  const subpagesByDay = data.subpagesByDay ?? {};
  const subpagesByHour = data.subpagesByHour ?? {};

  const domains = new Set();
  for (const b of Object.values(sitesByDay)) for (const id of Object.keys(b)) domains.add(id);
  for (const b of Object.values(sitesByHour)) for (const id of Object.keys(b)) domains.add(id);

  const subpages = new Set();
  for (const b of Object.values(subpagesByDay))
    for (const [sid, paths] of Object.entries(b)) for (const p of Object.keys(paths)) subpages.add(`${sid}\n${p}`);
  for (const b of Object.values(subpagesByHour))
    for (const [sid, paths] of Object.entries(b)) for (const p of Object.keys(paths)) subpages.add(`${sid}\n${p}`);

  let records = 0;
  for (const b of Object.values(sitesByDay)) records += Object.keys(b).length;
  for (const b of Object.values(sitesByHour)) records += Object.keys(b).length;
  for (const b of Object.values(subpagesByDay)) for (const paths of Object.values(b)) records += Object.keys(paths).length;
  for (const b of Object.values(subpagesByHour)) for (const paths of Object.values(b)) records += Object.keys(paths).length;

  const allDays = [
    ...Object.keys(sitesByDay),
    ...Object.keys(sitesByHour).map(k => k.slice(0, 10)),
    ...Object.keys(subpagesByDay),
    ...Object.keys(subpagesByHour).map(k => k.slice(0, 10)),
  ];
  const earliest = allDays.length ? allDays.reduce((a, b) => a < b ? a : b) : null;
  const latest   = allDays.length ? allDays.reduce((a, b) => a > b ? a : b) : null;

  document.querySelector('#count-domains').textContent  = domains.size.toLocaleString();
  document.querySelector('#count-subpages').textContent = subpages.size.toLocaleString();
  document.querySelector('#count-records').textContent  = records.toLocaleString();

  if (earliest && latest) {
    document.querySelector('#span-value').textContent   = formatSpan(earliest, latest);
    document.querySelector('#span-tooltip').textContent = `${earliest} → ${latest}`;
  } else {
    document.querySelector('#span-value').textContent = '—';
    document.querySelector('#span-info').style.display = 'none';
    document.querySelector('#span-chip').style.cursor  = 'default';
  }

  const storeTotal = siteDayBytes + siteHourBytes + subDayBytes + subHourBytes;
  const pct = s => totalBytes > 0 ? `${(s / totalBytes * 100).toFixed(1)}%` : '0%';
  document.querySelector('#bar-site-day').style.width  = pct(siteDayBytes);
  document.querySelector('#bar-site-hour').style.width = pct(siteHourBytes);
  document.querySelector('#bar-sub-day').style.width   = pct(subDayBytes);
  document.querySelector('#bar-sub-hour').style.width  = pct(subHourBytes);
  document.querySelector('#store-total-text').textContent = `${formatBytes(storeTotal)} / ${formatBytes(totalBytes)}`;
  document.querySelector('#legend-site-day').textContent  = t('legacy_legendWithBytes', [t('legacy_sitesDaily'), formatBytes(siteDayBytes)]);
  document.querySelector('#legend-site-hour').textContent = t('legacy_legendWithBytes', [t('legacy_sitesHourly'), formatBytes(siteHourBytes)]);
  document.querySelector('#legend-sub-day').textContent   = t('legacy_legendWithBytes', [t('legacy_subpagesDaily'), formatBytes(subDayBytes)]);
  document.querySelector('#legend-sub-hour').textContent  = t('legacy_legendWithBytes', [t('legacy_subpagesHourly'), formatBytes(subHourBytes)]);
  const otherBytes = totalBytes - storeTotal;
  if (otherBytes > 0) {
    document.querySelector('#bar-other').style.width = pct(otherBytes);
    document.querySelector('#legend-other').removeAttribute('hidden');
    document.querySelector('#legend-other-text').textContent = t('legacy_legendWithBytes', [t('legacy_cacheRulesOther'), formatBytes(otherBytes)]);
  }

  const quota = host.prefs.quota;
  document.querySelector('#quota-bar-fill').style.width = `${Math.min(100, totalBytes / quota * 100).toFixed(1)}%`;
  document.querySelector('#quota-text').textContent = `${formatBytes(totalBytes)} / ${formatBytes(quota)}`;

  const quotaWarn = document.querySelector('#quota-warn');
  if (totalBytes > 0 && earliest && latest) {
    const daySpan = Math.max(1, Math.round((new Date(latest) - new Date(earliest)) / 86400000));
    const daysLeft = Math.round((quota - totalBytes) / (totalBytes / daySpan));
    if (daysLeft > 0) {
      quotaWarn.textContent = t(daysLeft === 1 ? 'legacy_atCurrentRate_one' : 'legacy_atCurrentRate_other', [daysLeft]);
      quotaWarn.removeAttribute('hidden');
    }
  }

  const lastExportAt = data[PREF_LAST_EXPORT_AT];
  if (lastExportAt) {
    const diffDays = Math.floor((Date.now() - lastExportAt) / 86400000);
    document.querySelector('#export-age').textContent   = diffDays === 0 ? t('stat_today') : diffDays;
    document.querySelector('#export-label').textContent = diffDays === 0 ? '' : t(diffDays !== 1 ? 'storage_daysAgoSuffix' : 'storage_dayAgo');
  } else {
    document.querySelector('#export-age').textContent   = t('rules_limit_never');
    document.querySelector('#export-label').textContent = t('storage_exportedLabel');
  }

  cachedStores = { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour };
  cachedBytes  = { siteHour: siteHourBytes, subHour: subHourBytes, total: totalBytes };
  updateHourlyCallout();
  syncDropBtn();
  loadHealthCard();
}

const urlParams = new URLSearchParams(location.search);
const paramSite = urlParams.get('site');
if (paramSite) {
  siteInput.value = paramSite;
  document.querySelector('#site-filter-clear').removeAttribute('hidden');
  document.querySelector('#range-delete').scrollIntoView({ behavior: 'smooth' });
}
syncDeleteAllBtn();
syncDropBtn();
initHourDropdowns();
loadStats();
loadPruneSettings();
enhanceNumberInput('threshold-input');
enhanceNumberInput('drop-days-input');
