# STATE
Now: `reeflect-sync`. One UI in `ui/`, run by the extension and the Tauri app. Android and Windows: tracker and shield verified live; Android sync too.
## Recent (newest first, keep last 5)
- 11-13: deletion searches sites, app titles and package names across stored history; rules share the candidate loader.
- 11-13: named rules show targets in the rules list and popup.
- 11-13: fixture deletion, unrelated rows, named targets and screenshots pass in Chromium on monitor two.
- 11-13: blocked time uses the core's period and mode; labels in all three languages.
- 11-13: nine period/mode checks and the weekly screenshot pass.

## Handoff
- Stopped at: deletion selector and named targets checked in Chromium; native app untested.
- Next: an end-to-end block on the phone; build and install the Windows app.
- Verify: `cargo test --lib` in `app/src-tauri` (16); the smokes.

## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- `npm run lint:i18n`: `.local/i18n-check.js` reads another repo's path.
