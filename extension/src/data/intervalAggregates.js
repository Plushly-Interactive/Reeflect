import { allIntervals } from './intervalLog.js';
import { loadCore, timeJson } from '../shared/core.js';
import { Dashboard } from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { localDayKey } from '../shared/timeUtils.js';

// The dashboard's data shapes come from the core: one `Dashboard` built from every row in the
// log, filtered to the selected devices inside the core, then read as JSON. Nothing about rows is
// computed here. `deviceFilter` is page memory only: every page open starts at all devices.
let cachePromise = null;
let deviceFilter = null;

async function build() {
  await loadCore();
  const rows = await allIntervals();
  let minFrom = Date.now();
  const devices = new Set();
  for (const r of rows) { if (r.from < minFrom) minFrom = r.from; devices.add(r.deviceId); }
  const dash = Dashboard.build(JSON.stringify(rows), JSON.stringify(deviceFilter), await timeJson(minFrom));
  return { dash, shapes: JSON.parse(dash.shapes()), deviceIds: [...devices] };
}

function load() {
  cachePromise ??= build();
  return cachePromise;
}

export function invalidate() {
  cachePromise?.then((c) => c.dash.free()).catch(() => {});
  cachePromise = null;
}

// `ids` = array of device ids, or null for every device. Rebuilds on the next read.
export function setDeviceFilter(ids) {
  deviceFilter = ids;
  invalidate();
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
  return (await load()).dash.earliestDayKey() ?? null;
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
  const { dash } = await load();
  const today = localDayKey(Date.now());
  if (!dayKeys) {
    dayKeys = [];
    if (range === 'all') {
      const first = dash.earliestDayKey();
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
  return Array.from(dash.avgPerClockHour(JSON.stringify(siteIds ?? []), JSON.stringify(dayKeys)));
}
