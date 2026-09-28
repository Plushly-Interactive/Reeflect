import { RULE_MULTIPLIERS, matchLabel, matchersOf, blockKey, computeRuleSpent, computeRuleVisits, BLOCKS_DAY_KEY } from '../../shared/rules.js';
import { faviconUrl, loadFaviconCache } from '../../shared/utils.js';
import { formatMs, localDayKey } from '../../shared/timeUtils.js';
import { weekDow } from '../../shared/weekStart.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { coreCall, timeJson } from '../../shared/core.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();

document.querySelector('#logo').src =
  host.assetUrl('resources/icons/brand/logo.svg');

const params = new URLSearchParams(location.search);
const ruleId = params.get('rule');
const site = params.get('site');
const path = params.get('path');

const target = site && path ? `${site}/${path}` : site;
if (target) document.title = t('blocked_titlePrefix', [target, BRAND_NAME]);

// Android: the page stands in for the app it blocks, so it lasts until the user leaves it. "Close
// app" and Back (handled by the activity) go to the home screen; Home or Recents hide the page.
// Either way it gives way to the dashboard for the next time Reeflect opens.
if (host.features.appShield) {
  const closeBtn = document.querySelector('#close-app-btn');
  closeBtn.removeAttribute('hidden');
  closeBtn.addEventListener('click', () => host.tracker.leave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') location.replace('../dashboard/dashboard.html');
  });
}

// Count a block only when this page is actually landed on (fresh redirect or
// tab-update), not when it's merely reloaded — so refreshing an already-shown
// blocked page doesn't inflate the stat.
(async () => {
  const key = params.get('blockKey');
  const navType = performance.getEntriesByType('navigation')[0]?.type;
  if (!key || navType === 'reload') return;
  const dayKey = localDayKey(Date.now());
  const { [BLOCKS_DAY_KEY]: blocksByDay = {} } = await host.prefs.get(BLOCKS_DAY_KEY);
  const today = blocksByDay[dayKey] ?? {};
  today[key] = (today[key] ?? 0) + 1;
  blocksByDay[dayKey] = today;
  await host.prefs.set({ [BLOCKS_DAY_KEY]: blocksByDay });
})();

// When the rule's period window next resets, in local time.
function nextReset(period, now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  if (period === 'hour') {
    d.setHours(d.getHours() + 1);
    return d;
  }
  d.setHours(0);
  if (period === 'week') {
    const daysUntilNextWeekStart = 7 - weekDow(now);
    d.setDate(d.getDate() + daysUntilNextWeekStart);
    return d;
  }
  d.setDate(d.getDate() + 1); // 'day'
  return d;
}

function formatCountdown(ms) {
  if (ms <= 0) return t('blocked_now');
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


// The page needs today for one rule, so the core builds over the rows since yesterday's midnight,
// not the full history the dashboard reads (2.6 s at 111K rows). With yesterday's rows, a visit
// that runs past midnight stays one visit, counted on the day it started, as on the dashboard.
async function todayStores() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 1);
  const rows = await coreCall('rows.since', { fromMs: from.getTime() });
  await coreCall('dashboard.build', { rows, deviceIds: null, time: JSON.parse(await timeJson(from.getTime())) });
  const day = localDayKey(Date.now());
  const [sitesByDay, subpagesByDay] = await Promise.all([
    coreCall('dashboard.part', { name: 'sitesByDay', day }),
    coreCall('dashboard.part', { name: 'subpagesByDay', day }),
  ]);
  return { sitesByDay, subpagesByDay };
}

(async () => {
  if (!ruleId) return;
  const storesPromise = todayStores();
  const [{ rules = [] }] = await Promise.all([host.prefs.get('rules'), loadFaviconCache()]);
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  const targetEl = document.querySelector('#target');
  // The icon of the target that blocked, else of the first target that has one.
  const matchers = matchersOf(rule);
  const blocker = matchers.find(m => blockKey(m) === params.get('blockKey'));
  let faviconHost = blocker?.target ?? matchers.find(m => m.target)?.target ?? null;
  if (!faviconHost) {
    const original = params.get('url');
    try { faviconHost = new URL(original).hostname.replace(/^www\./, ''); } catch {}
  }
  if (faviconHost) {
    const faviconImg = document.createElement('img');
    faviconImg.className = 'site-favicon';
    faviconImg.src = faviconUrl(faviconHost);
    faviconImg.alt = '';
    faviconImg.addEventListener('error', () => { faviconImg.style.display = 'none'; });
    targetEl.append(faviconImg);
  }
  targetEl.append(matchLabel(rule));

  const limitMs = rule.limit * (RULE_MULTIPLIERS[rule.limitUnit] ?? 60000);
  document.querySelector('#stat-limit').textContent = limitMs === 0 ? t('rules_limit_never') : t('blocked_limitPerPeriod', [formatMs(limitMs), t(`period_${rule.period}`)]);

  const resetDate = nextReset(rule.period);
  const cdEl = document.querySelector('#stat-countdown');
  function tick() { cdEl.textContent = formatCountdown(resetDate - Date.now()); }
  tick();
  setInterval(tick, 30000);

  const stores = await storesPromise;
  const dayKey = localDayKey(Date.now());
  const activeMs = computeRuleSpent(rule, dayKey, stores);
  const visits = computeRuleVisits(rule, dayKey, stores);
  document.querySelector('#stat-spent').textContent = formatMs(activeMs) || '0m';
  document.querySelector('#stat-visits').textContent = String(visits);
})();

import { pickQuote } from '../../shared/quotes.js';
import { QUOTES } from '../../shared/quotes.data.js';
import { PREF_FAVORITE_QUOTE_IDS, PREF_QUOTES_ENABLED } from '../../shared/prefKeys.js';

(async () => {
  const { [PREF_QUOTES_ENABLED]: quotesEnabled = false } = await host.prefs.get(PREF_QUOTES_ENABLED);
  if (!quotesEnabled) return;

  const quoteId = params.get('quoteId');
  const q = quoteId
    ? (QUOTES.find(q => q.id === quoteId) ?? await pickQuote(site ?? ''))
    : await pickQuote(site ?? '');
  if (!q) return;
  const quoteEl = document.querySelector('#quote');

  // Render quote text with source link
  const textEl = document.querySelector('#quote-text');
  textEl.textContent = `"${q.text}"`;
  if (q.source) {
    const sourceLink = document.createElement('a');
    sourceLink.className = 'link-btn';
    sourceLink.tabIndex = 0;
    sourceLink.textContent = ' ↗';
    sourceLink.href = q.source;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    textEl.appendChild(sourceLink);
  }

  // Render author line with optional philosophy link
  if (q.author) {
    const wrapperEl = document.querySelector('#quote-author-wrapper');
    const authorSpan = document.createElement('span');
    authorSpan.textContent = `— ${q.author}`;
    wrapperEl.appendChild(authorSpan);

    if (q.philosophySource) {
      const discoverLink = document.createElement('a');
      discoverLink.className = 'link-btn';
      discoverLink.tabIndex = 0;
      discoverLink.textContent = ' ' + t('blocked_discoverLink');
      discoverLink.href = q.philosophySource;
      discoverLink.target = '_blank';
      discoverLink.rel = 'noopener noreferrer';
      wrapperEl.appendChild(discoverLink);
    }
  }

  quoteEl.removeAttribute('hidden');

  const actionsEl = document.querySelector('#quote-actions');
  const favBtn = document.querySelector('#fav-btn');
  const { [PREF_FAVORITE_QUOTE_IDS]: favIds = [] } = await host.prefs.get(PREF_FAVORITE_QUOTE_IDS);
  if (favIds.includes(q.id)) favBtn.classList.add('favorited');
  favBtn.setAttribute('aria-label', t(favBtn.classList.contains('favorited') ? 'blocked_unfavoriteQuote' : 'blocked_favoriteQuote'));
  actionsEl.removeAttribute('hidden');

  favBtn.addEventListener('click', async () => {
    const { [PREF_FAVORITE_QUOTE_IDS]: current = [] } = await host.prefs.get(PREF_FAVORITE_QUOTE_IDS);
    const isFav = current.includes(q.id);
    const updated = isFav ? current.filter(id => id !== q.id) : [...current, q.id];
    await host.prefs.set({ [PREF_FAVORITE_QUOTE_IDS]: updated });
    favBtn.classList.toggle('favorited', !isFav);
    favBtn.setAttribute('aria-label', t(isFav ? 'blocked_favoriteQuote' : 'blocked_unfavoriteQuote'));
  });
})();
