import { NextResponse } from 'next/server';

export const revalidate = 86400;

function toIsoMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function getCount(cast, keys = []) {
  for (const k of keys) {
    const parts = String(k).split('.');
    let v = cast;
    for (const p of parts) v = v?.[p];
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function mapCast(c) {
  const user = c?.author || {};
  const hash = String(c?.hash || '').trim();
  const username = String(user?.username || user?.display_name || '').trim();
  const pfp = String(user?.pfp_url || '').trim();
  const castUrl = String(c?.permalink || (hash ? `https://farcaster.xyz/${username || 'unknown'}/${hash}` : '')).trim();
  const ts = toIsoMs(c?.timestamp);
  if (!hash || !username || !pfp || !castUrl || !ts) return null;

  const replies = getCount(c, ['replies.count', 'replies_count', 'reply_count']);
  const quotes = getCount(c, ['quotes.count', 'quotes_count', 'quote_count']);
  const recasts = getCount(c, ['recasts.count', 'recasts_count', 'recast_count']);
  const likes = getCount(c, ['reactions.likes_count', 'likes.count', 'likes_count']);
  const engagementScore = replies * 5 + quotes * 5 + recasts * 3 + likes;

  return {
    fid: Number(user?.fid || 0),
    username,
    displayName: String(user?.display_name || username),
    pfp,
    castHash: hash,
    castUrl,
    timestamp: ts,
    engagement: { replies, quotes, recasts, likes },
    engagementScore,
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
        const r = await fetch(u, { headers, next: { revalidate: 86400 } });
        if (!r.ok) continue;
        const d = await r.json();
        const list = Array.isArray(d?.casts) ? d.casts : Array.isArray(d?.result?.casts) ? d.result.casts : [];
        if (list.length) {
          casts = list;
          break;
        }
      } catch {}
    }

    const byUserBest = new Map();
    for (const c of casts) {
      const m = mapCast(c);
      if (!m) continue;
      if (m.timestamp < since) continue;
      const key = String(m.fid || m.username).toLowerCase();
      const prev = byUserBest.get(key);
      if (!prev || m.engagementScore > prev.engagementScore || (m.engagementScore === prev.engagementScore && m.timestamp > prev.timestamp)) {
        byUserBest.set(key, m);
      }
    }

    const out = Array.from(byUserBest.values()).sort((a, b) => {
      if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
      return b.timestamp - a.timestamp;
    });

    return NextResponse.json(
      { ok: true, npcs: out.slice(0, 100), count: out.length, sort: 'engagement_desc' },
      { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
