# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; the extension and the Tauri app run it. Android: live tracker, app rules, shield and sync verified.

## Recent (newest first, keep last 5)
- 2026-09-21: phone-width pass: viewport meta, bottom nav, ⋮ header menu; dashboard overview card per period.
- 2026-09-18: the device picker stops re-fetching the registry forever for a merged-away device.
- 2026-09-14: sync progress bar on every page; runs belong to the host.
- 2026-09-14: sync page: merge a device (a reinstall's history moves under this one); `coreCall` serialized.
- 2026-09-14: Android done: keystore-wrapped key (Rust over JNI); phone-width pass.

## Handoff
- Stopped at: phone-width pass captured at 360-460px; Android padding untested on a device; uncommitted.
- Next step: user checks the APK, commits; then reeflect-sync phase 4 (desktop tracker) or 6 (rules sync).
- Verify on resume: `assemble.mjs --app`, `cd app && npx tauri dev --no-watch`; the four smokes.

## Open questions
- `path` view throws `null.split` without `ids` (pre-existing).
- `app/web/shared/syncClient.js` duplicates the extension's; merge once `core.js` has one call shape.
