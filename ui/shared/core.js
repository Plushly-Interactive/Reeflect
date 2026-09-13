import init from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { buildTime } from '../vendor/reeflect-core/time-from-date.mjs';
import { PREF_WEEK_START } from './prefKeys.js';
import { DEFAULT_WEEK_START } from './weekStart.js';
import { host } from './host.js';

// The vendored core, shared by sync and enforcement. One instantiation per service worker or
// page: every caller awaits this before touching an export.
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
