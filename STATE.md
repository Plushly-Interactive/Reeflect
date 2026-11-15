# STATE
Now: 1.7.0; grouped activity has filters and two bars inside Overview.
## Recent
- 11-15: Settings theme list floats over its card; the popup-only `#theme-menu` rule skips dropdown lists.
- 11-15: Popup theme list keeps its original font; button-font inheritance applies only to shared dropdowns.
- 11-15: Bars keep colors on hover, 8px label padding, no shadows, and the 7% cutoff.
- 11-15: Apps & sites uses saved group app names; 129 group checks pass.
- 11-15: Storage tools: 4 columns above 1400px, 2 below, 1 at ≤700px; hours ≥97px.
- 11-15: Four group links became native buttons; removed link CSS; navigation follows selection. 127 checks pass.
- 11-15: App bars show names; tooltips show identifiers. Cached breakdowns announce loading.
## Handoff
- Next: reload the extension; check a grouped entry.
- Prior APK: signature and install checks pass; Poco X6 Pro and 7-minute sleep checks await the owner.
- Git: grouped activity changes committed locally; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
