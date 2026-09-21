# Reeflect

TL;DR: Vivaldi/Chromium MV3 extension that tracks per-site browsing time and blocks sites past a limit. Read STATE.md for where work stands, and follow the global agent-os rules.

## Where things live
Rules, not an inventory. Read the directory for names.
- One UI, two shells. `ui/` holds every page and every shared module. `extension/` adds the service worker and the data layer; `app/` (Tauri 2) adds a Rust host with the same job. `scripts/os/assemble.mjs` assembles the extension, `--app` the app. Never edit `dist/` or `app/dist/`.
- `ui/pages/<name>/` is one `<name>.{html,css,js}` triplet per page. Anything a second page needs moves to `ui/shared/`.
- Platform access is one-way. `chrome.*` appears in `extension/src/background/` and in `ui/shared/host.js`, nowhere else. Pages and data modules call `host.js`; the app answers the same shape from Rust.
- Nothing computes a total or a verdict in this repo. The vendored core (`extension/src/vendor/reeflect-core/`) answers through `ui/shared/core.js`. A page may paint from a saved build, so the numbers on screen can lag the rows.
- `extension/src/data/` owns the stored rows: the IndexedDB schema, aggregates, import, export, pruning, and the storage host the core writes through.
- `extension/src/background/` owns everything only a service worker can do: tab and window presence, alarms, the blocking rules, the badge.
- Rust lives in `app/src-tauri/src/`: the bridge, the platform trackers, the key at rest. Kotlin under `app/src-tauri/gen/android/` is plumbing — never put a decision there.
- Every user-facing string goes to `ui/_locales/<lang>/messages.json`, every language in the same step.
- Docs: `docs/architecture/architecture.md` (tracking, enforcement), `docs/features/<name>.md` per feature.

## Conventions (reuse before create — working rule 6)
Every code rule lives in one file, loaded together with this one: @docs/conventions.md
Reasoning behind the longer rules: `docs/appendix/coding-conventions.md` (reference only).

## Commands
- capture: `node scripts/os/capture.mjs --view <name> [--seed] [--console]` — own Chromium with the unpacked extension, screenshots in `shots/`, profile in the OS temp dir, `--seed` fills it. The view names are the keys in `scripts/os/capture.config.mjs`.
- test: the smoke scripts are `scripts/os/*-smoke.mjs`. Each drives a real profile and prints its own checks. The sync ones need the server on 127.0.0.1:8787.
- app: `assemble.mjs --app` (copies the `.so` into jniLibs too), then `cd app && npx tauri dev --no-watch`, or `npx tauri android build --apk --target x86_64 --debug` with `NDK_HOME` + `ANDROID_HOME` set.
- lint: `npm run lint:i18n` (checker in the gitignored `.local/`) · `node scripts/os/doc-lint.mjs --changed`
- dev server: none, no build or serve step.
- release: a `vX.Y.Z` tag runs `.github/workflows/package.yml`, which assembles, zips, and attaches the zip to a GitHub release. The Chrome Web Store upload stays manual.

## Core (changes here are [core] tier — decision gate applies)
Four responsibilities, wherever their code sits.
- Presence and range logic — `intervalTracker.js` and `intervalTrackingUtils.js`. Overcounting bugs start here.
- The stored row shape — `intervalLog.js`. Every derived total is read back through it.
- Verdict to blocking rules — `enforcement.js`. The limit maths are the core's; turning a tab into a resource, and acting on it, stays here.
- Sync bookkeeping — `syncStorage.js` and the sync fields in `intervalLog.js`. A wrong dirty flag or a missed delete queue is silent divergence between devices.
