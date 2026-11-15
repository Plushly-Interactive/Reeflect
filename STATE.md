# STATE
Now: `reeflect-sync`; group sync backend is live; updated clients use the shared core.
## Recent
- 11-15: Default shows only its name in rule targets, even when it holds saved members.
- 11-15: Named groups keep their member lists in parentheses.
- 11-15: Group documentation matches the Default label exception.
- 11-13: Groups reads a per-day resource summary, kept with the dashboard data; no raw history scan.
- 11-13: pickers and rule rows show group members in parentheses on one line; deletion uses the shared picker list.
- 11-13: groups (51) and dashboard checks pass; square buttons size from text lines.
## Handoff
- Next: reload the extension; production test accounts are removed.
- Native: Windows and Android libraries come from `reeflect-sync/scripts/deliver.mjs`; build and install apps for a live group check.
- Git: uncommitted; earlier group changes remain.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- Run the local i18n checker against `dist/extension`; its root layout expects assembled files.
