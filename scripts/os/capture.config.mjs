// capture.config.mjs — filled by /os-init, extended by /ship
export default {
  type: "extension",
  extensionPath: "dist/extension",   // built by scripts/os/assemble.mjs (links into extension/ and ui/)
  logFile: "logs/dev.log",
  defaultView: "dashboard",
  profileDir: "agent-os-ext-profile-reeflect",
  // No dev server: the extension is loaded unpacked, so `start` is intentionally unset and
  // scripts/os/dev.mjs is not used here. capture.mjs launches its own Chromium each run.
  prepare: [
    // The guided tour and the what's new bar would cover every screenshot, and the tour also
    // swaps the page onto mock data. Mark both as already seen.
    {
      page: "src/pages/dashboard/dashboard.html",
      evaluate: `chrome.storage.local.set({
        tour: { completed: true, completedAt: new Date().toISOString(), inProgress: null, useMockData: false },
        lastShownChangelogVersion: chrome.runtime.getManifest().version,
      })`,
    },
    // --seed reuses the dashboard's own ?seed entry point instead of duplicating the generator.
    // The data lands in the persistent profile, so one seeded run lasts until the profile is deleted.
    { flag: "seed", page: "src/pages/dashboard/dashboard.html?seed", untilStorage: "sitesByDay" },
  ],
  views: {
    dashboard:  { page: "src/pages/dashboard/dashboard.html" },
    site:       { page: "src/pages/site/site.html" },
    path:       { page: "src/pages/path/path.html" },
    timeline:   { page: "src/pages/browsing-timeline/browsing-timeline.html" },
    rules:      { page: "src/pages/rules/rules.html" },
    settings:   { page: "src/pages/settings/settings.html" },
    popup:      { page: "src/pages/popup/popup.html" },
    blocked:    { page: "src/pages/blocked/blocked.html" },
    quotes:     { page: "src/pages/quotes/quotes.html" },
    sync:       { page: "src/pages/sync/sync.html" },
    storage:    { page: "src/pages/storage-management/storage-management.html" },
    legacy:     { page: "src/pages/legacy-storage-management/legacy-storage-management.html" },
  },
};
