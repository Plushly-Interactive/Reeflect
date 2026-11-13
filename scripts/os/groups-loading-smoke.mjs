import { chromium } from 'playwright';
import config from './capture.config.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.resolve(os.tmpdir(), `reeflect-groups-loading-${process.pid}`);
const extension = path.resolve(config.extensionPath);
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run',
    `--window-position=${config.windowPosition.x},${config.windowPosition.y}`],
});
let releaseScript;
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ resourceGroups: [{ id: 'saved-group', name: 'Saved group', members: [{ source: 'web', target: 'saved.example' }] }] }));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const scriptGate = new Promise(resolve => { releaseScript = resolve; });
  let scriptRequested;
  const requested = new Promise(resolve => { scriptRequested = resolve; });
  await page.route('**/src/pages/groups/groups.js', async route => {
    scriptRequested();
    await scriptGate;
    await route.continue();
  });
  await page.goto(`${origin}/src/pages/groups/groups.html?id=saved-group`, { waitUntil: 'commit' });
  await requested;
  await page.evaluate(async ({ failGroups, failResources }) => {
    const { Engine } = await import('../../vendor/reeflect-core/reeflect_core_wasm.js');
    const call = Engine.prototype.call;
    window.groupsProbe = { calls: [], pending: false, failGroups, failResources };
    Engine.prototype.call = async function (command, args) {
      const start = performance.now();
      try {
        if (command === 'groups.get' && !window.groupsProbe.metadataGated) {
          window.groupsProbe.metadataGated = true;
          window.groupsProbe.metadataPending = true;
          await new Promise(resolve => { window.groupsProbe.releaseMetadata = resolve; });
          if (window.groupsProbe.failGroups) throw new Error('Simulated group read failure');
        }
        if (command === 'rows.changes' && !window.groupsProbe.historyGated) {
          window.groupsProbe.historyGated = true;
          window.groupsProbe.pending = true;
          await new Promise(resolve => { window.groupsProbe.release = resolve; });
          if (window.groupsProbe.failResources) throw new Error('Simulated resource read failure');
        }
        return await call.call(this, command, args);
      }
      finally { window.groupsProbe.calls.push({ command, ms: Math.round(performance.now() - start) }); }
    };
  }, { failGroups: process.argv.includes('--fail-groups'), failResources: process.argv.includes('--fail-resources') });
  releaseScript();
  await page.waitForFunction(() => window.groupsProbe.metadataPending);
  await page.waitForFunction(() => [...document.querySelectorAll('.loading-bars')].some(e => e.getBoundingClientRect().width > 0));
  mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/groups-loading-initial.png' });
  console.log('ok  Shared loading indicator appears while group metadata waits');
  await page.evaluate(() => window.groupsProbe.releaseMetadata());
  if (process.argv.includes('--fail-groups')) {
    await page.waitForFunction(() => document.querySelector('#groups-load-error').style.display !== 'none');
    await page.click('#groups-retry-btn');
    console.log('ok  Group read failure offers Retry');
  }
  await page.waitForFunction(() => window.groupsProbe.pending);
  const initial = await page.evaluate(() => ({
    editor: document.querySelector('#group-list').children.length > 0,
    loading: document.querySelector('#members-loading')?.getAttribute('aria-busy') === 'true',
    savedMembers: document.querySelector('#member-list').textContent.includes('saved.example'),
    interactive: !document.querySelector('#groups-main').hasAttribute('inert'),
  }));
  await page.screenshot({ path: 'shots/groups-loading-pending.png' });
  console.log('While history waits:', initial);
  console.log('Calls before history returns:', await page.evaluate(() => window.groupsProbe.calls));
  await page.evaluate(() => window.groupsProbe.release());
  await page.waitForFunction(() => window.groupsProbe.calls.some(c => c.command === 'rows.changes'));
  if (!initial.editor || !initial.loading || !initial.savedMembers || !initial.interactive) throw new Error('Groups must show the editor and loading indicator before history finishes');
  if (process.argv.includes('--fail-resources')) {
    await page.waitForFunction(() => document.querySelector('#members-retry-btn').style.display !== 'none');
    if (!await page.locator('#member-list').textContent().then(s => s.includes('saved.example'))) throw new Error('Saved members disappeared after resource failure');
    await page.click('#members-retry-btn');
    console.log('ok  Resource read failure preserves saved members and offers Retry');
  }
  await page.waitForFunction(() => document.querySelector('#members-loading')?.style.display === 'none');
  console.log('ok  Groups editor renders before resource history finishes');
  console.log('ok  Resource loading indicator clears after the read');
  console.log(await page.evaluate(() => window.groupsProbe.calls));
  if (await page.evaluate(() => window.groupsProbe.calls.some(c => c.command === 'rows.since'))) throw new Error('Groups must not scan usage history');
  console.log('ok  Groups reads the saved summary, not usage history');
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  releaseScript?.();
  await context.close();
  if (path.dirname(profile) !== path.resolve(os.tmpdir())) throw new Error('Profile escaped the temporary directory');
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
