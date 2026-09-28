import { getDomain, getDomainWithoutSuffix } from '../vendor/tldts.js';
import { loadInstalledApps } from './utils.js';
import { host } from './host.js';
import { PREF_SYNC_APP_LABELS } from './prefKeys.js';

// This device's installed apps first; names another device synced cover the apps it lacks.
const installedApps = await loadInstalledApps();
const syncedLabels = (await host.prefs.get(PREF_SYNC_APP_LABELS))[PREF_SYNC_APP_LABELS] ?? {};

function titleCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

export function formatHostnameLabel(hostname) {
  if (!hostname) return '';
  const appLabel = installedApps.get(hostname)?.label ?? syncedLabels[hostname];
  if (appLabel) return appLabel;
  const etld1 = getDomain(hostname);
  const baseLabel = getDomainWithoutSuffix(hostname);
  if (!etld1 || !baseLabel) return titleCase(hostname);

  const parts = [titleCase(baseLabel)];
  if (hostname !== etld1) {
    const sub = hostname.slice(0, -(etld1.length + 1));
    const subParts = sub.split('.').reverse().map(titleCase);
    parts.push(...subParts);
  }
  return parts.join(' ');
}
