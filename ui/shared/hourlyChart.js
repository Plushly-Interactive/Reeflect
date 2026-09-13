import { buildHourlyBuckets, drawHourlyChart } from './overview.js';
import { t } from './i18n.js';

export function createHourlyChart({ chart, tooltip, container, subheading, notRelevant, allDaysLabel, getRangeValue, loadAvgPerHour, clockFormat = '24h' }) {
  const cache = {};

  async function load(range) {
    if (cache[range]) return;
    cache[range] = await loadAvgPerHour(range);
  }

  function subheadingText(range) {
    if (range === 'all') return allDaysLabel;
    return t('hourly_pastDays', [parseInt(range)]);
  }

  function render(range) {
    container.style.display = 'block';

    if (range === 'today') {
      chart.style.display = 'none';
      subheading.textContent = '';
      notRelevant.textContent = t('hourly_notTodayRelevant');
      notRelevant.style.display = 'block';
      return;
    }

    subheading.textContent = subheadingText(range);

    if (!cache[range]) {
      load(range).then(() => render(getRangeValue()));
      return;
    }

    const data = buildHourlyBuckets(cache[range], clockFormat);
    const hasData = data.some(d => d.activeMs > 0);
    if (!hasData) {
      chart.style.display = 'none';
      notRelevant.textContent = t('hourly_noPastData');
      notRelevant.style.display = 'block';
      return;
    }

    chart.style.display = 'block';
    notRelevant.style.display = 'none';
    drawHourlyChart({ svgEl: chart, tooltipEl: tooltip, data });
  }

  return {
    render,
    clearCache() { Object.keys(cache).forEach(k => delete cache[k]); },
  };
}
