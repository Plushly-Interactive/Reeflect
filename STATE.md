# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified.

## Recent (newest first, keep last 5)
- 2026-09-27: dashboard keeps finished days, rebuilds from the earliest change: 354 ms at 110K rows; blocked page ~150 ms.
- 2026-09-27: Android "Websites in browsers" opt-in: address bars of 5 browsers tracked and blocked. Emulator: Chrome.
- 2026-09-27: keyword and regex rules cover apps too (pattern vs `https://<package>`); shield asks `matchesRule`.
- 2026-09-27: rules hold apps and sites together (Apps & sites picker, optional name); pulled app rows keep `source`. `enforce-smoke` 16/16.

## Handoff
- Stopped at: web shield done, uncommitted.
- Next step: on a phone, check Brave, Vivaldi, DuckDuckGo, Firefox bars.
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
