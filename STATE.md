# STATE
Now: `reeflect-sync`; group sync is live; clients use the shared core.
## Recent
- 11-15: Rule period `rolling7` ("7 days"); enforce smoke passes.
- 11-15: Windows idle after sleep starts at the wake; 16 tracker tests pass.
- 11-15: The 5-minute gap rule also runs live; 4 sleep cases and enforce smoke pass.
- 11-15: Group refreshes keep the rule editor's focus and fields; 53 group checks pass.
- 11-15: Rebuilt APK passes Android 15 editor checks: keyboard, focus, name, and limit.
## Handoff
- Next: install both builds, sleep 7 min, check no row spans the sleep.
- Next: check the rebuilt APK on the Poco X6 Pro (Android 15).
- Native: libraries come from `reeflect-sync/scripts/deliver.mjs`; the APK signature and install checks pass.
- Git: local commits only; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- Run the local i18n checker against `dist/extension`; its root layout expects assembled files.
