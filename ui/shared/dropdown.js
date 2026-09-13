// Wires the standard custom-dropdown pattern (`.custom-dropdown` → `.dropdown-btn` +
// `.dropdown-menu`) within `root`: click the button to toggle, click an option to
// update the button's visible label + `dataset.value` and close the menu, click
// anywhere else to close any open menu. Specific dropdowns that need their own
// click logic (theme picker, rules-form matchtype, device picker) opt out via id.
//
// Keyboard model (menu-button pattern): the trigger gets aria-haspopup/expanded;
// opening moves focus to the selected option (or the first one), Arrow Up/Down
// roves focus among options (wrapping), Escape closes and returns focus to the
// trigger, Enter/Space activates the focused option via its own click handler.
// Options carry tabindex="-1" — reachable only via the roving arrow keys once
// the menu is open, not via Tab.
export function initCustomDropdowns(root = document) {
  root.querySelectorAll('.dropdown-btn').forEach(btn => {
    const menu = btn.nextElementSibling;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('role', 'menu');
    menu.querySelectorAll('button').forEach(opt => {
      opt.setAttribute('role', 'menuitem');
      opt.tabIndex = -1;
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      root.querySelectorAll('.dropdown-menu.open').forEach(m => closeMenu(m));
      if (!isOpen) openMenu(menu, btn);
    });

    menu.addEventListener('keydown', (e) => {
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
        closeMenu(menu);
        btn.focus();
      }
    });
  });

  function openMenu(menu, btn) {
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('button')];
    (options.find(o => o.value === btn.dataset.value) ?? options[0])?.focus();
  }

  function closeMenu(menu) {
    menu.classList.remove('open');
    menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
  }

  root.querySelectorAll('.dropdown-menu:not(#theme-dropdown):not(#form-matchtype-menu):not(#device-menu) button').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = option.parentElement;
      const btn = menu.previousElementSibling;
      btn.firstChild.textContent = option.textContent;
      btn.dataset.value = option.value;
      closeMenu(menu);
      btn.focus();
    });
  });

  document.addEventListener('click', () => {
    root.querySelectorAll('.dropdown-menu.open').forEach(m => closeMenu(m));
  });
}
