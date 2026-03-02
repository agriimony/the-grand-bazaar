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
  const parentHash = String(c?.parent_hash || c?.parentHash || '').trim();
  const username = String(user?.username || user?.display_name || '').trim();
  const pfp = String(user?.pfp_url || '').trim();
  const permalink = String(c?.permalink || (hash ? `https://farcaster.xyz/${username || 'unknown'}/${hash}` : '')).trim();
  const text = String(c?.text || '').trim();
  const ts = toIsoMs(c?.timestamp);
  if (!hash || !username || !pfp || !permalink || !ts || !text) return null;

  const hasGbzPayload = /\bGBZ1:/i.test(text);
  const isOpenOffer = /\bOpen\s+offer\b/i.test(text);
  const isPublicSwapOffer = hasGbzPayload && isOpenOffer;
  const castUrl = isPublicSwapOffer ? `/c/${hash}` : permalink;

  const primaryEth = String(user?.verified_addresses?.primary?.eth_address || '').trim();
  const ethAddrs = Array.isArray(user?.verified_addresses?.eth_addresses)
    ? user.verified_addresses.eth_addresses
    : [];
  const primaryWallet = /^0x[a-fA-F0-9]{40}$/.test(primaryEth)
    ? primaryEth
    : (ethAddrs.find((a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || '').trim())) || '');

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
    primaryWallet,
    castHash: hash,
    parentHash,
    castUrl,
    permalink,
    isPublicSwapOffer,
    text,
    timestamp: ts,
    engagement: { replies, quotes, recasts, likes },
    engagementScore,
  };
}

function applyInheritedScores(casts) {
  const byHash = new Map(casts.map((c) => [c.castHash, c]));
  const children = new Map();
  const indegree = new Map(casts.map((c) => [c.castHash, 0]));

  for (const c of casts) {
    if (!c.parentHash || !byHash.has(c.parentHash)) continue;
    if (!children.has(c.parentHash)) children.set(c.parentHash, []);
    children.get(c.parentHash).push(c.castHash);
    indegree.set(c.castHash, (indegree.get(c.castHash) || 0) + 1);
  }

  const queue = casts.filter((c) => (indegree.get(c.castHash) || 0) === 0).map((c) => c.castHash);
  for (const c of casts) {
    c.baseEngagementScore = Number(c.engagementScore || 0);
    c.rankScore = Number(c.baseEngagementScore || 0);
  }

  while (queue.length) {
    const h = queue.shift();
    const parent = byHash.get(h);
    const inherited = Number(parent?.rankScore || 0) * 0.8;
    for (const childHash of children.get(h) || []) {
      const child = byHash.get(childHash);
      if (child) {
        child.rankScore = Number(child.baseEngagementScore || 0) + inherited;
      }
      indegree.set(childHash, (indegree.get(childHash) || 0) - 1);
      if ((indegree.get(childHash) || 0) <= 0) queue.push(childHash);
    }
  }
}

function buildGraphOrder(casts) {
  const byHash = new Map(casts.map((c) => [c.castHash, c]));
  const childMap = new Map();
  const indegree = new Map(casts.map((c) => [c.castHash, 0]));

  for (const c of casts) {
    if (!c.parentHash || !byHash.has(c.parentHash)) continue;
    if (!childMap.has(c.parentHash)) childMap.set(c.parentHash, []);
    childMap.get(c.parentHash).push(c.castHash);
    indegree.set(c.castHash, (indegree.get(c.castHash) || 0) + 1);
  }

  const scoreSort = (a, b) => {
    const A = byHash.get(a);
    const B = byHash.get(b);
    if ((B?.rankScore || 0) !== (A?.rankScore || 0)) return (B?.rankScore || 0) - (A?.rankScore || 0);
    return (B?.timestamp || 0) - (A?.timestamp || 0);
  };

  const roots = casts
    .filter((c) => (indegree.get(c.castHash) || 0) === 0)
    .map((c) => c.castHash)
    .sort(scoreSort);

  for (const [k, arr] of childMap.entries()) {
    arr.sort(scoreSort);
    childMap.set(k, arr);
  }

  const order = [];
  const seen = new Set();
  const dfs = (hash) => {
    if (!hash || seen.has(hash) || !byHash.has(hash)) return;
    seen.add(hash);
    order.push(hash);
    const kids = childMap.get(hash) || [];
    for (const k of kids) dfs(k);
  };

  for (const r of roots) dfs(r);
  for (const c of casts) if (!seen.has(c.castHash)) dfs(c.castHash);
  return order;
}

export async function GET() {
  try {
    const apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'missing neynar key' }, { status: 500 });

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const headers = { api_key: apiKey, accept: 'application/json' };

    const urls = [
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=degen&with_recasts=false&limit=500',
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=%2Fdegen&with_recasts=false&limit=500',
      'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=degen&limit=500',
    ];

    let raw = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers, next: { revalidate: 86400 } });
        if (!r.ok) continue;
        const d = await r.json();
        const list = Array.isArray(d?.casts) ? d.casts : Array.isArray(d?.result?.casts) ? d.result.casts : [];
        if (list.length) {
          raw = list;
          break;
        }
      } catch {}
    }

    const casts = [];
    for (const c of raw) {
      const m = mapCast(c);
      if (!m) continue;
      if (m.timestamp < since) continue;
      casts.push(m);
    }

    applyInheritedScores(casts);
    const globalRank = buildGraphOrder(casts);
    const rankIdx = new Map(globalRank.map((h, i) => [h, i]));

    // Group casts by user for one NPC tile per user.
    const byUser = new Map();
    for (const c of casts) {
      const key = String(c.fid || c.username).toLowerCase();
      if (!byUser.has(key)) {
        byUser.set(key, {
          fid: c.fid,
          username: c.username,
          displayName: c.displayName,
          pfp: c.pfp,
          casts: [],
          topScore: Number(c.rankScore || c.engagementScore || 0),
        });
      }
      const row = byUser.get(key);
      row.casts.push({
        castHash: c.castHash,
        castUrl: c.castUrl,
        permalink: c.permalink,
        isPublicSwapOffer: Boolean(c.isPublicSwapOffer),
        text: c.text,
        timestamp: c.timestamp,
        parentHash: c.parentHash || '',
        engagement: c.engagement,
        engagementScore: Number(c.rankScore || c.engagementScore || 0),
        baseEngagementScore: Number(c.baseEngagementScore || c.engagementScore || 0),
        graphIndex: rankIdx.has(c.castHash) ? rankIdx.get(c.castHash) : Number.MAX_SAFE_INTEGER,
      });
      if (Number(c.rankScore || 0) > row.topScore) row.topScore = Number(c.rankScore || 0);
    }

    const npcs = Array.from(byUser.values()).map((u) => {
      u.casts.sort((a, b) => {
        if (a.graphIndex !== b.graphIndex) return a.graphIndex - b.graphIndex;
        if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
        return b.timestamp - a.timestamp;
      });
      return u;
    });

    // NPC placement/order priority by best score.
    npcs.sort((a, b) => {
      if (b.topScore !== a.topScore) return b.topScore - a.topScore;
      return (b.casts?.[0]?.timestamp || 0) - (a.casts?.[0]?.timestamp || 0);
    });

    return NextResponse.json(
      { ok: true, npcs: npcs.slice(0, 100), count: npcs.length, sort: 'engagement_desc', mode: 'grouped-user-timeline' },
      { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
