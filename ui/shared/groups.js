import { host } from './host.js';
import { PREF_RESOURCE_GROUPS, PREF_GROUP_SYNC_STATE } from './prefKeys.js';
import { t } from './i18n.js';
import { coreCall } from './core.js';

export const DEFAULT_GROUP_ID = 'default';
export const groupLabel = (group) => group.name || t('groups_default');
export const resourceKey = (resource) => `${resource.source ?? 'web'}\n${resource.target}`;

export function groupsFromPrefs(saved = []) {
  return [{ id: DEFAULT_GROUP_ID, name: '', members: saved.find(g => g.id === DEFAULT_GROUP_ID)?.members ?? [] }, ...saved.filter(g => g.id !== DEFAULT_GROUP_ID)];
}

export async function getGroups() {
  return (await groupState()).groups;
}

export async function groupState() {
  let state = await coreCall('groups.get');
  if (state.initialized) return state;
  const { [PREF_RESOURCE_GROUPS]: saved = [] } = await host.prefs.get(PREF_RESOURCE_GROUPS);
  state = await coreCall('groups.edit', { before: [], groups: groupsFromPrefs(saved), initialize: true });
  return state;
}

export function groupFor(resource, groups) {
  const key = resourceKey(resource);
  return groups.slice(1).find(g => g.members.some(m => resourceKey(m) === key)) ?? groups[0];
}

export function groupForId(target, groups) {
  return groups.slice(1).find(g => g.members.some(m => m.target === target)) ?? groups[0];
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// RE2 has no lookahead. A trie accepts every domain except the finite list of assigned domains.
function otherDomains(domains) {
  const root = { children: new Map(), end: false };
  for (const domain of domains) {
    let node = root;
    for (const char of domain) {
      if (!node.children.has(char)) node.children.set(char, { children: new Map(), end: false });
      node = node.children.get(char);
    }
    node.end = true;
  }
  const pattern = (node) => {
    const chars = [...node.children.keys()].join('').replace(/[\\\]^-]/g, '\\$&');
    const choices = [`[^/${chars}][^/]*`];
    for (const [char, child] of node.children) choices.push(escapeRegex(char) + pattern(child));
    if (!node.end) choices.push('');
    return `(?:${choices.join('|')})`;
  };
  return pattern(root);
}

export function compileGroupRule(rule, groups) {
  const logical = rule.groupTargets ?? rule.matchers ?? [rule];
  if (!logical.some(m => m.matchType === 'group')) return rule;
  const groupTargets = logical.map(({ matchType, source, target, label, path, pattern, keyword }) => {
    const m = Object.fromEntries(Object.entries({ matchType, source, target, label, path, pattern, keyword }).filter(([, value]) => value !== undefined));
    const group = groups.find(g => g.id === m.target);
    return m.matchType === 'group' && group ? { ...m, label: groupLabel(group) } : m;
  });
  const matchers = groupTargets.flatMap(m => {
    if (m.matchType !== 'group') return [m];
    const group = groups.find(g => g.id === m.target);
    if (group?.id !== DEFAULT_GROUP_ID) {
      return group?.members.length ? group.members.map(resource => ({
        source: resource.source ?? 'web', matchType: (resource.source ?? 'web') === 'web' ? 'host' : 'exact',
        target: resource.target, label: resource.label,
      })) : [{ source: 'web', matchType: 'regex', pattern: '^$' }];
    }
    return ['web', 'app', 'desktop'].map(source => {
      const members = groups.slice(1).flatMap(g => g.members).filter(r => (r.source ?? 'web') === source).map(r => r.target);
      const matcher = { source, matchType: 'regex', pattern: `^https?://${otherDomains(members)}(?:/|$)` };
      if (source === 'web') matcher.excludedDomains = members;
      return matcher;
    });
  });
  const { source: _source, target: _target, matchType: _type, label: _label, ...rest } = rule;
  const enabled = rule.enabled && groupTargets.some(m => m.matchType !== 'group' || groups.some(g => g.id === m.target));
  return { ...rest, enabled, groupTargets, matchers };
}

export async function publishGroups(state = null) {
  state ??= await groupState();
  const groups = state.groups;
  const items = {
    [PREF_GROUP_SYNC_STATE]: { aliases: state.aliases, duplicates: state.duplicates },
    [PREF_RESOURCE_GROUPS]: [...groups.slice(1), ...groups.slice(0, 1).filter(g => g.members.length)],
  };
  const old = await host.prefs.get([...Object.keys(items), 'rules']);
  if (Object.entries(items).every(([key, value]) => JSON.stringify(value) === JSON.stringify(old[key]))) return state;
  const rules = old.rules ?? [];
  const updated = rules.map(rule => {
    const logical = rule.groupTargets ?? rule.matchers ?? [rule];
    if (!logical.some(m => m.matchType === 'group')) return rule;
    const groupTargets = logical.map(m => state.aliases[m.target] && m.matchType === 'group' ? { ...m, target: state.aliases[m.target] } : m);
    return compileGroupRule({ ...rule, groupTargets }, groups);
  });
  items.rules = updated;
  const changed = Object.fromEntries(Object.entries(items).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(old[key])));
  if (Object.keys(changed).length) await host.prefs.set(changed);
  return state;
}

export async function saveGroups(groups, before = null) {
  before ??= (await groupState()).groups;
  const state = await coreCall('groups.edit', { before, groups });
  return publishGroups(state);
}

export async function mergeGroups(from, into, separate = false) {
  return publishGroups(await coreCall('groups.merge', { from, into, separate }));
}
