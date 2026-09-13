# Blocked page quotes

TL;DR: a quote is displayed at the bottom of the blocked page card. Every quote belongs to a time-of-day bucket (morning / afternoon / evening / night) and may optionally be site-specific or marked as a signature quote. The system favors quotes the user hasn't seen yet, cycling through the full pool before repeating.

## User stories

- As a user, I want to see a short quote when I'm blocked so the interruption feels intentional rather than punitive.
- As a user, I want the quotes to vary and eventually cycle so they don't feel stale.
- As a user, I want to add my own signature quotes so the feature reflects my own voice.

## Acceptance criteria

- A quote is displayed on every blocked page load.
- Every quote has a `timeOfDay`; the draw prefers quotes matching the current time of day.
- Signature quotes (`signature: true`) have a 10% chance of being selected; they are drawn first, before site-specific and regular quotes.
- Site-specific quotes (`site` field set) within the current bucket have a 50% chance of being selected when the blocked site matches.
- Otherwise a regular quote from the current bucket is drawn.
- In all three tiers (signature / site / regular), unseen quotes are preferred; when all quotes in a tier+bucket are exhausted, `seenQuoteIds` resets and cycling begins again.
- If a quote has no author, only the quote text is shown (no "— " attribution line).
- Seen quote IDs are persisted in `chrome.storage.local` and survive service-worker restarts.

## Scope

### Surfaces involved


| Surface                     | Role                                           |
| --------------------------- | ---------------------------------------------- |
| `ui/pages/blocked/`        | Renders the quote and runs the selection logic |
| `ui/shared/quotes.js`      | Selection logic (`selectQuote`, `pickQuote`)   |
| `ui/shared/quotes.data.js` | Quote data array                               |


### Files likely to change


| File                             | Change                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `ui/pages/blocked/blocked.html` | Already has `#quote` and `#quote-author` elements                             |
| `ui/pages/blocked/blocked.js`   | Calls `pickQuote()`, renders quote text, source link, author, philosophy link |
| `ui/shared/quotes.js`           | `selectQuote()` and `pickQuote()` — selection and storage logic               |
| `ui/shared/quotes.data.js`      | Quote data array — general, site-specific, and signature quotes               |


### Storage / tracking


| Key            | Shape      | Read by     | Written by  | Notes                                                                                                              |
| -------------- | ---------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `seenQuoteIds` | `string[]` | `quotes.js` | `quotes.js` | IDs of quotes shown at least once; reset to `[]` when all non-signature quotes in the active bucket have been seen |


### Quote object format

```js
{
  id: 'string',                // stable kebab-case slug, never reuse or rename
  text: 'string',
  author?: 'string',           // required for general quotes; omit for anonymous; mascot name + emoji for signature quotes
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night',
  site?: 'string',             // substring matched against blocked site (e.g. 'youtube', 'reddit')
  signature?: true,            // mascot character quotes (PwetPwet 🦈, Toot 🦊) — 10% draw chance
  source?: 'string',           // URL containing the quote text — required for general quotes; omit for site-specific and signature quotes
  philosophySource?: 'string', // URL to author's broader work — optional for general quotes; omit for site-specific and signature quotes
}
```

Time-of-day ranges (local hour):

- **morning** — 6–10
- **afternoon** — 11–16
- **evening** — 17–22
- **night** — 23–5

### Selection algorithm

Given the current bucket `B` and blocked site target `T`:

1. **Signature tier** — if `Math.random() < 0.10`: draw from mascot signature quotes in `timeOfDay` `B`, preferring unseen.
2. **Site tier** — else if any site quotes in bucket `B` match `T` and `Math.random() < 0.5`: draw from those, preferring unseen.
3. **Regular tier** — else: draw from non-signature, non-site quotes in bucket `B`, preferring unseen.
4. In each tier, "preferring unseen" means: filter to IDs not in `seenQuoteIds`; if none remain, reset `seenQuoteIds` to `[]` and use the full tier set.
5. Save the drawn quote's `id` to `seenQuoteIds`.

### Signature quotes

Signature quotes are mascot character quotes written by the team, added in the `// SIGNATURE` section of `quotes.data.js`. Current mascots: PwetPwet 🦈 (playful tiny shark) and Toot 🦊 (philosophical tiny fox). They participate in the same `timeOfDay` and seen-tracking system as built-in quotes. See the curation doc for authorship rules and character tone guidelines.

## Edge cases

- No quotes defined: render nothing — `#quote` stays hidden.
- Storage read fails: fall back to a random draw from the full bucket without tracking.
- Current bucket has no quotes of the drawn tier: fall through to the next tier rather than showing nothing.

