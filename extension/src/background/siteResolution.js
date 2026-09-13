import { getDomain, getDomainWithoutSuffix } from '../vendor/tldts.js';

export function resolveSite(hostname) {
  const siteId = getDomain(hostname) ?? hostname;
  const siteLabel = getDomainWithoutSuffix(hostname) ?? hostname;
  return { siteId, siteLabel };
}

export function eTLDPlus1(hostname) {
  return getDomain(hostname) ?? hostname;
}

export function siteIdFromUrl(url) {
  if (!url?.startsWith('http')) return null;
  const host = new URL(url).hostname;
  return host.startsWith('www.') ? host.slice(4) : host;
}

export function pathFromUrl(url) {
  if (!url?.startsWith('http')) return null;
  const u = new URL(url);
  const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '');
  return path + u.search;
}
