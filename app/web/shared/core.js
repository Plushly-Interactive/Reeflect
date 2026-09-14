// The app's core: every command goes to the native session through `core_call`. The core reads
// the clock and the zone itself here, so a Time carries only the week start and a window start.
import { PREF_WEEK_START } from './prefKeys.js';
import { DEFAULT_WEEK_START } from './weekStart.js';
import { host } from './host.js';

const { invoke } = window.__TAURI__.core;

export function loadCore() {
  return Promise.resolve();
}

export async function timeJson(windowStartMs, _now = Date.now()) {
  const { [PREF_WEEK_START]: ws = DEFAULT_WEEK_START } = await host.prefs.get(PREF_WEEK_START);
  return JSON.stringify({ weekStart: ws.slice(0, 3), windowStartMs });
}

export async function coreCall(cmd, args = null) {
  const reply = JSON.parse(await invoke('core_call', { cmd, args: args === null ? '' : JSON.stringify(args) }));
  if ('error' in reply) throw new Error(reply.error);
  return reply.ok;
}
