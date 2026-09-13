# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app (`app/`) run it, the app on the native core.

## Recent (newest first, keep last 5)
- 2026-09-13: `app/`: Tauri 2 backend loads the prebuilt core; dashboard renders seeded rows on Windows (captured).
- 2026-09-13: `ui/` + `extension/` → `dist/extension/` by junctions; `host.js` seam / smokes 6, 13, 26, 7.
- 2026-09-12: dashboard totals on the core; device picker on four pages.
- 2026-09-11: one sync tick per browser (Web Lock).
- 2026-09-09: read window and rule coverage on the core.

## Handoff
- Stopped at: app dashboard verified via `?seed` (646 CSS px wide on this 200% display); uncommitted. Seed rows stay in the app data dir.
- Next step: user commits; `npx tauri android init`, `.so` into jniLibs, APK on the emulator; then the Kotlin UsageStats tracker.
- Verify on resume: `node scripts/os/assemble.mjs --app && cd app && npx tauri dev --no-watch`; the four extension smokes.

## Open questions
- `path` view throws `null.split` when opened without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` exposes one call shape on both.
