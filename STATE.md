# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-14: Android done: keystore-wrapped key (Rust over JNI); phone-width pass.
- 2026-09-14: nothing twice: `rowStore.js`, `syncClient.js`, `intervalAggregates.js` shared over `coreCall`; Android logic in Rust, Kotlin plumbing; the shield opens the shared blocked page.
- 2026-09-13: `app/`: Tauri 2 on the shared core session.
- 2026-09-13: `ui/` + `extension/` → `dist/extension/` by junctions; `host.js` seam.
- 2026-09-12: dashboard totals on the core; device picker on four pages.

## Handoff
- Stopped at: Android complete, verified on the emulator; 11 pages captured at 400px; smokes green; uncommitted.
- Next step: user commits; then reeflect-sync phase 4 (desktop tracker) or 6 (rules sync).
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the four smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
