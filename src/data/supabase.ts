import { createClient } from '@supabase/supabase-js';

export function configure(url?: string, key?: string) {
  url = url?.trim();
  key = key?.trim();
  const error = 'Invalid Supabase configuration. Set VITE_SUPABASE_URL to your project origin (https://<project-ref>.supabase.co) and VITE_SUPABASE_PUBLISHABLE_KEY to its public key (or use VITE_SUPABASE_ANON_KEY). Update .env.local and restart Vite; on Vercel, update build environment variables and redeploy.';
  if (!url || !key) return { client: null, error };
  try {
    const project = new URL(url);
    if (!(project.protocol === 'https:' || project.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(project.hostname))
      || project.username || project.password || project.search || project.hash
      || !['/', '/rest/v1', '/rest/v1/'].includes(project.pathname)) return { client: null, error };
    return { client: createClient(project.origin, key), error: '' };
  } catch { return { client: null, error }; }
}

export const { client: supabase, error: configurationError } = configure(
  import.meta.env?.VITE_SUPABASE_URL,
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY,
);
