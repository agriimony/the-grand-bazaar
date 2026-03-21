export function getStoredAuthToken() {
  if (typeof window === 'undefined') return '';
  return String(window.localStorage.getItem('gbz:auth-token') || '').trim();
}

export function setStoredAuthToken(token = '') {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem('gbz:auth-token', token);
  else window.localStorage.removeItem('gbz:auth-token');
}

export function decodeTokenUnsafe(token = '') {
  try {
    const [body] = String(token || '').split('.');
    if (!body) return null;
    const raw = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function fetchSession(token = '') {
  if (!token) return { ok: false, error: 'missing_token' };
  try {
    const r = await fetch('/api/auth/session', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    return d;
  } catch {
    return { ok: false, error: 'session_check_failed' };
  }
}
