import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
declare global {
  interface Window {
    companionTheme: { read: () => Theme; error: () => string; set: (value: string) => void };
  }
}

const themeNames = { system: 'System', light: 'Light', dark: 'Dark' };

export default function ThemeButton() {
  const [theme, setTheme] = useState(window.companionTheme.read);
  const [error, setError] = useState(window.companionTheme.error);
  useEffect(() => {
    const update = () => { setTheme(window.companionTheme.read()); setError(window.companionTheme.error()); };
    window.addEventListener('themechange', update);
    return () => window.removeEventListener('themechange', update);
  }, []);
  const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const label = `Theme: ${themeNames[theme]}. Switch to ${themeNames[next]} theme.`;
  return <>
    <button id="theme" className="theme-button" type="button" aria-label={label} title={label}
      aria-describedby={error ? 'theme-error' : undefined} onClick={() => window.companionTheme.set(next)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'system' ? <><rect x="3" y="4" width="18" height="13" rx="1" /><path d="M8 21h8m-4-4v4" /></>
          : theme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
            : <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5 8.5 8.5 0 1 0 9.5 9.5Z" />}
      </svg>
    </button>
    {error && <p id="theme-error" className="muted" role="status">{error}</p>}
  </>;
}
