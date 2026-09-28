# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified.

## Recent (newest first, keep last 5)
- 2026-09-28: app rows carry their launcher label through sync; the extension names phone apps.
- 2026-09-27: dashboard keeps finished days: 354 ms at 110K rows.
- 2026-09-27: Android "Websites in browsers" opt-in: address bars of 5 browsers tracked and blocked. Emulator: Chrome.
- 2026-09-27: keyword and regex rules cover apps; the shield asks `matchesRule`.

## Handoff
- Stopped at: synced app labels built (core delivered 2026-09-28), uncommitted; no phone run yet.
- Next step: on a phone, use an app, sync, check the extension names it; check the 4 other browser bars.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `ownRow` drops `source` and `label`: a phone row cut on the extension turns web (pre-existing).
- `path` view throws `null.split` without `ids` (pre-existing).
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
