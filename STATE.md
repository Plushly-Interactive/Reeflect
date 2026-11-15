# STATE
Now: `reeflect-sync`; group sync is live; clients use the shared core.
## Recent
- 11-15: Group refreshes keep the rule editor, its focus, and unsaved fields.
- 11-15: All 53 group checks pass; phone-width editor checks pass.
- 11-15: Rebuilt APK passes Android 15 editor checks: keyboard, focus, name, and limit.
- 11-13: Groups reads a per-day resource summary, kept with the dashboard data; no raw history scan.
- 11-13: pickers and rule rows show group members in parentheses on one line; deletion uses the shared picker list.
- 11-13: groups (51) and dashboard checks pass; square buttons size from text lines.
## Handoff
- Next: check the rebuilt APK on the Poco X6 Pro (Android 15).
- Native: libraries come from `reeflect-sync/scripts/deliver.mjs`; the APK signature and install checks pass.
- Git: local commits only; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- Run the local i18n checker against `dist/extension`; its root layout expects assembled files.
