# STATE

Now: branch `reeflect-sync` — sync shipped in 1.4.0; every number comes from the vendored core; the UI lives once in `ui/`, the extension in `extension/`, assembled into `dist/extension/` by links.

## Recent (newest first, keep last 5)
- 2026-09-13: `ui/` + `extension/` → `dist/extension/` by junctions (`assemble.mjs`); `host.js` seam over 144 `chrome.*` sites / smokes 6, 13, 26, 7.
- 2026-09-12: dashboard totals on the core; device picker on four pages.
- 2026-09-11: one sync tick per browser (Web Lock); walk-repair core vendored.
- 2026-09-09: read window and rule coverage on the core.
- 2026-09-06: verdict on the core; `usageSince` deleted.

## Handoff
- Stopped at: folders moved, scripts and docs repointed, smokes green through the junctions; uncommitted.
- Next step: user commits; load unpacked from `dist/extension/` in Vivaldi; then `app/` (Tauri 2, `tauri android init`) with the Tauri `host.js` and the data-layer twin.
- Verify on resume: `node scripts/os/assemble.mjs`, then the four smokes (sync ones need the server on 127.0.0.1:8787).

## Open questions
- `path` view throws `null.split` when opened without `ids` (pre-existing, capture only).
