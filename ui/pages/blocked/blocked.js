import { RULE_MULTIPLIERS, blockedOriginalUrl, matchLabel, matchersOf, blockKey, isWebMatcher, BLOCKS_DAY_KEY } from '../../shared/rules.js';
import { loadFaviconCache } from '../../shared/utils.js';
import { resourceIconUrl, resolveFavicons } from '../../shared/labels.js';
import { formatMs, localDayKey } from '../../shared/timeUtils.js';
import { weekDow } from '../../shared/weekStart.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { coreCall, timeJson } from '../../shared/core.js';
import { buildTime } from '../../vendor/reeflect-core/time-from-date.mjs';
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

// Android and Windows: the page stands in for the app it blocks, so it lasts until the user leaves
// it. On Android "Close app" and Back (handled by the activity) go to the home screen, Home or
// Recents hide the page; on Windows "Close app" sends Reeflect to the tray. Either way it gives
// way to the dashboard for the next time Reeflect opens.
if (host.features.appShield) {
  const closeBtn = document.querySelector('#close-app-btn');
  closeBtn.removeAttribute('hidden');
  closeBtn.addEventListener('click', () => host.leaveShield());
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
  d.setDate(d.getDate() + 1); // 'day', and 'rolling7' until rollingRelease answers
  return d;
}

// A rolling window lifts at the first midnight where the core's verdict no longer holds the rule
// over. No future rows exist, so usage only falls as days leave the window: a binary search over
// the next 7 midnights needs 3 verdicts. Each verdict reads only the rows inside its window.
// A zero limit is always over: null. A time with a moved clock must carry the zone's offsets: on
// the apps the core fills them only when it reads the clock itself, and without them it counts UTC days.
async function rollingRelease(rule, time, now) {
  const base = new Date(now);
  const midnight = (k) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + k).getTime();
  const rules = [{ ...rule, enabled: true }];
  const zoned = buildTime(time.weekStart, now - 8 * 86400000, now);
  const over = async (k) => {
    const { overage } = await coreCall('verdict', { rules, time: { ...zoned, nowMs: midnight(k) } });
    return Boolean(overage[rule.id]);
  };
  let lo = 1, hi = 8;
  while (lo < hi) {
    const k = (lo + hi) >> 1;
    if (await over(k)) lo = k + 1; else hi = k;
  }
  return lo <= 7 ? midnight(lo) : null;
}

function formatCountdown(ms) {
  if (ms <= 0) return t('blocked_now');
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


// Whatever blocked the page puts its verdict's `overBy` and `visits` in the link, so the numbers
// show without a core call. Without them (an old link, a reload of one), the core measures: a
// zero-limit copy of the rule is always over, so its overBy is the usage and its visits are today's.
function ruleStats(rule, limitMs) {
  const now = Date.now();
  const timeReady = timeJson(now - 8 * 86400000, now).then(JSON.parse);
  const counted = params.has('overBy')
    ? Promise.resolve({ spent: limitMs + Number(params.get('overBy')), visits: Number(params.get('visits') ?? 0) })
    : timeReady.then(async (time) => {
      const { overage } = await coreCall('verdict', { rules: [{ ...rule, enabled: true, limit: 0 }], time });
      return { spent: overage[rule.id]?.overBy ?? 0, visits: overage[rule.id]?.visits ?? 0 };
    });
  const releaseAt = rule.period === 'rolling7'
    ? timeReady.then(time => rollingRelease(rule, time, now))
    : Promise.resolve(null);
  return { counted, releaseAt };
}

(async () => {
  if (!ruleId) return;
  const faviconsReady = loadFaviconCache();
  const { rules = [] } = await host.prefs.get('rules');
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  const limitMs = rule.limit * (RULE_MULTIPLIERS[rule.limitUnit] ?? 60000);
  const stats = ruleStats(rule, limitMs);
  const spentLabel = { hour: 'blocked_spentHour', day: 'blocked_spentToday', week: 'blocked_spentWeek', rolling7: 'blocked_spentRolling7' };
  document.querySelector('#stat-spent-label').textContent = t(spentLabel[rule.period]);
  stats.counted.then(({ spent, visits }) => {
    document.querySelector('#stat-spent').textContent = formatMs(spent) || '0m';
    document.querySelector('#stat-visits').textContent = String(visits);
  });
  await faviconsReady;

  const targetEl = document.querySelector('#target');
  // The icon of the target that blocked, else of the first target that has one.
  const matchers = matchersOf(rule);
  const blocker = matchers.find(m => blockKey(m) === params.get('blockKey'));
  const faviconMatcher = blocker?.target ? blocker : matchers.find(m => m.target) ?? null;
  let faviconHost = faviconMatcher?.target ?? null;
  if (!faviconHost) {
    const original = blockedOriginalUrl(location.href);
    try { faviconHost = new URL(original).hostname.replace(/^www\./, ''); } catch {}
  }
  if (faviconHost) {
    const faviconImg = document.createElement('img');
    faviconImg.className = 'site-favicon';
    faviconImg.src = resourceIconUrl([faviconHost], faviconMatcher ? !isWebMatcher(faviconMatcher) : undefined);
    faviconImg.alt = '';
    faviconImg.addEventListener('error', () => { faviconImg.style.display = 'none'; });
    targetEl.append(faviconImg);
    resolveFavicons(targetEl);
  }
  targetEl.append(matchLabel(rule));

  document.querySelector('#stat-limit').textContent = limitMs === 0 ? t('rules_limit_never') : t('blocked_limitPerPeriod', [formatMs(limitMs), t(`period_${rule.period}`)]);

  let resetDate = nextReset(rule.period);
  const cdEl = document.querySelector('#stat-countdown');
  function tick() { cdEl.textContent = formatCountdown(resetDate - Date.now()); }
  tick();
  setInterval(tick, 30000);

  stats.releaseAt.then(at => { if (at) { resetDate = new Date(at); tick(); } });
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
