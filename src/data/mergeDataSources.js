import { intervalFetch } from './intervalProvider.js';
import { bucketFetch } from './bucketProvider.js';
import { earliestDayKey, getDeviceFilter } from './intervalAggregates.js';
import { deviceId } from '../data/intervalLog.js';
import { fetchTrackingData, isMockMode } from '../shared/tourMockData.js';
import { localDayKey } from '../shared/timeUtils.js';
import {
  QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY, QUERY_SITES_BY_HOUR_FOR_DAY,
  QUERY_SUBPAGES_BY_DAY, QUERY_SUBPAGES_BY_HOUR, QUERY_AVG_PER_CLOCK_HOUR,
} from '../shared/queryTypes.js';

// The Phase B authoritative tracking-data reader for the main dashboard and
// site/path pages. Promotes the interval log to the single source of truth, merging
// the frozen legacy buckets underneath for days before interval tracking began.
//
// The boundary is data presence, not a stored marker: earliestDayKey() is the
// first day with interval data; days strictly before it read buckets (bucketFetch),
// that day and after read intervals (intervalFetch). 'YYYY-MM-DD' / 'YYYY-MM-DDTHH'
// keys compare lexicographically = chronologically, so a plain string '<' is the
// split.
//
// Both tiers are read page-side by plain functions: intervalFetch from IndexedDB,
// bucketFetch from chrome.storage.local. The buckets used to be read through the
// background message API, but post-cutover nothing writes them in the worker, so the
// API's live-snapshot merge was moot for this reader (which never queries buckets
// for today anyway). bucketFetch drops that round-trip.
//
// Failsafes: in mock mode (guided tour) the fixtures are returned alone, no
// interval merge; when the log is empty (boundary null) every read falls through
// to buckets, exactly as before interval tracking existed.

// The legacy buckets were written by this browser before interval tracking: they are this
// device's history. A device filter that leaves this device out reads them as empty.
async function bucketsVisible() {
  const filter = getDeviceFilter();
  return filter === null || filter.includes(await deviceId());
}

async function buckets(msg) {
  if (await bucketsVisible()) return bucketFetch(msg);
  return msg.type === QUERY_AVG_PER_CLOCK_HOUR ? new Array(24).fill(0) : {};
}

// Per-day dict shapes ({ dayKey: ... }): legacy bucket days, then every interval
// day on top (interval keys are all >= boundary by construction).
async function mergeByDay(msg, boundary) {
  const [iv, bk] = await Promise.all([intervalFetch(msg), buckets(msg)]);
  const out = {};
  for (const dayKey in bk) if (dayKey < boundary) out[dayKey] = bk[dayKey];
  return Object.assign(out, iv);
}

// Per-hour dict shapes ({ hourKey: ... }): same split, keyed on the hour's day.
async function mergeByHour(msg, boundary) {
  const [iv, bk] = await Promise.all([intervalFetch(msg), buckets(msg)]);
  const out = {};
  for (const hourKey in bk) if (hourKey.slice(0, 10) < boundary) out[hourKey] = bk[hourKey];
  return Object.assign(out, iv);
}

// The day-set the avg-per-clock-hour chart averages over (always excludes today),
// split at the boundary. An explicit dayKeys (drill mode) is used as-is; otherwise
// a numeric range = the n days before today and 'all' = the union of both tiers'
// day keys.
async function partitionAvgDays(msg, boundary) {
  const today = localDayKey(Date.now());
  let days;
  if (Array.isArray(msg.dayKeys)) {
    days = msg.dayKeys;
  } else {
    const n = parseInt(msg.range);
    days = [];
    if (msg.range === 'all') {
      const [iByDay, bByDay] = await Promise.all([
        intervalFetch({ type: QUERY_SITES_BY_DAY }),
        buckets({ type: QUERY_SITES_BY_DAY }),
      ]);
      days = [...new Set([...Object.keys(iByDay), ...Object.keys(bByDay)])];
    } else if (Number.isFinite(n)) {
      for (let i = 1; i <= n; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(localDayKey(d.getTime()));
      }
    }
  }
  const intervalDays = [], bucketDays = [];
  const withBuckets = await bucketsVisible();
  for (const d of days) {
    if (d === today) continue;
    if (d >= boundary) intervalDays.push(d);
    else if (withBuckets) bucketDays.push(d);
  }
  return { intervalDays, bucketDays };
}

// Avg-per-clock-hour returns a 24-array already averaged over its day-set, so it
// can't be key-merged. The stitch owns the day-set, asks each tier for its own
// day subset, then recombines weighted by day count: (arrI*Di + arrB*Db)/(Di+Db).
async function mergeAvg(msg, boundary) {
  const { intervalDays, bucketDays } = await partitionAvgDays(msg, boundary);
  const Di = intervalDays.length, Db = bucketDays.length, D = Di + Db;
  if (D === 0) return new Array(24).fill(0);
  const [arrI, arrB] = await Promise.all([
    Di ? intervalFetch({ ...msg, dayKeys: intervalDays }) : null,
    Db ? bucketFetch({ ...msg, dayKeys: bucketDays }) : null,
  ]);
  const out = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) out[h] = ((arrI?.[h] ?? 0) * Di + (arrB?.[h] ?? 0) * Db) / D;
  return out;
}

export async function loadMergedTrackingData(msg) {
  if (await isMockMode()) return fetchTrackingData(msg);
  const boundary = await earliestDayKey();
  if (boundary === null) return buckets(msg);
  switch (msg.type) {
    case QUERY_SITES_BY_DAY:
    case QUERY_SUBPAGES_BY_DAY:
      return mergeByDay(msg, boundary);
    case QUERY_SUBPAGES_BY_HOUR:
      return mergeByHour(msg, boundary);
    case QUERY_SITES_BY_HOUR_TODAY:
      return intervalFetch(msg);
    case QUERY_SITES_BY_HOUR_FOR_DAY:
      return msg.dayKey >= boundary ? intervalFetch(msg) : buckets(msg);
    case QUERY_AVG_PER_CLOCK_HOUR:
      return mergeAvg(msg, boundary);
    default:
      return buckets(msg);
  }
}
