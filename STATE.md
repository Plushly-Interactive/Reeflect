# STATE

Now: branch `reeflect-sync` — sync shipped in 1.4.0; every number comes from the vendored core; pages touch the platform only through `src/shared/host.js`.

## Recent (newest first, keep last 5)
- 2026-09-13: `host.js` seam: 144 `chrome.*` sites in pages, shared and data rewritten; core vendored at 368316c / smokes 6, 13, 26, 7.
- 2026-09-12: dashboard totals on the core; device picker on four pages / `dashboard-smoke.mjs` (13).
- 2026-09-11: one sync tick per browser (Web Lock); walk-repair core vendored.
- 2026-09-09: read window and rule coverage on the core / `enforce-smoke.mjs` (6).
- 2026-09-06: verdict on the core; `usageSince` deleted.

## Handoff
- Stopped at: host seam done and smoke-tested, uncommitted with the vendored core.
- Next step: user commits; then the monorepo layout (`extension/`, `ui/`, `app/`, `vendor/`) with a build folder for load-unpacked and the store zip; then `tauri android init` in `app/`.
- Verify on resume: the four smokes (sync ones need the server on 127.0.0.1:8787); `capture.mjs --view <name> --console` for any page.

## Open questions
- `path` view throws `null.split` when opened without `ids` (pre-existing, capture only).
