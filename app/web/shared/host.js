// The app's platform seam: the same surface as ui/shared/host.js, over Tauri. Prefs live in one
// JSON file on the Rust side; a change arrives as the `prefs-changed` event. Nothing here decides anything.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const unlisteners = new Map();
const version = await invoke('app_version');
const BLANK_ICON = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const android = /Android/i.test(navigator.userAgent);
// Desktop runs without native decorations (`decorations: false`), so the titlebar drives the window.
// Android has no window at all.
const appWindow = android ? null : window.__TAURI__.window.getCurrentWindow();

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
  features: { badge: false, popup: false },
  sync: null,
  // Android: the usage tracker and the blocking shield are Kotlin services the user must allow.
  tracker: android ? {
    status: () => invoke('plugin:tracker|status'),
    openUsageSettings: () => invoke('plugin:tracker|open_settings'),
    openAccessibilitySettings: () => invoke('plugin:tracker|open_accessibility_settings'),
    requestNotifications: () => invoke('plugin:tracker|request_notifications'),
  } : null,
  // Installed apps a user can open: `[{package, label}]`, for app rules.
  apps: android ? () => invoke('plugin:tracker|apps') : null,
  windowControls: appWindow ? {
    minimize: () => appWindow.minimize(),
    toggleMaximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.close(),
    isMaximized: () => appWindow.isMaximized(),
    onResized: (fn) => appWindow.onResized(fn),
  } : null,
};

// The shield asks for a page: the activity keeps the route, the page asks for it when it becomes
// visible and, as a safety net, every two seconds.
if (android) {
  const follow = () => invoke('plugin:tracker|pending_route').then(({ url }) => { if (url) location.replace(url); }).catch(() => {});
  follow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') follow(); });
  setInterval(follow, 2000);
}
