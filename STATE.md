# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified. Windows: tracker and shield verified live.

## Recent (newest first, keep last 5)
- 2026-10-01: Windows: `win.rs` tracker with idle rows, shield, tray, start at login; desktop rules.
- 2026-09-29: "Icons for every site" toggle; same-named rows share a real icon.
- 2026-09-28: app rows carry their launcher label through sync; timeline merges by name.

## Handoff
- Stopped at: Windows steps 1–3 uncommitted; block, Win+L, sleep gap checked live; Store app names unverified.
- Next step: check Snipping Tool's name; commit. Linux and macOS need hardware.
- Verify on resume: `assemble.mjs --app`, `npx tauri dev --no-watch`, the smokes.

## Open questions
- `ownRow` drops `source`/`label` on a cut phone row (pre-existing).
- `resolveFavicons`'s Chrome-globe byte signature is version-specific; a Chrome update may silently stop it swapping (Chrome's globe just returns).
- `path` view throws `null.split` without `ids` (pre-existing).
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
