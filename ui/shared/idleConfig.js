import { PREF_IDLE_THRESHOLD_SEC } from './prefKeys.js';
import { host } from './host.js';

export const DEFAULT_IDLE_THRESHOLD_SEC = 300;

// Chrome's chrome.idle.setDetectionInterval requires >= 15 seconds.
export async function getIdleThresholdSec() {
  const stored = (await host.prefs.get(PREF_IDLE_THRESHOLD_SEC))[PREF_IDLE_THRESHOLD_SEC];
  return Number.isFinite(stored) && stored >= 15 ? stored : DEFAULT_IDLE_THRESHOLD_SEC;
}
