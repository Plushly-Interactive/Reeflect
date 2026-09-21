import { formatBytes, showNotification, attachInputClear, escapeHtml, navButton, getQuotaUsage, QUOTA_WARN_PCT, keyActivate, trapFocusWithin, attachInfoTooltip } from '../../shared/utils.js';
import { localDayKey, formatSpan, formatMs, DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { appendIntervals, allIntervals } from '../../data/intervalLog.js';
import { intervalStats, deleteByOrigins, deleteByDomain, deleteRange, dropPathsBefore } from '../../shared/rowStore.js';
import { invalidate, getSitesByDay, getSubpagesByDay, getSitesByHour, getSubpagesByHour } from '../../data/intervalAggregates.js';
import { confirmDialog } from '../../shared/confirmDialog.js';
import '../../shared/phoneHeader.js';
import { downloadBackupExport, EXPORT_PREF_KEYS } from '../../data/exportPayload.js';
import { validateBackupFile, parseBackupImport, backupDayConflicts, backupRuleConflicts, backupPrefsConflicts, applyBackupImport } from '../../data/importBuckets.js';
import { matchLabel, RULE_MULTIPLIERS } from '../../shared/rules.js';
import { parseTtStats, applyTtImport, downloadTt, TT_VERSION } from '../../data/ttImport.js';
import { downloadDailyCsv, downloadHourlyCsv, downloadIntervalsCsv } from '../../data/csvExport.js';
import { SITES_DAY_KEY } from '../../data/bucketKeys.js';
import { PREF_LAST_EXPORT_AT, PREF_CLOCK_FORMAT, PREF_IDLE_THRESHOLD_SEC, PREF_WEEK_START, PREF_CHART_COLORS } from '../../shared/prefKeys.js';
import { autoStartIfMatches, PHONE_WIDTH } from '../../shared/tour.js';
import { isMockMode, mockIntervalStats } from '../../shared/tourMockData.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { buildDatePicker, getDateValue, buildHourDropdown, getHourValue } from '../../shared/datePicker.js';
import { enhanceNumberInput } from '../../shared/numberInput.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
document.title = `${t('storage_pageTitle')} - ${BRAND_NAME}`;
keyActivate(document.querySelector('#back-btn'), [' ']);

const spanChip = document.querySelector('#span-chip');
const spanTooltip = document.querySelector('#span-tooltip');
attachInfoTooltip(spanChip, spanTooltip);

async function exportAll() {
  await downloadBackupExport();
  await loadStats();
}
document.querySelector('#export-btn').addEventListener('click', exportAll);
// Frozen legacy buckets have their own management page; surface it only when such
// data exists (renderQuota reveals the button). New interval-only profiles never
// see it.
navButton(document.querySelector('#legacy-storage-btn'), '../legacy-storage-management/legacy-storage-management.html');

// Import/Export modal. Export writes a complete backup. A backup import is a full
// restore: browsing days (legacy buckets), rules, settings and interval rows. Each
// category that differs from current data prompts a keep/replace in sequence; the
// restore is applied only after the last prompt, so Cancel writes nothing. The Time
// Tracker path restores only the bucket tier, by day.
const ioOverlay = document.querySelector('#io-modal-overlay');
const ioColumns = document.querySelector('#io-columns');
const ioError = document.querySelector('#io-error');
const ioInput = document.querySelector('#io-import-input');
const conflictView = document.querySelector('#io-conflict-view');
const conflictList = document.querySelector('#io-conflict-list');
const conflictLabel = document.querySelector('#io-conflict-label');
const conflictDesc = document.querySelector('#io-conflict-desc');
const conflictCount = document.querySelector('#io-conflict-count');
let pendingImport = null;  // bg: {kind,parsed,intervals,intervalCtx,dayConflicts,ruleConflicts,steps,index,decisions} | tt: {kind,data,sitesByDay,conflicts}

function showIoError(msg) { ioError.textContent = msg; ioError.removeAttribute('hidden'); ioError.style.display = ''; }
function hideConflicts() { conflictView.style.display = 'none'; ioColumns.style.display = ''; pendingImport = null; }
function openIo() {
  ioError.style.display = 'none';
  hideConflicts();
  ioOverlay.removeAttribute('hidden');
  ioOverlay.style.display = '';
  document.querySelector('#io-modal-close').focus();
}
function closeIo() { ioOverlay.style.display = 'none'; }

document.querySelector('#io-open-btn').addEventListener('click', openIo);
document.querySelector('#io-modal-close').addEventListener('click', closeIo);
ioOverlay.addEventListener('click', (e) => { if (e.target === ioOverlay) closeIo(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ioOverlay.style.display !== 'none') closeIo();
  if (ioOverlay.style.display !== 'none') trapFocusWithin(document.querySelector('#io-modal'), e);
});

document.querySelector('#io-bg-export-btn').addEventListener('click', exportAll);
document.querySelector('#io-bg-import-btn').addEventListener('click', () => ioInput.click());
document.querySelector('#io-tt-version').textContent = TT_VERSION;
document.querySelector('#io-tt-export-btn').addEventListener('click', async () => downloadTt(await getSitesByDay()));
document.querySelector('#io-tt-import-btn').addEventListener('click', () => ioInput.click());
document.querySelector('#io-csv-daily-btn').addEventListener('click', async () => downloadDailyCsv(await getSitesByDay(), await getSubpagesByDay()));
document.querySelector('#io-csv-hourly-btn').addEventListener('click', async () => downloadHourlyCsv(await getSitesByHour(), await getSubpagesByHour()));
document.querySelector('#io-csv-rows-btn').addEventListener('click', async () => downloadIntervalsCsv(await allIntervals()));

// Merge rows' [from,to) into sorted, disjoint coverage intervals.
function mergeRanges(rows) {
  const sorted = rows.map(r => [r.from, r.to]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [f, t] of sorted) {
    const last = out[out.length - 1];
    if (last && f <= last[1]) last[1] = Math.max(last[1], t);
    else out.push([f, t]);
  }
  return out;
}

// Partition rows by whether each overlaps `union` (sorted disjoint coverage).
function splitByOverlap(rows, union) {
  const sorted = [...rows].sort((a, b) => a.from - b.from);
  const overlapping = [], free = [];
  let j = 0;
  for (const row of sorted) {
    while (j < union.length && union[j][1] <= row.from) j++;
    const u = union[j];
    if (u && u[0] < row.to && row.from < u[1]) overlapping.push(row);
    else free.push(row);
  }
  return { overlapping, free };
}

function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rowLabel(r) {
  const where = r.domain + (r.path && r.path !== '/' ? r.path : '');
  return `${localDayKey(r.from)}  ${clock(r.from)}–${clock(r.to)}  ${where}  (${r.kind})`;
}

const MODE_KEYS = { active: 'mode_active', audio: 'mode_audio', 'active+audio': 'mode_activeAudio' };

// One-line summary of a rule's scope, limit and mode (e.g. "*.reddit.com 30m/day active").
function ruleSummary(r) {
  const ms = r.limit * (RULE_MULTIPLIERS[r.limitUnit] ?? 60000);
  const limitStr = ms === 0 ? t('storage_never') : `${formatMs(ms)}/${t(`period_${r.period}`)}`;
  return `${matchLabel(r)} ${limitStr} ${t(MODE_KEYS[r.mode])}${r.enabled ? '' : ` ${t('storage_off')}`}`;
}

// A conflicting site's current vs file rules, side by side. Em-spaces (which don't
// collapse in HTML, unlike runs of plain spaces) give the comparison room to breathe.
function ruleDiffLabel(domain, currentRules, importRules) {
  const onDomain = rs => rs.filter(r => r.target === domain).map(ruleSummary).join(', ');
  const SEP = '  ';
  return `${domain}:${SEP}${t('storage_yours')} ${onDomain(currentRules)}${SEP}→${SEP}${t('storage_file')} ${onDomain(importRules)}`;
}

// A setting's value, formatted for display (idle is stored in seconds, week start
// as a lowercase day name).
function prefValueLabel(key, val) {
  if (val === undefined || val === null) return t('storage_unset');
  if (key === PREF_IDLE_THRESHOLD_SEC) return t('storage_minutesAbbrev', [Math.round(val / 60)]);
  if (key === PREF_WEEK_START) return t(`weekday_${val}`);
  if (key === PREF_CHART_COLORS) return Object.entries(val).map(([type, hex]) => `${type} ${hex}`).join(', ') || t('storage_unset');
  return String(val);
}

// A conflicting setting's current vs file value, side by side.
function prefDiffLabel(key, currentPrefs, importPrefs) {
  const SEP = '  ';
  const name = t(PREF_LABELS[key] ?? key);
  return `${name}:${SEP}${t('storage_yours')} ${prefValueLabel(key, currentPrefs[key])}${SEP}→${SEP}${t('storage_file')} ${prefValueLabel(key, importPrefs[key])}`;
}

// Apply the interval-overlap choice. 'replace' drops current rows that overlap then
// inserts all file rows; 'keep' (or no overlap) inserts only file rows clear of
// current. Returns the number of rows inserted.
async function applyIntervals(intervals, ctx, choice) {
  let rowsToInsert = intervals, idsToDelete = null;
  if (choice === 'replace') {
    idsToDelete = splitByOverlap(ctx.currentRows, ctx.importUnion).overlapping;
  } else if (choice === 'keep') {
    rowsToInsert = splitByOverlap(intervals, ctx.currentUnion).free;
  }
  if (idsToDelete?.length) await deleteByOrigins(idsToDelete);
  const rows = rowsToInsert.map(({ id: _id, ...r }) => r);  // strip ids; ++id reassigns
  if (rows.length) await appendIntervals(rows);
  if (idsToDelete?.length || rows.length) invalidate();
  return rows.length;
}

const CONFLICT_LIST_CAP = 500;

const UNIT_KEYS = {
  day: ['storage_unit_day_one', 'storage_unit_day_other'],
  site: ['storage_unit_site_one', 'storage_unit_site_other'],
  setting: ['storage_unit_setting_one', 'storage_unit_setting_other'],
  row: ['storage_unit_row_one', 'storage_unit_row_other'],
};

// Generic conflict view: a list of string labels with a title/description/unit.
function showConflicts({ labels, unit, title, desc }) {
  conflictLabel.textContent = title;
  conflictDesc.textContent = desc;
  const [oneKey, otherKey] = UNIT_KEYS[unit];
  conflictCount.textContent = ` (${t(labels.length === 1 ? oneKey : otherKey, [labels.length.toLocaleString()])})`;
  conflictList.replaceChildren();
  for (const label of labels.slice(0, CONFLICT_LIST_CAP)) {
    const li = document.createElement('li');
    li.textContent = label;
    li.title = label;
    li.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    conflictList.appendChild(li);
  }
  if (labels.length > CONFLICT_LIST_CAP) {
    const li = document.createElement('li');
    li.textContent = t('storage_andNMore', [(labels.length - CONFLICT_LIST_CAP).toLocaleString()]);
    conflictList.appendChild(li);
  }
  ioColumns.style.display = 'none';
  conflictView.removeAttribute('hidden');
  conflictView.style.display = '';
  conflictView.style.marginTop = '0';  // columns above are hidden here, so no separator needed
}

const PREF_LABELS = {
  [PREF_CLOCK_FORMAT]: 'storage_prefClockFormat',
  [PREF_IDLE_THRESHOLD_SEC]: 'storage_prefIdleThreshold',
  [PREF_WEEK_START]: 'storage_prefWeekStart',
  [PREF_CHART_COLORS]: 'settings_chartColors',
};

// Backup file -> full restore. Each category (browsing days, rules, settings,
// interval rows) is compared against current data; categories that differ prompt a
// keep/replace in sequence, then everything applies at once. Cancel writes nothing.
async function importBackup(json) {
  const err = validateBackupFile(json);
  if (err) { showIoError(err); return; }
  let parsed;
  try { parsed = parseBackupImport(json); }
  catch { showIoError(t('storage_corruptedFile')); return; }

  const intervals = Array.isArray(json.intervals)
    ? json.intervals.filter(r => typeof r.from === 'number' && typeof r.to === 'number')
    : [];

  const hasBuckets = Object.keys(parsed.importByDay).length > 0;
  if (!hasBuckets && !parsed.importRules?.length && !parsed.importPrefs && intervals.length === 0) {
    showIoError(t('storage_noDataToImport'));
    return;
  }

  const stored = await host.prefs.get(['rules', ...EXPORT_PREF_KEYS]);
  const currentRules = stored.rules ?? [];
  const dayConflicts = await backupDayConflicts(parsed.importByDay);
  const ruleConflicts = backupRuleConflicts(currentRules, parsed.importRules);
  const prefConflicts = backupPrefsConflicts(parsed.importPrefs, stored);

  let intervalCtx = null, intervalOverlap = [];
  if (intervals.length) {
    const currentRows = await allIntervals();
    intervalCtx = { currentRows, currentUnion: mergeRanges(currentRows), importUnion: mergeRanges(intervals) };
    intervalOverlap = currentRows.length ? splitByOverlap(currentRows, intervalCtx.importUnion).overlapping : [];
  }

  const steps = [];
  if (dayConflicts.length) steps.push({
    cat: 'days', labels: dayConflicts, unit: 'day', title: t('storage_conflictingDays'),
    desc: t('storage_dayConflictDesc'),
  });
  if (ruleConflicts.length) steps.push({
    cat: 'rules', unit: 'site', title: t('storage_conflictingRules'),
    labels: ruleConflicts.map(dom => ruleDiffLabel(dom, currentRules, parsed.importRules)),
    desc: t('storage_ruleConflictDesc'),
  });
  if (prefConflicts.length) steps.push({
    cat: 'prefs', labels: prefConflicts.map(k => prefDiffLabel(k, stored, parsed.importPrefs)), unit: 'setting', title: t('storage_differentSettings'),
    desc: t('storage_settingsConflictDesc'),
  });
  if (intervalOverlap.length) steps.push({
    cat: 'intervals', labels: [...intervalOverlap].sort((a, b) => a.from - b.from).map(rowLabel), unit: 'row', title: t('storage_overlappingData'),
    desc: t('storage_conflictDesc'),
  });

  pendingImport = { kind: 'backup', parsed, intervals, intervalCtx, dayConflicts, ruleConflicts, steps, index: 0, decisions: {} };
  if (steps.length === 0) { await finalizeBackup(); return; }
  showBackupStep();
}

function showBackupStep() {
  const p = pendingImport;
  const step = p.steps[p.index];
  const prefix = p.steps.length > 1 ? t('storage_stepPrefix', [p.index + 1, p.steps.length]) : '';
  showConflicts({ labels: step.labels, unit: step.unit, title: prefix + step.title, desc: step.desc });
}

// Record the current step's choice and advance; once every conflicting category is
// decided, apply the whole restore in one pass.
async function backupAdvance(choice) {
  const p = pendingImport;
  p.decisions[p.steps[p.index].cat] = choice;
  p.index++;
  if (p.index < p.steps.length) { showBackupStep(); return; }
  await finalizeBackup();
}

async function finalizeBackup() {
  const p = pendingImport;
  pendingImport = null;
  const d = p.decisions;
  const summary = await applyBackupImport(p.parsed, {
    daysToReplace: d.days === 'replace' ? new Set(p.dayConflicts) : new Set(),
    replaceRuleDomains: d.rules === 'replace' ? new Set(p.ruleConflicts) : new Set(),
    overwritePrefs: d.prefs === 'replace',
  });
  const rowCount = p.intervals.length ? await applyIntervals(p.intervals, p.intervalCtx, d.intervals) : 0;
  closeIo();
  await loadStats();
  const parts = [];
  if (summary.days) parts.push(t(summary.days === 1 ? 'storage_daysParen_one' : 'storage_daysParen_other', [summary.days]));
  if (summary.rules) parts.push(t(summary.rules === 1 ? 'storage_rulesParen_one' : 'storage_rulesParen_other', [summary.rules]));
  if (summary.prefs) parts.push(t('storage_settingsWord'));
  if (rowCount) parts.push(t(rowCount === 1 ? 'storage_rowsParen_one' : 'storage_rowsParen_other', [rowCount.toLocaleString()]));
  showNotification(parts.length ? t('storage_importedParts', [parts.join(', ')]) : t('storage_nothingToImport'));
}

// Time Tracker export -> scalar bucket tier (separate from the interval log).
async function importTt(json) {
  const data = parseTtStats(json);
  const days = Object.keys(data);
  if (days.length === 0) { showIoError(t('storage_noTtData')); return; }

  const stored = await host.prefs.get(SITES_DAY_KEY);
  const sitesByDay = stored[SITES_DAY_KEY] ?? {};
  const conflicts = days.filter(d => sitesByDay[d]).sort();
  if (conflicts.length === 0) {
    await applyTtImport(data, sitesByDay, new Set());
    closeIo();
    await loadStats();
    return;
  }
  pendingImport = { kind: 'tt', data, sitesByDay, conflicts };
  showConflicts({
    labels: conflicts, unit: 'day', title: t('storage_conflictingDays'),
    desc: t('storage_ttConflictDesc'),
  });
}

ioInput.addEventListener('change', async () => {
  const file = ioInput.files[0];
  ioInput.value = '';
  if (!file) return;
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { showIoError(t('storage_invalidJson')); return; }
  if (json.format === 'browsing-data-backup' || json.format === 'reef' || json.format === 'biteguard') { await importBackup(json); return; }
  if (Array.isArray(json.__stat__)) { await importTt(json); return; }
  showIoError(t('storage_unrecognizedFile', [BRAND_NAME]));
});

document.querySelector('#io-conflict-cancel').addEventListener('click', () => {
  hideConflicts();
  showNotification(t('storage_importCancelled'));
});
document.querySelector('#io-conflict-keep').addEventListener('click', async () => {
  const p = pendingImport;
  if (p.kind === 'backup') { await backupAdvance('keep'); return; }
  hideConflicts();
  await applyTtImport(p.data, p.sitesByDay, new Set());  // take only non-conflicting days
  closeIo();
  await loadStats();
});
document.querySelector('#io-conflict-replace').addEventListener('click', async () => {
  const p = pendingImport;
  if (p.kind === 'backup') { await backupAdvance('replace'); return; }
  hideConflicts();
  await applyTtImport(p.data, p.sitesByDay, new Set(p.conflicts));  // overwrite conflicting days
  closeIo();
  await loadStats();
});

// --- Targeted deletion (UI cloned from the bucket storage page; deletes interval rows) ---

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
});

const contiguousForm = document.querySelector('#range-form-row');
const repeatForm = document.querySelector('#repeat-form');
const modeRepeatBtn = document.querySelector('#mode-repeat-btn');
const siteInput = document.querySelector('#site-filter-input');
const deleteAllBtn = document.querySelector('#delete-all-site-btn');

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

function syncDeleteAllBtn() { deleteAllBtn.disabled = !siteInput.value.trim(); }
attachInputClear(siteInput, document.querySelector('#site-filter-clear'), syncDeleteAllBtn);
const delSiteParam = new URLSearchParams(location.search).get('site');
if (delSiteParam) {
  siteInput.value = delSiteParam;
  siteInput.focus();
}
syncDeleteAllBtn();

function syncDeleteRangeBtn() {
  const btn = document.querySelector('#delete-range-btn');
  const isRepeat = modeRepeatBtn.classList.contains('active');
  if (isRepeat) {
    const fromDate = getDateValue('repeat-from-date'), toDate = getDateValue('repeat-to-date');
    btn.disabled = !fromDate || !toDate || fromDate > toDate || getHourValue('repeat-from-hour') >= getHourValue('repeat-to-hour');
  } else {
    const fromDate = getDateValue('range-from-date'), toDate = getDateValue('range-to-date');
    const fromKey = fromDate ? `${fromDate}T${String(getHourValue('range-from-hour')).padStart(2, '0')}` : '';
    const toKey = toDate ? `${toDate}T${String(getHourValue('range-to-hour')).padStart(2, '0')}` : '';
    btn.disabled = !fromDate || !toDate || fromKey >= toKey;
  }
}

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

// "YYYY-MM-DDTHH" -> ms; hour 24 rolls to next-day 00:00.
function keyToTs(key) {
  const [date, hh] = key.split('T');
  const d = new Date(date + 'T00:00:00');
  d.setHours(parseInt(hh, 10));
  return d.getTime();
}

deleteAllBtn.addEventListener('click', async () => {
  const siteId = siteInput.value.trim();
  const ok = await confirmDialog({
    message: t('storage_confirmDeleteAllRows', [siteId]),
    confirmLabel: t('storage_deleteBtn'),
  });
  if (!ok) return;
  const n = await deleteByDomain(siteId);
  invalidate();
  await loadStats();
  showNotification(t(n === 1 ? 'storage_deletedRowsFor_one' : 'storage_deletedRowsFor_other', [n.toLocaleString(), siteId]));
});

document.querySelector('#delete-range-btn').addEventListener('click', async () => {
  const isRepeat = modeRepeatBtn.classList.contains('active');
  const siteId = siteInput.value.trim() || null;
  const scope = siteId ? t('storage_forSite', [siteId]) : '';
  let confirmMsg, pairs;
  if (isRepeat) {
    const fromDate = getDateValue('repeat-from-date'), toDate = getDateValue('repeat-to-date');
    const fromHour = getHourValue('repeat-from-hour'), toHour = getHourValue('repeat-to-hour');
    pairs = buildRepeatPairs(fromDate, toDate, fromHour, toHour);
    confirmMsg = t('storage_confirmDeleteRepeat', [scope, String(fromHour).padStart(2, '0'), String(toHour).padStart(2, '0'), fromDate, toDate]);
  } else {
    const fromDate = getDateValue('range-from-date'), toDate = getDateValue('range-to-date');
    const fromHour = getHourValue('range-from-hour'), toHour = getHourValue('range-to-hour');
    pairs = [[`${fromDate}T${String(fromHour).padStart(2, '0')}`, `${toDate}T${String(toHour).padStart(2, '0')}`]];
    confirmMsg = t('storage_confirmDeleteContiguous', [scope, fromDate, String(fromHour).padStart(2, '0'), toDate, String(toHour).padStart(2, '0')]);
  }
  const ok = await confirmDialog({ message: confirmMsg, confirmLabel: t('storage_deleteBtn') });
  if (!ok) return;
  let n = 0;
  for (const [fromKey, toKey] of pairs) n += await deleteRange(keyToTs(fromKey), keyToTs(toKey), siteId);
  invalidate();
  await loadStats();
  showNotification(t(n === 1 ? 'storage_clearedRange_one' : 'storage_clearedRange_other', [n.toLocaleString()]));
});

async function initHourDropdowns() {
  const stored = await host.prefs.get(PREF_CLOCK_FORMAT);
  const clockFormat = stored[PREF_CLOCK_FORMAT] ?? DEFAULT_CLOCK_FORMAT;
  buildHourDropdown('range-from-hour', 0, clockFormat, syncDeleteRangeBtn, { labelledBy: 'range-from-label' });
  buildHourDropdown('range-to-hour', 24, clockFormat, syncDeleteRangeBtn, { labelledBy: 'range-to-label' });
  buildHourDropdown('repeat-from-hour', 9, clockFormat, syncDeleteRangeBtn, { labelledBy: 'repeat-hours-label' });
  buildHourDropdown('repeat-to-hour', 17, clockFormat, syncDeleteRangeBtn, { labelledBy: 'repeat-hours-label' });
  buildDatePicker('range-from-date', '', syncDeleteRangeBtn, { labelledBy: 'range-from-label' });
  buildDatePicker('range-to-date', '', syncDeleteRangeBtn, { labelledBy: 'range-to-label' });
  buildDatePicker('repeat-from-date', '', syncDeleteRangeBtn, { labelledBy: 'repeat-dates-label' });
  buildDatePicker('repeat-to-date', '', syncDeleteRangeBtn, { labelledBy: 'repeat-dates-label' });
  syncDeleteRangeBtn();
}
initHourDropdowns();

// --- Remove insignificant rows (scan overlay; aggregates raw rows per site/page) ---
let _cbId = 0;
let scanState = null;
const scanOverlay = document.querySelector('#scan-overlay');
const thresholdInput = document.querySelector('#threshold-input');
const overlayDeleteBtn = document.querySelector('#overlay-delete-btn');
const overlaySummary = document.querySelector('#overlay-summary');

function syncScanBtn() {
  const num = Number(thresholdInput.value);
  const valid = thresholdInput.value !== '' && !isNaN(num) && num > 0;
  const scopeOk = document.querySelector('#insig-scope-sites').checked || document.querySelector('#insig-scope-subpages').checked;
  document.querySelector('#scan-btn').disabled = !valid || !scopeOk;
}
thresholdInput.addEventListener('input', () => {
  thresholdInput.value = thresholdInput.value.replace(/[^0-9]/g, '');  // digits only
  syncScanBtn();
  const num = Number(thresholdInput.value);
  if (num > 0) host.prefs.set({ pruneThresholdSeconds: num });
});
document.querySelector('#insig-scope-sites').addEventListener('change', syncScanBtn);
document.querySelector('#insig-scope-subpages').addEventListener('change', syncScanBtn);
document.querySelector('#scan-btn').addEventListener('click', runScan);
document.querySelector('#overlay-close').addEventListener('click', () => { scanOverlay.style.display = 'none'; });
document.addEventListener('keydown', e => {
  if (scanOverlay.style.display === 'none') return;
  if (e.key === 'Escape') scanOverlay.style.display = 'none';
  trapFocusWithin(scanOverlay, e);
});
overlayDeleteBtn.addEventListener('click', deleteSelectedInsignificant);

function rowKey(r) { return `${r.isSub ? 'p' : 's'}\n${r.siteId}\n${r.path ?? ''}`; }

async function runScan() {
  const thresholdMs = Number(thresholdInput.value) * 1000;
  const scanSites = document.querySelector('#insig-scope-sites').checked;
  const scanSubpages = document.querySelector('#insig-scope-subpages').checked;

  const rows = await allIntervals();
  const siteAgg = new Map();
  const pathAgg = new Map();
  for (const r of rows) {
    const dur = Math.max(0, r.to - r.from);
    let s = siteAgg.get(r.domain);
    if (!s) { s = { siteId: r.domain, totalActive: 0, totalAudio: 0, recordCount: 0, lastTo: 0 }; siteAgg.set(r.domain, s); }
    s.recordCount++; if (r.to > s.lastTo) s.lastTo = r.to;
    if (r.kind === 'active') s.totalActive += dur; else if (r.kind === 'audio') s.totalAudio += dur;
    const pk = `${r.domain}\n${r.path}`;
    let p = pathAgg.get(pk);
    if (!p) { p = { siteId: r.domain, path: r.path, totalActive: 0, totalAudio: 0, recordCount: 0, lastTo: 0 }; pathAgg.set(pk, p); }
    p.recordCount++; if (r.to > p.lastTo) p.lastTo = r.to;
    if (r.kind === 'active') p.totalActive += dur; else if (r.kind === 'audio') p.totalAudio += dur;
  }

  const below = a => a.totalActive < thresholdMs && a.totalAudio < thresholdMs;
  const groups = [];
  if (scanSites) {
    const results = [...siteAgg.values()].filter(below).map(a => ({ ...a, isSub: false, lastVisit: localDayKey(a.lastTo) }));
    groups.push({ label: t('storage_sites'), isSub: false, results, sortCol: 'lastVisit', sortDir: 'desc', selectedKeys: new Set(results.map(rowKey)) });
  }
  if (scanSubpages) {
    const results = [...pathAgg.values()].filter(below).map(a => ({ ...a, isSub: true, lastVisit: localDayKey(a.lastTo) }));
    groups.push({ label: t('storage_subpages'), isSub: true, results, sortCol: 'lastVisit', sortDir: 'desc', selectedKeys: new Set(results.map(rowKey)) });
  }
  scanState = { groups, thresholdMs };
  renderScanResults();
  scanOverlay.style.display = '';
  document.querySelector('#overlay-close').focus();
}

function renderScanResults() {
  const { groups, thresholdMs } = scanState;
  document.querySelector('#overlay-params').textContent = `${thresholdMs / 1000}s · ${groups.map(g => g.label).join(' + ')}`;
  const resultsEl = document.querySelector('#overlay-results');
  resultsEl.innerHTML = '';
  if (!groups.some(g => g.results.length > 0)) {
    const msg = document.createElement('p');
    msg.className = 'text-meta';
    msg.style.cssText = 'padding:20px;text-align:center';
    msg.textContent = t('storage_noRowsBelowThreshold');
    resultsEl.appendChild(msg);
    overlayDeleteBtn.style.display = 'none';
    overlaySummary.textContent = '';
    return;
  }
  overlayDeleteBtn.style.display = '';
  for (const group of groups) if (group.results.length > 0) resultsEl.appendChild(buildGroupEl(group));
  updateScanSummary();
}

function buildGroupEl(group) {
  const details = document.createElement('details');
  details.className = 'result-group';
  details.open = true;
  group.el = details;
  const colHeader = group.isSub ? t('storage_colPage') : t('rules_col_site');
  details.innerHTML = `
    <summary class="result-group-title">${group.label} (${group.results.length})</summary>
    <table class="data-table">
      <thead><tr>
        <th class="td-site" data-col="siteId" data-label="${escapeHtml(colHeader)}">${colHeader}</th>
        <th class="td-narrow" data-col="lastVisit" data-label="${escapeHtml(t('storage_colLastVisit'))}">${t('storage_colLastVisit')}</th>
        <th class="td-narrow" data-col="totalActive" data-label="${escapeHtml(t('legend_active'))}">${t('legend_active')}</th>
        <th class="td-narrow" data-col="totalAudio" data-label="${escapeHtml(t('legend_audio'))}">${t('legend_audio')}</th>
        <th class="td-narrow" data-col="recordCount" data-label="${escapeHtml(t('storage_rows'))}">${t('storage_rows')}</th>
        <th class="td-check"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="group-all-check"> ${t('storage_allCheckbox')}</label></th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
  rerenderGroupBody(group, details);
  details.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      group.sortDir = group.sortCol === th.dataset.col && group.sortDir === 'asc' ? 'desc' : 'asc';
      group.sortCol = th.dataset.col;
      rerenderGroupBody(group, details);
    });
  });
  details.querySelector('.group-all-check').addEventListener('change', e => {
    if (e.target.checked) group.results.forEach(r => group.selectedKeys.add(rowKey(r)));
    else group.selectedKeys.clear();
    // Deselecting all pages also deselects their sites, and vice versa (see per-row handler).
    if (group.isSub && !e.target.checked) {
      const sites = scanState.groups.find(g => !g.isSub);
      if (sites) {
        for (const r of group.results) sites.selectedKeys.delete(`s\n${r.siteId}\n`);
        if (sites.el) rerenderGroupBody(sites, sites.el);
      }
    } else if (!group.isSub && !e.target.checked) {
      const subs = scanState.groups.find(g => g.isSub);
      if (subs) {
        const domains = new Set(group.results.map(s => s.siteId));
        for (const pr of subs.results) if (domains.has(pr.siteId)) subs.selectedKeys.delete(rowKey(pr));
        if (subs.el) rerenderGroupBody(subs, subs.el);
      }
    }
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
  const siteCell = group.isSub
    ? `<td class="td-site"><span class="site-label truncate" title="${escapeHtml(r.siteId)}">${escapeHtml(r.siteId)}</span><span class="text-meta truncate" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span></td>`
    : `<td class="td-site"><span class="truncate" title="${escapeHtml(r.siteId)}">${escapeHtml(r.siteId)}</span></td>`;
  tr.innerHTML = `${siteCell}<td>${r.lastVisit}</td><td>${formatMs(r.totalActive)}</td><td>${formatMs(r.totalAudio)}</td><td>${r.recordCount}</td><td class="td-check"><input type="checkbox" id="scan-row-${++_cbId}" ${checked ? 'checked' : ''}></td>`;
  tr.querySelector('input[type="checkbox"]').addEventListener('change', e => {
    if (e.target.checked) { group.selectedKeys.add(key); tr.classList.remove('unchecked'); }
    else { group.selectedKeys.delete(key); tr.classList.add('unchecked'); }
    // Keep site and its pages in sync: unchecking a page unchecks its site (a
    // selected site deletes the whole domain), and unchecking a site unchecks its
    // pages. Mutate keys + re-render (no change events fired, so no loop).
    if (group.isSub && !e.target.checked) {
      const sites = scanState.groups.find(g => !g.isSub);
      if (sites?.selectedKeys.delete(`s\n${r.siteId}\n`) && sites.el) rerenderGroupBody(sites, sites.el);
    } else if (!group.isSub && !e.target.checked) {
      const subs = scanState.groups.find(g => g.isSub);
      if (subs) {
        let changed = false;
        for (const pr of subs.results) if (pr.siteId === r.siteId) changed = subs.selectedKeys.delete(rowKey(pr)) || changed;
        if (changed && subs.el) rerenderGroupBody(subs, subs.el);
      }
    }
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

function updateScanSummary() {
  let identities = 0, records = 0;
  const totalResults = scanState.groups.reduce((s, g) => s + g.results.length, 0);
  for (const group of scanState.groups)
    for (const r of group.results)
      if (group.selectedKeys.has(rowKey(r))) { identities++; records += r.recordCount; }
  if (identities === 0) { overlaySummary.textContent = t('storage_nothingSelected'); overlayDeleteBtn.disabled = true; return; }
  overlayDeleteBtn.disabled = false;
  overlaySummary.textContent = t('storage_selectedSummary', [identities, totalResults, records.toLocaleString()]);
}

async function deleteSelectedInsignificant() {
  const ok = await confirmDialog({ message: t('storage_confirmDeleteSelected'), confirmLabel: t('storage_deleteBtn') });
  if (!ok) return;
  const domains = new Set();                  // selected whole sites
  const paths = new Set();                     // selected pages, keyed "domain\npath"
  for (const group of scanState.groups) {
    for (const r of group.results) {
      if (!group.selectedKeys.has(rowKey(r))) continue;
      if (group.isSub) paths.add(`${r.siteId}\n${r.path}`);
      else domains.add(r.siteId);
    }
  }
  // One pass, one bulk delete — avoids N full-store scans and partial failures.
  const rows = await allIntervals();
  const ids = rows.filter(r => domains.has(r.domain) || paths.has(`${r.domain}\n${r.path}`));
  await deleteByOrigins(ids);
  scanOverlay.style.display = 'none';
  invalidate();
  await loadStats();
  showNotification(t(ids.length === 1 ? 'storage_deletedRows_one' : 'storage_deletedRows_other', [ids.length.toLocaleString()]));
}

(async () => {
  const { pruneThresholdSeconds } = await host.prefs.get('pruneThresholdSeconds');
  if (pruneThresholdSeconds != null) thresholdInput.value = pruneThresholdSeconds;
  syncScanBtn();
})();

// --- Drop subpage detail (collapse old rows to site level) ---
const dropDaysInput = document.querySelector('#drop-days-input');
dropDaysInput.addEventListener('input', () => {
  dropDaysInput.value = dropDaysInput.value.replace(/[^0-9]/g, '');  // digits only
});
document.querySelector('#drop-paths-btn').addEventListener('click', async () => {
  const days = parseInt(document.querySelector('#drop-days-input').value, 10);
  if (!Number.isFinite(days) || days < 0) { showNotification(t('storage_enterValidDays')); return; }
  // Day-aligned: keep the last `days` calendar days detailed, collapse everything
  // before. cutoff = tomorrow 00:00 - days. days=0 collapses all; never splits a day.
  const c = new Date();
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() + 1 - days);
  const ok = await confirmDialog({
    message: t(days === 1 ? 'storage_confirmDropSubpage_one' : 'storage_confirmDropSubpage_other', [days]),
    confirmLabel: t('storage_dropBtn'),
  });
  if (!ok) return;
  const n = await dropPathsBefore(c.getTime());
  invalidate();
  await loadStats();
  showNotification(n > 0 ? t(n === 1 ? 'storage_removedByCollapsing_one' : 'storage_removedByCollapsing_other', [n.toLocaleString()]) : t(days === 1 ? 'storage_noRowsOlderThan_one' : 'storage_noRowsOlderThan_other', [days]));
});

// --- Favicon cache ---
const faviconStats = document.querySelector('#favicon-stats');
async function loadFaviconStats() {
  const [data, bytes] = await Promise.all([
    host.prefs.get('faviconCache'),
    host.prefs.bytesInUse('faviconCache'),
  ]);
  const n = Object.keys(data.faviconCache ?? {}).length;
  faviconStats.textContent = t(n === 1 ? 'storage_iconsStats_one' : 'storage_iconsStats_other', [n.toLocaleString(), formatBytes(bytes)]);
  document.querySelector('#favicon-clear-btn').disabled = n === 0;
}
document.querySelector('#favicon-clear-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({ message: t('storage_confirmClearFavicons'), confirmLabel: t('storage_clearBtn') });
  if (!ok) return;
  await host.prefs.remove('faviconCache');
  await loadFaviconStats();
  await loadStats();  // refresh the extension-storage quota
  showNotification(t('storage_faviconCacheCleared'));
});

const faviconDaysInput = document.querySelector('#favicon-days-input');
faviconDaysInput.addEventListener('input', () => {
  faviconDaysInput.value = faviconDaysInput.value.replace(/[^0-9]/g, '');  // digits only
});
document.querySelector('#favicon-stale-btn').addEventListener('click', async () => {
  const days = parseInt(faviconDaysInput.value, 10);
  if (!Number.isFinite(days) || days < 1) { showNotification(t('storage_enterValidDays')); return; }
  const cutoff = Date.now() - days * 86400000;
  // Last activity per domain (favicon keys are the same eTLD+1 domain).
  const lastTo = new Map();
  for (const r of await allIntervals()) {
    const cur = lastTo.get(r.domain) ?? 0;
    if (r.to > cur) lastTo.set(r.domain, r.to);
  }
  const { faviconCache = {} } = await host.prefs.get('faviconCache');
  const stale = Object.keys(faviconCache).filter(h => (lastTo.get(h) ?? 0) < cutoff);
  if (stale.length === 0) { showNotification(t('storage_noIconsUnusedFor', [days])); return; }
  const ok = await confirmDialog({
    message: t(stale.length === 1 ? 'storage_confirmClearStale_one' : 'storage_confirmClearStale_other', [stale.length.toLocaleString(), days]),
    confirmLabel: t('storage_clearBtn'),
  });
  if (!ok) return;
  for (const h of stale) delete faviconCache[h];
  await host.prefs.set({ faviconCache });
  await loadFaviconStats();
  await loadStats();
  showNotification(t(stale.length === 1 ? 'storage_clearedUnusedIcons_one' : 'storage_clearedUnusedIcons_other', [stale.length.toLocaleString()]));
});

loadFaviconStats();

async function renderInterval() {
  const mock = await isMockMode();
  const [stats, est] = await Promise.all([
    mock ? mockIntervalStats() : intervalStats(),
    mock ? null : (navigator.storage?.estimate ? navigator.storage.estimate().catch(() => null) : null),
  ]);
  document.querySelector('#count-domains').textContent  = stats.domains.toLocaleString();
  document.querySelector('#count-subpages').textContent = stats.subpages.toLocaleString();
  document.querySelector('#count-records').textContent  = stats.rows.toLocaleString();

  if (stats.earliest && stats.latest) {
    const from = localDayKey(stats.earliest), to = localDayKey(stats.latest);
    document.querySelector('#span-value').textContent = formatSpan(from, to);
    spanTooltip.textContent = `${from} → ${to}`;
  } else {
    document.querySelector('#span-value').textContent = '—';
    document.querySelector('#span-info').style.display = 'none';
    spanChip.style.cursor = 'default';
  }

  // Row mix by kind. The bar's denominator is total rows (composition, not quota).
  // Per-kind size is the IndexedDB total apportioned by row share (rows are uniform
  // shape, so this is a fair ~estimate; the total itself includes index overhead).
  const { active, audio, idle } = stats.kinds;
  // Mock rows live only in memory, so navigator.storage can't size them;
  // approximate from the row count to keep the overview's sizes plausible.
  const intervalBytes = mock ? stats.rows * 90 : (est?.usage ?? null);
  const pct = n => stats.rows > 0 ? `${(n / stats.rows * 100).toFixed(1)}%` : '0%';
  const sizeOf = n => intervalBytes != null && stats.rows > 0
    ? ` (~${formatBytes(intervalBytes * n / stats.rows)})` : '';
  document.querySelector('#bar-active').style.width = pct(active);
  document.querySelector('#bar-audio').style.width  = pct(audio);
  document.querySelector('#bar-idle').style.width   = pct(idle);
  document.querySelector('#legend-active').textContent = t('storage_legendRowsDetail', [t('legend_active'), active.toLocaleString(), sizeOf(active)]);
  document.querySelector('#legend-audio').textContent  = t('storage_legendRowsDetail', [t('legend_audio'), audio.toLocaleString(), sizeOf(audio)]);
  document.querySelector('#legend-idle').textContent   = t('storage_legendRowsDetail', [t('storage_legendIdle'), idle.toLocaleString(), sizeOf(idle)]);
  document.querySelector('#interval-total-text').textContent =
    intervalBytes != null ? formatBytes(intervalBytes) : t('storage_sizeUnavailable');
}

async function renderQuota() {
  // chrome.storage.local 10 MB (settings, cache, rules, legacy buckets).
  const { totalBytes, quota, pct } = await getQuotaUsage();
  document.querySelector('#quota-bar-fill').style.width = `${Math.min(100, pct).toFixed(1)}%`;
  document.querySelector('#quota-text').textContent = `${formatBytes(totalBytes)} / ${formatBytes(quota)}`;

  const quotaWarn = document.querySelector('#quota-warn');
  if (pct >= QUOTA_WARN_PCT) {
    quotaWarn.textContent = t('storage_quotaWarn', [Math.floor(pct)]);
    quotaWarn.removeAttribute('hidden');
    quotaWarn.style.display = '';
  } else {
    quotaWarn.style.display = 'none';
  }

  const { [SITES_DAY_KEY]: sitesByDay = {} } = await host.prefs.get(SITES_DAY_KEY);
  const hasLegacy = Object.values(sitesByDay).some(day => day && Object.keys(day).length > 0);
  document.querySelector('#legacy-storage-btn').style.display = hasLegacy ? '' : 'none';
}

async function renderLastExport() {
  const prefs = await host.prefs.get(PREF_LAST_EXPORT_AT);
  const lastExportAt = prefs[PREF_LAST_EXPORT_AT];
  if (lastExportAt) {
    const diffDays = Math.floor((Date.now() - lastExportAt) / 86400000);
    document.querySelector('#export-age').textContent   = diffDays === 0 ? t('stat_today') : diffDays;
    document.querySelector('#export-label').textContent = diffDays === 0 ? '' : t(diffDays !== 1 ? 'storage_daysAgoSuffix' : 'storage_dayAgo');
  } else {
    document.querySelector('#export-age').textContent   = t('rules_limit_never');
    document.querySelector('#export-label').textContent = t('storage_exportedLabel');
  }
}

async function loadStats() {
  for (const [name, fn] of [
    ['interval', renderInterval],
    ['quota', renderQuota], ['last-export', renderLastExport],
  ]) {
    try { await fn(); } catch (e) { console.error(`interval-storage ${name}:`, e); }
  }
}

enhanceNumberInput('threshold-input');
enhanceNumberInput('drop-days-input');
enhanceNumberInput('favicon-days-input');

await loadStats();
document.body.classList.remove('is-loading');

function storageTourSteps() { return [
  {
    selector: '#overview',
    title: t('tour_storage_overview_title'),
    body: t('tour_storage_overview_body'),  },
  {
    selector: '#tools-grid',
    title: t('tour_storage_tools_title'),
    body: t('tour_storage_tools_body'),  },
  {
    selector: PHONE_WIDTH ? '#nav-home' : '#back-btn',
    title: t('tour_storage_back_title'),
    body: PHONE_WIDTH ? t('tour_back_body_nav') : t('tour_storage_back_body', [BRAND_NAME]),
    handoff: { nextSurface: 'dashboard', nextStepIndex: 9, mode: 'inPage' },  },
]; }

autoStartIfMatches('storage-management', storageTourSteps());
