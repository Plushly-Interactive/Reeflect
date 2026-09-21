import { localDayKey, dayKeysForRange, formatMs, formatHourLabel, formatHourRange, formatTimeOfDay } from './timeUtils.js';
import { PREF_FIRST_BROWSE_BY_DAY } from './prefKeys.js';
import { QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY, QUERY_AVG_PER_CLOCK_HOUR } from './queryTypes.js';
import { loadMergedTrackingData } from '../data/mergeDataSources.js';
import { getWallByHour, getFirstBrowseByDay } from '../data/intervalAggregates.js';
import { host } from './host.js';

// The six overview stats for a period: the popup shows them for today, the dashboard card for the
// period picked in the header. "today" compares today so far with the same hours of the past 7
// days; a longer period compares its total with the period of the same length right before it,
// takes its peak hour from the per-clock-hour average, and averages the first browse of its days.
const browsing = c => (c?.activeMs ?? 0) + (c?.audioMs ?? 0) - (c?.overlapMs ?? 0);

function sumDays(byDay, days) {
  const sites = new Set();
  let totalMs = 0, visits = 0, idleMs = 0;
  for (const day of days) {
    for (const [siteId, c] of Object.entries(byDay[day] ?? {})) {
      if ((c.visits ?? 0) > 0 || (c.activeMs ?? 0) > 0) sites.add(siteId);
      totalMs += browsing(c);
      visits += c.visits ?? 0;
      idleMs += c.idleMs ?? 0;
    }
  }
  return { sites: sites.size, totalMs, visits, idleMs };
}

async function firstBrowseByDay() {
  const [fromIntervals, { [PREF_FIRST_BROWSE_BY_DAY]: fromPrefs = {} }] =
    await Promise.all([getFirstBrowseByDay(), host.prefs.get([PREF_FIRST_BROWSE_BY_DAY])]);
  return { ...fromPrefs, ...fromIntervals };
}

async function todayStats(byDay) {
  const today = localDayKey(Date.now());
  const currentHour = new Date().getHours();
  const [todayHours, wallByHour, firstBrowse] = await Promise.all([
    loadMergedTrackingData({ type: QUERY_SITES_BY_HOUR_TODAY }),
    getWallByHour(),
    firstBrowseByDay(),
  ]);

  // Wall-clock per hour (union across parallel windows); an hour missing from wallByHour
  // (a legacy bucket hour) falls back to the per-site sum.
  const hourWallMs = h => {
    const hourKey = `${today}T${String(h).padStart(2, '0')}`;
    if (wallByHour[hourKey] != null) return wallByHour[hourKey];
    return Object.values(todayHours[hourKey] ?? {}).reduce((s, c) => s + browsing(c), 0);
  };
  let totalMs = 0;
  for (let h = 0; h <= currentHour; h++) totalMs += hourWallMs(h);

  const pastDayKeys = Object.keys(byDay).filter(k => k !== today).sort().slice(-7);
  let avgMs = 0;
  if (pastDayKeys.length > 0) {
    const avgPerHour = await loadMergedTrackingData({ type: QUERY_AVG_PER_CLOCK_HOUR, dayKeys: pastDayKeys });
    avgMs = avgPerHour.slice(0, currentHour + 1).reduce((s, v) => s + v, 0);
  }

  const hourMs = Array.from({ length: 24 }, (_, h) => {
    const bucket = todayHours[`${today}T${String(h).padStart(2, '0')}`] ?? {};
    return { ms: hourWallMs(h), visits: Object.values(bucket).reduce((s, c) => s + (c.visits ?? 0), 0) };
  });
  let peakHour = -1, peakMs = 0, firstBrowseHour = -1;
  for (let h = 0; h < 24; h++) {
    if (hourMs[h].ms > peakMs) { peakMs = hourMs[h].ms; peakHour = h; }
    if (firstBrowseHour === -1 && (hourMs[h].ms > 0 || hourMs[h].visits > 0)) firstBrowseHour = h;
  }

  return {
    ...sumDays(byDay, [today]),
    totalMs,
    vsMs: avgMs > 0 ? totalMs - avgMs : null,
    peakHour,
    firstBrowseTs: firstBrowse[today] ?? null,
    firstBrowseHour,
    hourMs,
  };
}

async function multiDayStats(range, byDay) {
  const days = dayKeysForRange(range, byDay);
  const sums = sumDays(byDay, days);

  let vsMs = null;
  if (range !== 'all') {
    const before = days.map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - days.length - i);
      return localDayKey(d.getTime());
    });
    const beforeMs = sumDays(byDay, before).totalMs;
    if (beforeMs > 0) vsMs = sums.totalMs - beforeMs;
  }

  const [avgPerHour, firstBrowse] = await Promise.all([
    loadMergedTrackingData({ type: QUERY_AVG_PER_CLOCK_HOUR, siteIds: null, ...(range === 'all' ? { range } : { dayKeys: days }) }),
    firstBrowseByDay(),
  ]);
  let peakHour = -1, peakMs = 0;
  avgPerHour.forEach((ms, h) => { if (ms > peakMs) { peakMs = ms; peakHour = h; } });

  // Average time of day of the first browse, over the days of the period that have one.
  const minutes = days.filter(d => firstBrowse[d]).map(d => {
    const at = new Date(firstBrowse[d]);
    return at.getHours() * 60 + at.getMinutes();
  });
  const avgMinutes = minutes.length ? Math.round(minutes.reduce((s, m) => s + m, 0) / minutes.length) : null;

  return {
    ...sums,
    vsMs,
    peakHour,
    firstBrowseTs: avgMinutes === null ? null : new Date().setHours(0, avgMinutes, 0, 0),
    firstBrowseHour: -1,
  };
}

export async function periodStats(range, byDay) {
  byDay ??= await loadMergedTrackingData({ type: QUERY_SITES_BY_DAY });
  return range === 'today' ? todayStats(byDay) : multiDayStats(range, byDay);
}

// The display strings of the six stats; "—" stands for no data.
export function formatPeriodStats(stats, clockFormat) {
  return {
    total: stats.totalMs > 0 ? formatMs(stats.totalMs) : '—',
    sites: stats.sites > 0 ? String(stats.sites) : '—',
    vs: stats.vsMs === null ? '—' : (stats.vsMs >= 0 ? '+' : '-') + formatMs(Math.abs(stats.vsMs)),
    peakHour: stats.peakHour >= 0 ? formatHourRange(stats.peakHour, '–', clockFormat) : '—',
    firstBrowse: stats.firstBrowseTs ? formatTimeOfDay(stats.firstBrowseTs, clockFormat)
      : stats.firstBrowseHour >= 0 ? formatHourLabel(stats.firstBrowseHour, clockFormat)
      : '—',
    visits: stats.visits > 0 ? String(stats.visits) : '—',
    idle: stats.idleMs > 0 ? formatMs(stats.idleMs) : '—',
  };
}
