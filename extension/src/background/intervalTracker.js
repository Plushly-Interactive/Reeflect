import { siteIdFromUrl, pathFromUrl } from './siteResolution.js';
import { createTrackingModule } from './intervalTrackingUtils.js';
import { getIdleThresholdSec, DEFAULT_IDLE_THRESHOLD_SEC } from '../shared/idleConfig.js';
import { PREF_IDLE_THRESHOLD_SEC } from '../shared/prefKeys.js';

// Domain+path capture: keys presence on `${domain}\n${path}` so capture is at
// domain+path granularity, writing one interval row per (domain, path, kind)
// range. Own snapshot key.
const KEY_SEP = '\n';

function makeKey(siteId, path) {
  return `${siteId}${KEY_SEP}${path}`;
}

function urlToKey(url) {
  const siteId = siteIdFromUrl(url);
  const path = pathFromUrl(url);
  return siteId && path ? makeKey(siteId, path) : null;
}

const mod = createTrackingModule({ urlToKey, snapshotStorageKey: '_intervalSnapshot' });

function setWindowPath(windowId, siteId, path) {
  mod.setWindow(windowId, siteId && path ? makeKey(siteId, path) : null);
}
function removeWindowPath(windowId, minimized = false) {
  mod.removeWindow(windowId, minimized);
}
function addAudibleTabPath(tabId, siteId, path, countVisit = true) {
  if (!siteId || !path) return;
  mod.addAudibleTab(tabId, makeKey(siteId, path), countVisit);
}
function removeAudibleTabPath(tabId) {
  mod.removeAudibleTab(tabId);
}
const initTracking = mod.init;
const reconcileWindows = mod.reconcile;
const saveSnapshot = mod.saveSnapshot;
const recoverFromSnapshot = mod.recoverFromSnapshot;
const applyIdleClip = mod.applyIdleClip;
// Raw per-navigation drain (write the pending ranges only), exported for
// background's pre-emptive block.
export const flushToStorage = mod.flushToStorage;

// The sole live tracker. Self-registers its capture listeners (tab/window/SPA
// navigation), bootstrap, and idle handling on import. Its periodic flush is
// exported as flushNow() and driven by background.js's single 'flush' alarm, so
// the flush and the enforcement check that reads its output run in one sequence.

let bootstrapAt;
let coldStart = false;
let idleStartedAt = null;
let cachedIdleThresholdMs = DEFAULT_IDLE_THRESHOLD_SEC * 1000;

const bootstrapDone = bootstrap();

chrome.runtime.onStartup.addListener(() => {
  coldStart = true;
  chrome.storage.local.remove('_intervalSnapshot');
});

async function bootstrap() {
  bootstrapAt = Date.now();
  await initTracking();
  await seedIdleState();
}

async function seedIdleState() {
  const sec = await getIdleThresholdSec();
  cachedIdleThresholdMs = sec * 1000;
  chrome.idle.setDetectionInterval(sec);
  const state = await chrome.idle.queryState(sec);
  if (state === 'idle' || state === 'locked') idleStartedAt = Date.now() - cachedIdleThresholdMs;
}

// --- tab / window events (same signals background.js feeds the subpage tracker) ---

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await bootstrapDone;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active) return;
  setWindowPath(tab.windowId, siteIdFromUrl(tab.url), pathFromUrl(tab.url));
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  await bootstrapDone;
  if (changeInfo.status === 'complete' && tab.active) {
    setWindowPath(tab.windowId, siteIdFromUrl(tab.url), pathFromUrl(tab.url));
  }
  if (changeInfo.status === 'complete' || 'audible' in changeInfo) {
    if (tab.audible && !tab.mutedInfo?.muted) addAudibleTabPath(tab.id, siteIdFromUrl(tab.url), pathFromUrl(tab.url));
    else removeAudibleTabPath(tab.id);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await bootstrapDone;
  removeAudibleTabPath(tabId);
});

chrome.windows.onCreated.addListener(async (window) => {
  await bootstrapDone;
  if (window.state === 'minimized') return;
  const [tab] = await chrome.tabs.query({ windowId: window.id, active: true });
  setWindowPath(window.id, siteIdFromUrl(tab?.url), pathFromUrl(tab?.url));
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  await bootstrapDone;
  removeWindowPath(windowId);
});

// SPA navigation — path changes without a full load (domain unchanged).
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  await bootstrapDone;
  if (details.frameId !== 0) return;
  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab) return;
  const siteId = siteIdFromUrl(details.url);
  const path = pathFromUrl(details.url);
  if (tab.active) setWindowPath(tab.windowId, siteId, path);
  if (tab.audible && !tab.mutedInfo?.muted) addAudibleTabPath(tab.id, siteId, path);
});

// --- flush (driven by background.js's 'flush' alarm) ---

export async function flushNow() {
  await bootstrapDone;
  if (coldStart) {
    await chrome.storage.local.remove('_intervalSnapshot');
    coldStart = false;
  }
  await recoverFromSnapshot(bootstrapAt, idleStartedAt);
  await reconcileWindows();
  const flushAt = Date.now();
  if (idleStartedAt !== null) applyIdleClip(idleStartedAt, flushAt);
  await flushToStorage(flushAt);
  await saveSnapshot(flushAt);
}

// --- idle ---

chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'idle' || state === 'locked') {
    if (idleStartedAt === null) idleStartedAt = Date.now() - cachedIdleThresholdMs;
  } else {
    if (idleStartedAt !== null) applyIdleClip(idleStartedAt, Date.now());
    idleStartedAt = null;
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes[PREF_IDLE_THRESHOLD_SEC]) return;
  const sec = await getIdleThresholdSec();
  cachedIdleThresholdMs = sec * 1000;
  chrome.idle.setDetectionInterval(sec);
});
