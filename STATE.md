# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: desktop titlebar copied from Leitscape; the page header moves into it above 700px; drag, buttons and picker checked in the app.
- 2026-09-21: app icons (desktop, Android adaptive) from the extension `icon.svg`; not seen in a build.
- 2026-09-21: identifier `app.reeflect`; APK builds, untested on a phone.
- 2026-09-21: root README.md; `npm run android:release`, `android:debug`; signing.
- 2026-09-21: AGENTS.md states rules, not listings; conventions.md adds the phone header.

## Handoff
- Stopped at: the desktop titlebar, unstaged; below 700px the page header comes back with its phone layout.
- Next step: the sync smokes need the server started; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
