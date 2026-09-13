import { readTourState } from './tour.js';
import { localDayKey } from './timeUtils.js';
import { blockKey } from './rules.js';
import { scanSiteBucket, scanSubpageBucket } from '../data/prune.js';
import {
  QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY,
  QUERY_SITES_BY_HOUR_FOR_DAY, QUERY_SUBPAGES_BY_DAY,
  QUERY_SUBPAGES_BY_HOUR, QUERY_AVG_PER_CLOCK_HOUR,
} from './queryTypes.js';

const MIN = 60_000;
const HOUR = 3_600_000;

const SITES = ['news.example.com', 'vid.example.com', 'social.example.com', 'forgot.example.com'];
const SUBPAGES = {
  'news.example.com':   ['/world', '/tech', '/sports', '/old-article-7849173'],
  'vid.example.com':    ['/watch/abc', '/watch/xyz'],
  'social.example.com': ['/home', '/profile'],
  'forgot.example.com': ['/landing'],
};

function buildFixture() {
  const now = new Date();
  const todayKey = localDayKey(now.getTime());
  const dayKeys = [];
  for (let d = 1; d <= 7; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    dayKeys.push(localDayKey(day.getTime()));
  }

  function recordFor(siteId, dayIdx) {
    const base = {
      'news.example.com':   { active: 35 * MIN, audio: 0,        visits: 3 },
      'vid.example.com':    { active: 50 * MIN, audio: 40 * MIN, visits: 2 },
      'social.example.com': { active: 22 * MIN, audio: 0,        visits: 5 },
      'forgot.example.com': { active: 2_000,    audio: 0,        visits: 1 },
    }[siteId];
    const wobble = 1 + ((dayIdx * 17) % 7) / 20;
    return {
      activeMs: Math.round(base.active * wobble),
      audioMs: Math.round(base.audio * wobble),
      overlapMs: Math.round(base.audio * wobble * 0.4),
      visits: base.visits,
    };
  }

  function subpageRecord(path, dayIdx) {
    const base = {
      '/world':                { active: 12 * MIN, visits: 1 },
      '/tech':                 { active: 15 * MIN, visits: 1 },
      '/sports':               { active: 8 * MIN,  visits: 1 },
      '/old-article-7849173':  { active: 2_000,    visits: 1 },
      '/watch/abc':            { active: 28 * MIN, visits: 1 },
      '/watch/xyz':            { active: 18 * MIN, visits: 1 },
      '/home':                 { active: 14 * MIN, visits: 3 },
      '/profile':              { active: 6 * MIN,  visits: 1 },
      '/landing':              { active: 2_000,    visits: 1 },
    }[path];
    const wobble = 1 + ((dayIdx * 11) % 5) / 20;
    return {
      activeMs: Math.round(base.active * wobble),
      audioMs: 0,
      overlapMs: 0,
      visits: base.visits,
    };
  }

  const sitesByDay = {};
  const sitesByHour = {};
  const subpagesByDay = {};
  const subpagesByHour = {};

  dayKeys.forEach((dayKey, dayIdx) => {
    sitesByDay[dayKey] = {};
    subpagesByDay[dayKey] = {};

    for (const siteId of SITES) {
      sitesByDay[dayKey][siteId] = recordFor(siteId, dayIdx);
    }

    for (const siteId of SITES) {
      subpagesByDay[dayKey][siteId] = {};
      for (const path of SUBPAGES[siteId]) {
        subpagesByDay[dayKey][siteId][path] = subpageRecord(path, dayIdx);
      }
    }

    const activeHours = [9, 12, 14, 18, 20];
    for (const h of activeHours) {
      const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
      sitesByHour[hourKey] = {};
      subpagesByHour[hourKey] = {};
      for (const siteId of SITES) {
        const dayRec = sitesByDay[dayKey][siteId];
        const share = 1 / activeHours.length;
        sitesByHour[hourKey][siteId] = {
          activeMs: Math.round(dayRec.activeMs * share),
          audioMs: Math.round(dayRec.audioMs * share),
          overlapMs: Math.round(dayRec.overlapMs * share),
          visits: Math.max(1, Math.round(dayRec.visits * share)),
        };
        subpagesByHour[hourKey][siteId] = {};
        for (const path of SUBPAGES[siteId]) {
          const dayRec = subpagesByDay[dayKey][siteId][path];
          const share2 = 1 / activeHours.length;
          subpagesByHour[hourKey][siteId][path] = {
            activeMs: Math.round(dayRec.activeMs * share2),
            audioMs: 0,
            overlapMs: 0,
            visits: 1,
          };
        }
      }
    }
  });

  return { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour, dayKeys, todayKey };
}

let fixtureCache = null;
function fixture() {
  if (!fixtureCache) fixtureCache = buildFixture();
  return fixtureCache;
}

// The timeline reads interval rows straight from IndexedDB, so the bucket fixture
// above can't feed it. Synthesize plausible {domain,path,kind,from,to} rows from
// the same sites: fixed-clock sessions over the prior 6 days for week/month
// navigation, plus a few sessions anchored to "now" so today's default view is
// never empty during the tour.
const SITE_SESSIONS = {
  'news.example.com':   { hours: [9, 14, 20],     minLen: 12, audio: false },
  'vid.example.com':    { hours: [12, 18],        minLen: 24, audio: true },
  'social.example.com': { hours: [9, 13, 18, 21], minLen: 7,  audio: false },
  'forgot.example.com': { hours: [16],            minLen: 1,  audio: false },
};

function buildIntervalFixture() {
  const rows = [];
  const now = Date.now();
  const push = (domain, path, kind, from, to) => { if (to - from >= MIN) rows.push({ domain, path, kind, from, to }); };

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayStart = todayMidnight.getTime();

  for (let d = 1; d <= 6; d++) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - d);
    const dayStart = day.getTime();
    for (const siteId of SITES) {
      const cfg = SITE_SESSIONS[siteId];
      cfg.hours.forEach((h, i) => {
        const path = SUBPAGES[siteId][i % SUBPAGES[siteId].length];
        const from = dayStart + h * HOUR + 5 * MIN;
        const to = from + (cfg.minLen + ((d + i) % 3) * 3) * MIN;
        push(siteId, path, 'active', from, to);
        if (cfg.audio) push(siteId, path, 'audio', from + 2 * MIN, to - MIN);
        push(siteId, path, 'idle', to, to + 3 * MIN);
      });
    }
  }

  ['news.example.com', 'vid.example.com', 'social.example.com'].forEach((siteId, i) => {
    const cfg = SITE_SESSIONS[siteId];
    const path = SUBPAGES[siteId][0];
    const end = now - (i * 35 + 8) * MIN;
    const start = Math.max(todayStart, end - (cfg.minLen + 5) * MIN);
    push(siteId, path, 'active', start, end);
    if (cfg.audio) push(siteId, path, 'audio', start + 2 * MIN, end - MIN);
  });

  return rows;
}

let intervalFixtureCache = null;
export function mockIntervals() {
  if (!intervalFixtureCache) intervalFixtureCache = buildIntervalFixture();
  return intervalFixtureCache;
}

// Storage overview reads intervalStats() straight from IndexedDB, which is empty
// during the tour. Derive the same shape from the in-memory mock rows instead.
export function mockIntervalStats() {
  const rows = mockIntervals();
  const domains = new Set(), subpages = new Set();
  const kinds = { active: 0, audio: 0, idle: 0 };
  let earliest = Infinity, latest = -Infinity;
  for (const r of rows) {
    domains.add(r.domain);
    subpages.add(`${r.domain}\n${r.path}`);
    if (r.kind in kinds) kinds[r.kind]++;
    if (r.from < earliest) earliest = r.from;
    if (r.to > latest) latest = r.to;
  }
  return {
    rows: rows.length, domains: domains.size, subpages: subpages.size, kinds,
    earliest: rows.length ? earliest : null, latest: rows.length ? latest : null,
  };
}

// Seeded rules + a week of block history for the tour. A fresh user has no rules
// in storage, so the Rules surface (list and stats) would be blank during
// onboarding. Never persisted: render()/renderStats() swap these in only while the
// mock flag is set, and the list is shown read-only so its buttons stay inert.
const MOCK_RULES = [
  { id: 'tour-rule-1', matchType: 'subdomain', target: 'social.example.com', limit: 30, limitUnit: 'minutes', period: 'day', mode: 'active', enabled: true },
  { id: 'tour-rule-2', matchType: 'subdomain', target: 'vid.example.com', limit: 1, limitUnit: 'hours', period: 'day', mode: 'active+audio', enabled: true },
  { id: 'tour-rule-3', matchType: 'keyword', keyword: 'shorts', limit: 0, limitUnit: 'minutes', period: 'day', mode: 'active', enabled: false },
];

export function mockRules() {
  return MOCK_RULES.map(r => ({ ...r }));
}

export function mockBlocksByDay() {
  // Keyed by blockKey(rule) so most-blocked resolves; social weighted highest.
  const weights = { 'tour-rule-1': 3, 'tour-rule-2': 1 };
  const byDay = {};
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const counts = {};
    for (const rule of MOCK_RULES) {
      const w = weights[rule.id];
      if (w) counts[blockKey(rule)] = w + ((i * 2) % 3);
    }
    byDay[localDayKey(day.getTime())] = counts;
  }
  return byDay;
}

function avgPerClockHour(siteIds, range, dayKeys = null) {
  const { sitesByHour } = fixture();
  if (!dayKeys) {
    if (range === 'all') {
      const hourKeys = Object.keys(sitesByHour);
      const dates = [...new Set(hourKeys.map(k => k.slice(0, 10)))].sort();
      dayKeys = dates;
    } else {
      const days = parseInt(range);
      const now = new Date();
      dayKeys = [];
      for (let d = 1; d <= days; d++) {
        const day = new Date(now);
        day.setDate(day.getDate() - d);
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
      const bucket = sitesByHour[hourKey];
      if (!bucket) continue;
      if (siteIds?.length) {
        for (const id of siteIds) sums[h] += bucket[id]?.activeMs ?? 0;
      } else {
        for (const entry of Object.values(bucket)) sums[h] += entry.activeMs ?? 0;
      }
    }
  }
  return sums.map(s => s / D);
}

function hourBucketForDay(dayKey) {
  const { sitesByHour } = fixture();
  const result = {};
  for (let h = 0; h < 24; h++) {
    const hourKey = `${dayKey}T${String(h).padStart(2, '0')}`;
    if (sitesByHour[hourKey]) result[hourKey] = sitesByHour[hourKey];
  }
  return result;
}

function mockAnswer(msg) {
  const f = fixture();
  switch (msg.type) {
    case QUERY_SITES_BY_DAY: return f.sitesByDay;
    case QUERY_SITES_BY_HOUR_TODAY: return {};
    case QUERY_SITES_BY_HOUR_FOR_DAY: return hourBucketForDay(msg.dayKey);
    case QUERY_SUBPAGES_BY_DAY: return f.subpagesByDay;
    case QUERY_SUBPAGES_BY_HOUR: return f.subpagesByHour;
    case QUERY_AVG_PER_CLOCK_HOUR: return avgPerClockHour(msg.siteIds, msg.range, msg.dayKeys);
    default: return null;
  }
}

let mockModeCache = null;
export async function isMockMode() {
  if (mockModeCache !== null) return mockModeCache;
  const state = await readTourState();
  mockModeCache = !!state.useMockData;
  return mockModeCache;
}

export function clearMockModeCache() {
  mockModeCache = null;
  fixtureCache = null;
  intervalFixtureCache = null;
}

// Used only on mergeDataSources' mock path: returns the guided-tour fixture for the
// message shape. Real bucket reads go through bucketProvider now; there is no
// service-worker data API to fall back to.
export async function fetchTrackingData(msg) {
  if (await isMockMode()) {
    const answer = mockAnswer(msg);
    if (answer !== null) return answer;
  }
  return null;
}

export function mockScanResults(scopes, thresholdMs) {
  const f = fixture();
  const results = [];
  if (scopes.siteDaily) results.push(...scanSiteBucket(f.sitesByDay, thresholdMs, 'sitesByDay'));
  if (scopes.siteHourly) results.push(...scanSiteBucket(f.sitesByHour, thresholdMs, 'sitesByHour'));
  if (scopes.subpageDaily) results.push(...scanSubpageBucket(f.subpagesByDay, thresholdMs, 'subpagesByDay'));
  if (scopes.subpageHourly) results.push(...scanSubpageBucket(f.subpagesByHour, thresholdMs, 'subpagesByHour'));
  return results;
}
