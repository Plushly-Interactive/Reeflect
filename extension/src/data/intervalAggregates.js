import Dexie from '../vendor/dexie.min.mjs';
import { coreCall, timeJson } from '../shared/core.js';
import { localDayKey } from '../shared/timeUtils.js';

// The dashboard's data shapes come from the core: one dashboard built from every row in the host's
// store, filtered to the selected devices inside the core, then read as JSON. Nothing about rows is
// computed here. `deviceFilter` is page memory only: every page open starts at all devices.
//
// A build reads every row (2.6 s at 111K rows), so the last all-devices result is kept in a small
// database of its own. A page paints from that copy at once. A copy older than SAVED_MAX_AGE_MS is
// rebuilt in the background, and `onRefreshed` tells the page to draw again. The per-clock-hour
// averages pages asked for are saved next to it and answered again after every build, because
// those need a build in this page.
const SAVED_MAX_AGE_MS = 30_000;   // invented, agreed with the user
const SAVED_KEY = 'all-devices';
const AVERAGES_KEPT = 40;   // invented: saved per-clock-hour answers kept across builds
const BACKGROUND_DELAY_MS = 1000;   // invented: lets the page finish painting from the copy first
const saved = new Dexie('dashboard-cache');
saved.version(1).stores({ builds: 'key' });

let cachePromise = null;   // what the getters read: the saved copy first, the fresh build after
let buildPromise = null;   // the build inside this page's core
let clearing = null;       // a pending wipe of the saved copy; reads wait for it
let paintedFromCopy = false;   // this page showed the saved copy: a finished build makes it draw again
let generation = 0;        // grows when the rows or the filter change: a delayed build checks it
let deviceFilter = null;
const refreshListeners = new Set();

async function build() {
  const { deviceIds } = await coreCall('dashboard.build', { deviceIds: deviceFilter, time: JSON.parse(await timeJson(0)) });
  return {
    shapes: await coreCall('dashboard.shapes'),
    deviceIds,
    earliestDayKey: await coreCall('dashboard.earliestDayKey'),
    at: Date.now(),
  };
}

// A failed save or read of the copy never fails the page: the build still answers.
function save(dash) {
  if (deviceFilter === null) saved.builds.put({ key: SAVED_KEY, dash }).catch(() => {});
  return dash;
}

// Only the small answer records: the build record beside them is several megabytes.
function savedAverages() {
  return saved.builds.where('key').startsWith('avg|').toArray();
}

// The averages other pages asked for are answered again from the new build, so the next page finds
// them with a matching stamp and needs no build of its own. The least recently used go. This runs
// after the build was handed over: whoever waits for the build is served first.
async function rewarmAverages(dash) {
  if (deviceFilter !== null) return;
  try {
    const kept = (await savedAverages()).sort((x, y) => y.used - x.used);
    await saved.builds.bulkDelete(kept.slice(AVERAGES_KEPT).map((r) => r.key));
    for (const r of kept.slice(0, AVERAGES_KEPT)) {
      const value = await coreCall('dashboard.avgPerClockHour', r.args);
      await saved.builds.put({ ...r, at: dash.at, value });
    }
  } catch { /* the copy is a convenience */ }
}

function built() {
  if (!buildPromise) {
    const mine = buildPromise = build().then(save);
    mine.then((dash) => {
      if (buildPromise !== mine) return;   // the rows changed meanwhile: this build is already old
      cachePromise = mine;
      setTimeout(() => { if (buildPromise === mine) rewarmAverages(dash); }, 0);
      if (!paintedFromCopy) return;
      paintedFromCopy = false;
      for (const fn of refreshListeners) fn();
    });
  }
  return buildPromise;
}

// A build runs on the page's own thread and holds it for its whole length. A background build
// therefore waits until the page painted everything from the copy.
function buildSoon() {
  const mine = generation;
  setTimeout(() => { if (generation === mine) built(); }, BACKGROUND_DELAY_MS);
}

async function savedOrBuilt() {
  await clearing;
  const copy = await saved.builds.get(SAVED_KEY).catch(() => null);
  if (!copy) return built();
  if (Date.now() - copy.dash.at > SAVED_MAX_AGE_MS) {
    // An old copy is only for a page that can draw again: without a listener it would stay on screen.
    if (!refreshListeners.size) return built();
    buildSoon();
  }
  paintedFromCopy = true;
  return copy.dash;
}

function load() {
  cachePromise ??= deviceFilter === null ? savedOrBuilt() : built();
  return cachePromise;
}

function forget() {
  cachePromise = null;
  buildPromise = null;
  paintedFromCopy = false;
  generation++;
}

// The rows changed (delete, import, sync): this page's build and the saved copy are both wrong.
export function invalidate() {
  forget();
  clearing = saved.builds.clear().catch(() => {});
}

// `fn` runs when a background rebuild replaced the saved copy this page painted from. Register
// before the page's first read: only a registered page is given an old copy.
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
  return (await load()).deviceIds;
}

// Earliest day with interval data, as a YYYY-MM-DD key, or null when the log is empty. The stitch
// boundary: days before this read buckets, this day and after read intervals.
export async function earliestDayKey() {
  return (await load()).earliestDayKey;
}

export async function getSitesByDay() {
  return (await load()).shapes.sitesByDay;
}

export async function getSitesByHour() {
  return (await load()).shapes.sitesByHour;
}

export async function getWallByHour() {
  return (await load()).shapes.wallByHour;
}

export async function getFirstBrowseByDay() {
  return (await load()).shapes.firstActiveByDay;
}

export async function getSubpagesByDay() {
  return (await load()).shapes.subpagesByDay;
}

export async function getSubpagesByHour() {
  return (await load()).shapes.subpagesByHour;
}

// 24-length array: average per clock hour over the day set, excluding today. The day set is the
// page's choice (a range or explicit keys); the core does the averaging.
export async function getAvgPerClockHour(siteIds, range, dayKeys = null) {
  const dash = await load();
  const today = localDayKey(Date.now());
  if (!dayKeys) {
    dayKeys = [];
    if (range === 'all') {
      const first = dash.earliestDayKey;
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
  // The core answers from the build inside this page, and a page painted from the saved copy has
  // none. So each answer is saved beside the copy, stamped with its build. A page that can draw
  // again is shown an older answer at once while a build brings the current one: the exact one,
  // or the latest for the same sites over as many days (the day list shifts by one every day).
  const args = { siteIds: siteIds ?? [], dayKeys };
  const key = `avg|${JSON.stringify(args)}`;
  const sites = JSON.stringify(args.siteIds);
  let kept = null;
  if (deviceFilter === null) {
    kept = await saved.builds.get(key).catch(() => null);
    if (kept) saved.builds.put({ ...kept, used: Date.now() }).catch(() => {});
    if (kept?.at === dash.at) return kept.value;
    if (!kept && refreshListeners.size && !buildPromise) {
      const alike = (await savedAverages().catch(() => []))
        .filter((r) => r.sites === sites && r.args.dayKeys.length === dayKeys.length);
      kept = alike.sort((x, y) => y.used - x.used)[0] ?? null;
    }
  }
  if (kept && refreshListeners.size && !buildPromise) {
    paintedFromCopy = true;
    buildSoon();
    return kept.value;
  }
  const fresh = await built();
  const value = await coreCall('dashboard.avgPerClockHour', args);
  if (deviceFilter === null) saved.builds.put({ key, args, sites, at: fresh.at, used: Date.now(), value }).catch(() => {});
  return value;
}
