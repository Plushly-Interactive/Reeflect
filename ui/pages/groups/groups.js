import { groupState, saveGroups, mergeGroups, groupFor, groupLabel, resourceKey, DEFAULT_GROUP_ID } from '../../shared/groups.js';
import { host } from '../../shared/host.js';
import { PREF_RESOURCE_GROUPS, PREF_GROUP_SYNC_STATE } from '../../shared/prefKeys.js';
import { loadKnownResources } from '../../shared/resourceCandidates.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { escapeHtml, attachInputClear } from '../../shared/utils.js';
import { BRAND_NAME } from '../../shared/brand.js';

await initI18n();
applyI18n();
document.title = `${t('groups_title')} - ${BRAND_NAME}`;
let state;
let groups = [];
let before = [];
let candidates = [];
let resourcesLoading = true;
let resourcesFailed = false;
let selectedId = new URLSearchParams(location.search).get('id') ?? DEFAULT_GROUP_ID;
const groupList = document.querySelector('#group-list');
const nameInput = document.querySelector('#group-name');
const search = document.querySelector('#member-search');
const memberList = document.querySelector('#member-list');
const status = document.querySelector('#group-status');
const newName = document.querySelector('#new-name');
const websiteInput = document.querySelector('#website-input');
const selectedGroup = () => groups.find(g => g.id === selectedId) ?? groups[0];

function allResources() {
  const ms = new Map(candidates.map(c => [resourceKey(c), c.ms]));
  return [...new Map([...candidates, ...groups.flatMap(g => g.members).map(m => ({ ...m, ms: ms.get(resourceKey(m)) ?? 0 }))].map(c => [resourceKey(c), c])).values()];
}

function renderMembers() {
  const group = selectedGroup();
  const q = search.value.trim().toLowerCase();
  const resources = allResources().filter(c => !q || `${c.label ?? ''} ${c.target}`.toLowerCase().includes(q));
  resources.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || (a.label ?? a.target).localeCompare(b.label ?? b.target));
  memberList.innerHTML = resources.map((c, index) => {
    const owner = groupFor(c, groups);
    return `<li><label><input type="checkbox" data-index="${index}"${owner.id === group.id ? ' checked' : ''}${group.id === DEFAULT_GROUP_ID ? ' disabled' : ''}>
      <span class="member-name"><span>${escapeHtml(c.label ?? c.target)}</span><span class="text-meta">${escapeHtml(c.target)}</span></span>
      <span class="text-meta">${escapeHtml(groupLabel(owner))}</span></label></li>`;
  }).join('');
  memberList._resources = resources;
  document.querySelector('#members-empty').style.display = resources.length || resourcesLoading || resourcesFailed ? 'none' : '';
  const loading = document.querySelector('#members-loading');
  loading.style.display = resourcesLoading || resourcesFailed ? '' : 'none';
  loading.textContent = t(resourcesFailed ? 'groups_resourcesError' : 'groups_loadingResources');
  loading.setAttribute('aria-busy', String(resourcesLoading));
  document.querySelector('#members-retry-btn').style.display = resourcesFailed ? '' : 'none';
}

function render() {
  const group = selectedGroup();
  selectedId = group.id;
  groupList.innerHTML = groups.map(g => `<button type="button" class="link-btn${g.id === group.id ? ' active' : ''}" data-group="${g.id}" aria-pressed="${g.id === group.id}">${escapeHtml(groupLabel(g))}</button>`).join('');
  nameInput.value = groupLabel(group);
  const isDefault = group.id === DEFAULT_GROUP_ID;
  nameInput.disabled = isDefault;
  document.querySelector('#rename-btn').disabled = isDefault;
  document.querySelector('#delete-btn').style.display = isDefault ? 'none' : '';
  document.querySelector('#default-hint').style.display = isDefault ? '' : 'none';
  document.querySelector('#members-hint').style.display = isDefault ? 'none' : '';
  document.querySelector('#website-form').style.display = isDefault ? 'none' : '';
  document.querySelector('#activity-btn').href = `../site/site.html?group=${encodeURIComponent(group.id)}`;
  document.querySelector('#group-rule-btn').href = `../rules/rules.html?group=${encodeURIComponent(group.id)}`;
  history.replaceState(null, '', `?id=${encodeURIComponent(group.id)}`);
  renderMembers();
  renderDuplicates();
}

function renderDuplicates() {
  const section = document.querySelector('#group-duplicates');
  section.replaceChildren();
  section.style.display = state.duplicates.length ? '' : 'none';
  for (const [into, from] of state.duplicates) {
    const group = groups.find(g => g.id === into);
    const row = document.createElement('div');
    row.className = 'group-actions';
    const message = document.createElement('p');
    message.textContent = t('groups_mergeQuestion', [group.name]);
    row.append(message);
    for (const separate of [false, true]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = t(separate ? 'groups_keepSeparate' : 'groups_mergeConfirm');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          state = await mergeGroups(from, into, separate);
          groups = state.groups;
          before = structuredClone(groups);
          if (selectedId === from && !separate) selectedId = into;
          render();
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      row.append(button);
    }
    section.append(row);
  }
}

async function persist() {
  state = await saveGroups(groups, before);
  groups = state.groups;
  before = structuredClone(groups);
  status.textContent = t('groups_saved');
  render();
}

function checkName(input, ignoreId) {
  input.setCustomValidity(groups.some(g => g.id !== ignoreId && groupLabel(g).toLowerCase() === input.value.trim().toLowerCase())
    ? t('groups_duplicate') : input.value.trim() ? '' : t('groups_name'));
  return input.reportValidity();
}
for (const input of [newName, nameInput, websiteInput]) input.addEventListener('input', () => input.setCustomValidity(''));
document.querySelector('#create-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!checkName(newName)) return;
  const group = { id: crypto.randomUUID(), name: newName.value.trim(), members: [] };
  groups.push(group);
  selectedId = group.id;
  newName.value = '';
  await persist();
});
document.querySelector('#rename-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (selectedId === DEFAULT_GROUP_ID || !checkName(nameInput, selectedId)) return;
  selectedGroup().name = nameInput.value.trim();
  await persist();
});
document.querySelector('#delete-btn').addEventListener('click', async () => {
  if (selectedId === DEFAULT_GROUP_ID) return;
  groups[0].members.push(...selectedGroup().members);
  groups = groups.filter(g => g.id !== selectedId);
  selectedId = DEFAULT_GROUP_ID;
  await persist();
});
groupList.addEventListener('click', e => {
  const button = e.target.closest('button[data-group]');
  if (!button) return;
  selectedId = button.dataset.group;
  status.textContent = '';
  render();
});
attachInputClear(search, document.querySelector('#member-search-clear'), renderMembers)();
memberList.addEventListener('change', async e => {
  const c = memberList._resources[Number(e.target.dataset.index)];
  if (!c || selectedId === DEFAULT_GROUP_ID) return;
  for (const group of groups) group.members = group.members.filter(m => resourceKey(m) !== resourceKey(c));
  const destination = e.target.checked ? selectedGroup() : groups[0];
  destination.members.push({ source: c.source, target: c.target, label: c.label });
  await persist();
});
document.querySelector('#website-form').addEventListener('submit', async e => {
  e.preventDefault();
  let url;
  try { url = new URL(websiteInput.value.includes('://') ? websiteInput.value : `https://${websiteInput.value}`); } catch { /* Show the same field error below. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    websiteInput.setCustomValidity(t('groups_invalidWebsite'));
    websiteInput.reportValidity();
    return;
  }
  const c = { source: 'web', target: url.hostname.replace(/^www\./, ''), label: url.hostname.replace(/^www\./, '') };
  for (const group of groups) group.members = group.members.filter(m => resourceKey(m) !== resourceKey(c));
  selectedGroup().members.push(c);
  websiteInput.value = '';
  await persist();
});
async function loadCandidates() {
  resourcesLoading = true;
  resourcesFailed = false;
  renderMembers();
  try { candidates = await loadKnownResources(); }
  catch { resourcesFailed = true; }
  finally {
    resourcesLoading = false;
    renderMembers();
  }
}

async function loadGroups() {
  const main = document.querySelector('#groups-main');
  const retry = document.querySelector('#groups-retry-btn');
  document.querySelector('#groups-load-error').style.display = 'none';
  document.body.classList.add('is-loading');
  main.setAttribute('aria-busy', 'true');
  retry.disabled = true;
  try {
    state = await groupState();
    groups = state.groups;
    before = structuredClone(groups);
    render();
    main.removeAttribute('inert');
    loadCandidates();
  } catch {
    document.querySelector('#groups-load-error').style.display = '';
  } finally {
    document.body.classList.remove('is-loading');
    main.setAttribute('aria-busy', 'false');
    retry.disabled = false;
  }
}

document.querySelector('#groups-retry-btn').addEventListener('click', loadGroups);
document.querySelector('#members-retry-btn').addEventListener('click', loadCandidates);
loadGroups();
host.prefs.onChanged(async changes => {
  if (!changes[PREF_RESOURCE_GROUPS] && !changes[PREF_GROUP_SYNC_STATE]) return;
  state = await groupState();
  groups = state.groups;
  before = structuredClone(groups);
  render();
});
