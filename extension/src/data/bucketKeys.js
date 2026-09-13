// Storage keys for the legacy scalar bucket tier (read-only post-cutover). The
// interval log is the live tracker; these maps are kept only for the stitch
// fallback and import/export.
export const SITES_DAY_KEY = 'sitesByDay';
export const SITES_HOUR_KEY = 'sitesByHour';
export const WALLCLOCK_HOUR_KEY = 'wallClockByHour';
export const SUBPAGES_DAY_KEY = 'subpagesByDay';
export const SUBPAGES_HOUR_KEY = 'subpagesByHour';
