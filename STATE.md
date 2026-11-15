# STATE
Now: 1.7.0; grouped activity has filters and two bars inside Overview.
## Recent
- 11-15: Storage tools: 4 columns above 1400px, 2 below, 1 at ≤700px; hours ≥97px.
- 11-15: Storage controls wrap; scoped to this page.
- 11-15: Both modes pass at nine widths, 320–1600px.
- 11-15: Four group links became native buttons; removed link CSS; navigation follows selection. 127 checks pass.
- 11-15: App bars show names; tooltips show identifiers. Cached breakdowns announce loading.
- 11-15: 30,003-row check: 442 → 41 ms, zero raw history reads. 95 group checks and dashboard smoke pass.
- 11-15: Both clients reassembled; core libraries current; APK unchanged.
- 11-15: Merged entries support limits and deletion through comma-separated IDs.
## Handoff
- Next: reload the extension; check a grouped entry.
- Prior APK: signature and install checks pass; Poco X6 Pro and 7-minute sleep checks await the owner.
- Git: grouped activity changes committed locally; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
