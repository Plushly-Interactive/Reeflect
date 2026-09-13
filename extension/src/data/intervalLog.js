import Dexie from '../vendor/dexie.min.mjs';

// The interval log: one row per closed presence range — { domain, path, kind, from, to },
// kind ∈ active|audio|idle. overlap is NOT stored (= active ∩ audio, derivable); time
// aggregates and visit counts are derived from these ranges at read time.
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

// One definition of "still the same continuous session" used in two places:
// the live-row flush extends a row across gaps this small (stitching flush/SW
// seams), and visit counting merges presence across gaps this small. Keeping it
// shared means a row boundary and a visit boundary mean the same thing.
export const SESSION_GAP_MS = 1000;

function ownRow(r, me) {
  return { domain: r.domain, path: r.path, kind: r.kind, from: r.from, to: r.to, deviceId: me, dirty: 1, mirror: 0, keyEpoch: 0 };
}

// Insert rows captured here; each gets its own id as localId. Resolves to the ids.
export async function appendIntervals(rows) {
  const me = await deviceId();
  return db.transaction('rw', db.intervals, async () => {
    const ids = await db.intervals.bulkAdd(rows.map((r) => ownRow(r, me)), { allKeys: true });
    await db.intervals.bulkUpdate(ids.map((id) => ({ key: id, changes: { localId: id } })));
    return ids;
  });
}

// Insert one row, resolving to its id (for live-row coalescing).
export async function appendInterval(row) {
  const [id] = await appendIntervals([row]);
  return id;
}

// Extend an open live row's end in place; it is ours, so it goes dirty again.
export function touch(id, to) {
  return db.intervals.update(id, { to, dirty: 1 });
}

export function allIntervals() {
  return db.intervals.toArray();
}

// Rows whose range reaches into [fromTs, ∞): every row still relevant to a recent
// window (enforcement / badge). No time index on the store (by design), so this is
// still an O(n) row walk, but it materializes only the recent rows, not the whole
// log. Switch to .where('to').above(fromTs) if an index is ever added.
export function intervalsSince(fromTs) {
  return db.intervals.filter(r => r.to >= fromTs).toArray();
}

// Local wipe only: the account's copy on the server stays. Pending deletes go too,
// since there is nothing left locally to reconcile against.
export function clearAll() {
  return db.transaction('rw', db.intervals, db.deletes, async () => {
    await db.intervals.clear();
    await db.deletes.clear();
  });
}

// Every delete goes through here: drop the rows and queue their origins for the next
// push, so the deletion reaches the server and, through it, every other device.
async function removeRows(rows) {
  if (rows.length === 0) return 0;
  await db.transaction('rw', db.intervals, db.deletes, async () => {
    await db.intervals.bulkDelete(rows.map((r) => r.id));
    await db.deletes.bulkPut(rows.filter((r) => r.deviceId != null).map((r) => ({ deviceId: r.deviceId, localId: r.localId })));
  });
  return rows.length;
}

// Delete rows by id (for import conflict resolution).
export async function deleteByIds(ids) {
  return removeRows(await db.intervals.bulkGet(ids).then((rs) => rs.filter(Boolean)));
}

// Delete every row for a domain. Resolves to the number deleted.
export async function deleteByDomain(domain) {
  return removeRows(await db.intervals.filter(r => r.domain === domain).toArray());
}

// Clear the time window [fromTs, toTs) from every overlapping row (optionally only
// for `domain`): rows fully inside are deleted, rows crossing an edge are truncated,
// rows spanning the whole window are split in two. So a row that started before the
// window but runs into it loses exactly its in-window part. Resolves to rows touched.
// A truncated row from another device cannot be edited in place (only its device may
// push it), so it is deleted and its kept part re-added as a row of ours.
export async function deleteRange(fromTs, toTs, domain = null) {
  if (fromTs >= toTs) return 0;  // empty/inverted window
  const affected = await db.intervals
    .filter(r => r.from < toTs && r.to > fromTs && (!domain || r.domain === domain))
    .toArray();
  if (affected.length === 0) return 0;

  const toDelete = [], toUpdate = [], toAdd = [];
  for (const r of affected) {
    const keepLeft = r.from < fromTs;   // part before the window survives
    const keepRight = r.to > toTs;      // part after the window survives
    const kept = [];
    if (keepLeft) kept.push({ from: r.from, to: fromTs });
    if (keepRight) kept.push({ from: toTs, to: r.to });
    if (kept.length === 0 || r.mirror) {
      toDelete.push(r);
      for (const k of kept) toAdd.push({ domain: r.domain, path: r.path, kind: r.kind, ...k });
    } else {
      toUpdate.push([r.id, { ...kept[0], dirty: 1 }]);
      if (kept[1]) toAdd.push({ domain: r.domain, path: r.path, kind: r.kind, ...kept[1] });
    }
  }
  await db.transaction('rw', db.intervals, db.deletes, db.meta, async () => {
    await removeRows(toDelete);
    for (const [id, changes] of toUpdate) await db.intervals.update(id, changes);
    if (toAdd.length) await appendIntervals(toAdd);
  });
  return affected.length;
}

// Delete every row for one domain+path. Resolves to the number deleted.
export async function deletePath(domain, path) {
  return removeRows(await db.intervals.filter(r => r.domain === domain && r.path === path).toArray());
}

// Collapse rows that START before `beforeTs` to site level: drop the path and
// merge each domain's same-kind ranges into the fewest disjoint rows. Preserves
// site-level active/audio time (a union, same as the aggregates compute) while
// shedding per-page detail and shrinking the log. Resolves to rows removed.
export async function dropPathsBefore(beforeTs) {
  const old = await db.intervals.filter(r => r.from < beforeTs).toArray();
  if (old.length === 0) return 0;

  const byKey = new Map();  // "domain\nkind" -> [[from,to], ...]
  for (const r of old) {
    const k = `${r.domain}\n${r.kind}`;
    let arr = byKey.get(k);
    if (!arr) { arr = []; byKey.set(k, arr); }
    arr.push([r.from, r.to]);
  }

  const merged = [];
  for (const [k, ranges] of byKey) {
    const [domain, kind] = k.split('\n');
    ranges.sort((a, b) => a[0] - b[0]);
    let [cs, ce] = ranges[0];
    for (let i = 1; i < ranges.length; i++) {
      const [s, e] = ranges[i];
      if (s <= ce) { if (e > ce) ce = e; }            // overlap/touch -> extend
      else { merged.push({ domain, path: '/', kind, from: cs, to: ce }); cs = s; ce = e; }
    }
    merged.push({ domain, path: '/', kind, from: cs, to: ce });
  }

  await db.transaction('rw', db.intervals, db.deletes, db.meta, async () => {
    await removeRows(old);
    await appendIntervals(merged);
  });
  return old.length - merged.length;
}

// Row count, for the dashboard's size indicator.
export function count() {
  return db.intervals.count();
}

// Rows still waiting to be pushed. The sync page polls this to show upload progress, because a
// first sync of a long history runs for minutes and the engine only reports once it finishes.
export function dirtyCount() {
  return db.intervals.where('dirty').equals(1).count();
}

// Rows, distinct domains/subpages, and date span in one streaming pass (each()
// does not build a full array, so this stays low-memory as the log grows).
// earliest/latest are ms timestamps, null when empty.
export async function intervalStats() {
  let rows = 0, earliest = Infinity, latest = -Infinity;
  const domains = new Set(), subpages = new Set();
  const kinds = { active: 0, audio: 0, idle: 0 };
  await db.intervals.each(r => {
    rows++;
    domains.add(r.domain);
    subpages.add(`${r.domain}\n${r.path}`);
    if (r.kind in kinds) kinds[r.kind]++;
    if (r.from < earliest) earliest = r.from;
    if (r.to > latest) latest = r.to;
  });
  return {
    rows, domains: domains.size, subpages: subpages.size, kinds,
    earliest: rows ? earliest : null, latest: rows ? latest : null,
  };
}
