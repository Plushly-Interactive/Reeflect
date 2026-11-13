# STATE
Now: `reeflect-sync`; group sync backend is live; updated clients use the shared core.
## Recent
- 11-13: Hide brief returned to the title line; do not move it with the merge controls.
- 11-13: three mobile merge controls stack right-aligned; the first shares the entry-count row.
- 11-13: mobile capture checks both positions; Groups stays beside search.
## Handoff
- Next: reload the extension; production test accounts are removed.
- Native: Windows and Android libraries come from `reeflect-sync/scripts/deliver.mjs`; build and install apps for a live group check.
- Git: uncommitted; earlier group changes remain.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
- Run the local i18n checker against `dist/extension`; its root layout expects assembled files.
