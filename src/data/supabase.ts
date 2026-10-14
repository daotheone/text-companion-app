import { createClient } from '@supabase/supabase-js';

function configure() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { client: null, error: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Vite.' };
  try { return { client: createClient(url, key), error: '' }; }
  catch { return { client: null, error: 'Invalid Supabase configuration. Check your project URL and public key, then restart Vite.' }; }
}

export const { client: supabase, error: configurationError } = configure();
