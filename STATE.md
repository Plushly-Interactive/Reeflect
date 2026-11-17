# STATE
Now: 1.7.0; grouped activity has filters and two bars inside Overview.
## Recent
- 11-17: Single-site device bars pass at 390px and 1280px; screenshots checked.
- 11-17: 144 browser checks pass, including bar bounds, tooltips, and device clicks.
- 11-17: App UI assembled; site.js matches shared UI. Native app runtime unverified.
- 11-15: Blockers put `overBy`/`visits` in the blocked link; page shows stats 77–157 ms after opening, no core call. 31 smoke checks pass. App unverified.
- 11-15: App rolling7 release used UTC days (no offsets with a moved clock); blocked.js now sends `buildTime` offsets. App unverified.
## Handoff
- Next: rebuild both apps (`npm run android:debug`); open a blocked app; check the stats.
- Prior APK: signature and install checks pass; Poco X6 Pro and 7-minute sleep checks await the owner.
- Git: grouped activity changes committed locally; no push.
## Open questions
- `ownRow` drops `source`/`label` on a cut phone row.
- `resolveFavicons` matches Chrome's globe by bytes; a Chrome update can break the swap.
- `path` view throws `null.split` without `ids`.
