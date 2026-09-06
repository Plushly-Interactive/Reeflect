# Interval storage for precise overlap merging

> **Status: superseded by the cutover.** The interval log is no longer a removable
> experiment running beside the scalar trackers; it is now the single authoritative
> tracker. The scalar capture stack has been removed and its buckets frozen as
> read-only legacy. The "removable experiment" framing, the revert steps, and the
> separate interval-dashboard described below are historical. See
> [bucket-to-interval-tracking-migration.md](tracking-bucket-to-interval-migration.md)
> for the current architecture.

Store raw browsing **presence intervals** (`{domain, path, kind, from, to}`) in
an IndexedDB log, captured by a **duplicate of the existing tracking stack**. The
current goal is to **validate interval storage against the scalar trackers**:
aggregating the raw ranges must reproduce the same active/audio time and visit
counts the regular dashboard shows. Storing raw ranges (rather than the scalar
ms cells) also keeps future per-site overlap analysis ("while twitch played,
what was I actively browsing") possible — but no overlap UI ships in v1.

The whole feature is a **removable experiment**. It is built by *copying* the
tracking files under new names and changing only where they write — the original
tracking code is **untouched**. Two small hooks wire it in: one `import` line in
`background.js`, and one button on the main dashboard (→ the interval dashboard).
Ditching it later is deleting the copied files and reverting those two hooks (see
[How to remove](#how-to-remove)).

This feature is **independent of**
[Migrate tracking aggregates to IndexedDB](../features/storage-aggregates-indexeddb.md):
it does not migrate, read, or touch the scalar aggregates; it stands up a
separate database alongside them.

## User stories

- As the developer, I want to validate that interval storage faithfully
  reproduces the scalar tracker's numbers before considering it a replacement —
  and to remove it cleanly if it doesn't earn its keep.
- As the developer, I want the raw `from/to` ranges kept (not pre-merged scalar
  cells) so a future per-site overlap view can be built without re-capturing.

## Acceptance criteria

- [ ] Aggregating the interval log reproduces the scalar **active/audio time**
      shown on the regular dashboard (within one flush interval of skew, since
      the two trackers flush on independent 1-min alarms).
- [ ] The interval dashboard mirrors the main layout (top-5, avg-per-hour,
      all-sites table), reached by a button on the main dashboard; every number
      is derived from the interval log.
- [ ] Existing tracking, stats surfaces, export, prune, "forget this site",
      settings, and `onInstalled` neither read nor write the interval log.
- [ ] Capture behaves identically to the real tracker (same range state machine,
      snapshot/recover, per-path idle clipping) because it is a copy of it.
- [ ] Interval rows are kept indefinitely (no auto-prune).
- [ ] Removing the experiment (delete the copied files + revert the two hooks)
      leaves tracking and the main dashboard byte-for-byte functional.

## Scope

### Surfaces involved

| Surface | Role |
|---|---|
| background | A **duplicate** site+path tracker (copied from the real one) with its own listeners, state, `intervalFlush` alarm, and `_intervalSnapshot` key, writing ranges to the interval DB. Reached by one `import` in `background.js`. |
| interval dashboard | Clone of the main dashboard, rendering the interval log (via a derived-aggregates adapter) instead of the scalar stores. Reached by a button on the main dashboard. |
| dashboard | One nav button → the interval dashboard. |

### Files

**New — the experiment is a copy of the tracking stack:**

| File | Copied from | Role / only difference |
|---|---|---|
| `src/background/intervalTrackingUtils.js` | `trackingUtils.js` | `createRangeTracker` is **verbatim**. `flushToStorage` is rewritten: instead of accumulating scalar ms cells it coalesces the pending `active`/`audio` ranges into **live rows** (extend the open row when a range abuts it, else start a new one), appends `idle` plainly, and never stores `overlap`. The open-row map is carried in the snapshot. Visits are **not** stored. |
| `src/background/intervalPageTracking.js` | `subpageTracking.js` | Wiring keyed on `${domain}\n${path}` (so capture is at domain+path granularity); own `_intervalSnapshot` key. |
| `src/background/intervalTracker.js` | background.js's subpage wiring | Listeners (`onActivated`/`onUpdated`/`onRemoved`/`windows.*`/`webNavigation`/`idle`), bootstrap, `intervalFlush` alarm, coldStart handling — driving the duplicate module. |
| `src/data/intervalLog.js` | — | Owns the `browsing-intervals` IndexedDB (one `intervals` store, **no secondary index** — the only reader scans all rows). `appendInterval` (insert → id, for live rows), `touch` (extend a row's `to`, returns the update count), `appendIntervals` (bulk, for idle), `allIntervals`, `clearAll`, and the shared `SESSION_GAP_MS` constant. No retention. |
| `src/data/intervalAggregates.js` | — | Derives the dashboard shapes from the ranges (no stored aggregates, no stored visits): `getSitesByDay` and `getAvgPerClockHour`. |
| `src/pages/interval-dashboard/interval-dashboard.{html,css,js}` | dashboard | Dashboard clone. Reuses `dashboard.css` + shared chart/range modules; the `.js` duplicates the render logic and swaps its two data sources to `intervalAggregates`. |
| `src/vendor/dexie.min.mjs` | vendored | Dexie 4.4.3 (audited), the interval DB's only dependency. |

**Modified — two small, clearly-marked hooks:**

| File | Change |
|---|---|
| `src/background/background.js` | One additive line: `import './intervalTracker.js';`. |
| `src/pages/dashboard/dashboard.{html,js}` | One `#interval-dashboard-btn` nav button → the interval dashboard. |

The tracking **core is untouched**: `trackingUtils.js`, `siteTracking.js`,
`subpageTracking.js`, `migrations.js`, `prune.js`, `targetedDelete.js`,
`importData.js`, `seedTestData.js`, `healthCheck.js`, `prefKeys.js`, and
storage-management.

### Capture mechanism

Because `intervalTrackingUtils.js` reuses `createRangeTracker` **verbatim** and
`intervalTracker.js` mirrors background's subpage wiring, **capture** is
identical to the real subpage tracker: same per-(domain+path) range state
machine, same visit/activation logic, same `chrome.idle` **per-path** clipping
(active kept full only while *that path* is audible), same
`intervalFlush`/reconcile/snapshot lifecycle. The two trackers run independently
in one service worker, on separate alarms and snapshot keys, never sharing state.

The divergence is **persistence**, and it lives entirely in `flushToStorage`
(nothing writes the DB outside flush):

- **active / audio → live rows.** Each continuous session is **one row**, grown
  in place: flush extends the open row (`touch`) when a pending range is within
  **`SESSION_GAP_MS`** of its end, or starts a new row (`appendInterval`) on a
  larger gap. An in-memory `openRows` map (`key+kind → {rowId, lastTo}`) holds the
  open row between flushes. Pending ranges are **sorted** first (recover credits
  out of order) and the row's end only ever moves **forward**.
- **`SESSION_GAP_MS` (1 s) is shared** with visit counting, so a row boundary and
  a visit boundary mean the same thing. It bridges the sub-second flush/SW seams
  (a wake's reseed segment starts a few ms after the last flush's end) so a
  session that spans flushes/restarts stays **one** row.
- **`openRows` rides the snapshot.** MV3 suspends the SW ~every 30 s; without
  this, every wake would start a fresh row and re-fragment. `recoverFromSnapshot`
  restores `openRows`, and the gap it credits then extends the same rows.
- **Self-healing `touch`.** If `touch` updates **0 rows** — the row vanished,
  e.g. the DB was cleared while the snapshot still referenced it — flush falls
  back to `appendInterval`, recreating the row. Without this, a cleared DB +
  stale snapshot would `touch` dead ids forever and never write anything.
- **`idle` → plain appended** (small; only used for visit-bridging).
- **`overlap` → never stored** (= active ∩ audio, derivable).

`kind` ∈ `active` | `audio` | `idle`. Aggregating the rows reproduces the scalar
tracker's time (a grown row sums the same as the chunks it replaces).

### Storage

| Store | Shape | Read by | Written by |
|---|---|---|---|
| `intervals` (IndexedDB **`browsing-intervals`**, key `++id`; since schema v2 also indexed on `[deviceId+localId]` and `dirty`, beside a `deletes` queue and a `meta` store for sync) | `{ id, domain, path, kind, from, to }` (epoch ms) plus `deviceId`, `localId`, `dirty`, `mirror`, `keyEpoch` | `intervalAggregates`, enforcement, sync | `intervalTrackingUtils.flushToStorage`; sync for mirror rows |

One row per **session** (a continuous active/audio presence), grown in place by
the live-row flush — not one row per flush tick. The URL is split into `domain`
(the existing site id) and in-site `path`. The aggregate reader loads the whole
store (`toArray`) and re-aggregates
in JS; `touch` updates rows by primary key. **No retention** — the log only
grows, bounded by IndexedDB's GB-class scale.

### Reading: derived aggregates and derived visits

`intervalAggregates.js` reconstructs the dashboard's data **entirely from the
ranges** — nothing (not even visits) is pre-stored:

- **active/audio time** per domain per hour = the **union** of that domain's path
  ranges (parallel same-site windows counted once), capped at one hour, summed
  into the day. This reproduces the scalar site tracker's time.
- **visits** = merge a domain's **active + audio + idle** presence into runs
  (audio or an AFK/idle stretch during an active gap keeps the run open), then
  count each run that **contains active** presence — credited to its **start
  day**. So `active → audio → active` is one visit, and background-audio-only
  (no active) is zero. The merge tolerance is the same `SESSION_GAP_MS` (1 s) the
  live-row coalesce uses, so a row boundary and a visit boundary agree. The same
  merge over rows whose `path` starts with a prefix gives
  path- or prefix-level visits (`reddit.com`, `reddit.com/news`, exact path).
  **No audio visits** — audio presence never counts as a visit (a deliberate
  divergence from the scalar tracker, which counts audio starts).
- **wall-clock per hour** = union of every site's active+audio (for "avg per
  clock hour").

### How identical is it?

- **active / audio time**: identical to the scalar **subpage** tracker, and to
  the **site** dashboard for normal use, give or take ≤ one flush interval of
  skew (independent flush clocks mean the in-flight tail of the open session is
  captured by one tracker slightly before the other).
- **visits**: presence-based and **audio-free** by design, so they differ from
  the scalar dashboard for media sites (which counts audio-start visits).

## How to remove

No longer possible: the log is the authoritative store, the dashboards read it, and cloud sync replicates it. The experiment-era removal steps are gone with the pages they named.

## Edge cases

- **Pre-log history**: periods before the log started have no rows; the interval
  dashboard simply shows nothing for them.
- **SW suspend / restart**: handled by the copied `recoverFromSnapshot` — the
  per-1-min snapshot credits the gap `[snap.at, bootstrapAt]` to the snapshot's
  keys (active kept full when the path was audible), with a 5-min staleness
  discard and `onStartup` cold-start clear. Identical to the real tracker.
- **Idle**: per-path — a foreground path is clipped while the user is AFK unless
  *that path* is the one playing audio. Audio is never idle-clipped.
- **Minimized window**: closed on the next reconcile (≤ 1 min). Non-minimized
  parallel windows are genuine parallel use and kept.
- **DB cleared while the snapshot survives** (e.g. clearing the store in
  devtools): the restored `openRows` point at deleted rows, so the next `touch`
  updates 0 rows → flush recreates them via `appendInterval` (self-healing). For
  a fully clean reset, clear both the DB and the `_intervalSnapshot` key.
- **IndexedDB unavailable / quota**: writes fail silently; nothing else affected.

## Out of scope (v1)

- ~~Data-management integration~~ — since done: forget-site, range, path and
  clear-all deletes go through `intervalLog.js` (`deleteByDomain`, `deleteRange`,
  `deletePath`, `deleteByIds`, `clearAll`), and each queues the matching sync delete.
- ~~Additive experiment only~~ — since superseded: the log is the authoritative
  store and the base of cloud sync ([migration](tracking-bucket-to-interval-migration.md)).
- Retention — no age-based pruning; the only automatic trimming is
  [prune-insignificant](../features/storage-prune-insignificant.md), through `intervalLog.js`.
- **Overlap / "browsed alongside" UI** — the original motivation, now deferred.
  Rows store `domain`+`path`+`from`/`to`, so a parallel-browsing view can be
  rebuilt later with no recapture; v1 ships only the dashboard clone.
- Interval-data **drill-downs** — the interval dashboard's rows link to the
  existing site/path pages, which still show scalar data (known mismatch).
- Streaming/paged reads — `intervalAggregates` loads the whole log into memory.
  Fine at current scale; revisit if it grows large.

## Open questions

- Whether to later promote the experiment (export/import, settings, retention, a
  domain-level visit counter to match the scalar dashboard exactly) or keep the
  current minimal-hook integration.
