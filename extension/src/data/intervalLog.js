import Dexie from '../vendor/dexie.min.mjs';

// The interval log's primitives on IndexedDB: one row per closed presence range — { domain, path,
// kind, from, to }, kind ∈ active|audio|idle. Every operation over rows (delete, split, merge,
// statistics) is the core's, reached through `shared/rowStore.js`; this file only stores.
//
// v2 adds the cloud-sync fields on every row: deviceId + localId (the row's global identity,
// localId = id for rows captured here), dirty (1 = not yet pushed), mirror (1 = pulled from
// another device), keyEpoch. Mirror rows live in the same table, so every reader counts all
// devices without change. `deletes` queues origins the next push must remove; `meta` holds
// the sync engine's scalars as bytes.
const db = new Dexie('browsing-intervals');
db.version(1).stores({
  intervals: '++id',
});
db.version(2).stores({
  intervals: '++id, [deviceId+localId], dirty',
  deletes: '[deviceId+localId]',
  meta: 'key',
}).upgrade(async (tx) => {
  const me = await ensureDeviceIdIn(tx.table('meta'));
  await tx.table('intervals').toCollection().modify((r) => {
    r.deviceId = me; r.localId = r.id; r.dirty = 1; r.mirror = 0; r.keyEpoch = 0;
  });
});
// `to` indexed: a recent window reads its own rows, not the whole log (0.9 s at 110K rows).
db.version(3).stores({
  intervals: '++id, [deviceId+localId], dirty, to',
});
// `changes`: every write that changes a row's data logs `{seq, from}` in its own transaction, so the
// dashboard rebuilds only from the earliest day touched (the core's `Storage::changes` contract).
db.version(4).stores({
  changes: '++seq',
});

// The lowest number a change can carry: every row went.
export const EVERY_ROW = Number.MIN_SAFE_INTEGER;

// Logs one write, at the earliest instant it touched. Call inside a transaction that holds `changes`.
export function logChange(from) {
  return db.changes.add({ from });
}

export function earliestFrom(rows) {
  let min = Infinity;
  for (const r of rows) if (r.from < min) min = r.from;
  return min;
}

if (navigator.storage?.persist) navigator.storage.persist();

const enc = new TextEncoder(), dec = new TextDecoder();
let cachedDeviceId = null;

async function ensureDeviceIdIn(meta) {
  const existing = await meta.get('deviceId');
  if (existing) return dec.decode(existing.value);
  const id = crypto.randomUUID();
  await meta.put({ key: 'deviceId', value: enc.encode(id) });
  return id;
}

// This device's id, generated once and kept in `meta` under the key the sync engine reads.
export async function deviceId() {
  cachedDeviceId ??= await ensureDeviceIdIn(db.meta);
  return cachedDeviceId;
}

export { db };

function ownRow(r, me) {
  return { domain: r.domain, path: r.path, kind: r.kind, from: r.from, to: r.to, deviceId: me, dirty: 1, mirror: 0, keyEpoch: 0 };
}

// Insert rows captured here; each gets its own id as localId. Resolves to the ids.
export async function appendIntervals(rows) {
  const me = await deviceId();
  return db.transaction('rw', db.intervals, db.changes, async () => {
    const ids = await db.intervals.bulkAdd(rows.map((r) => ownRow(r, me)), { allKeys: true });
    await db.intervals.bulkUpdate(ids.map((id) => ({ key: id, changes: { localId: id } })));
    if (rows.length) await logChange(earliestFrom(rows));
    return ids;
  });
}

// Insert one row, resolving to its id (for live-row coalescing).
export async function appendInterval(row) {
  const [id] = await appendIntervals([row]);
  return id;
}

export function allIntervals() {
  return db.intervals.toArray();
}

// Rows whose range reaches into [fromTs, ∞): every row still relevant to a recent window.
export function intervalsSince(fromTs) {
  return db.intervals.where('to').aboveOrEqual(fromTs).toArray();
}
