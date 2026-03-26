import { NextResponse } from 'next/server';
import { signToken } from '../../../../lib/auth-token';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const address = String(body?.address || '').trim().toLowerCase();
    const fid = body?.fid != null ? String(body.fid) : '';
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return NextResponse.json({ ok: false, error: 'invalid_address' }, { status: 400 });
    }

    const nonce = Math.random().toString(36).slice(2, 12);
    const issuedAt = new Date().toISOString();
    const challengeExp = Date.now() + (5 * 60 * 1000);
    const challengeToken = signToken({ t: 'challenge', address, nonce, fid, issuedAt, exp: challengeExp });

    const domain = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'bazaar.agrimonys.com';
    const statement = [
      `${domain} wants you to sign in with your Ethereum account:`,
      address,
      '',
      'Sign in to The Grand Bazaar',
      '',
      `URI: https://${domain}`,
      'Version: 1',
      'Chain ID: 8453',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expiration Time: ${new Date(challengeExp).toISOString()}`,
    ].join('\n');

    return NextResponse.json({ ok: true, nonce, message: statement, challengeToken, expiresAt: challengeExp });
  } catch {
    return NextResponse.json({ ok: false, error: 'challenge_failed' }, { status: 500 });
  }
}
