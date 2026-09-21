# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: identifier `app.reeflect`; APK builds, untested on a phone.
- 2026-09-21: root README.md; `npm run android:release`, `android:debug`; signing.
- 2026-09-21: AGENTS.md states rules, not listings; conventions.md adds the phone header.
- 2026-09-21: pages paint from a saved build (0.5 s, was 3 s at 111K rows), app too; app bridge replies in raw bytes.
- 2026-09-21: phone-width pass (viewport meta, bottom nav, ⋮ menu); overview card per period; bulk row read, loading blocks.

## Handoff
- Stopped at: the two doc files staged, committed; `enforce` and `dashboard` smokes pass; Android padding untested.
- Next step: the sync smokes need the server started; then reeflect-sync phase 4 or 6.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
