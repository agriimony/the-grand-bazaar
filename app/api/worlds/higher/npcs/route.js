import { NextResponse } from 'next/server';

export const revalidate = 86400;

const SCORE_THRESHOLD = 0.7;
const MAX_ROOT_CASTS = 100;
const MAX_CHILD_FETCH = 40;
const MAX_USER_BULK = 100;

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

function castScore(c) {
  const replies = getCount(c, ['replies.count', 'replies_count', 'reply_count']);
  const quotes = getCount(c, ['quotes.count', 'quotes_count', 'quote_count']);
  const recasts = getCount(c, ['recasts.count', 'recasts_count', 'recast_count']);
  const likes = getCount(c, ['reactions.likes_count', 'likes.count', 'likes_count']);
  const engagementScore = replies * 5 + quotes * 5 + recasts * 3 + likes;
  return { engagementScore, engagement: { replies, quotes, recasts, likes } };
}

function mapCast(c) {
  const user = c?.author || {};
  const hash = String(c?.hash || '').trim().toLowerCase();
  const parentHash = String(c?.parent_hash || c?.parentHash || '').trim().toLowerCase();
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

  const { engagementScore, engagement } = castScore(c);

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
    engagement,
    engagementScore,
  };
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
      if (child) child.rankScore = Number(child.baseEngagementScore || 0) + inherited;
      indegree.set(childHash, (indegree.get(childHash) || 0) - 1);
      if ((indegree.get(childHash) || 0) <= 0) queue.push(childHash);
    }
  }
}

async function fetchChannelCasts(headers) {
  const base = 'https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=higher&with_recasts=false&limit=100';
  let out = [];
  let cursor = '';
  for (let page = 0; page < 5; page += 1) {
    const u = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
    const r = await fetch(u, { headers, next: { revalidate: 86400 } });
    if (!r.ok) break;
    const d = await r.json();
    const list = Array.isArray(d?.casts) ? d.casts : [];
    if (!list.length) break;
    out.push(...list);
    cursor = String(d?.next?.cursor || '').trim();
    if (!cursor) break;
  }
  return out;
}

async function fetchBulkUserScores(fids, headers) {
  if (!fids.length) return new Map();
  const chunks = [];
  for (let i = 0; i < fids.length; i += MAX_USER_BULK) chunks.push(fids.slice(i, i + MAX_USER_BULK));
  const scoreMap = new Map();
  for (const batch of chunks) {
    try {
      const u = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(batch.join(','))}`;
      const r = await fetch(u, { headers, next: { revalidate: 86400 } });
      if (!r.ok) continue;
      const d = await r.json();
      const users = Array.isArray(d?.users) ? d.users : [];
      for (const usr of users) {
        const s = Number(
          usr?.score ?? usr?.user_score ?? usr?.quality_score ?? usr?.rank?.score ?? usr?.power_badge_score ?? 0
        );
        scoreMap.set(Number(usr?.fid || 0), Number.isFinite(s) ? s : 0);
      }
    } catch {}
  }
  return scoreMap;
}

async function fetchChildCasts(seedCasts, headers) {
  const out = [];
  for (const c of seedCasts.slice(0, MAX_CHILD_FETCH)) {
    try {
      const hash = String(c.castHash || '').trim();
      if (!hash) continue;
      const u = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${encodeURIComponent(hash)}&type=hash&reply_depth=2&include_chronological_parent_casts=false&limit=50`;
      const r = await fetch(u, { headers, next: { revalidate: 86400 } });
      if (!r.ok) continue;
      const d = await r.json();
      const convo = Array.isArray(d?.conversation?.cast?.direct_replies)
        ? d.conversation.cast.direct_replies
        : Array.isArray(d?.conversation?.direct_replies)
        ? d.conversation.direct_replies
        : [];
      out.push(...convo);
    } catch {}
  }
  return out;
}

function aggregateByUser(casts) {
  const globalRank = buildGraphOrder(casts);
  const rankIdx = new Map(globalRank.map((h, i) => [h, i]));
  const byUser = new Map();

  for (const c of casts) {
    const key = String(c.fid || c.username).toLowerCase();
    if (!byUser.has(key)) {
      byUser.set(key, {
        fid: c.fid,
        username: c.username,
        displayName: c.displayName,
        pfp: c.pfp,
        primaryWallet: c.primaryWallet,
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
    if (!row.primaryWallet && c.primaryWallet) row.primaryWallet = c.primaryWallet;
  }

  const npcs = Array.from(byUser.values()).map((u) => {
    u.casts.sort((a, b) => {
      if (a.graphIndex !== b.graphIndex) return a.graphIndex - b.graphIndex;
      if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
      return b.timestamp - a.timestamp;
    });
    return u;
  });

  npcs.sort((a, b) => {
    if (b.topScore !== a.topScore) return b.topScore - a.topScore;
    return (b.casts?.[0]?.timestamp || 0) - (a.casts?.[0]?.timestamp || 0);
  });

  return npcs;
}

export async function GET() {
  try {
    const apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'missing neynar key' }, { status: 500 });

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const headers = { api_key: apiKey, accept: 'application/json' };

    // 1) Fetch top channel casts and score.
    const rawChannel = await fetchChannelCasts(headers);
    let channelCasts = rawChannel.map(mapCast).filter(Boolean).filter((c) => c.timestamp >= since);
    channelCasts.sort((a, b) => {
      if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
      return b.timestamp - a.timestamp;
    });
    channelCasts = channelCasts.slice(0, MAX_ROOT_CASTS);

    // 2) Aggregate by user.
    // 3) Filter users by Neynar score > threshold.
    const fids = [...new Set(channelCasts.map((c) => c.fid).filter((n) => Number.isFinite(n) && n > 0))];
    const userScores = await fetchBulkUserScores(fids, headers);
    const allowedFids = new Set(fids.filter((fid) => (userScores.get(fid) || 0) > SCORE_THRESHOLD));
    let filteredCasts = channelCasts.filter((c) => allowedFids.has(c.fid));

    // 4) Return child casts to remaining casts.
    const childRaw = await fetchChildCasts(filteredCasts, headers);
    const children = childRaw.map(mapCast).filter(Boolean).filter((c) => c.timestamp >= since);

    // Merge + dedupe by hash.
    const mergedByHash = new Map();
    for (const c of [...filteredCasts, ...children]) mergedByHash.set(c.castHash, c);

    // 5) Repeat 2-4 once more after child expansion.
    const merged = Array.from(mergedByHash.values());
    const mergedFids = [...new Set(merged.map((c) => c.fid).filter((n) => Number.isFinite(n) && n > 0))];
    const mergedScores = await fetchBulkUserScores(mergedFids, headers);
    const mergedAllowed = new Set(mergedFids.filter((fid) => (mergedScores.get(fid) || 0) > SCORE_THRESHOLD));
    const finalCasts = merged.filter((c) => mergedAllowed.has(c.fid));

    // 6) Build graph + inherited ranking and aggregate NPC timelines.
    applyInheritedScores(finalCasts);
    const npcs = aggregateByUser(finalCasts);

    return NextResponse.json(
      {
        ok: true,
        npcs: npcs.slice(0, 100),
        count: npcs.length,
        sort: 'engagement_desc_with_parent_inheritance',
        mode: 'grouped-user-timeline',
        meta: {
          rootCasts: channelCasts.length,
          afterScoreFilter: filteredCasts.length,
          childCasts: children.length,
          mergedCasts: merged.length,
          finalCasts: finalCasts.length,
          scoreThreshold: SCORE_THRESHOLD,
        },
      },
      { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
