import { getRules, renderRuleList } from '../../shared/rules.js';
import { loadFaviconCache } from '../../shared/utils.js';
import { autoStartIfMatches, readTourState } from '../../shared/tour.js';
import { initThemeMenu } from '../../shared/themeMenu.js';
import { localDayKey, formatMs, formatHourLabel, formatHourRange, formatTimeOfDay } from '../../shared/timeUtils.js';
import { PREF_CLOCK_FORMAT, PREF_FIRST_BROWSE_BY_DAY } from '../../shared/prefKeys.js';
import { loadMergedTrackingData } from '../../data/mergeDataSources.js';
import { getWallByHour, getFirstBrowseByDay } from '../../data/intervalAggregates.js';
import { QUERY_SITES_BY_DAY, QUERY_SITES_BY_HOUR_TODAY, QUERY_AVG_PER_CLOCK_HOUR } from '../../shared/queryTypes.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();

document.querySelector('#dashboard-btn').addEventListener('click', async () => {
  const state = await readTourState();
  const inTourHandoff = state.inProgress?.surface === 'popup' || state.inProgress?.surface === 'dashboard';
  const existing = inTourHandoff ? await host.findPage('dashboard') : null;
  if (existing) {
    await host.prefs.set({ tourAdvanceRequest: Date.now() });
    await host.focusPage(existing);
    window.close();
    return;
  }
  host.openPage('dashboard');
  window.close();
});

const rulesList = document.querySelector('#rules-list');

// The popup is a glanceable list + launcher; all rule editing lives on the
// dedicated rules page, opened here.
document.querySelector('#manage-btn').addEventListener('click', () => {
  host.openPage('rules');
  window.close();
});

async function renderTodayStats() {
  const today = localDayKey(Date.now());
  const currentHour = new Date().getHours();

  const [sitesByDay, todayHours, wallByHour, intervalFirstBrowse, { [PREF_CLOCK_FORMAT]: clockFormat = '24h', [PREF_FIRST_BROWSE_BY_DAY]: firstBrowseByDay = {} }] =
    await Promise.all([
      loadMergedTrackingData({ type: QUERY_SITES_BY_DAY }),
      loadMergedTrackingData({ type: QUERY_SITES_BY_HOUR_TODAY }),
      getWallByHour(),
      getFirstBrowseByDay(),
      host.prefs.get([PREF_CLOCK_FORMAT, PREF_FIRST_BROWSE_BY_DAY]),
    ]);
  const mergedFirstBrowse = { ...firstBrowseByDay, ...intervalFirstBrowse };

  const todaySites = sitesByDay[today] ?? {};
  const browsing = c => (c?.activeMs ?? 0) + (c?.audioMs ?? 0) - (c?.overlapMs ?? 0);

  // TODAY — wall-clock per hour (union across all parallel windows); falls back to
  // per-site sum for any hour not yet in wallByHour (e.g. legacy bucket hours).
  const hourWallMs = h => {
    const hourKey = `${today}T${String(h).padStart(2, '0')}`;
    if (wallByHour[hourKey] != null) return wallByHour[hourKey];
    return Object.values(todayHours[hourKey] ?? {}).reduce((s, c) => s + browsing(c), 0);
  };
  let totalMs = 0;
  for (let h = 0; h <= currentHour; h++) totalMs += hourWallMs(h);
  document.querySelector('#stats-total-time').textContent = totalMs > 0 ? formatMs(totalMs) : '—';

  // SITES
  const sitesCount = Object.values(todaySites).filter(c => (c.visits ?? 0) > 0 || (c.activeMs ?? 0) > 0).length;
  document.querySelector('#stats-sites-count').textContent = sitesCount > 0 ? sitesCount : '—';

  // VS AVG — compare today-so-far (hours 0→now) against same window averaged across past days
  const pastDayKeys = Object.keys(sitesByDay).filter(k => k !== today).sort().slice(-7);
  let avgMs = 0;
  if (pastDayKeys.length > 0) {
    const avgPerHour = await loadMergedTrackingData({ type: QUERY_AVG_PER_CLOCK_HOUR, dayKeys: pastDayKeys });
    avgMs = avgPerHour.slice(0, currentHour + 1).reduce((s, v) => s + v, 0);
  }
  if (avgMs > 0) {
    const diff = totalMs - avgMs;
    document.querySelector('#stats-vs-avg').textContent = (diff >= 0 ? '+' : '-') + formatMs(Math.abs(diff));
  }

  // PEAK HOUR + FIRST BROWSE + CHART
  const hourMs = Array.from({ length: 24 }, (_, h) => {
    const hourKey = `${today}T${String(h).padStart(2, '0')}`;
    const bucket = todayHours[hourKey] ?? {};
    return {
      ms: hourWallMs(h),
      visits: Object.values(bucket).reduce((s, c) => s + (c.visits ?? 0), 0),
    };
  });
  let peakHour = -1, peakMs = 0, firstBrowseHour = -1;
  for (let h = 0; h < 24; h++) {
    if (hourMs[h].ms > peakMs) { peakMs = hourMs[h].ms; peakHour = h; }
    if (firstBrowseHour === -1 && (hourMs[h].ms > 0 || hourMs[h].visits > 0)) firstBrowseHour = h;
  }
  document.querySelector('#stats-peak-hour').textContent =
    peakHour >= 0 ? formatHourRange(peakHour, '–', clockFormat) : '—';
  const firstBrowseTs = mergedFirstBrowse[today];
  document.querySelector('#stats-first-browse').textContent =
    firstBrowseTs ? formatTimeOfDay(firstBrowseTs, clockFormat)
    : firstBrowseHour >= 0 ? formatHourLabel(firstBrowseHour, clockFormat)
    : '—';

  // SESSIONS
  const sessions = Object.values(todaySites).reduce((s, c) => s + (c.visits ?? 0), 0);
  document.querySelector('#stats-sessions').textContent = sessions > 0 ? sessions : '—';

  // IDLE
  const idleMs = Object.values(todaySites).reduce((s, c) => s + (c.idleMs ?? 0), 0);
  document.querySelector('#stats-idle').textContent = idleMs > 0 ? formatMs(idleMs) : '—';

  renderHourChart(hourMs, clockFormat);
}

function renderHourChart(hourMs, clockFormat) {
  const svg = document.querySelector('#stats-hour-chart');
  const W = svg.clientWidth || 166;
  const H = svg.clientHeight || 50;
  const LABEL_H = 14;
  const innerH = H - LABEL_H;
  const currentHour = new Date().getHours();
  const maxMs = Math.max(...hourMs.slice(0, currentHour + 1).map(h => h.ms), 1);
  const style = getComputedStyle(document.documentElement);
  const colorActive = style.getPropertyValue('--color-accent-light').trim();
  const colorCurrent = style.getPropertyValue('--color-accent').trim();
  const colorBorder = style.getPropertyValue('--color-border').trim();
  const colorText = style.getPropertyValue('--color-text-secondary').trim();
  const gap = W / 24;
  const barW = Math.max(1, Math.floor(gap) - 1);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const rects = hourMs.map(({ ms }, h) => {
    const x = (h * gap).toFixed(1);
    if (h > currentHour) return '';
    const barH = ms > 0 ? Math.max(2, Math.round((ms / maxMs) * innerH)) : 2;
    const y = innerH - barH;
    const fill = h === currentHour ? colorCurrent : (ms > 0 ? colorActive : colorBorder);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${fill}" rx="1"/>
      <rect data-hour="${h}" x="${x}" y="0" width="${barW}" height="${innerH}" fill="transparent"/>`;
  }).join('');

  const labels = [0, 6, 12, 18].map(h => {
    const x = h === 0 ? 1 : (h * gap).toFixed(1);
    const anchor = h === 0 ? 'start' : 'middle';
    return `<text x="${x}" y="${H - 2}" text-anchor="${anchor}" font-size="9" fill="${colorText}">${formatHourLabel(h, clockFormat)}</text>`;
  }).join('') + `<text x="${(W - 1).toFixed(1)}" y="${H - 2}" text-anchor="end" font-size="9" fill="${colorText}">${formatHourLabel(0, clockFormat)}</text>`;

  svg.innerHTML = rects + labels;

  const tooltip = document.querySelector('#stats-chart-tooltip');
  svg.querySelectorAll('rect[data-hour]').forEach(rect => {
    const h = Number(rect.dataset.hour);
    const ms = hourMs[h]?.ms ?? 0;
    const from = `${String(h).padStart(2, '0')}:00`;
    const to = `${String(h + 1).padStart(2, '0')}:00`;
    const val = h > currentHour ? t('popup_tooltip_notYet') : (ms > 0 ? formatMs(ms) : t('popup_tooltip_noActivity'));
    const label = `${from}–${to} · ${val}`;
    rect.tabIndex = 0;
    rect.setAttribute('aria-label', label);
    const showTooltip = () => { tooltip.textContent = label; tooltip.removeAttribute('hidden'); };
    rect.addEventListener('mouseenter', showTooltip);
    rect.addEventListener('focus', () => {
      showTooltip();
      const box = rect.getBoundingClientRect();
      tooltip.style.left = `${box.right + 12}px`;
      tooltip.style.top = `${box.top - 22}px`;
    });
    rect.addEventListener('mousemove', e => {
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY - 32}px`;
    });
    rect.addEventListener('mouseleave', () => tooltip.setAttribute('hidden', ''));
    rect.addEventListener('blur', () => tooltip.setAttribute('hidden', ''));
  });
}

async function renderRules() {
  const rules = (await getRules()).filter(r => r.enabled);
  const noRulesMsg = document.querySelector('#no-rules-message');

  if (rules.length === 0) {
    noRulesMsg.textContent = t('popup_noRules');
    noRulesMsg.classList.add('visible', 'text-meta');
  } else {
    noRulesMsg.classList.remove('visible', 'text-meta');
  }

  renderRuleList(rulesList, rules, { readonly: true });
}

loadFaviconCache().then(() => {
  renderTodayStats();
  renderRules();
});

initThemeMenu();

function popupTourSteps() { return [
  {
    selector: '#brand',
    title: t('tour_popup_intro_title'),
    body: t('tour_popup_intro_body'),
  },
  {
    selector: '#manage-btn',
    title: t('tour_popup_manage_title'),
    body: t('tour_popup_manage_body'),
    handoff: { nextSurface: 'rules', mode: 'crossDocument' },
  },
]; }

(async () => {
  const state = await readTourState();
  if (state.completed || state.inProgress?.surface !== 'popup') return;
  autoStartIfMatches('popup', popupTourSteps(), { showCloseButton: false });
})();
