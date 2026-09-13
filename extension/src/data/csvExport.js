import { showNotification } from '../shared/utils.js';
import { t } from '../shared/i18n.js';

// CSV export logic, no modal/DOM wiring — callable from any page. Operates on the
// site/subpage day & hour shapes, which the scalar buckets and the interval
// aggregates share, so one builder serves both sources.
function csvField(value) {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function siteRow(prefix, host, cell) {
  return `${prefix},${host},,${((cell.activeMs ?? 0) / 60000).toFixed(2)},${((cell.audioMs ?? 0) / 60000).toFixed(2)},${cell.visits ?? 0}`;
}

function subpageRow(prefix, host, path, cell) {
  return `${prefix},${host},${csvField(path)},${((cell.activeMs ?? 0) / 60000).toFixed(2)},${((cell.audioMs ?? 0) / 60000).toFixed(2)},${cell.visits ?? 0}`;
}

function downloadCsv(rows, filename) {
  if (rows.length === 1) {
    showNotification(t('data_noDataToExport'));
    return;
  }
  const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showNotification(t('data_exportedTo', [filename]));
}

export function downloadDailyCsv(sitesByDay, subpagesByDay) {
  const rows = ['date,host,path,active_min,audio_min,visits'];
  for (const [day, sites] of Object.entries(sitesByDay).sort()) {
    for (const [host, cell] of Object.entries(sites).sort()) {
      const paths = subpagesByDay[day]?.[host];
      if (paths && Object.keys(paths).length > 0) {
        for (const [path, pathCell] of Object.entries(paths).sort()) rows.push(subpageRow(day, host, path, pathCell));
      } else {
        rows.push(siteRow(day, host, cell));
      }
    }
  }
  downloadCsv(rows, `browsing-data-daily-${new Date().toISOString().slice(0, 10)}.csv`);
}

function localDateTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Raw interval rows (interval log only) — one line per presence range, exact times.
export function downloadIntervalsCsv(rows) {
  const out = ['start,end,duration_min,domain,path,kind'];
  for (const r of [...rows].sort((a, b) => a.from - b.from)) {
    out.push(`${localDateTime(r.from)},${localDateTime(r.to)},${((r.to - r.from) / 60000).toFixed(2)},${csvField(r.domain)},${csvField(r.path)},${r.kind}`);
  }
  downloadCsv(out, `browsing-data-intervals-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function downloadHourlyCsv(sitesByHour, subpagesByHour) {
  const rows = ['date,hour,host,path,active_min,audio_min,visits'];
  for (const [bucket, sites] of Object.entries(sitesByHour).sort()) {
    const [date, time] = bucket.split('T');
    const prefix = `${date},${parseInt(time, 10)}`;
    for (const [host, cell] of Object.entries(sites).sort()) {
      const paths = subpagesByHour[bucket]?.[host];
      if (paths && Object.keys(paths).length > 0) {
        for (const [path, pathCell] of Object.entries(paths).sort()) rows.push(subpageRow(prefix, host, path, pathCell));
      } else {
        rows.push(siteRow(prefix, host, cell));
      }
    }
  }
  downloadCsv(rows, `browsing-data-hourly-${new Date().toISOString().slice(0, 10)}.csv`);
}
