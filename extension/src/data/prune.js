export function scanSiteBucket(store, thresholdMs, storeName) {
  const byId = new Map();
  for (const dateKey of Object.keys(store)) {
    const bucket = store[dateKey];
    for (const siteId of Object.keys(bucket)) {
      const record = bucket[siteId];
      let agg = byId.get(siteId);
      if (!agg) {
        agg = { store: storeName, siteId, totalActive: 0, totalAudio: 0, recordCount: 0, dateKeys: [], lastVisit: dateKey };
        byId.set(siteId, agg);
      }
      agg.totalActive += record.activeMs ?? 0;
      agg.totalAudio += record.audioMs ?? 0;
      agg.recordCount += 1;
      agg.dateKeys.push(dateKey);
      if (dateKey > agg.lastVisit) agg.lastVisit = dateKey;
    }
  }
  return [...byId.values()].filter(a => a.totalActive < thresholdMs && a.totalAudio < thresholdMs);
}

export function scanSubpageBucket(store, thresholdMs, storeName) {
  const byKey = new Map();
  for (const dateKey of Object.keys(store)) {
    const bucket = store[dateKey];
    for (const siteId of Object.keys(bucket)) {
      const paths = bucket[siteId];
      for (const path of Object.keys(paths)) {
        const record = paths[path];
        const key = `${siteId}\n${path}`;
        let agg = byKey.get(key);
        if (!agg) {
          agg = { store: storeName, siteId, path, totalActive: 0, totalAudio: 0, recordCount: 0, dateKeys: [], lastVisit: dateKey };
          byKey.set(key, agg);
        }
        agg.totalActive += record.activeMs ?? 0;
        agg.totalAudio += record.audioMs ?? 0;
        agg.recordCount += 1;
        agg.dateKeys.push(dateKey);
        if (dateKey > agg.lastVisit) agg.lastVisit = dateKey;
      }
    }
  }
  return [...byKey.values()].filter(a => a.totalActive < thresholdMs && a.totalAudio < thresholdMs);
}

export function applySiteDeletions(store, identities) {
  for (const { siteId, dateKeys } of identities) {
    for (const dateKey of dateKeys) {
      const bucket = store[dateKey];
      if (!bucket) continue;
      delete bucket[siteId];
      if (Object.keys(bucket).length === 0) delete store[dateKey];
    }
  }
  return store;
}

export function applySubpageDeletions(store, identities) {
  for (const { siteId, path, dateKeys } of identities) {
    for (const dateKey of dateKeys) {
      const bucket = store[dateKey];
      if (!bucket) continue;
      const paths = bucket[siteId];
      if (!paths) continue;
      delete paths[path];
      if (Object.keys(paths).length === 0) delete bucket[siteId];
      if (Object.keys(bucket).length === 0) delete store[dateKey];
    }
  }
  return store;
}
