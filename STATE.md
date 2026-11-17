# STATE
Now: 1.7.0; grouped activity has filters and two bars inside Overview.
## Recent
- 11-17: Removed the single-site gate; Overview shows one device on individual website and app pages too.
- 11-17: 132 browser checks pass; single-site reproduction passes. Desktop and phone screenshots checked.
- 11-17: Group docs cover individual pages. App runtime unverified.
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
