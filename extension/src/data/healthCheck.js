const FIELDS = ['activeMs', 'audioMs', 'overlapMs', 'idleMs'];

function isInvalid(v) {
  return v == null || typeof v !== 'number' || !isFinite(v) || v < 0;
}

function checkSiteConsistency(sitesByDay, sitesByHour, issues) {
  const sums = {};
  for (const [hourKey, bucket] of Object.entries(sitesByHour)) {
    const day = hourKey.slice(0, 10);
    for (const [sid, rec] of Object.entries(bucket)) {
      sums[day] ??= {};
      sums[day][sid] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
      for (const f of FIELDS) sums[day][sid][f] += rec[f] ?? 0;
    }
  }
  for (const [day, sites] of Object.entries(sums)) {
    for (const [sid, sum] of Object.entries(sites)) {
      const daily = sitesByDay[day]?.[sid];
      if (!daily) {
        issues.push({ type: 'orphan', store: 'sitesByHour', dayKey: day, hourKey: null, siteId: sid, path: null, desc: 'no matching daily entry' });
      } else {
        const drifted = FIELDS.filter(f => (daily[f] ?? 0) !== sum[f]);
        if (drifted.length) {
          issues.push({ type: 'drift', store: 'sitesByDay', dayKey: day, hourKey: null, siteId: sid, path: null,
            desc: drifted.map(f => `${f}: daily ${daily[f] ?? 0} ≠ hourly ${sum[f]}`).join('; ') });
        }
      }
    }
  }
}

function checkSubpageConsistency(subpagesByDay, subpagesByHour, issues) {
  const sums = {};
  for (const [hourKey, bucket] of Object.entries(subpagesByHour)) {
    const day = hourKey.slice(0, 10);
    for (const [sid, paths] of Object.entries(bucket)) {
      for (const [path, rec] of Object.entries(paths)) {
        sums[day] ??= {};
        sums[day][sid] ??= {};
        sums[day][sid][path] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        for (const f of FIELDS) sums[day][sid][path][f] += rec[f] ?? 0;
      }
    }
  }
  for (const [day, sites] of Object.entries(sums)) {
    for (const [sid, paths] of Object.entries(sites)) {
      for (const [path, sum] of Object.entries(paths)) {
        const daily = subpagesByDay[day]?.[sid]?.[path];
        if (!daily) {
          issues.push({ type: 'orphan', store: 'subpagesByHour', dayKey: day, hourKey: null, siteId: sid, path, desc: 'no matching daily entry' });
        } else {
          const drifted = FIELDS.filter(f => (daily[f] ?? 0) !== sum[f]);
          if (drifted.length) {
            issues.push({ type: 'drift', store: 'subpagesByDay', dayKey: day, hourKey: null, siteId: sid, path,
              desc: drifted.map(f => `${f}: daily ${daily[f] ?? 0} ≠ hourly ${sum[f]}`).join('; ') });
          }
        }
      }
    }
  }
}

function checkFutureDated(store, storeName, today, issues) {
  for (const key of Object.keys(store)) {
    if (key.slice(0, 10) > today) {
      const isHour = key.length > 10;
      issues.push({ type: 'future-dated', store: storeName,
        dayKey: isHour ? null : key, hourKey: isHour ? key : null,
        siteId: null, path: null, desc: 'dated after today' });
    }
  }
}

function checkInvalidSites(store, storeName, issues) {
  for (const [dateKey, bucket] of Object.entries(store)) {
    const isHour = dateKey.length > 10;
    for (const [sid, rec] of Object.entries(bucket)) {
      for (const f of FIELDS) {
        if (isInvalid(rec[f])) {
          issues.push({ type: 'invalid', store: storeName,
            dayKey: isHour ? null : dateKey, hourKey: isHour ? dateKey : null,
            siteId: sid, path: null, desc: `${f} = ${rec[f]}` });
          break;
        }
      }
    }
  }
}

function checkInvalidSubpages(store, storeName, issues) {
  for (const [dateKey, bucket] of Object.entries(store)) {
    const isHour = dateKey.length > 10;
    for (const [sid, paths] of Object.entries(bucket)) {
      for (const [path, rec] of Object.entries(paths)) {
        for (const f of FIELDS) {
          if (isInvalid(rec[f])) {
            issues.push({ type: 'invalid', store: storeName,
              dayKey: isHour ? null : dateKey, hourKey: isHour ? dateKey : null,
              siteId: sid, path, desc: `${f} = ${rec[f]}` });
            break;
          }
        }
      }
    }
  }
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkOrphanedSubpageDaily(sitesByDay, subpagesByDay, issues) {
  for (const [day, sitePaths] of Object.entries(subpagesByDay)) {
    for (const siteId of Object.keys(sitePaths)) {
      if (!sitesByDay[day]?.[siteId]) {
        issues.push({ type: 'orphan', store: 'subpagesByDay', dayKey: day, hourKey: null, siteId, path: null,
          desc: 'subpage daily entry has no parent site daily entry' });
      }
    }
  }
}

export function checkHealth({ sitesByDay, sitesByHour, subpagesByDay, subpagesByHour }) {
  const issues = [];
  const today = localDateKey();
  checkSiteConsistency(sitesByDay, sitesByHour, issues);
  checkSubpageConsistency(subpagesByDay, subpagesByHour, issues);
  checkOrphanedSubpageDaily(sitesByDay, subpagesByDay, issues);
  checkFutureDated(sitesByDay, 'sitesByDay', today, issues);
  checkFutureDated(sitesByHour, 'sitesByHour', today, issues);
  checkFutureDated(subpagesByDay, 'subpagesByDay', today, issues);
  checkFutureDated(subpagesByHour, 'subpagesByHour', today, issues);
  checkInvalidSites(sitesByDay, 'sitesByDay', issues);
  checkInvalidSites(sitesByHour, 'sitesByHour', issues);
  checkInvalidSubpages(subpagesByDay, 'subpagesByDay', issues);
  checkInvalidSubpages(subpagesByHour, 'subpagesByHour', issues);
  return issues;
}

export function applyRepairs(stores, issues) {
  const { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour } = stores;

  for (const issue of issues) {
    const dateKey = issue.hourKey ?? issue.dayKey;

    if (issue.type === 'drift' || issue.type === 'orphan') {
      if (issue.store === 'subpagesByDay' && issue.path == null) {
        const sum = { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        let hasHourly = false;
        for (const [hourKey, bucket] of Object.entries(sitesByHour)) {
          if (hourKey.slice(0, 10) !== issue.dayKey) continue;
          const rec = bucket[issue.siteId];
          if (rec) { hasHourly = true; for (const f of FIELDS) sum[f] += rec[f] ?? 0; }
        }
        if (!hasHourly) {
          for (const rec of Object.values(subpagesByDay[issue.dayKey]?.[issue.siteId] ?? {}))
            for (const f of FIELDS) sum[f] += rec[f] ?? 0;
        }
        if (FIELDS.some(f => sum[f] > 0)) {
          sitesByDay[issue.dayKey] ??= {};
          const existing = sitesByDay[issue.dayKey][issue.siteId] ?? {};
          sitesByDay[issue.dayKey][issue.siteId] = { ...existing, ...sum };
        }
      } else if (issue.path != null) {
        const subSum = { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        for (const [hourKey, bucket] of Object.entries(subpagesByHour)) {
          if (hourKey.slice(0, 10) !== issue.dayKey) continue;
          const rec = bucket[issue.siteId]?.[issue.path];
          if (rec) for (const f of FIELDS) subSum[f] += rec[f] ?? 0;
        }
        if (FIELDS.every(f => !subSum[f])) {
          if (subpagesByDay[issue.dayKey]?.[issue.siteId]) {
            delete subpagesByDay[issue.dayKey][issue.siteId][issue.path];
            if (!Object.keys(subpagesByDay[issue.dayKey][issue.siteId]).length) delete subpagesByDay[issue.dayKey][issue.siteId];
            if (!Object.keys(subpagesByDay[issue.dayKey]).length) delete subpagesByDay[issue.dayKey];
          }
        } else {
          subpagesByDay[issue.dayKey] ??= {};
          subpagesByDay[issue.dayKey][issue.siteId] ??= {};
          const existing = subpagesByDay[issue.dayKey][issue.siteId][issue.path] ?? {};
          subpagesByDay[issue.dayKey][issue.siteId][issue.path] = { ...existing, ...subSum };
        }
        for (const [hourKey, bucket] of Object.entries(subpagesByHour)) {
          if (hourKey.slice(0, 10) !== issue.dayKey) continue;
          const sitePaths = bucket[issue.siteId];
          if (!sitePaths || sitesByHour[hourKey]?.[issue.siteId]) continue;
          const hourSum = { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
          for (const rec of Object.values(sitePaths)) for (const f of FIELDS) hourSum[f] += rec[f] ?? 0;
          if (FIELDS.some(f => hourSum[f] > 0)) { sitesByHour[hourKey] ??= {}; sitesByHour[hourKey][issue.siteId] = hourSum; }
        }
        if (!sitesByDay[issue.dayKey]?.[issue.siteId]) {
          const siteSum = { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
          for (const [hourKey, bucket] of Object.entries(sitesByHour)) {
            if (hourKey.slice(0, 10) !== issue.dayKey) continue;
            const rec = bucket[issue.siteId];
            if (rec) for (const f of FIELDS) siteSum[f] += rec[f] ?? 0;
          }
          if (FIELDS.some(f => siteSum[f] > 0)) {
            sitesByDay[issue.dayKey] ??= {};
            sitesByDay[issue.dayKey][issue.siteId] = siteSum;
          }
        }
      } else {
        const sum = { activeMs: 0, audioMs: 0, overlapMs: 0, idleMs: 0 };
        for (const [hourKey, bucket] of Object.entries(sitesByHour)) {
          if (hourKey.slice(0, 10) !== issue.dayKey) continue;
          const rec = bucket[issue.siteId];
          if (rec) for (const f of FIELDS) sum[f] += rec[f] ?? 0;
        }
        sitesByDay[issue.dayKey] ??= {};
        if (FIELDS.every(f => !sum[f])) {
          delete sitesByDay[issue.dayKey][issue.siteId];
          if (!Object.keys(sitesByDay[issue.dayKey]).length) delete sitesByDay[issue.dayKey];
        } else {
          const existing = sitesByDay[issue.dayKey][issue.siteId] ?? {};
          sitesByDay[issue.dayKey][issue.siteId] = { ...existing, ...sum };
        }
      }
    } else if (issue.type === 'future-dated') {
      delete stores[issue.store][dateKey];
    } else if (issue.type === 'invalid') {
      const store = stores[issue.store];
      if (issue.path != null) {
        const rec = store[dateKey]?.[issue.siteId]?.[issue.path];
        if (rec) {
          for (const f of FIELDS) if (isInvalid(rec[f])) rec[f] = 0;
          if (FIELDS.every(f => !rec[f])) {
            delete store[dateKey][issue.siteId][issue.path];
            if (!Object.keys(store[dateKey][issue.siteId]).length) delete store[dateKey][issue.siteId];
            if (!Object.keys(store[dateKey]).length) delete store[dateKey];
          }
        }
      } else {
        const rec = store[dateKey]?.[issue.siteId];
        if (rec) {
          for (const f of FIELDS) if (isInvalid(rec[f])) rec[f] = 0;
          if (FIELDS.every(f => !rec[f])) {
            delete store[dateKey][issue.siteId];
            if (!Object.keys(store[dateKey]).length) delete store[dateKey];
          }
        }
      }
    }
  }
}
