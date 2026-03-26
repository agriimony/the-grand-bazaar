import { createClient } from '@supabase/supabase-js';

let client = null;
let debugHooksAttached = false;

function debugEnabled() {
  return String(process.env.NEXT_PUBLIC_SUPABASE_DEBUG || '').toLowerCase() === 'true';
}

function attachRealtimeDebugHooks(sb, url) {
  if (!debugEnabled() || debugHooksAttached || !sb?.realtime) return;
  debugHooksAttached = true;
  const rt = sb.realtime;

  try {
    console.log('[supabase-debug] init', { url, online: typeof navigator !== 'undefined' ? navigator.onLine : undefined });
  } catch {}

  try {
    if (typeof rt.onOpen === 'function') rt.onOpen(() => console.log('[supabase-debug] realtime open'));
    if (typeof rt.onClose === 'function') rt.onClose((e) => console.warn('[supabase-debug] realtime close', e));
    if (typeof rt.onError === 'function') rt.onError((e) => console.error('[supabase-debug] realtime error', e));
  } catch (e) {
    console.warn('[supabase-debug] failed attaching realtime hooks', e);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => console.log('[supabase-debug] browser online'));
    window.addEventListener('offline', () => console.warn('[supabase-debug] browser offline'));
    document.addEventListener('visibilitychange', () => {
      console.log('[supabase-debug] visibility', document.visibilityState);
    });
  }
}

export function getSupabaseBrowserClient(url, key) {
  const u = String(url || '').trim();
  const k = String(key || '').trim();
  if (!u || !k) return null;

  if (!client) {
    client = createClient(u, k, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    attachRealtimeDebugHooks(client, u);
  }

  return client;
}
