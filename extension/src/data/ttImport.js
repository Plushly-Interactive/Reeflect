import { SITES_DAY_KEY } from './bucketKeys.js';
import { showNotification } from '../shared/utils.js';
import { t } from '../shared/i18n.js';
import { host } from '../shared/host.js';

// Time Tracker import logic, no modal/DOM wiring, callable from any page. TT data
// is coarse daily aggregates, so it lands in the scalar bucket tier, not the
// interval log.
export const IMPORT_COMPLETE = 'importcomplete';
export const TT_VERSION = '4.2.1';

function normalizeHost(host) {
  return host.startsWith('www.') ? host.slice(4) : host;
}

// Build a Time Tracker payload from a day-map { day: { siteId: { activeMs, visits } } }.
// Works for either source: scalar buckets or interval-derived daily aggregates.
export function buildTtPayload(sitesByDay) {
  const __stat__ = [];
  for (const [day, sites] of Object.entries(sitesByDay)) {
    const date = day.replaceAll('-', '');
    for (const [host, entry] of Object.entries(sites)) {
      __stat__.push({ host, date, focus: entry.activeMs ?? 0, time: entry.visits ?? 0 });
    }
  }
  return { __meta__: { version: TT_VERSION, ts: Date.now() }, __stat__, __limit__: [], __merge__: [], __whitelist__: [] };
}

export function downloadTt(sitesByDay) {
  const payload = buildTtPayload(sitesByDay);
  const blob = new Blob([JSON.stringify(payload, null, 4)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `time-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showNotification(t('data_exportedTo', [filename]));
}

// Time Tracker __stat__ array -> bucket day map { day: { siteId: cell } }.
export function parseTtStats(json) {
  const data = {};
  for (const { host, date, focus, time } of json.__stat__) {
    if (!host || !date || focus == null) continue;
    const dayKey = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const siteId = normalizeHost(host);
    data[dayKey] ??= {};
    data[dayKey][siteId] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 };
    data[dayKey][siteId].activeMs += focus;
    data[dayKey][siteId].visits += time ?? 0;
  }
  return data;
}

// Merge an imported day-map into sitesByDay buckets. Days absent from current are
// taken; days in `daysToReplace` overwrite. Writes storage.
export async function applyTtImport(importData, currentByDay, daysToReplace) {
  const daysToTake = new Set();
  for (const d of Object.keys(importData)) {
    if (!currentByDay[d] || daysToReplace.has(d)) daysToTake.add(d);
  }
  for (const d of daysToTake) currentByDay[d] = importData[d];

  await host.prefs.set({ [SITES_DAY_KEY]: currentByDay });
  showNotification(t(daysToTake.size === 1 ? 'data_importedDays_one' : 'data_importedDays_other', [daysToTake.size]));
  window.dispatchEvent(new CustomEvent(IMPORT_COMPLETE));
  return daysToTake.size;
}
