# Guided feature tour

TL;DR: a stepped walkthrough with a spotlight overlay across dashboard, popup, site, path and storage pruning. Runs once automatically on first install, replayable from the `?` button in the dashboard header. Per-file changes, storage shapes and resume edge cases: [appendix](../appendix/guided-tour-implementation.md).

## User stories

- As a new user, I want the tour to start by itself the first time I open the app, so I understand each surface without reading documentation.
- As a returning user, I want to replay it from a visible button.
- As any user, I want to interrupt it at any point.
- As a new user with no history yet, I want example data during the tour so the charts are not empty.

## Behaviour

- First install opens the dashboard in a new tab with the tour on step one. Update and reload do not start it.
- The app has no install event (`host.features.installEvent` is false). There the dashboard starts the tour when no tour state was ever stored.
- The `?` button (`square-btn`) in the dashboard header restarts from step one. Its label never changes.
- Each step dims the page, cuts a spotlight hole around one element, and shows a tooltip with `Previous` and `Next`. A `✕` sits at the overlay's top-left.
- `Previous` is disabled on step one. `Next` reads `Finish` on the last step and marks the tour completed.
- `✕` opens a centred confirmation. Confirming closes the tour, marks it completed, clears mock-data state, and each surface re-renders against real storage.
- Keyboard: `ArrowRight` / `Enter` advance, `ArrowLeft` goes back. Both are ignored on handoff steps, on `advanceOn: 'click'` steps, and while focus is in a form field. `Esc` does **not** close the tour.
- A step whose target element is missing is skipped automatically, in the direction of travel.

### Cross-surface handoff
- The tour moves between surfaces on a natural user action — the toolbar icon, a table row, the Storage pruning button — and resumes on the destination from stored `inProgress`.
- The import/export modal sub-flow opens the modal on the first modal step, highlights `#io-section-bg` and `#io-section-tt`, and closes it when the user advances past the last modal step. While `body.tour-modal-step` is set, the modal's own dismiss paths are blocked and non-target sections are dimmed.
- Site and path include a drill sub-flow: a click step on `#time-chart-container` opens drill mode, three steps describe it, and a click step on `#nav-close` exits. While `body.tour-drill-step` is set, drill's own keyboard shortcuts are muted.

### Mock data
- When storage holds no tracking data, the tour turns on mock mode and renders an in-memory fixture covering every surface it visits: dashboard charts and table, a site page per mock site (each with at least one subpage), a path page, and at least one insignificant entry for the pruning scan.
- The fixture is never written to `chrome.storage.local`. The only write is the `useMockData` flag inside the `tour` key, cleared on completion.
- The pruning steps click Scan naturally so real scan results render from the fixture. Delete is informational only — `runDelete` is guarded against writing in mock mode.

## Surfaces involved

| Surface | Role |
| --- | --- |
| background | Opens the dashboard with `?tour=1` on `chrome.runtime.onInstalled` when `reason === 'install'` |
| dashboard | Hosts the `?` button, auto-starts (`?tour=1`, or the app's first launch), coordinates focusing an existing tab |
| popup | Runs its steps only while `inProgress.surface === 'popup'` |
| site, path | Run their detail steps including the drill sub-flow |
| storage management | Runs the pruning steps |
| import/export modal | Sub-flow inside the dashboard tour |

## Storage

- `tour` — `{ completed, completedAt, inProgress, useMockData }`. `completed` gates auto-start, `inProgress` carries the handoff, `useMockData` enables the fixture. All writes are serialized through a promise chain so concurrent writes cannot be lost.
- `tourAdvanceRequest` — a timestamp the popup writes before focusing the dashboard tab, so a dashboard already open jumps to the right step.

## Versioning

- The tour has **no update-on-version mechanism**. An earlier `TOUR_VERSION` system that re-walked newly added steps was removed.
- On update the background starts no tour. New steps are picked up the next time the full tour runs.
- Telling returning users what changed is the [changelog popup](changelog-popup.md)'s job, not the tour's.

## Open questions

Step-order rough edges flagged in an internal audit:

- Dashboard step 1 "Time range" comes before the user has seen any chart; consider moving it later.
- The dashboard tour bounces back to the table after the modal and popup detour; consider grouping all on-dashboard steps before the popup handoff.
- Site and path steps 1 and 5 both highlight `#time-chart-container`; consider merging them or moving the drill detour next to the time-chart step.
- "Back to overview" is action-worded while the surrounding drill steps are descriptive nouns.

Resolved — the `onInstalled` listener returns early unless `details.reason === 'install'`, so the tour tab opens on first install only.
