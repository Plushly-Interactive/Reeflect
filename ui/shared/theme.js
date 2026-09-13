(function () {
  function applyTheme() {
    const pref = localStorage.getItem('theme') ?? 'system';
    const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('storage', applyTheme);
  window.applyTheme = applyTheme;
})();
