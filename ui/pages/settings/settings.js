import { autoStartIfMatches } from '../../shared/tour.js';
import { PREF_CLOCK_FORMAT, PREF_IDLE_THRESHOLD_SEC, PREF_WEEK_START, PREF_BADGE_ENABLED, PREF_LANGUAGE, DEFAULT_BADGE_ENABLED } from '../../shared/prefKeys.js';
import { WEEK_DAYS, DEFAULT_WEEK_START } from '../../shared/weekStart.js';
import { getIdleThresholdSec } from '../../shared/idleConfig.js';
import { initCustomDropdowns } from '../../shared/dropdown.js';
import { confirmDialog } from '../../shared/confirmDialog.js';
import { DEFAULT_CLOCK_FORMAT } from '../../shared/timeUtils.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { enhanceNumberInput } from '../../shared/numberInput.js';
import { CHART_COLOR_TYPES, applyChartColorOverrides, setChartColorOverride } from '../../shared/chartColors.js';
import { buildColorPicker } from '../../shared/colorPicker.js';
import { initI18n, applyI18n, t, DEFAULT_LANGUAGE } from '../../shared/i18n.js';
import { keyActivate, navButton } from '../../shared/utils.js';
import { syncState } from '../../shared/syncClient.js';
import { host } from '../../shared/host.js';
import { permissionStatus } from '../../shared/permissions.js';

await initI18n();
applyI18n();
document.title = `${t('settings_pageTitle')} - ${BRAND_NAME}`;
document.querySelector('#idle-threshold-desc').textContent = t('settings_idleThresholdDesc', [BRAND_NAME]);
keyActivate(document.querySelector('#back-btn'), [' ']);

const appVersion = host.version();
document.querySelector('#version-number').textContent = `${BRAND_NAME} v${appVersion}`;
document.querySelector('#version-changes-link').href = `https://github.com/Plushly-Interactive/Reeflect/releases/tag/v${appVersion}`;

const CLOCK_FORMATS = ['24h', '12h'];
const LANGUAGES = ['auto', 'en', 'fr', 'es'];
const LANGUAGE_NAMES = { en: 'English', fr: 'Français', es: 'Español' };

const idleInput = document.querySelector('#idle-threshold-input');
const weekStartBtn = document.querySelector('#week-start-btn');
const weekStartMenu = document.querySelector('#week-start-menu');
const clockFormatBtn = document.querySelector('#clock-format-btn');
const clockFormatMenu = document.querySelector('#clock-format-menu');
const badgeEnabledInput = document.querySelector('#badge-enabled-input');
const languageBtn = document.querySelector('#language-btn');
const languageMenu = document.querySelector('#language-menu');

function languageLabel(code) {
  return code === DEFAULT_LANGUAGE ? t('settings_languageAuto') : LANGUAGE_NAMES[code];
}

function dayLabel(name) {
  return t(`weekday_${name}`);
}

const stored = await host.prefs.get([PREF_WEEK_START, PREF_CLOCK_FORMAT, PREF_BADGE_ENABLED, PREF_LANGUAGE]);
const idleSec = await getIdleThresholdSec();
idleInput.value = Math.round(idleSec / 60);

let lastConfirmedDay = WEEK_DAYS.includes(stored[PREF_WEEK_START]) ? stored[PREF_WEEK_START] : DEFAULT_WEEK_START;
weekStartBtn.dataset.value = lastConfirmedDay;
weekStartBtn.firstChild.textContent = dayLabel(lastConfirmedDay);

badgeEnabledInput.checked = stored[PREF_BADGE_ENABLED] ?? DEFAULT_BADGE_ENABLED;

let currentClockFormat = CLOCK_FORMATS.includes(stored[PREF_CLOCK_FORMAT]) ? stored[PREF_CLOCK_FORMAT] : DEFAULT_CLOCK_FORMAT;
clockFormatBtn.dataset.value = currentClockFormat;
clockFormatBtn.firstChild.textContent = currentClockFormat;

let currentLanguage = LANGUAGES.includes(stored[PREF_LANGUAGE]) ? stored[PREF_LANGUAGE] : DEFAULT_LANGUAGE;
languageBtn.dataset.value = currentLanguage;
languageBtn.firstChild.textContent = languageLabel(currentLanguage);

function rebuildLanguageMenu() {
  languageMenu.replaceChildren();
  for (const code of LANGUAGES) {
    if (code === currentLanguage) continue;
    const opt = document.createElement('button');
    opt.value = code;
    opt.textContent = languageLabel(code);
    opt.addEventListener('click', onLanguagePick, { capture: true });
    languageMenu.append(opt);
  }
}

async function onLanguagePick(e) {
  e.stopPropagation();
  currentLanguage = e.currentTarget.value;
  languageMenu.classList.remove('open');
  await host.prefs.set({ [PREF_LANGUAGE]: currentLanguage });
  location.reload();
}

rebuildLanguageMenu();

function rebuildClockFormatMenu() {
  clockFormatMenu.replaceChildren();
  for (const fmt of CLOCK_FORMATS) {
    if (fmt === currentClockFormat) continue;
    const opt = document.createElement('button');
    opt.value = fmt;
    opt.textContent = fmt;
    opt.addEventListener('click', onClockFormatPick, { capture: true });
    clockFormatMenu.append(opt);
  }
}

function onClockFormatPick(e) {
  e.stopPropagation();
  currentClockFormat = e.currentTarget.value;
  clockFormatBtn.dataset.value = currentClockFormat;
  clockFormatBtn.firstChild.textContent = currentClockFormat;
  clockFormatMenu.classList.remove('open');
  host.prefs.set({ [PREF_CLOCK_FORMAT]: currentClockFormat });
  rebuildClockFormatMenu();
}

rebuildClockFormatMenu();

// Theme: the same localStorage key theme.js and the popup's theme menu use; no key means "system".
const THEMES = ['system', 'light', 'dark'];
const themeBtn = document.querySelector('#theme-btn');
const themeMenu = document.querySelector('#theme-menu');
let currentTheme = THEMES.includes(localStorage.getItem('theme')) ? localStorage.getItem('theme') : 'system';
themeBtn.dataset.value = currentTheme;
themeBtn.firstChild.textContent = t(`theme_${currentTheme}`);

function rebuildThemeMenu() {
  themeMenu.replaceChildren();
  for (const theme of THEMES) {
    if (theme === currentTheme) continue;
    const opt = document.createElement('button');
    opt.value = theme;
    opt.textContent = t(`theme_${theme}`);
    opt.addEventListener('click', onThemePick, { capture: true });
    themeMenu.append(opt);
  }
}

function onThemePick(e) {
  e.stopPropagation();
  currentTheme = e.currentTarget.value;
  themeBtn.dataset.value = currentTheme;
  themeBtn.firstChild.textContent = t(`theme_${currentTheme}`);
  themeMenu.classList.remove('open');
  if (currentTheme === 'system') localStorage.removeItem('theme');
  else localStorage.setItem('theme', currentTheme);
  window.applyTheme();
  rebuildThemeMenu();
}

rebuildThemeMenu();

function rebuildWeekStartMenu() {
  weekStartMenu.replaceChildren();
  for (const name of WEEK_DAYS) {
    if (name === lastConfirmedDay) continue;
    const opt = document.createElement('button');
    opt.value = name;
    opt.textContent = dayLabel(name);
    opt.addEventListener('click', onWeekStartPick, { capture: true });
    weekStartMenu.append(opt);
  }
}

async function onWeekStartPick(e) {
  e.stopPropagation();
  const newValue = e.currentTarget.value;
  const ok = await confirmDialog({ message: t(weekStartBtn.dataset.i18nConfirm) });
  if (!ok) return;
  lastConfirmedDay = newValue;
  weekStartBtn.dataset.value = newValue;
  weekStartBtn.firstChild.textContent = dayLabel(newValue);
  weekStartMenu.classList.remove('open');
  await host.prefs.set({ [PREF_WEEK_START]: newValue });
  rebuildWeekStartMenu();
}

rebuildWeekStartMenu();
initCustomDropdowns(document);

await applyChartColorOverrides();
const rootStyle = getComputedStyle(document.documentElement);
const chartColorPickers = [];
for (const { type, cssVar } of CHART_COLOR_TYPES) {
  const picker = buildColorPicker(`chart-color-${type}`, rootStyle.getPropertyValue(cssVar).trim(), async (color) => {
    await setChartColorOverride(type, color);
    if (!color) picker.setValue(rootStyle.getPropertyValue(cssVar).trim());
  }, { labelledBy: `chart-color-${type}-label` });
  chartColorPickers.push({ picker, type, cssVar });
}

const COLORBLIND_PALETTE = { time: '#d55e00', audio: '#0072b2', visits: '#cc79a7', hourly: '#767676', idle: '#009e73' };

document.querySelector('#chart-colors-colorblind').addEventListener('click', async () => {
  for (const { picker, type } of chartColorPickers) {
    await setChartColorOverride(type, COLORBLIND_PALETTE[type]);
    picker.setValue(COLORBLIND_PALETTE[type]);
  }
});

document.querySelector('#chart-colors-reset').addEventListener('click', async () => {
  const ok = await confirmDialog({ message: t('settings_resetColorsConfirm') });
  if (!ok) return;
  for (const { picker, type, cssVar } of chartColorPickers) {
    await setChartColorOverride(type, null);
    picker.setValue(rootStyle.getPropertyValue(cssVar).trim());
  }
});

badgeEnabledInput.addEventListener('change', () => {
  host.prefs.set({ [PREF_BADGE_ENABLED]: badgeEnabledInput.checked });
});

idleInput.addEventListener('change', async () => {
  const minutes = Math.max(1, Math.round(Number(idleInput.value)));
  idleInput.value = minutes;
  await host.prefs.set({ [PREF_IDLE_THRESHOLD_SEC]: minutes * 60 });
});

enhanceNumberInput('idle-threshold-input');

autoStartIfMatches('settings', [
  {
    selector: '#settings-main',
    title: t('tour_settings_main_title'),
    body: t('tour_settings_main_body'),  },
  {
    selector: '#storage-manage-btn',
    title: t('tour_dash_storage_title'),
    body: t('tour_dash_storage_body'),
    handoff: { nextSurface: 'storage-management', mode: 'inPage' },  },
]);

// Sync card: a state line plus the way into the sync page, which owns every action.
navButton(document.querySelector('#sync-manage-btn'), '../sync/sync.html');
navButton(document.querySelector('#storage-manage-btn'), '../storage-management/storage-management.html');

// Android only: the two permissions the tracker and the shield need, granted on system screens.
document.querySelector('#badge-card').style.display = host.features.badge ? '' : 'none';
for (const card of document.querySelectorAll('.android-card')) card.style.display = host.tracker ? '' : 'none';
if (host.tracker) {
  const usageBtn = document.querySelector('#usage-access-btn');
  const blockingBtn = document.querySelector('#blocking-btn');
  const notificationsBtn = document.querySelector('#notifications-btn');
  const refresh = async () => {
    const { usageAccess, accessibility, notifications } = await permissionStatus();
    notificationsBtn.textContent = t(notifications ? 'settings_granted' : 'settings_grant');
    notificationsBtn.disabled = notifications;
    usageBtn.textContent = t(usageAccess ? 'settings_granted' : 'settings_grant');
    usageBtn.disabled = usageAccess;
    blockingBtn.textContent = t(accessibility ? 'settings_granted' : 'settings_grant');
    blockingBtn.disabled = accessibility;
  };
  usageBtn.addEventListener('click', () => host.tracker.openUsageSettings());
  blockingBtn.addEventListener('click', () => host.tracker.openAccessibilitySettings());
  notificationsBtn.addEventListener('click', async () => { await host.tracker.requestNotifications(); await refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  await refresh();
}
const SYNC_STATE_KEYS = { off: 'settings_syncOff', on: 'settings_syncOn', signedOut: 'settings_syncSignedOut' };
document.querySelector('#sync-state-desc').textContent = t(SYNC_STATE_KEYS[await syncState()]);
