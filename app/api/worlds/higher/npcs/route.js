import { NextResponse } from 'next/server';
import { decodeCompressedOrder } from '../../../../../lib/orders';

export const revalidate = 120;

const DEV_FIDS = [191780, 2584413, 2480582];
const HOURS_24_MS = 24 * 60 * 60 * 1000;

function extractCompressedOrder(text = '') {
  const m = String(text || '').match(/(?:^|\n)GBZ1:([^\s\n]+)/i);
  if (!m) return null;
  const raw = String(m[1] || '').trim();
  const cleaned = raw.replace(/["'`’”.,;:!?\])}>]+$/g, '');
  return cleaned || null;
}

function toBatchItemFromCast(c) {
  try {
    if (!c?.isPublicSwapOffer) return null;
    const compressed = extractCompressedOrder(c.text || '');
    if (!compressed) return null;
    const o = decodeCompressedOrder(compressed);
    return {
      id: c.castHash,
      publicMode: true,
      swapContract: o.swapContract,
      senderWallet: o.senderWallet,
      order: {
        nonce: o.nonce,
        expiry: o.expiry,
        signer: { wallet: o.signerWallet, token: o.signerToken, kind: o.signerKind, id: o.signerId || 0, amount: o.signerAmount },
        sender: { wallet: o.senderWallet, token: o.senderToken, kind: o.senderKind, id: o.senderId || 0, amount: o.senderAmount },
        affiliateWallet: '0x0000000000000000000000000000000000000000',
        affiliateAmount: 0,
        v: o.v,
        r: o.r,
        s: o.s,
      },
    };
  } catch {
    return null;
  }
}

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
  const pfp = String(user?.pfp_url || user?.pfp?.url || '').trim();
  const permalink = String(c?.permalink || (hash ? `https://farcaster.xyz/${username || 'unknown'}/${hash}` : '')).trim();
  const textRaw = String(c?.text || '').trim();
  const text = textRaw.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  const ts = toIsoMs(c?.timestamp);
  if (!hash || !username || !pfp || !permalink || !ts || !text) return null;

  const hasGbzPayload = /\bGBZ1:/i.test(text);
  const isOpenOffer = /\bOpen\s+offer\b/i.test(text);
  const isPublicSwapOffer = hasGbzPayload && isOpenOffer;
  const castUrl = isPublicSwapOffer ? `/c/${hash}` : permalink;

  const primaryEth = String(user?.verified_addresses?.primary?.eth_address || '').trim();
  const ethAddrs = Array.isArray(user?.verified_addresses?.eth_addresses) ? user.verified_addresses.eth_addresses : [];
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

async function fetchRecentCastsByFid(fid, headers, startMs) {
  const out = [];
  let cursor = '';

  for (let page = 0; page < 2; page += 1) {
    const base = `https://api.neynar.com/v2/farcaster/feed/user/casts?fid=${encodeURIComponent(String(fid))}&limit=50&include_replies=true`;
    const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
    const r = await fetch(url, { headers, cache: 'no-store' });
    if (!r.ok) break;

    const d = await r.json();
    const list = Array.isArray(d?.casts) ? d.casts : [];
    if (!list.length) break;

    const mapped = list.map(mapCast).filter(Boolean);
    out.push(...mapped);

    const oldestTs = mapped.reduce((m, c) => Math.min(m, c.timestamp), Number.POSITIVE_INFINITY);
    if (Number.isFinite(oldestTs) && oldestTs < startMs) break;

    cursor = String(d?.next?.cursor || '').trim();
    if (!cursor) break;
  }

  return out.filter((c) => c.timestamp >= startMs);
}

function aggregateByUser(casts) {
  const byUser = new Map();

  const ordered = [...casts].sort((a, b) => b.timestamp - a.timestamp);
  ordered.forEach((c, i) => {
    const key = String(c.fid || c.username).toLowerCase();
    if (!byUser.has(key)) {
      byUser.set(key, {
        fid: c.fid,
        username: c.username,
        displayName: c.displayName,
        pfp: c.pfp,
        primaryWallet: c.primaryWallet,
        casts: [],
        topScore: Number(c.engagementScore || 0),
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
      engagementScore: Number(c.engagementScore || 0),
      baseEngagementScore: Number(c.engagementScore || 0),
      graphIndex: i,
    });

    if (Number(c.engagementScore || 0) > row.topScore) row.topScore = Number(c.engagementScore || 0);
    if (!row.primaryWallet && c.primaryWallet) row.primaryWallet = c.primaryWallet;
  });

  const npcs = Array.from(byUser.values()).map((u) => {
    u.casts.sort((a, b) => b.timestamp - a.timestamp);
    return u;
  });

  npcs.sort((a, b) => {
    if (b.topScore !== a.topScore) return b.topScore - a.topScore;
    return (b.casts?.[0]?.timestamp || 0) - (a.casts?.[0]?.timestamp || 0);
  });

  return npcs;
}

export async function GET(req) {
  try {
    const apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'missing neynar key' }, { status: 500 });

    const headers = { api_key: apiKey, accept: 'application/json' };
    const nowMs = Date.now();
    const windowStartMs = nowMs - HOURS_24_MS;

    const all = [];
    for (const fid of DEV_FIDS) {
      const userCasts = await fetchRecentCastsByFid(fid, headers, windowStartMs);
      all.push(...userCasts);
    }

    const mergedByHash = new Map();
    for (const c of all) mergedByHash.set(c.castHash, c);
    const finalCasts = Array.from(mergedByHash.values());

    const batchItems = finalCasts.map(toBatchItemFromCast).filter(Boolean);
    const publicOfferCandidates = finalCasts
      .filter((c) => c?.isPublicSwapOffer)
      .map((c) => ({ castHash: c.castHash, username: c.username, text: String(c.text || ''), textLen: String(c.text || '').length }));
    console.log('[world/higher] public offer candidates', publicOfferCandidates);
    let viableHashes = new Set();
    let viableOffers = [];
    if (batchItems.length) {
      try {
        const batchUrl = new URL('/api/order-check-batch', req.url).toString();
        const br = await fetch(batchUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: batchItems }),
          cache: 'no-store',
        });
        const bd = await br.json();
        const rows = Array.isArray(bd?.results) ? bd.results : [];
        viableOffers = rows.filter((r) => r?.ok && !r?.nonceUsed && Array.isArray(r?.checkErrors) && r.checkErrors.length === 0);
        viableHashes = new Set(viableOffers.map((r) => String(r.id || '').toLowerCase()).filter(Boolean));
        const validCastDebug = finalCasts
          .filter((c) => viableHashes.has(String(c.castHash || '').toLowerCase()))
          .map((c) => ({ castHash: c.castHash, username: c.username, text: String(c.text || ''), textLen: String(c.text || '').length }));
        console.log('[world/higher] valid public offers', validCastDebug);
      } catch {
        viableHashes = new Set();
        viableOffers = [];
      }
    }

    const castsWithViability = finalCasts.map((c) => {
      if (!c?.isPublicSwapOffer) return c;
      const isViable = viableHashes.has(String(c.castHash || '').toLowerCase());
      return {
        ...c,
        isPublicSwapOffer: isViable,
        publicOfferViable: isViable,
      };
    });

    const npcs = aggregateByUser(castsWithViability);

    return NextResponse.json(
      {
        ok: true,
        npcs,
        count: npcs.length,
        sort: 'timestamp_desc_dev_fid_filter',
        mode: 'dev-temp-fids-last-24h',
        meta: {
          world: 'higher',
          fids: DEV_FIDS,
          totalCasts: finalCasts.length,
          publicOfferCasts: batchItems.length,
          validPublicOffers: viableOffers.length,
          validPublicOfferCastHashes: Array.from(viableHashes),
          windowStartUtc: new Date(windowStartMs).toISOString(),
          windowEndUtc: new Date(nowMs).toISOString(),
        },
      },
      { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=30' } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
