// Group UI, core matching, verdicts and dashboard navigation through the capture backend.
import { capture } from './backends/extension.mjs';
import config from './capture.config.mjs';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const cfg = { ...config, profileDir: `reeflect-groups-smoke-${process.pid}` };
const opts = { width: 960, height: 760, console: true };
let checks = 0;
let stage = 0;
async function run(view, body, extra = {}) {
  const result = await capture({ ...cfg, ...extra }, { ...opts, view, eval: `(async () => {
    const checks = [];
    const check = (label, ok) => { if (!ok) throw new Error(label); checks.push(label); };
    const wait = async fn => { const end = Date.now() + 8000; while (!await fn()) { if (Date.now() > end) throw new Error('wait timed out'); await new Promise(r => setTimeout(r, 30)); } };
    ${body}
    return checks;
  })()` });
  for (const label of result.evalResult) { console.log(`ok  ${label}`); checks++; }
  const errors = result.consoleLines?.filter(l => l.startsWith('[pageerror]')) ?? [];
  if (errors.length) throw new Error(errors.join('\n'));
  mkdirSync('shots', { recursive: true });
  writeFileSync(`shots/groups-smoke-${++stage}-${view}.png`, Buffer.from(result.imageBase64, 'base64'));
}

try {
await run('groups', String.raw`
  const { host } = await import('../../shared/host.js');
  const { coreCall, timeJson } = await import('../../shared/core.js');
  const { compileGroupRule, saveGroups } = await import('../../shared/groups.js');
  check('Default exists without saved groups', document.querySelector('#group-name').value === 'Default');
  check('Default cannot be deleted', document.querySelector('#delete-btn').style.display === 'none');
  document.querySelector('#new-name').value = 'Social';
  document.querySelector('#create-form').requestSubmit();
  await wait(() => document.querySelector('#group-name').value === 'Social');
  document.querySelector('#website-input').value = 'example.com';
  document.querySelector('#website-form').requestSubmit();
  await wait(async () => (await host.prefs.get('resourceGroups')).resourceGroups[0].members.length === 1);
  check('website joins Social', document.querySelector('#member-list input').checked);
  const groups = (await host.prefs.get('resourceGroups')).resourceGroups;
  groups[0].id = 'SOCIAL';
  groups[0].members.push({ source: 'app', target: 'com.test.app', label: 'Test app' }, { source: 'desktop', target: 'test.exe', label: 'Test desktop' });
  const all = [{id:'default',name:'',members:[]}, ...groups];
  await saveGroups(all);
  const base = { id:'social-rule', enabled:true, limit:25, limitUnit:'minutes', period:'day', mode:'active' };
  const social = compileGroupRule({ ...base, matchType:'group', source:'group', target:groups[0].id, label:'Social' }, all);
  const fallback = compileGroupRule({ ...base, id:'default-rule', limit:10, matchType:'group', source:'group', target:'default', label:'Default' }, all);
  const matches = async (rule, source, domain) => (await Promise.all(rule.matchers.map(m => coreCall('matchesRule', {matcher:m,source,domain,path:'/'})))).some(Boolean);
  for (const [source, domain, assigned] of [['web','example.com',true],['web','other.com',false],['web','example.com.evil',false],['web','exampleXcom',false],['app','com.test.app',true],['desktop','test.exe',true],['app','example.com',false]]) {
    check(source + ':' + domain + ' belongs to exactly one group', await matches(social,source,domain) === assigned && await matches(fallback,source,domain) !== assigned);
  }
  const now = Date.now();
  const start = now - 60*60000;
  const rows = [
    {domain:'example.com',source:'web',path:'/',kind:'active',from:start,to:start+20*60000},
    {domain:'com.test.app',source:'app',path:'',kind:'active',from:start+20*60000,to:start+30*60000},
    {domain:'other.com',source:'web',path:'/',kind:'active',from:start+30*60000,to:start+45*60000},
  ];
  const time = JSON.parse(await timeJson(start, now));
  const verdict = await coreCall('computeOverage', {rules:[social,fallback],rows,windowStartMs:start,time});
  check('Social combines web and app usage: five minutes over', verdict.overage['social-rule']?.overBy === 5*60000);
  check('Default excludes Social usage: five minutes over', verdict.overage['default-rule']?.overBy === 5*60000);
  await host.prefs.set({ rules: [social,fallback] });
  const { computeOverage, publishOverage } = await import('../../background/enforcement.js');
  const published = await computeOverage([social,fallback], rows, start, now);
  await publishOverage(published.overage);
  const redirects = await chrome.declarativeNetRequest.getDynamicRules();
  check('both group verdicts publish browser redirects', redirects.filter(r => r.action.type === 'redirect').length === 2);
  check('Default excludes assigned websites with exact allowances', redirects.some(r => r.action.type === 'allow' && r.priority === 2 && new RegExp(r.condition.regexFilter).test('https://example.com/')));
  await publishOverage(published.overage);
  const repeated = await chrome.declarativeNetRequest.getDynamicRules();
  check('repeated publication keeps the same rule IDs', redirects.map(r=>r.id).join() === repeated.map(r=>r.id).join());
  check('Default redirects preserve the original URL', redirects.some(r => r.action.redirect?.regexSubstitution?.endsWith('#\\0')));
  check('other group limits override Default allowances', redirects.some(r => r.action.type === 'redirect' && r.priority === 3));
  const { blockedOriginalUrl } = await import('../../shared/rules.js');
  const originalUrl = 'https://other.com/path?a=1&b=2';
  const fallbackRedirect = redirects.find(r => r.priority === 1).action.redirect.regexSubstitution;
  check('Default URL round-trip keeps path and query', blockedOriginalUrl(fallbackRedirect.replace('\\0', originalUrl)) === originalUrl);
  const blocked = await chrome.tabs.create({ active: false, url: chrome.runtime.getURL('src/pages/blocked/blocked.html') + '?rule=default-rule&url=' + encodeURIComponent('https://example.com/') });
  await wait(async () => (await chrome.tabs.get(blocked.id)).url?.includes('blocked.html'));
  await publishOverage(new Map([['default-rule', published.overage.get('default-rule')]]));
  await wait(async () => { const tab = await chrome.tabs.get(blocked.id); return (tab.pendingUrl ?? tab.url)?.startsWith('https://example.com/'); });
  check('assigned sites restore their original navigation while Default stays over limit', true);
  await chrome.tabs.remove(blocked.id);
  const { syncStorage } = await import('../../data/syncStorage.js');
  await syncStorage.upsertMirror(JSON.stringify(rows.map((row, i) => ({ origin: { deviceId: 'groups-fixture', localId: i + 1 }, row: { v: 1, ...row }, keyEpoch: 0 }))));
  await host.prefs.set({ _syncAppLabels: { 'com.test.app': 'Test app', 'test.exe': 'Test desktop' } });
  const { buildBackupPayload } = await import('../../data/exportPayload.js');
  const backup = await buildBackupPayload();
  check('backups include group membership', backup.prefs.resourceGroups[0].members.length === 3);
  const { parseBackupImport, applyBackupImport } = await import('../../data/importBuckets.js');
  await host.prefs.remove('resourceGroups');
  await host.prefs.set({rules: []});
  await applyBackupImport(parseBackupImport(backup), { overwritePrefs: true });
  check('backup restore keeps group identity and membership', (await host.prefs.get('resourceGroups')).resourceGroups[0].id === 'SOCIAL');
  check('backup restore keeps both group rules', (await host.prefs.get('rules')).rules.length === 2);
`);

await run('rules', String.raw`
  document.querySelector('#add-card-toggle').click();
  document.querySelector('#targets-edit').click();
  const names = [...document.querySelectorAll('#picker-list .pick-name')].map(el => el.textContent.split(' (')[0]);
  check('picker shows group members in parentheses', document.querySelector('#picker-list').textContent.includes('Social ('));
  check('groups precede apps and websites in the target picker', names[0] === 'Default' && names[1] === 'Social');
  check('group rules show group names', document.querySelector('#rules-list').textContent.includes('Social') && !document.querySelector('#rules-list').textContent.includes('https?'));
  const { host } = await import('../../shared/host.js');
  host.permissions.request = async () => true;
  for (const name of ['Default', 'Social']) {
    [...document.querySelectorAll('#picker-list label')].find(label => label.querySelector('.pick-name')?.textContent.split(' (')[0] === name).querySelector('input').click();
  }
  document.querySelector('#rule-name').value = 'Grouped test';
  document.querySelector('#save-btn').click();
  await wait(async () => (await host.prefs.get('rules')).rules.some(r => r.name === 'Grouped test'));
  const added = (await host.prefs.get('rules')).rules.find(r => r.name === 'Grouped test');
  check('rule form saves both group targets', added.groupTargets.length === 2 && added.matchers.length === 6);
  await wait(() => document.querySelector('#rule-' + added.id + ' .edit-btn'));
  document.querySelector('#rule-' + added.id + ' .edit-btn').click();
  await wait(() => document.querySelector('.edit-limit'));
  const editLimit = document.querySelector('.edit-limit');
  editLimit.value = '23';
  const { saveGroups, getGroups } = await import('../../shared/groups.js');
  const refreshedGroups = await getGroups();
  refreshedGroups[1].name = 'Social refreshed';
  await saveGroups(refreshedGroups);
  await new Promise(r => setTimeout(r, 200));
  check('group refresh keeps the focused rule editor and its unsaved limit', editLimit.isConnected && document.activeElement === editLimit && editLimit.value === '23');
  document.querySelector('.save-edit-btn').click();
  await wait(async () => (await host.prefs.get('rules')).rules.find(r => r.id === added.id)?.limit === 23);
  await wait(() => !document.querySelector('.edit-limit'));
  check('rule edit saves after a group refresh', document.querySelector('#rule-' + added.id).textContent.includes('Social refreshed'));
  refreshedGroups[1].name = 'Social';
  await saveGroups(refreshedGroups);
  const { deleteRule } = await import('../../shared/rules.js');
  await deleteRule(added.id);

`);

await run('dashboard', String.raw`
  document.querySelector('#merge-groups-toggle').click();
  const rows = [...document.querySelectorAll('#dashboard-body tr')];
  check('dashboard merges activity into two groups', rows.length === 2);
  check('dashboard group links open the group activity view', rows.every(row => row.dataset.href.includes('site.html?group=')));
  check('name and subdomain merge do not override groups', rows.some(row => row.textContent.includes('Social')) && rows.some(row => row.textContent.includes('Default')));
`);

await run('site', String.raw`
  check('group activity uses the group name', document.querySelector('#site-label').textContent === 'Social');
  check('group activity offers group management', document.querySelector('#manage-group-link').href.includes('groups.html?id='));
`, { views: { ...cfg.views, site: { page: 'src/pages/site/site.html?group=SOCIAL' } } });

await run('groups', String.raw`
  const {host} = await import('../../shared/host.js');
  document.querySelector('[data-group="SOCIAL"]').click();
  document.querySelector('#group-name').value = 'Video';
  document.querySelector('#rename-form').requestSubmit();
  await wait(async () => (await host.prefs.get('resourceGroups')).resourceGroups[0].name === 'Video');
  check('group rule follows the new name', (await host.prefs.get('rules')).rules[0].groupTargets[0].label === 'Video');
  check('group name changes', document.querySelector('.group-list .active').textContent === 'Video');
  const checkbox = [...document.querySelectorAll('#member-list input')].find(input => input.closest('li').textContent.includes('example.com'));
  checkbox.click();
  await wait(async () => !(await host.prefs.get('resourceGroups')).resourceGroups[0].members.some(m=>m.target==='example.com'));
  check('cleared website returns to Default', checkbox.closest('li').textContent.includes('Default') || document.querySelector('#member-list').textContent.includes('Default'));
  document.querySelector('#delete-btn').click();
  await wait(async () => (await host.prefs.get('resourceGroups')).resourceGroups.every(g => g.id === 'default'));
  check('deleted group keeps unseen members in Default', document.querySelector('#member-list').textContent.includes('test.exe'));
  check('delete keeps Default', document.querySelector('#group-name').value === 'Default');
  const {rules} = await host.prefs.get('rules');
  const {coreCall} = await import('../../shared/core.js');
  const matches = async rule => (await Promise.all(rule.matchers.map(m=>coreCall('matchesRule',{matcher:m,source:'app',domain:'com.test.app',path:''})))).some(Boolean);
  check('deleted group matches nothing', !await matches(rules[0]));
  check('a rule with no remaining target is disabled', rules[0].enabled === false);
  check('deleted group members return to Default rules', await matches(rules[1]));
`);

await run('dashboard', String.raw`
  const toggle = document.querySelector('#merge-groups-toggle');
  if (!toggle.checked) toggle.click();
  const rows = [...document.querySelectorAll('#dashboard-body tr')];
  check('Default remains visible as the only group', rows.length === 1 && rows[0].textContent.includes('Default'));
`);
await run('groups', String.raw`
  const { getGroups, saveGroups } = await import('../../shared/groups.js');
  await saveGroups([...(await getGroups()), {id:'duplicate-a',name:'Synced group',members:[]}, {id:'duplicate-b',name:'Synced group',members:[]}]);
  await wait(() => document.querySelector('#group-duplicates').style.display !== 'none');
  check('duplicate group names show a merge question', document.querySelector('#group-duplicates').textContent.includes('Merge groups'));
  check('duplicate question fits the desktop width', document.documentElement.scrollWidth <= innerWidth);
`);
opts.width = 390;
await run('groups', String.raw`
  check('duplicate question fits the phone width', document.documentElement.scrollWidth <= innerWidth);
  check('phone offers both merge choices', document.querySelectorAll('#group-duplicates button').length === 2);
`);
await run('groups', String.raw`
  document.querySelectorAll('#group-duplicates button')[1].click();
  await wait(() => document.querySelector('#group-duplicates').style.display === 'none');
  check('Keep separate preserves both named groups', document.querySelectorAll('#group-list button').length === 3);
`);
await run('groups', String.raw`
  check('Keep separate survives a page reload', document.querySelector('#group-duplicates').style.display === 'none' && document.querySelectorAll('#group-list button').length === 3);
`);
await run('groups', String.raw`
  const { getGroups, saveGroups, compileGroupRule } = await import('../../shared/groups.js');
  const { buildBackupPayload } = await import('../../data/exportPayload.js');
  const { parseBackupImport, applyBackupImport } = await import('../../data/importBuckets.js');
  const { host } = await import('../../shared/host.js');
  const groups = await getGroups();
  const oldId = groups[1].id;
  groups[1].members.push({ source:'web', target:'restore.example' });
  await saveGroups(groups);
  const rule = compileGroupRule({ id:'backup-group-rule', enabled:true, source:'group', matchType:'group', target:oldId, limit:1, limitUnit:'hours', period:'day', mode:'active' }, groups);
  await host.prefs.set({ rules: [rule] });
  const backup = await buildBackupPayload();
  await saveGroups(groups.filter(g => g.id !== oldId));
  await host.prefs.set({ rules: [] });
  await applyBackupImport(parseBackupImport(backup), { overwritePrefs: true });
  const restored = await getGroups();
  check('a backup restores a deleted group with a new identity', restored.length === groups.length && !restored.some(g => g.id === oldId));
  check('a backup keeps the restored group name', restored.filter(g => g.name === 'Synced group').length === 2);
  const restoredGroup = restored.find(g => g.members.some(m => m.target === 'restore.example'));
  check('a backup restores membership after deletion', restoredGroup?.id !== oldId && restoredGroup?.id !== 'default');
  const restoredRule = (await host.prefs.get('rules')).rules[0];
  check('a restored rule follows the new group identity', restoredRule.enabled && restoredRule.groupTargets[0].target === restoredGroup.id && restoredRule.matchers[0].target === 'restore.example');
  const prefs = await host.prefs.get('resourceGroups');
  check('restored group identities reach preferences', prefs.resourceGroups.every(g => restored.some(r => r.id === g.id)));
`);
console.log(`${checks} group checks passed; screenshots in shots/groups-smoke-*.png`);
} finally {
  const profile = path.resolve(os.tmpdir(), cfg.profileDir);
  if (path.dirname(profile) !== path.resolve(os.tmpdir())) throw new Error('profile must stay inside the temporary directory');
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
