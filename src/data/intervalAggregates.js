import { allIntervals, SESSION_GAP_MS } from './intervalLog.js';
import { localDayKey, localHourKey } from '../shared/timeUtils.js';

// Reconstructs the site dashboard's data shapes from the domain+path interval
// log — everything is DERIVED from the ranges, nothing is pre-stored.
//
//  - active/audio time per domain per hour = UNION of that domain's path ranges
//    (parallel same-site windows counted once), capped at one hour, summed into
//    the day. Matches the scalar site tracker.
//  - visits per domain = number of NON-CONTIGUOUS active intervals for the
//    domain (all its paths merged; abutting path ranges are one continuous
//    domain interval, a real gap splits it). Each interval is credited to its
//    start day. Within-site navigation doesn't bump it; leaving and returning
//    does — matching the scalar site-visit count for foreground browsing.
//  - wall-clock per hour = union of every site's active+audio (the aggregate the
//    "avg per clock hour" chart uses).

const HOUR_CAP = 3600000;

let cachePromise = null;

function* hourBounds(from, to) {
  let t = from;
  while (t < to) {
    const nextHour = new Date(t);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const end = Math.min(nextHour.getTime(), to);
    yield { hourKey: localHourKey(t), from: t, to: end };
    t = end;
  }
}

function unionLen(ranges) {
  if (ranges.length === 0) return 0;
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0, [cs, ce] = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const [s, e] = ranges[i];
    if (s > ce) { total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}

// active/audio/overlap for one cell (domain or domain+path) within one hour.
// overlap = active∩audio via inclusion-exclusion (|A|+|B|-|A∪B|) — reuses
// unionLen instead of a separate intersect sweep. Every segment is already
// hour-clamped by hourBounds, so all three terms are ≤ HOUR_CAP and exact.
function cellMs(active, audio) {
  const activeMs = Math.min(unionLen(active), HOUR_CAP);
  const audioMs = Math.min(unionLen(audio), HOUR_CAP);
  const unionMs = Math.min(unionLen([...active, ...audio]), HOUR_CAP);
  return { activeMs, audioMs, overlapMs: activeMs + audioMs - unionMs };
}

// Merge a key's presence (active+audio+idle) into disjoint runs and credit one
// visit per run that contains active presence, to the run's start day. Audio/idle
// during an active gap keep the run open; SESSION_GAP_MS bridges sub-second seams
// so a row boundary and a visit boundary agree. Background-audio-only → 0 visits.
function creditVisits(items, onVisit) {
  items.sort((a, b) => a.from - b.from);
  let cs = items[0].from, ce = items[0].to, hasActive = items[0].active;
  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    if (it.from <= ce + SESSION_GAP_MS) {        // same run — active/audio/idle bridges
      if (it.to > ce) ce = it.to;
      if (it.active) hasActive = true;
    } else {
      if (hasActive) onVisit(cs);                 // count only runs that had active
      cs = it.from; ce = it.to; hasActive = it.active;
    }
  }
  if (hasActive) onVisit(cs);
}

// Every cell (day AND hour, site AND subpage) carries visits — the site "today"
// view and dashboard read per-hour visits, matching scalar's dual byDay/byHour
// increment. idleMs is day-level only (accumulated in the main loop, not hourly).
const zeroCell = () => ({ activeMs: 0, audioMs: 0, overlapMs: 0, visits: 0, idleMs: 0 });

async function build() {
  const intervals = await allIntervals();

  const hours = {};              // hourKey -> { domains: {domain:{active,audio}}, paths: {domain:{path:{active,audio}}}, wall:[] }
  const presenceByDomain = {};   // domain -> [{from,to,active}] (domain visit counting)
  const presenceByPath = {};     // domain -> path -> [{from,to,active}] (path visit counting)
  const sitesByDay = {};
  const sitesByHour = {};
  const subpagesByDay = {};
  const subpagesByHour = {};
  const wallByHour = {};
  const firstActiveByDay = {};

  for (const r of intervals) {
    if (r.kind === 'active' || r.kind === 'audio') {
      for (const seg of hourBounds(r.from, r.to)) {
        const h = (hours[seg.hourKey] ??= { domains: {}, paths: {}, wall: [] });
        ((h.domains[r.domain] ??= { active: [], audio: [] })[r.kind]).push([seg.from, seg.to]);
        (((h.paths[r.domain] ??= {})[r.path] ??= { active: [], audio: [] })[r.kind]).push([seg.from, seg.to]);
        h.wall.push([seg.from, seg.to]);
      }
    }
    if (r.kind === 'active') {
      const dayKey = localDayKey(r.from);
      if (firstActiveByDay[dayKey] == null || r.from < firstActiveByDay[dayKey])
        firstActiveByDay[dayKey] = r.from;
    }
    if (r.kind === 'idle') {
      const dayKey = localDayKey(r.from);
      ((sitesByDay[dayKey] ??= {})[r.domain] ??= zeroCell()).idleMs += r.to - r.from;
    }
    // Presence for visit counting: active/audio/idle all keep a run open (audio or
    // an AFK stretch during an active gap doesn't split it); but a run only counts
    // as a visit if it actually contains `active` (so background-audio-only is 0).
    if (r.kind === 'active' || r.kind === 'audio' || r.kind === 'idle') {
      const p = { from: r.from, to: r.to, active: r.kind === 'active' };
      (presenceByDomain[r.domain] ??= []).push(p);
      (((presenceByPath[r.domain] ??= {})[r.path] ??= [])).push(p);
    }
  }

  const hourKeys = Object.keys(hours);
  for (const hourKey of hourKeys) {
    const h = hours[hourKey];
    const dayKey = hourKey.slice(0, 10);
    wallByHour[hourKey] = Math.min(unionLen(h.wall), HOUR_CAP);

    for (const [domain, dd] of Object.entries(h.domains)) {
      const c = cellMs(dd.active, dd.audio);
      const hd = ((sitesByHour[hourKey] ??= {})[domain] ??= zeroCell());
      hd.activeMs += c.activeMs; hd.audioMs += c.audioMs; hd.overlapMs += c.overlapMs;
      const d = ((sitesByDay[dayKey] ??= {})[domain] ??= zeroCell());
      d.activeMs += c.activeMs; d.audioMs += c.audioMs; d.overlapMs += c.overlapMs;
    }

    for (const [domain, paths] of Object.entries(h.paths)) {
      const phDomain = ((subpagesByHour[hourKey] ??= {})[domain] ??= {});
      const pdDomain = ((subpagesByDay[dayKey] ??= {})[domain] ??= {});
      for (const [path, dd] of Object.entries(paths)) {
        const c = cellMs(dd.active, dd.audio);
        const hd = (phDomain[path] ??= zeroCell());
        hd.activeMs += c.activeMs; hd.audioMs += c.audioMs; hd.overlapMs += c.overlapMs;
        const d = (pdDomain[path] ??= zeroCell());
        d.activeMs += c.activeMs; d.audioMs += c.audioMs; d.overlapMs += c.overlapMs;
      }
    }
  }

  // Visits: credit each run to its start day AND start hour, for both the domain
  // (sites*) and domain+path (subpages*) keys — same run-merge semantics, mirroring
  // scalar's dual byDay/byHour increment on a visit.
  for (const [domain, items] of Object.entries(presenceByDomain)) {
    creditVisits(items, (start) => {
      ((sitesByDay[localDayKey(start)] ??= {})[domain] ??= zeroCell()).visits += 1;
      ((sitesByHour[localHourKey(start)] ??= {})[domain] ??= zeroCell()).visits += 1;
    });
  }
  for (const [domain, paths] of Object.entries(presenceByPath)) {
    for (const [path, items] of Object.entries(paths)) {
      creditVisits(items, (start) => {
        (((subpagesByDay[localDayKey(start)] ??= {})[domain] ??= {})[path] ??= zeroCell()).visits += 1;
        (((subpagesByHour[localHourKey(start)] ??= {})[domain] ??= {})[path] ??= zeroCell()).visits += 1;
      });
    }
  }

  return { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour, wallByHour, hourKeys, firstActiveByDay };
}

function load() {
  cachePromise ??= build();
  return cachePromise;
}

export function invalidate() {
  cachePromise = null;
}

// Earliest day with interval data (active/audio hours), as a YYYY-MM-DD key, or
// null when the log is empty. The stitch boundary: days before this read buckets,
// this day and after read intervals.
export async function earliestDayKey() {
  const { hourKeys } = await load();
  if (hourKeys.length === 0) return null;
  let min = hourKeys[0];
  for (const k of hourKeys) if (k < min) min = k;
  return min.slice(0, 10);
}

export async function getSitesByDay() {
  return (await load()).sitesByDay;
}

export async function getSitesByHour() {
  return (await load()).sitesByHour;
}

export async function getWallByHour() {
  return (await load()).wallByHour;
}

export async function getFirstBrowseByDay() {
  return (await load()).firstActiveByDay;
}

export async function getSubpagesByDay() {
  return (await load()).subpagesByDay;
}

export async function getSubpagesByHour() {
  return (await load()).subpagesByHour;
}

// 24-length array: average per clock hour over the day set, excluding today —
// mirrors background.js's getAvgPerClockHour (same signature, day set, divisor).
// With siteIds: sum those sites' browsing (active+audio-overlap) per hour. Without:
// the deduplicated wall-clock (parallel same-time windows counted once).
export async function getAvgPerClockHour(siteIds, range, dayKeys = null) {
  const { sitesByHour, wallByHour, hourKeys } = await load();
  const now = new Date();
  const today = localDayKey(now.getTime());

  if (!dayKeys) {
    if (range === 'all') {
      if (hourKeys.length === 0) return new Array(24).fill(0);
      const dates = hourKeys.map(k => k.slice(0, 10)).sort();
      const [y, m, d] = dates[0].split('-').map(Number);
      dayKeys = [];
      for (let date = new Date(y, m - 1, d); ; date.setDate(date.getDate() + 1)) {
        const k = localDayKey(date.getTime());
        if (k === today) break;
        dayKeys.push(k);
      }
    } else {
      const n = parseInt(range);
      dayKeys = [];
      if (Number.isFinite(n)) {
        for (let i = 1; i <= n; i++) {
          const day = new Date(now);
          day.setDate(day.getDate() - i);
          dayKeys.push(localDayKey(day.getTime()));
        }
      }
    }
  }

  const D = dayKeys.length;
  if (D === 0) return new Array(24).fill(0);
  const browsing = c => (c?.activeMs ?? 0) + (c?.audioMs ?? 0) - (c?.overlapMs ?? 0);
  const sums = new Array(24).fill(0);
  for (const dayKey of dayKeys) {
    for (let h = 0; h < 24; h++) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      if (siteIds?.length) {
        const bucket = sitesByHour[hourKey];
        if (bucket) for (const id of siteIds) sums[h] += browsing(bucket[id]);
      } else {
        sums[h] += wallByHour[hourKey] ?? 0;
      }
    }
  }
  return sums.map(s => s / D);
}
