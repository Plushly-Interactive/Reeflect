import { formatMs } from '../shared/timeUtils.js';
import { siteIdFromUrl } from './siteResolution.js';
import { intervalsSince } from '../data/intervalLog.js';
import { loadCore, timeJson } from '../shared/core.js';
import { siteUsageTodayMs } from '../vendor/reeflect-core/reeflect_core_wasm.js';
import { PREF_BADGE_ENABLED } from '../shared/prefKeys.js';

export const DEFAULT_BADGE_ENABLED = true;

export async function updateBadge() {
  const { [PREF_BADGE_ENABLED]: enabled = DEFAULT_BADGE_ENABLED } = await chrome.storage.local.get(PREF_BADGE_ENABLED);
  if (!enabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  let win;
  try {
    win = await chrome.windows.getLastFocused({ populate: true });
  } catch {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const tab = win?.tabs?.find(t => t.active);
  const siteId = siteIdFromUrl(tab?.url);
  if (!siteId) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  await loadCore();
  const ms = siteUsageTodayMs(JSON.stringify(await intervalsSince(startOfDay.getTime())), siteId, await timeJson(startOfDay.getTime(), now));
  // Badge background: use theme's --color-secondary (#688db5)
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#8d332c' });
  } catch {}
  chrome.action.setBadgeText({ text: ms > 0 ? formatMs(ms) : '' });
}
