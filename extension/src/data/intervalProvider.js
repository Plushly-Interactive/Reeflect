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
// mergeDataSources, which merges these interval days with frozen legacy buckets. `msg.domains`
// narrows the path shapes to those domains; absent reads every domain.

export async function intervalFetch(msg) {
  switch (msg.type) {
    case QUERY_SITES_BY_DAY: return getSitesByDay();
    case QUERY_SUBPAGES_BY_DAY: return getSubpagesByDay(msg.domains ?? null);
    case QUERY_SUBPAGES_BY_HOUR: return getSubpagesByHour(msg.domains ?? null);
    case QUERY_SITES_BY_HOUR_TODAY: return getSitesByHour(localDayKey(Date.now()));
    case QUERY_SITES_BY_HOUR_FOR_DAY: return getSitesByHour(msg.dayKey);
    case QUERY_AVG_PER_CLOCK_HOUR: return getAvgPerClockHour(msg.siteIds, msg.range, msg.dayKeys);
    default: return undefined;
  }
}
