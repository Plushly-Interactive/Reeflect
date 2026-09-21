import { getRules, renderRuleList } from '../../shared/rules.js';
import { loadFaviconCache } from '../../shared/utils.js';
import { autoStartIfMatches, readTourState } from '../../shared/tour.js';
import { initThemeMenu } from '../../shared/themeMenu.js';
import { formatMs, formatHourLabel } from '../../shared/timeUtils.js';
import { PREF_CLOCK_FORMAT } from '../../shared/prefKeys.js';
import { periodStats, formatPeriodStats } from '../../shared/periodStats.js';
import { onRefreshed } from '../../data/intervalAggregates.js';
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
  const [stats, { [PREF_CLOCK_FORMAT]: clockFormat = '24h' }] =
    await Promise.all([periodStats('today'), host.prefs.get([PREF_CLOCK_FORMAT])]);
  const text = formatPeriodStats(stats, clockFormat);
  document.querySelector('#stats-total-time').textContent = text.total;
  document.querySelector('#stats-sites-count').textContent = text.sites;
  document.querySelector('#stats-vs-avg').textContent = text.vs;
  document.querySelector('#stats-peak-hour').textContent = text.peakHour;
  document.querySelector('#stats-first-browse').textContent = text.firstBrowse;
  document.querySelector('#stats-sessions').textContent = text.visits;
  document.querySelector('#stats-idle').textContent = text.idle;
  renderHourChart(stats.hourMs, clockFormat);
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

onRefreshed(renderTodayStats);
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
