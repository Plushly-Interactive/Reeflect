import { localDayKey } from './timeUtils.js';
import { weekKeyForDate, daysInWeek, navigateWeek } from './weekStart.js';
import { getLocale } from './i18n.js';

// Period-string helpers shared by the drill views and the timeline. A period is one
// of three string shapes, told apart by length:
//   day   'YYYY-MM-DD'   (10)
//   week  'YYYY-MM-DDw'  (11)  — date of the week-start day + 'w' (see weekStart.js)
//   month 'YYYY-MM'      (7)
// All pure: no DOM, no module state.

export function periodLevel(period) {
  return period.length === 7 ? 'month' : period.length === 11 ? 'week' : 'day';
}

// Human label for the nav strip.
export function formatPeriodLabel(period) {
  const locale = getLocale();
  if (period.length === 7) {
    const [y, m] = period.split('-');
    return new Date(+y, +m - 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  if (period.length === 11) {
    const [y, m, d] = period.slice(0, 10).split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 6);
    const startStr = start.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return `${startStr} – ${endStr}`;
  }
  const [y, m, d] = period.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

// Previous/next period at the same level. Returns the new string (no side effects).
export function stepPeriod(period, dir) {
  if (period.length === 7) {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (period.length === 11) return navigateWeek(period, dir);
  const [y, m, day] = period.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, day + dir).getTime());
}

// [startMs, endMs) of the period in local time. month: 1st..next-month 1st;
// week: week-start day..+7d; day: midnight..+24h.
export function periodBounds(period) {
  if (period.length === 7) {
    const [y, m] = period.split('-').map(Number);
    return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
  }
  if (period.length === 11) {
    const [y, m, d] = daysInWeek(period)[0].split('-').map(Number);
    return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 7).getTime()];
  }
  const [y, m, d] = period.split('-').map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

// Zoom out one level: day -> its week, week -> its month. Month is the ceiling.
export function levelUp(period) {
  if (period.length === 10) {
    const [y, m, d] = period.split('-').map(Number);
    return weekKeyForDate(new Date(y, m - 1, d));
  }
  if (period.length === 11) return period.slice(0, 7);
  return period;
}

// Zoom in one level, landing on the first sub-period that has data (mirrors the
// drill's ArrowDown): month -> first week with data, week -> first day with data.
// `hasData(dayKey)` reports whether a day has any rows. Falls back to the first
// sub-period. Day is the floor.
export function levelDown(period, hasData) {
  if (period.length === 7) {
    const [y, m] = period.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    for (let i = 1; i <= days; i++) {
      if (hasData(`${period}-${String(i).padStart(2, '0')}`)) return weekKeyForDate(new Date(y, m - 1, i));
    }
    return weekKeyForDate(new Date(y, m - 1, 1));
  }
  if (period.length === 11) {
    const week = daysInWeek(period);
    for (const dayKey of week) if (hasData(dayKey)) return dayKey;
    return week[0];
  }
  return period;
}
