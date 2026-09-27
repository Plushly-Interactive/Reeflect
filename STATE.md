# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified.

## Recent (newest first, keep last 5)
- 2026-09-27: keyword and regex rules cover apps too (pattern vs `https://<package>`); shield asks `matchesRule`.
- 2026-09-27: rules hold apps and sites together (Apps & sites picker, optional name); pulled app rows keep `source`. `enforce-smoke` 16/16.
- 2026-09-23: Android app rules block again; blocked page stays until left. Emulator-checked.

## Handoff
- Stopped at: combined rules built, uncommitted; the APK not run on a device.
- Next step: install the debug APK, add an app rule from the picker; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
