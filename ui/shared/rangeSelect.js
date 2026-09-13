import { initCustomDropdowns } from './dropdown.js';
import { t } from './i18n.js';

const RANGE_OPT_KEYS = {
  today: 'range_today',
  '7': 'range_7',
  '30': 'range_30',
  '180': 'range_180',
  '365': 'range_365',
  all: 'range_all',
};

export function createRangeDropdown() {
  const div = document.createElement('div');
  div.className = 'custom-dropdown';
  div.innerHTML = `<button class="dropdown-btn" id="range-select" data-value="7">${t('range_7')}<span class="dropdown-arrow"><svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg></span></button>
    <div class="dropdown-menu">
      <button value="today">${t('range_today')}</button>
      <button value="7">${t('range_7')}</button>
      <button value="30">${t('range_30')}</button>
      <button value="180">${t('range_180')}</button>
      <button value="365">${t('range_365')}</button>
      <button value="all">${t('range_all')}</button>
    </div>`;
  return div;
}

export function initRangeSelect(rangeSelect, onChange) {
  const savedRange = sessionStorage.getItem('timeRange') || '7';
  rangeSelect.dataset.value = savedRange;
  rangeSelect.firstChild.textContent = t(RANGE_OPT_KEYS[savedRange]);

  initCustomDropdowns(rangeSelect.parentElement);

  rangeSelect.parentElement.querySelectorAll('.dropdown-menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      sessionStorage.setItem('timeRange', btn.value);
      onChange();
    });
  });
}
