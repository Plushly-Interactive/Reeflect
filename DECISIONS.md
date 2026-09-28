# DECISIONS

TL;DR: consequential choices, newest first, ≤5 lines each. Format: Date · Decision · Why · Rejected · Consequence.

2026-09-27 · The dashboard keeps finished days (`dashboard-cache` v2, one record per shape and day) and rebuilds from the earliest day the row log names; rows DB v4 adds the `changes` log
Why: the saved copy rebuilt all history 30 s after each build, freezing the page up to 2.5 s at 110K rows.
Rejected: a longer copy age (today goes stale); a Web Worker (same wait, only unfrozen).
Consequence: 110K rows: dashboard 354 ms, page frozen ≤ 99 ms, after a new row (was 635 ms + 2549 ms frozen); first open after the update rebuilds all once (about 2 s); one picked device still builds in full.

2026-09-27 · The rows database (`browsing-intervals`) goes to version 3 with an index on `to`; recent-window reads walk it
Why: the blocked page, the badge and every enforcement check read the whole log to keep a few hundred rows: 0.9 s at 110K rows.
Rejected: the background writes the blocked page's numbers to a key (extension only, the app would stay slow).
Consequence: blocked page numbers in 144–166 ms at 110K rows, after a one-time index build (2.3 s on first open); an older extension build can no longer open the database, and a git revert does not undo that.

2026-09-27 · Android reads browser address bars via a second accessibility service, behind an opt-in, off by default
Why: owner asked for per-site time and blocking in phone browsers; a separate service keeps the app shield's "never reads screen content".
Rejected: screen reading in the shield itself; a local VPN (domain only); ids not proven in the browser's source.
Consequence: web rows from 5 browsers, path `""` when only the host shows; a pause or stop closes a stay only for the activity in front.

2026-09-27 · A rule holds any mix of apps and sites under one limit, chosen in one picker; the Apps tab is gone
Why: the owner asked for Block's model (one "Blocked apps and websites" box) so an app alone or with sites is one step, in the extension too.
Rejected: a site field with apps as typing suggestions (tried, reverted); a separate Apps tab.
Consequence: one target stays flat, several are `matchers`, `name` optional; the extension publishes one DNR rule per web matcher; pulled rows keep a non-web `source` and old ones are pulled once more. Rules do not sync until reeflect-sync phase 6.

2026-09-21 · The desktop window drops its native decorations and its page header; `ui/shared/titleBar.js` draws one bar with the header's contents and the three window buttons, copied from Leitscape
Why: the owner asked for Leitscape's bar exactly. One shared module reaches every page of a multi-page UI; `host.windowControls` is null in the extension and on Android, so neither gets a bar.
Rejected: a titlebar per page triplet; `@tauri-apps/api` imports (no bundler — the app reads `window.__TAURI__`).
Consequence: `decorations: false`, `minWidth`/`minHeight` 480, six `core:window:*` permissions; every page but `popup` loads `titleBar.{js,css}`; above 700px `#header-left`, `#header-center` and `#header-right` move into the bar, which is a three-column grid like the phone header so the middle stays centred, and `header` is hidden; at 700px or less they go back, because the page's phone layout puts a picker row and a "more" menu in the header.

2026-09-21 · The app identifier is `app.reeflect` (owner's pick), was `reeflect.app`
Why: the Tauri CLI warns that an identifier which ends in `.app` conflicts with the macOS bundle extension.
Rejected: keep `reeflect.app` (fine only with no macOS build); an identifier under a company domain (the product belongs to no company).
Consequence: Android installs it as a new app, the old install keeps its rows and key; the Windows data folder moves to `%APPDATA%\app.reeflect`; Kotlin sources live in `java/app/reeflect/`, the JNI names are `Java_app_reeflect_Native_*`.

2026-09-21 · The Android `release` build signs from a gitignored `gen/android/keystore.properties`; `npm run apk` is the one build command
Why: the release APK came out unsigned and a phone refuses it; a build without `assemble.mjs --app` shipped old pages.
Rejected: the agent makes the key (a credential the owner holds); `apksigner` by hand after each build; an assemble step the user must remember.
Consequence: block copied from Leitscape into `app/build.gradle.kts`; file missing means the same unsigned build; `beforeBuildCommand` assembles on every `tauri android build`, not on `tauri dev`; steps in `docs/features/android-app.md`.

2026-09-21 · `intervalAggregates.js` saves the last all-devices build; a page paints from it, a copy older than 30 s rebuilds in the background
Why: a build reads every row, 2.6 s at 111K rows, on every page open; measured 3.0 s cold against 0.47 s from the copy.
Rejected: a copy with no refresh (today freezes); storing it in the interval database (a migration beside the sync tables); waiting for an incremental build in the core.
Consequence: own database `dashboard-cache`; numbers up to 30 s old (invented, user agreed); `invalidate()` wipes the copy, a device filter never uses it; only a page that registered `onRefreshed` gets an old copy; per-clock-hour averages are saved beside it, stamped with their build.

2026-09-21 · `storedRows` reads rows in one bulk call and filters in memory
Why: a dashboard build took 3.2 s at 111K rows; the cursor walk was 1.5 s of it, a bulk read 0.7 s.
Rejected: an index (a migration; the dashboard asks for every row).
Consequence: about 1.7 s per rebuild in the extension; same rows and order; the app reads natively and gains nothing.

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
