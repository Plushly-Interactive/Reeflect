# STATE

Now: branch `reeflect-sync` — sync shipped in 1.4.0; verdict, read window, rule coverage, badge and every dashboard total come from the vendored core.

## Recent (newest first, keep last 5)
- 2026-09-12: dashboard totals on the core; device picker on four pages; tooltip names devices / `dashboard-smoke.mjs` (13).
- 2026-09-11: one sync tick per browser (Web Lock); walk-repair core vendored / smokes 6, 26, 7.
- 2026-09-09: read window and rule coverage on the core / `enforce-smoke.mjs` (6).
- 2026-09-06: verdict on the core; `usageSince` deleted.
- 2026-09-06: docs swept: privacy policy covers sync, schema v2, private-repo mentions removed.

## Handoff
- Stopped at: device filter built and smoke-tested, uncommitted; vendored core is `cc2b80f (dirty)`, redeliver after reeflect-sync commits.
- Next step: user commits both repos; redeliver for a clean VERSION; reload the extension. Open: changelog entry and version bump.
- Verify on resume: `dashboard-smoke.mjs` (13) and `enforce-smoke.mjs` (6, no server); `sync-smoke.mjs` (26), `sync-paused.mjs` (7) with the server on 127.0.0.1:8787.

## Open questions
- none
