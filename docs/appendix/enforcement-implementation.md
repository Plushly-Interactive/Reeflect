# Enforcement — implementation detail

TL;DR: the parts of the enforcement spec cut from `docs/features/enforcement.md` — the full acceptance checklist, per-file changes, storage shapes, and the order the eleven slices shipped in. Reference only.

## Acceptance criteria

- [x] Adding a rule lets me pick a **scope** (this site / this site + subdomains / a specific page) and a **mode** (active / audio / active+audio, defaulting to active+audio) alongside the host, limit, unit, and period. The default limit is 10 minutes per hour.
- [x] The form shows a live preview of what the rule will block — a plain-English line plus the resolved URL-filter pattern.
- [x] A site I have used past its limit over the rule's period redirects to `blocked.html`. Navigating (re-loading the site, clicking a link, opening it in a new tab) flushes current usage and re-checks, so a fresh crossing blocks at navigation time rather than waiting up to a minute for the flush tick.
- [x] A `subdomain` rule on `reddit.com` blocks `old.reddit.com`; a `host` rule on `reddit.com` does not.
- [x] A `pathPrefix` rule on `twitch.tv` with path `directory` blocks that path and everything beneath it (`/directory/game/...`) but leaves the rest of `twitch.tv` reachable.
- [x] When the period rolls over (usage drops out of the window) or I disable the rule, the block is removed without restarting the browser.
- [x] `blocked.html` shows the host/path that was blocked, which limit was hit, and when it resets.
- [x] The target field accepts a pasted URL: a leading `http(s)://`, `www.`, and URL fragments are stripped, so `https://www.reddit.com/r/news#top` becomes host `reddit.com` + path `r/news`.
- [x] A target that isn't a valid registrable domain (e.g. `dfdsf`) shows an inline message and the Add button stays disabled.
- [x] The unit and period dropdowns are mutually constrained: `minutes` is valid for any period; `hours` requires `day` or `week`; `days` requires `week`. Invalid options are greyed out and unselectable. If changing the unit makes the current period invalid, the period auto-corrects to the nearest valid one. The limit input is clamped in real time to the maximum for the selected combo (60 min, 1440 min, 10080 min; 24 h, 168 h; 7 d). The same constraints apply in the inline row editor.
- [x] If an **enabled** existing rule already makes the one I'm adding a no-op — same scope-coverage, period, and mode, with an equal-or-stricter limit — the preview says so, links to the covering rule (clicking it scrolls to and flashes that row), and the Add button stays disabled. A disabled rule never blocks the add.
- [x] Adding a rule that is *stricter* than existing ones it covers is allowed; afterward a prompt lists the now-redundant rules and offers to **disable** them (reversible, not deleted). Redundancy holds across periods too: a `5m/day` rule makes a `5m/hour` rule redundant (a tight budget over a longer window caps every shorter window), but a `10m/day` rule does not (looser limit), and mode must match.
- [x] The rules list has a sortable header (reusing the dashboard table-header style): clicking **Site** or **Status** sorts by that column, clicking again reverses; the active column shows a ↑/↓ arrow. Sort is session-only.
- [x] Each rule row has an edit (✎) button that swaps the row's actions for inline **limit + period** controls (target/scope/mode aren't editable — delete and re-add to change those); ✓ saves, ↩ cancels. The row keeps both its lines so its height doesn't change, and only one row edits at a time.
- [x] Existing stored rules created before this feature keep working — they behave as `mode: 'active'`, `matchType: 'host'`.
- [x] The rules page shows an overview card (blocks this week, most-blocked rule, active rule count, avg blocks/day) and a 7-day sparkline of block counts, both sourced from `blocksByDay` storage updated each time a block is newly triggered.
- [x] On the site detail page, a "Limit this site" button opens the rules page pre-filled with the current site's host (`?target=<host>`), auto-opening the add card.

### Files likely to change

| File | Change |
|---|---|
| `src/pages/rules/rules.html` *(new)* | Two-column layout: left column has overview stats card + 7-day sparkline; right column has collapsible add-card (with URL/Regex/Keyword type tabs) + rules list card. |
| `src/pages/rules/rules.js` *(new)* | Page wiring: collapsible add card, type tabs, scope→path toggle, live preview, target normalization (strip scheme + `www.` + fragment) and validation (via `tldts` `getDomain`), save button handler, list sort, inline row editor (limit + period + constraints), stats + sparkline render. Rule logic comes from the shared module. |
| `src/pages/rules/rules.css` *(new)* | Page-specific layout; reuse shared classes from `theme.css`. |
| `src/shared/rules.js` *(new)* | Extracted rule logic shared by the rules page and the popup: `addRule`, `toggleRule`, `deleteRule`, `updateRule`, `disableRules`, coverage + redundancy checks, `renderRuleList` (optionally read-only), custom-dropdown init. Also exports `BLOCKS_DAY_KEY` and `blockKey` for block tracking. |
| `src/shared/rules.css` *(new)* | Shared styles for the rule list, used by both the rules page and the popup. |
| `src/pages/popup/popup.{html,js,css}` | Reworked into a launcher: removed the inline add-form; renders the **enabled** rules read-only via `renderRuleList(..., { readonly: true })`; a "Manage rules" button opens the rules page. |
| `src/pages/dashboard/dashboard.html` | Add a "Rules" entry button to `#header-left` to reach the rules page. |
| `src/pages/site/site.{html,js}` | Add a "Limit this site" button (`#limit-btn`) in `#header-right` that opens the rules page pre-filled with the current host. |
| `src/background/background.js` | Wire the checker + publisher into the flush alarm; re-run on `storage.onChanged` for `rules` so edits apply immediately; and on `webNavigation.onBeforeNavigate` (main frame) flush + re-check so a fresh crossing blocks at navigation time. |
| `src/background/enforcement.js` *(new)* | `computeOverage` (pure), the DNR publisher (which also updates `blocksByDay` on each newly-triggered block), and tab side-effects (`reloadMatchingTabs`, `returnUnblockedTabs`). |
| `src/data/migrations.js` | `v3 → v4`: backfill `mode:'active'` and `matchType:'host'` on every stored rule. |
| `src/pages/blocked/blocked.html` | Pre-existing web-accessible resource; updated to show the blocked target, limit, reset time, and a "Manage rules" link. |
| `src/pages/blocked/blocked.js` *(new)* | External script (MV3 CSP forbids inline scripts); reads `?rule=&site=&path=&url=` and sets the tab title to the blocked site. |

### Storage / tracking

| Key | Shape | Read by | Written by | Notes |
|---|---|---|---|---|
| `rules` | `{ id, target, path?, matchType, limit, limitUnit, period, enabled, mode }` | rules page, popup, background | rules page, popup, migration | `target` is always a bare host; `path` is set only for `path`/`pathPrefix` rules. `matchType` + `mode` are new; `v3→v4` migration backfills both. |
| `blocksByDay` | `{ [dayKey]: { [blockKey]: number } }` | rules page (stats + sparkline) | enforcement publisher | Incremented each time a block is newly triggered. `blockKey` = `target\|matchType\|path` — stable across rule UUID changes. |
| `sitesByDay` / `sitesByHour` | `{ [bucket]: { [host]: { activeMs, audioMs, overlapMs, visits } } }` | limit checker | tracking | Source for `host` / `subdomain` rules. Unchanged. |
| `subpagesByDay` / `subpagesByHour` | `{ [bucket]: { [host]: { [path]: { activeMs, audioMs, overlapMs, visits } } } }` | limit checker | subpage tracking | Source for `path` rules. Unchanged. |
| `storageVersion` | `number` | migrations | migrations | Bumped to `4`. |

### What's already in place (no change)

- `declarativeNetRequest` permission ([manifest.json:28](../../manifest.json#L28)) — declared, currently unused.
- `blocked.html` web-accessible resource ([manifest.json:32](../../manifest.json#L32)).
- All three accumulators (`activeMs`, `audioMs`, `overlapMs`) per site and per path.
- The 1-minute `flush` alarm in [background.js](../../src/background/background.js) — the checker hooks onto its tail.

## Implementation order

Smallest shippable slice first:

1. ✅ **Schema + form** — `matchType` and `mode` on the rule shape, the rules-page form, and the rule-list render; `v3→v4` migration backfills both. No blocking behavior.
2. ✅ **Limit checker** — pure `computeOverage(rules, { sitesByDay, sitesByHour, subpagesByDay, subpagesByHour }, now)`, wired into the flush alarm.
3. ✅ **DNR publisher** — `publishOverage` diffs the overage set against `getDynamicRules` and calls `updateDynamicRules`, redirecting matches to `blocked.html`. First real blocking.
4. ✅ **`blocked.html` polish** — reads `?rule=&site=&path=`; shows the blocked target, the limit (`<limit> per <period>`), and when the window next resets (local time, calendar-week aware), plus a "Manage rules" link. The inline script was moved to `blocked.js` (MV3 CSP forbids inline scripts).
5. ✅ **Block already-open tabs** — DNR only redirects new requests, so a tab already sitting on a page isn't blocked when its rule is published. After publishing, `reloadMatchingTabs` scans all open tabs against the **full** overage set (matching via the same `siteIdFromUrl`/`pathFromUrl` normalization as the checker) and navigates each match straight to its `blocked.html` URL — carrying the tab's exact current URL as `&url=`. Tabs already on `blocked.html` (a `chrome-extension://` URL) don't match, so there's no loop.
6. ✅ **React to rule edits immediately** — a `chrome.storage.onChanged` listener on the `rules` key re-runs the check outside the flush cadence, so enabling/disabling/adding/deleting a rule takes effect at once instead of on the next tick.
7. ✅ **Return tabs on unblock** — `returnUnblockedTabs` finds `blocked.html` tabs whose `?rule` id is no longer in the overage set (limit reset, rule disabled/deleted) and navigates them back. When a tab was blocked by our own `reloadMatchingTabs` (the common case — a tab already open on the site when the limit crossed), it carries the exact pre-block URL in `&url=` and returns there precisely.

8. ✅ **Pre-emptive block at navigation time** — a `chrome.webNavigation.onBeforeNavigate` listener (main frame, http(s)) runs `flushToStorage` + `flushSubpagesToStorage` then `checkEnforcement` before the page settles. `flushToStorage` drains the tracker's pending in-memory ranges up to *now*, so the check sees usage as current as this instant — catching a crossing that accrued since the last flush, which the flush-tick alone wouldn't surface for up to a minute. No tracking-internals access needed: it reuses the existing flush entry point. The freshly-published DNR rule plus `reloadMatchingTabs` then block the site immediately. (The earlier plan to read pending ranges directly was unnecessary once `flushToStorage` is called first.)
9. ✅ **Block tracking + rules page stats** — `publishOverage` writes to `blocksByDay` each time a block is newly triggered (keyed by `target|matchType|path`, not by UUID, so it survives rule edits). The rules page reads `blocksByDay` to render an overview card (blocks this week, most-blocked rule, active/total rule count, avg blocks/day) and a 7-day sparkline via `drawBarChart`.
10. ✅ **Two-column rules page layout** — the add form moves into a collapsible `#add-card` in the right column (auto-opens when `?target=` is set); left column holds the overview and sparkline cards. Type tabs (URL/host, Regex stub, Keyword stub) are added to the card header for future expansion.
11. ✅ **"Limit this site" button** — the site detail page gains a `#limit-btn` in `#header-right` that navigates to the rules page with `?target=<siteId>` pre-filled.

---

## Original wording kept verbatim

## Out of scope (v1)

- **Rules entry-point placement** — the rules page is reached from a button in the dashboard's `#header-left`, and from the popup's "Manage rules". This is the entry point for v1; no other placement is planned.
- **User-supplied regex matching** — the three structural scopes ship. (The publisher uses `regexFilter` internally for `host`/`pathPrefix`, but users can't enter arbitrary patterns.) A "Regex" tab is visible in the add card as a stub ("coming soon").
- **Keyword / page-title blocking** — rules match by host/subdomain/path only. Blocking by URL or page-title keyword is a future idea, not designed. A "Keyword" tab is visible in the add card as a stub ("coming soon").
- **Reachability check on save** — the target is validated as a registrable domain (`tldts` `getDomain`), but we don't test that the site actually resolves/responds.
- **Rolling-7-day week** — `week` is a calendar week (resets at the user-configured week boundary), consistent with how `day`/`hour` reset. A rolling 7-day window (sliding daily, matching the dashboard's "Last 7 days") is not offered; the calendar week is the intended semantics.
- **Week-start user setting** — the calendar week starts on any of the 7 weekdays as chosen via the settings page (`PREF_WEEK_START`, default Monday). `windowKeys` in [enforcement.js](../../src/background/enforcement.js) reads it via the `weekDow` helper in [src/shared/weekStart.js](../../src/shared/weekStart.js), which all weekly-window consumers (enforcement, the blocked-page countdown, the rules-page sparkline) share. Changing the setting mid-week shifts the active weekly limit boundary the first time, which is why the settings page gates the change behind a confirm dialog.
- **Redundancy beyond the add-time prompt** — the disable-redundant prompt fires only when *adding* a rule; existing rules aren't continuously re-checked against each other (e.g. loosening a rule later won't resurface a previously-disabled one). Overlapping rules that don't cover each other (different scopes that only partly intersect) coexist by design.

## References

> These three paths no longer exist in the repository; the links are kept as a record of what the original spec pointed at.

- Previous enforcement design (since removed; these files are no longer in the repo): `docs/archive/TRACKING_REDESIGN.md`, `docs/archive/REDESIGN_ISSUES.md`.
- General feature ideas / open questions: `docs/ideas/IDEAS.md`, kept outside the repo.
