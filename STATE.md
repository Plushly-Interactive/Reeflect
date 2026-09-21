# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: the app starts the tour on first launch (`host.features.installEvent`); `.modal-dialog` centers on the viewport; sync's phrase grid drops the 560px breakpoint.
- 2026-09-21: desktop titlebar from Leitscape; the page header moves into it above 700px; checked in the app.
- 2026-09-21: app icons (desktop, Android adaptive) from the extension `icon.svg`; not seen in a build.
- 2026-09-21: identifier `app.reeflect`; APK builds, untested on a phone.

## Handoff
- Stopped at: first-launch tour and titlebar, unstaged; the APK needs a rebuild for the tour fix.
- Next step: the sync smokes need the server started; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
