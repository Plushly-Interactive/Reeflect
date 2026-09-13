// Reference host implementation of `Time` for JavaScript hosts (the extension copies this).
// Mirrors core/src/time.rs `Time::from_system`: offsets from `windowStartMs` through now + 7 days,
// as `[effectiveFromMs, offsetMs]` pairs, first entry open-ended. Found by scanning days and
// bisecting each change to the millisecond, using only `Date.getTimezoneOffset()`.
const DAY = 86_400_000;

export function offsetAt(ms) {
  return -new Date(ms).getTimezoneOffset() * 60_000;
}

function bisectTransition(lo, hi) {
  const before = offsetAt(lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function buildTime(weekStart, windowStartMs, nowMs = Date.now()) {
  const start = Math.min(windowStartMs, nowMs);
  const end = nowMs + 7 * DAY;
  const offsets = [[Number.MIN_SAFE_INTEGER, offsetAt(start)]];
  let t = start;
  let off = offsetAt(start);
  while (t < end) {
    const next = Math.min(t + DAY, end);
    const o = offsetAt(next);
    if (o !== off) {
      const at = bisectTransition(t, next);
      offsets.push([at, o]);
      off = o;
    }
    t = next;
  }
  return { nowMs, offsets, weekStart };
}
