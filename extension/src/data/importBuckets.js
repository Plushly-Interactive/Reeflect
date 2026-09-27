import { SITES_DAY_KEY, SITES_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY } from './bucketKeys.js';
import { blockKey, matchersOf, RULE_MULTIPLIERS } from '../shared/rules.js';
import { EXPORT_PREF_KEYS } from './exportPayload.js';
import { BRAND_NAME } from '../shared/brand.js';
import { host } from '../shared/host.js';

// Restore the bucket tier, rules and prefs from a backup file. Buckets are
// frozen legacy data post-cutover, so they land in the same store the legacy page
// reads; rules and prefs are live. The interval rows in a backup are restored
// separately (temporal-overlap flow on the storage page) — this module owns only
// the day-keyed bucket portion, mirroring the Time Tracker import's day model.

function normalizeHost(host) {
  return host.startsWith('www.') ? host.slice(4) : host;
}

function sumCell(a, b) {
  return {
    activeMs: (a.activeMs ?? 0) + (b.activeMs ?? 0),
    audioMs: (a.audioMs ?? 0) + (b.audioMs ?? 0),
    overlapMs: (a.overlapMs ?? 0) + (b.overlapMs ?? 0),
    visits: (a.visits ?? 0) + (b.visits ?? 0),
  };
}

function normalizeSiteBuckets(buckets) {
  for (const [bucketKey, sites] of Object.entries(buckets)) {
    const next = {};
    for (const [siteId, cell] of Object.entries(sites)) {
      const host = normalizeHost(siteId);
      next[host] = next[host] ? sumCell(next[host], cell) : cell;
    }
    buckets[bucketKey] = next;
  }
}

function normalizeSubpageBuckets(buckets) {
  for (const [bucketKey, sites] of Object.entries(buckets)) {
    const next = {};
    for (const [siteId, paths] of Object.entries(sites)) {
      const host = normalizeHost(siteId);
      if (!next[host]) { next[host] = paths; continue; }
      const merged = next[host];
      for (const [p, cell] of Object.entries(paths))
        merged[p] = merged[p] ? sumCell(merged[p], cell) : cell;
    }
    buckets[bucketKey] = next;
  }
}

export function validateBackupFile(json) {
  if (typeof json.version === 'number' && json.version > 3) {
    return `This file was exported by a newer version of ${BRAND_NAME} (version ${json.version}). Update the extension to import it.`;
  }
  if (json.version !== 1 && json.version !== 2 && json.version !== 3) {
    return `Unrecognized ${BRAND_NAME} file version.`;
  }
  if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) {
    return "The file's tracking data section is missing or has an unexpected shape.";
  }
  for (const key of [SITES_DAY_KEY, SITES_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY]) {
    const v = json.data[key];
    if (v !== undefined && (typeof v !== 'object' || Array.isArray(v))) {
      return `The file's "${key}" section is not a valid object.`;
    }
  }
  if (json.rules !== undefined && !Array.isArray(json.rules)) {
    return "The file's rules section is not a valid array.";
  }
  return null;
}

// Pull the bucket/rules/prefs payload out of a validated backup, normalizing
// www-prefixed hosts so they merge with the canonical host. Throws on corrupt
// bucket shapes; the caller surfaces a friendly error.
export function parseBackupImport(json) {
  // Older files use the legacy analyticsBy* key for the site buckets.
  const importByDay = json.data[SITES_DAY_KEY] || json.data.analyticsByDay || {};
  const importByHour = json.data[SITES_HOUR_KEY] || json.data.analyticsByHour || {};
  const importSubpagesByDay = json.data[SUBPAGES_DAY_KEY] || {};
  const importSubpagesByHour = json.data[SUBPAGES_HOUR_KEY] || {};
  normalizeSiteBuckets(importByDay);
  normalizeSiteBuckets(importByHour);
  normalizeSubpageBuckets(importSubpagesByDay);
  normalizeSubpageBuckets(importSubpagesByHour);
  return {
    importByDay, importByHour, importSubpagesByDay, importSubpagesByHour,
    importRules: Array.isArray(json.rules) ? json.rules : null,
    importPrefs: json.prefs && typeof json.prefs === 'object' ? json.prefs : null,
  };
}

// Days in the file that already have bucket data — the keep/replace decision set.
export async function backupDayConflicts(importByDay) {
  const { [SITES_DAY_KEY]: sitesByDay = {} } = await host.prefs.get(SITES_DAY_KEY);
  return Object.keys(importByDay).filter(d => sitesByDay[d]).sort();
}

function ruleDomain(r) {
  return r.matchType === 'regex' || r.matchType === 'keyword' ? null : r.target;
}

const ruleIdentity = (r) => matchersOf(r).map(blockKey).join(' + ');

function limitMs(r) {
  return r.limit * (RULE_MULTIPLIERS[r.limitUnit] ?? 60000);
}

// Two rules are the same when they block the same thing the same way. Limit is
// compared by effective duration, so 6h and 360min count as equal; limitUnit alone
// (a display choice) is not a difference. enabled is excluded on purpose: a rule the
// user disabled stays disabled, never re-imported as enabled.
function rulesEqual(a, b) {
  return a.matchType === b.matchType && a.target === b.target && (a.path ?? '') === (b.path ?? '')
    && a.pattern === b.pattern && a.keyword === b.keyword
    && limitMs(a) === limitMs(b) && a.period === b.period && a.mode === b.mode;
}

function sameRuleSet(a, b) {
  return a.length === b.length
    && a.every(x => b.some(y => rulesEqual(x, y)))
    && b.every(y => a.some(x => rulesEqual(x, y)));
}

// Domains where the file and current rules both have entries but differ in any way
// (scope, limit, mode, period). These are the keep/replace decision set; a new
// domain merges silently and an identical rule is a no-op.
export function backupRuleConflicts(currentRules, importRules) {
  if (!importRules?.length) return [];
  const conflicts = new Set();
  for (const domain of new Set(importRules.map(ruleDomain).filter(Boolean))) {
    const cur = currentRules.filter(c => ruleDomain(c) === domain);
    if (cur.length === 0) continue;
    const file = importRules.filter(f => ruleDomain(f) === domain);
    if (!sameRuleSet(cur, file)) conflicts.add(domain);
  }
  return [...conflicts].sort();
}

// Settings keys whose stored value would be overwritten by a different file value.
// Object-valued prefs (chartColors) compare by content, scalars by value.
function prefEquals(a, b) {
  return typeof a === 'object' && a !== null && typeof b === 'object' && b !== null
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;
}

// A key the user hasn't set yet is not a conflict (it applies silently).
export function backupPrefsConflicts(importPrefs, currentPrefs) {
  if (!importPrefs) return [];
  return EXPORT_PREF_KEYS.filter(k =>
    importPrefs[k] !== undefined && currentPrefs[k] !== undefined && !prefEquals(currentPrefs[k], importPrefs[k]));
}

// Merge file rules into current. A conflicting domain is taken from the file only
// when listed in replaceDomains (dropping the current rules there first); otherwise
// the current rules stay. New domains and new non-domain rules are added; identical
// rules are skipped.
function mergeRules(currentRules, importRules, replaceDomains) {
  if (!importRules?.length) return currentRules;
  const conflicts = new Set(backupRuleConflicts(currentRules, importRules));
  const out = currentRules.filter(c => {
    const d = ruleDomain(c);
    return !(d && conflicts.has(d) && replaceDomains.has(d));
  });
  for (const fr of importRules) {
    const d = ruleDomain(fr);
    if (d && conflicts.has(d) && !replaceDomains.has(d)) continue;
    // Dedup by identity (target+scope, or pattern/keyword, for each target of the
    // rule) so a rule differing only by limit doesn't land as a second rule.
    if (!out.some(c => ruleIdentity(c) === ruleIdentity(fr))) out.push(fr);
  }
  return out;
}

// Merge the parsed payload into storage. A day is taken when it's new or listed in
// daysToReplace; hour buckets follow their day. Rules merge per domain (conflicts
// only replaced when their domain is in replaceRuleDomains). New prefs apply; a pref
// that would overwrite a differing current value applies only when overwritePrefs.
// Returns a summary for the notification.
export async function applyBackupImport(parsed, { daysToReplace = new Set(), replaceRuleDomains = new Set(), overwritePrefs = false } = {}) {
  const { importByDay, importByHour, importSubpagesByDay, importSubpagesByHour, importRules, importPrefs } = parsed;

  const {
    rules: currentRules = [],
    [SITES_DAY_KEY]: sitesByDay = {},
    [SITES_HOUR_KEY]: sitesByHour = {},
    [SUBPAGES_DAY_KEY]: subpagesByDay = {},
    [SUBPAGES_HOUR_KEY]: subpagesByHour = {},
    ...currentPrefs
  } = await host.prefs.get(['rules', SITES_DAY_KEY, SITES_HOUR_KEY, SUBPAGES_DAY_KEY, SUBPAGES_HOUR_KEY, ...EXPORT_PREF_KEYS]);

  const daysToTake = new Set();
  for (const d of Object.keys(importByDay)) {
    if (!sitesByDay[d] || daysToReplace.has(d)) daysToTake.add(d);
  }

  for (const d of daysToTake) {
    sitesByDay[d] = importByDay[d];
    if (importSubpagesByDay[d]) subpagesByDay[d] = importSubpagesByDay[d];
    const prefix = `${d}T`;
    for (const [hk, sites] of Object.entries(importByHour)) {
      if (hk.startsWith(prefix)) sitesByHour[hk] = sites;
    }
    for (const [hk, sites] of Object.entries(importSubpagesByHour)) {
      if (hk.startsWith(prefix)) subpagesByHour[hk] = sites;
    }
  }

  const update = {
    [SITES_DAY_KEY]: sitesByDay,
    [SITES_HOUR_KEY]: sitesByHour,
    [SUBPAGES_DAY_KEY]: subpagesByDay,
    [SUBPAGES_HOUR_KEY]: subpagesByHour,
  };

  let rulesApplied = null;
  if (importRules?.length) {
    const merged = mergeRules(currentRules, importRules, replaceRuleDomains);
    update.rules = merged;
    // Count only file rules actually brought in: present in the result, and not
    // already an identical current rule (those dedup to a no-op, not an import).
    rulesApplied = importRules.filter(fr =>
      merged.some(m => rulesEqual(m, fr)) && !currentRules.some(c => rulesEqual(c, fr))).length;
  }

  let prefsApplied = 0;
  if (importPrefs) {
    for (const k of EXPORT_PREF_KEYS) {
      if (importPrefs[k] === undefined) continue;
      const isNew = currentPrefs[k] === undefined;
      const differs = !isNew && !prefEquals(currentPrefs[k], importPrefs[k]);
      if (isNew || (differs && overwritePrefs)) { update[k] = importPrefs[k]; prefsApplied++; }
    }
  }

  await host.prefs.set(update);

  return { days: daysToTake.size, rules: rulesApplied, prefs: prefsApplied || null };
}
