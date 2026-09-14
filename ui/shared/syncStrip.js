import { syncStatus } from './syncClient.js';
import { initI18n, t } from './i18n.js';

// The sync's live progress on every page: a bar under the header while a run is on. The run lives
// in the host (the extension's background worker, the app's backend), so this page only polls the
// core's status record and paints its `running` part. A record that stops changing for a minute is
// a run that died with its process: the bar goes.
const IDLE_MS = 2000;
const ACTIVE_MS = 500;
const STALE_MS = 60_000;

const strip = document.createElement('div');
strip.id = 'sync-subheader';
strip.hidden = true;
strip.setAttribute('role', 'status');
strip.innerHTML = '<span id="sync-subheader-text"></span><div id="sync-subheader-bar"><div id="sync-subheader-fill"></div></div>';
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

let last = '';
let lastChange = 0;
async function poll() {
  let running = null;
  try {
    running = (await syncStatus())?.running ?? null;
  } catch {
    running = null;
  }
  const key = running ? JSON.stringify(running) : '';
  const now = Date.now();
  if (key !== last) {
    last = key;
    lastChange = now;
  }
  const show = running !== null && now - lastChange < STALE_MS;
  if (show) paint(running);
  strip.hidden = !show;
  setTimeout(poll, show ? ACTIVE_MS : IDLE_MS);
}

initI18n().then(poll);
