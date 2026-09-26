# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified.

## Recent (newest first, keep last 5)
- 2026-09-23: Android: app rules block again (`addRule()` dropped `source`); blocked page over the app until left; plugin calls async (deadlock). Emulator-checked.
- 2026-09-21: Android asks for its three permissions first — `permissionIntro.js`, swiped panels before the tour, dashboard subheader while one is missing. Not seen on a phone.
- 2026-09-21: the app starts the tour on first launch; `.modal-dialog` centers on the viewport.

## Handoff
- Stopped at: today's Android fixes staged, unbuilt.
- Next step: build the APK, check today's fixes and the permission intro panels; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
