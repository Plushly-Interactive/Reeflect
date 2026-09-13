// Off by default (logs contain URLs). Enable: chrome.storage.local.set({ _debug: true }) then reload.
let _debug = false;

// Read the flag once at startup. Called from bootstrap before listeners run.
export async function initDebug() {
  const { _debug: flag = false } = await chrome.storage.local.get('_debug');
  _debug = flag;
}

// Check before building expensive log args (e.g. JSON.stringify) to skip them when off.
export function isDebug() {
  return _debug;
}

// Timestamp prefix lets [BG-DBG] traces correlate with stored day/hour data.
export function dbg(...args) {
  if (!_debug) return;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  console.log(`[BG-DBG ${date} ${time}]`, ...args);
}
