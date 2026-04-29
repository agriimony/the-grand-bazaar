import { NextResponse } from 'next/server';
import { getWorldNpcs } from '../../../../../lib/world-npcs';

export const revalidate = 3600;

export async function GET(request) {
  try {
    const debug = request?.nextUrl?.searchParams?.get('debug') === '1';
    const result = await getWorldNpcs({ world: 'degen', channelId: 'degen', debug });
    if (!result?.ok) {
      return NextResponse.json({ ok: false, error: result?.error || 'failed' }, { status: result?.status || 500 });
    }
    return NextResponse.json(result.body, {
      status: result.status || 200,
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=0' },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
