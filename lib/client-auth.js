export function getStoredAuthToken() {
  if (typeof window === 'undefined') return '';
  const fromSession = String(window.sessionStorage.getItem('gbz:auth-token') || '').trim();
  if (fromSession) return fromSession;

  // one-time legacy fallback from old localStorage auth
  const fromLocal = String(window.localStorage.getItem('gbz:auth-token') || '').trim();
  if (fromLocal) {
    window.sessionStorage.setItem('gbz:auth-token', fromLocal);
    window.localStorage.removeItem('gbz:auth-token');
    return fromLocal;
  }
  return '';
}

export function setStoredAuthToken(token = '') {
  if (typeof window === 'undefined') return;
  if (token) {
    window.sessionStorage.setItem('gbz:auth-token', token);
    window.localStorage.removeItem('gbz:auth-token');
  } else {
    window.sessionStorage.removeItem('gbz:auth-token');
    window.localStorage.removeItem('gbz:auth-token');
  }
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
