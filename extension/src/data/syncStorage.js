import { db, deviceId, appendIntervals, logChange, earliestFrom, EVERY_ROW } from './intervalLog.js';

// The sync engine's Storage host object over the interval log. Method names, JSON
// shapes and ordering follow the vendored core's wasm host contract
// (docs/appendix/core-crate-surface.md); scripts/engine-harness.mjs there is the twin.
const originKey = (o) => [o.deviceId, o.localId];
const wireRow = (r) => ({ v: 1, domain: r.domain, from: r.from, to: r.to, path: r.path, kind: r.kind, source: r.source ?? 'web', label: r.label });

async function originsFrom(collection, afterJson, limit) {
  const a = afterJson ? JSON.parse(afterJson) : null;
  const keys = await (a ? collection.above(originKey(a)) : collection.aboveOrEqual(['', 0])).limit(limit).keys();
  return keys.map(([deviceId, localId]) => ({ deviceId, localId }));
}

export const syncStorage = {
  async dirtyRows(limit) {
    const out = (await db.deletes.limit(limit).toArray()).map((o) => ({ delete: { deviceId: o.deviceId, localId: o.localId } }));
    if (out.length < limit) {
      const rows = await db.intervals.where('dirty').equals(1).limit(limit - out.length).toArray();
      for (const r of rows) out.push({ upsert: { localId: r.localId, row: wireRow(r) } });
    }
    return JSON.stringify(out);
  },
  async markDirty(idsJson) {
    const ids = JSON.parse(idsJson);
    await db.intervals.bulkUpdate(ids.map((id) => ({ key: id, changes: { dirty: 1 } })));
  },
  async clearDirty(originsJson) {
    const me = await deviceId();
    const origins = JSON.parse(originsJson);
    await db.transaction('rw', db.intervals, db.deletes, async () => {
      await db.deletes.bulkDelete(origins.map(originKey));
      const own = origins.filter((o) => o.deviceId === me);
      await db.intervals.bulkUpdate(own.map((o) => ({ key: o.localId, changes: { dirty: 0 } })));
    });
  },
  // Another device's rows replace their mirror; this device's own (a merge's recovery pull) land
  // as own rows at their own id, only where absent.
  async upsertMirror(rowsJson) {
    const rows = JSON.parse(rowsJson);
    const me = await deviceId();
    await db.transaction('rw', db.intervals, db.changes, async () => {
      let earliest = Infinity;
      for (const m of rows) {
        const own = m.origin.deviceId === me;
        const existing = await db.intervals.where('[deviceId+localId]').equals(originKey(m.origin)).first();
        if (own && existing) continue;
        earliest = Math.min(earliest, m.row.from, existing?.from ?? Infinity);
        const row = { ...m.row, deviceId: m.origin.deviceId, localId: m.origin.localId, dirty: 0, mirror: own ? 0 : 1, keyEpoch: m.keyEpoch };
        // Web is the default a read fills back in; any other source must stay, or an app row reads as a site.
        delete row.v;
        if (row.source === 'web') delete row.source;
        if (existing) await db.intervals.put({ ...row, id: existing.id });
        else await db.intervals.add(own ? { ...row, id: m.origin.localId } : row);
      }
      if (earliest !== Infinity) await logChange(earliest);
    });
  },
  async deleteLocal(originsJson) {
    const origins = JSON.parse(originsJson);
    await db.transaction('rw', db.intervals, db.changes, async () => {
      const gone = db.intervals.where('[deviceId+localId]').anyOf(origins.map(originKey));
      const rows = await gone.toArray();
      if (!rows.length) return;
      await gone.delete();
      await logChange(earliestFrom(rows));
    });
  },
  async originsPage(afterJson, limit) {
    return JSON.stringify(await originsFrom(db.intervals.where('[deviceId+localId]'), afterJson, limit));
  },
  async epochPage(below, afterJson, limit) {
    const a = afterJson ? JSON.parse(afterJson) : null;
    const coll = a ? db.intervals.where('[deviceId+localId]').above(originKey(a)) : db.intervals.orderBy('[deviceId+localId]');
    const rows = await coll.filter((r) => r.mirror === 1 && r.keyEpoch < below).limit(limit).toArray();
    return JSON.stringify(rows.map((r) => ({ deviceId: r.deviceId, localId: r.localId })));
  },
  async rowsSince(fromMs) {
    return JSON.stringify((await db.intervals.where('to').aboveOrEqual(fromMs).toArray()).map(wireRow));
  },
  async metaGet(key) {
    return (await db.meta.get(key))?.value ?? null;
  },
  async metaSet(key, val) {
    await db.meta.put({ key, value: new Uint8Array(val) });
  },
  async metaDelete(key) {
    await db.meta.delete(key);
  },
  // ---- the row primitives every operation in the core is written over
  async appendOwn(rowsJson) {
    return JSON.stringify(await appendIntervals(JSON.parse(rowsJson)));
  },
  async storedRows(filterJson) {
    const f = JSON.parse(filterJson);
    const keep = (r) =>
      (f.deviceId == null || r.deviceId === f.deviceId) &&
      (f.domain == null || r.domain === f.domain) &&
      (f.path == null || r.path === f.path) &&
      (f.overlapFrom == null || r.to >= f.overlapFrom) &&
      (f.overlapTo == null || r.from < f.overlapTo) &&
      (f.fromBefore == null || r.from < f.fromBefore) &&
      (f.origin == null || (r.deviceId === f.origin.deviceId && r.localId === f.origin.localId));
    // One bulk read, then the filter in memory: a cursor walk with the filter per row took twice as long at 100k rows.
    // A recent window reads only its range of the `to` index; the full log passes i64::MIN and reads everything.
    const from = f.overlapFrom > 0 ? db.intervals.where('to').aboveOrEqual(f.overlapFrom) : db.intervals;
    const rows = (await from.toArray()).filter(keep);
    return JSON.stringify(rows.map((r) => ({ origin: { deviceId: r.deviceId, localId: r.localId }, row: wireRow(r), mirror: r.mirror === 1 })));
  },
  async updateOwnRange(originJson, from, to) {
    const o = JSON.parse(originJson);
    await db.transaction('rw', db.intervals, db.changes, async () => {
      const own = db.intervals.where('[deviceId+localId]').equals(originKey(o)).filter((r) => r.mirror !== 1);
      const old = await own.first();
      if (!old) return;
      await own.modify({ from, to, dirty: 1 });
      await logChange(Math.min(old.from, from));
    });
  },
  // Every delete goes through here: the rows go and their origins queue for the next push.
  async removeRows(originsJson) {
    const origins = JSON.parse(originsJson);
    await db.transaction('rw', db.intervals, db.deletes, db.changes, async () => {
      const gone = db.intervals.where('[deviceId+localId]').anyOf(origins.map(originKey));
      const rows = await gone.toArray();
      await gone.delete();
      await db.deletes.bulkPut(origins.map((o) => ({ deviceId: o.deviceId, localId: o.localId })));
      if (rows.length) await logChange(earliestFrom(rows));
    });
  },
  async countRows() {
    return db.intervals.count();
  },
  async dirtyCount() {
    return db.intervals.where('dirty').equals(1).count();
  },
  async clearRows() {
    await db.transaction('rw', db.intervals, db.deletes, db.changes, async () => {
      await db.intervals.clear();
      await db.deletes.clear();
      await logChange(EVERY_ROW);
    });
  },
  async changes() {
    return JSON.stringify(await db.changes.toArray());
  },
  async dropChanges(through) {
    await db.changes.where('seq').belowOrEqual(through).delete();
  },
  async maxLocalId(id) {
    const last = await db.intervals.where('[deviceId+localId]').between([id, 0], [id, Infinity]).last();
    const queued = await db.deletes.filter((o) => o.deviceId === id).toArray();
    return Math.max(last?.localId ?? 0, ...queued.map((o) => o.localId));
  },
  // Own ids are the table's keys, so the base is the highest key in use. The sentinel bumps the key
  // generator past the range, so a row appended meanwhile lands beyond it; one transaction, so
  // nothing squeezes in between the read and the bump.
  async reserveIds(span) {
    const me = await deviceId();
    return db.transaction('rw', db.intervals, async () => {
      const base = (await db.intervals.orderBy('id').last())?.id ?? 0;
      if (span > 0) {
        const top = base + span;
        await db.intervals.add({ id: top, deviceId: me, localId: top, domain: '', path: '', kind: 'active', from: 0, to: 0, dirty: 0, mirror: 0 });
        await db.intervals.delete(top);
      }
      return base;
    });
  },
};
