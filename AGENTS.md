# Reeflect

TL;DR: Vivaldi/Chromium MV3 extension that tracks per-site browsing time and blocks sites past a limit. Read STATE.md for where work stands, and follow the global agent-os rules.

## Map (hot files)
- `manifest.json` — MV3 manifest at repo root; the extension loads unpacked, no build step.
- `src/background/` — service worker. `intervalTracker.js` (presence ranges), `enforcement.js` (asks the core for the verdict, publishes the blocking rules), `background.js` (alarms, events), `badge.js` (the core's usage for the active site).
- `src/data/` — storage layer. `intervalLog.js` (IndexedDB rows), `intervalAggregates.js` (read-time totals), import/export/prune.
- `src/pages/<name>/` — one `<name>.{html,css,js}` triplet per full-page view.
- `src/shared/` — cross-page UI and helpers (`theme.css`, `dropdown.js`, `i18n.js`, `prefKeys.js`).
- The vendored core (`src/vendor/reeflect-core/`) is loaded once through `src/shared/core.js`, which also builds the `Time` snapshot. Cloud sync: `src/shared/syncClient.js` owns every account action; `src/background/sync.js` is only the alarm; `src/data/syncStorage.js` is the storage host; `intervalLog.js` owns the v2 schema (deviceId, localId, dirty, mirror, deletes, meta); `src/pages/sync/` is the UI.
- `_locales/{en,es,fr}/messages.json` — every user-facing string; en is the source of truth.
- `docs/architecture/architecture.md` — how tracking and enforcement fit together.

## Conventions (reuse before create — working rule 6)
Every code rule lives in one file, loaded together with this one: @docs/conventions.md
The reasoning behind the longer rules is in `docs/appendix/coding-conventions.md` — reference, not required reading.

## Commands
- capture: `node scripts/os/capture.mjs --view <name> [--seed] [--width N] [--measure "sel"] [--console]`
  - Views: dashboard, site, path, timeline, rules, settings, sync, popup, blocked, quotes, storage, legacy.
  - Launches its own Chromium with the unpacked extension; screenshots land in `shots/`.
  - `--seed` fills the profile with fake browsing data, so data-driven pages are not empty.
  - The profile persists in the OS temp dir; reset it by deleting `agent-os-ext-profile-reeflect` there.
- lint (i18n key coverage): `npm run lint:i18n` — the checker lives in the gitignored `.local/`, so it only runs on a machine that has it.
- doc budgets: `node scripts/os/doc-lint.mjs --changed`
- test: `node scripts/os/enforce-smoke.mjs` (6 checks: seeded usage, DNR rule, tab redirect, badge; no server) · `node scripts/os/sync-smoke.mjs` (26, two Chromium profiles through the sync page) · `node scripts/os/sync-paused.mjs` (7, the server-paused path). The sync ones need the sync server on 127.0.0.1:8787 and skip otherwise.
- dev server: none — `scripts/os/dev.mjs` is unused here, the extension has no build or serve step.
- deploy: manual — zip the repo root and upload to the Chrome Web Store listing.

## Core (changes here are [core] tier — decision gate applies)
- `src/background/intervalTracker.js` and `intervalTrackingUtils.js` — presence and range logic; overcounting bugs start here.
- `src/data/intervalLog.js` and `intervalAggregates.js` — the stored row shape and every derived total.
- `src/background/enforcement.js` — flattens the core's verdict and publishes the blocking rules. Limit maths, read window and rule coverage are the core's; turning a tab into a resource, and acting on it, stays here.
- `src/data/syncStorage.js` and the sync fields in `intervalLog.js` — a wrong dirty flag or missed delete queue is silent divergence between devices.
