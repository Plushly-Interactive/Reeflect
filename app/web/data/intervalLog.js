// The app's row store primitives: the native core's SQLite, reached by command. Same exports as
// the extension's IndexedDB module; every operation over rows is the core's (`shared/rowStore.js`).
import { coreCall } from '../shared/core.js';

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

// Rows carry `deviceId` and `localId`; `id` mirrors `localId` for readers that key by it.
async function withIds(rows) {
  for (const r of rows) r.id = r.localId;
  return rows;
}

export function allIntervals() {
  return coreCall('rows.since', { fromMs: Number.MIN_SAFE_INTEGER }).then(withIds);
}

export function intervalsSince(fromTs) {
  return coreCall('rows.since', { fromMs: fromTs }).then(withIds);
}
