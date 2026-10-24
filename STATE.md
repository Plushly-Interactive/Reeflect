# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified. Windows: tracker and shield verified live.

## Recent (newest first, keep last 5)
- 2026-10-10: `android:release` copies the APK over `D:\Phone\Reeflect.apk`.
- 2026-10-09: sync off the tracking path, every minute; `syncStorage` deleted 1 row per call (a walk per tick), fixed.
- 2026-10-06: Windows program icons: `win.rs` stores them in `_appIcons`; 16 app tests.

## Handoff
- Stopped at: sync fixes live and verified 10-10 on all 4 devices; Android idle explored only; icons unchecked.
- Next step: none queued. Android idle overlay declined 10-11.
- Verify on resume: `app/src-tauri`: `cargo test --lib` (16); the smokes.

## Open questions
- `ownRow` drops `source`/`label` on a cut phone row (pre-existing).
- `resolveFavicons`'s Chrome-globe byte signature is version-specific; a Chrome update may silently stop it swapping (Chrome's globe just returns).
- `path` view throws `null.split` without `ids` (pre-existing).
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
