# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-14: nothing twice: `rowStore.js`, `syncClient.js`, `intervalAggregates.js` shared over `coreCall`; Android logic in Rust, Kotlin plumbing; the shield opens the shared blocked page.
- 2026-09-13: `app/`: Tauri 2 on the shared core session.
- 2026-09-13: `ui/` + `extension/` → `dist/extension/` by junctions; `host.js` seam.
- 2026-09-12: dashboard totals on the core; device picker on four pages.
- 2026-09-11: one sync tick per browser (Web Lock).

## Handoff
- Stopped at: identifier `reeflect.app`; the shield's route is a Rust static (a Tauri plugin-lock deadlock fixed); emulator green; uncommitted.
- Next step: user commits; phone-width pass; DEK keystore wrap; Play listing.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the four smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
