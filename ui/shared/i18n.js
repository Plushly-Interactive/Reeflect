// Messages must use positional $1/$2 substitution only — no named $FOO$
// placeholders, no literal $ escaping. chrome.i18n.getMessage supports those,
// but the override loader below (used when the user picks a language that
// differs from the browser's) does not, and the two must behave identically.
import { PREF_LANGUAGE } from './prefKeys.js';
import { host } from './host.js';

export const DEFAULT_LANGUAGE = 'auto';

let english = null;
let overrideMessages = null;
let currentLocale;

async function loadMessages(lang) {
  const res = await fetch(host.assetUrl(`_locales/${lang}/messages.json`));
  return res.ok ? await res.json() : null;
}

export async function initI18n() {
  english ??= await loadMessages('en');
  const stored = (await host.prefs.get(PREF_LANGUAGE))[PREF_LANGUAGE];
  const lang = stored || DEFAULT_LANGUAGE;
  if (lang === DEFAULT_LANGUAGE) {
    overrideMessages = null;
    currentLocale = undefined;
    return;
  }
  overrideMessages = await loadMessages(lang);
  // 'en-GB' (not bare 'en') keeps day-before-month order, matching fr/es.
  currentLocale = !overrideMessages ? undefined : lang === 'en' ? 'en-GB' : lang;
}

// BCP47 locale for Intl.DateTimeFormat (weekday/month names), matching the
// user's language pick. undefined falls back to the browser's own locale.
export function getLocale() {
  return currentLocale;
}

const SUPPORTED_LANGS = ['en', 'es', 'fr'];

// For data that carries its own inline translations instead of going through
// messages.json (see shared/changelogEntries.js) — resolves 'auto' against
// the browser's UI language rather than leaving callers to special-case it.
export async function resolveLanguage() {
  const stored = (await host.prefs.get(PREF_LANGUAGE))[PREF_LANGUAGE];
  if (stored && stored !== DEFAULT_LANGUAGE) return stored;
  const ui = host.uiLanguage().split('-')[0];
  return SUPPORTED_LANGS.includes(ui) ? ui : 'en';
}

export function t(key, subs) {
  const entry = overrideMessages?.[key] ?? english?.[key];
  if (!entry) return '';
  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return entry.message.replace(/\$(\d+)/g, (_match, n) => list[n - 1] ?? '');
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  // For elements with non-text children after the label (e.g. a dropdown
  // button's arrow icon) — replaces only the leading text node, not the whole subtree.
  root.querySelectorAll('[data-i18n-firstchild]').forEach((el) => {
    el.firstChild.textContent = t(el.dataset.i18nFirstchild);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}
