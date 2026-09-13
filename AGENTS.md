# Reeflect

TL;DR: Vivaldi/Chromium MV3 extension that tracks per-site browsing time and blocks sites past a limit. Read STATE.md for where work stands, and follow the global agent-os rules.

## Map (hot files)
- `extension/` + `ui/` → `dist/extension/` by links (`node scripts/os/assemble.mjs`); load unpacked and zip from there.
- `extension/src/background/` — service worker: `intervalTracker.js` (presence ranges), `enforcement.js` (core verdict → blocking rules), `background.js` (alarms, events), `badge.js`.
- `extension/src/data/` — storage layer: `intervalLog.js` (IndexedDB rows), `intervalAggregates.js` (the core's `Dashboard`), import/export/prune.
- `ui/pages/<name>/` — one `<name>.{html,css,js}` triplet per full-page view.
- `ui/shared/` — cross-page UI and helpers; `host.js` = the only `chrome.*` outside `extension/src/background/`.
- The vendored core (`extension/src/vendor/reeflect-core/`) is loaded once through `ui/shared/core.js`, which also builds the `Time` snapshot. Cloud sync: `ui/shared/syncClient.js` owns every account action; `extension/src/background/sync.js` is only the alarm; `extension/src/data/syncStorage.js` is the storage host; `intervalLog.js` owns the v2 schema (deviceId, localId, dirty, mirror, deletes, meta); `ui/pages/sync/` is the UI.
- `ui/_locales/{en,es,fr}/messages.json` — every user-facing string; en is the source.
- `docs/architecture/architecture.md` — how tracking and enforcement fit together.

## Conventions (reuse before create — working rule 6)
Every code rule lives in one file, loaded together with this one: @docs/conventions.md
The reasoning behind the longer rules is in `docs/appendix/coding-conventions.md` — reference, not required reading.

## Commands
- capture: `node scripts/os/capture.mjs --view <name> [--seed] [--width N] [--measure "sel"] [--console]`
  - Views: dashboard, site, path, timeline, rules, settings, sync, popup, blocked, quotes, storage, legacy.
  - Own Chromium with the unpacked extension; screenshots in `shots/`.
  - `--seed` fills the profile with fake browsing data.
  - The profile persists in the OS temp dir; reset it by deleting `agent-os-ext-profile-reeflect` there.
- lint (i18n key coverage): `npm run lint:i18n` — the checker lives in the gitignored `.local/`, so it only runs on a machine that has it.
- doc budgets: `node scripts/os/doc-lint.mjs --changed`
- test: `node scripts/os/enforce-smoke.mjs` (6: seeded usage, DNR rule, tab redirect, badge) · `dashboard-smoke.mjs` (13, two devices) · `sync-smoke.mjs` (26, two Chromium profiles) · `sync-paused.mjs` (7, server-paused path). The sync ones need the server on 127.0.0.1:8787 and skip otherwise.
- dev server: none, no build or serve step.
- deploy: `assemble.mjs --copy`, zip `dist/extension/`, upload to the Chrome Web Store (the tag workflow does the same).

## Core (changes here are [core] tier — decision gate applies)
- `extension/src/background/intervalTracker.js` and `intervalTrackingUtils.js` — presence and range logic; overcounting bugs start here.
- `extension/src/data/intervalLog.js` — the stored row shape. Every derived total comes from the core's `Dashboard` through `intervalAggregates.js`.
- `extension/src/background/enforcement.js` — flattens the core's verdict and publishes the blocking rules. Limit maths, read window and rule coverage are the core's; turning a tab into a resource, and acting on it, stays here.
- `extension/src/data/syncStorage.js` and the sync fields in `intervalLog.js` — a wrong dirty flag or missed delete queue is silent divergence between devices.
