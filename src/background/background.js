import { localDayKey, localHourKey } from '../shared/timeUtils.js';
import { weekDow } from '../shared/weekStart.js';
import { PREF_BADGE_ENABLED } from '../shared/prefKeys.js';
import { siteIdFromUrl } from './siteResolution.js';
import { computeOverage, publishOverage } from './enforcement.js';
import { intervalsSince } from '../data/intervalLog.js';
import { loadCore, timeJson } from '../shared/core.js';
import { windowStartMs } from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { dbg, initDebug } from './trackingDebug.js';
import { updateBadge } from './badge.js';
import { initI18n, t } from '../shared/i18n.js';
import { getQuotaUsage, QUOTA_WARN_PCT } from '../shared/utils.js';
import { seedChangelogOnInstall, seedChangelogOnUpdate } from '../shared/changelog.js';
// The interval tracker is the sole live capturer. It self-registers its capture
// listeners on import; background drives its periodic flush via flushNow() and a
// lighter per-navigation drain via flushToStorage.
import { flushNow, flushToStorage as drainIntervals } from './intervalTracker.js';
import { tick as syncTick, ensureSyncAlarm, SYNC_ALARM } from './sync.js';

// Logged on every service-worker (re)start. A burst of these is the signal that
// the worker is churning (MV3 idle-suspend, crash-on-load, or dev reload), which
// can desync in-memory tracking state from live tabs. Unconditional (not gated
// on _debug): it runs at module load before initDebug() reads the flag, and it
// carries no URL/sensitive data — just a timestamp.
console.log(`[BG-DBG ${new Date().toISOString()}] SERVICE WORKER STARTED`);

// Service workers disallow top-level await, so kick this off and await it inside
// the notification functions instead, right before they call t().
const i18nReady = initI18n();
const DAY = 86_400_000;

function approachWindowKey(period, now) {
  if (period === 'hour') return localHourKey(now);
  if (period === 'week') {
    const dow = weekDow(new Date(now));
    const base = new Date(now);
    base.setDate(base.getDate() - dow);
    return localDayKey(base.getTime());
  }
  return localDayKey(now);
}

const PERIOD_ADJ_KEY = { hour: 'bg_periodHourly', day: 'bg_periodDaily', week: 'bg_periodWeekly' };
const UNIT_KEY = { minutes: 'unit_minutes', hours: 'unit_hours', days: 'unit_days' };

function fmtMs(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(ms / 3600000);
  const rem = Math.round((ms % 3600000) / 60000);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// Notification dedup state. Loaded once from chrome.storage.local into a
// cached Promise so concurrent checkEnforcement calls (e.g. rapid navigations
// or redirect chains) share the same in-memory object and never read stale
// storage. Persisted back so state survives MV3 SW restarts *and* browser
// restarts — an already-blocked rule (esp. limit-0 always-block) must not
// re-notify on startup. The prune loop below re-arms the notification once a
// rule leaves overage (period rollover), so this only suppresses re-notifying
// the same still-blocked rule.
let _notifyStateP = null;

function getNotifyState() {
  if (!_notifyStateP) {
    _notifyStateP = chrome.storage.local.get('_notifyState').then(({ _notifyState: s }) => ({
      blocked: new Set(s?.blocked ?? []),
      approaching: new Map(Object.entries(s?.approaching ?? {})),
      quotaWarnedDay: s?.quotaWarnedDay ?? null,
    }));
  }
  return _notifyStateP;
}

function persistNotifyState(state) {
  chrome.storage.local.set({
    _notifyState: {
      blocked: [...state.blocked],
      approaching: Object.fromEntries(state.approaching),
      quotaWarnedDay: state.quotaWarnedDay,
    },
  });
}

async function notifyBlocked(overage, blockedSites) {
  await i18nReady;
  const state = await getNotifyState();
  for (const ruleId of state.blocked) {
    if (!overage.has(ruleId)) state.blocked.delete(ruleId);
  }
  let changed = false;
  for (const [ruleId, entry] of overage) {
    if (state.blocked.has(ruleId)) continue;
    state.blocked.add(ruleId);
    changed = true;
    // Only toast when the block hit a currently-open tab. A rule crossing (or an
    // always-block rule created) with no matching tab open is recorded for dedup
    // but shows no toast — nothing visible was blocked.
    if (!blockedSites.has(ruleId)) continue;
    const label = blockedSites.get(ruleId) ?? entry.target ?? t('bg_aSite');
    chrome.notifications.create(`blocked-${ruleId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('resources/icons/brand/icon128.png'),
      title: t('bg_notifyBlockedTitle'),
      message: t('bg_notifyBlockedMessage', [label]),
    });
  }
  if (changed) persistNotifyState(state);
}

async function notifyApproaching(approaching, now) {
  await i18nReady;
  const state = await getNotifyState();
  let changed = false;
  for (const [ruleId, entry] of approaching) {
    const windowKey = approachWindowKey(entry.period, now);
    if (state.approaching.get(ruleId) === windowKey) continue;
    state.approaching.set(ruleId, windowKey);
    changed = true;
    const label = entry.target ?? entry.keyword ?? entry.pattern ?? t('bg_aSite');
    const pct = Math.round(entry.pct * 100);
    const left = fmtMs(entry.remainingMs);
    const unit = t(UNIT_KEY[entry.limitUnit] ?? entry.limitUnit);
    const periodAdj = t(PERIOD_ADJ_KEY[entry.period] ?? entry.period);
    chrome.notifications.create(`approach-${ruleId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('resources/icons/brand/icon128.png'),
      title: t('bg_notifyApproachingTitle'),
      message: t('bg_notifyApproachingMessage', [label, pct, entry.limit, unit, periodAdj, left]),
    });
  }
  if (changed) persistNotifyState(state);
}

// Re-notify once per calendar day while usage stays at/above the threshold;
// clears once it drops back below so a same-day dip and re-cross still notifies.
async function notifyQuotaWarn(pct, now) {
  await i18nReady;
  const state = await getNotifyState();
  if (pct < QUOTA_WARN_PCT) {
    if (state.quotaWarnedDay === null) return;
    state.quotaWarnedDay = null;
    persistNotifyState(state);
    return;
  }
  const today = localDayKey(now);
  if (state.quotaWarnedDay === today) return;
  state.quotaWarnedDay = today;
  persistNotifyState(state);
  chrome.notifications.create('quota-warn', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('resources/icons/brand/icon128.png'),
    title: t('bg_notifyQuotaTitle'),
    message: t('bg_notifyQuotaMessage', [Math.floor(pct)]),
  });
}

async function checkQuota(now) {
  const { pct } = await getQuotaUsage();
  await notifyQuotaWarn(pct, now);
}

chrome.alarms.get('flush').then(existing => {
  if (!existing) chrome.alarms.create('flush', { periodInMinutes: 1 });
});
ensureSyncAlarm();
// Cutover left the old scalar interval-flush alarm orphaned on installed
// instances; clear it once so only the single 'flush' alarm fires.
chrome.alarms.clear('intervalFlush');
const bootstrapDone = bootstrap();
bootstrapDone.then(() => { updateBadge(); checkQuota(Date.now()); });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') {
    seedChangelogOnUpdate(details.previousVersion);
    return;
  }
  if (details.reason !== 'install') return;
  seedChangelogOnInstall();
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/pages/dashboard/dashboard.html?tour=1'),
  });
});

// Capture init lives in the interval tracker now; background's bootstrap only
// readies debug logging before its listeners run.
async function bootstrap() {
  await initDebug();
  dbg('bootstrap: done');
}

// --- Tab / window events ---

chrome.tabs.onActivated.addListener(async () => {
  await bootstrapDone;
  updateBadge();
});

async function cacheFavicon(hostname, url) {
  if (!url || !url.startsWith('http')) return;
  const { faviconCache = {} } = await chrome.storage.local.get('faviconCache');
  if (faviconCache[hostname]?.url === url) return;
  // Cross-origin fetch needs host permission for this site, which since the
  // <all_urls> → per-rule permission change we generally don't have unless the
  // user set a rule for it. Skip rather than let it fail noisily with a CORS
  // error; faviconUrl() already falls back to the permission-free _favicon/
  // endpoint for everything not cached here.
  if (!await chrome.permissions.contains({ origins: [`*://${hostname}/*`] })) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const type = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    faviconCache[hostname] = { url, dataUrl: `data:${type};base64,${btoa(binary)}` };
    await chrome.storage.local.set({ faviconCache });
  } catch { /* ignore network errors */ }
}

// Favicon caching and the badge live here; all usage capture (active/audio/idle)
// is the interval tracker's own onUpdated listener.
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  await bootstrapDone;
  if (changeInfo.favIconUrl) {
    const hostname = siteIdFromUrl(tab.url);
    if (hostname) cacheFavicon(hostname, changeInfo.favIconUrl);
  }
  if (changeInfo.status === 'complete' && tab.active) updateBadge();
});

chrome.windows.onFocusChanged.addListener(async (_windowId) => {
  await bootstrapDone;
  updateBadge();
});

// --- Flush alarm ---

// One alarm drives the interval tracker's flush, then the enforcement check that
// reads its freshly-written rows, then the badge — in sequence, so enforcement
// never reads pre-flush usage.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) { await bootstrapDone; await flushNow(); await syncTick(); return; }
  if (alarm.name !== 'flush') return;
  await bootstrapDone;
  const now = Date.now();
  await flushNow();
  await checkEnforcement(now);
  await checkQuota(now);
  updateBadge();
});

// React to rule edits immediately (enable/disable/add/delete) rather than
// waiting for the next flush — so disabling unblocks and enabling an
// already-crossed rule blocks right away.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.rules) return;
  await bootstrapDone;
  await checkEnforcement(Date.now());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(PREF_BADGE_ENABLED in changes)) return;
  updateBadge();
});

// Compute which rules are over their limit and publish DNR redirect rules so
// over-limit sites are blocked until the period window rolls over. The rows that can reach
// into any rule's window go to the core, which aggregates them and returns the verdict.
async function checkEnforcement(now) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  // The core says how far back any enabled rule reaches, from the same window it will score, so
  // the rows read here can never fall short of what it would count. No window reaches past a week
  // plus a zone change, so the Time snapshot spans eight days.
  await loadCore();
  const windowStart = windowStartMs(JSON.stringify(rules), await timeJson(now - 8 * DAY, now));
  const rows = await intervalsSince(windowStart);

  const { overage, approaching } = await computeOverage(rules, rows, windowStart, now);
  dbg('checkEnforcement: rules', rules.map(r => ({ id: r.id, enabled: r.enabled, matchType: r.matchType, target: r.target, limit: r.limit, limitUnit: r.limitUnit, period: r.period })));
  dbg('checkEnforcement: overage', [...overage.entries()]);
  const blockedSites = await publishOverage(overage);
  await notifyBlocked(overage, blockedSites);
  await notifyApproaching(approaching, now);
}

// Pre-emptive block: on a main-frame navigation, drain the interval tracker's
// accrued ranges to the log and re-check limits *before* relying on the next flush
// tick. drainIntervals writes the pending in-memory ranges up to `now`, so the
// check (which reads the log) sees usage as current as this instant — catching a
// crossing since the last flush. The freshly-published DNR rule plus
// reloadMatchingTabs then block the site without waiting for the flush alarm.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  if (!details.url?.startsWith('http')) return;
  await bootstrapDone;
  const now = Date.now();
  await drainIntervals(now);
  await checkEnforcement(now);
});
