# STATE

Now: branch `reeflect-sync` — sync shipped in 1.4.0; verdict, read window, rule coverage and badge all come from the vendored core.

## Recent (newest first, keep last 5)
- 2026-09-09: read window and rule coverage on the core; `enforcementWindowStart` and `pathUnder` deleted / `enforce-smoke.mjs` (6, proves the tab redirect).
- 2026-09-06: verdict on the core; `enforcement.js` flattens and publishes, `badge.js` asks the core, `usageSince` deleted.
- 2026-09-06: docs swept against the code: privacy policy covers optional sync, schema v2 in three docs, private-repo mentions removed.
- 2026-09-05: live upload progress instead of a frozen page; shared input component on the phrase inputs.

## Handoff
- Stopped at: window and matcher cutover uncommitted. The blocked page's "time on this site" stays JS over the dashboard aggregate, by design.
- Next step: user commits; then UX work in a fresh conversation. Open: branch name and `VERSION` naming the private repo.
- Verify on resume: `enforce-smoke.mjs` (6, no server); `sync-smoke.mjs` (26), `sync-paused.mjs` (7) with the server on 127.0.0.1:8787.

## Open questions
- none
