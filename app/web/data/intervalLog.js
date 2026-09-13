// The app's row store: the native core's SQLite, reached by command. Same exports as the
// extension's IndexedDB module; the ones the app has no page for yet reject with a clear message.
import { coreCall } from '../shared/core.js';

export const SESSION_GAP_MS = 1000;

export function deviceId() {
  return coreCall('deviceId');
}

export function appendIntervals(rows) {
  return coreCall('rows.append', { rows });
}

export async function appendInterval(row) {
  const [id] = await appendIntervals([row]);
  return id;
}

export function allIntervals() {
  return coreCall('rows.since', { fromMs: Number.MIN_SAFE_INTEGER });
}

export function intervalsSince(fromTs) {
  return coreCall('rows.since', { fromMs: fromTs });
}

export function count() {
  return coreCall('rows.count');
}

const later = (name) => () => Promise.reject(new Error(`${name}: not in the app yet`));
export const touch = later('touch');
export const clearAll = later('clearAll');
export const deleteByIds = later('deleteByIds');
export const deleteByDomain = later('deleteByDomain');
export const deleteRange = later('deleteRange');
export const deletePath = later('deletePath');
export const dropPathsBefore = later('dropPathsBefore');
export const dirtyCount = later('dirtyCount');
export const intervalStats = later('intervalStats');
