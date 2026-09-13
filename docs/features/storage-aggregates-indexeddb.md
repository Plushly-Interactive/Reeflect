# Migrate tracking aggregates to IndexedDB

TL;DR: the four large tracking aggregates (`sitesByDay`, `sitesByHour`, `subpagesByDay`, `subpagesByHour`) live in `chrome.storage.local` as monolithic objects. The cost is the flush pattern: `flushToStorage` reads the *entire* day+hour blob, mutates a few cells, and writes the *whole blob back* every minute — a cost that grows with total history. Moving the aggregates to IndexedDB (one record per time bucket) makes a flush touch only the buckets it changed, and removes the ~10 MB `storage.local` ceiling.

## User stories

- As a long-term user, I want my months of history to not slow down every flush, so the extension stays light no matter how much data accumulates.
- As a heavy user, I want my tracking data to stop competing for the small `storage.local` quota, so I never hit a storage ceiling.

## Acceptance criteria

- [ ] All tracking views (dashboard, site, path, popup, blocked) show the same data after the migration as before — no visible change.
- [ ] A fresh flush writes only the current day/hour buckets; untouched historical buckets are not rewritten.
- [ ] Existing users' `chrome.storage.local` aggregates are moved into IndexedDB on update, and the old `chrome.storage.local` keys are removed afterward.
- [ ] Export (JSON, CSV daily/hourly) and import produce identical results to before.
- [ ] Storage-management actions (prune insignificant, targeted delete, data-health) operate on the IndexedDB-backed data.
- [ ] Seeding test data and the Time Tracker import write into IndexedDB.
- [ ] After migration, IndexedDB is marked persistent via `navigator.storage.persist()`.

## Scope

### Surfaces involved

| Surface | Role in this feature |
|---|---|
| background | Sole writer of aggregates on flush; reads IDB into its in-memory cache for the message API |
| options/pages | Direct IDB readers/writers replace direct `chrome.storage.local` access for the 4 maps (import, prune, seed, targeted-delete, data-health) |

### New module

| File | Role |
|---|---|
| `extension/src/data/aggregatesDb.js` | Opens the IndexedDB; CRUD helpers for the 4 object stores (`get(store, bucketKey)`, `put`, bucket-range read/delete). Imported by both background and pages. |

### Files likely to change

| File | Change |
|---|---|
| `extension/src/background/trackingUtils.js` | `flushToStorage` reads/writes touched buckets via `aggregatesDb` instead of whole-blob `chrome.storage.local.get/set` |
| `extension/src/background/background.js` | `getByDay`/`getByHour*`/`getSubpages*`/`getAvgPerClockHour` and `checkEnforcement` read aggregates from `aggregatesDb` (cache layer unchanged) |
| `extension/src/data/importData.js` | Export reads + import writes go through `aggregatesDb` |
| `extension/src/data/prune.js` | Operates on records fetched from `aggregatesDb` (pure scan/delete fns may stay, callers change) |
| `extension/src/data/targetedDelete.js` | Deletes via `aggregatesDb` |
| `extension/src/data/seedTestData.js` | Seeds via `aggregatesDb` |
| `extension/src/data/healthCheck.js` | Reads via `aggregatesDb` |
| `ui/pages/storage-management/storage-management.js` | Total-usage / record counts computed over IDB |
| `extension/src/data/migrations.js` | New step (v6→v7): copy the 4 maps from `chrome.storage.local` into IDB, then remove the old keys *(written after the functional code, per project rules)* |

### Storage / tracking

| IndexedDB store | Key | Value | Notes |
|---|---|---|---|
| `sitesByDay` | `dayKey` (`YYYY-MM-DD`) | `{ siteId → { activeMs, audioMs, overlapMs, idleMs, visits } }` | one record per day bucket |
| `sitesByHour` | `hourKey` (`YYYY-MM-DDTHH`) | `{ siteId → cell }` | one record per hour bucket |
| `subpagesByDay` | `dayKey` | `{ siteId → { path → cell } }` | one record per day bucket |
| `subpagesByHour` | `hourKey` | `{ siteId → { path → cell } }` | one record per hour bucket |

| Stays in `chrome.storage.local` | Why |
|---|---|
| `wallClockByHour`, `firstBrowseByDay` | Scoped out of v1; small. |
| `rules`, all `PREF_*`, `_trackingSnapshot`, `_subpageSnapshot`, `faviconCache`, `storageVersion` | Tiny key-value or transient SW state; IDB is pure overhead. |

## Edge cases

- **Concurrent writes** (background flush vs. a page import/prune): IndexedDB `readwrite` transactions are atomic per record; collisions resolve at bucket granularity instead of today's whole-blob last-writer-wins clobber.
- **SW killed mid-flush**: an IDB transaction either commits or doesn't — no partially-written blob.
- **Pre-migration reads**: until the v6→v7 data move runs, the aggregates module must not be read against an empty store while the data still sits in `chrome.storage.local`. Migration runs in `ensureStorageVersion` before tracking init (existing bootstrap order).
- **Eviction**: `navigator.storage.persist()` marks the origin durable so the browser doesn't evict aggregates under storage pressure.

## Out of scope (v1)

- Moving `wallClockByHour` and `firstBrowseByDay` into IndexedDB.
- Per-`(period, siteId)` row granularity and per-site indexes.
- Retention-window pref, quota-alert threshold rethink, and the persistent `dbg()` log buffer — all *enabled* by this change but built separately.

## Open questions

- Reuse the existing `storageVersion` migration chain (v6→v7) for the one-time data move, or a separate IDB-internal version flag? (Leaning: reuse `storageVersion`.)
