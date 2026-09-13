export function applySiteHourlyRangeDeletion(hourlyStore, fromKey, toKey, siteId) {
  const from = fromKey.length === 10 ? fromKey + 'T00' : fromKey;
  const to   = toKey.length   === 10 ? toKey   + 'T24' : toKey;
  const reductions = {};

  for (const hourKey of Object.keys(hourlyStore)) {
    if (hourKey < from || hourKey >= to) continue;
    const dayKey = hourKey.slice(0, 10);
    const bucket = hourlyStore[hourKey];
    const siteIds = siteId != null ? (bucket[siteId] ? [siteId] : []) : Object.keys(bucket);

    for (const sid of siteIds) {
      const rec = bucket[sid];
      if (!rec) continue;
      reductions[dayKey] ??= {};
      reductions[dayKey][sid] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
      reductions[dayKey][sid].activeMs  += rec.activeMs  ?? 0;
      reductions[dayKey][sid].audioMs   += rec.audioMs   ?? 0;
      reductions[dayKey][sid].overlapMs += rec.overlapMs ?? 0;
      reductions[dayKey][sid].idleMs    += rec.idleMs    ?? 0;
      delete bucket[sid];
    }
    if (Object.keys(bucket).length === 0) delete hourlyStore[hourKey];
  }

  return reductions;
}

export function applySiteDailyReductions(dailyStore, reductions) {
  for (const [dayKey, sites] of Object.entries(reductions)) {
    const dayBucket = dailyStore[dayKey];
    if (!dayBucket) continue;
    for (const [sid, amounts] of Object.entries(sites)) {
      const rec = dayBucket[sid];
      if (!rec) continue;
      rec.activeMs  = Math.max(0, (rec.activeMs  ?? 0) - amounts.activeMs);
      rec.audioMs   = Math.max(0, (rec.audioMs   ?? 0) - amounts.audioMs);
      rec.overlapMs = Math.max(0, (rec.overlapMs ?? 0) - amounts.overlapMs);
      rec.idleMs    = Math.max(0, (rec.idleMs    ?? 0) - amounts.idleMs);
      if (!rec.activeMs && !rec.audioMs && !rec.overlapMs && !rec.idleMs) delete dayBucket[sid];
    }
    if (Object.keys(dayBucket).length === 0) delete dailyStore[dayKey];
  }
}

export function applySubpageHourlyRangeDeletion(hourlyStore, fromKey, toKey, siteId) {
  const from = fromKey.length === 10 ? fromKey + 'T00' : fromKey;
  const to   = toKey.length   === 10 ? toKey   + 'T24' : toKey;
  const reductions = {};

  for (const hourKey of Object.keys(hourlyStore)) {
    if (hourKey < from || hourKey >= to) continue;
    const dayKey = hourKey.slice(0, 10);
    const bucket = hourlyStore[hourKey];
    const siteIds = siteId != null ? (bucket[siteId] ? [siteId] : []) : Object.keys(bucket);

    for (const sid of siteIds) {
      const paths = bucket[sid];
      if (!paths) continue;
      reductions[dayKey] ??= {};
      reductions[dayKey][sid] ??= {};
      for (const [path, rec] of Object.entries(paths)) {
        reductions[dayKey][sid][path] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        reductions[dayKey][sid][path].activeMs  += rec.activeMs  ?? 0;
        reductions[dayKey][sid][path].audioMs   += rec.audioMs   ?? 0;
        reductions[dayKey][sid][path].overlapMs += rec.overlapMs ?? 0;
        reductions[dayKey][sid][path].idleMs    += rec.idleMs    ?? 0;
      }
      delete bucket[sid];
    }
    if (Object.keys(bucket).length === 0) delete hourlyStore[hourKey];
  }

  return reductions;
}

export function applySubpageDailyReductions(dailyStore, reductions) {
  for (const [dayKey, sites] of Object.entries(reductions)) {
    const dayBucket = dailyStore[dayKey];
    if (!dayBucket) continue;
    for (const [sid, paths] of Object.entries(sites)) {
      const sitePaths = dayBucket[sid];
      if (!sitePaths) continue;
      for (const [path, amounts] of Object.entries(paths)) {
        const rec = sitePaths[path];
        if (!rec) continue;
        rec.activeMs  = Math.max(0, (rec.activeMs  ?? 0) - amounts.activeMs);
        rec.audioMs   = Math.max(0, (rec.audioMs   ?? 0) - amounts.audioMs);
        rec.overlapMs = Math.max(0, (rec.overlapMs ?? 0) - amounts.overlapMs);
        rec.idleMs    = Math.max(0, (rec.idleMs    ?? 0) - amounts.idleMs);
        if (!rec.activeMs && !rec.audioMs && !rec.overlapMs && !rec.idleMs) delete sitePaths[path];
      }
      if (Object.keys(sitePaths).length === 0) delete dayBucket[sid];
    }
    if (Object.keys(dayBucket).length === 0) delete dailyStore[dayKey];
  }
}

export function applyDirectDailyRangeDeletion(dailyStore, fromKey, toKey, siteId) {
  const from = fromKey.length === 10 ? fromKey + 'T00' : fromKey;
  const to   = toKey.length   === 10 ? toKey   + 'T24' : toKey;
  for (const dayKey of Object.keys(dailyStore)) {
    if (from > dayKey + 'T00' || to < dayKey + 'T24') continue;
    if (siteId != null) {
      delete dailyStore[dayKey][siteId];
      if (Object.keys(dailyStore[dayKey]).length === 0) delete dailyStore[dayKey];
    } else {
      delete dailyStore[dayKey];
    }
  }
}

export function applyDirectSubpageDailyRangeDeletion(dailyStore, fromKey, toKey, siteId) {
  const from = fromKey.length === 10 ? fromKey + 'T00' : fromKey;
  const to   = toKey.length   === 10 ? toKey   + 'T24' : toKey;
  for (const dayKey of Object.keys(dailyStore)) {
    if (from > dayKey + 'T00' || to < dayKey + 'T24') continue;
    if (siteId != null) {
      delete dailyStore[dayKey][siteId];
      if (Object.keys(dailyStore[dayKey]).length === 0) delete dailyStore[dayKey];
    } else {
      delete dailyStore[dayKey];
    }
  }
}

export function deleteSiteAllTime(store, siteId) {
  for (const dateKey of Object.keys(store)) {
    delete store[dateKey][siteId];
    if (Object.keys(store[dateKey]).length === 0) delete store[dateKey];
  }
}

