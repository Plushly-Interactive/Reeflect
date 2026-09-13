import { PREF_WEEK_START } from './prefKeys.js';
import { localDayKey } from './timeUtils.js';
import { getLocale } from './i18n.js';
import { host } from './host.js';

// JS Date.getDay() convention: 0 = Sunday … 6 = Saturday.
export const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const DEFAULT_WEEK_START = 'monday';

const DOW = Object.fromEntries(WEEK_DAYS.map((name, i) => [name, i]));

let cachedDow = DOW[DEFAULT_WEEK_START];

host.prefs.get(PREF_WEEK_START).then(({ [PREF_WEEK_START]: v }) => {
  cachedDow = DOW[v] ?? DOW[DEFAULT_WEEK_START];
});

host.prefs.onChanged((changes) => {
  if (!changes[PREF_WEEK_START]) return;
  cachedDow = DOW[changes[PREF_WEEK_START].newValue] ?? DOW[DEFAULT_WEEK_START];
});

export function weekDow(date) {
  return (date.getDay() - cachedDow + 7) % 7;
}

// 2023-01-01 is a known Sunday — used as a reference date to read locale-narrow
// weekday labels ('S','M',... in en, but correct for any locale) from Intl.
// Computed at call time (not module load) so it picks up the user's chosen
// language via getLocale(), not just the browser's default locale.
export function rotatedDayLabels() {
  const fmt = new Intl.DateTimeFormat(getLocale(), { weekday: 'narrow' });
  const labelsSunFirst = Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  return [...labelsSunFirst.slice(cachedDow), ...labelsSunFirst.slice(0, cachedDow)];
}

// Week key format: 'YYYY-MM-DDw' — the date of the week-start day with a trailing 'w'.
// Length 11, distinct from day keys (10) and month keys (7).

export function weekKeyForDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() - cachedDow + 7) % 7;
  d.setDate(d.getDate() - dow);
  return localDayKey(d.getTime()) + 'w';
}

export function daysInWeek(weekKey) {
  const [y, m, d] = weekKey.slice(0, 10).split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => localDayKey(new Date(y, m - 1, d + i).getTime()));
}

export function navigateWeek(weekKey, dir) {
  const [y, m, d] = weekKey.slice(0, 10).split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + dir * 7).getTime()) + 'w';
}
