# Conventions

TL;DR: how to write code in Reeflect. Every rule here is binding. The reasoning behind the longer ones is in `docs/appendix/coding-conventions.md`.

## Project context
- Browser extension for Vivaldi (Chromium, Manifest V3).
- Goal: collect browsing data and block sites once a time limit (hour / day / week) is reached.

## How we work together
- Work incrementally, one step at a time, in natural order.
- Before creating or deleting a file, say what and why. Wait for confirmation.
- Before adding a tool or dependency, explain what it does and why it is needed now.
- When there are several ways to do something, present the options and let me choose.
- Cite your sources when answering technical questions.
- Explain each step, and each new function, listener or block of code, as if I am learning.
- Short answers, no walls of text. If I push back, reconsider instead of defending the first answer.

## Code style
- Minimal: only what the current step needs.
- No comments unless the logic is genuinely non-obvious.
- No abstractions or helpers until there is a concrete reason.
- Never write migration code alongside functional code. Suggest it afterwards.
- Prefix unused parameters with `_`.

## JavaScript, HTML, CSS
- Every interactive element gets an `id` and is selected with `querySelector('#id')`, never `getElementById`. Elements generated in a loop get no id — reach them through closure, `dataset`, or `event.currentTarget`.
- Style with classes, select with ids. An element can carry both.
- Never duplicate CSS or JS. Reuse the shared class or function, and extract a new shared file once a second caller appears.
- Shared by 2+ pages goes to `ui/shared/`; storage logic (migrations, import, pruning) to `extension/src/data/`; service-worker APIs (alarms, DNR, tab and window tracking) to `extension/src/background/`.
- Never use a native `<select>` or `<input type="date">` — use `shared/dropdown.js` and `shared/datePicker.js`. A native `<input type="number">` is fine, paired with `enhanceNumberInput()` from `shared/numberInput.js`.
- SVG `<title>` tooltips are unreliable in Chromium. Never use them.
- Write a close or clear "×" as the `&times;` entity, always assigned through `innerHTML`.
- Toggle visibility from JS with `element.style.display = 'none'` / `''`. Use the `hidden` attribute only for a static initial state in HTML, cleared with `removeAttribute('hidden')`.
- Pages, shared modules and the data layer touch the platform only through `ui/shared/host.js` (`host.prefs` is `chrome.storage.local` in the extension; URLs, tabs, permissions and language behind it too). Never through `background.js`; `chrome.*` appears only in `extension/src/background/` and `host.js`.
- A `<button>` that navigates uses `navButton(el, url)` from `ui/shared/utils.js`.
- Background logging goes through `dbg()` from `extension/src/background/trackingDebug.js`. No bare `console.log`, and no user URLs outside `dbg()`. Every new tracking feature adds `dbg()` calls at its decision points.
- Preference and view-state key names live in `ui/shared/prefKeys.js`, read-query dispatch tags in `ui/shared/queryTypes.js` — but only once a second file needs them.
- Two storage tiers, never mixed:
  - Persistent settings (`idleThresholdSec`, `weekStart`) in `chrome.storage.local`, surfaced on the settings page, each with a `DEFAULT_*` constant in the module that owns it.
  - Per-tab view state (`hideBrief`, `mergeMode`, `groupMode`, `subpagesStripParams`, `timeRange`) in `sessionStorage`, never on the settings page.

## Internationalization
- A new user-facing string goes into `ui/_locales/en/messages.json` and every other `ui/_locales/<lang>/messages.json` in the same step. Never leave a key English-only.
- All strings go through `ui/shared/i18n.js`: `t(key, subs)` in JS; `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria` in markup, hydrated by `applyI18n(root)`. Use `data-i18n-firstchild` when the element has non-text children after the label, such as an SVG arrow.
- Substitution is positional (`$1`, `$2`) only, never named `$FOO$`.
- Each entry is one inline line: `"key": { "message": "..." },`. Never spread an entry over several lines.
- Translated locales carry `message` only. `description` is an English-only translator hint.
- The active language is `PREF_LANGUAGE` in `chrome.storage.local`, set on the settings page. Changing it reloads the page; there is no live re-render.
- Weekday and month names come from `Intl.DateTimeFormat`, never hardcoded arrays.
- Plurals use `_one` / `_other` key suffixes with manual dispatch. No ICU MessageFormat.
- Exception: changelog bullet text in `ui/shared/changelogEntries.js` carries its own inline `{ en, es, fr }`. Static changelog interface text still follows the rule above.

## Page layout
- Each full-page view is `ui/pages/<name>/<name>.{html,css,js}`.
- Every full-page view reuses the shared header in `theme.css` (75px, three-column grid). Never redefine `header` per page. The popup is exempt.
- Back navigation is an `<a id="back-btn">` wrapping the brand logo (`BRAND_NAME` in `ui/shared/brand.js`) inside `#header-left`. Never a text "Back to dashboard" button.
- `legacy-storage-management` deliberately reuses `storage-management.css`. Only skip the triplet this way for a near-duplicate page.

## Versioning and releases
- Semver on `manifest.json`: PATCH for fixes and internal work, MINOR for user-visible capability or changed behaviour, MAJOR for a breaking change to stored data or a removed feature.
- A version is spent the moment it lands in `manifest.json`. Never reopen it — roll forward with a new PATCH.
- Every release gets a `vX.Y.Z` tag on `main` and a matching GitHub release. Never reuse a published tag.
- Any release a user would notice gets an entry in `ui/shared/changelogEntries.js`. Skip it for pure-internal patches.
- An entry's `version` equals the `manifest.json` version it ships with; bump both in one commit.
- Entries are append-only, oldest to newest. Never insert one below the newest.

## Testing
- I test manually in Vivaldi. You verify visual changes with `node scripts/os/capture.mjs`, and enforcement or sync behaviour with the `scripts/os/*-smoke.mjs` scripts, which drive real profiles. Never load the extension any other way. For anything capture cannot show, say the change is code-complete but unverified, and tell me what to check.
