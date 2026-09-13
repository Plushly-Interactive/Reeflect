export function initThemeMenu() {
  const btn = document.querySelector('#theme-btn');
  const dropdown = document.querySelector('#theme-dropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => dropdown.classList.remove('open'));

  dropdown.querySelectorAll('button').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.getAttribute('value');
      if (val === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', val);
      window.applyTheme();
      dropdown.classList.remove('open');
    });
  });
}
