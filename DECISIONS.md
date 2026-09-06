# DECISIONS

TL;DR: consequential choices, newest first, ≤5 lines each. Format: Date · Decision · Why · Rejected · Consequence.

2026-09-05 · No passphrase: the data key rests in storage.local, and sync setup asks only for the 24 words
Why: the key-in-memory rule came from products whose local store is encrypted; the interval log here is plain text on disk and already mirrors every device, so the rule protected nothing while costing an unlock at every browser start.
Rejected: keeping the passphrase for a Lock button nobody asked for; a hidden machine passphrase (the same thing with extra steps).
Consequence: no Locked state in the UI; the core keeps `unlock` and the protocol keeps the passphrase optional for a future client that stores no plaintext (a hosted dashboard, where the operator serves the JS, so a weaker guarantee).

2026-09-05 · Cloud sync is a page (`src/pages/sync/`), not a settings card; engine glue lives in `src/shared/syncClient.js`
Why: five states (off, phrase, confirm, link, on with devices) do not fit one card; pages talk to storage directly by convention, so the page runs the engine itself and the service worker keeps only the alarm.
Rejected: routing account actions through the service worker; a native `prompt()` for renaming (used nowhere else — renaming edits inline).
Consequence: `background/sync.js` is 35 lines; the smoke drives the real page, so the UI is covered too; `.form-row` was not reused since it lives in the rules stylesheet this page does not load.

2026-09-05 · Sync fields live on the interval rows themselves; mirror rows share the table; deletes queue on every delete path
Why: one transaction per change keeps row and sync state consistent; readers count all devices with no change; a delete that skips the queue would be resurrected by reconciliation.
Rejected: a separate sync database; editing another device's row in place (only its device may push it — a truncated mirror becomes delete + own row); routing account operations through the service worker (pages can run the engine themselves).
Consequence: Dexie v2 upgrade backfills every row once; `clearAll` is local-only (the server copy stays); the server address is a hidden `_syncBaseUrl` override over a fixed default; `manifest.json` gains `wasm-unsafe-eval`, the only CSP change.

2026-09-05 · Cloud sync is developed outside this repo; this repo is the extension only
Why: the server, the shared Rust core and their docs are one product with their own toolchain and hosting account; the extension is one client and must stay loadable unpacked with no build step.
Rejected: keeping the core in this repo (build step, Rust toolchain on every clone); a JS sync client built first and replaced by the core later (throwaway work).
Consequence: this repo will vendor the built WASM core under src/vendor/; roadmap, crypto contract and core spec live outside this repo; docs/features/cloud-sync.md is a pointer.

2026-09-04 · The app is renamed CoralClock → Reeflect before cloud sync starts
Why: the name must be final before the crypto domain strings (`reeflect/…/v1`) and the server are built; renaming later would mean a key migration.
Rejected: keeping `coralclock/` in the crypto contract under the new name (confusing forever, no benefit); a partial rename leaving docs or the privacy policy on the old name.
Consequence: manifest 1.3.0 with a changelog entry; the settings changelog link points at github.com/Plushly-Interactive/Reeflect and breaks until the repo is renamed; logo artwork is unchanged.

2026-09-04 · Screenshots come from Playwright loading the unpacked extension
Why: the project has no dev server, so a browser launched by the capture script is the only way an agent can see a page.
Rejected: manual-only testing (agent cannot verify visual changes); a headless page served over http (extension APIs would be missing).
Consequence: adds a package.json and a ~115 MB Chromium download; every capture starts from an empty profile, so pages show "no data" unless seeded.

2026-09-04 · Capture setup steps live in capture.config.mjs, not in the backend
Why: suppressing first-run overlays and seeding data are project facts; keeping the backend generic lets agent-os sync it.
Rejected: a Reeflect-only backend (drifts from the shared one, never gets fixes).
Consequence: the backend file must stay identical to the agent-os copy; project setup goes in the config's prepare list.

2026-09-04 · Finished and rejected specs move to docs/appendix/ whole, live specs keep only their reference half
Why: 24 of 30 docs were over budget; most of the weight was build-order logs and per-file change tables nobody reads twice.
Rejected: raising the budgets (hides the cost); deleting the history (loses the reasoning).
Consequence: 58.8k tokens of docs became 23.4k outside the appendix, nothing deleted. docs/architecture/tracking-internals.md was found stale — it describes a deleted src/tracking.js — and is now marked as such in the appendix.
