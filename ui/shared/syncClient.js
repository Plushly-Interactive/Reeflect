import { host } from './host.js';
import { coreCall, timeJson } from './core.js';
import { invalidate } from '../data/intervalAggregates.js';
import { SYNC_BASE_URL_DEFAULT } from './brand.js';
import { t } from './i18n.js';
import { PREF_SYNC_APP_LABELS } from './prefKeys.js';

// Every account action, on every host: one command of the core each. The core keeps the sync
// status (`sync.run` stores its outcome), so the pages read it back from the same place.
export { SYNC_BASE_URL_DEFAULT };
const DAY = 86_400_000;

// off | on | signedOut — what the settings card and the sync page show.
export function syncState() {
  return coreCall('syncState');
}

export function syncStatus() {
  return coreCall('syncStatus');
}

// The status record as one sentence: the same words on the sync page and in the bar.
export function statusText(status) {
  if (!status) return t('sync_statusNever');
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // A pause is a wait, not a failure: say when it resumes and leave the cause out of it.
  if (status.lastError === 'Paused') return t('sync_statusPaused', [clock(status.retryAfter ?? Date.now())]);
  const m = status.pendingMerge;
  if (m && status.lastError) return t('sync_statusMergeStopped', [m.moved.toLocaleString(), m.total.toLocaleString(), status.lastError]);
  if (status.lastError) return t('sync_statusError', [status.lastError]);
  const r = status.lastReport;
  return r ? t('sync_statusOk', [new Date(status.lastRunAt).toLocaleString(), String(r.pushed), String(r.pulled)]) : t('sync_statusNever');
}

// A signed-out device (token revoked elsewhere, or account deleted) drops its keys and keeps
// its rows: only the recovery phrase can rejoin. Every caller funnels errors through here.
async function handleError(e) {
  const message = String(e?.message ?? e);
  if (message === 'NeedsReauth') await coreCall('forgetSession').catch(() => {});
  return message;
}

// The run belongs to the host: a page hands it over (`host.sync`) so navigating away changes
// nothing; the host runs one at a time and a second caller joins the run in flight. Whoever
// called drops its cached aggregates when rows arrived.
export async function runSync(now = Date.now()) {
  const status = host.sync ? await host.sync.call('runSync', { now }) : await runHere(now);
  if (status?.lastReport?.pulled || status?.lastReport?.deletedLocal) {
    invalidate();
    await saveAppLabels();
  }
  return status;
}

// `rows.labels` reads every row, so it runs after a sync that changed rows, not on every page load.

async function saveAppLabels() {
  try {
    const list = await coreCall('rows.labels');
    await host.prefs.set({ [PREF_SYNC_APP_LABELS]: Object.fromEntries(list.map((l) => [l.domain, l.label])) });
  } catch {}
}

let inFlight = null;
function runHere(now) {
  if (!inFlight) {
    inFlight = (async () => coreCall('sync.run', { time: JSON.parse(await timeJson(now - 400 * DAY, now)) }))().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/// Starts syncing: new keys, new account. Returns the 24-word phrase, shown once.
export function startSyncing() {
  return coreCall('register');
}

export async function linkDevice(phrase) {
  try {
    await coreCall('linkDevice', { phrase: phrase.trim().replace(/\s+/g, ' ').toLowerCase() });
  } catch (e) {
    throw new Error(await handleError(e));
  }
}

export function recoveryPhrase() {
  return coreCall('recoveryPhrase');
}

export async function devices() {
  try {
    const list = await coreCall('devices');
    await host.prefs.set({ _syncDeviceNames: Object.fromEntries(list.map((d) => [d.deviceId, { name: d.name, me: d.me, signedIn: d.signedIn }])) });
    return list;
  } catch (e) {
    throw new Error(await handleError(e));
  }
}

export function renameDevice(deviceId, name) {
  return coreCall('renameDevice', { deviceId, name });
}

export function signOutDevice(deviceId) {
  return coreCall('signOutDevice', { deviceId });
}

export function forgetDevice(deviceId) {
  return coreCall('forgetDevice', { deviceId });
}

// A reinstall that came back as a new device: its history moves under this one. A tick first, so
// the server holds nothing this device has not pulled.
export async function mergeDevice(deviceId) {
  try {
    if (host.sync) await host.sync.call('mergeDevice', { deviceId });
    else {
      await runSync();
      await coreCall('mergeDevice', { deviceId });
    }
  } catch (e) {
    throw new Error(await handleError(e));
  }
  invalidate();
}

/// Stops syncing for the whole account: the server wipes every row, key and device.
export function stopSyncingEverywhere() {
  return coreCall('requestDelete');
}
