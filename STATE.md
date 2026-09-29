# STATE

Now: branch `reeflect-sync` — the UI lives once in `ui/`; extension and Tauri app run it. Android: live tracker, app rules, shield, sync verified.

## Recent (newest first, keep last 5)
- 2026-09-29: settings toggle requests <all_urls> for every site's icon, not just ruled ones; same-named rows share a real icon; themed glyphs; Chrome's globe swaps to ours.
- 2026-09-28: app rows carry their launcher label through sync; timeline merges by name.

## Handoff
- Stopped at: "Icons for every site" settings toggle added; uncommitted; grant/revoke flow unverified (needs a real click, native Chrome prompt).
- Next step: on a phone, use an app, sync, check the extension names and icons it; check the 4 other browser bars.
- Verify on resume: `assemble.mjs --app`, `npx tauri dev --no-watch`, the smokes.

## Open questions
- `ownRow` drops `source`/`label` on a cut phone row (pre-existing).
- `resolveFavicons`'s Chrome-globe byte signature is version-specific; a Chrome update may silently stop it swapping (Chrome's globe just returns).
- `path` view throws `null.split` without `ids` (pre-existing).
- `npm run lint:i18n` is broken: `.local/i18n-check.js` reads another repo's path.
