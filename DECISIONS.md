# DECISIONS

TL;DR: consequential choices, newest first, ≤5 lines each. Format: Date · Decision · Why · Rejected · Consequence.

2026-09-14 · A stopped run stays on the bar of every page, in red, with the count reached and a Retry; the sync page and the bar share one status sentence
Why: a merge that failed part way left no trace anywhere.
Rejected: a notification (gone in seconds, one page only).
Consequence: `statusText` in `syncClient.js` replaces the sync page's own renderer; Retry resumes the pending merge or runs a sync; the adapter stores a pulled row with this device's identity as own where absent, so a merge needs no local re-keying.

2026-09-18 · The device picker caches a ghost id (a device merged or forgotten elsewhere) as unresolvable instead of re-fetching the registry on every page load forever
Why: `deviceLabeler` retried whenever an id lacked a cached name, and a merged-away id can never gain one; the underlying stale row is now fixed at the core (reeflect-sync), but a name lookup gated on presence, not identity, would keep firing regardless.
Rejected: filtering the ghost id out of the picker client-side (the row it counts is the real bug; hiding the entry without the core fix would have hidden double-counted time, not fixed it).
Consequence: `_syncDeviceNames` gets a `null` sentinel for a confirmed-absent id; a real `devices()` read (opening the sync page) drops it again if the device returns.

2026-09-14 · Sync progress is one bar under every page's header, painted from the core's status record; the run belongs to the host, and a page only hands it over
Why: the sync page's own counter died with the page and starved once engine calls were serialized; the owner wants progress wherever the user is.
Rejected: a sync-page-only indicator; a driver loop per host (duplicate); a second progress record beside the status (duplicate).
Consequence: `host.sync.call` (a page → the background worker; null where the host runs the core itself); `syncClient.runSync` joins a run in flight, no Web Lock; `syncStrip.js` polls `syncStatus` and hides a record unchanged for a minute (a run that died with its process); the sync page keeps only its busy marker.

2026-09-14 · A device can merge another into itself: the sync page's "Merge into this device" moves the old device's history under the caller and drops it from the registry
Why: the owner reloaded the extension from the new folder and it came back as a new device; renaming or re-linking would not make one device of two.
Rejected: the caller taking over the old identity (session and key material would move too); a client-side copy of the rows (pushed twice, old ids kept).
Consequence: `syncClient.mergeDevice` ticks first, then one core command; the storage adapter gains `maxLocalId`, `reserveIds` (a sentinel bumps the key generator) and `adoptRows`; a merged-away install that links again re-pushes its rows (duplicates), so it stays retired; the smoke covers both.

2026-09-14 · The key at rest on Android is wrapped by an Android Keystore key, from Rust through JNI to the platform's own classes; every page gets its phone layout in its own stylesheet
Why: the crypto contract puts Android's DEK under the OS keystore, and the owner wants no logic in Kotlin; the pages' grids overflowed at 400px.
Rejected: a Kotlin keystore helper (logic outside Rust); the plain key file (below the tier); the wrap inside the core (the core has no platform); a Play listing (owner: out of scope).
Consequence: `keystore.rs` + `ndk-context` (the VM pointer tao already publishes; no new code in the binary); the core opens through `reeflect_open_shared_keys`; the desktop app keeps the plain file until its phase picks a keychain; `@media (max-width: 700px)` blocks in six page stylesheets and the header.

2026-09-14 · The shield's route reaches the pages through a Rust static (`PENDING_ROUTE`), not a Kotlin plugin call; the app identifier is `reeflect.app` (owner's pick)
Why: on the emulator the app froze (ANR) when the pages' `pending_route` poll overlapped a navigation: Tauri runs a command under its plugin lock, a mobile plugin call waits for the UI thread, and a navigation on the UI thread takes that same lock.
Rejected: keeping the Kotlin round trip and polling less often (the deadlock stays possible for every mobile plugin call); a Tauri patch (upstream code).
Consequence: `check` in `android.rs` sets the static and `pending_route` takes it, so the poll never leaves Rust; the other plugin calls (permissions, screens, app list) are user-triggered and rare, the same hazard in theory. MainActivity carries no intent extra.

2026-09-14 · Owner's rule applied: nothing exists twice. Row operations, the sync client and the dashboard build are one module in `ui/` over `coreCall`; Android logic is Rust, Kotlin is declarations and plumbing
Why: the app had grown twins of the sync client, the row operations and the blocked screen, and Kotlin held the tracker's and the shield's decisions.
Rejected: keeping per-host twins behind identical names; Kotlin logic (Android instantiates services by class, but decides nothing itself).
Consequence: `ui/shared/rowStore.js` (operations), `ui/shared/syncClient.js` and `data/intervalAggregates.js` shared; hosts keep only primitives (`intervalLog.js`: append, read) and `coreCall`; `app/src-tauri/src/tracker.rs` (stay state machine, block decision, tests) + `android.rs` (JNI entry points); Kotlin: `TrackerService` (notification, event query), `ShieldService` (window events, starts the app on the shared blocked page), `TrackerPlugin` (permissions, screens, app list, route), `BootReceiver`; `BlockedActivity`, `UsageTracker`, `Prefs`, `Core.kt` deleted; English strings load from the locale file on both hosts.

2026-09-14 · Reverted (owner's call): the Android tracker is a live foreground service; the history-based job is gone
Why: the owner rejected any tracking that degrades what the extension does. The extension keeps a site's open row current and enforces within seconds; a 15-minute history read cannot.
Rejected: the periodic job of 2026-09-13; keeping it beside the service.
Consequence: `TrackerService.kt` (special-use foreground type, persistent notification, sticky, `BootReceiver`) polls every 5 s and appends or touches the open row like `intervalTracker.js`; `UsageTracker.poll` extends the open row on every call; the shield rechecks every 10 s; `TrackerWorker.kt` and WorkManager removed; a third permission row (notifications) on the settings card; 5 s and 10 s are invented intervals.

2026-09-14 · App-block on Android is an Accessibility service asking the core's `verdict` on every window change and once a minute; the blocked screen is native
Why: the shield must run without the webview; a window-change event is the only signal for "an app came to the front", and a stay inside one app produces no further events, so a minute timer covers a limit reached mid-stay. The tracker cuts the open stay at the moment of a check so the verdict counts up to now.
Rejected: the shared blocked page in a second webview (needs the Tauri activity, cannot cover another app); checking only on window changes (a long stay would never be blocked).
Consequence: `ShieldService.kt` + `BlockedActivity.kt`, `BIND_ACCESSIBILITY_SERVICE` with `canRetrieveWindowContent=false`; the user enables it on the system Accessibility screen from the settings card; only launchable packages are checked; 60 s recheck (invented); app rules are `{matchType: exact, source: app, target: package, label}` from an Apps tab the extension never shows.

2026-09-13 · Android tracking reads the system's usage-event history from a periodic job; no foreground service; Kotlin reaches the core through JNI on the shared session
Why: Android records `ACTIVITY_RESUMED`/`PAUSED`/`STOPPED` and screen events itself, so a poll every 15 min rebuilds the same intervals a live tracker would, without a permanent notification or the Android 14 `specialUse` service type and its Play justification. The shield later reads events at the moment it needs a verdict.
Rejected: a foreground service polling the foreground app (the plan's line); a Kotlin → page → Rust bridge (only alive with the webview).
Consequence: `UsageTracker.kt` is host logic (the web twin is `intervalTracker.js`); only packages with a launcher entry count, declared through a manifest `<queries>` block (heuristic, no source); first run looks back 24 h (invented); enforcement latency up to 15 min until the shield exists; the Kotlin plugin is 1.9 → 2.1 because WorkManager 2.11 needs it.

2026-09-13 · The app loads the core at runtime (`libloading`) from `app/native/<target>/`, keeps prefs in one JSON file, and overlays four platform twins on `ui/`
Why: a public app cannot depend on the private core as source, and link-time binding to a prebuilt library needs per-OS import files and packaging steps; one `dlopen` by path (desktop) or by name (Android jniLibs) needs neither. Prefs need no database. The twins (`host`, `core`, `syncClient`, `intervalLog`) are the whole platform seam of the UI.
Rejected: `#[link]` against the prebuilt library (import library on MSVC, build-script copies into the target dir); a Rust dependency on the core (private source); a `chrome.*` polyfill in the app.
Consequence: `app/web/` may hold only twins of files in `ui/shared/` or `extension/src/data/`; `dashboard.build` in the app reads rows on the native side; identifier `com.coralclock.reeflect` (invented; now `reeflect.app`); the window CSS width on high-DPI displays is unverified.

2026-09-13 · One host module (`src/shared/host.js`) between the UI and the platform; the repo becomes the client monorepo (`extension/`, `ui/`, `app/`)
Why: the UI must exist once on disk for the extension, the Android app and desktop, and the app's page runtime has no `chrome.*`; 144 direct calls in pages, shared and data were the only thing binding the pages to the extension.
Rejected: keeping `chrome.*` in pages with a polyfill in the app (a fake browser API is logic to maintain); a separate UI repo as a submodule (one more thing to keep in step).
Consequence: the convention "pages read `chrome.storage.local` directly" is replaced by "only `host.js` and `src/background/` call `chrome.*`"; the change listener no longer receives the storage area; load-unpacked and the store zip use `dist/extension/`, assembled by NTFS junctions or symlinks (`scripts/os/assemble.mjs`, `--copy` for the zip); the wasm stays under `extension/src/vendor/`, the data layer under `extension/src/data/` (the app carries a twin over the native rows commands).

2026-09-12 · Every dashboard total comes from the core's `Dashboard`; `intervalAggregates.js` is an adapter, the device filter is one of its parameters
Why: the core already read rows for the verdict and JavaScript read them again for the dashboard, so a device filter would have been written twice; Android and desktop embed the core, not this repo's scripts.
Rejected: a JavaScript device filter (row logic per platform); filtering the timeline's rows in the core (the timeline draws rows, it does not aggregate them; its filter is a plain selection in page memory).
Consequence: the page passes every row to `Dashboard.build(rows, deviceIds, time)` and reads the shapes as JSON; a device change clears each page's caches and reloads; legacy bucket days count as this device's data; device names are cached in `chrome.storage.local._syncDeviceNames` on every registry read; measured 450–500 ms per rebuild on 30K rows in Chromium (`dashboard-smoke.mjs`). Design: `docs/appendix/device-filter-ui.md`.
