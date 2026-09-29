import { getDomain, getDomainWithoutSuffix } from '../vendor/tldts.js';
import { loadInstalledApps, hasFavicon, faviconUrl } from './utils.js';
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

// A package's name, installed here or synced from the device that captured it; undefined for an
// app neither knows, unlike formatHostnameLabel, which falls back to a name built from the id.
export function appLabel(pkg) {
  return installedApps.get(pkg)?.label ?? syncedLabels[pkg];
}

// The id whose icon stands for a merged entry: the first with a known icon, else the first site
// (the browser fetches a site's favicon, never a package's), else the first id.
export function iconId(ids) {
  return ids.find(hasFavicon) ?? ids.find(id => !isAppId(id)) ?? ids[0];
}

// Same shapes as resources/icons/ui/apps.svg and site.svg. A favicon slot swaps <img src>, not a
// CSS mask, so those static files can't pick up currentColor from the page; this builds the same
// glyph as a data URI instead, in the border color the theme is using right now.
const APP_GLYPH = '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>';
const SITE_GLYPH = '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>';

function themedGlyph(inner) {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#8a8a8a';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// The icon to show for a resource or a merged group of them: a real one where a host can get it,
// else our own app or site glyph instead of the browser's blank icon or its generic globe.
// `knownApp` overrides the isAppId guess when a caller already knows for certain, e.g. a rule's
// own matcher carries `source`; a merged dashboard row has no source left to check by that point.
export function resourceIconUrl(ids, knownApp) {
  const id = iconId(ids);
  if (knownApp ?? isAppId(id)) return hasFavicon(id) ? faviconUrl(id) : themedGlyph(APP_GLYPH);
  return host.features.siteFavicons ? faviconUrl(id) : themedGlyph(SITE_GLYPH);
}

// Chrome's own placeholder for "no favicon on file", not an error, so it never reaches showErrorImage
// listeners or naturalWidth checks: it is a normal, fixed image, always this exact size and content
// for every unknown site (checked in this Chrome build). A future Chrome may render it differently;
// this then just stops firing and Chrome's globe shows again, same as before this existed.
const CHROME_BLANK = { size: 646, hash: 173330578 };
const checked = new Map(); // _favicon src -> the blank check's promise, so a repeat render skips it

function bytesHash(bytes) {
  let h = 0;
  for (const b of bytes) h = (h * 31 + b) >>> 0;
  return h;
}

async function isChromesBlank(src) {
  try {
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    return bytes.length === CHROME_BLANK.size && bytesHash(bytes) === CHROME_BLANK.hash;
  } catch {
    return false;
  }
}

const favSrc = (el) => ('src' in el ? el.src : el.getAttribute('href'));
const setFavSrc = (el, v) => { if ('src' in el) el.src = v; else el.setAttribute('href', v); };

// Whether a real icon exists among `ids`, without going through Chrome's live guess yet: a cached
// favicon or an installed app icon, checked synchronously. Async only for the leftover case, a site
// id whose real favicon (if it has one) only Chrome's own live _favicon guess can confirm.
async function bestKnownFavicon(ids) {
  const known = ids.find(hasFavicon);
  if (known) return faviconUrl(known);
  if (!host.features.siteFavicons) return null;
  for (const id of ids.filter(id => !isAppId(id))) {
    const src = faviconUrl(id);
    if (!checked.has(src)) checked.set(src, isChromesBlank(src));
    if (!(await checked.get(src))) return src;
  }
  return null;
}

// Corrects every favicon under `root` once the images are already in the DOM — same idea as
// hideBrokenIcons() for a failed load: the row shows something at once, right the first time.
// An element tagged `data-fav-label`/`data-fav-ids` is grouped with every other element sharing
// that label, on the page right now, merged or not: resourceIconUrl() can only pick from one row's
// own ids, so a site's real favicon is invisible to its same-named app row until this runs — this
// is what actually lends it across. An untagged element is its own group of one, keeping the
// older, simpler behavior: swap a placeholder for the glyph, leave a real one alone.
export async function resolveFavicons(root) {
  const groups = new Map();
  [...root.querySelectorAll('img, image')].forEach((el, i) => {
    const key = el.getAttribute('data-fav-label') ?? `#${i}`;
    if (!groups.has(key)) groups.set(key, { ids: new Set(), els: [] });
    const g = groups.get(key);
    (el.getAttribute('data-fav-ids') ?? '').split(',').filter(Boolean).forEach(id => g.ids.add(id));
    g.els.push(el);
  });
  await Promise.all([...groups.values()].map(async ({ ids, els }) => {
    if (ids.size) {
      const real = await bestKnownFavicon([...ids]);
      if (real) return els.forEach(el => setFavSrc(el, real));
    }
    const stillBlank = await Promise.all(els.map(async el => {
      const src = favSrc(el);
      if (!src.includes('/_favicon/')) return false;
      if (!checked.has(src)) checked.set(src, isChromesBlank(src));
      return checked.get(src);
    }));
    els.forEach((el, i) => { if (stillBlank[i]) setFavSrc(el, themedGlyph(SITE_GLYPH)); });
  }));
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
