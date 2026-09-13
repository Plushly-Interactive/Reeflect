import { SITES_DAY_KEY, SITES_HOUR_KEY, WALLCLOCK_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY } from './bucketKeys.js';
import { localDayKey } from '../shared/timeUtils.js';
import {
  QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY, QUERY_SITES_BY_HOUR_FOR_DAY,
  QUERY_SUBPAGES_BY_DAY, QUERY_SUBPAGES_BY_HOUR, QUERY_AVG_PER_CLOCK_HOUR,
} from '../shared/queryTypes.js';
import { host } from '../shared/host.js';

// Page-side reader for the frozen legacy buckets, answering the same message shapes
// as the background API but reading chrome.storage.local directly. The background's
// bucket handlers existed to fold the service worker's live un-flushed snapshot into
// the stored buckets; post-cutover the interval tracker is the only live capturer
// and nothing writes buckets in the worker, so there is no live tier to merge and
// these are plain storage reads. mergeDataSources uses this for legacy days instead
// of the SW round-trip.

function hoursForDay(byHour, dayKey) {
  const out = {};
  for (let h = 0; h < 24; h++) {
    const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
    if (byHour[hourKey]) out[hourKey] = byHour[hourKey];
  }
  return out;
}

const browsing = c => (c?.activeMs ?? 0) + (c?.audioMs ?? 0) - (c?.overlapMs ?? 0);

// Mirrors the background's getAvgPerClockHour: per-site sums use active+audio-overlap;
// the aggregate (no siteIds) uses deduplicated wall-clock time, falling back to the
// per-site browsing sum for hours that predate wall-clock tracking.
async function avgPerClockHour(siteIds, range, dayKeys) {
  const { [SITES_HOUR_KEY]: byHour = {}, [WALLCLOCK_HOUR_KEY]: wallClock = {} } =
    await host.prefs.get([SITES_HOUR_KEY, WALLCLOCK_HOUR_KEY]);

  if (!dayKeys) {
    const now = new Date();
    const todayKey = localDayKey(now.getTime());
    if (range === 'all') {
      const hourKeys = Object.keys(byHour);
      if (hourKeys.length === 0) {
        dayKeys = [];
      } else {
        const dates = hourKeys.map(k => k.slice(0, 10)).sort();
        const [y, m, d] = dates[0].split('-').map(Number);
        dayKeys = [];
        for (let date = new Date(y, m - 1, d); ; date.setDate(date.getDate() + 1)) {
          const k = localDayKey(date.getTime());
          if (k === todayKey) break;
          dayKeys.push(k);
        }
      }
    } else {
      const days = parseInt(range);
      dayKeys = [];
      for (let i = 1; i <= days; i++) {
        const day = new Date(now);
        day.setDate(day.getDate() - i);
        dayKeys.push(localDayKey(day.getTime()));
      }
    }
  }

  const D = dayKeys.length;
  if (D === 0) return new Array(24).fill(0);
  const sums = new Array(24).fill(0);
  for (const dayKey of dayKeys) {
    for (let h = 0; h < 24; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      const bucket = byHour[hourKey];
      if (!bucket) continue;
      if (siteIds?.length) {
        for (const id of siteIds) sums[h] += browsing(bucket[id]);
      } else {
        sums[h] += wallClock[hourKey] ?? Object.values(bucket).reduce((s, c) => s + browsing(c), 0);
      }
    }
  }
  return sums.map(s => s / D);
}

export async function bucketFetch(msg) {
  switch (msg.type) {
    case QUERY_SITES_BY_DAY: {
      const { [SITES_DAY_KEY]: v = {} } = await host.prefs.get(SITES_DAY_KEY);
      return v;
    }
    case QUERY_SUBPAGES_BY_DAY: {
      const { [SUBPAGES_DAY_KEY]: v = {} } = await host.prefs.get(SUBPAGES_DAY_KEY);
      return v;
    }
    case QUERY_SUBPAGES_BY_HOUR: {
      const { [SUBPAGES_HOUR_KEY]: v = {} } = await host.prefs.get(SUBPAGES_HOUR_KEY);
      return v;
    }
    case QUERY_SITES_BY_HOUR_TODAY: {
      const { [SITES_HOUR_KEY]: v = {} } = await host.prefs.get(SITES_HOUR_KEY);
      return hoursForDay(v, localDayKey(Date.now()));
    }
    case QUERY_SITES_BY_HOUR_FOR_DAY: {
      const { [SITES_HOUR_KEY]: v = {} } = await host.prefs.get(SITES_HOUR_KEY);
      return hoursForDay(v, msg.dayKey);
    }
    case QUERY_AVG_PER_CLOCK_HOUR:
      return avgPerClockHour(msg.siteIds, msg.range, msg.dayKeys);
    default:
      return undefined;
  }
}
