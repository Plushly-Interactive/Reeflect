import { runSync, syncState } from '../shared/syncClient.js';
import { deviceId, appendIntervals, count, deleteByDomain } from '../data/intervalLog.js';
import { db } from '../data/intervalLog.js';
import { dbg } from './trackingDebug.js';

// The service worker's only sync job: keep the alarm on the right cadence and run a tick.
// Everything else (account setup, devices) runs in the sync page through shared/syncClient.js.
export const SYNC_ALARM = 'sync';

export async function tick() {
  const status = await runSync();
  dbg('sync: tick', status);
  return status;
}

// Design: clamp(L_tightest / (10 × max(1, N−1)), 1, 5) minutes, so the overshoot from
// unsynced devices stays a tenth of the tightest limit. N comes from the device registry
// once the sync page fetches it; until then two devices are assumed.
export async function syncPeriodMinutes() {
  const { rules = [], _syncDeviceCount = 2 } = await chrome.storage.local.get(['rules', '_syncDeviceCount']);
  const mult = { minutes: 1, hours: 60, days: 1440 };
  const tightest = Math.min(...rules.filter((r) => r.enabled).map((r) => r.limit * (mult[r.limitUnit] ?? 1)), Infinity);
  if (!Number.isFinite(tightest)) return 5;
  return Math.min(5, Math.max(1, tightest / (10 * Math.max(1, _syncDeviceCount - 1))));
}

export async function ensureSyncAlarm() {
  const periodInMinutes = await syncPeriodMinutes();
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing || existing.periodInMinutes !== periodInMinutes) chrome.alarms.create(SYNC_ALARM, { periodInMinutes });
}

// Test seam for scripts/os/sync-smoke.mjs, which drives the service worker from Playwright.
globalThis.reeflectSync = {
  runSync, syncState, deviceId, appendIntervals, count, deleteByDomain,
  resetReconcileGate: () => db.meta.delete('lastReconciledAt'),
};
