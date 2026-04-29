import { neynarCachedGetJson } from './neynar-cache';

const SCORE_THRESHOLD = 0.7;
const MAX_ROOT_CASTS = 100;
const MAX_CHILD_FETCH = 40;
const MAX_USER_BULK = 100;
const MAX_EVENTS_PER_THREAD = 6;
const LOOP_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_EVENT_MS = 4200;
const OFFER_EVENT_MS = 6000;
const GAP_BETWEEN_SEGMENTS_MS = 800;
const GRID_SIZE = 37;
const STEP_MS = 350;

function toIsoMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}

function hashToUnit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967295;
}

function cellKey(x, y) {
  return `${x}-${y}`;
}

function buildStaticBlockedCells(size = GRID_SIZE) {
  const center = Math.floor(size / 2);
  const bankCell = { x: Math.min(size - 2, center + 2), y: center };
  const blocked = new Set();
  for (let i = 0; i < size; i += 1) {
    blocked.add(cellKey(i, 0));
    blocked.add(cellKey(i, size - 1));
    blocked.add(cellKey(0, i));
    blocked.add(cellKey(size - 1, i));
  }
  blocked.add(cellKey(center, center));
  blocked.add(cellKey(bankCell.x, bankCell.y));
  return blocked;
}

function findPath({ size = GRID_SIZE, blocked = new Set(), start, goal }) {
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < size && y < size;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const q = [[start.x, start.y]];
  const seen = new Set([cellKey(start.x, start.y)]);
  const prev = new Map();

  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal.x && y === goal.y) break;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = cellKey(nx, ny);
      if (blocked.has(k) || seen.has(k)) continue;
      seen.add(k);
      prev.set(k, cellKey(x, y));
      q.push([nx, ny]);
    }
  }

  const goalKey = cellKey(goal.x, goal.y);
  if (!seen.has(goalKey)) return [];

  const out = [];
  let cur = goalKey;
  while (cur) {
    const [x, y] = cur.split('-').map(Number);
    out.push({ x, y });
    cur = prev.get(cur);
  }
  out.reverse();
  return out;
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

function calcEventDurationMs(cast) {
  if (cast?.isPublicSwapOffer) return OFFER_EVENT_MS;
  const text = String(cast?.text || '').trim();
  const len = Math.max(0, text.length);
  return Math.max(DEFAULT_EVENT_MS, Math.min(6200, DEFAULT_EVENT_MS + Math.floor(len / 32) * 300));
}

function mapCast(c) {
  const user = c?.author || {};
  const hash = String(c?.hash || '').trim().toLowerCase();
  const parentHash = String(c?.parent_hash || c?.parentHash || '').trim().toLowerCase();
  const username = String(user?.username || user?.display_name || '').trim();
  const pfp = String(user?.pfp_url || '').trim();
  const permalink = String(c?.permalink || (hash ? `https://farcaster.xyz/${username || 'unknown'}/${hash}` : '')).trim();
  const textRaw = String(c?.text || '').trim();
  const text = textRaw.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  const ts = toIsoMs(c?.timestamp);
  const fid = Number(user?.fid || 0);
  if (!hash || !fid || !username || !pfp || !permalink || !ts || !text) return null;

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
    fid,
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
    eventDurationMs: calcEventDurationMs({ text, isPublicSwapOffer }),
  };
}

async function fetchChannelCasts({ headers, world, channelId }) {
  const base = `https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=${encodeURIComponent(channelId)}&with_recasts=false&limit=100`;
  let out = [];
  let cursor = '';
  for (let page = 0; page < 5; page += 1) {
    const u = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
    const { ok, json: d } = await neynarCachedGetJson({
      url: u,
      headers,
      namespace: `${world}:feed:channels`,
      ttlSeconds: 24 * 60 * 60,
    });
    if (!ok) break;
    const list = Array.isArray(d?.casts) ? d.casts : [];
    if (!list.length) break;
    out.push(...list);
    cursor = String(d?.next?.cursor || '').trim();
    if (!cursor) break;
  }
  return out;
}

async function fetchBulkUserScores({ fids, headers, world }) {
  if (!fids.length) return new Map();
  const chunks = [];
  for (let i = 0; i < fids.length; i += MAX_USER_BULK) chunks.push(fids.slice(i, i + MAX_USER_BULK));
  const scoreMap = new Map();
  for (const batch of chunks) {
    try {
      const u = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(batch.join(','))}`;
      const { ok, json: d } = await neynarCachedGetJson({
        url: u,
        headers,
        namespace: `${world}:user:bulk`,
        ttlSeconds: 7 * 24 * 60 * 60,
      });
      if (!ok) continue;
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

function collectRepliesDeep(cast, out = []) {
  if (!cast || typeof cast !== 'object') return out;
  const replies = Array.isArray(cast?.direct_replies) ? cast.direct_replies : [];
  for (const r of replies) {
    out.push(r);
    collectRepliesDeep(r, out);
  }
  return out;
}

async function fetchChildCasts({ seedCasts, headers, world }) {
  const out = [];
  for (const c of seedCasts.slice(0, MAX_CHILD_FETCH)) {
    try {
      const hash = String(c.castHash || '').trim();
      if (!hash) continue;
      const u = `https://api.neynar.com/v2/farcaster/cast/conversation?identifier=${encodeURIComponent(hash)}&type=hash&reply_depth=3&include_chronological_parent_casts=false&limit=50`;
      const { ok, json: d } = await neynarCachedGetJson({
        url: u,
        headers,
        namespace: `${world}:cast:conversation`,
        ttlSeconds: 24 * 60 * 60,
      });
      if (!ok) continue;

      const rootCast = d?.conversation?.cast;
      if (rootCast && typeof rootCast === 'object') {
        collectRepliesDeep(rootCast, out);
      } else {
        const convo = Array.isArray(d?.conversation?.direct_replies) ? d.conversation.direct_replies : [];
        for (const r of convo) {
          out.push(r);
          collectRepliesDeep(r, out);
        }
      }
    } catch {}
  }
  return out;
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
    const inherited = Number(parent?.rankScore || 0) * 0.5;
    for (const childHash of children.get(h) || []) {
      const child = byHash.get(childHash);
      if (child) child.rankScore = Number(child.baseEngagementScore || 0) + inherited;
      indegree.set(childHash, (indegree.get(childHash) || 0) - 1);
      if ((indegree.get(childHash) || 0) <= 0) queue.push(childHash);
    }
  }
}

function buildThreads(casts) {
  const byHash = new Map(casts.map((c) => [c.castHash, c]));
  const childMap = new Map();
  const indegree = new Map(casts.map((c) => [c.castHash, 0]));

  for (const cast of casts) {
    if (!cast.parentHash || !byHash.has(cast.parentHash)) continue;
    if (!childMap.has(cast.parentHash)) childMap.set(cast.parentHash, []);
    childMap.get(cast.parentHash).push(cast.castHash);
    indegree.set(cast.castHash, (indegree.get(cast.castHash) || 0) + 1);
  }

  for (const arr of childMap.values()) {
    arr.sort((a, b) => {
      const A = byHash.get(a);
      const B = byHash.get(b);
      if ((Number(B?.rankScore || 0)) !== (Number(A?.rankScore || 0))) {
        return Number(B?.rankScore || 0) - Number(A?.rankScore || 0);
      }
      return Number(A?.timestamp || 0) - Number(B?.timestamp || 0);
    });
  }

  const roots = casts
    .filter((c) => (indegree.get(c.castHash) || 0) === 0)
    .sort((a, b) => {
      if ((Number(b.rankScore || 0)) !== (Number(a.rankScore || 0))) return Number(b.rankScore || 0) - Number(a.rankScore || 0);
      return Number(a.timestamp || 0) - Number(b.timestamp || 0);
    });

  const threads = [];
  for (const root of roots) {
    const included = [];
    const seen = new Set();
    const stack = [root.castHash];

    while (stack.length && included.length < MAX_EVENTS_PER_THREAD) {
      const hash = stack.shift();
      if (!hash || seen.has(hash) || !byHash.has(hash)) continue;
      seen.add(hash);
      const cast = byHash.get(hash);
      included.push(cast);
      const kids = childMap.get(hash) || [];
      for (const kid of kids) stack.push(kid);
    }

    if (included.length < 2) continue;
    const participantIds = [...new Set(included.map((c) => Number(c.fid || 0)).filter((n) => Number.isFinite(n) && n > 0))];
    if (participantIds.length < 2) continue;

    const ordered = [...included].sort((a, b) => {
      if (Number(a.timestamp || 0) !== Number(b.timestamp || 0)) return Number(a.timestamp || 0) - Number(b.timestamp || 0);
      return Number(b.rankScore || 0) - Number(a.rankScore || 0);
    });

    const threadId = `thread:${root.castHash}`;
    const score = ordered.reduce((sum, c) => sum + Number(c.rankScore || c.engagementScore || 0), 0);
    const events = ordered.map((cast) => ({
      id: `evt:${cast.castHash}`,
      castHash: cast.castHash,
      parentCastHash: cast.parentHash || '',
      speakerId: Number(cast.fid),
      timestamp: Number(cast.timestamp),
      text: cast.text,
      kind: cast.isPublicSwapOffer ? 'offer' : (cast.castHash === root.castHash ? 'root' : 'reply'),
      score: Number(cast.rankScore || cast.engagementScore || 0),
      durationMs: Number(cast.eventDurationMs || DEFAULT_EVENT_MS),
      permalink: cast.permalink,
      castUrl: cast.castUrl,
      isPublicSwapOffer: Boolean(cast.isPublicSwapOffer),
    }));

    threads.push({
      id: threadId,
      rootCastHash: root.castHash,
      participants: participantIds,
      score,
      startedAt: Number(ordered[0]?.timestamp || root.timestamp || 0),
      lastAt: Number(ordered[ordered.length - 1]?.timestamp || root.timestamp || 0),
      eventCount: events.length,
      events,
    });
  }

  threads.sort((a, b) => {
    if (Number(b.score || 0) !== Number(a.score || 0)) return Number(b.score || 0) - Number(a.score || 0);
    return Number(a.startedAt || 0) - Number(b.startedAt || 0);
  });

  return threads;
}

function buildIdleCell(fid, occupied, size = GRID_SIZE) {
  const blocked = buildStaticBlockedCells(size);
  let best = null;
  let bestScore = -1;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const k = cellKey(x, y);
      if (blocked.has(k) || occupied.has(k)) continue;
      const score = hashToUnit(`idle:${fid}:${k}`);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best || { x: 1, y: 1 };
}

function buildIdleEvents(threads, casts) {
  const usedCastHashes = new Set(threads.flatMap((thread) => (thread.events || []).map((evt) => String(evt.castHash || ''))));
  const byFid = new Map();
  for (const cast of casts) {
    const fid = Number(cast?.fid || 0);
    if (!fid) continue;
    if (usedCastHashes.has(String(cast.castHash || ''))) continue;
    if (String(cast.parentHash || '').trim()) continue;
    if (!byFid.has(fid)) byFid.set(fid, []);
    byFid.get(fid).push({
      castHash: cast.castHash,
      text: cast.text,
      timestamp: Number(cast.timestamp || 0),
      durationMs: Number(cast.eventDurationMs || DEFAULT_EVENT_MS),
      permalink: cast.permalink,
      castUrl: cast.castUrl,
      isPublicSwapOffer: Boolean(cast.isPublicSwapOffer),
    });
  }
  for (const list of byFid.values()) {
    list.sort((a, b) => b.timestamp - a.timestamp);
  }
  return byFid;
}

function buildNpcRegistry(threads, casts, idleEventsByFid = new Map()) {
  const byFid = new Map();
  const castCountByFid = new Map();
  const threadCountByFid = new Map();

  for (const cast of casts) {
    const fid = Number(cast?.fid || 0);
    if (!fid) continue;
    if (!byFid.has(fid)) {
      byFid.set(fid, {
        id: fid,
        username: String(cast.username || ''),
        displayName: String(cast.displayName || cast.username || ''),
        pfp: String(cast.pfp || ''),
        ...(cast.primaryWallet ? { primaryWallet: cast.primaryWallet } : {}),
        score: 0,
        castCount: 0,
        threadCount: 0,
      });
    }
    const row = byFid.get(fid);
    row.score = Math.max(Number(row.score || 0), Number(cast.rankScore || cast.engagementScore || 0));
    castCountByFid.set(fid, (castCountByFid.get(fid) || 0) + 1);
  }

  for (const thread of threads) {
    for (const fid of thread.participants || []) {
      threadCountByFid.set(fid, (threadCountByFid.get(fid) || 0) + 1);
    }
  }

  const out = {};
  const occupied = new Set();
  for (const [fid, row] of [...byFid.entries()].sort((a, b) => a[0] - b[0])) {
    const idleCell = buildIdleCell(fid, occupied);
    occupied.add(cellKey(idleCell.x, idleCell.y));
    out[String(fid)] = {
      ...row,
      castCount: castCountByFid.get(fid) || 0,
      threadCount: threadCountByFid.get(fid) || 0,
      idleCell,
      idleEvents: idleEventsByFid.get(fid) || [],
    };
  }
  return out;
}

function buildSegmentSlots(thread, occupied, size = GRID_SIZE) {
  const blocked = buildStaticBlockedCells(size);
  const participants = [...(thread?.participants || [])].sort((a, b) => a - b);
  if (!participants.length) return [];

  let bestAnchor = null;
  let bestScore = -1;
  for (let y = 2; y < size - 2; y += 1) {
    for (let x = 2; x < size - 2; x += 1) {
      const k = cellKey(x, y);
      if (blocked.has(k) || occupied.has(k)) continue;
      const score = hashToUnit(`anchor:${thread.id}:${k}`);
      if (score > bestScore) {
        bestScore = score;
        bestAnchor = { x, y };
      }
    }
  }
  const anchor = bestAnchor || { x: Math.floor(size / 2) - 2, y: Math.floor(size / 2) - 2 };

  const ring = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];

  const slots = [];
  for (let i = 0; i < participants.length; i += 1) {
    const fid = participants[i];
    let placed = null;
    for (let j = 0; j < ring.length; j += 1) {
      const [dx, dy] = ring[(i + j) % ring.length];
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const k = cellKey(x, y);
      if (x < 1 || y < 1 || x > size - 2 || y > size - 2) continue;
      if (blocked.has(k) || occupied.has(k) || slots.some((s) => s.x === x && s.y === y)) continue;
      placed = { npcId: fid, x, y };
      break;
    }
    if (!placed) placed = { npcId: fid, x: anchor.x, y: anchor.y };
    slots.push(placed);
  }

  return slots;
}

function buildScheduleSegments(threads, npcRegistry, loopDurationMs) {
  const segments = [];
  let cursor = 0;
  let idx = 0;
  const occupied = new Set();
  const lastTargetByNpc = new Map();
  for (const npc of Object.values(npcRegistry || {})) {
    lastTargetByNpc.set(Number(npc.id), npc.idleCell || { x: 1, y: 1 });
  }

  for (const thread of threads) {
    const threadDuration = (thread.events || []).reduce((sum, evt) => sum + Number(evt.durationMs || 0), 0);
    if (threadDuration <= 0) continue;

    const slots = buildSegmentSlots(thread, occupied);
    if (!slots.length) continue;

    let maxTravelMs = 0;
    for (const slot of slots) {
      const prev = lastTargetByNpc.get(Number(slot.npcId)) || npcRegistry?.[String(slot.npcId)]?.idleCell || { x: slot.x, y: slot.y };
      const path = findPath({ size: GRID_SIZE, blocked: buildStaticBlockedCells(GRID_SIZE), start: prev, goal: { x: slot.x, y: slot.y } });
      const steps = Math.max(0, path.length - 1);
      maxTravelMs = Math.max(maxTravelMs, steps * STEP_MS);
    }

    const startMs = cursor + maxTravelMs;
    const endMs = startMs + threadDuration;
    const needed = maxTravelMs + threadDuration + GAP_BETWEEN_SEGMENTS_MS;
    if (cursor + needed > loopDurationMs) break;

    segments.push({
      id: `seg:${idx}`,
      threadId: thread.id,
      startMs,
      endMs,
      participantIds: [...thread.participants],
      slots,
      movement: {
        stepMs: STEP_MS,
      },
      placement: {
        anchorNpcId: Number(thread.participants?.[0] || 0) || undefined,
        cluster: `cluster:${idx}`,
        anchorCell: slots[0] ? { x: slots[0].x, y: slots[0].y } : undefined,
      },
    });

    for (const slot of slots) {
      lastTargetByNpc.set(Number(slot.npcId), { x: slot.x, y: slot.y });
      occupied.add(cellKey(slot.x, slot.y));
    }

    cursor += needed;
    idx += 1;
  }

  let maxReturnMs = 0;
  for (const npc of Object.values(npcRegistry || {})) {
    const lastTarget = lastTargetByNpc.get(Number(npc.id)) || npc.idleCell || { x: 1, y: 1 };
    const path = findPath({ size: GRID_SIZE, blocked: buildStaticBlockedCells(GRID_SIZE), start: lastTarget, goal: npc.idleCell || { x: 1, y: 1 } });
    const steps = Math.max(0, path.length - 1);
    maxReturnMs = Math.max(maxReturnMs, steps * STEP_MS);
  }

  while (segments.length && cursor + maxReturnMs > loopDurationMs) {
    const removed = segments.pop();
    if (!removed) break;
    cursor = Math.max(0, Number(removed.startMs || 0) - GAP_BETWEEN_SEGMENTS_MS);
    maxReturnMs = 0;
    const recalculatedTargets = new Map();
    for (const npc of Object.values(npcRegistry || {})) recalculatedTargets.set(Number(npc.id), npc.idleCell || { x: 1, y: 1 });
    for (const seg of segments) {
      for (const slot of seg.slots || []) recalculatedTargets.set(Number(slot.npcId), { x: Number(slot.x), y: Number(slot.y) });
      cursor = Math.max(cursor, Number(seg.endMs || 0) + GAP_BETWEEN_SEGMENTS_MS);
    }
    for (const npc of Object.values(npcRegistry || {})) {
      const lastTarget = recalculatedTargets.get(Number(npc.id)) || npc.idleCell || { x: 1, y: 1 };
      const path = findPath({ size: GRID_SIZE, blocked: buildStaticBlockedCells(GRID_SIZE), start: lastTarget, goal: npc.idleCell || { x: 1, y: 1 } });
      const steps = Math.max(0, path.length - 1);
      maxReturnMs = Math.max(maxReturnMs, steps * STEP_MS);
    }
  }

  return segments;
}

export async function getWorldNpcs({ world, channelId }) {
  const apiKey = process.env.NEYNAR_API_KEY || '';
  if (!apiKey) {
    return { ok: false, status: 500, error: 'missing neynar key' };
  }

  const headers = { api_key: apiKey, accept: 'application/json' };

  const now = new Date();
  const sourceWindowStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
  const sourceWindowEndDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));
  const sourceWindowStart = sourceWindowStartDate.getTime();
  const sourceWindowEnd = sourceWindowEndDate.getTime();

  const validFromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const validToDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const validFrom = validFromDate.getTime();
  const validTo = validToDate.getTime();

  const rawChannel = await fetchChannelCasts({ headers, world, channelId });
  let channelCasts = rawChannel
    .map(mapCast)
    .filter(Boolean)
    .filter((c) => c.timestamp >= sourceWindowStart && c.timestamp <= sourceWindowEnd);

  channelCasts.sort((a, b) => {
    if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
    return b.timestamp - a.timestamp;
  });
  channelCasts = channelCasts.slice(0, MAX_ROOT_CASTS);

  const rootFids = [...new Set(channelCasts.map((c) => c.fid).filter((n) => Number.isFinite(n) && n > 0))];
  const rootScores = await fetchBulkUserScores({ fids: rootFids, headers, world });
  const allowedRootFids = new Set(rootFids.filter((fid) => (rootScores.get(fid) || 0) > SCORE_THRESHOLD));
  const filteredRootCasts = channelCasts.filter((c) => allowedRootFids.has(c.fid));

  const childRaw = await fetchChildCasts({ seedCasts: filteredRootCasts, headers, world });
  const childCasts = childRaw
    .map(mapCast)
    .filter(Boolean)
    .filter((c) => c.timestamp >= sourceWindowStart && c.timestamp <= sourceWindowEnd);

  const mergedByHash = new Map();
  for (const cast of [...filteredRootCasts, ...childCasts]) mergedByHash.set(cast.castHash, cast);
  const merged = Array.from(mergedByHash.values());

  const mergedFids = [...new Set(merged.map((c) => c.fid).filter((n) => Number.isFinite(n) && n > 0))];
  const mergedScores = await fetchBulkUserScores({ fids: mergedFids, headers, world });
  const allowedFids = new Set(mergedFids.filter((fid) => (mergedScores.get(fid) || 0) > SCORE_THRESHOLD));
  const finalCasts = merged.filter((c) => allowedFids.has(c.fid));

  applyInheritedScores(finalCasts);
  const threadsList = buildThreads(finalCasts);
  const idleEventsByFid = buildIdleEvents(threadsList, finalCasts);
  const fullNpcRegistry = buildNpcRegistry(threadsList, finalCasts, idleEventsByFid);
  const segments = buildScheduleSegments(threadsList, fullNpcRegistry, LOOP_DURATION_MS);
  const scheduledThreadIds = new Set(segments.map((s) => s.threadId));
  const scheduledThreads = threadsList.filter((t) => scheduledThreadIds.has(t.id));
  const npcRegistry = {};
  for (const [fid, npc] of Object.entries(fullNpcRegistry)) {
    npcRegistry[fid] = npc;
  }

  const threads = {};
  for (const thread of scheduledThreads) {
    threads[thread.id] = thread;
  }

  const scheduleVersion = `${world}:${validFromDate.toISOString().slice(0, 10)}`;
  const nowMs = Date.now();

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      world,
      scheduleVersion,
      generatedAt: nowMs,
      serverNow: nowMs,
      sourceWindowStart,
      sourceWindowEnd,
      validFrom,
      validTo,
      loopStartsAt: validFrom,
      loopDurationMs: LOOP_DURATION_MS,
      npcs: npcRegistry,
      threads,
      segments,
      motion: {
        stepMs: STEP_MS,
        neighborOrder: ['right', 'left', 'down', 'up'],
      },
      meta: {
        candidateRootCasts: channelCasts.length,
        candidateThreads: threadsList.length,
        scheduledThreads: scheduledThreads.length,
        npcCount: Object.keys(npcRegistry).length,
        scoreThreshold: SCORE_THRESHOLD,
        maxEventsPerThread: MAX_EVENTS_PER_THREAD,
        sourceWindowLabel: `${sourceWindowStartDate.toISOString()}..${sourceWindowEndDate.toISOString()}`,
      },
    },
  };
}
