import { t } from './i18n.js';

export function dayKeysForRange(range, allDaysSource) {
  if (range === 'today') return [localDayKey(Date.now())];
  if (range === 'all') return Object.keys(allDaysSource ?? {}).sort();
  const now = new Date();
  const n = parseInt(range);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (n - 1 - i));
    return localDayKey(d.getTime());
  });
}

export function localDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function localHourKey(ts) {
  return `${localDayKey(ts)}T${String(new Date(ts).getHours()).padStart(2, '0')}`;
}

export function splitByHour(from, to) {
  const segs = [];
  let t = from;
  while (t < to) {
    const nextHour = new Date(t);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const end = Math.min(nextHour.getTime(), to);
    segs.push({ hourKey: localHourKey(t), dayKey: localDayKey(t), ms: end - t });
    t = end;
  }
  return segs;
}

export function formatMs(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = ms / 3600000;
  const days = ms / 86400000;
  if (ms < 60000)    return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000)  { const r = Math.round(ms / 60000); return r < 60 ? `${r}m` : '1h'; }
  if (ms < 36000000) { const m = totalMinutes % 60; return m ? `${Math.floor(hours)}h${m}m` : `${Math.floor(hours)}h`; }
  if (ms < 86400000) { const h = hours.toFixed(1); return `${h.endsWith('.0') ? Math.floor(hours) : h}h`; }
  const hStr = Math.floor(hours);
  const dRounded = Math.round(days * 10) / 10;
  const dStr = dRounded >= 10 || dRounded % 1 === 0 ? Math.round(dRounded) : dRounded.toFixed(1);
  return `${hStr}h (${dStr}${t('unit_daysShort')})`;
}

export function formatMsAsDays(ms) {
  const days = ms / 86400000;
  const dStr = days === Math.floor(days) ? Math.floor(days) : days.toFixed(1);
  return `${dStr}${t('unit_daysShort')}`;
}

// Human span between two dates (Date-parseable: 'YYYY-MM-DD' strings or ms).
export function formatSpan(earliest, latest) {
  const days = Math.round((new Date(latest) - new Date(earliest)) / 86400000);
  if (days < 1)   return t('span_day_one', [1]);
  if (days < 14)  return t(days !== 1 ? 'span_day_other' : 'span_day_one', [days]);
  if (days < 60)  { const w = Math.round(days / 7);  return t(w !== 1 ? 'span_week_other' : 'span_week_one', [w]); }
  if (days < 730) { const m = Math.round(days / 30.44); return t(m !== 1 ? 'span_month_other' : 'span_month_one', [m]); }
  const y = (days / 365.25).toFixed(1);
  return t(y !== '1.0' ? 'span_year_other' : 'span_year_one', [y]);
}

export const DEFAULT_CLOCK_FORMAT = '24h';

export function formatHourLabel(h, clockFormat) {
  if (clockFormat !== '12h') return `${String(h).padStart(2, '0')}:00`;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12} ${period}`;
}

export function formatTimeOfDay(ts, clockFormat) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  if (clockFormat === '12h') {
    const period = h < 12 ? 'AM' : 'PM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatHourRange(h, sep, clockFormat) {
  return `${formatHourLabel(h, clockFormat)}${sep}${formatHourLabel((h + 1) % 24, clockFormat)}`;
}
