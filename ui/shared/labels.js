import { getDomain, getDomainWithoutSuffix } from '../vendor/tldts.js';
import { loadInstalledApps, hasFavicon } from './utils.js';
import { host } from './host.js';
import { PREF_SYNC_APP_LABELS } from './prefKeys.js';
import { eTLDPlus1 } from '../background/siteResolution.js';
import { t } from './i18n.js';

// This device's installed apps first; names another device synced cover the apps it lacks.
const installedApps = await loadInstalledApps();
const syncedLabels = (await host.prefs.get(PREF_SYNC_APP_LABELS))[PREF_SYNC_APP_LABELS] ?? {};

function titleCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

// An app, not a site: installed here, or named by another device's sync.
export function isAppId(id) {
  return installedApps.has(id) || Object.hasOwn(syncedLabels, id);
}

// The id whose icon stands for a merged entry: the first with a known icon, else the first site
// (the browser fetches a site's favicon, never a package's), else the first id.
export function iconId(ids) {
  return ids.find(hasFavicon) ?? ids.find(id => !isAppId(id)) ?? ids[0];
}

// Several ids in one short line: "3 sites · 6 subdomains · 1 app". One site alone shows only its
// subdomains; subdomains show only when a site has more than one host.
export function idsSummary(ids) {
  const apps = ids.filter(isAppId).length;
  const hosts = ids.filter(id => !isAppId(id));
  const sites = new Set(hosts.map(eTLDPlus1)).size;
  const parts = [];
  if (sites && !(sites === 1 && hosts.length > 1 && !apps)) parts.push(t(sites === 1 ? 'dashboard_siteCount_one' : 'dashboard_sitesCount', [sites]));
  if (hosts.length > sites) parts.push(t('dashboard_subdomainsCount', [hosts.length]));
  if (apps) parts.push(t(apps === 1 ? 'dashboard_appCount_one' : 'dashboard_appCount_other', [apps]));
  return parts.join(' · ');
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
