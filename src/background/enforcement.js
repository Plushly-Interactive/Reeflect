import { describeRule, blockKey } from '../shared/rules.js';
import { siteIdFromUrl, pathFromUrl } from './siteResolution.js';
import { pickQuote } from '../shared/quotes.js';
import { dbg } from './trackingDebug.js';
import { loadCore, timeJson } from '../shared/core.js';
import { computeOverage as coreComputeOverage } from '../vendor/reeflect-core/reeflect_core_wasm.js';

// Does subpage key `p` fall under the rule's path? Boundary-anchored so
// '/maps' matches '/maps', '/maps/x', '/maps?x' but not '/maps-beta'.
function pathUnder(p, rulePath) {
  const base = '/' + rulePath.replace(/^\//, '');
  if (p === base) return true;
  if (!p.startsWith(base)) return false;
  const next = p[base.length];
  return next === '/' || next === '?';
}

// The verdict is the core's. Rows go in as stored; the core aggregates the window and applies
// every enabled rule under the user's week start and zone. Its entries carry a matcher list, one
// per source; everything below still speaks the extension's flat one-matcher shape, so entries are
// flattened here and nowhere else. Returns { overage, approaching } as Maps keyed by rule id:
//   overage: { matchType, target?, path?, pattern?, keyword?, overBy }
//   approaching: { matchType, target?, path?, pattern?, keyword?, period, pct, limit, limitUnit, remainingMs }
export async function computeOverage(rules, rows, windowStartMs, now = Date.now()) {
  await loadCore();
  const out = JSON.parse(coreComputeOverage(JSON.stringify(rules), JSON.stringify(rows), windowStartMs, await timeJson(windowStartMs, now)));
  const flat = ({ matchers, ...rest }) => {
    const { source: _source, ...matcher } = matchers[0];
    return { ...matcher, ...rest };
  };
  const toMap = (o) => new Map(Object.entries(o).map(([id, e]) => [id, flat(e)]));
  return { overage: toMap(out.overage), approaching: toMap(out.approaching) };
}

// --- DNR publisher (chrome APIs) ---

function blockedUrl(ruleId, entry, originalUrl, quoteId) {
  const params = new URLSearchParams({ rule: ruleId, blockKey: blockKey(entry) });
  if (entry.target) {
    params.set('site', entry.target);
    if (entry.path) params.set('path', entry.path);
  }
  if (originalUrl) params.set('url', originalUrl);
  if (quoteId) params.set('quoteId', quoteId);
  return chrome.runtime.getURL(`src/pages/blocked/blocked.html?${params}`);
}

function buildRule(ruleId, entry, id, quoteId) {
  const { kind, value } = describeRule(entry);
  return {
    id,
    priority: 1,
    action: { type: 'redirect', redirect: { url: blockedUrl(ruleId, entry, undefined, quoteId) } },
    condition: { [kind]: value, resourceTypes: ['main_frame'] },
  };
}

// Does an open tab's URL fall under this overage entry? Mirrors the core's
// matching (same siteId/path normalization), so reloaded tabs are exactly the
// ones DNR will then redirect.
function tabMatchesEntry(url, entry) {
  if (entry.matchType === 'regex') {
    try { return new RegExp(entry.pattern).test(url); } catch { return false; }
  }
  if (entry.matchType === 'keyword') return url.includes(entry.keyword);
  const siteId = siteIdFromUrl(url);
  if (!siteId) return false;
  if (entry.matchType === 'subdomain') return siteId === entry.target || siteId.endsWith(`.${entry.target}`);
  if (entry.matchType === 'pathPrefix') return siteId === entry.target && pathUnder(pathFromUrl(url) ?? '', entry.path);
  return siteId === entry.target; // host
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
  const blockedSites = new Map();
  const pairs = [...overage]; // [ruleId, entry]
  if (!pairs.length) return blockedSites;
  const tabs = await chrome.tabs.query({});
  const matching = tabs.filter(tab => tab.url && pairs.find(([, e]) => tabMatchesEntry(tab.url, e)));
  const site = pairs[0][1].target ?? '';
  const quote = matching.length ? await pickQuote(site) : null;
  const quoteId = quote?.id ?? null;
  for (const tab of matching) {
    const hit = pairs.find(([, e]) => tabMatchesEntry(tab.url, e));
    const [ruleId, entry] = hit;
    if (!blockedSites.has(ruleId)) blockedSites.set(ruleId, siteIdFromUrl(tab.url) ?? entry.target);
    // We know the exact page this tab is on, so send it to the blocked page
    // ourselves with the original URL preserved — returnUnblockedTabs uses it to
    // restore the exact page on unblock. (DNR still catches fresh navigations;
    // those carry no original URL and fall back to the rule target.)
    chrome.tabs.update(tab.id, { url: blockedUrl(ruleId, entry, tab.url, quoteId) });
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

  // Reconstruct ruleId → dnrId from existing redirect URLs so we reuse the
  // same integer IDs across ticks (no hash, no collisions).
  const liveMap = new Map();
  const usedIds = new Set();
  for (const r of existing) {
    usedIds.add(r.id);
    try {
      const ruleId = new URL(r.action.redirect.url).searchParams.get('rule');
      if (ruleId) liveMap.set(ruleId, r.id);
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
    const id = liveMap.get(ruleId) ?? freshId();
    const isNew = !liveMap.has(ruleId);
    // Pick the quote once, when the DNR rule is first published, so it's baked
    // into the redirect URL — every fresh nav and reload under this rule then
    // shows the same quote, until the rule is torn down and republished (limit
    // reset, disable/enable). Skipped for already-live rules: their rebuilt URL
    // here is discarded below (not in addRules), so picking one would just burn
    // a "seen" slot in quotes storage for nothing.
    const quote = isNew ? await pickQuote(entry.target ?? '') : null;
    desired.set(id, buildRule(ruleId, entry, id, quote?.id ?? null));
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
