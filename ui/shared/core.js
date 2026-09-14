import init, { Engine } from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { buildTime } from '../vendor/reeflect-core/time-from-date.mjs';
import { syncStorage } from '../data/syncStorage.js';
import { PREF_WEEK_START } from './prefKeys.js';
import { DEFAULT_WEEK_START } from './weekStart.js';
import { SYNC_BASE_URL_DEFAULT } from './brand.js';
import { host } from './host.js';

// The vendored core, shared by sync, enforcement and every page. One instantiation per service
// worker or page: every caller awaits this before touching an export.
let ready = null;
export function loadCore() {
  ready ??= init({ module_or_path: host.assetUrl('src/vendor/reeflect-core/reeflect_core_wasm_bg.wasm') });
  return ready;
}

// The core never reads the clock or the zone. It gets a Time snapshot built from JS Date that
// covers [windowStartMs, now + 7 days] with the user's week start.
export async function timeJson(windowStartMs, now = Date.now()) {
  const { [PREF_WEEK_START]: ws = DEFAULT_WEEK_START } = await host.prefs.get(PREF_WEEK_START);
  return JSON.stringify(buildTime(ws.slice(0, 3), windowStartMs, now));
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
const DEK_KEY = '_dek';
const localKeys = {
  async loadDek() {
    const { [DEK_KEY]: dek } = await host.prefs.get(DEK_KEY);
    return dek ? new Uint8Array(dek) : null;
  },
  async storeDek(dek) {
    await host.prefs.set({ [DEK_KEY]: Array.from(dek) });
  },
  async clearDek() {
    await host.prefs.remove(DEK_KEY);
  },
};

// One engine per page or service worker; the worker is torn down when idle anyway. `_syncBaseUrl`
// in prefs is a hidden developer override of the one server everyone uses.
let engine = null;
async function getEngine() {
  await loadCore();
  if (!engine) {
    const { _syncBaseUrl } = await host.prefs.get('_syncBaseUrl');
    engine = new Engine(JSON.stringify({ clientType: 'web', baseUrl: _syncBaseUrl || SYNC_BASE_URL_DEFAULT }), syncStorage, fetchHttp, localKeys);
  }
  return engine;
}

// Any command of the core by name; the same call every host makes. One call at a time: the
// engine's `call` borrows it mutably across its awaits, and wasm-bindgen throws on an overlap.
let queue = Promise.resolve();
export function coreCall(cmd, args = null) {
  const run = async () => {
    const eng = await getEngine();
    return JSON.parse(await eng.call(cmd, args === null ? '' : JSON.stringify(args)));
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}
