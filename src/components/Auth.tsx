import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configurationError, supabase } from '../data/supabase';
import App from '../App';
import ThemeButton from './ThemeButton';

export default function Auth() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [restoring, setRestoring] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      authEvent = true;
      if (active) { setSession(next); setWorkspace(previous => previous ?? next); setLoading(false); setPassword(''); }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEvent) return;
      setSession(data.session);
      setWorkspace(previous => previous ?? data.session);
      setError(error?.message ?? '');
      setLoading(false);
    }).catch(cause => {
      if (active) { setError(cause instanceof Error ? cause.message : 'Session restore failed'); setLoading(false); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [restoring]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
      if (result.error) throw result.error;
      setPassword('');
      if (mode === 'signup' && !result.data.session) setMessage('Check your email to confirm your account, then log in.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Login failed'); }
    finally { setBusy(false); }
  };

  if (workspace) return <App key={workspace.user.id} userId={workspace.user.id} email={workspace.user.email ?? ''}
    authenticated={session?.user.id === workspace.user.id} onLeave={signedOut => setWorkspace(signedOut ? null : session)} />;
  return <main className="auth-screen"><section className="auth-panel" aria-label="Account">
    <header className="brand"><h1>text companion</h1><ThemeButton /><p>A little room for your day.</p></header>
    {configurationError ? <div role="alert" className="storage-error">{configurationError}</div>
      : loading ? <p role="status">Restoring your session…</p>
        : <><h2 id="auth-title">{mode === 'login' ? 'Log in' : 'Create account'}</h2><p className="muted">Keep your habits, tasks, and notes with you.</p>
          <form onSubmit={submit}><fieldset disabled={busy}>
            <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
            <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 6 : undefined} value={password} onChange={event => setPassword(event.target.value)} required />
            {error && <p className="storage-error" role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <div className="actions"><button type="submit">{busy ? '[Please wait…]' : mode === 'login' ? '[Log in]' : '[Create account]'}</button>
              <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>{mode === 'login' ? '[Create account]' : '[Back to log in]'}</button></div>
          </fieldset></form>
          <button disabled={busy} onClick={() => { setLoading(true); setRestoring(value => !value); }}>[Retry session]</button>
        </>}
  </section></main>;
}
