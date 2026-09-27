import { getRules, addRule, toggleRule, deleteRule, updateRule, renderRuleList, describeRule, findCoveringRule, findRedundantRules, disableRules, matchLabel, matcherLabel, matchersOf, isWebMatcher, BLOCKS_DAY_KEY, blockKey } from '../../shared/rules.js';
import { initCustomDropdowns } from '../../shared/dropdown.js';
import { getDomain } from '../../vendor/tldts.js';
import { localDayKey } from '../../shared/timeUtils.js';
import { weekDow, rotatedDayLabels } from '../../shared/weekStart.js';
import { drawBarChart, loadFaviconCache, loadInstalledApps, faviconUrl, attachInputClear, keyActivate, escapeHtml } from '../../shared/utils.js';
import { autoStartIfMatches, PHONE_WIDTH, onwardStep } from '../../shared/tour.js';
import { isMockMode, mockRules, mockBlocksByDay } from '../../shared/tourMockData.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { enhanceNumberInput, enhanceNumberInputEl } from '../../shared/numberInput.js';
import { initI18n, applyI18n, t, getLocale } from '../../shared/i18n.js';
import { host } from '../../shared/host.js';
import { coreCall } from '../../shared/core.js';

await initI18n();
applyI18n();
document.title = `${t('rules_pageTitle')} - ${BRAND_NAME}`;
keyActivate(document.querySelector('#back-btn'), [' ']);

const ruleName       = document.querySelector('#rule-name');
const targetsBox     = document.querySelector('#targets-box');
const targetsEdit    = document.querySelector('#targets-edit');
const targetsList    = document.querySelector('#targets-list');
const targetsEmpty   = document.querySelector('#targets-empty');
const picker         = document.querySelector('#target-picker');
const pickerSearch   = document.querySelector('#picker-search');
const pickerSearchClearBtn = document.querySelector('#picker-search-clear');
const pickerAddRow   = document.querySelector('#picker-add-row');
const pickerAddBtn   = document.querySelector('#picker-add-btn');
const pickerAddHint  = document.querySelector('#picker-add-hint');
const scopeCards     = [...document.querySelectorAll('.scope-card')];
const scopeCardsEl   = document.querySelector('#scope-cards');
const scopeCardsHome = scopeCardsEl.parentElement;
const pickerList     = document.querySelector('#picker-list');
const pickerEmpty    = document.querySelector('#picker-empty');
const previewText    = document.querySelector('#preview-text');
const previewPattern = document.querySelector('#preview-pattern');
const saveBtn        = document.querySelector('#save-btn');
const rulesList      = document.querySelector('#rules-list');
const noRulesMsg     = document.querySelector('#no-rules-message');
const mostBlockedFavicon = document.querySelector('#most-blocked-favicon');
mostBlockedFavicon.addEventListener('error', () => { mostBlockedFavicon.style.display = 'none'; });
const redundantPrompt       = document.querySelector('#redundant-prompt');
const redundantText         = document.querySelector('#redundant-text');
const redundantList         = document.querySelector('#redundant-list');
const redundantDisableBtn   = document.querySelector('#redundant-disable-btn');
const redundantKeepBtn      = document.querySelector('#redundant-keep-btn');
const reauthPrompt   = document.querySelector('#reauth-prompt');
const reauthText     = document.querySelector('#reauth-text');
const reauthBtn      = document.querySelector('#reauth-btn');
const formLimit      = document.querySelector('#form-limit');
const sortSiteBtn    = document.querySelector('#sort-site');
const sortStatusBtn  = document.querySelector('#sort-status');
const addCard        = document.querySelector('#add-card');
const addCardToggle  = document.querySelector('#add-card-toggle');
const addCardBody    = document.querySelector('#add-card-body');
const urlForm        = document.querySelector('#url-form');
const regexForm      = document.querySelector('#regex-form');
const keywordForm    = document.querySelector('#keyword-form');

const regexPatternInput = document.querySelector('#regex-pattern');
const regexPatternClear = document.querySelector('#regex-pattern-clear');
const regexPreviewText  = document.querySelector('#regex-preview-text');
const regexPreviewPat   = document.querySelector('#regex-preview-pattern');
const regexSaveBtn      = document.querySelector('#regex-save-btn');

const kwInput      = document.querySelector('#keyword-input');
const kwInputClear = document.querySelector('#keyword-input-clear');
const kwPreviewText = document.querySelector('#kw-preview-text');
const kwSaveBtn    = document.querySelector('#kw-save-btn');

let scope = 'subdomain';  // the scope card chosen for a typed site
let focusSite = null;     // a site ticked in the list: the cards under it set its scope
let selected = [];    // the apps and sites of the rule being built, as matchers
let candidates = [];  // what the picker offers: { source, target, label, ms }
let currentRules = [];
let mockMode = false;  // tour: seeded rules shown read-only, never persisted
let sort = { key: 'site', dir: 1 };

// Origin patterns a rule needs host permission for. host/pathPrefix are exact
// (no subdomain access); subdomain requests both forms since match-pattern
// docs don't clearly state whether *.target already includes the bare apex.
// regex/keyword have no fixed host, so they fall back to <all_urls>.
function originsFor(rule) {
  return matchersOf(rule).filter(isWebMatcher).flatMap(m => {
    if (m.matchType === 'regex' || m.matchType === 'keyword') return ['<all_urls>'];
    const exact = `*://${m.target}/*`;
    if (m.matchType === 'subdomain') return [exact, `*://*.${m.target}/*`];
    return [exact];
  });
}

// Request host permission for a candidate rule before it's saved. Must run
// inside the click handler (user gesture) — host.permissions.request()
// rejects outside one. Returns false (and leaves nothing saved) if declined.
async function requestPermissionFor(rule) {
  const origins = [...new Set(originsFor(rule))];
  if (!origins.length) return true;
  return host.permissions.request({ origins });
}

// Drop host permission for a deleted rule's origins, but only where no other
// remaining rule still needs them.
async function releasePermissionFor(deletedRule, remainingRules) {
  const stillNeeded = new Set(remainingRules.flatMap(originsFor));
  const toRemove = originsFor(deletedRule).filter(o => !stillNeeded.has(o));
  if (toRemove.length) await host.permissions.remove({ origins: toRemove });
}

// Origins currently missing permission across all rules. Catches both the
// one-time migration (existing users whose <all_urls> just became optional)
// and any later drift (permission manually revoked via chrome://extensions).
let reauthOrigins = [];

async function checkReauth() {
  const needed = [...new Set(currentRules.flatMap(originsFor))];
  const missing = [];
  for (const origin of needed) {
    if (!await host.permissions.contains({ origins: [origin] })) missing.push(origin);
  }
  reauthOrigins = missing;
  if (!missing.length) {
    reauthPrompt.style.display = 'none';
    return;
  }
  const affected = currentRules.filter(r => originsFor(r).some(o => missing.includes(o))).length;
  reauthText.textContent = affected === 1 ? t('rules_reauth_one', [affected]) : t('rules_reauth_other', [affected]);
  reauthPrompt.removeAttribute('hidden');
  reauthPrompt.style.display = '';
}

reauthBtn.addEventListener('click', async () => {
  if (await host.permissions.request({ origins: reauthOrigins })) {
    reauthPrompt.style.display = 'none';
  }
});

// ── Add card collapse toggle ──

addCardToggle.addEventListener('click', () => {
  const open = addCard.classList.toggle('open');
  if (open) {
    addCardBody.removeAttribute('hidden');
  } else {
    addCardBody.setAttribute('hidden', '');
  }
});

// Clicks on the type-toggle buttons should toggle the card open (not close it)
// and switch the active tab, but not bubble up to close the card again.
document.querySelector('#type-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
});

// ── Type tabs ──

const tabBtns = { url: document.querySelector('#tab-url'), regex: document.querySelector('#tab-regex'), keyword: document.querySelector('#tab-keyword') };
const tabForms = { url: urlForm, regex: regexForm, keyword: keywordForm };

function selectTab(key) {
  for (const [k, btn] of Object.entries(tabBtns)) {
    btn.classList.toggle('active', k === key);
    btn.setAttribute('aria-selected', k === key ? 'true' : 'false');
  }
  for (const [k, form] of Object.entries(tabForms)) {
    if (k === key) form.removeAttribute('hidden');
    else form.setAttribute('hidden', '');
  }
  // Open the card when a tab is clicked
  if (!addCard.classList.contains('open')) {
    addCard.classList.add('open');
    addCardBody.removeAttribute('hidden');
  }
}

// Reactivating the already-open tab closes the form instead of no-op'ing —
// gives the tab buttons (already real, keyboard-operable <button>s) double duty
// as a toggle, rather than needing a separate always-focusable header wrapper.
function toggleOrSelectTab(key) {
  if (tabBtns[key].classList.contains('active') && addCard.classList.contains('open')) {
    addCard.classList.remove('open');
    addCardBody.setAttribute('hidden', '');
    return;
  }
  selectTab(key);
}

tabBtns.url.addEventListener('click', () => toggleOrSelectTab('url'));
tabBtns.regex.addEventListener('click', () => toggleOrSelectTab('regex'));
tabBtns.keyword.addEventListener('click', () => toggleOrSelectTab('keyword'));

// ── Apps and websites form: one rule over every app and site in its box ──

function parseTarget(raw) {
  const clean = raw.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/#.*$/, '');
  const slash = clean.indexOf('/');
  if (slash === -1) return { host: clean.toLowerCase(), path: '' };
  return { host: clean.slice(0, slash).toLowerCase(), path: clean.slice(slash + 1) };
}

function isValidHost(host) {
  return !!getDomain(host);
}

const UNIT_MAX = {
  minutes: { hour: 60,  day: 1440,  week: 10080 },
  hours:   {            day: 24,    week: 168   },
  days:    {                        week: 7     },
};

function constrainLimitForm(prefix = 'form', root = document) {
  const unitBtn    = root.querySelector(`.${prefix}-unit-btn`);
  const periodBtn  = root.querySelector(`.${prefix}-period-btn`);
  const limitInput = root.querySelector(`.${prefix}-limit`);
  const unit   = unitBtn.dataset.value;
  const period = periodBtn.dataset.value;

  const validPeriods = Object.keys(UNIT_MAX[unit] ?? {});
  root.querySelectorAll(`.${prefix}-period-menu button`).forEach(opt => {
    opt.disabled = !validPeriods.includes(opt.value);
  });
  root.querySelectorAll(`.${prefix}-unit-menu button`).forEach(opt => {
    opt.disabled = !(UNIT_MAX[opt.value] ?? {})[period];
  });

  if (!validPeriods.includes(period)) {
    const next = validPeriods[0];
    periodBtn.firstChild.textContent = root.querySelector(`.${prefix}-period-menu button[value="${next}"]`).textContent;
    periodBtn.dataset.value = next;
  }

  const effectivePeriod = periodBtn.dataset.value;
  const max = (UNIT_MAX[unit] ?? {})[effectivePeriod];
  if (max !== undefined) {
    limitInput.max = max;
    if (parseInt(limitInput.value) > max) limitInput.value = max;
  }
}

function formLimitFields() {
  return {
    limit:    parseInt(formLimit.value),
    limitUnit: document.querySelector('#form-unit-btn').dataset.value,
    period:   document.querySelector('#form-period-btn').dataset.value,
    mode:     document.querySelector('#form-mode-btn').dataset.value,
  };
}

const sourceOf = (m) => m.source ?? 'web';
const sameTarget = (a, b) => sourceOf(a) === sourceOf(b) && a.target === b.target;
const toMatcher = (c) => c.source === 'app'
  ? { matchType: 'exact', source: 'app', target: c.target, label: c.label }
  : { matchType: 'subdomain', target: c.target };

// The rule the form would save now. A typed name that only repeats the targets is not stored,
// so the rule keeps following its targets.
function draftRule() {
  const fields = formLimitFields();
  const name = ruleName.value.trim();
  const base = selected.length === 1 ? { ...selected[0], ...fields } : { matchers: selected, ...fields };
  const byTargets = matchLabel({ ...base, name: undefined });
  return name && name !== byTargets ? { ...base, name } : base;
}

function refreshPreview() {
  const refuse = (text) => {
    previewText.textContent = text;
    previewPattern.textContent = '';
    saveBtn.disabled = true;
  };
  ruleName.placeholder = selected.length ? matchLabel({ matchers: selected }) : t('rules_nameLabel');
  if (!selected.length) return refuse(t('rules_preview_chooseTarget'));

  const candidate = draftRule();
  const covering = findCoveringRule(currentRules, candidate);
  if (covering) {
    previewText.innerHTML = t('rules_preview_covering', [
      t(`period_${candidate.period}`),
      `<a href="#rule-${covering.id}" id="covering-link" class="link-btn">${escapeHtml(matchLabel(covering))}</a>`,
    ]);
    previewPattern.textContent = '';
    saveBtn.disabled = true;
    return;
  }

  const always = parseInt(formLimit.value) === 0;
  if (selected.length === 1) {
    const m = selected[0];
    const { text, value } = isWebMatcher(m) ? describeRule(m) : { text: matcherLabel(m), value: '' };
    previewText.textContent = always ? t('rules_preview_alwaysBlock', [text]) : t('rules_preview_willBlock', [text]);
    previewPattern.textContent = value;
  } else {
    const list = selected.map(matcherLabel).join(', ');
    previewText.textContent = always ? t('rules_preview_alwaysBlock', [list]) : t('rules_preview_willBlockMany', [list]);
    previewPattern.textContent = '';
  }
  saveBtn.disabled = false;
}

function iconHtml(m) {
  return m.target ? `<img class="site-favicon" src="${faviconUrl(m.target)}" alt="">` : '';
}

function hideBrokenIcons(root) {
  root.querySelectorAll('.site-favicon').forEach(img => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }));
}

function renderTargets() {
  targetsEmpty.hidden = selected.length > 0;
  targetsList.innerHTML = selected.map((m, i) => `<span class="target-chip">${iconHtml(m)}<span>${escapeHtml(matcherLabel(m))}</span><button type="button" class="icon-btn chip-remove" data-index="${i}" aria-label="${escapeHtml(t('rules_removeTarget', [matcherLabel(m)]))}">&times;</button></span>`).join('');
  hideBrokenIcons(targetsList);
  refreshPreview();
}

function setSelected(list) {
  selected = list;
  renderTargets();
  if (!picker.hidden) renderPicker();
}

// ── The picker: every app and site seen lately, most used first, plus any site typed in ──

// How far back rows name an app or site worth offering, and how many rows the list shows at once:
// 30 days and 50, both invented.
const SEEN_MS = 30 * 86_400_000;
const PICKER_MAX = 50;

async function loadCandidates() {
  const byKey = new Map();
  const put = (source, target, label, ms) => {
    const key = `${source}\n${target}`;
    const c = byKey.get(key) ?? { source, target, label: label ?? target, ms: 0 };
    if (label) c.label = label;
    c.ms += ms;
    byKey.set(key, c);
  };
  for (const [pkg, app] of await loadInstalledApps()) put('app', pkg, app.label, 0);
  try {
    for (const r of await coreCall('rows.since', { fromMs: Date.now() - SEEN_MS })) {
      if (r.kind === 'active' && r.domain) put(r.source ?? 'web', r.domain, null, r.to - r.from);
    }
  } catch {}
  return [...byKey.values()].sort((a, b) => b.ms - a.ms || a.label.localeCompare(b.label));
}

// The site typed in the search field, as a matcher under the chosen scope card, or null.
// A typed path picks the path card, as the form always did.
function typedSite() {
  const { host, path } = parseTarget(pickerSearch.value);
  if (!host || !isValidHost(host)) return null;
  if (path && scope !== 'pathPrefix') selectScope('pathPrefix');
  if (scope === 'pathPrefix' && !path) return null;
  return { matchType: scope, target: host, path: scope === 'pathPrefix' ? path : undefined };
}

function selectScope(next) {
  scope = next;
  scopeCards.forEach(c => c.classList.toggle('active', c.dataset.scope === next));
}

function refreshExamples(host, path) {
  document.querySelector('#ex-host').textContent = host;
  document.querySelector('#ex-subdomain').textContent = `*.${host}`;
  document.querySelector('#ex-page').textContent = path ? `${host}/${path}` : `${host}/…`;
}

function renderPicker() {
  const q = pickerSearch.value.trim().toLowerCase();
  // A typed address shows the scope cards; the add button takes the site under the chosen card.
  const { host, path } = parseTarget(pickerSearch.value);
  const typedHost = host && isValidHost(host);
  const typed = typedSite();
  const already = typed && selected.some(m => sameTarget(m, typed) && blockKey(m) === blockKey(typed));
  if (typedHost) focusSite = null;
  // The cards live in the add row; renderPicker may lend them to a list row below.
  scopeCardsHome.prepend(scopeCardsEl);
  pickerAddRow.hidden = !typedHost || already;
  if (typedHost) {
    refreshExamples(host, path);
    pickerAddBtn.hidden = !typed;
    if (typed) pickerAddBtn.textContent = t('rules_pickerAdd', [matcherLabel(typed)]);
    pickerAddHint.textContent = typed ? describeRule(typed).text : t('rules_preview_addPath');
  }

  // Chosen targets first, then the rest; a search narrows both.
  const hit = (label, target) => !q || label.toLowerCase().includes(q) || (target ?? '').toLowerCase().includes(q);
  const chosenRows = selected.filter(m => m.target && hit(matcherLabel(m), m.target)).map(m => ({ m, checked: true }));
  const restRows = candidates
    .filter(c => !selected.some(m => sameTarget(m, c)) && hit(c.label, c.target))
    .slice(0, PICKER_MAX)
    .map(c => ({ m: toMatcher(c), checked: false }));
  const rows = [...chosenRows, ...restRows];
  pickerEmpty.hidden = rows.length > 0 || !pickerAddRow.hidden;
  pickerList.innerHTML = rows.map(({ m, checked }, i) => `
    <li><label>
      <input type="checkbox" data-index="${i}"${checked ? ' checked' : ''}>
      ${iconHtml(m)}
      <span class="pick-name">${escapeHtml(matcherLabel(m))}</span>
      <span class="text-meta">${t(isWebMatcher(m) ? 'rules_kindSite' : 'rules_kindApp')}</span>
    </label></li>`).join('');
  hideBrokenIcons(pickerList);
  pickerList._rows = rows;

  const focused = focusSite ? rows.findIndex(r => r.checked && isWebMatcher(r.m) && r.m.target === focusSite) : -1;
  if (focused >= 0) {
    const m = rows[focused].m;
    const li = document.createElement('li');
    li.className = 'pick-scope';
    li.append(scopeCardsEl);
    pickerList.children[focused].after(li);
    refreshExamples(m.target, m.path);
    selectScope(m.matchType);
  }
}

function openPicker(open) {
  picker.hidden = !open;
  targetsEdit.setAttribute('aria-expanded', String(open));
  if (open) {
    renderPicker();
    pickerSearch.focus();
  }
}

function addTypedSite() {
  const typed = typedSite();
  if (!typed) return;
  // A site takes one scope: the typed one replaces any the site had.
  setSelected([...selected.filter(m => !sameTarget(m, typed)), typed]);
  pickerSearch.value = '';
  syncPickerClear();
  selectScope('subdomain');
  renderPicker();
  pickerSearch.focus();
}

// A chip's × removes that target; a click anywhere else in the box opens or closes the picker.
targetsBox.addEventListener('click', (e) => {
  const remove = e.target.closest('.chip-remove');
  if (!remove) return openPicker(picker.hidden);
  setSelected(selected.filter((_, i) => i !== Number(remove.dataset.index)));
  targetsEdit.focus();
});
document.querySelector('#picker-done').addEventListener('click', () => { openPicker(false); targetsEdit.focus(); });
picker.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.target.closest('.custom-dropdown')) { e.stopPropagation(); openPicker(false); targetsEdit.focus(); }
});
pickerList.addEventListener('change', (e) => {
  const row = pickerList._rows?.[Number(e.target.dataset.index)];
  if (!row) return;
  focusSite = e.target.checked && isWebMatcher(row.m) ? row.m.target : null;
  setSelected(e.target.checked ? [...selected, row.m] : selected.filter(m => !sameTarget(m, row.m)));
});
pickerAddBtn.addEventListener('click', addTypedSite);
pickerSearch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (!pickerAddRow.hidden) return addTypedSite();
  // Enter on a search picks the first match that is not chosen yet.
  const first = pickerList.querySelector('input:not(:checked)');
  if (first) { first.checked = true; first.dispatchEvent(new Event('change', { bubbles: true })); }
});
scopeCards.forEach(card => {
  card.addEventListener('click', () => {
    const next = card.dataset.scope;
    if (!focusSite) { selectScope(next); renderPicker(); return; }
    // A ticked site: host or whole site apply at once; a path needs typing, so the site moves to the search.
    if (next === 'pathPrefix') {
      pickerSearch.value = `${focusSite}/`;
      syncPickerClear();
      focusSite = null;
      selectScope('pathPrefix');
      renderPicker();
      pickerSearch.focus();
      return;
    }
    setSelected(selected.map(m => isWebMatcher(m) && m.target === focusSite ? { matchType: next, target: m.target } : m));
  });
  keyActivate(card);
});
const syncPickerClear = attachInputClear(pickerSearch, pickerSearchClearBtn, renderPicker, { escStopPropagation: true });
ruleName.addEventListener('input', refreshPreview);

previewText.addEventListener('click', (e) => {
  const link = e.target.closest('#covering-link');
  if (!link) return;
  e.preventDefault();
  const row = document.querySelector(link.getAttribute('href'));
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
});

// ── Sort ──

function sortedRules() {
  function sortKey(r) {
    return r.name || matchersOf(r).map(m => m.pattern ?? m.keyword ?? m.target + (m.path || '')).join(' ');
  }
  const cmp = sort.key === 'status'
    ? (a, b) => Number(b.enabled) - Number(a.enabled)
    : (a, b) => sortKey(a).localeCompare(sortKey(b));
  return [...currentRules].sort((a, b) => sort.dir * cmp(a, b));
}

function updateSortArrows() {
  for (const [key, btn] of [['site', sortSiteBtn], ['status', sortStatusBtn]]) {
    const isSorted = sort.key === key;
    btn.textContent = t(btn.dataset.label) + (isSorted ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');
    btn.classList.toggle('sorted', isSorted);
    btn.setAttribute('aria-sort', isSorted ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  }
}

function setSort(key) {
  if (sort.key === key) sort.dir *= -1;
  else sort = { key, dir: 1 };
  updateSortArrows();
  renderRuleList(rulesList, sortedRules(), { readonly: mockMode });
}

sortSiteBtn.addEventListener('click', () => setSort('site'));
sortStatusBtn.addEventListener('click', () => setSort('status'));
keyActivate(sortSiteBtn);
keyActivate(sortStatusBtn);

// ── Render rules list ──

async function render() {
  mockMode = await isMockMode();
  currentRules = mockMode ? mockRules() : await getRules();
  const empty = currentRules.length === 0;
  noRulesMsg.style.display = empty ? '' : 'none';
  updateSortArrows();
  renderRuleList(rulesList, sortedRules(), { readonly: mockMode });
  refreshPreview();
  renderStats();
  if (!mockMode) checkReauth();
}

// ── Save new rule ──

saveBtn.addEventListener('click', async () => {
  const fields = formLimitFields();
  if (!selected.length || isNaN(fields.limit) || fields.limit < 0) return;

  const newRule = draftRule();
  if (findCoveringRule(currentRules, newRule)) return;
  const redundant = findRedundantRules(currentRules, newRule);

  if (!await requestPermissionFor(newRule)) return;
  await addRule(newRule);

  ruleName.value = '';
  openPicker(false);
  setSelected([]);
  formLimit.value = '10';
  refreshPreview();
  await render();

  showRedundantPrompt(redundant);
});

function showRedundantPrompt(redundant) {
  if (!redundant.length) {
    redundantPrompt.style.display = 'none';
    return;
  }
  const n = redundant.length;
  redundantText.textContent = n === 1 ? t('rules_redundant_one', [n]) : t('rules_redundant_other', [n]);
  redundantList.innerHTML = redundant.map(r => `<li>${escapeHtml(matchLabel(r))}</li>`).join('');
  redundantDisableBtn.dataset.ids = redundant.map(r => r.id).join(',');
  redundantPrompt.removeAttribute('hidden');
  redundantPrompt.style.display = '';
}

redundantDisableBtn.addEventListener('click', async () => {
  const ids = redundantDisableBtn.dataset.ids.split(',');
  await disableRules(ids);
  redundantPrompt.style.display = 'none';
  render();
});

redundantKeepBtn.addEventListener('click', () => {
  redundantPrompt.style.display = 'none';
});

// ── Regex form logic ──

function regexLimitFields() {
  return {
    limit:     parseInt(document.querySelector('#regex-limit').value),
    limitUnit: document.querySelector('#regex-unit-btn').dataset.value,
    period:    document.querySelector('#regex-period-btn').dataset.value,
    mode:      document.querySelector('#regex-mode-btn').dataset.value,
  };
}

function refreshRegexPreview() {
  const pat = regexPatternInput.value.trim();
  if (!pat) {
    regexPreviewText.textContent = t('rules_regex_enterPattern');
    regexPreviewPat.textContent = '';
    regexSaveBtn.disabled = true;
    return;
  }
  try {
    new RegExp(pat);
  } catch (e) {
    regexPreviewText.textContent = t('rules_regex_invalid', [e.message]);
    regexPreviewPat.textContent = '';
    regexSaveBtn.disabled = true;
    return;
  }
  const always = parseInt(document.querySelector('#regex-limit').value) === 0;
  regexPreviewText.textContent = always ? t('rules_regex_alwaysBlock') : t('rules_regex_willBlock');
  regexPreviewPat.textContent = pat;
  regexSaveBtn.disabled = false;
}

const syncRegexClear = attachInputClear(regexPatternInput, regexPatternClear, refreshRegexPreview, { escStopPropagation: true });

document.querySelectorAll('#regex-unit-menu button, #regex-period-menu button').forEach(opt => {
  opt.addEventListener('click', () => { constrainLimitForm('regex'); refreshRegexPreview(); });
});
document.querySelectorAll('#regex-mode-menu button').forEach(opt => opt.addEventListener('click', refreshRegexPreview));
document.querySelector('#regex-limit').addEventListener('input', () => {
  const el = document.querySelector('#regex-limit');
  const max = parseInt(el.max);
  if (max && parseInt(el.value) > max) el.value = max;
  refreshRegexPreview();
});

regexSaveBtn.addEventListener('click', async () => {
  const pat = regexPatternInput.value.trim();
  if (!pat) return;
  try { new RegExp(pat); } catch { return; }
  const fields = regexLimitFields();
  if (isNaN(fields.limit) || fields.limit < 0) return;

  const newRule = { pattern: pat, matchType: 'regex', ...fields };
  if (!await requestPermissionFor(newRule)) return;
  await addRule(newRule);
  regexPatternInput.value = '';
  syncRegexClear();
  refreshRegexPreview();
  await render();
});

// ── Keyword form logic ──

function kwLimitFields() {
  return {
    limit:     parseInt(document.querySelector('#keyword-limit').value),
    limitUnit: document.querySelector('#kw-unit-btn').dataset.value,
    period:    document.querySelector('#kw-period-btn').dataset.value,
    mode:      document.querySelector('#kw-mode-btn').dataset.value,
  };
}

function refreshKwPreview() {
  const kw = kwInput.value.trim();
  if (!kw) {
    kwPreviewText.textContent = t('rules_kw_enterKeyword');
    kwSaveBtn.disabled = true;
    return;
  }
  const always = parseInt(document.querySelector('#keyword-limit').value) === 0;
  kwPreviewText.textContent = always ? t('rules_kw_alwaysBlock', [kw]) : t('rules_kw_willBlock', [kw]);
  kwSaveBtn.disabled = false;
}

const syncKwClear = attachInputClear(kwInput, kwInputClear, refreshKwPreview, { escStopPropagation: true });

document.querySelectorAll('#kw-unit-menu button, #kw-period-menu button').forEach(opt => {
  opt.addEventListener('click', () => { constrainLimitForm('kw'); refreshKwPreview(); });
});
document.querySelectorAll('#kw-mode-menu button').forEach(opt => opt.addEventListener('click', refreshKwPreview));
document.querySelector('#keyword-limit').addEventListener('input', () => {
  const el = document.querySelector('#keyword-limit');
  const max = parseInt(el.max);
  if (max && parseInt(el.value) > max) el.value = max;
  refreshKwPreview();
});

kwSaveBtn.addEventListener('click', async () => {
  const kw = kwInput.value.trim();
  if (!kw) return;
  const fields = kwLimitFields();
  if (isNaN(fields.limit) || fields.limit < 0) return;

  const newRule = { keyword: kw, matchType: 'keyword', ...fields };
  if (!await requestPermissionFor(newRule)) return;
  await addRule(newRule);
  kwInput.value = '';
  syncKwClear();
  refreshKwPreview();
  await render();
});

// ── Inline row editor ──

function editDropdown(id, options, selected) {
  const label = options.find(o => o.value === selected)?.label ?? selected;
  const items = options.map(o => `<button type="button" value="${o.value}">${o.label}</button>`).join('');
  return `
    <div class="custom-dropdown">
      <button type="button" class="dropdown-btn ${id}-btn" data-value="${selected}">${label}<span class="dropdown-arrow"><svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg></span></button>
      <div class="dropdown-menu ${id}-menu">${items}</div>
    </div>`;
}

const UNIT_OPTIONS   = [{ value: 'minutes', label: t('unit_minutes') }, { value: 'hours', label: t('unit_hours') }, { value: 'days', label: t('unit_days') }];
const PERIOD_OPTIONS = [{ value: 'hour', label: t('period_hour') }, { value: 'day', label: t('period_day') }, { value: 'week', label: t('period_week') }];

function openRowEditor(id) {
  const rule = currentRules.find(r => r.id === id);
  const li = document.querySelector(`#rule-${id}`);
  if (!rule || !li) return;
  li.querySelectorAll('.edit-btn, .toggle-btn, .delete-btn').forEach(b => b.remove());
  li.insertAdjacentHTML('beforeend', `
    <div class="form-row edit-controls">
      <input class="edit-limit number-input" type="number" value="${rule.limit}" min="0" aria-label="${t('rules_limitTo')}" />
      ${editDropdown('edit-unit', UNIT_OPTIONS, rule.limitUnit)}
      <span>per</span>
      ${editDropdown('edit-period', PERIOD_OPTIONS, rule.period)}
      <button class="save-edit-btn square-btn" data-id="${id}" aria-label="${t('rules_saveEdit')}">
        <span class="icon-mask icon-check"></span>
      </button>
      <button class="cancel-edit-btn square-btn" aria-label="${t('rules_cancelEdit')}">
        <span class="icon-mask icon-undo"></span>
      </button>
    </div>`);
  initCustomDropdowns(li);
  enhanceNumberInputEl(li.querySelector('.edit-limit'));
  constrainLimitForm('edit', li);
  if (rule.limit === 0) {
    li.querySelector('.edit-unit-btn').disabled = true;
    li.querySelector('.edit-period-btn').disabled = true;
  }
  li.querySelectorAll('.edit-unit-menu button, .edit-period-menu button').forEach(opt => {
    opt.addEventListener('click', () => constrainLimitForm('edit', li));
  });
  li.querySelector('.edit-limit').addEventListener('input', () => {
    const el = li.querySelector('.edit-limit');
    const max = parseInt(el.max);
    if (max && parseInt(el.value) > max) el.value = max;
    const always = parseInt(el.value) === 0;
    li.querySelector('.edit-unit-btn').disabled = always;
    li.querySelector('.edit-period-btn').disabled = always;
  });
  li.querySelector('.edit-limit').focus();
}

// render() fully replaces #rules-list's innerHTML, which drops whatever had
// focus (e.g. the toggle button just activated). Refocus the equivalent
// control on the same rule after render — falling back to the rule's edit
// button (e.g. after save/cancel, which revert to the normal row), or to the
// list itself if the rule no longer exists (e.g. after delete).
function focusRuleRow(ruleId, selector) {
  const target = document.querySelector(`#rule-${ruleId} ${selector}`)
    ?? document.querySelector(`#rule-${ruleId} .edit-btn`)
    ?? rulesList;
  target.focus();
}

rulesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.classList.contains('cancel-edit-btn')) {
    const ruleId = btn.closest('li')?.id.replace('rule-', '');
    await render();
    if (ruleId) focusRuleRow(ruleId, '.edit-btn');
    return;
  }
  if (btn.classList.contains('save-edit-btn')) {
    const id = btn.dataset.id;
    const limit = parseInt(rulesList.querySelector('.edit-limit').value);
    if (isNaN(limit) || limit < 0) return;
    await updateRule(id, {
      limit,
      limitUnit: rulesList.querySelector('.edit-unit-btn').dataset.value,
      period: rulesList.querySelector('.edit-period-btn').dataset.value,
    });
    await render();
    focusRuleRow(id, '.edit-btn');
    return;
  }

  const id = btn.dataset.id;
  if (!id) return;
  if (btn.classList.contains('edit-btn'))   { await render(); openRowEditor(id); return; }
  if (btn.classList.contains('toggle-btn')) await toggleRule(id);
  if (btn.classList.contains('delete-btn')) {
    const deleted = currentRules.find(r => r.id === id);
    await deleteRule(id);
    if (deleted) await releasePermissionFor(deleted, currentRules.filter(r => r.id !== id));
  }
  await render();
  focusRuleRow(id, '.toggle-btn');
});

// ── Stats + sparkline ──

// Returns the 7 calendar day keys ending today (oldest first).
function last7DayKeys() {
  const keys = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(localDayKey(d.getTime()));
  }
  return keys;
}

// Returns the week-start-through-today day keys for the current calendar week.
function thisWeekKeys() {
  const keys = [];
  const now = new Date();
  const dow = weekDow(now);
  for (let i = dow; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(localDayKey(d.getTime()));
  }
  return keys;
}

async function renderStats() {
  const blocksByDay = mockMode
    ? mockBlocksByDay()
    : (await host.prefs.get(BLOCKS_DAY_KEY))[BLOCKS_DAY_KEY] ?? {};
  const rules = currentRules;

  // Overview card
  const weekKeys = thisWeekKeys();
  let weekTotal = 0;
  const blocksByRuleKey = {};
  for (const dayKey of weekKeys) {
    const day = blocksByDay[dayKey] ?? {};
    for (const [key, count] of Object.entries(day)) {
      weekTotal += count;
      blocksByRuleKey[key] = (blocksByRuleKey[key] ?? 0) + count;
    }
  }

  const activeCount = rules.filter(r => r.enabled).length;

  // Most blocked: stable key with highest week count, resolved to its label
  let mostBlocked = '—';
  let topRule = null;
  if (Object.keys(blocksByRuleKey).length) {
    const topKey = Object.entries(blocksByRuleKey).sort((a, b) => b[1] - a[1])[0][0];
    topRule = rules.find(r => matchersOf(r).some(m => blockKey(m) === topKey)) ?? null;
    mostBlocked = topRule ? matchLabel(topRule) : '—';
  }

  const days7 = last7DayKeys();
  const dailyCounts = days7.map(k => Object.values(blocksByDay[k] ?? {}).reduce((s, n) => s + n, 0));
  const avgPerDay = dailyCounts.length
    ? Math.round(dailyCounts.reduce((s, n) => s + n, 0) / dailyCounts.length)
    : 0;

  document.querySelector('#stat-blocks').textContent = weekTotal;
  document.querySelector('#stat-most-blocked').textContent = mostBlocked;
  const topTarget = topRule && matchersOf(topRule).find(m => m.target)?.target;
  if (topTarget) {
    mostBlockedFavicon.src = faviconUrl(topTarget);
    mostBlockedFavicon.removeAttribute('hidden');
    mostBlockedFavicon.style.display = '';
  } else {
    mostBlockedFavicon.setAttribute('hidden', '');
  }
  const activeEl = document.querySelector('#stat-active');
  activeEl.innerHTML = rules.length
    ? `${activeCount}<span class="stat-sub"> ${t('rules_outOf', [rules.length])}</span>`
    : activeCount;
  document.querySelector('#stat-avg').textContent = avgPerDay;

  // Sparkline
  const DAY_LABELS = rotatedDayLabels();
  const rootStyle = getComputedStyle(document.documentElement);

  const sparkData = days7.map((k, i) => {
    const d = new Date(k + 'T12:00:00');
    const dow = weekDow(d);
    return {
      label: DAY_LABELS[dow],
      range: d.toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' }),
      count: dailyCounts[i],
    };
  });

  const hasData = dailyCounts.some(n => n > 0);
  document.querySelector('#spark-chart').style.display = hasData ? '' : 'none';
  document.querySelector('#spark-no-data').style.display = hasData ? 'none' : '';

  drawBarChart({
    svgEl: document.querySelector('#spark-chart'),
    tooltipEl: document.querySelector('#spark-tooltip'),
    data: sparkData,
    maxVal: Math.max(...dailyCounts, 1),
    getValue: d => d.count,
    formatVal: v => String(Math.round(v)),
    color: rootStyle.getPropertyValue('--color-accent').trim(),
  });
}

// ── Always-block checkboxes ──

function wireAlwaysBlock(cbId, limitInputEl, unitBtnId, periodBtnId, modeBtnId, refreshFn, constrainPrefix) {
  const cb = document.querySelector(`#${cbId}`);

  function setDisabled(on) {
    document.querySelector(`#${unitBtnId}`).disabled = on;
    document.querySelector(`#${periodBtnId}`).disabled = on;
    document.querySelector(`#${modeBtnId}`).disabled = on;
  }

  cb.addEventListener('change', () => {
    const on = cb.checked;
    if (on) {
      cb.dataset.prev = limitInputEl.value;
      limitInputEl.value = '0';
    } else {
      limitInputEl.value = cb.dataset.prev || '10';
    }
    setDisabled(on);
    constrainLimitForm(constrainPrefix);
    refreshFn();
  });

  limitInputEl.addEventListener('input', () => {
    const val = parseInt(limitInputEl.value);
    if (val === 0 && !cb.checked) {
      cb.checked = true;
      setDisabled(true);
      constrainLimitForm(constrainPrefix);
      refreshFn();
    } else if (!isNaN(val) && val > 0 && cb.checked) {
      cb.checked = false;
      setDisabled(false);
      constrainLimitForm(constrainPrefix);
      refreshFn();
    }
  });
}

// ── Init ──

// "Limit this site" opens the form with that site already in the box.
const prefillTarget = new URLSearchParams(location.search).get('target');
if (prefillTarget) {
  const { host, path } = parseTarget(prefillTarget);
  if (host && isValidHost(host)) setSelected([path ? { matchType: 'pathPrefix', target: host, path } : { matchType: 'subdomain', target: host }]);
  addCard.classList.add('open');
  addCardBody.removeAttribute('hidden');
  targetsEdit.focus();
}
loadCandidates().then(list => { candidates = list; if (!picker.hidden) renderPicker(); });

initCustomDropdowns();
constrainLimitForm();
constrainLimitForm('regex');
constrainLimitForm('kw');
wireAlwaysBlock('cb-always-url',   formLimit,                                'form-unit-btn',  'form-period-btn',  'form-mode-btn',  refreshPreview,      'form');
wireAlwaysBlock('cb-always-regex', document.querySelector('#regex-limit'),   'regex-unit-btn', 'regex-period-btn', 'regex-mode-btn', refreshRegexPreview, 'regex');
wireAlwaysBlock('cb-always-kw',    document.querySelector('#keyword-limit'), 'kw-unit-btn',    'kw-period-btn',    'kw-mode-btn',    refreshKwPreview,    'kw');

document.querySelectorAll('#form-unit-menu button, #form-period-menu button').forEach(opt => {
  opt.addEventListener('click', () => { constrainLimitForm(); refreshPreview(); });
});
document.querySelectorAll('#form-mode-menu button').forEach(opt => opt.addEventListener('click', refreshPreview));
formLimit.addEventListener('input', () => {
  const max = parseInt(formLimit.max);
  if (max && parseInt(formLimit.value) > max) formLimit.value = max;
  refreshPreview();
});

refreshPreview();
refreshRegexPreview();
refreshKwPreview();
await loadFaviconCache();
await render();
document.body.classList.remove('is-loading');

// ── Tour ──

function rulesTourSteps() { return [
  {
    selector: '#rules-grid',
    title: t('tour_rules_yourRules_title'),
    body: t('tour_rules_yourRules_body'),
  },
  {
    selector: '#add-card',
    title: t('tour_rules_addRule_title'),
    body: t('tour_rules_addRule_body'),
  },
  // At phone widths the next dashboard step shows here: its target is in the bottom nav.
  PHONE_WIDTH ? onwardStep('settings') : {
    selector: '#back-btn',
    title: t('tour_rules_back_title'),
    body: t('tour_rules_back_body', [BRAND_NAME]),
    handoff: { nextSurface: 'dashboard', nextStepIndex: 8, mode: 'crossDocument' },
  },
]; }

enhanceNumberInput('form-limit');
enhanceNumberInput('keyword-limit');
enhanceNumberInput('regex-limit');

autoStartIfMatches('rules', rulesTourSteps());