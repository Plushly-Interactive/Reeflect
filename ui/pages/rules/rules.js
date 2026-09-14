import { getRules, addRule, toggleRule, deleteRule, updateRule, renderRuleList, describeRule, findCoveringRule, findRedundantRules, disableRules, matchLabel, BLOCKS_DAY_KEY, blockKey } from '../../shared/rules.js';
import { initCustomDropdowns } from '../../shared/dropdown.js';
import { getDomain } from '../../vendor/tldts.js';
import { localDayKey } from '../../shared/timeUtils.js';
import { weekDow, rotatedDayLabels } from '../../shared/weekStart.js';
import { drawBarChart, loadFaviconCache, faviconUrl, attachInputClear, keyActivate, escapeHtml } from '../../shared/utils.js';
import { autoStartIfMatches } from '../../shared/tour.js';
import { isMockMode, mockRules, mockBlocksByDay } from '../../shared/tourMockData.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { enhanceNumberInput, enhanceNumberInputEl } from '../../shared/numberInput.js';
import { initI18n, applyI18n, t, getLocale } from '../../shared/i18n.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
document.title = `${t('rules_pageTitle')} - ${BRAND_NAME}`;
keyActivate(document.querySelector('#back-btn'), [' ']);

const formTarget          = document.querySelector('#form-target');
const formTargetClearBtn  = document.querySelector('#form-target-clear');
const cards          = [...document.querySelectorAll('.scope-card')];
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
const appsForm       = document.querySelector('#apps-form');

const regexPatternInput = document.querySelector('#regex-pattern');
const regexPatternClear = document.querySelector('#regex-pattern-clear');
const regexPreviewText  = document.querySelector('#regex-preview-text');
const regexPreviewPat   = document.querySelector('#regex-preview-pattern');
const regexSaveBtn      = document.querySelector('#regex-save-btn');

const kwInput      = document.querySelector('#keyword-input');
const kwInputClear = document.querySelector('#keyword-input-clear');
const kwPreviewText = document.querySelector('#kw-preview-text');
const kwSaveBtn    = document.querySelector('#kw-save-btn');

let scope = 'subdomain';
let currentRules = [];
let mockMode = false;  // tour: seeded rules shown read-only, never persisted
let sort = { key: 'site', dir: 1 };

// Origin patterns a rule needs host permission for. host/pathPrefix are exact
// (no subdomain access); subdomain requests both forms since match-pattern
// docs don't clearly state whether *.target already includes the bare apex.
// regex/keyword have no fixed host, so they fall back to <all_urls>.
function originsFor(rule) {
  if (rule.source === 'app') return [];
  if (rule.matchType === 'regex' || rule.matchType === 'keyword') return ['<all_urls>'];
  const exact = `*://${rule.target}/*`;
  if (rule.matchType === 'subdomain') return [exact, `*://*.${rule.target}/*`];
  return [exact];
}

// Request host permission for a candidate rule before it's saved. Must run
// inside the click handler (user gesture) — host.permissions.request()
// rejects outside one. Returns false (and leaves nothing saved) if declined.
async function requestPermissionFor(rule) {
  if (rule.source === 'app') return true;
  return host.permissions.request({ origins: originsFor(rule) });
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

const tabBtns = { url: document.querySelector('#tab-url'), regex: document.querySelector('#tab-regex'), keyword: document.querySelector('#tab-keyword'), apps: document.querySelector('#tab-apps') };
const tabForms = { url: urlForm, regex: regexForm, keyword: keywordForm, apps: appsForm };

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
tabBtns.apps.addEventListener('click', () => toggleOrSelectTab('apps'));

// ── URL form logic (carried over from previous rules.js) ──

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

function refreshExamples(host, path) {
  const h = host || formTarget.placeholder;
  document.querySelector('#ex-host').textContent = h;
  document.querySelector('#ex-subdomain').textContent = `*.${h}`;
  document.querySelector('#ex-page').textContent = path ? `${h}/${path}` : `${h}/…`;
}

function selectScope(next, { silent } = {}) {
  scope = next;
  cards.forEach(c => c.classList.toggle('active', c.dataset.scope === next));
  if (!silent) refreshPreview();
}

function refreshPreview() {
  const { host, path } = parseTarget(formTarget.value);
  if (path && scope !== 'pathPrefix') selectScope('pathPrefix', { silent: true });
  refreshExamples(host, path);

  if (!host) {
    previewText.textContent = t('rules_preview_enterSite');
    previewPattern.textContent = '';
    saveBtn.disabled = true;
    return;
  }
  if (!isValidHost(host)) {
    previewText.textContent = t('rules_preview_invalidHost', [host]);
    previewPattern.textContent = '';
    saveBtn.disabled = true;
    return;
  }
  if (scope === 'pathPrefix' && !path) {
    previewText.textContent = t('rules_preview_addPath');
    previewPattern.textContent = '';
    saveBtn.disabled = true;
    return;
  }
  const candidate = { target: host, path, matchType: scope, ...formLimitFields() };
  const covering = findCoveringRule(currentRules, candidate);
  if (covering) {
    previewText.innerHTML = t('rules_preview_covering', [
      t(`period_${candidate.period}`),
      `<a href="#rule-${covering.id}" id="covering-link" class="link-btn">${matchLabel(covering)}</a>`,
    ]);
    previewPattern.textContent = '';
    saveBtn.disabled = true;
    return;
  }

  const { text, value } = describeRule({ target: host, path, matchType: scope });
  const always = parseInt(formLimit.value) === 0;
  previewText.textContent = always ? t('rules_preview_alwaysBlock', [text]) : t('rules_preview_willBlock', [text]);
  previewPattern.textContent = value;
  saveBtn.disabled = false;
}

cards.forEach(card => { card.addEventListener('click', () => selectScope(card.dataset.scope)); keyActivate(card); });
const syncTargetClear = attachInputClear(formTarget, formTargetClearBtn, refreshPreview, { escStopPropagation: true });

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
    if (r.matchType === 'regex') return r.pattern;
    if (r.matchType === 'keyword') return r.keyword;
    return r.target + (r.path || '');
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
  const { host, path } = parseTarget(formTarget.value);
  const fields = formLimitFields();
  if (!host || isNaN(fields.limit) || fields.limit < 0 || !isValidHost(host)) return;
  if (scope === 'pathPrefix' && !path) return;

  const newRule = {
    target: host,
    path: scope === 'pathPrefix' ? path : undefined,
    matchType: scope,
    ...fields,
  };
  if (findCoveringRule(currentRules, newRule)) return;
  const redundant = findRedundantRules(currentRules, newRule);

  if (!await requestPermissionFor(newRule)) return;
  await addRule(newRule);

  formTarget.value = '';
  syncTargetClear();
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
  redundantList.innerHTML = redundant.map(r => `<li>${matchLabel(r)}</li>`).join('');
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

// ── App rules (Android): one installed app, matched by package ──

const appsBtn = document.querySelector('#apps-btn');
const appsMenu = document.querySelector('#apps-menu');
let installedApps = [];
tabBtns.apps.style.display = host.apps ? '' : 'none';
if (host.apps) {
  host.apps().then((apps) => {
    installedApps = apps;
    appsMenu.innerHTML = apps.length
      ? apps.map((a) => `<button type="button" value="${escapeHtml(a.package)}">${escapeHtml(a.label)}</button>`).join('')
      : `<button type="button" value="" disabled>${t('rules_appsNone')}</button>`;
    initCustomDropdowns(appsForm);
  });
}

document.querySelector('#apps-save-btn').addEventListener('click', async () => {
  const target = appsBtn.dataset.value;
  if (!target) return;
  const limit = parseInt(document.querySelector('#apps-limit').value);
  if (isNaN(limit) || limit < 0) return;
  const label = installedApps.find((a) => a.package === target)?.label ?? target;
  await addRule({
    matchType: 'exact', source: 'app', target, label, limit,
    limitUnit: document.querySelector('#apps-unit-btn').dataset.value,
    period: document.querySelector('#apps-period-btn').dataset.value,
    mode: 'active',
  });
  await render();
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
    topRule = rules.find(r => blockKey(r) === topKey) ?? null;
    mostBlocked = topRule ? matchLabel(topRule) : '—';
  }

  const days7 = last7DayKeys();
  const dailyCounts = days7.map(k => Object.values(blocksByDay[k] ?? {}).reduce((s, n) => s + n, 0));
  const avgPerDay = dailyCounts.length
    ? Math.round(dailyCounts.reduce((s, n) => s + n, 0) / dailyCounts.length)
    : 0;

  document.querySelector('#stat-blocks').textContent = weekTotal;
  document.querySelector('#stat-most-blocked').textContent = mostBlocked;
  if (topRule && topRule.matchType !== 'regex') {
    mostBlockedFavicon.src = faviconUrl(topRule.target);
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

const prefillTarget = new URLSearchParams(location.search).get('target');
if (prefillTarget) {
  formTarget.value = prefillTarget;
  syncTargetClear();
  // Open the add card if pre-filled from "Limit this site"
  addCard.classList.add('open');
  addCardBody.removeAttribute('hidden');
  formTarget.focus();
}

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
render();

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
  {
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