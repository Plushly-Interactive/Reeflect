# STATE

Now: branch `reeflect-sync` — sync shipped in 1.4.0; verdict, read window, rule coverage and badge all come from the vendored core.

## Recent (newest first, keep last 5)
- 2026-09-11: one sync tick per browser (Web Lock); walk-repair core vendored / smokes 6, 26, 7.
- 2026-09-09: read window and rule coverage on the core / `enforce-smoke.mjs` (6).
- 2026-09-06: verdict on the core; `usageSince` deleted.
- 2026-09-06: docs swept: privacy policy covers sync, schema v2, private-repo mentions removed.
- 2026-09-05: live upload progress; shared input component on the phrase inputs.

## Handoff
- Stopped at: sync lock and new vendored core uncommitted; needs the matching server deploy from reeflect-sync.
- Next step: user commits; reload the extension in each browser after the deploy. Open: branch name and `VERSION` naming the private repo.
- Verify on resume: `enforce-smoke.mjs` (6, no server); `sync-smoke.mjs` (26), `sync-paused.mjs` (7) with the server on 127.0.0.1:8787.

## Open questions
- none
