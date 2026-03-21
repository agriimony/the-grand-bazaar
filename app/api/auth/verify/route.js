import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { signToken, verifyToken } from '../../../../lib/auth-token';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const address = String(body?.address || '').trim().toLowerCase();
    const signature = String(body?.signature || '').trim();
    const message = String(body?.message || '').trim();
    const challengeToken = String(body?.challengeToken || '').trim();
    const authMethod = String(body?.authMethod || 'siwe').trim().toLowerCase();
    const fid = body?.fid != null ? String(body.fid) : '';

    if (!address || !signature || !message || !challengeToken) {
      return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });
    }

    const vc = verifyToken(challengeToken);
    if (!vc.ok) return NextResponse.json({ ok: false, error: `bad_challenge:${vc.error}` }, { status: 401 });

    const ch = vc.payload || {};
    if (String(ch.address || '') !== address) {
      return NextResponse.json({ ok: false, error: 'address_mismatch' }, { status: 401 });
    }
    if (!message.includes(`Nonce: ${String(ch.nonce || '')}`)) {
      return NextResponse.json({ ok: false, error: 'nonce_mismatch' }, { status: 401 });
    }

    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== address) {
      return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 });
    }

    const now = Date.now();
    const exp = now + (60 * 60 * 1000);
    const sessionToken = signToken({
      t: 'session',
      sub: address,
      playerId: address,
      fid,
      authMethod,
      chainId: 8453,
      iat: now,
      exp,
    });

    return NextResponse.json({ ok: true, sessionToken, expiresAt: exp, playerId: address });
  } catch {
    return NextResponse.json({ ok: false, error: 'verify_failed' }, { status: 500 });
  }
}
