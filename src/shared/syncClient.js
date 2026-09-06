import init, { Engine } from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { buildTime } from '../vendor/reeflect-core/time-from-date.mjs';
import { syncStorage } from '../data/syncStorage.js';
import { db } from '../data/intervalLog.js';
import { invalidate } from '../data/intervalAggregates.js';
import { PREF_WEEK_START } from './prefKeys.js';
import { DEFAULT_WEEK_START } from './weekStart.js';

// The cloud-sync core, usable from any page and from the service worker. Method names and
// JSON shapes follow the vendored core's wasm host contract.
//
// Where the extension syncs to: one server for everyone. `_syncBaseUrl` in storage.local is a
// hidden developer override, never shown on the settings page.
export const SYNC_BASE_URL_DEFAULT = 'https://sync.coralclock.com';
export const SYNC_STATUS_KEY = 'syncStatus';
const DEK_KEY = '_dek';
const DAY = 86_400_000;

let wasmReady = null;
function loadCore() {
  wasmReady ??= init({ module_or_path: chrome.runtime.getURL('src/vendor/reeflect-core/reeflect_core_wasm_bg.wasm') });
  return wasmReady;
}

const fetchHttp = {
  async send(requestJson) {
    const req = JSON.parse(requestJson);
    const headers = { 'content-type': 'application/json' };
    if (req.bearer) headers.authorization = `Bearer ${req.bearer}`;
    const r = await fetch(req.path, { method: req.method, headers, body: req.body ?? undefined });
    return JSON.stringify({ status: r.status, body: await r.text() });
  },
};

// The data key rests in storage.local. The interval log next to it is plain text and already
// holds every device's rows, so keeping the key out of storage bought nothing and cost an
// unlock at every browser start. Clients that store no plaintext use a passphrase instead.
const localKeys = {
  async loadDek() {
    const { [DEK_KEY]: dek } = await chrome.storage.local.get(DEK_KEY);
    return dek ? new Uint8Array(dek) : null;
  },
  async storeDek(dek) {
    await chrome.storage.local.set({ [DEK_KEY]: Array.from(dek) });
  },
  async clearDek() {
    await chrome.storage.local.remove(DEK_KEY);
  },
};

// One engine per call: it holds host references, and the service worker is torn down when idle.
async function engine() {
  await loadCore();
  const { _syncBaseUrl } = await chrome.storage.local.get('_syncBaseUrl');
  return new Engine(JSON.stringify({ clientType: 'web', baseUrl: _syncBaseUrl || SYNC_BASE_URL_DEFAULT }), syncStorage, fetchHttp, localKeys);
}

async function timeJson(now) {
  const { [PREF_WEEK_START]: ws = DEFAULT_WEEK_START } = await chrome.storage.local.get(PREF_WEEK_START);
  return JSON.stringify(buildTime(ws.slice(0, 3), now - 400 * DAY, now));
}

// off | on | signedOut — what the settings card and the sync page show.
export async function syncState() {
  const linked = (await db.meta.get('account')) != null;
  if (linked) return 'on';
  const everLinked = (await db.meta.get('lastPulledSeq')) != null;
  return everLinked ? 'signedOut' : 'off';
}

export function syncStatus() {
  return chrome.storage.local.get(SYNC_STATUS_KEY).then((s) => s[SYNC_STATUS_KEY] ?? null);
}

// A signed-out device (token revoked elsewhere, or account deleted) drops its keys and keeps
// its rows: only the recovery phrase can rejoin. Every caller funnels errors through here.
async function handleError(e, eng) {
  const message = String(e?.message ?? e);
  if (message === 'NeedsReauth') await eng.forgetSession().catch(() => {});
  return message;
}

export async function runSync(now = Date.now()) {
  if ((await syncState()) !== 'on') return { skipped: 'not syncing' };
  const previous = await syncStatus();
  // The server can tell a device to hold off, and every attempt before that time fails the same
  // way. Honouring it keeps a paused device quiet instead of retrying on every alarm for hours.
  if (previous?.retryAfter > now) return { ...previous, skipped: 'paused' };
  const eng = await engine();
  const status = { lastRunAt: now };
  try {
    const report = JSON.parse(await eng.tick(await timeJson(now)));
    if (report.pulled || report.deletedLocal) invalidate();
    status.lastReport = report;
  } catch (e) {
    status.lastError = await handleError(e, eng);
    const paused = /^Paused: (\d+)$/.exec(status.lastError);
    if (paused) {
      status.lastError = 'Paused';
      status.retryAfter = now + Number(paused[1]) * 1000;
    }
  }
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: status });
  return status;
}

/// Starts syncing: new keys, new account. Returns the 24-word phrase, shown once.
export async function startSyncing() {
  return (await engine()).register();
}

export async function linkDevice(phrase) {
  const eng = await engine();
  try {
    await eng.linkDevice(phrase.trim().replace(/\s+/g, ' ').toLowerCase());
  } catch (e) {
    throw new Error(await handleError(e, eng));
  }
}

export async function recoveryPhrase() {
  return (await engine()).recoveryPhrase();
}

export async function devices() {
  const eng = await engine();
  try {
    return JSON.parse(await eng.devices());
  } catch (e) {
    throw new Error(await handleError(e, eng));
  }
}

export async function renameDevice(deviceId, name) {
  return (await engine()).renameDevice(deviceId, name);
}

export async function signOutDevice(deviceId) {
  const eng = await engine();
  await eng.signOutDevice(deviceId);
  await chrome.storage.local.remove(SYNC_STATUS_KEY);
}

export async function forgetDevice(deviceId) {
  return (await engine()).forgetDevice(deviceId);
}

/// Stops syncing for the whole account: the server wipes every row, key and device.
export async function stopSyncingEverywhere() {
  const eng = await engine();
  await eng.requestDelete();
  await chrome.storage.local.remove(SYNC_STATUS_KEY);
}
