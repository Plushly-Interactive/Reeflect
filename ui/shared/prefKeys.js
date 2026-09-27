import { host } from './host.js';
export const PREF_CLOCK_FORMAT = 'clockFormat';
export const PREF_HIDE_BRIEF = 'hideBrief';
export const PREF_IDLE_THRESHOLD_SEC = 'idleThresholdSec';
export const PREF_WEEK_START = 'weekStart';
export const PREF_LAST_EXPORT_AT = 'lastExportAt';
export const PREF_BADGE_ENABLED = 'badgeEnabled';
export const PREF_FIRST_BROWSE_BY_DAY = 'firstBrowseByDay';
export const PREF_FAVORITE_QUOTE_IDS = 'favoriteQuoteIds';
export const PREF_LANGUAGE = 'language';
export const PREF_CHART_COLORS = 'chartColors';

// Hidden dev toggle, not exposed on settings page. Off by default before
// release; enable manually via console: host.prefs.set({quotesEnabled: true})
export const PREF_QUOTES_ENABLED = 'quotesEnabled';
// The badge is the extension's toolbar counter; its default lives here so the settings page needs no background module.
export const DEFAULT_BADGE_ENABLED = true;
// Android: read browsers' address bars (the web shield). Rust reads the same key from prefs.json.
export const PREF_WEB_IN_BROWSERS = 'webInBrowsers';
export const DEFAULT_WEB_IN_BROWSERS = false;
