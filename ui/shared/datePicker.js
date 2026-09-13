import { rotatedDayLabels, weekDow } from './weekStart.js';
import { localDayKey, formatHourLabel } from './timeUtils.js';
import { t, getLocale } from './i18n.js';

function monthName(m) {
  return new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(new Date(2023, m, 1));
}
const PREV_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const NEXT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>';
const YEAR_SPAN = 15;

export function getDateValue(id) {
  return document.querySelector(`#${id} .dropdown-btn`).dataset.value || '';
}

export function buildDatePicker(id, initDateStr, onChange, { labelledBy } = {}) {
  const wrap = document.querySelector(`#${id}`);
  wrap.dataset.direction = 'up';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = `${id}-btn`;
  btn.className = 'dropdown-btn';
  btn.dataset.value = initDateStr || '';
  // Combine the external row label (e.g. "From") with the button's own visible
  // text (the picked date) — see buildColorPicker for the same pattern.
  if (labelledBy) btn.setAttribute('aria-labelledby', `${labelledBy} ${btn.id}`);
  btn.innerHTML = `<span class="date-btn-label">${initDateStr || t('datePicker_selectDate')}</span><span class="icon-mask icon-calendar date-btn-icon"></span>`;
  btn.querySelector('.date-btn-label').title = initDateStr || t('datePicker_selectDate');

  const popup = document.createElement('div');
  popup.className = 'dropdown-menu calendar-popup';

  const yearRow = document.createElement('div');
  yearRow.className = 'nav-strip calendar-year-row';
  const yearWrap = document.createElement('span');
  yearWrap.className = 'custom-dropdown';
  const yearBtn = document.createElement('button');
  yearBtn.type = 'button';
  yearBtn.className = 'link-btn cal-year-btn';
  const yearMenu = document.createElement('div');
  yearMenu.className = 'dropdown-menu year-menu';
  yearWrap.append(yearBtn, yearMenu);
  yearRow.append(yearWrap);

  const navStrip = document.createElement('div');
  navStrip.className = 'nav-strip calendar-nav-strip';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'link-btn nav-arrow-btn';
  prevBtn.innerHTML = PREV_ICON;
  const monthLabel = document.createElement('span');
  monthLabel.className = 'nav-period-label';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'link-btn nav-arrow-btn';
  nextBtn.innerHTML = NEXT_ICON;
  navStrip.append(prevBtn, monthLabel, nextBtn);

  const weekdaysRow = document.createElement('div');
  weekdaysRow.className = 'calendar-weekdays';

  const daysWrap = document.createElement('div');
  daysWrap.className = 'calendar-days-wrap';
  const daysGrid = document.createElement('div');
  daysGrid.className = 'calendar-days';
  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'link-btn cal-today-btn';
  todayBtn.textContent = t('stat_today');
  daysWrap.append(daysGrid, todayBtn);

  popup.append(yearRow, navStrip, weekdaysRow, daysWrap);
  wrap.append(btn, popup);
  popup.addEventListener('click', e => {
    e.stopPropagation();
    if (!yearWrap.contains(e.target)) yearMenu.classList.remove('open');
  });

  const initDate = initDateStr ? new Date(`${initDateStr}T00:00:00`) : new Date();
  let viewYear = initDate.getFullYear();
  let viewMonth = initDate.getMonth();

  function renderYearMenu() {
    yearMenu.innerHTML = '';
    const maxYear = new Date().getFullYear();
    for (let y = viewYear - YEAR_SPAN; y <= Math.min(viewYear + YEAR_SPAN, maxYear); y++) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.textContent = y;
      if (y === viewYear) opt.classList.add('is-selected');
      opt.addEventListener('click', () => {
        viewYear = y;
        yearMenu.classList.remove('open');
        renderMonth();
      });
      yearMenu.appendChild(opt);
    }
  }

  function renderMonth() {
    yearBtn.textContent = viewYear;
    monthLabel.textContent = monthName(viewMonth);

    weekdaysRow.innerHTML = '';
    for (const label of rotatedDayLabels()) {
      const span = document.createElement('span');
      span.textContent = label;
      weekdaysRow.appendChild(span);
    }

    daysGrid.innerHTML = '';
    const leading = weekDow(new Date(viewYear, viewMonth, 1));
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = localDayKey(Date.now());
    const selectedKey = btn.dataset.value;

    for (let i = 0; i < leading; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-day cal-day-blank';
      daysGrid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const key = localDayKey(new Date(viewYear, viewMonth, d).getTime());
      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'cal-day';
      dayBtn.dataset.day = d;
      if (key === todayKey) { dayBtn.classList.add('today'); dayBtn.setAttribute('aria-current', 'date'); }
      if (key === selectedKey) { dayBtn.classList.add('is-selected'); dayBtn.setAttribute('aria-selected', 'true'); }
      dayBtn.textContent = d;
      dayBtn.addEventListener('click', () => {
        btn.dataset.value = key;
        const label = btn.querySelector('.date-btn-label');
        label.textContent = key;
        label.title = key;
        popup.classList.remove('open');
        if (onChange) onChange();
      });
      daysGrid.appendChild(dayBtn);
    }

    const trailing = 42 - leading - daysInMonth;
    for (let i = 0; i < trailing; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-day cal-day-blank';
      daysGrid.appendChild(blank);
    }
  }
  renderMonth();

  function focusDay(day) {
    daysGrid.querySelector(`[data-day="${day}"]`)?.focus();
  }

  // Arrow-key roving across the day grid, including crossing month boundaries —
  // relies on the Date constructor normalizing out-of-range days (e.g. day 0 or
  // day 32) into the adjacent month, rather than manual month-length math.
  daysGrid.addEventListener('keydown', e => {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const isEdge = e.key === 'Home' || e.key === 'End';
    if (!(e.key in deltas) && !isEdge) return;
    const currentDay = Number(document.activeElement?.dataset.day);
    if (!currentDay) return;
    e.preventDefault();
    const target = e.key === 'Home' ? new Date(viewYear, viewMonth, 1)
      : e.key === 'End' ? new Date(viewYear, viewMonth + 1, 0)
      : new Date(viewYear, viewMonth, currentDay + deltas[e.key]);
    if (target.getFullYear() !== viewYear || target.getMonth() !== viewMonth) {
      viewYear = target.getFullYear();
      viewMonth = target.getMonth();
      renderMonth();
    }
    focusDay(target.getDate());
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popup.classList.contains('open');
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) {
      renderMonth();
      popup.classList.add('open');
      // Move focus into the grid on open (selected day, else today, else the
      // 1st) — otherwise focus stays on btn and arrow keys never reach daysGrid.
      (daysGrid.querySelector('button.is-selected') ?? daysGrid.querySelector('button.today') ?? daysGrid.querySelector('button.cal-day'))?.focus();
    }
  });
  popup.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (yearMenu.classList.contains('open')) { yearMenu.classList.remove('open'); yearBtn.focus(); return; }
    popup.classList.remove('open');
    btn.focus();
  });
  prevBtn.addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderMonth();
  });
  nextBtn.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMonth();
  });
  todayBtn.addEventListener('click', () => {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    const key = localDayKey(now.getTime());
    btn.dataset.value = key;
    const label = btn.querySelector('.date-btn-label');
    label.textContent = key;
    label.title = key;
    popup.classList.remove('open');
    if (onChange) onChange();
  });
  yearBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = yearMenu.classList.contains('open');
    document.querySelectorAll('.dropdown-menu.open').forEach(m => { if (!m.contains(yearMenu)) m.classList.remove('open'); });
    if (isOpen) {
      yearMenu.classList.remove('open');
    } else {
      renderYearMenu();
      yearMenu.classList.add('open');
      yearMenu.querySelector('.is-selected')?.scrollIntoView({ block: 'center' });
    }
  });
}

// h === 24 is the "midnight, next day" end-of-range sentinel, so it gets its
// own label instead of formatHourLabel's normal 0-23 wraparound.
function hourLabel(h, clockFormat) {
  if (h === 24) return clockFormat === '12h' ? t('storage_midnightPlus1_12h') : t('storage_midnightPlus1_24h');
  return formatHourLabel(h, clockFormat);
}

export function getHourValue(id) {
  return parseInt(document.querySelector(`#${id} .dropdown-btn`).dataset.value, 10);
}

// Same click-only dropdown shape as initCustomDropdowns (shared/dropdown.js),
// but built from scratch here since options are numeric hours generated on the
// fly rather than static HTML — so it needs its own copy of the same keyboard
// model (aria-haspopup/expanded, role=menu/menuitem, arrow-key roving, Escape).
export function buildHourDropdown(id, initHour, clockFormat, onChange, { labelledBy } = {}) {
  const wrap = document.querySelector(`#${id}`);
  wrap.dataset.direction = 'up';
  const btn = document.createElement('button');
  btn.id = `${id}-btn`;
  btn.className = 'dropdown-btn';
  btn.dataset.value = initHour;
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  if (labelledBy) btn.setAttribute('aria-labelledby', `${labelledBy} ${btn.id}`);
  btn.innerHTML = `${hourLabel(initHour, clockFormat)}<span class="dropdown-arrow"><svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg></span>`;
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.setAttribute('role', 'menu');
  for (let h = 0; h <= 24; h++) {
    const opt = document.createElement('button');
    opt.value = h;
    opt.textContent = hourLabel(h, clockFormat);
    opt.setAttribute('role', 'menuitem');
    opt.tabIndex = -1;
    menu.appendChild(opt);
  }
  wrap.append(btn, menu);

  function closeMenu() {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('button')];
    (options.find(o => o.value === btn.dataset.value) ?? options[0])?.focus();
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    if (isOpen) closeMenu(); else openMenu();
  });
  menu.addEventListener('keydown', e => {
    const options = [...menu.querySelectorAll('button')];
    const i = options.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      options[(i + 1) % options.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      options[(i - 1 + options.length) % options.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      btn.focus();
    }
  });
  menu.querySelectorAll('button').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      btn.firstChild.textContent = opt.textContent;
      btn.dataset.value = opt.value;
      closeMenu();
      btn.focus();
      if (onChange) onChange();
    });
  });
}
