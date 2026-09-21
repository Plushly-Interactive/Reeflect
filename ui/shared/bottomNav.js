import { initI18n, applyI18n } from './i18n.js';

// Phone widths: the way between the four main pages (storage is reached from Settings), under the content. theme.css shows it at
// 700px or less; wider screens keep the header buttons. Each page marks the entry it belongs to.
const OWNER = {
  dashboard: 'nav-home', site: 'nav-home', path: 'nav-home',
  'browsing-timeline': 'nav-timeline',
  rules: 'nav-rules',
  settings: 'nav-settings', sync: 'nav-settings', quotes: 'nav-settings',
  'storage-management': 'nav-settings', 'legacy-storage-management': 'nav-settings',
};

const nav = document.createElement('nav');
nav.id = 'bottom-nav';
nav.innerHTML = `
  <a id="nav-home" class="bottom-nav-link" href="../dashboard/dashboard.html"><span class="icon-mask icon-home"></span><span data-i18n="nav_home">Home</span></a>
  <a id="nav-timeline" class="bottom-nav-link" href="../browsing-timeline/browsing-timeline.html"><span class="icon-mask icon-timeline"></span><span data-i18n="nav_timeline">Timeline</span></a>
  <a id="nav-rules" class="bottom-nav-link" href="../rules/rules.html"><span class="icon-mask icon-link"></span><span data-i18n="rules_pageTitle">Rules</span></a>
  <a id="nav-settings" class="bottom-nav-link" href="../settings/settings.html"><span class="icon-mask icon-gear"></span><span data-i18n="settings_pageTitle">Settings</span></a>`;
document.body.append(nav);

const current = nav.querySelector(`#${OWNER[location.pathname.split('/').at(-2)]}`);
if (current) {
  current.classList.add('active');
  current.setAttribute('aria-current', 'page');
}

initI18n().then(() => applyI18n(nav));
