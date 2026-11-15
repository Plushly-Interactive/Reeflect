# STATE
Now: 1.7.0; grouped activity has filters and two bars inside Overview.
## Recent
- 11-15: App segments show formatted names; identifiers stay in tooltips with shared chart hints. Cached breakdowns announce loading.
- 11-15: 30,003-row check: 442 → 41 ms, zero raw history reads. 95 group checks and dashboard smoke pass.
- 11-15: Both clients reassembled for app names on bars; core libraries stay current. APK stays at the previous build.
- 11-15: Merged entries support limits and deletion through comma-separated IDs.
- 11-15: `rolling7` ("7 days") passes enforce smoke.
- 11-15: Wake and live gap checks pass 16 tracker tests, 4 sleep cases, and enforce smoke.
- 11-15: Group refreshes keep focus; previous APK passes Android 15 editor checks.
## Handoff
- Next: reload the extension; check a grouped entry.
- Prior APK: signature and install checks pass; Poco X6 Pro and 7-minute sleep checks await the owner.
- Git: grouped activity changes committed locally; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
