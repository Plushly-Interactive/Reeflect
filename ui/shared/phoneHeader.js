import { initI18n, t } from './i18n.js';

// Phone widths (700px or less, styled in theme.css): the header keeps one row. The period and
// device pickers move to a row of their own inside the header, and the page's header buttons
// open from a "more" button as a menu. The buttons are the same elements, so their listeners stay.
const phone = matchMedia('(max-width: 700px)');
const header = document.querySelector('header');
const center = document.querySelector('#header-center');
const actions = document.querySelector('#header-right');
const filters = [];

const filterRow = document.createElement('div');
filterRow.id = 'header-filters';
header.append(filterRow);

function placeFilters() {
  const target = phone.matches ? filterRow : center;
  for (const el of filters) target.append(el);
}

export function mountHeaderFilters(...els) {
  filters.push(...els);
  placeFilters();
}

let moreBtn = null;

function closeMenu() {
  actions.classList.remove('open');
  moreBtn.setAttribute('aria-expanded', 'false');
}

function placeActions() {
  actions.classList.toggle('dropdown-menu', phone.matches);
  closeMenu();
}

if (actions.children.length > 0) {
  moreBtn = document.createElement('button');
  moreBtn.id = 'header-more-btn';
  moreBtn.className = 'square-btn';
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.innerHTML = '<span class="icon-mask icon-more"></span>';
  header.append(moreBtn);
  initI18n().then(() => moreBtn.setAttribute('aria-label', t('common_more')));

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = actions.classList.toggle('open');
    moreBtn.setAttribute('aria-expanded', String(open));
  });
  // Any click closes it: on an item after that item's own listener ran, elsewhere as a dismiss.
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  placeActions();
}

phone.addEventListener('change', () => {
  placeFilters();
  if (moreBtn) placeActions();
});
