import { host } from './host.js';
import { coreCall, timeJson } from './core.js';
import { invalidate } from '../data/intervalAggregates.js';
import { SYNC_BASE_URL_DEFAULT } from './brand.js';

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

// A signed-out device (token revoked elsewhere, or account deleted) drops its keys and keeps
// its rows: only the recovery phrase can rejoin. Every caller funnels errors through here.
async function handleError(e) {
  const message = String(e?.message ?? e);
  if (message === 'NeedsReauth') await coreCall('forgetSession').catch(() => {});
  return message;
}

// One tick at a time per context: the lock is shared by every page and worker of the host, and a
// second caller skips instead of queueing, because a tick already running does the same work.
export async function runSync(now = Date.now()) {
  const result = await navigator.locks.request('reeflect-sync', { ifAvailable: true }, (lock) => lock && syncOnce(now));
  return result ?? { ...(await syncStatus()), skipped: 'already running' };
}

async function syncOnce(now) {
  const status = await coreCall('sync.run', { time: JSON.parse(await timeJson(now - 400 * DAY, now)) });
  if (status.lastReport?.pulled || status.lastReport?.deletedLocal) invalidate();
  return status;
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

/// Stops syncing for the whole account: the server wipes every row, key and device.
export function stopSyncingEverywhere() {
  return coreCall('requestDelete');
}
