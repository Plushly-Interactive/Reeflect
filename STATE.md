# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: pages paint from a saved build (0.5 s, was 3 s at 111K rows), app too; app bridge replies in raw bytes.
- 2026-09-21: phone-width pass (viewport meta, bottom nav, ⋮ menu); overview card per period; bulk row read, loading blocks.
- 2026-09-18: the device picker stops re-fetching the registry forever for a merged-away device.
- 2026-09-14: sync progress bar on every page; runs belong to the host.
- 2026-09-14: sync page: merge a device (a reinstall's history moves under this one); `coreCall` serialized.

## Handoff
- Stopped at: saved dashboard build, uncommitted; Android padding and the sync smokes untested.
- Next step: user runs the sync smokes, commits; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the four smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
