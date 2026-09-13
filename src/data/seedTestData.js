import { localDayKey } from '../shared/timeUtils.js';
import { host } from '../shared/host.js';

const SITES = {
  'youtube.com':          { peaks: [[19,23,1.0],[12,14,0.6],[15,18,0.5]], peakMaxMin: 35, weekendFactor: 1.7, skipDayProb: 0.10, audioFraction: 0.65 },
  'github.com':           { peaks: [[9,12,1.0],[14,17,0.9],[20,22,0.3]], peakMaxMin: 30, weekendFactor: 0.2, skipDayProb: 0.20, audioFraction: 0 },
  'reddit.com':           { peaks: [[12,13,1.0],[19,23,0.9],[15,17,0.5]], peakMaxMin: 22, weekendFactor: 1.5, skipDayProb: 0.15, audioFraction: 0 },
  'news.ycombinator.com': { peaks: [[7,9,1.0],[12,13,0.7],[18,19,0.5]],  peakMaxMin: 12, weekendFactor: 0.5, skipDayProb: 0.30, audioFraction: 0 },
  'bbc.co.uk':            { peaks: [[7,8,1.0],[18,20,0.8],[12,13,0.5]],  peakMaxMin: 10, weekendFactor: 0.8, skipDayProb: 0.25, audioFraction: 0.08 },
};
const SLEEP_HOURS = new Set([0,1,2,3,4,5,6]);
const MAX_HOUR_MS = 2 * 3_600_000;
const DAYS_BACK = 365 * 3;

function hourWeight(profile, h) {
  let w = 0;
  for (const [start, end, weight] of profile.peaks) {
    if (h >= start && h <= end) w = Math.max(w, weight);
  }
  return w;
}

function visitsForMs(ms) {
  if (ms < 60_000) return 0;
  if (ms < 5 * 60_000) return 1;
  return 1 + Math.floor(ms / (10 * 60_000));
}

export async function seedTestData() {
  const now = new Date();
  const todayKey = localDayKey(now.getTime());
  const currentHour = now.getHours();
  const sitesByDay = {}, sitesByHour = {};

  for (let d = 0; d < DAYS_BACK; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const dayKey = localDayKey(day.getTime());
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = dayKey === todayKey;

    const skip = {};
    for (const siteId of Object.keys(SITES)) skip[siteId] = Math.random() < SITES[siteId].skipDayProb;

    const dayTotals = {};
    const lastHour = isToday ? currentHour : 23;

    for (let h = 0; h <= lastHour; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      const perSiteMs = {};
      let totalMs = 0;

      if (!SLEEP_HOURS.has(h)) {
        for (const [siteId, profile] of Object.entries(SITES)) {
          if (skip[siteId]) continue;
          let w = hourWeight(profile, h);
          if (w === 0) continue;
          if (isWeekend) w *= profile.weekendFactor;
          const minutes = w * profile.peakMaxMin * (0.4 + Math.random() * 0.9);
          const ms = Math.floor(minutes * 60_000);
          if (ms <= 0) continue;
          perSiteMs[siteId] = ms;
          totalMs += ms;
        }
      }

      if (totalMs > MAX_HOUR_MS) {
        const scale = MAX_HOUR_MS / totalMs;
        for (const k of Object.keys(perSiteMs)) perSiteMs[k] = Math.floor(perSiteMs[k] * scale);
      }

      if (Object.keys(perSiteMs).length === 0) continue;

      sitesByHour[hourKey] = {};
      for (const [siteId, ms] of Object.entries(perSiteMs)) {
        const profile = SITES[siteId];
        const visits = visitsForMs(ms);
        const audioMs = profile.audioFraction > 0
          ? Math.floor(ms * profile.audioFraction * (0.7 + Math.random() * 0.3))
          : 0;
        const overlapMs = audioMs > 0
          ? Math.floor(audioMs * (0.3 + Math.random() * 0.5))
          : 0;
        sitesByHour[hourKey][siteId] = { activeMs: ms, audioMs, overlapMs, visits };
        dayTotals[siteId] ??= { activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0 };
        dayTotals[siteId].activeMs += ms;
        dayTotals[siteId].audioMs += audioMs;
        dayTotals[siteId].overlapMs += overlapMs;
        dayTotals[siteId].visits += visits;
      }
    }

    sitesByDay[dayKey] = dayTotals;
  }

  await host.prefs.set({ sitesByDay, sitesByHour });
}
