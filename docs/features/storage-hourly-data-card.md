# Hourly data card

TL;DR: the hourly data card on the storage management page shows how much space each hourly store occupies and lets the user drop hourly buckets older than N days, scoped to sites, subpages, or both. Daily aggregates cover the same history at coarser granularity, so dropping old hourly data reclaims space without losing meaningful history.

## User stories

- As a user, I want to see at a glance how much of my storage each hourly store uses so that I can judge which to drop.
- As a user, I want to choose whether to drop site hourly data, subpage hourly data, or both, so that I can target the larger store.
- As a user, I want to drop hourly data older than N days so that I can reclaim space while keeping recent detail.
- As a user, I want to see how many bytes the drop would free before confirming so that I can judge the impact.
- As a user, I want my chosen N-days value and scope selection remembered across visits.

## Acceptance criteria

- [ ] The card shows a stats callout on page load with two lines — one for `sitesByHour` and one for `subpagesByHour` — each showing its bytes and share of total storage (e.g. "Sites hourly — 0.8 MB (24%)" / "Subpages hourly — 1.3 MB (38%)"). The total across both is also shown.
- [ ] The callout stats are computed from `chrome.storage.local.getBytesInUse` per key on page load and refresh after each drop.
- [ ] The card has two checkboxes — `Sites` and `Subpages` — both checked by default. Their state is persisted to `settings.dropHourlyScope` and restored on load.
- [ ] The card has a number input labeled "Drop hourly data older than [N] days". Restored from `settings.dropHourlyDays` on load, defaulting to 30. Persisted on each input event.
- [ ] Adjacent to the input, an estimate of bytes that would be freed by the drop is shown given the current N and checked stores. It updates as N or the checkboxes change (debounced 300 ms).
- [ ] The "Drop hourly" button is disabled when the input is empty or non-numeric, or when no store is checked.
- [ ] Clicking "Drop hourly" shows a confirmation dialog naming the scope and cutoff before proceeding.
- [ ] Confirming deletes every entry from the selected store(s) where the `YYYY-MM-DDTHH` key is strictly older than N days from today. The daily stores are not touched.
- [ ] After deletion: `invalidateSitesCache` is sent to background, a notification shows actual bytes freed (from `getBytesInUse` before/after), and the callout refreshes.

## Scope

### Surfaces involved

| Surface | Role |
|---|---|
| Storage management page | Card UI, callout stats, scope checkboxes, drop action |

### Files likely to change

| File | Change |
|---|---|
| `ui/pages/storage-management/storage-management.html` | Hourly card section |
| `ui/pages/storage-management/storage-management.css` | Callout styles (reuse `.chart-container` from `theme.css`) |
| `ui/pages/storage-management/storage-management.js` | Load per-store stats, persist settings, wire checkboxes, live estimate, drop |

### Storage / tracking

| Key | Shape | Read by | Written by | Notes |
|---|---|---|---|---|
| `sitesByHour` | existing | storage-management page | storage-management page | entries deleted by date cutoff when Sites is checked |
| `subpagesByHour` | existing | storage-management page | storage-management page | entries deleted by date cutoff when Subpages is checked |
| `settings` | `{ ..., dropHourlyDays: number, dropHourlyScope: { sites: boolean, subpages: boolean } }` | storage-management page | storage-management page | two new fields on the existing settings bag |

## Edge cases

- **No hourly data in a store**: that store shows 0 bytes in the callout; if selected, the drop runs cleanly and the notification shows "0 bytes freed."
- **All hourly data is within N days**: drop runs against no buckets; notification shows "0 bytes freed."
- **N empty or non-numeric**: drop button disabled; estimate hidden.
- **No store checked**: drop button disabled.
- **Hourly records with no corresponding daily entry**: dropped as-is; the feature does not attempt to merge missing data into daily before deleting.

## Out of scope (v1)

- Merging hourly data into daily aggregates before dropping.
- Per-store separate N-days thresholds.
- Automatic scheduled hourly drops.
