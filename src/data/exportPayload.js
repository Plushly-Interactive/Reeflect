import { SITES_DAY_KEY, SITES_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY } from './bucketKeys.js';
import { allIntervals } from './intervalLog.js';
import { showNotification } from '../shared/utils.js';
import { t } from '../shared/i18n.js';
import { PREF_LAST_EXPORT_AT, PREF_CLOCK_FORMAT, PREF_IDLE_THRESHOLD_SEC, PREF_WEEK_START, PREF_CHART_COLORS } from '../shared/prefKeys.js';
import { BRAND_NAME } from '../shared/brand.js';
import { host } from '../shared/host.js';

// Pure export logic, no modal/DOM wiring, safe to import from any page. Both the
// bucket storage page and the interval storage page build the same complete backup
// file here.
export const EXPORT_PREF_KEYS = [PREF_CLOCK_FORMAT, PREF_IDLE_THRESHOLD_SEC, PREF_WEEK_START, PREF_CHART_COLORS];

export async function buildBackupPayload() {
  const stored = await host.prefs.get([
    SITES_DAY_KEY, SITES_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY,
    'rules', ...EXPORT_PREF_KEYS,
  ]);
  const prefs = {};
  for (const k of EXPORT_PREF_KEYS) if (stored[k] !== undefined) prefs[k] = stored[k];
  return {
    format: 'browsing-data-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    rules: stored.rules ?? [],
    prefs,
    data: {
      [SITES_DAY_KEY]: stored[SITES_DAY_KEY] ?? {},
      [SITES_HOUR_KEY]: stored[SITES_HOUR_KEY] ?? {},
      [SUBPAGES_DAY_KEY]: stored[SUBPAGES_DAY_KEY] ?? {},
      [SUBPAGES_HOUR_KEY]: stored[SUBPAGES_HOUR_KEY] ?? {},
    },
    intervals: await allIntervals(),
  };
}

export async function downloadBackupExport() {
  const payload = await buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `${BRAND_NAME.toLowerCase().replace(/\s+/g, '')}-export-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  await host.prefs.set({ [PREF_LAST_EXPORT_AT]: Date.now() });
  showNotification(t('data_exportedTo', [filename]));
}
