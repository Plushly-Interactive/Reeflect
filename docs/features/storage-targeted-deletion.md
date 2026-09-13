# Targeted deletion

TL;DR: a date-range deletion section on the storage page that removes every record inside an arbitrary datetime window, optionally scoped to one site.

Pruning until now was global — it removed records by insignificance across all sites at once. A navigation button on `site.html` links here with the site pre-filled.

## User stories

- As a user, I want to delete all data for a specific site so that I can remove
  sensitive browsing history without wiping everything else.
- As a user, I want to delete all records within a date range so that I can shed
  an arbitrary window of history without touching other dates.

## Acceptance criteria

- [ ] `site.html` has a "Delete data…" button in `#header-right` that navigates
      to `storage-pruning.html?site=<siteId>`, hidden on the merged site view.
- [ ] The storage-pruning page has a "Delete by date range" section below the
      existing threshold-scan section.
- [ ] The section has an optional site filter input pre-filled from the `?site`
      URL parameter; the user can clear or change it.
- [ ] When arriving via `?site`, the page scrolls the range-delete section into view.
- [ ] The range-delete form has a "Repeat daily" toggle. When off (default): a
      single contiguous datetime range — "From" and "To" controls, each with a date
      input and an hour selector (0–23). When on: separate date-range inputs
      (From date / To date) and separate hour-window inputs (From hour / To hour),
      with the hour window applied independently to each day in the date range.
- [ ] The delete button is disabled until both date fields are filled and the from
      datetime is not later than the to datetime. In repeat mode an additional
      check applies: from-hour must be ≤ to-hour (a backwards hour window would
      match nothing regardless of the date span).
- [ ] Clicking the delete button shows a confirmation dialog (using the existing
      `confirmDialog`) naming the scope (date range and/or site) before proceeding.
- [ ] Confirming range deletion:
      - deletes hourly buckets whose `YYYY-MM-DDTHH` key falls within
        `[fromHourKey, toHourKey]`, filtered to the specified `siteId` if one is set
      - reduces (not deletes) the corresponding daily buckets by the exact
        `activeMs`/`audioMs`/`overlapMs`/`idleMs` amounts removed from the
        hourly store (`visits` is left unchanged in the daily store);
        a daily entry is only removed if it reaches zero
      - for each day where all 24 hours (T00–T23) fall within the range, the
        daily entry is deleted outright rather than reduced (the whole day bucket
        if no site filter is set; only the siteId entry within it if one is set);
        partial days at the start or end of a multi-day range still use the
        reduce path
- [ ] When a site filter is active, a "Delete all data for [site]" button is shown
      independently of the date range controls. It shows its own confirmation dialog
      and deletes all entries for that siteId across all time from all four stores.
- [ ] After any deletion, `invalidateSitesCache` is called and the storage bar
      refreshes.
- [ ] After any deletion, a `showNotification` message shows the size of data freed
      (formatted bytes, computed via `getBytesInUse` before and after, same as the
      existing prune flow).

## Scope

### Surfaces involved

| Surface | Role |
|---|---|
| `site.html` | Navigation button in `#header-right` linking to storage-pruning with `?site=` |
| `site.js` | Wire the button via `navButton` |
| `storage-pruning.html` | New `<section id="range-delete">` after `#results-section` |
| `storage-pruning.js` | Read `?site` param; wire site filter, range inputs, and delete button |
| `prune.js` | Unchanged |
| `targetedDelete.js` (new) | Six exports: four range helpers + `deleteSiteAllTime`, `deleteSubpageSiteAllTime` |

### Files and helpers

- `extension/src/data/targetedDelete.js` holds the range-deletion helpers. Site and subpage stores nest differently, so each has its own pair: one that deletes matching hourly entries and returns a reductions map, and one that subtracts those reductions from the daily store.
- Reductions subtract `activeMs`, `audioMs`, `overlapMs` and `idleMs`, clamped at zero. `visits` is never touched. An entry is removed once all four time fields reach zero, and empty parent buckets are pruned.
- `deleteSiteAllTime` and `deleteSubpageSiteAllTime` back "delete all data for site" across both store pairs.
- Full signatures, per-file changes and the storage matrix: [appendix](../appendix/storage-targeted-deletion-implementation.md).

## Edge cases

- **Merged site view** (`?ids=…`): the navigation button is hidden, same as
  "Limit this site" today.
- **Range with no matching data**: delete runs against empty buckets;
  `showNotification` fires with "0 bytes freed."
- **From datetime > To datetime**: delete button stays disabled.
- **Partial-day hour range on daily stores**: if the user deletes e.g.
  `2026-05-01 T09` to `2026-05-01 T17`, the `2026-05-01` daily bucket is
  *reduced* by the sum of the removed hourly values, not deleted. The daily
  aggregate stays accurate for the hours outside the range.
- **Repeat mode, single day (fromDate === toDate)**: equivalent to a normal
  partial-day range deletion on that one day.
- **Repeat mode, hour window 00–23**: equivalent to full-day deletion for each
  day in the range; the full-day shortcut (delete outright) still applies.
- **"Delete all data for site" with no site filter active**: button is not shown;
  a siteId is required for this action.
- **Store inconsistency / negative values**: if hourly and daily stores are
  slightly out of sync (e.g. hourly data was partially pruned earlier), subtracting
  hourly sums from daily values could underflow. All reduced fields are clamped to
  ≥ 0 before writing back.
- **Site currently being tracked**: deletion removes persisted records only;
  the in-memory snapshot is unaffected. The next flush writes fresh data from
  that point forward.

## Out of scope (v1)

- Undo / restore after deletion.
- Preview of affected records before confirming range deletion.

## Housekeeping

Before or after implementing, rename `extension/src/data/prune.js` →
`extension/src/data/insignificantPrune.js` for clarity now that `targetedDelete.js` sits
alongside it. The storage-pruning page keeps its name — it is the single home for
all storage management tools and will grow further.
