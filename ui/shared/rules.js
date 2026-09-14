import { formatMs } from './timeUtils.js';
import { faviconUrl, escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { host } from './host.js';

export const RULE_MULTIPLIERS = { minutes: 60000, hours: 3600000, days: 86400000 };
export const BLOCKS_DAY_KEY = 'blocksByDay';

export function blockKey(rule) {
  if (rule.matchType === 'regex') return `${rule.pattern}|regex|`;
  if (rule.matchType === 'keyword') return `${rule.keyword}|keyword|`;
  return `${rule.target}|${rule.matchType}|${rule.path ?? ''}`;
}

const MODE_KEYS = { active: 'mode_active', audio: 'mode_audio', 'active+audio': 'mode_activeAudio' };
const SCOPE_KEYS = { host: 'scope_host', subdomain: 'scope_subdomain', pathPrefix: 'scope_pathPrefix', regex: 'scope_regex', keyword: 'scope_keyword', exact: 'scope_app' };

export function matchLabel(rule) {
  if (rule.source === 'app') return rule.label ?? rule.target;
  if (rule.matchType === 'regex') return rule.pattern;
  if (rule.matchType === 'keyword') return rule.keyword;
  if (rule.matchType === 'subdomain') return `*.${rule.target}`;
  if (rule.matchType === 'pathPrefix') return rule.path ? `${rule.target}/${rule.path}` : `${rule.target}/`;
  return rule.target;
}

// Escape RE2 metacharacters in a literal host/path fragment.
function reEsc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Resolve a rule's scope into a plain-English description and the DNR matcher
// it compiles to: { kind: 'urlFilter' | 'regexFilter', value }. Pure — used by
// the form's live preview and (later) the DNR publisher. See the spec's
// "Matching against tracking data" section for why each shape is what it is.
export function describeRule({ target, path, matchType, pattern, keyword }) {
  if (matchType === 'regex') {
    return { text: t('rules_desc_regex', [pattern]), kind: 'regexFilter', value: pattern };
  }
  if (matchType === 'keyword') {
    return { text: t('rules_desc_keyword', [keyword]), kind: 'regexFilter', value: reEsc(keyword) };
  }
  const host = target || 'google.com';
  if (matchType === 'subdomain') {
    // Subdomains are wanted here — DNR's || domain anchor is naturally inclusive.
    return { text: t('rules_desc_subdomain', [host]), kind: 'urlFilter', value: `||${host}^` };
  }
  if (matchType === 'pathPrefix') {
    const p = (path || '').replace(/^\//, '');
    // Boundary-anchored so /maps doesn't also catch /maps-something.
    return {
      text: t('rules_desc_pathPrefix', [host, p]),
      kind: 'regexFilter', value: `^https?://${reEsc(host)}/${reEsc(p)}(?:[/?]|$)`,
    };
  }
  // host: exact host, excludes subdomains. || is subdomain-inclusive, so this
  // needs an anchored regex; optional www. matches how tracking collapses it.
  return {
    text: t('rules_desc_host', [host]),
    kind: 'regexFilter', value: `^https?://(?:www\\.)?${reEsc(host)}(?:/|$)`,
  };
}

// Does rule `a`'s URL scope cover rule `b`'s (ignoring period/limit)?
//  - subdomain (whole site) covers any rule whose target is the apex or a
//    subdomain of it (host, pathPrefix, or another subdomain).
//  - host covers host/pathPrefix on the same exact host.
//  - pathPrefix covers a pathPrefix whose path sits under its own path.
// Equal scope is covered by all three branches (a == b ⇒ true).
function coversScope(a, b) {
  if (a.source === 'app' || b.source === 'app') return a.source === b.source && a.target === b.target;
  if (a.matchType === 'regex' || b.matchType === 'regex') return false;
  if (a.matchType === 'keyword' || b.matchType === 'keyword') return false;
  if (a.matchType === 'subdomain') {
    return b.target === a.target || b.target.endsWith(`.${a.target}`);
  }
  if (b.target !== a.target) return false;
  if (a.matchType === 'host') return b.matchType === 'host' || b.matchType === 'pathPrefix';
  // a is pathPrefix: only covers a page rule nested under it.
  if (b.matchType !== 'pathPrefix') return false;
  const base = (a.path || '').replace(/^\//, '');
  const sub = (b.path || '').replace(/^\//, '');
  return sub === base || sub.startsWith(`${base}/`);
}

// The first existing rule that makes `candidate` a no-op — same period, scope
// covers it, and the existing limit is no looser than the candidate's, so adding
// it would change nothing. (A *stricter* candidate isn't a no-op: it's allowed
// in, and findRedundantRules then offers to disable the looser existing rule.)
// mode must match too. The form's live preview uses this to refuse a true
// duplicate and link to the rule at fault.
export function findCoveringRule(rules, candidate) {
  const candMs = limitMsOf(candidate);
  return rules.find(r =>
    r.enabled && // a disabled rule blocks nothing, so it can't cover anything
    r.period === candidate.period &&
    r.mode === candidate.mode &&
    coversScope(r, candidate) &&
    limitMsOf(r) <= candMs);
}

function limitMsOf(rule) {
  return rule.limit * (RULE_MULTIPLIERS[rule.limitUnit] ?? 60000);
}

// Periods ordered shortest → longest, for cross-period subsumption.
const PERIOD_RANK = { hour: 0, day: 1, week: 2 };

// Existing enabled rules that `newRule` makes redundant — it would always block
// them first, so they can never trigger. Beyond scope coverage and matching mode
// (active/audio/active+audio measure different usage), the new rule must be at
// least as strict in every window: a smaller-or-equal limit (`Lₙ ≤ Lₒ`) over a
// longer-or-equal period (`Pₙ ≥ Pₒ`). A budget of Lₙ over a long window caps any
// shorter sub-window at Lₙ ≤ Lₒ too, so the old rule never binds. Conservative:
// e.g. 5m/day subsumes 5m/hour, but 10m/day does not (its limit is looser).
export function findRedundantRules(rules, newRule) {
  const newMs = limitMsOf(newRule);
  const newRank = PERIOD_RANK[newRule.period];
  return rules.filter(r =>
    r.enabled &&
    r.id !== newRule.id &&
    r.mode === newRule.mode &&
    coversScope(newRule, r) &&
    newMs <= limitMsOf(r) &&
    newRank >= PERIOD_RANK[r.period]);
}

export async function getRules() {
  const { rules = [] } = await host.prefs.get('rules');
  return rules;
}

export async function addRule({ target, path, pattern, keyword, matchType, limit, limitUnit, period, mode }) {
  const rule = {
    id: crypto.randomUUID(),
    matchType,
    limit,
    limitUnit,
    period,
    enabled: true,
    mode,
  };
  if (matchType === 'regex') {
    rule.pattern = pattern;
  } else if (matchType === 'keyword') {
    rule.keyword = keyword;
  } else {
    rule.target = target;
    if (path) rule.path = path;
  }
  const rules = await getRules();
  await host.prefs.set({ rules: [...rules, rule] });
}

export async function toggleRule(id) {
  const rules = await getRules();
  await host.prefs.set({
    rules: rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r),
  });
}

export async function deleteRule(id) {
  const rules = await getRules();
  await host.prefs.set({ rules: rules.filter(r => r.id !== id) });
}

// Patch an existing rule's editable fields (limit/limitUnit/period). target,
// scope and mode define what the rule is and aren't edited — change those by
// deleting and re-adding.
export async function updateRule(id, fields) {
  const rules = await getRules();
  await host.prefs.set({
    rules: rules.map(r => r.id === id ? { ...r, ...fields } : r),
  });
}

// Disable several rules in one write (used when a newly-added rule makes them
// redundant). Disable rather than delete so the choice is reversible.
export async function disableRules(ids) {
  const set = new Set(ids);
  const rules = await getRules();
  await host.prefs.set({
    rules: rules.map(r => set.has(r.id) ? { ...r, enabled: false } : r),
  });
}

// readonly omits the toggle/delete buttons — used by the popup, which is a
// glanceable list + launcher to the rules page rather than an editor.
export function renderRuleList(listEl, rules, { readonly = false } = {}) {
  listEl.innerHTML = rules.map(rule => {
    const limitMs = rule.limit * (RULE_MULTIPLIERS[rule.limitUnit] ?? 60000);
    const limitStr = limitMs === 0 ? t('rules_limit_never') : t('rules_limit_str', [formatMs(limitMs), t(`period_${rule.period}`)]);
    const toggleHtml = readonly ? '' : `
      <button class="toggle-btn rule-toggle${rule.enabled ? ' on' : ''}" data-id="${rule.id}" aria-label="${t(rule.enabled ? 'rules_disableRule' : 'rules_enableRule')}"></button>`;
    const actions = readonly ? '' : `
      <button class="edit-btn square-btn rule-action-btn" data-id="${rule.id}" aria-label="${t('rules_editRule')}">
        <span class="icon-mask icon-pencil"></span>
      </button>
      <button class="delete-btn square-btn rule-action-btn" data-id="${rule.id}" aria-label="${t('rules_deleteRule')}">
        <span class="icon-mask icon-trash"></span>
      </button>`;
    const faviconHtml = rule.target
      ? `<img class="site-favicon" src="${faviconUrl(rule.target)}" alt="">`
      : '';
    // Tabbing to the row announces the whole rule (site, scope, limit, status) up
    // front — otherwise a screen reader reaches an unlabeled favicon/text run first,
    // and every row's toggle/edit/delete buttons are worded identically with no
    // per-row context of their own.
    const statusStr = t(rule.enabled ? 'rules_statusEnabled' : 'rules_statusDisabled');
    const rowSummary = escapeHtml(`${matchLabel(rule)} — ${t(SCOPE_KEYS[rule.matchType])} · ${limitStr} · ${t(MODE_KEYS[rule.mode])} · ${statusStr}`);
    return `
    <li id="rule-${rule.id}" class="${rule.enabled ? '' : 'disabled'}" tabindex="0" role="group" aria-label="${rowSummary}">
      ${faviconHtml}
      <div class="rule-info">
        <span class="site-label">${matchLabel(rule)}</span>
        <span class="text-meta">${t(SCOPE_KEYS[rule.matchType])} · ${limitStr} · ${t(MODE_KEYS[rule.mode])}</span>
      </div>
      ${toggleHtml}${actions}
    </li>`;
  }).join('');
  listEl.querySelectorAll('.site-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
}

// Compute total spent time for a rule on a given day (active + audio - overlap).
// dayKey should be in YYYY-MM-DD format (as used in sitesByDay/subpagesByDay keys).
export function computeRuleSpent(rule, dayKey, stores) {
  const { sitesByDay = {}, subpagesByDay = {} } = stores;

  const siteBucket = sitesByDay[dayKey];
  const subpageBucket = subpagesByDay[dayKey];

  function sumCell(cell) {
    const active = cell?.activeMs ?? 0;
    const audio = cell?.audioMs ?? 0;
    const overlap = cell?.overlapMs ?? 0;
    return active + audio - overlap;
  }

  if (rule.matchType === 'regex') {
    try {
      const re = new RegExp(rule.pattern);
      let total = 0;
      for (const [siteId, paths] of Object.entries(subpageBucket ?? {})) {
        for (const [p, cell] of Object.entries(paths)) {
          if (re.test(`https://${siteId}${p}`)) total += sumCell(cell);
        }
      }
      return total;
    } catch { return 0; }
  }

  if (rule.matchType === 'keyword') {
    let total = 0;
    for (const [siteId, paths] of Object.entries(subpageBucket ?? {})) {
      for (const [p, cell] of Object.entries(paths)) {
        if (`https://${siteId}${p}`.includes(rule.keyword)) total += sumCell(cell);
      }
    }
    return total;
  }

  if (rule.matchType === 'pathPrefix') {
    const paths = subpageBucket?.[rule.target];
    if (!paths) return 0;
    const base = '/' + (rule.path ?? '').replace(/^\//, '');
    let activeMs = 0;
    for (const [p, cell] of Object.entries(paths)) {
      const under = p === base || (p.startsWith(base) && (p[base.length] === '/' || p[base.length] === '?'));
      if (!under) continue;
      activeMs += sumCell(cell);
    }
    return activeMs;
  }

  if (rule.matchType === 'subdomain') {
    let activeMs = 0;
    for (const [siteId, cell] of Object.entries(siteBucket ?? {})) {
      if (siteId === rule.target || siteId.endsWith(`.${rule.target}`)) {
        activeMs += sumCell(cell);
      }
    }
    return activeMs;
  }

  // host
  const cell = siteBucket?.[rule.target];
  return sumCell(cell);
}

// Get visit count for a rule on a given day.
export function computeRuleVisits(rule, dayKey, stores) {
  const { sitesByDay = {}, subpagesByDay = {} } = stores;

  const siteBucket = sitesByDay[dayKey];
  const subpageBucket = subpagesByDay[dayKey];

  if (rule.matchType === 'regex') {
    try {
      const re = new RegExp(rule.pattern);
      let visits = 0;
      for (const [siteId, paths] of Object.entries(subpageBucket ?? {})) {
        for (const [p, cell] of Object.entries(paths)) {
          if (re.test(`https://${siteId}${p}`)) visits += cell.visits ?? 0;
        }
      }
      return visits;
    } catch { return 0; }
  }

  if (rule.matchType === 'keyword') {
    let visits = 0;
    for (const [siteId, paths] of Object.entries(subpageBucket ?? {})) {
      for (const [p, cell] of Object.entries(paths)) {
        if (`https://${siteId}${p}`.includes(rule.keyword)) visits += cell.visits ?? 0;
      }
    }
    return visits;
  }

  if (rule.matchType === 'pathPrefix') {
    const paths = subpageBucket?.[rule.target];
    if (!paths) return 0;
    const base = '/' + (rule.path ?? '').replace(/^\//, '');
    let visits = 0;
    for (const [p, cell] of Object.entries(paths)) {
      const under = p === base || (p.startsWith(base) && (p[base.length] === '/' || p[base.length] === '?'));
      if (!under) continue;
      visits += cell.visits ?? 0;
    }
    return visits;
  }

  if (rule.matchType === 'subdomain') {
    let visits = 0;
    for (const [siteId, cell] of Object.entries(siteBucket ?? {})) {
      if (siteId === rule.target || siteId.endsWith(`.${rule.target}`)) {
        visits += cell.visits ?? 0;
      }
    }
    return visits;
  }

  // host
  const cell = siteBucket?.[rule.target];
  return cell?.visits ?? 0;
}
