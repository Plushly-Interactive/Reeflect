# Data health

TL;DR: the data health card on the storage management page checks the four tracking stores for consistency problems that build up silently, and a repair overlay reconciles them in one confirmed action.

It looks for drift between hourly and daily aggregates (mostly caused by targeted deletion), orphaned records, future-dated keys, and invalid field values.

## User stories

- As a user, I want to see at a glance whether my tracking data is
  internally consistent so that I know my history is reliable.
- As a user, I want to review the specific issues found before repairing
  so that I understand what will change.
- As a user, I want a single confirm to fix all issues so that
  reconciliation is low-effort.

## Acceptance criteria

- [ ] The health card is populated on storage management page load; no
      separate scan trigger is needed.
- [ ] When no issues are found the card shows a green dot and
      "All checks passed".
- [ ] When issues are found the card shows a non-green dot and a summary
      line: "N issues found — [comma-separated issue type names]".
- [ ] The Repair button is shown only when at least one issue is detected.
- [ ] Clicking Repair opens an overlay (same pattern as the scan overlay)
      listing all detected issues grouped by issue type, with a
      "Repair all" confirm button and a cancel/close button in the footer.
- [ ] Each group in the overlay shows the issue type as a heading and a
      table of affected records: site (+ path for subpage stores), date,
      and a one-line description of the discrepancy.
- [ ] Clicking "Repair all" applies every fix, closes the overlay, sends
      `invalidateSitesCache` to the background, re-runs the health check,
      updates the card, and shows a transient notification.
- [ ] If no issues remain after repair the card updates to
      "All checks passed".

### Issue: hourly/daily drift

- [ ] Drift is detected for a `(dayKey, siteId)` pair in the site stores
      when at least one hourly bucket exists for that site on that day
      **and** the sum of `activeMs`, `audioMs`, `overlapMs`, or `idleMs`
      across those buckets differs from the corresponding daily entry.
      `visits` is excluded from the drift check — targeted deletion
      intentionally does not adjust daily visit counts.
- [ ] The same check applies to `(dayKey, siteId, path)` triples in the
      subpage stores.
- [ ] A day with no hourly buckets at all (hourly was pruned) is not
      flagged as drift.
- [ ] Repair: overwrite the daily entry's `activeMs`, `audioMs`,
      `overlapMs`, and `idleMs` with the sum of all hourly buckets for
      that day and site/path. `visits` is not touched.

### Issue: orphaned hourly records

- [ ] An orphan is detected when `sitesByHour[hourKey][siteId]` exists
      but `sitesByDay[dayKey][siteId]` does not (where `dayKey` is the
      date portion of `hourKey`). Same check for subpage stores.
- [ ] A day that has daily data but no hourly (hourly was pruned) is not
      flagged — only the reverse triggers an orphan.
- [ ] Repair: create the missing daily entry by summing all hourly
      buckets for that site/path on that day.

### Issue: future-dated keys

- [ ] A future-dated key is detected when a `dayKey` or `hourKey` in any
      store is strictly after today's local date.
- [ ] Repair: delete the entire bucket at that key from the affected store.

### Issue: invalid field values

- [ ] An invalid value is detected when any `activeMs`, `audioMs`,
      `overlapMs`, or `idleMs` field is `NaN`, `Infinity`, `null`,
      `undefined`, or negative.
- [ ] Repair: clamp the field to `0`. If all four time fields on a record
      are `0` after clamping, delete the record; prune empty parent
      buckets as usual.

## Scope

### Surfaces involved

| Surface | Role |
|---|---|
| Storage management page | Hosts the health card; opens repair overlay on button click |
| `background.js` | Receives `invalidateSitesCache` after repair |

### Files and stores

- `extension/src/data/healthCheck.js` holds `checkHealth(stores)` and `applyRepairs(stores, issues)`; the storage management page wires the check, the repair overlay and the post-repair notification.
- The hourly stores are the source of truth and are never written. Repair overwrites the daily stores only.
- Per-file and per-store detail: [appendix](../appendix/storage-data-health-implementation.md).

## Edge cases

- **Drift and orphan on the same record**: an orphaned hourly triggers the
  same repair action as drift (recompute daily from hourly), so the two
  issue types won't conflict even if both are flagged for the same site/day.
- **Repair zeros out a daily entry**: if hourly sums are all zero, the
  repaired daily entry is deleted; empty parent buckets are pruned.
- **Repair creates a new daily key**: building a daily from an orphaned
  hourly may insert a `dayKey` that did not previously exist in the
  daily store — this is correct.
- **Empty stores on first install**: `checkHealth` receives empty objects
  and returns zero issues; the card shows "All checks passed".

## Out of scope (v1)

- Checking `visits` consistency between daily and hourly.
- Per-issue selective repair (all issues fixed together in one action).
- Automatic periodic checks or background alerts.
- Undo after repair.
