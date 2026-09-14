import { syncStatus, statusText, runSync, mergeDevice } from './syncClient.js';
import { initI18n, t } from './i18n.js';

// The sync's live progress on every page: a bar under the header while a run is on. The run lives
// in the host (the extension's background worker, the app's backend), so this page only polls the
// core's status record and paints its `running` part. A record that stops changing for a minute is
// a run that died with its process: the bar goes. A run that failed stays on the bar, with the
// count it reached and a retry, until a run succeeds.
const IDLE_MS = 2000;
const ACTIVE_MS = 500;
const STALE_MS = 60_000;

const strip = document.createElement('div');
strip.id = 'sync-subheader';
strip.hidden = true;
strip.setAttribute('role', 'status');
strip.innerHTML = '<span id="sync-subheader-text"></span><div id="sync-subheader-bar"><div id="sync-subheader-fill"></div></div><button id="sync-subheader-retry" class="btn" type="button" hidden></button>';
const header = document.querySelector('header');
if (header) header.after(strip);
else document.body.prepend(strip);

const number = (n) => n.toLocaleString();
const TEXT = {
  uploading: (p) => t('sync_stripUploading', [number(p.done), number(p.total)]),
  downloading: (p) => t('sync_stripDownloading', [number(p.done)]),
  checking: () => t('sync_stripChecking'),
  moving: (p) => t('sync_stripMoving', [number(p.done), number(p.total)]),
};

function paint(p) {
  strip.querySelector('#sync-subheader-text').textContent = (TEXT[p.phase] ?? (() => p.phase))(p);
  const known = p.total > 0;
  strip.classList.toggle('indeterminate', !known);
  strip.querySelector('#sync-subheader-fill').style.width = known ? `${Math.min(100, Math.round((p.done / p.total) * 100))}%` : '';
}

const retry = strip.querySelector('#sync-subheader-retry');
let pending = null;
retry.addEventListener('click', async () => {
  retry.disabled = true;
  try {
    await (pending ? mergeDevice(pending.deviceId) : runSync());
  } catch {
    // the status record carries the outcome; the next poll paints it
  } finally {
    retry.disabled = false;
  }
});

function paintFailure(status) {
  strip.querySelector('#sync-subheader-text').textContent = statusText(status);
  const m = status.pendingMerge;
  const known = m && m.total > 0;
  strip.classList.remove('indeterminate');
  strip.querySelector('#sync-subheader-fill').style.width = known ? `${Math.min(100, Math.round((m.moved / m.total) * 100))}%` : '0%';
}

let last = '';
let lastChange = 0;
async function poll() {
  let status = null;
  try {
    status = await syncStatus();
  } catch {
    status = null;
  }
  const running = status?.running ?? null;
  const key = running ? JSON.stringify(running) : '';
  const now = Date.now();
  if (key !== last) {
    last = key;
    lastChange = now;
  }
  const live = running !== null && now - lastChange < STALE_MS;
  // A pause is a wait, not work: the sentence shows, the bar and the retry do not.
  const paused = !live && status?.lastError === 'Paused';
  const failed = !live && Boolean(status?.lastError) && !paused;
  pending = failed ? (status.pendingMerge ?? null) : null;
  strip.classList.toggle('failed', failed);
  strip.classList.toggle('paused', paused);
  retry.hidden = !failed;
  retry.textContent = t('sync_stripRetry');
  if (live) paint(running);
  else if (failed || paused) paintFailure(status);
  strip.hidden = !(live || failed || paused);
  setTimeout(poll, live ? ACTIVE_MS : IDLE_MS);
}

initI18n().then(poll);
