# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: Android asks for its three permissions first — `permissionIntro.js`, swiped panels ahead of the tour, plus a dashboard subheader while one is missing. Not seen on a phone.
- 2026-09-21: the app starts the tour on first launch; `.modal-dialog` centers on the viewport.
- 2026-09-21: desktop titlebar; the page header moves into it above 700px; checked in the app.

## Handoff
- Stopped at: the permission intro screen, unstaged; the APK needs a rebuild for it and for the tour fix.
- Next step: build the APK and walk the three panels on a phone; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
