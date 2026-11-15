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
      const options = [...menu.querySelectorAll('button, input[type="checkbox"]')];
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
    const buttonStyle = getComputedStyle(btn);
    menu.style.font = buttonStyle.font;
    menu.style.letterSpacing = buttonStyle.letterSpacing;
    menu.classList.add('dropdown-menu-button-font');
    menu.classList.add('open');
    positionWideMenu(menu);
    btn.setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('button, input[type="checkbox"]')];
    (options.find(o => o.value === btn.dataset.value) ?? options[0])?.focus();
  }

  function closeMenu(menu) {
    menu.classList.remove('open');
    menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
  }

  function positionWideMenu(menu) {
    if (!menu.classList.contains('dropdown-menu-wide')) return;
    menu.style.setProperty('--dropdown-offset-x', '0px');
    const { left, right } = menu.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(menu).getPropertyValue('--dropdown-edge'));
    const offset = Math.max(edge - left, Math.min(0, document.documentElement.clientWidth - edge - right));
    menu.style.setProperty('--dropdown-offset-x', `${offset}px`);
  }

  if (root.querySelector('.dropdown-menu-wide')) {
    window.addEventListener('resize', () => {
      root.querySelectorAll('.dropdown-menu-wide.open').forEach(positionWideMenu);
    });
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

export function createCheckboxDropdown({ id, buttonId, labelId, menuId, label, ariaLabel = label, wide = false }) {
  const picker = document.createElement('div');
  picker.id = id;
  picker.className = 'custom-dropdown';
  picker.style.display = 'none';
  picker.innerHTML = `<button class="dropdown-btn" id="${buttonId}" data-value="all"><span id="${labelId}"></span><span class="dropdown-arrow"><svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg></span></button><div class="dropdown-menu" id="${menuId}"></div>`;
  picker.querySelector(`#${labelId}`).textContent = label;
  picker.querySelector(`#${buttonId}`).setAttribute('aria-label', ariaLabel);
  if (wide) picker.querySelector(`#${menuId}`).classList.add('dropdown-menu-wide');
  initCustomDropdowns(picker);
  return picker;
}

export function renderCheckboxOptions(menu, options, isChecked, onChange) {
  menu.classList.add('checkbox-dropdown-menu');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-labelledby', menu.previousElementSibling.id);
  menu.replaceChildren();
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'checkbox-dropdown-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = option.id ?? 'all';
    input.checked = isChecked(option.id);
    input.addEventListener('change', () => onChange(option.id, input.checked));
    const text = document.createElement('span');
    text.textContent = option.label;
    label.append(input, text);
    menu.append(label);
  }
  menu.onclick = e => e.stopPropagation();
}
