# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app (`app/`) run it, the app on the native core.

## Recent (newest first, keep last 5)
- 2026-09-13: `app/`: Tauri 2 on the shared core session; Android tracker (usage history → `rows.append`) verified on the emulator.
- 2026-09-13: `ui/` + `extension/` → `dist/extension/` by junctions; `host.js` seam / smokes 6, 13, 26, 7.
- 2026-09-12: dashboard totals on the core; device picker on four pages.
- 2026-09-11: one sync tick per browser (Web Lock).
- 2026-09-09: read window and coverage on the core.

## Handoff
- Stopped at: tracker verified (WorkManager 15 min + poll on open); uncommitted.
- Next step: user commits; settings card for usage access (`plugin:tracker|status`); phone-width layout; the Accessibility shield.
- Verify on resume: `assemble.mjs --app && cd app && npx tauri dev --no-watch`; the four smokes. The headless emulator paints white: inspect via DevTools.

## Open questions
- `path` view throws `null.split` when opened without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
