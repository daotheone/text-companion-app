// Blocking startup and runtime share this browser-local preference, never account data.
(() => {
  const key = 'text-companion-theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'light' || value === 'dark' ? value : 'system';
  let preference = 'system';
  let error = '';
  try { preference = valid(localStorage.getItem(key)); }
  catch { error = 'Browser theme preference could not be read. Using System.'; }
  const apply = () => {
    document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    window.dispatchEvent(new Event('themechange'));
  };
  window.companionTheme = {
    read: () => preference,
    error: () => error,
    set(value) {
      preference = valid(value);
      try { localStorage.setItem(key, preference); error = ''; }
      catch { error = 'Theme applies to this tab; browser could not remember it.'; }
      apply();
    },
  };
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === key || event.key === null)) {
      preference = valid(event.newValue);
      error = '';
      apply();
    }
  });
  media.addEventListener('change', apply);
  apply();
})();
