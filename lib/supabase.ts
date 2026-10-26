import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
export const isConfigured = !!url && !!key;

// Missing preview configuration must never silently fall back to the live database.
export const supabase = createClient(url || 'http://127.0.0.1:54321', key || 'unconfigured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: {
    fetch: async (input, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const abort = () => controller.abort();
      if (init?.signal?.aborted) controller.abort();
      init?.signal?.addEventListener('abort', abort, { once: true });
      try { return await fetch(input, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', abort); }
    },
  },
});
