# STATE
Now: `reeflect-sync`. One UI in `ui/`, run by the extension and the Tauri app. Android and Windows: tracker and shield verified live; Android sync too.
## Recent (newest first, keep last 5)
- 10-24: a blocked website backs its tab out first, Close returns to the browser; core with case-free keywords vendored.
- 10-24: Android blockers show "stopped" when on but killed; Xiaomi gets an Autostart row.
- 10-24: "Limit this site" on an app builds a program rule; blocked page resets on hide; tray Quit.
- 10-10: `android:release` copies the APK to `D:\Phone\Reeflect.apk`.
- 10-09: sync runs every minute, off the tracking path; `syncStorage` deletes every row.

## Handoff
- Stopped at: 10-24 fixes uncommitted, checked on the phone APK and the desktop dev build.
- Next: an end-to-end block on the phone; build and install the Windows app.
- Verify: `cargo test --lib` in `app/src-tauri` (16); the smokes.

## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- `npm run lint:i18n`: `.local/i18n-check.js` reads another repo's path.
