# Reeflect

TL;DR: Vivaldi/Chromium MV3 extension that tracks per-site browsing time and blocks sites past a limit. Read STATE.md for where work stands, and follow the global agent-os rules.

## Map (hot files)
- `extension/` + `ui/` → `dist/extension/` by links (`node scripts/os/assemble.mjs`); load unpacked and zip from there. `app/` (Tauri 2) = `ui/` + extension data + `app/web/` twins → `app/dist/` (`--app`); `src-tauri/src/lib.rs` loads `app/native/` and answers `core_call`, `prefs_*`; Android tracker: `gen/android/.../reeflect/*.kt` (`Core.kt` = JNI).
- `extension/src/background/` — service worker: `intervalTracker.js` (presence ranges), `enforcement.js` (verdict → blocking rules), `background.js`, `badge.js`.
- `extension/src/data/` — storage layer: `intervalLog.js` (IndexedDB rows), `intervalAggregates.js`, import/export/prune.
- `ui/pages/<name>/` — one `<name>.{html,css,js}` triplet per full-page view.
- `ui/shared/` — cross-page UI and helpers; `host.js` = the only `chrome.*` outside `extension/src/background/`.
- The vendored core (`extension/src/vendor/reeflect-core/`) is loaded once through `ui/shared/core.js`, which also builds the `Time` snapshot. Cloud sync: `ui/shared/syncClient.js` owns every account action; `extension/src/background/sync.js` is only the alarm; `extension/src/data/syncStorage.js` is the storage host; `intervalLog.js` owns the v2 schema (deviceId, localId, dirty, mirror, deletes, meta); `ui/pages/sync/` is the UI.
- `ui/_locales/{en,es,fr}/messages.json` — every string; en is the source.
- `docs/architecture/architecture.md` — tracking and enforcement together.

## Conventions (reuse before create — working rule 6)
Every code rule lives in one file, loaded together with this one: @docs/conventions.md
Reasoning behind the longer rules: `docs/appendix/coding-conventions.md` (reference only).

## Commands
- capture: `node scripts/os/capture.mjs --view <name> [--seed] [--console]`
  - Views: every page name, plus popup and blocked.
  - Own Chromium with the unpacked extension; screenshots in `shots/`.
  - `--seed` fills the profile with fake data.
  - Profile persists in the OS temp dir (`agent-os-ext-profile-reeflect`).
- lint (i18n): `npm run lint:i18n` (checker in the gitignored `.local/`).
- doc budgets: `node scripts/os/doc-lint.mjs --changed`
- app: `assemble.mjs --app` (copies the `.so` into jniLibs too), then `cd app && npx tauri dev --no-watch`, or `npx tauri android build --apk --target x86_64 --debug` with `NDK_HOME` + `ANDROID_HOME` set.
- test: `scripts/os/enforce-smoke.mjs` (6) · `dashboard-smoke.mjs` (13) · `sync-smoke.mjs` (26) · `sync-paused.mjs` (7); the sync ones need the server on 127.0.0.1:8787.
- dev server: none, no build or serve step.
- deploy: `assemble.mjs --copy`, zip `dist/extension/`, upload to the Chrome Web Store (the tag workflow does the same).

## Core (changes here are [core] tier — decision gate applies)
- `extension/src/background/intervalTracker.js` and `intervalTrackingUtils.js` — presence and range logic; overcounting bugs start here.
- `extension/src/data/intervalLog.js` — the stored row shape. Every derived total comes from the core's `Dashboard` through `intervalAggregates.js`.
- `extension/src/background/enforcement.js` — flattens the core's verdict and publishes the blocking rules. Limit maths, read window and rule coverage are the core's; turning a tab into a resource, and acting on it, stays here.
- `extension/src/data/syncStorage.js` and the sync fields in `intervalLog.js` — a wrong dirty flag or missed delete queue is silent divergence between devices.
