# Architecture reference

TL;DR: the storage schema diagram, the page read-path dispatch table and the module map, cut from `docs/architecture/architecture.md`. Reference only.

## Storage schema

```mermaid
erDiagram
  intervals {
    number id "auto ++id"
    string domain
    string path
    string kind "active | audio | idle"
    number from
    number to
    string deviceId "sync: origin device"
    number localId "sync: id on the origin device"
    number dirty "sync: 1 = not yet pushed"
    number mirror "sync: 1 = pulled from another device"
    number keyEpoch "sync: key version that encrypted it"
  }
  deletes {
    string deviceId "sync: origin to delete remotely, PK with localId"
    number localId
  }
  meta {
    string key "sync: deviceId, account, cursors, wrapped keys"
    bytes value
  }
  sitesByDay {
    string dayKey "FROZEN legacy: YYYY-MM-DD → { siteId → cell }"
  }
  sitesByHour {
    string hourKey "FROZEN legacy: YYYY-MM-DDTHH → { siteId → cell }"
  }
  subpagesByDay {
    string dayKey "FROZEN legacy: YYYY-MM-DD → { siteId → { path → cell } }"
  }
  subpagesByHour {
    string hourKey "FROZEN legacy: YYYY-MM-DDTHH → { siteId → { path → cell } }"
  }
  rules {
    string id
    string target
    number limit
    string limitUnit
    string period
    string mode
    boolean enabled
  }
  _intervalSnapshot {
    array activeKeys
    array audioKeys
    array openRows
    number at
  }
  storageVersion {
    number version
  }
```

`intervals`, `deletes` and `meta` live in the `browsing-intervals` IndexedDB (via Dexie, schema version 2; indexes `[deviceId+localId]` and `dirty`). The four bucket maps, `rules`, `_intervalSnapshot` and `storageVersion` live in `chrome.storage.local`. The bucket maps are **frozen**: read-only legacy, no live writer.

### Ownership

| Key | Writers | Readers |
|---|---|---|
| `intervals` (IndexedDB) | background (interval tracker flush); sync (mirror rows, `dirty`) | pages (via aggregates), background (enforcement / badge), sync (push queue) |
| `deletes`, `meta` (IndexedDB) | sync | sync |
| `rules` | popup, rules page | enforcement (background), rules page |
| `sitesByDay` / `sitesByHour` | import, migrations, seed | pages (stitch path), import/export |
| `subpagesByDay` / `subpagesByHour` | import, migrations | pages (stitch path), import/export |
| `_intervalSnapshot` | background | background |
| `storageVersion` | migrations | migrations |

## Page read path

The chrome message API is gone — pages read storage directly. The `QUERY_*` constants in `queryTypes.js` are **internal dispatch tags** for the merged reader (a leftover name from the old message API, now just read selectors).

Pages call `loadMergedTrackingData({ type: QUERY_*, ...args })` (`mergeDataSources.js`). It splits the request at `earliestDayKey()` and dispatches per day:

| Tag | Args | Returns | Purpose |
|---|---|---|---|
| `getSitesByDay` | - | `sitesByDay` map | full day-level history |
| `getSitesByHourToday` | - | today's hour buckets | today's hourly chart |
| `getSitesByHourForDay` | `dayKey` | that day's hour buckets | drill into a past day |
| `getAvgPerClockHour` | `siteIds?`, `range`, `dayKeys?` | `number[24]` | average ms per clock hour over a range |
| `getSubpagesByDay` | - | `subpagesByDay` map | path-level history |
| `getSubpagesByHour` | - | `subpagesByHour` map | path-level hourly history |

Interval days resolve through `intervalFetch` (IndexedDB, via `intervalAggregates`); pre-interval days through `bucketFetch` (`chrome.storage.local`). In mock mode (guided tour) fixtures are returned alone; when the log is empty every read falls through to buckets. Enforcement and the badge skip this reader and call `usageSince(windowStart)` directly for a light, uncached windowed aggregate.

## Modules

| Layer | File | Role |
|---|---|---|
| Background wiring | `src/background/background.js` | favicon cache, badge, the single 1-min `flush` alarm, enforcement check, pre-emptive block |
| Live tracker | `src/background/intervalTracker.js` | self-registers tab/window/SPA/idle listeners; configures the engine with a composite `domain+path` key and `_intervalSnapshot`; exports `flushNow()` and the raw `flushToStorage` drain |
| Range engine | `src/background/intervalTrackingUtils.js` | generic presence-range state machine (`createTrackingModule` + `createRangeTracker`); snapshot/recover, idle clip; `flushToStorage` writes interval rows |
| Interval store | `src/data/intervalLog.js` | the `browsing-intervals` IndexedDB; row CRUD, `allIntervals`, `intervalsSince`, `intervalStats` |
| Derived aggregates | `src/data/intervalAggregates.js` | reconstructs day/hour site & subpage shapes, visits, avg-per-hour from rows; `usageSince`, `earliestDayKey` |
| Merged reader | `src/data/mergeDataSources.js`, `intervalProvider.js`, `bucketProvider.js` | page-side read; stitches interval days over frozen buckets |
| URL resolution | `src/background/siteResolution.js` | `siteIdFromUrl`, `pathFromUrl` |
| Debug | `src/background/trackingDebug.js` | `dbg` / `initDebug` / `isDebug`, gated on `_debug` |
| Enforcement | `src/background/enforcement.js`, `badge.js` | `computeOverage`, `publishOverage`, toolbar badge |
| Legacy bucket keys | `src/data/bucketKeys.js` | storage-key constants for the frozen scalar tier |
| Data utilities | `src/data/migrations.js`, `importBuckets.js`, `ttImport.js`, `exportPayload.js`, `prune.js`, `seedTestData.js`, `csvExport.js` | schema migrations, import/export, pruning |
| UI views | `src/pages/{dashboard,site,path,rules,popup,blocked,storage-management,...}` | tracking views (read-only) + rule editor |
| UI shared | `src/shared/*.js` | charts, drilldowns, formatting, theme |
