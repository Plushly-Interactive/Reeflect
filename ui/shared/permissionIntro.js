// Android's first screen: the three grants, one panel at a time, swiped sideways. It runs before the
// tour and returns on every launch until the user reaches the last panel. The dashboard subheader
// reminds afterwards. A grant happens on a system screen, so the panels re-read their state on return.
import { host } from './host.js';
import { t } from './i18n.js';
import { BRAND_NAME } from './brand.js';
import { ANDROID_PERMISSIONS, permissionStatus, missingPermissions } from './permissions.js';

const INTRO_KEY = 'permissionIntroDone';

export async function permissionIntroDone() {
  const { [INTRO_KEY]: done } = await host.prefs.get(INTRO_KEY);
  return done === true;
}

// Resolves once the user leaves the screen. `startIndex` opens on one panel, for the subheader.
export function showPermissionIntro({ startIndex = 0 } = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const root = document.createElement('div');
    root.id = 'permission-intro';
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <p id="permission-intro-heading"></p>
      <div id="permission-intro-track"></div>
      <div id="permission-intro-footer">
        <div id="permission-intro-dots"></div>
        <div id="permission-intro-actions">
          <button id="permission-intro-later" type="button" class="link-btn"></button>
          <button id="permission-intro-next" type="button" class="btn"></button>
        </div>
      </div>`;
    document.body.append(root);

    const track = document.querySelector('#permission-intro-track');
    const dots = document.querySelector('#permission-intro-dots');
    const laterBtn = document.querySelector('#permission-intro-later');
    const nextBtn = document.querySelector('#permission-intro-next');
    document.querySelector('#permission-intro-heading').textContent = t('permIntro_heading', [BRAND_NAME]);
    laterBtn.textContent = t('permIntro_later');

    // Panels and dots are generated, so they carry no id; the closure holds them.
    const panels = ANDROID_PERMISSIONS.map((perm, index) => {
      const panel = document.createElement('section');
      panel.className = 'permission-panel';
      panel.innerHTML = `
        <div class="permission-step"></div>
        <h2 class="permission-title"></h2>
        <p class="permission-body"></p>
        <button type="button" class="btn permission-grant"></button>`;
      panel.querySelector('.permission-step').textContent = String(index + 1);
      panel.querySelector('.permission-title').textContent = t(perm.titleKey);
      panel.querySelector('.permission-body').textContent = t(perm.bodyKey);
      const grantBtn = panel.querySelector('.permission-grant');
      grantBtn.addEventListener('click', async () => {
        await perm.grant();
        await refresh();
      });
      track.append(panel);

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'permission-dot';
      dot.setAttribute('aria-label', t('permIntro_stepAria', [String(index + 1)]));
      dot.addEventListener('click', () => goTo(index));
      dots.append(dot);

      return { perm, grantBtn, dot };
    });

    let current = Math.max(0, Math.min(panels.length - 1, startIndex));

    function paintFooter() {
      panels.forEach(({ dot }, index) => dot.classList.toggle('is-current', index === current));
      nextBtn.textContent = t(current === panels.length - 1 ? 'permIntro_done' : 'permIntro_next');
    }

    function goTo(index) {
      current = Math.max(0, Math.min(panels.length - 1, index));
      track.scrollTo({ left: track.clientWidth * current, behavior: 'smooth' });
      paintFooter();
    }

    // Reads the live grants. A grant that just landed hands the screen to the next open panel; a plain
    // return to the app moves nothing, so a user who scrolled back keeps the panel they chose.
    let lastStatus = null;
    async function refresh() {
      const status = await permissionStatus();
      panels.forEach(({ perm, grantBtn }) => {
        const granted = !!status[perm.field];
        grantBtn.textContent = t(granted ? 'settings_granted' : 'settings_grant');
        grantBtn.disabled = granted;
      });
      const landed = lastStatus && status[panels[current].perm.field] && !lastStatus[panels[current].perm.field];
      lastStatus = status;
      const openIndex = panels.findIndex(({ perm }) => !status[perm.field]);
      if (landed && openIndex > current) goTo(openIndex);
      return status;
    }

    function onScroll() {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      if (index === current) return;
      current = index;
      paintFooter();
    }

    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') close(false);
      else if (event.key === 'ArrowRight') goTo(current + 1);
      else if (event.key === 'ArrowLeft') goTo(current - 1);
    }

    async function close(finished) {
      track.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('keydown', onKeydown);
      root.remove();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
      if (finished) await host.prefs.set({ [INTRO_KEY]: true });
      resolve({ finished });
    }

    laterBtn.addEventListener('click', () => close(false));
    nextBtn.addEventListener('click', () => {
      if (current === panels.length - 1) close(true);
      else goTo(current + 1);
    });
    track.addEventListener('scroll', onScroll);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('keydown', onKeydown);

    paintFooter();
    track.scrollLeft = track.clientWidth * current;
    root.focus();
    refresh().then((status) => {
      // Nothing left to ask for: the screen is done without the user walking it.
      if (ANDROID_PERMISSIONS.every(perm => status[perm.field])) close(true);
    });
  });
}

// The first-launch call: shows nothing off Android, and nothing once the user walked the panels.
export async function maybeShowPermissionIntro() {
  if (!host.tracker) return false;
  if (await permissionIntroDone()) return false;
  const missing = await missingPermissions();
  if (!missing.length) {
    await host.prefs.set({ [INTRO_KEY]: true });
    return false;
  }
  await showPermissionIntro();
  return true;
}
