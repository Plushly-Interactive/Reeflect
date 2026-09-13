import { getDomain, getDomainWithoutSuffix } from '../vendor/tldts.js';

function titleCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

export function formatHostnameLabel(hostname) {
  if (!hostname) return '';
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
