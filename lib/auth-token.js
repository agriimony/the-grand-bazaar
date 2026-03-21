import crypto from 'crypto';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function secret() {
  return process.env.GBZ_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-insecure-change-me';
}

export function signToken(payload = {}) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token = '') {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return { ok: false, error: 'malformed' };
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig !== expected) return { ok: false, error: 'bad_signature' };
  try {
    const payload = JSON.parse(fromB64url(body));
    if (payload?.exp && Date.now() > Number(payload.exp)) return { ok: false, error: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'bad_payload' };
  }
}
