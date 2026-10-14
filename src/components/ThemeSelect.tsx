import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
declare global {
  interface Window {
    companionTheme: { read: () => Theme; error: () => string; set: (value: string) => void };
  }
}

export default function ThemeSelect() {
  const [theme, setTheme] = useState(window.companionTheme.read);
  const [error, setError] = useState(window.companionTheme.error);
  useEffect(() => {
    const update = () => { setTheme(window.companionTheme.read()); setError(window.companionTheme.error()); };
    window.addEventListener('themechange', update);
    return () => window.removeEventListener('themechange', update);
  }, []);
  return <div className="theme-control"><label htmlFor="theme">Theme</label>
    <select id="theme" value={theme} aria-describedby={error ? 'theme-error' : undefined} onChange={event => window.companionTheme.set(event.target.value)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
    {error && <p id="theme-error" className="muted" role="status">{error}</p>}
  </div>;
}
