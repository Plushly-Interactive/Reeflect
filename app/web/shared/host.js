// The app's platform seam: the same surface as ui/shared/host.js, over Tauri. Prefs live in one
// JSON file on the Rust side; a change arrives as the `prefs-changed` event. Nothing here decides anything.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const unlisteners = new Map();
const version = await invoke('app_version');
// English is the source of every string; the browser supplied it in the extension, here it is read once.
const english = await (await fetch('/_locales/en/messages.json')).json();
const BLANK_ICON = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export const host = {
  prefs: {
    get: (keys) => invoke('prefs_get', { keys: keys ?? null }),
    set: (items) => invoke('prefs_set', { items }),
    remove: (keys) => invoke('prefs_remove', { keys }),
    bytesInUse: async () => 0,
    quota: 10485760,
    onChanged(fn) {
      unlisteners.set(fn, listen('prefs-changed', (event) => fn(event.payload)));
    },
    offChanged(fn) {
      const pending = unlisteners.get(fn);
      if (!pending) return;
      unlisteners.delete(fn);
      pending.then((unlisten) => unlisten());
    },
  },
  assetUrl: (path) => `/${path}`,
  version: () => version,
  uiLanguage: () => navigator.language,
  nativeMessage(key, subs) {
    const entry = english[key];
    if (!entry) return '';
    const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
    return entry.message.replace(/\$(\d+)/g, (_match, n) => list[n - 1] ?? '');
  },
  faviconUrl: () => BLANK_ICON,
  open: (url) => window.open(url),
  openPage: (name) => { location.href = `/src/pages/${name}/${name}.html`; },
  findPage: async () => null,
  focusPage: async () => {},
  permissions: {
    request: async () => true,
    remove: async () => {},
    contains: async () => true,
  },
};
