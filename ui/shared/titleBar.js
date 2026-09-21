import { host } from './host.js';
import { initI18n, applyI18n, t } from './i18n.js';

// The app's own titlebar, on top of every page. The desktop window runs without native decorations,
// so this bar is the only way to move, maximize or close it — every button here is load-bearing.
// `data-tauri-drag-region` makes an area behave like a native titlebar: drag to move, double-click to
// maximize. It sits on the non-interactive parts only, or the buttons stop receiving clicks.
// The extension and the Android app have no window to drive: `host.windowControls` is null there and
// this module adds nothing.
const MAXIMIZE_ICON = '<rect x="4" y="4" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" />';
const RESTORE_ICON = '<path fill="none" stroke="currentColor" stroke-width="2" d="M8 8V4h12v12h-4M4 8h12v12H4z" />';

if (host.windowControls) {
  const win = host.windowControls;
  const bar = document.createElement('div');
  bar.id = 'titlebar';
  bar.setAttribute('data-tauri-drag-region', '');
  bar.innerHTML = `
    <div id="titlebar-brand" data-tauri-drag-region>
      <img id="titlebar-logo" src="${host.assetUrl('resources/icons/brand/logo.svg')}" alt="" />
      <span class="brand-word" data-tauri-drag-region>Reef<span>lect</span></span>
    </div>
    <div id="titlebar-drag" data-tauri-drag-region></div>
    <div id="titlebar-right" data-tauri-drag-region>
      <div id="titlebar-controls">
        <button id="titlebar-minimize" class="titlebar-ctl" type="button" data-i18n-title="titlebar_minimize" title="Minimize" data-i18n-aria="titlebar_minimize" aria-label="Minimize">
          <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M4 11.3h16v1.4H4z" /></svg>
        </button>
        <button id="titlebar-maximize" class="titlebar-ctl" type="button" title="Maximize" aria-label="Maximize">
          <svg id="titlebar-maximize-icon" viewBox="0 0 24 24" width="17" height="17">${MAXIMIZE_ICON}</svg>
        </button>
        <button id="titlebar-close" class="titlebar-ctl close" type="button" data-i18n-title="titlebar_close" title="Close" data-i18n-aria="titlebar_close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="2" d="M4.5 4.5l15 15M19.5 4.5l-15 15" /></svg>
        </button>
      </div>
    </div>`;
  document.body.prepend(bar);

  // The desktop window has no page header: the three groups of `header` move into this bar and the
  // header itself goes. A group a page fills later (a picker, a title) lands in the bar with it. At
  // 700px or less the page's own layout takes over, so the groups go back and the header shows.
  const header = document.querySelector('header');
  const groups = ['#header-left', '#header-center', '#header-right']
    .map((id) => document.querySelector(id))
    .filter(Boolean);
  const phone = matchMedia('(max-width: 700px)');
  function placeGroups() {
    const right = bar.querySelector('#titlebar-right');
    for (const group of groups) {
      if (phone.matches) header.append(group);
      else if (group.id === 'header-right') right.insertBefore(group, bar.querySelector('#titlebar-controls'));
      else bar.insertBefore(group, right);
    }
    header.style.display = phone.matches ? '' : 'none';
    bar.classList.toggle('has-groups', !phone.matches);
  }
  if (header && groups.length > 0) {
    // A group is a container, so the bar drags from it; its buttons stay clickable.
    for (const group of groups) group.setAttribute('data-tauri-drag-region', '');
    placeGroups();
    phone.addEventListener('change', placeGroups);
  }

  bar.querySelector('#titlebar-minimize').addEventListener('click', () => win.minimize());
  bar.querySelector('#titlebar-maximize').addEventListener('click', () => win.toggleMaximize());
  bar.querySelector('#titlebar-close').addEventListener('click', () => win.close());

  // The window can also be maximized by a double-click on the drag region or by the OS, so the button
  // reads the window back instead of tracking its own clicks.
  async function paintMaximized() {
    const maximized = await win.isMaximized();
    const label = t(maximized ? 'titlebar_restore' : 'titlebar_maximize');
    bar.querySelector('#titlebar-maximize-icon').innerHTML = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
    const button = bar.querySelector('#titlebar-maximize');
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  initI18n().then(() => {
    applyI18n(bar);
    paintMaximized();
    win.onResized(paintMaximized);
  });
}
