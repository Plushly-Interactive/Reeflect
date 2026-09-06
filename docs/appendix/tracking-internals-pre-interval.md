# Tracking internals (pre-interval tracker)

TL;DR: **stale.** This describes the scalar tracker in `src/tracking.js`, a file that no longer exists — the interval log replaced it. Kept because its caveats and visit semantics still explain why the current engine behaves as it does. Current design: `docs/architecture/architecture.md`. User-visible semantics: `docs/end-user/tracking-behaviour.md`.

## State

Held in module-level maps in `tracking.js`, the pre-interval engine since replaced by `src/background/intervalTracker.js`:

- `siteStates: Map<siteId, State>` — per-site tracking state.
  - `activeWindowIds: Set<windowId>` — windows where this site is the active tab.
  - `audibleTabIds: Set<tabId>` — tabs on this site that are audible and not muted.
  - `wasActive: boolean` — derived from `activeWindowIds.size > 0`, but maintained explicitly as a transition flag.
  - `wasAudible: boolean` — derived from `audibleTabIds.size > 0`, same.
  - `startedAt: number` — wall-clock ms marking the start of the current accumulating range. Reset by `recordElapsed`.
- `windowToSite: Map<windowId, siteId>` — reverse lookup for the active tab's site per window.
- `audibleTabToSite: Map<tabId, siteId>` — reverse lookup for audible tabs.

Pending ranges, flushed once per minute:

- `pendingActive`, `pendingAudio`, `pendingOverlap: Map<siteId, [from, to][]>`
- `pendingVisits: Map<siteId, count>`

All state lives only in the running service worker. Persistence happens via `flushToStorage` writing to `chrome.storage.local` keys `sitesByDay` and `sitesByHour`.

## Time recording

`recordElapsed(siteId)` closes the current `[startedAt, now]` range:

- Pushes to `pendingActive` if `wasActive`.
- Pushes to `pendingAudio` if `wasAudible`.
- Pushes to `pendingOverlap` if both.
- Resets `startedAt = now`.

It is called whenever the tracked-state of a site is about to change in a way that would split the metrics differently:

- A window enters/leaves `activeWindowIds`.
- An audible tab enters/leaves `audibleTabIds`.
- At the end of `flushToStorage` for every live site (closes the current open range up to the flush time).

`startedAt` is reset on every `recordElapsed` call so that subsequent calls record contiguous, non-overlapping ranges.

`splitByHour` splits a range across hour boundaries when the flusher writes to `sitesByHour`. Each hour bucket is capped at 3,600,000 ms; overflow is dropped, and the day total only adds the actually-applied delta.

## Visit semantics

The two entry paths count visits with different dedup rules:

- **Active path** — `setWindowSite` is session-based: it reads the existing state's `wasActive || wasAudible` *after* removing the old window (which only affects the old siteId, never the new one), and increments visits only if the new site was untracked.
- **Audio path** — `addAudibleTab` is per-tab: it counts a visit only when the tab's last-counted key differs from the new key, tracked in `audibleTabLastVisitKey: Map<tabId, key>`. This map is **not** cleared by `removeAudibleTab` (only `audibleTabToKey` is), so it survives audible→silent→audible flaps and the `countVisit=false` restore path on SW restart. A tab that keeps playing one site is counted once, regardless of audio interruptions, player reloads, or restarts. The map is cleared only by losing the whole service-worker lifecycle; stale closed-tab entries are harmless (a reused tabId on a different site has a different key).

`initTracking` and `reconcileWindows` call `addAudibleTab` with `countVisit=false` — this still records the tab's key in `audibleTabLastVisitKey` (so a later real audible event for the same tab+site isn't recounted) but does not increment visits. They call `addWindowSite` directly, which never increments visits.

### Site vs. subpage visits do not reconcile

Site visits (`sitesBy*`) and subpage visits (`subpagesBy*`) are **independent counters and are not expected to match** — neither per bucket nor summed. Do not reconstruct one from the other; it corrupts correct data. Three structural reasons, all by design:

1. **Subpage tracking is younger than the data.** It was introduced 2026-05-14; buckets before that have site visits with no subpage record at all (`subpageSum = 0, siteVisits > 0`).
2. **SPA navigation updates subpages only.** `webNavigation.onHistoryStateUpdated` (`src/background/background.js`) calls `setWindowPath` but not `setWindowSite` (the site is unchanged — same hostname, only the path moved). So path-to-path navigation within a site adds subpage visits without a site visit → `subpageSum > siteVisits`.
3. **Hour-bucket attribution skew.** A visit is written to the bucket of `localHourKey(now)` at *flush* time, and the site and subpage trackers flush in separate calls. A single session whose site visit and subpage (re)count straddle an hour boundary lands the two counts in adjacent hour buckets — so per-hour counts can diverge in *either* direction, while per-day they roughly reconcile.

A real overcount, by contrast, shows up as a large single-key visit delta in one flush (see the flush ledger under [Flush](#flush)) — not as a steady site/subpage gap.

## Listener model

All tab/window listeners in `src/background/background.js` are gated on `await bootstrapDone` before mutating tracking state. This guarantees:

- Listeners never run on empty state. By the time a listener executes, `initTracking` has populated `siteStates`/`windowToSite`/`audibleTabToSite` from the live Chrome state.
- `initTracking` cannot race with a listener that already ran `setWindowSite`. The orphan-`activeWindowIds` race that this used to allow (listener sets `windowToSite[w]=X`, then `initTracking` overwrites it with `addWindowSite(w, Y)` without cleaning X's `activeWindowIds`) is eliminated.

`onMessage` is intentionally not gated — it only reads from `chrome.storage.local` and the in-memory tracking data caches, never the tracking state.

## Bootstrap

`bootstrap`:

1. `await ensureStorageVersion()` — runs schema migrations.
2. `bootstrapAt = Date.now()` — captured **before** `initTracking` starts mutating state. Used to clip recovery (see below).
3. `await initTracking()` — populates tracking state from the live Chrome state.

`bootstrapDone` is the promise returned by this function and is awaited by every gated listener and by the flush alarm handler.

## Snapshot and recovery

To recover time spent during a service-worker suspension, `saveSnapshot` writes the current `activeSites` and `audioSites` to `chrome.storage.local` at the end of every flush, with timestamp `at`.

On the next SW lifecycle, `recoverFromSnapshot(clipAt)` reads the snapshot and credits a single range to the affected pending maps:

- If `now - snap.at > SNAPSHOT_MAX_GAP_MS` (5 min), the snapshot is discarded — too stale to be reliable.
- Otherwise, pushes `[snap.at, min(clipAt, now)]` to `pendingActive` for snapshot active sites, `pendingAudio` for audio sites, and `pendingOverlap` for sites in both.

`clipAt` is the `bootstrapAt` value captured before `initTracking`. Clipping at `bootstrapAt` (rather than `now`) ensures the recovery range does not overlap with the live tracker's first `recordElapsed`, which covers `[T_init_i, T_flush]` with `T_init_i ≥ bootstrapAt`. The remaining gap `[bootstrapAt, T_init_i]` is sub-millisecond — the duration of `chrome.windows.getAll` and the audible-tab query inside `initTracking` — and is unaccounted for rather than overcounted (under-count in the safe direction).

### Cold-start handling

A "cold start" here means the browser process starting fresh after being closed. The case to defend against is **closing and reopening the browser within `SNAPSHOT_MAX_GAP_MS`** — the snapshot's age check doesn't catch that, and recovery would otherwise credit the closed-browser interval as tracked time.

Two cooperating mechanisms handle this:

1. **In-memory flag (same-SW-lifecycle path).** `chrome.runtime.onStartup` sets `coldStart = true`. The alarm handler, before calling `recoverFromSnapshot`, awaits an explicit `chrome.storage.local.remove('_trackingSnapshot')` and clears the flag. This makes the deletion deterministic regardless of how Chrome interleaves the dispatch of `onStartup` and the alarm listener.
2. **Storage-side delete (cross-SW-lifecycle path).** `onStartup` also calls `chrome.storage.local.remove('_trackingSnapshot')` (unawaited). Even if the SW dies before the alarm fires, the operation completes in the browser process. When the alarm later wakes a fresh SW (with `coldStart = false` in its new module scope), the snapshot is already gone and recovery is a no-op.

The flag-only approach would miss the cross-lifecycle case (cold start where alarm isn't yet due → SW idles 30 s and dies → fresh SW later sees `coldStart = false`). The storage-only approach was the original code and "works in practice" but relies on ambient timing of dispatch order. Combined, the two cover both paths.

## Flush

The `flush` alarm fires every minute. The handler in `src/background/background.js`:

1. `await bootstrapDone`.
2. If `coldStart`, awaits `chrome.storage.local.remove('_trackingSnapshot')` and clears the flag. See cold-start handling above.
3. `await recoverFromSnapshot(bootstrapAt)` — runs once per SW lifecycle (idempotent via the `_recovered` flag).
4. `await reconcileWindows()` — picks up window/tab state changes that may have been missed (minimized windows, closed audible tabs, etc.) and corrects `windowToSite`/`audibleTabToSite`.
5. `await flushToStorage()` — closes all currently-open ranges via `recordElapsed`, then writes to `sitesByDay`/`sitesByHour`.
6. `await saveSnapshot()` — persists current state for the next recovery.
7. Invalidates the in-memory `cachedByDay`/`cachedByHour`.

## Multi-window concurrency

`activeWindowIds` is a `Set`; `recordElapsed` pushes one range regardless of how many windows are in the set. Two windows on the same site → one stream of active time. Two windows on different sites → two independent streams. There is no `windows.onFocusChanged` listener — the system intentionally does not collapse to "OS-focused window only" so that multi-monitor / multi-window workflows track correctly. See the rationale in [tracking-behaviour.md](../end-user/tracking-behaviour.md).

## Known caveats

- **Minimize lag.** Minimizing a window does not fire `windows.onRemoved`. State is corrected at the next `reconcileWindows` (next flush, ≤ ~60 s).
- **Visit timestamping.** `pendingVisits` are written into the hour bucket of `flushToStorage`'s `now`, not the bucket each visit occurred in. A visit at 11:59:50 flushed at 12:00:30 lands in the 12:00 bucket.
- **`bootstrap()` rejection.** If `ensureStorageVersion` or `initTracking` throws, `bootstrapDone` rejects and every gated listener throws on `await`. The extension would be broken anyway in that scenario, so this is intentional fail-loud behaviour.

