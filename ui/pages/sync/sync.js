import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { keyActivate, showNotification, escapeHtml } from '../../shared/utils.js';
import { confirmDialog } from '../../shared/confirmDialog.js';
import {
  syncState, syncStatus, runSync, startSyncing, linkDevice, recoveryPhrase,
  devices, renameDevice, signOutDevice, forgetDevice, mergeDevice, stopSyncingEverywhere,
} from '../../shared/syncClient.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
document.title = `${t('sync_pageTitle')} - ${BRAND_NAME}`;
keyActivate(document.querySelector('#back-btn'), [' ']);

const cards = {
  off: document.querySelector('#card-off'),
  signedOut: document.querySelector('#card-signed-out'),
  link: document.querySelector('#card-link'),
  phrase: document.querySelector('#card-phrase'),
  confirm: document.querySelector('#card-confirm'),
  on: document.querySelector('#card-on'),
  devices: document.querySelector('#card-devices'),
  danger: document.querySelector('#card-danger'),
};

// Exactly one flow is visible at a time; the "on" flow shows three cards together.
function show(...names) {
  for (const [name, el] of Object.entries(cards)) el.style.display = names.includes(name) ? '' : 'none';
}

// The run belongs to the host and every page shows its bar; this page only marks itself busy
// until the result is in, then re-renders.
async function syncAndRender() {
  const main = document.querySelector('#sync-main');
  const nowBtn = document.querySelector('#sync-now-btn');
  main.setAttribute('aria-busy', 'true');
  nowBtn.disabled = true;
  try {
    await runSync();
  } finally {
    try {
      await render();
    } finally {
      main.removeAttribute('aria-busy');
      nowBtn.disabled = false;
    }
  }
}

let pendingPhrase = null;   // held only between "start syncing" and the confirmation
let confirmIndexes = [];

async function render() {
  const state = await syncState();
  if (state === 'on') {
    show('on', 'devices', 'danger');
    await renderStatus();
    await renderDevices();
  } else if (state === 'signedOut') {
    show('signedOut');
  } else {
    show('off');
  }
}

// The server can refuse a write and say how long to wait. Every path that shows an error asks
// this first, so none of them prints the raw code or the reason the server gave.
function pausedText(e) {
  const m = /^Paused: (\d+)$/.exec(String(e?.message ?? e));
  if (!m) return null;
  const when = new Date(Date.now() + Number(m[1]) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return t('sync_statusPaused', [when]);
}

async function renderStatus() {
  const status = await syncStatus();
  const el = document.querySelector('#sync-status');
  if (!status) { el.textContent = t('sync_statusNever'); return; }
  // A pause is a wait, not a failure: say when it resumes and leave the cause out of it.
  if (status.lastError === 'Paused') {
    const when = new Date(status.retryAfter ?? Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.textContent = t('sync_statusPaused', [when]);
    return;
  }
  if (status.lastError) { el.textContent = t('sync_statusError', [status.lastError]); return; }
  const when = new Date(status.lastRunAt).toLocaleString();
  const r = status.lastReport;
  el.textContent = r ? t('sync_statusOk', [when, String(r.pushed), String(r.pulled)]) : t('sync_statusNever');
}

async function renderDevices() {
  const list = document.querySelector('#devices-list');
  list.textContent = t('sync_devicesLoading');
  let rows;
  try {
    rows = await devices();
  } catch (e) {
    list.textContent = pausedText(e) ?? t('sync_devicesError', [String(e.message ?? e)]);
    if (String(e.message ?? e) === 'NeedsReauth') await render();
    return;
  }
  await host.prefs.set({ _syncDeviceCount: rows.filter((d) => d.signedIn).length });
  list.textContent = '';
  for (const d of rows) {
    const row = document.createElement('div');
    row.className = 'device-row';
    const name = d.name || t('sync_deviceUnnamed');
    const meta = [d.me ? t('sync_deviceThis') : null, d.signedIn ? null : t('sync_deviceSignedOut')].filter(Boolean).join(' · ');
    row.innerHTML = `<span class="device-name">${escapeHtml(name)}</span><span class="device-meta">${escapeHtml(meta)}</span><span class="device-actions"></span>`;
    const actions = row.querySelector('.device-actions');
    actions.append(
      button(t('sync_renameBtn'), () => rename(d, row)),
      ...(d.signedIn ? [button(t('sync_signOutBtn'), () => signOut(d))] : [button(t('sync_forgetBtn'), () => forget(d))]),
      ...(d.me ? [] : [button(t('sync_mergeBtn'), () => merge(d))]),
    );
    list.append(row);
  }
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// Rename edits in place: the row's name becomes an input with save/cancel beside it.
function rename(d, row) {
  const nameEl = row.querySelector('.device-name');
  const actions = row.querySelector('.device-actions');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'device-name-input';
  input.value = d.name ?? '';
  input.setAttribute('aria-label', t('sync_renameLabel'));
  nameEl.replaceWith(input);
  actions.textContent = '';
  actions.append(
    button(t('sync_saveBtn'), async () => {
      const name = input.value.trim();
      if (name === '') return;
      await renameDevice(d.deviceId, name);
      showNotification(t('sync_renamed'));
      await renderDevices();
    }),
    button(t('sync_cancel'), renderDevices),
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') actions.firstChild.click();
    if (e.key === 'Escape') renderDevices();
  });
  input.focus();
  input.select();
}

async function signOut(d) {
  const ok = await confirmDialog({
    message: d.me ? t('sync_signOutSelfConfirm') : t('sync_signOutConfirm', [d.name || t('sync_deviceUnnamed')]),
    confirmLabel: t('sync_signOutBtn'),
  });
  if (!ok) return;
  await signOutDevice(d.deviceId);
  await render();
}

async function forget(d) {
  const ok = await confirmDialog({ message: t('sync_forgetConfirm'), confirmLabel: t('sync_forgetBtn') });
  if (!ok) return;
  try {
    await forgetDevice(d.deviceId);
  } catch (e) {
    showNotification(pausedText(e) ?? (String(e.message ?? e).includes('device_has_rows') ? t('sync_forgetHasRows') : String(e.message ?? e)));
    return;
  }
  await renderDevices();
}

// The device was this one before a reinstall: its history moves here and it leaves the list.
async function merge(d) {
  const name = d.name || t('sync_deviceUnnamed');
  const ok = await confirmDialog({ message: t('sync_mergeConfirm', [name]), confirmLabel: t('sync_mergeBtn') });
  if (!ok) return;
  try {
    await mergeDevice(d.deviceId);
  } catch (e) {
    showNotification(pausedText(e) ?? (String(e.message ?? e).includes('unpulled_rows') ? t('sync_mergeUnpulled') : String(e.message ?? e)));
    return;
  }
  showNotification(t('sync_merged', [name]));
  await render();
}

function renderPhrase(listEl, phrase) {
  listEl.textContent = '';
  for (const word of phrase.split(' ')) {
    const li = document.createElement('li');
    li.textContent = word;
    listEl.append(li);
  }
}

// Three words, drawn at random, must be typed back before sync starts — the standard
// wallet-seed check that catches "I'll write it down later".
function renderConfirmFields() {
  const words = pendingPhrase.split(' ');
  confirmIndexes = [];
  while (confirmIndexes.length < 3) {
    const i = Math.floor(Math.random() * words.length);
    if (!confirmIndexes.includes(i)) confirmIndexes.push(i);
  }
  confirmIndexes.sort((a, b) => a - b);
  const wrap = document.querySelector('#confirm-fields');
  wrap.textContent = '';
  for (const i of confirmIndexes) {
    const field = document.createElement('div');
    field.className = 'confirm-field';
    const label = document.createElement('label');
    label.textContent = t('sync_confirmWordLabel', [String(i + 1)]);
    label.htmlFor = `confirm-word-${i}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.id = `confirm-word-${i}`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    field.append(label, input);
    wrap.append(field);
  }
  document.querySelector('#confirm-error').setAttribute('hidden', '');
}

// Offered from "off" and from "signed out": a device whose old account is gone (deleted, or the
// server moved) can only get back by starting a new one, so both states reach the same flow.
async function start(btn) {
  btn.disabled = true;
  try {
    pendingPhrase = await startSyncing();
    renderPhrase(document.querySelector('#phrase-words'), pendingPhrase);
    show('phrase');
  } catch (e) {
    showNotification(pausedText(e) ?? t('sync_startFailed', [String(e.message ?? e)]));
  } finally {
    btn.disabled = false;
  }
}

for (const id of ['#start-btn', '#restart-btn']) {
  document.querySelector(id).addEventListener('click', (e) => start(e.currentTarget));
}

document.querySelector('#phrase-next').addEventListener('click', () => {
  renderConfirmFields();
  show('confirm');
});

document.querySelector('#confirm-back').addEventListener('click', () => show('phrase'));

document.querySelector('#confirm-submit').addEventListener('click', async () => {
  const words = pendingPhrase.split(' ');
  const ok = confirmIndexes.every((i) => document.querySelector(`#confirm-word-${i}`).value.trim().toLowerCase() === words[i]);
  if (!ok) {
    document.querySelector('#confirm-error').removeAttribute('hidden');
    return;
  }
  pendingPhrase = null;
  // Switch to the "on" card before syncing, so the backfill reports progress instead of leaving
  // the confirmation card on screen for the whole upload. render() adds the rest once it is done.
  show('on');
  await syncAndRender();
  showNotification(t('sync_started'));
});

document.querySelector('#phrase-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(pendingPhrase ?? '');
  showNotification(t('sync_copied'));
});

document.querySelector('#phrase-print').addEventListener('click', () => window.print());

for (const id of ['#link-open-btn', '#relink-btn']) {
  document.querySelector(id).addEventListener('click', () => {
    document.querySelector('#link-input').value = '';
    document.querySelector('#link-error').setAttribute('hidden', '');
    show('link');
    document.querySelector('#link-input').focus();
  });
}

document.querySelector('#link-cancel').addEventListener('click', render);

document.querySelector('#link-submit').addEventListener('click', async () => {
  const btn = document.querySelector('#link-submit');
  const errEl = document.querySelector('#link-error');
  const phrase = document.querySelector('#link-input').value;
  if (phrase.trim().split(/\s+/).length !== 24) {
    errEl.textContent = t('sync_linkNeeds24');
    errEl.removeAttribute('hidden');
    return;
  }
  btn.disabled = true;
  errEl.setAttribute('hidden', '');
  try {
    await linkDevice(phrase);
    show('on');
    await syncAndRender();
    showNotification(t('sync_linked'));
  } catch (e) {
    const msg = String(e.message ?? e);
    errEl.textContent = pausedText(e) ?? (msg === 'NeedsReauth' ? t('sync_linkWrongPhrase') : t('sync_linkFailed', [msg]));
    errEl.removeAttribute('hidden');
  } finally {
    btn.disabled = false;
  }
});

document.querySelector('#sync-now-btn').addEventListener('click', async () => {
  await syncAndRender();
});

document.querySelector('#show-phrase-btn').addEventListener('click', async () => {
  const listEl = document.querySelector('#phrase-again-words');
  try {
    renderPhrase(listEl, await recoveryPhrase());
    listEl.removeAttribute('hidden');
    document.querySelector('#show-phrase-btn').style.display = 'none';
  } catch (e) {
    showNotification(pausedText(e) ?? String(e.message ?? e));
  }
});

document.querySelector('#stop-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({ message: t('sync_stopConfirm'), confirmLabel: t('sync_stopBtn') });
  if (!ok) return;
  try {
    await stopSyncingEverywhere();
  } catch (e) {
    showNotification(pausedText(e) ?? String(e.message ?? e));
  }
  await render();
});

await render();
