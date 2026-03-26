import { NextResponse } from 'next/server';
import { verifyToken } from '../../../../lib/auth-token';

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 401 });

  const v = verifyToken(token);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 401 });
  if (v?.payload?.t !== 'session') return NextResponse.json({ ok: false, error: 'invalid_token_type' }, { status: 401 });

  return NextResponse.json({ ok: true, session: v.payload });
}
