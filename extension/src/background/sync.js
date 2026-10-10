import { runSync, syncState, syncStatus } from '../shared/syncClient.js';
import { deviceId, appendIntervals } from '../data/intervalLog.js';
import { count, deleteByDomain } from '../shared/rowStore.js';
import { coreCall } from '../shared/core.js';
import { db } from '../data/intervalLog.js';
import { dbg } from './trackingDebug.js';

// The service worker's only sync job: keep the alarm on the right cadence and run a tick.
// Everything else (account setup, devices) runs in the sync page through shared/syncClient.js.
export const SYNC_ALARM = 'sync';

// Rows pulled before 2026-09-27 lost a non-web `source`, so an app's time read as a site's. Pulling
// from the start once more rewrites every pulled row with its source; own rows are left alone.
async function healPulledSources() {
  if (await db.meta.get('sourceHealed')) return;
  if (await db.meta.get('account')) await db.meta.delete('lastPulledSeq');
  await db.meta.put({ key: 'sourceHealed', value: new Uint8Array([1]) });
}

export async function tick() {
  await healPulledSources();
  const status = await runSync();
  dbg('sync: tick', status);
  return status;
}

const SYNC_PERIOD_MINUTES = 1;

export async function ensureSyncAlarm() {
  const periodInMinutes = SYNC_PERIOD_MINUTES;
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing || existing.periodInMinutes !== periodInMinutes) chrome.alarms.create(SYNC_ALARM, { periodInMinutes });
}

// Test seam for scripts/os/sync-smoke.mjs, which drives the service worker from Playwright.
globalThis.reeflectSync = {
  tick, runSync, syncState, syncStatus, deviceId, appendIntervals, count, deleteByDomain,
  resetReconcileGate: () => db.meta.delete('lastReconciledAt'),
  ownCount: async () => { const me = await deviceId(); return (await coreCall('rows.since', { fromMs: 0 })).filter((r) => r.deviceId === me).length; },
};
