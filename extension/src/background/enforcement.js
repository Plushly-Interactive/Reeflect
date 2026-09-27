import { describeRule, blockKey, isWebMatcher, matchLabel } from '../shared/rules.js';
import { siteIdFromUrl, pathFromUrl } from './siteResolution.js';
import { pickQuote } from '../shared/quotes.js';
import { dbg } from './trackingDebug.js';
import { loadCore, timeJson } from '../shared/core.js';
import { computeOverage as coreComputeOverage, matchesRule } from '../vendor/reeflect-core/reeflect_core_wasm.js';

// The verdict is the core's. Rows go in as stored; the core aggregates the window and applies
// every enabled rule under the user's week start and zone. Its entries carry every matcher of the
// rule, apps included; the browser blocks the web ones. Each entry keeps its first web matcher's
// fields flat, lists all web matchers in `web`, and names the rule in `label`. A rule with no web
// matcher is not the browser's to block. Returns { overage, approaching } as Maps keyed by rule id:
//   overage: { matchType, target?, path?, pattern?, keyword?, web, label?, overBy }
//   approaching: { matchType, target?, path?, pattern?, keyword?, web, label?, period, pct, limit, limitUnit, remainingMs }
export async function computeOverage(rules, rows, windowStartMs, now = Date.now()) {
  await loadCore();
  const out = JSON.parse(coreComputeOverage(JSON.stringify(rules), JSON.stringify(rows), windowStartMs, await timeJson(windowStartMs, now)));
  const byId = new Map(rules.map((r) => [r.id, r]));
  const flat = (id, { matchers, ...rest }) => {
    const web = matchers.filter(isWebMatcher).map(({ source: _source, ...m }) => m);
    if (!web.length) return null;
    // Named or combined rules go by matchLabel; a plain one keeps its target, as notifications always showed.
    const rule = byId.get(id);
    const label = rule && (rule.name || matchers.length > 1) ? matchLabel(rule) : undefined;
    return { ...web[0], ...rest, web, label };
  };
  const toMap = (o) => new Map(Object.entries(o).map(([id, e]) => [id, flat(id, e)]));
  const result = { overage: toMap(out.overage), approaching: toMap(out.approaching) };
  for (const m of Object.values(result)) for (const [k, v] of m) if (!v) m.delete(k);
  return result;
}

// --- DNR publisher (chrome APIs) ---

// `m` is the web matcher that blocks; `index` is its place in the entry, so each of a rule's DNR
// rules keeps its id from one check to the next (see publishOverage).
function blockedUrl(ruleId, m, index, originalUrl, quoteId) {
  const params = new URLSearchParams({ rule: ruleId, blockKey: blockKey(m) });
  if (index) params.set('matcher', String(index));
  if (m.target) {
    params.set('site', m.target);
    if (m.path) params.set('path', m.path);
  }
  if (originalUrl) params.set('url', originalUrl);
  if (quoteId) params.set('quoteId', quoteId);
  return chrome.runtime.getURL(`src/pages/blocked/blocked.html?${params}`);
}

function buildRule(ruleId, m, index, id, quoteId) {
  const { kind, value } = describeRule(m);
  return {
    id,
    priority: 1,
    action: { type: 'redirect', redirect: { url: blockedUrl(ruleId, m, index, undefined, quoteId) } },
    condition: { [kind]: value, resourceTypes: ['main_frame'] },
  };
}

// Does the rule that tripped cover the resource this tab is on? A tab reduces to a resource, site id
// plus path, and the core answers coverage, the same answer that counted the usage, so a reloaded tab
// is exactly one DNR will then redirect. Identity is the host's; coverage is the core's.
// Answers the index of the first web matcher of the entry that covers the tab, or -1.
function tabMatchIndex(url, entry) {
  const siteId = siteIdFromUrl(url);
  if (!siteId) return -1;
  const path = pathFromUrl(url) ?? '';
  return entry.web.findIndex((m) => matchesRule(JSON.stringify(m), siteId, path));
}

// DNR redirects new requests, not tabs already sitting on a page. So for any
// open http(s) tab covered by an over-limit entry, navigate it to the blocked
// page ourselves — carrying the tab's exact URL so unblock can restore it.
// Tabs already on blocked.html (a chrome-extension URL) don't match, so there's
// no loop. Driven by the full overage set so it also catches tabs open before
// the rule existed (e.g. when a rule is enabled).
// Returns Map<ruleId, hostname> of rules that blocked a currently-open tab,
// carrying the tab's real host so the "now blocked" notification names the
// actual site (not a keyword/regex pattern). A rule matching several tabs keeps
// the first host seen.
async function reloadMatchingTabs(overage) {
  await loadCore();
  const blockedSites = new Map();
  const pairs = [...overage]; // [ruleId, entry]
  if (!pairs.length) return blockedSites;
  const tabs = await chrome.tabs.query({});
  const hitOf = (tab) => {
    for (const [ruleId, entry] of pairs) {
      const index = tabMatchIndex(tab.url, entry);
      if (index >= 0) return { ruleId, entry, index };
    }
    return null;
  };
  const matching = tabs.filter(tab => tab.url && hitOf(tab));
  const site = pairs[0][1].target ?? '';
  const quote = matching.length ? await pickQuote(site) : null;
  const quoteId = quote?.id ?? null;
  for (const tab of matching) {
    const { ruleId, entry, index } = hitOf(tab);
    if (!blockedSites.has(ruleId)) blockedSites.set(ruleId, siteIdFromUrl(tab.url) ?? entry.target);
    // We know the exact page this tab is on, so send it to the blocked page
    // ourselves with the original URL preserved — returnUnblockedTabs uses it to
    // restore the exact page on unblock. (DNR still catches fresh navigations;
    // those carry no original URL and fall back to the rule target.)
    chrome.tabs.update(tab.id, { url: blockedUrl(ruleId, entry.web[index], index, tab.url, quoteId) });
  }
  return blockedSites;
}

// Send blocked.html tabs back to their site once their rule is no longer
// enforced (limit reset, or rule disabled/deleted). A blocked tab carries its
// origin in ?rule/?site/?path; if that rule id is no longer over-limit, navigate
// it back. Reconstructs https://<site>[/<path>] — scheme/query aren't preserved.
async function returnUnblockedTabs(overage) {
  const prefix = chrome.runtime.getURL('src/pages/blocked/blocked.html');
  const tabs = await chrome.tabs.query({ url: `${prefix}*` });
  for (const tab of tabs) {
    const params = new URLSearchParams(new URL(tab.url).search);
    const ruleId = params.get('rule');
    if (!ruleId || overage.has(ruleId)) continue; // still blocked
    // Prefer the exact original URL (set when we reloaded the tab into the
    // block); fall back to the rule target for tabs DNR blocked on a fresh nav.
    const original = params.get('url');
    if (original?.startsWith('http')) {
      chrome.tabs.update(tab.id, { url: original });
      continue;
    }
    const site = params.get('site');
    const path = params.get('path');
    if (!site) continue;
    chrome.tabs.update(tab.id, { url: `https://${site}${path ? `/${path}` : ''}` });
  }
}

// Reconcile the published DNR rules against the current overage set. Adds rules
// for newly-over entries, removes rules no longer over. Uses getDynamicRules as
// the source of truth so it self-heals across service-worker restarts.
export async function publishOverage(overage) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  // Reconstruct "ruleId|matcher index" → dnrId from existing redirect URLs so we
  // reuse the same integer IDs across ticks (no hash, no collisions). A URL with
  // no `matcher` is index 0.
  const liveMap = new Map();
  const usedIds = new Set();
  for (const r of existing) {
    usedIds.add(r.id);
    try {
      const q = new URL(r.action.redirect.url).searchParams;
      const ruleId = q.get('rule');
      if (ruleId) liveMap.set(`${ruleId}|${q.get('matcher') ?? 0}`, r.id);
    } catch {}
  }

  let nextId = 1;
  function freshId() {
    while (usedIds.has(nextId)) nextId++;
    usedIds.add(nextId);
    return nextId++;
  }

  const desired = new Map();
  const newRuleIds = new Set();
  for (const [ruleId, entry] of overage) {
    const isNew = !entry.web.some((_, i) => liveMap.has(`${ruleId}|${i}`));
    // Pick the quote once, when the DNR rule is first published, so it's baked
    // into the redirect URL — every fresh nav and reload under this rule then
    // shows the same quote, until the rule is torn down and republished (limit
    // reset, disable/enable). Skipped for already-live rules: their rebuilt URL
    // here is discarded below (not in addRules), so picking one would just burn
    // a "seen" slot in quotes storage for nothing.
    const quote = isNew ? await pickQuote(entry.target ?? '') : null;
    entry.web.forEach((m, i) => {
      const id = liveMap.get(`${ruleId}|${i}`) ?? freshId();
      desired.set(id, buildRule(ruleId, m, i, id, quote?.id ?? null));
    });
    if (isNew) newRuleIds.add(ruleId);
  }

  const existingIds = new Set(existing.map(r => r.id));
  const addRules = [...desired.values()].filter(r => !existingIds.has(r.id));
  const removeRuleIds = existing.map(r => r.id).filter(id => !desired.has(id));

  dbg('publishOverage: liveMap', [...liveMap.entries()], 'newRuleIds', [...newRuleIds], 'addRules', addRules, 'removeRuleIds', removeRuleIds);

  if (addRules.length || removeRuleIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
  }

  const blockedSites = await reloadMatchingTabs(overage);
  await returnUnblockedTabs(overage);
  return blockedSites;
}
