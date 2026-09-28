import Dexie from '../vendor/dexie.min.mjs';
import { coreCall, timeJson } from '../shared/core.js';
import { localDayKey } from '../shared/timeUtils.js';

// The dashboard's data shapes come from the core. A page reads only the parts it draws, each one
// shape narrowed to a day and to some domains. Nothing about rows is computed here. `deviceFilter` is
// page memory only: every page open starts at all devices.
//
// All devices: finished days are kept in a database of their own, one record per shape and day. The
// row store logs every write with the earliest instant it touched (`rows.changes`), so a page first
// rebuilds from the earliest logged day on, over the rows since the day before it, and reads the kept
// days. With nothing logged it rebuilds nothing. A full rebuild (no kept days, a wipe, another zone)
// runs in the background for a page that can draw again, and `onRefreshed` tells it to.
//
// One device picked: this page's core builds over every row for that device, as before.
const NAMES = ['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour', 'wallByHour', 'firstActiveByDay'];
const PER_DOMAIN = new Set(['sitesByDay', 'sitesByHour', 'subpagesByDay', 'subpagesByHour']);
const STATE_KEY = 'kept';
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const kept = new Dexie('dashboard-cache');
kept.version(1).stores({ builds: 'key' });
kept.version(2).stores({ builds: 'key', days: '[name+day], day' }).upgrade((tx) => tx.table('builds').clear());

let ready = null;          // this page's refresh of the kept days
let deviceFilter = null;
let handle = null;         // what this page's core dashboard holds: 'window' or a filter's key
let lock = Promise.resolve();
const refreshListeners = new Set();
const memo = new Map();    // this page's answers, cleared when the data under them changes

// One build and its reads at a time: the core holds one dashboard per page.
function exclusive(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

function remember(key, fn) {
  if (!memo.has(key)) memo.set(key, fn().catch((err) => { memo.delete(key); throw err; }));
  return memo.get(key);
}

function forget() {
  memo.clear();
}

// Local midnight of the day before `dayKey`: a visit that began then stays that day's.
function dayBeforeStart(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d - 1).getTime();
}

// Applies the change log to the kept days. Returns false when another page committed first; the
// caller then runs again against that page's work.
async function applyLog(state, log) {
  let earliest = Infinity, through = 0;
  for (const c of log) {
    if (c.from < earliest) earliest = c.from;
    if (c.seq > through) through = c.seq;
  }
  const full = !state || state.zone !== zone() || earliest < 0;
  const fromDay = full ? null : localDayKey(earliest);
  const parts = await exclusive(async () => {
    const windowStart = full ? 0 : dayBeforeStart(fromDay);
    const { deviceIds } = await coreCall('dashboard.build', { deviceIds: null, ...(full ? {} : { fromMs: windowStart }), time: JSON.parse(await timeJson(windowStart)) });
    handle = 'window';
    const out = { deviceIds };
    for (const name of NAMES) out[name] = await coreCall('dashboard.part', { name, ...(full ? {} : { fromDay }) });
    return out;
  });
  const records = [];
  for (const name of NAMES) {
    const byDay = {};
    for (const [key, v] of Object.entries(parts[name])) (byDay[key.slice(0, 10)] ??= {})[key] = v;
    for (const [day, value] of Object.entries(byDay)) records.push({ name, day, value });
  }
  const committed = await kept.transaction('rw', kept.builds, kept.days, async () => {
    const now = await kept.builds.get(STATE_KEY);
    if ((now?.version ?? 0) !== (state?.version ?? 0)) return false;
    if (full) await kept.days.clear();
    else await kept.days.where('day').aboveOrEqual(fromDay).delete();
    await kept.days.bulkPut(records);
    await kept.builds.put({ key: STATE_KEY, version: (now?.version ?? 0) + 1, zone: zone(), deviceIds: parts.deviceIds });
    return true;
  });
  if (committed && through) await coreCall('rows.dropChanges', { through });
  return committed;
}

async function refresh() {
  for (;;) {
    const state = await kept.builds.get(STATE_KEY);
    const log = await coreCall('rows.changes');
    if (state && state.zone === zone() && !log.length) return;
    if (await applyLog(state, log)) return;
  }
}

// A page that can draw again is shown the kept days at once while a full rebuild runs; any other
// page, and every rebuild from a recent day, waits for the rebuild.
function keptReady() {
  ready ??= (async () => {
    const state = await kept.builds.get(STATE_KEY).catch(() => null);
    if (state && refreshListeners.size) {
      const log = await coreCall('rows.changes');
      const full = state.zone !== zone() || log.some((c) => c.from < 0);
      if (full) {
        refresh().then(() => { forget(); for (const fn of refreshListeners) fn(); }).catch(() => {});
        return;
      }
    }
    await refresh();
  })();
  return ready;
}

async function keptState() {
  await keptReady();
  return kept.builds.get(STATE_KEY);
}

// The kept records of one shape, for every day or for the listed ones, as that shape.
async function keptShape(name, dayKeys = null) {
  await keptReady();
  const recs = dayKeys
    ? await kept.days.where('[name+day]').anyOf(dayKeys.map((d) => [name, d])).toArray()
    : await kept.days.where('[name+day]').between([name, Dexie.minKey], [name, Dexie.maxKey]).toArray();
  const out = {};
  for (const r of recs) Object.assign(out, r.value);
  return out;
}

// Keeps the listed domains in every day or hour, and every day or hour key: `dashboard.part`'s rule.
function narrow(shape, domains) {
  const out = {};
  for (const [key, cells] of Object.entries(shape)) {
    const some = {};
    for (const d of domains) if (d in cells) some[d] = cells[d];
    out[key] = some;
  }
  return out;
}

async function filteredPart(args) {
  return exclusive(async () => {
    const key = JSON.stringify(deviceFilter);
    if (handle !== key) {
      await coreCall('dashboard.build', { deviceIds: deviceFilter, time: JSON.parse(await timeJson(0)) });
      handle = key;
    }
    return coreCall(args.cmd, args.args);
  });
}

// One shape (see `dashboard.part` in the core): `day` keeps one day key, `domains` keeps those domains
// in every day or hour, null keeps all. A page that asks twice for a part pays once.
function part(name, day = null, domains = null) {
  return remember(JSON.stringify(['part', deviceFilter, name, day, domains]), async () => {
    if (deviceFilter !== null) return filteredPart({ cmd: 'dashboard.part', args: { name, day, domains } });
    const shape = await keptShape(name, day ? [day] : null);
    return domains && PER_DOMAIN.has(name) ? narrow(shape, domains) : shape;
  });
}

// The rows changed and the page wants to read again: the change log already names what to rebuild.
export function invalidate() {
  forget();
  ready = null;
}

// `fn` runs when a background rebuild replaced the kept days this page painted from. Register
// before the page's first read: only a registered page is shown kept days during a full rebuild.
export function onRefreshed(fn) {
  refreshListeners.add(fn);
}

// `ids` = array of device ids, or null for every device. Rebuilds on the next read.
export function setDeviceFilter(ids) {
  deviceFilter = ids;
  forget();
}

export function getDeviceFilter() {
  return deviceFilter;
}

// Every device that owns at least one row, whatever the filter says.
export async function knownDeviceIds() {
  return (await keptState())?.deviceIds ?? [];
}

// Earliest day with interval data, as a YYYY-MM-DD key, or null when the log is empty. The stitch
// boundary: days before this read buckets, this day and after read intervals.
export function earliestDayKey() {
  return remember(JSON.stringify(['earliest', deviceFilter]), async () => {
    if (deviceFilter !== null) return filteredPart({ cmd: 'dashboard.earliestDayKey' });
    await keptReady();
    return (await kept.days.where('[name+day]').between(['wallByHour', Dexie.minKey], ['wallByHour', Dexie.maxKey]).first())?.day ?? null;
  });
}

export function getSitesByDay() {
  return part('sitesByDay');
}

export function getSitesByHour(day = null) {
  return part('sitesByHour', day);
}

export function getWallByHour() {
  return part('wallByHour');
}

export function getFirstBrowseByDay() {
  return part('firstActiveByDay');
}

export function getSubpagesByDay(domains = null) {
  return part('subpagesByDay', null, domains);
}

export function getSubpagesByHour(domains = null) {
  return part('subpagesByHour', null, domains);
}

// 24-length array: average per clock hour over the day set, excluding today. The day set is the
// page's choice (a range or explicit keys); the core does the averaging, over the kept days' hours.
export async function getAvgPerClockHour(siteIds, range, dayKeys = null) {
  const today = localDayKey(Date.now());
  if (!dayKeys) {
    dayKeys = [];
    if (range === 'all') {
      const first = await earliestDayKey();
      if (first) {
        const [y, m, d] = first.split('-').map(Number);
        for (let date = new Date(y, m - 1, d); ; date.setDate(date.getDate() + 1)) {
          const k = localDayKey(date.getTime());
          if (k >= today) break;
          dayKeys.push(k);
        }
      }
    } else {
      const n = parseInt(range);
      if (Number.isFinite(n)) {
        for (let i = 1; i <= n; i++) {
          const day = new Date();
          day.setDate(day.getDate() - i);
          dayKeys.push(localDayKey(day.getTime()));
        }
      }
    }
  }
  const sites = siteIds ?? [];
  return remember(JSON.stringify(['avg', deviceFilter, sites, dayKeys]), async () => {
    if (deviceFilter !== null) return filteredPart({ cmd: 'dashboard.avgPerClockHour', args: { siteIds: sites, dayKeys } });
    const [hours, wall] = await Promise.all([
      sites.length ? keptShape('sitesByHour', dayKeys).then((s) => narrow(s, sites)) : {},
      keptShape('wallByHour', dayKeys),
    ]);
    return coreCall('dashboard.avgFromParts', { sitesByHour: hours, wallByHour: wall, siteIds: sites, dayKeys });
  });
}
