import { QUOTES } from './quotes.data.js';
import { host } from './host.js';

const TIME_OF_DAY_HOURS = {
  morning:   [6, 7, 8, 9, 10],
  afternoon: [11, 12, 13, 14, 15, 16],
  evening:   [17, 18, 19, 20, 21, 22],
  night:     [23, 0, 1, 2, 3, 4, 5],
};

function currentTimeOfDay() {
  const h = new Date().getHours();
  for (const [timeOfDay, hours] of Object.entries(TIME_OF_DAY_HOURS)) {
    if (hours.includes(h)) return timeOfDay;
  }
  return 'morning';
}

// Pure selection — no storage side effects. Returns { quote, resetSeen }.
// resetSeen is true when the chosen pool was fully seen and the cycle reset.
export function selectQuote(siteTarget = '', seenIds = []) {
  const timeOfDay = currentTimeOfDay();
  const inTimeOfDay = QUOTES.filter(q => q.timeOfDay === timeOfDay);

  const signature = inTimeOfDay.filter(q => q.signature);
  const siteMatch = inTimeOfDay.filter(q => q.site && siteTarget.includes(q.site) && !q.signature);
  const regular   = inTimeOfDay.filter(q => !q.site && !q.signature);

  let pool;
  if (signature.length && Math.random() < 0.10) pool = signature;
  else if (siteMatch.length && Math.random() < 0.5) pool = siteMatch;
  else if (regular.length) pool = regular;
  else pool = inTimeOfDay; // fallback: anything in this time of day

  if (!pool.length) return { quote: null, resetSeen: false };

  const unseen = pool.filter(q => !seenIds.includes(q.id));
  const resetSeen = unseen.length === 0;
  const candidates = resetSeen ? pool : unseen;
  const quote = candidates[Math.floor(Math.random() * candidates.length)];

  return { quote, resetSeen };
}

// Loads seenIds from storage, picks a quote, saves the updated list.
export async function pickQuote(siteTarget = '') {
  let seenIds = [];
  try {
    const stored = await host.prefs.get('seenQuoteIds');
    seenIds = stored.seenQuoteIds ?? [];
  } catch (_) { /* storage unavailable — proceed without tracking */ }

  const { quote, resetSeen } = selectQuote(siteTarget, seenIds);
  if (!quote) return null;

  try {
    const next = resetSeen ? [quote.id] : [...seenIds, quote.id];
    await host.prefs.set({ seenQuoteIds: next });
  } catch (_) { /* best effort */ }

  return quote;
}
