import {
  getSitesByDay, getSitesByHour, getSubpagesByDay, getSubpagesByHour, getAvgPerClockHour,
} from './intervalAggregates.js';
import { localDayKey } from '../shared/timeUtils.js';
import {
  QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY, QUERY_SITES_BY_HOUR_FOR_DAY,
  QUERY_SUBPAGES_BY_DAY, QUERY_SUBPAGES_BY_HOUR, QUERY_AVG_PER_CLOCK_HOUR,
} from '../shared/queryTypes.js';

// The interval-log reader behind the dashboards: answers the same message shapes
// as the scalar background API, served from intervalAggregates instead. Wrapped by
// mergeDataSources, which merges these interval days with frozen legacy buckets.
function hoursForDay(byHour, dayKey) {
  const out = {};
  for (const [hourKey, cells] of Object.entries(byHour)) {
    if (hourKey.slice(0, 10) === dayKey) out[hourKey] = cells;
  }
  return out;
}

export async function intervalFetch(msg) {
  switch (msg.type) {
    case QUERY_SITES_BY_DAY: return getSitesByDay();
    case QUERY_SUBPAGES_BY_DAY: return getSubpagesByDay();
    case QUERY_SUBPAGES_BY_HOUR: return getSubpagesByHour();
    case QUERY_SITES_BY_HOUR_TODAY: return hoursForDay(await getSitesByHour(), localDayKey(Date.now()));
    case QUERY_SITES_BY_HOUR_FOR_DAY: return hoursForDay(await getSitesByHour(), msg.dayKey);
    case QUERY_AVG_PER_CLOCK_HOUR: return getAvgPerClockHour(msg.siteIds, msg.range, msg.dayKeys);
    default: return undefined;
  }
}
