// The one place pages, shared modules and the data layer touch the platform. This is the
// extension implementation; the app's arrives with the app. Nothing here decides anything.
const local = chrome.storage.local;
const wrapped = new Map();
// A page hands long runs to the background worker, which outlives it; the worker runs them itself.
const isBackground = typeof document === 'undefined';

export const host = {
  prefs: {
    get: (keys) => local.get(keys),
    set: (items) => local.set(items),
    remove: (keys) => local.remove(keys),
    bytesInUse: (keys = null) => local.getBytesInUse(keys),
    quota: local.QUOTA_BYTES ?? 10485760,
    onChanged(fn) {
      const listener = (changes, area) => { if (area === 'local') fn(changes); };
      wrapped.set(fn, listener);
      chrome.storage.onChanged.addListener(listener);
    },
    offChanged(fn) {
      const listener = wrapped.get(fn);
      if (!listener) return;
      chrome.storage.onChanged.removeListener(listener);
      wrapped.delete(fn);
    },
  },
  assetUrl: (path) => chrome.runtime.getURL(path),
  version: () => chrome.runtime.getManifest().version,
  uiLanguage: () => chrome.i18n.getUILanguage(),
  faviconUrl: (pageUrl) => `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`,
  open: (url) => chrome.tabs.create({ url }),
  openPage: (name) => chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/${name}/${name}.html`) }),
  async findPage(name) {
    const [tab] = await chrome.tabs.query({ url: `${chrome.runtime.getURL(`src/pages/${name}/${name}.html`)}*` });
    return tab ?? null;
  },
  async focusPage(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  },
  permissions: {
    request: (what) => chrome.permissions.request(what),
    remove: (what) => chrome.permissions.remove(what),
    contains: (what) => chrome.permissions.contains(what),
  },
  features: { badge: true },
  sync: isBackground ? null : {
    call: (fn, args) => chrome.runtime.sendMessage({ type: 'sync', fn, args }).then((r) => {
      if (r?.error) throw new Error(r.error);
      return r?.ok ?? null;
    }),
  },
  tracker: null,
  apps: null,
};
