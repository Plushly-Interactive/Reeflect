// The app's sync client: the same surface as ui/shared/syncClient.js, every account action one
// command of the native session. Status and device names rest in prefs exactly as in the extension.
import { host } from './host.js';
import { coreCall, timeJson } from './core.js';
import { invalidate } from '../data/intervalAggregates.js';

export const SYNC_BASE_URL_DEFAULT = 'https://sync.coralclock.com';
export const SYNC_STATUS_KEY = 'syncStatus';
const DAY = 86_400_000;

export function syncState() {
  return coreCall('syncState');
}

export function syncStatus() {
  return host.prefs.get(SYNC_STATUS_KEY).then((s) => s[SYNC_STATUS_KEY] ?? null);
}

async function handleError(e) {
  const message = String(e?.message ?? e);
  if (message === 'NeedsReauth') await coreCall('forgetSession').catch(() => {});
  return message;
}

export async function runSync(now = Date.now()) {
  if ((await syncState()) !== 'on') return { skipped: 'not syncing' };
  const previous = await syncStatus();
  if (previous?.retryAfter > now) return { ...previous, skipped: 'paused' };
  const status = { lastRunAt: now };
  try {
    const report = await coreCall('tick', { time: JSON.parse(await timeJson(now - 400 * DAY)) });
    if (report.pulled || report.deletedLocal) invalidate();
    status.lastReport = report;
  } catch (e) {
    status.lastError = await handleError(e);
    const paused = /^Paused: (\d+)$/.exec(status.lastError);
    if (paused) {
      status.lastError = 'Paused';
      status.retryAfter = now + Number(paused[1]) * 1000;
    }
  }
  await host.prefs.set({ [SYNC_STATUS_KEY]: status });
  return status;
}

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

export async function signOutDevice(deviceId) {
  await coreCall('signOutDevice', { deviceId });
  await host.prefs.remove(SYNC_STATUS_KEY);
}

export function forgetDevice(deviceId) {
  return coreCall('forgetDevice', { deviceId });
}

export async function stopSyncingEverywhere() {
  await coreCall('requestDelete');
  await host.prefs.remove(SYNC_STATUS_KEY);
}
