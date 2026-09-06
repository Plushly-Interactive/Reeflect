# STATE

Now: branch `reeflect-sync` — cloud sync shipped in 1.4.0, live for a real profile, committed. No passphrase; key at rest in storage.local.

## Recent (newest first, keep last 5)
- 2026-09-06: docs swept against the code: privacy policy covers optional sync, schema v2 in three docs, private-repo mentions removed.
- 2026-09-05: a server-paused sync shows a resume time, never the reason, on every path; `sync-paused.mjs` (7 checks).
- 2026-09-05: live upload progress instead of a frozen page; shared input component on the phrase inputs.
- 2026-09-05: signed-out device can start a fresh account; sync UI, 61 strings in 3 locales, manifest 1.4.0; smoke 26 checks.
- 2026-09-05: cloud-sync host / intervalLog v2, syncStorage.js, CSP for wasm, vendored core.

## Handoff
- Stopped at: docs sweep uncommitted. Privacy policy dated 2026-09-06; the hosting provider is deliberately unnamed, a legal call.
- Next step: user commits; decide whether the branch name and the vendored `VERSION` stamp may name the private repo.
- Verify on resume: `scripts/os/sync-smoke.mjs` (26) and `sync-paused.mjs` (7) with the sync server on 127.0.0.1:8787.

## Open questions
- none
