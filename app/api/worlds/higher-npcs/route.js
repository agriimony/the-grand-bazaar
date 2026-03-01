import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function toIsoMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function mapCast(c) {
  const user = c?.author || {};
  const hash = String(c?.hash || '').trim();
  const username = String(user?.username || user?.display_name || '').trim();
  const pfp = String(user?.pfp_url || '').trim();
  const castUrl = String(c?.permalink || (hash ? `https://farcaster.xyz/${username || 'unknown'}/${hash}` : '')).trim();
  const ts = toIsoMs(c?.timestamp);
  if (!hash || !username || !pfp || !castUrl || !ts) return null;
  return {
    fid: Number(user?.fid || 0),
    username,
    displayName: String(user?.display_name || username),
    pfp,
    castHash: hash,
    castUrl,
    timestamp: ts,
  };
}

export async function GET() {
  try {
    const apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'missing neynar key' }, { status: 500 });

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const headers = { api_key: apiKey, accept: 'application/json' };

    // Primary endpoint for channel feed, fallback variants for compatibility.
    const urls = [
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=higher&with_recasts=false&limit=100',
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=%2Fhigher&with_recasts=false&limit=100',
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=higher&limit=100',
    ];

    let casts = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers, cache: 'no-store' });
        if (!r.ok) continue;
        const d = await r.json();
        const list = Array.isArray(d?.casts) ? d.casts : Array.isArray(d?.result?.casts) ? d.result.casts : [];
        if (list.length) {
          casts = list;
          break;
        }
      } catch {}
    }

    const out = [];
    const seen = new Set();
    for (const c of casts) {
      const m = mapCast(c);
      if (!m) continue;
      if (m.timestamp < since) continue;
      const key = String(m.fid || m.username).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }

    return NextResponse.json({ ok: true, npcs: out.slice(0, 40), count: out.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
