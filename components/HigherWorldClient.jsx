'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';
import { useAccount, useDisconnect } from 'wagmi';
import { fetchSession, getStoredAuthToken, setStoredAuthToken } from '../lib/client-auth';

function hashToUnit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967295;
}

function trimText(s, max = 62) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function cellKey(x, y) {
  return `${x}-${y}`;
}

function randomId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function createRoomId(signer = '', sender = '') {
  const s = String(signer || '').trim().toLowerCase();
  const t = String(sender || '').trim().toLowerCase();
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `r:8453:${s}:${t}:${nonce}`;
}

function shortAddr(v = '') {
  const s = String(v || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function shortPlayer(v = '', max = 14) {
  const s = shortAddr(String(v || '').trim());
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function findPath({ size, blocked, start, goal }) {
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

export default function HigherWorldClient({ worldName = 'higher', apiPath = '/api/worlds/higher/npcs' }) {
  const router = useRouter();
  const size = 37;
  const maxWorldPlayers = 37;
  const center = Math.floor(size / 2);
  const fountainOrigin = { x: center - 1, y: center - 1 };
  const bankCell = { x: center - 1, y: center - 6 };
  const [npcs, setNpcs] = useState([]);
  const [loadingCasts, setLoadingCasts] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [localFname, setLocalFname] = useState('');
  const [localPfp, setLocalPfp] = useState('');
  const { address: connectedAddress, isConnected, status: walletStatus } = useAccount();
  const { disconnect } = useDisconnect();
  const [menu, setMenu] = useState(null);
  const [zoom] = useState(1);
  const [playerCell, setPlayerCell] = useState(null);
  const [playerPath, setPlayerPath] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [playerPosHydrated, setPlayerPosHydrated] = useState(false);
  const playerPosStorageKey = `gbz:player-pos:${worldName}`;
  const menuRef = useRef(null);
  const worldScrollRef = useRef(null);
  const dragRef = useRef({ active: false, moved: false, suppressClick: false, x: 0, y: 0, left: 0, top: 0 });
  const zoomRef = useRef(1);
  const touchPointsRef = useRef(new Map());
  const nonTouchInputRef = useRef(false);
  const playerCellRef = useRef(null);
  const [remotePlayers, setRemotePlayers] = useState({});
  const [tradePlaceholders, setTradePlaceholders] = useState({});
  const [incomingTradeInvite, setIncomingTradeInvite] = useState(null);
  const [outgoingTradeInvite, setOutgoingTradeInvite] = useState(null);
  const [tradeToast, setTradeToast] = useState('');
  const [worldLogs, setWorldLogs] = useState([]);
  const [worldPresence, setWorldPresence] = useState({});
  const zoneChannelsRef = useRef(new Map());
  const zoneChannelStatusRef = useRef(new Map());
  const worldChannelSubscribedRef = useRef(false);
  const [authedPlayerId, setAuthedPlayerId] = useState('');
  const [playerMenuOpen, setPlayerMenuOpen] = useState(false);
  const supabaseRef = useRef(null);
  const channelRef = useRef(null);
  const lastBroadcastAtRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const skipLeaveOnceRef = useRef(false);
  const currentZoneKeyRef = useRef('');
  const cleanupDoneRef = useRef(false);
  const [realtimeRetryTick, setRealtimeRetryTick] = useState(0);
  const worldCapKickedRef = useRef(false);

  const pushWorldLog = (text) => {
    const label = String(text || '').trim();
    if (!label) return;
    const entry = { id: randomId('wlog'), text: label, ts: Date.now() };
    setWorldLogs((prev) => [...prev.slice(-4), entry]);
  };

  const supabasePublicKey = useMemo(
    () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    []
  );

  const multiplayerEnabled = useMemo(
    () =>
      String(process.env.NEXT_PUBLIC_MULTIPLAYER_ENABLED || '').toLowerCase() === 'true' &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(supabasePublicKey),
    [supabasePublicKey]
  );

  const playerIdentity = useMemo(() => {
    if (typeof window === 'undefined') return { playerId: '', sessionId: randomId('session') };

    const playerId = String(authedPlayerId || '').trim().toLowerCase();
    let sessionId = window.sessionStorage.getItem('gbz:session-id');
    if (!sessionId) {
      sessionId = randomId('session');
      window.sessionStorage.setItem('gbz:session-id', sessionId);
    }

    return { playerId, sessionId };
  }, [authedPlayerId]);

  const tileSize = 58;
  const zoneSize = 12;
  const zoneKeyForCell = (cell) => {
    if (!cell) return '';
    const zx = Math.max(0, Math.floor(Number(cell.x) / zoneSize));
    const zy = Math.max(0, Math.floor(Number(cell.y) / zoneSize));
    return `${zx}:${zy}`;
  };
  const neighborhoodZoneKeys = (cell) => {
    if (!cell) return [];
    const zx = Math.max(0, Math.floor(Number(cell.x) / zoneSize));
    const zy = Math.max(0, Math.floor(Number(cell.y) / zoneSize));
    const maxZone = Math.max(0, Math.floor((size - 1) / zoneSize));
    const out = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const nx = zx + dx;
        const ny = zy + dy;
        if (nx < 0 || ny < 0 || nx > maxZone || ny > maxZone) continue;
        out.push(`${nx}:${ny}`);
      }
    }
    return out;
  };
  const zoneChannelName = (zoneKey) => `world:${worldName}:zone:${zoneKey}`;
  const boardSidePx = Math.round(size * tileSize * zoom);
  const boardSide = `${boardSidePx}px`;
  const frameWidth = `min(calc(${boardSide} + 20px), calc(100vw - 32px))`;
  const frameHeight = `min(calc(${boardSide} + 20px), calc(100dvh - 96px))`;

  useEffect(() => {
    if (walletStatus === 'connecting') return;
    if (!isConnected || !connectedAddress) {
      router.replace('/');
    }
  }, [walletStatus, isConnected, connectedAddress, router]);

  useEffect(() => {
    let dead = false;
    async function loadAuth() {
      if (!connectedAddress) return;
      const token = getStoredAuthToken();
      if (!token) {
        router.replace('/');
        return;
      }
      const r = await fetchSession(token);
      const player = String(r?.session?.playerId || '').trim().toLowerCase();
      if (!r?.ok || !/^0x[a-f0-9]{40}$/.test(player) || player !== String(connectedAddress).toLowerCase()) {
        if (!dead) router.replace('/');
        return;
      }
      if (!dead) setAuthedPlayerId(player);
    }
    loadAuth();
    return () => { dead = true; };
  }, [connectedAddress, router]);

  useEffect(() => {
    if (!playerMenuOpen) return undefined;
    const onDocClick = () => setPlayerMenuOpen(false);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [playerMenuOpen]);

  useEffect(() => {
    let dead = false;
    async function loadFnameFromSdk() {
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;

        let ctx = null;
        try {
          if (typeof sdk?.context === 'function') ctx = await sdk.context();
          else ctx = sdk?.context || null;
        } catch {}

        const name = String(
          ctx?.user?.username
          || ctx?.user?.fname
          || ctx?.user?.displayName
          || ctx?.user?.display_name
          || ''
        )
          .replace(/^@/, '')
          .trim()
          .toLowerCase();
        const pfp = String(
          ctx?.user?.pfpUrl
          || ctx?.user?.pfp_url
          || ctx?.user?.pfp?.url
          || ''
        ).trim();

        if (!dead) {
          setLocalFname(name);
          setLocalPfp(pfp);
        }
      } catch {
        if (!dead) {
          setLocalFname('');
          setLocalPfp('');
        }
      }
    }
    loadFnameFromSdk();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    let dead = false;
    async function load() {
      if (!dead) setLoadingCasts(true);
      try {
        const join = apiPath.includes('?') ? '&' : '?';
        const r = await fetch(`${apiPath}${join}v=2`, { cache: 'no-store' });
        const d = await r.json();
        if (!dead && d?.ok && Array.isArray(d?.npcs)) setNpcs(d.npcs);
      } catch {}
      finally {
        if (!dead) setLoadingCasts(false);
      }
    }
    load();
    return () => {
      dead = true;
    };
  }, [apiPath]);

  useEffect(() => {
    playerCellRef.current = playerCell;
  }, [playerCell]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!tradeToast) return;
    const t = setTimeout(() => setTradeToast(''), 2600);
    return () => clearTimeout(t);
  }, [tradeToast]);

  useEffect(() => {
    if (!worldLogs.length) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setWorldLogs((prev) => prev.filter((item) => now - Number(item?.ts || 0) < 5000));
    }, 350);
    return () => clearTimeout(t);
  }, [worldLogs]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const toast = window.sessionStorage.getItem('gbz:world-toast');
      if (!toast) return;
      window.sessionStorage.removeItem('gbz:world-toast');
      setTradeToast(toast);
    } catch {}
  }, []);

  useEffect(() => {
    if (!outgoingTradeInvite) return;
    const msLeft = Number(outgoingTradeInvite?.expiresAt || 0) - Date.now();
    if (msLeft <= 0) {
      setOutgoingTradeInvite(null);
      setTradeToast(`no response from ${outgoingTradeInvite.toName || 'player'}`);
      return;
    }
    const t = setTimeout(() => setNowMs(Date.now()), Math.min(msLeft, 1000));
    return () => clearTimeout(t);
  }, [outgoingTradeInvite, nowMs]);

  const sendToZoneNeighborhood = (event, payload) => {
    for (const [zoneKey, ch] of zoneChannelsRef.current.entries()) {
      if (zoneChannelStatusRef.current.get(zoneKey) !== 'SUBSCRIBED') continue;
      try {
        ch.send({ type: 'broadcast', event, payload });
      } catch {}
    }
  };

  const sendToWorldChannel = (event, payload) => {
    const ch = channelRef.current;
    if (!ch || !worldChannelSubscribedRef.current) return false;
    try {
      ch.send({ type: 'broadcast', event, payload });
      return true;
    } catch {
      return false;
    }
  };

  const sendExactPlayerState = (payloadOverride = null) => {
    const basePayload = payloadOverride || (() => {
      const localCell = playerCellRef.current;
      if (!localCell) return null;
      return {
        world: worldName,
        sessionId: playerIdentity.sessionId,
        playerId: playerIdentity.playerId,
        fname: localFname,
        pfp: localPfp,
        x: localCell.x,
        y: localCell.y,
        zone: zoneKeyForCell(localCell),
        ts: Date.now(),
      };
    })();
    if (!basePayload) return;
    sendToZoneNeighborhood('player_state', basePayload);
  };

  const syncZoneSubscriptions = (cell) => {
    const supabase = supabaseRef.current;
    if (!supabase || !cell) return;
    const wanted = new Set(neighborhoodZoneKeys(cell));
    for (const [zoneKey, zoneCh] of Array.from(zoneChannelsRef.current.entries())) {
      if (wanted.has(zoneKey)) continue;
      try { supabase.removeChannel(zoneCh); } catch {}
      zoneChannelStatusRef.current.delete(zoneKey);
      zoneChannelsRef.current.delete(zoneKey);
    }
    for (const zoneKey of wanted) {
      if (zoneChannelsRef.current.has(zoneKey)) continue;
      const zoneChannel = supabase.channel(zoneChannelName(zoneKey), { config: { broadcast: { self: false } } });
      zoneChannelStatusRef.current.set(zoneKey, 'JOINING');
      zoneChannel.on('broadcast', { event: 'player_state' }, ({ payload }) => {
        const sessionId = String(payload?.sessionId || '').trim();
        if (!sessionId || sessionId === playerIdentity.sessionId) return;
        if (String(payload?.world || '') !== worldName) return;
        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        setRemotePlayers((prev) => {
          const hadPlayer = Boolean(prev[sessionId]);
          if (!hadPlayer) {
            const enteredName = shortPlayer(String(payload?.fname || payload?.playerId || 'player').replace(/^@/, '').trim() || 'player');
            pushWorldLog(`${enteredName} entered the world`);
          }
          return {
            ...prev,
            [sessionId]: {
              sessionId,
              playerId: String(payload?.playerId || ''),
              fname: String(payload?.fname || '').replace(/^@/, '').trim().toLowerCase(),
              pfp: String(payload?.pfp || '').trim(),
              x,
              y,
              updatedAt: Number(payload?.ts || Date.now()),
            },
          };
        });
      });
      zoneChannel.on('broadcast', { event: 'trade_placeholder' }, ({ payload }) => {
        const sessionId = String(payload?.sessionId || '').trim();
        if (!sessionId || sessionId === playerIdentity.sessionId) return;
        if (String(payload?.world || '') !== worldName) return;
        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        setTradePlaceholders((prev) => ({
          ...prev,
          [sessionId]: {
            sessionId,
            playerId: String(payload?.playerId || ''),
            fname: String(payload?.fname || '').replace(/^@/, '').trim().toLowerCase(),
            pfp: String(payload?.pfp || '').trim(),
            x,
            y,
            updatedAt: Number(payload?.ts || Date.now()),
            expiresAt: Number(payload?.expiresAt || (Date.now() + 10 * 60 * 1000)),
            trading: true,
          },
        }));
      });
      zoneChannel.subscribe((status) => {
        zoneChannelStatusRef.current.set(zoneKey, status);
      });
      zoneChannelsRef.current.set(zoneKey, zoneChannel);
    }
  };

  useEffect(() => {
    if (!incomingTradeInvite) return;
    const msLeft = Number(incomingTradeInvite?.expiresAt || 0) - Date.now();
    if (msLeft <= 0) {
      const invite = incomingTradeInvite;
      if (invite?.fromSessionId) {
        console.log('[trade] send invite_response timeout', {
          mySessionId: playerIdentity.sessionId,
          toSessionId: invite.fromSessionId,
          roomId: invite.roomId,
        });
        sendToWorldChannel('trade_invite_response', {
          world: worldName,
          toSessionId: invite.fromSessionId,
          fromSessionId: playerIdentity.sessionId,
          fromPlayerId: playerIdentity.playerId,
          fromFname: localFname,
          decision: 'decline',
          reason: 'timeout',
          ts: Date.now(),
        });
      }
      setIncomingTradeInvite(null);
      setTradeToast('trade request timed out');
      return;
    }
    const t = setTimeout(() => setNowMs(Date.now()), Math.min(msLeft, 1000));
    return () => clearTimeout(t);
  }, [incomingTradeInvite, nowMs, worldName, playerIdentity.sessionId, playerIdentity.playerId, localFname, sendToZoneNeighborhood]);

  useEffect(() => {
    if (!multiplayerEnabled) {
      return;
    }

    if (!/^0x[a-f0-9]{40}$/.test(String(playerIdentity.playerId || '').toLowerCase())) {
      return;
    }


    const supabase = getSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey);
    if (!supabase) return;
    cleanupDoneRef.current = false;
    let reconnectTimer = null;
    let unmounted = false;
    const channel = supabase.channel(`world:${worldName}`, {
      config: {
        broadcast: { self: false },
        presence: { key: playerIdentity.sessionId },
      },
    });

    channel.on('presence', { event: 'sync' }, () => {
      if (worldCapKickedRef.current) return;
      let ids = [];
      let state = {};
      try {
        state = channel.presenceState() || {};
        ids = Object.keys(state || {}).filter(Boolean);
      } catch {}
      const nextPresence = {};
      for (const [sid, metas] of Object.entries(state || {})) {
        if (!sid || sid === playerIdentity.sessionId) continue;
        const meta = Array.isArray(metas) ? (metas[metas.length - 1] || {}) : (metas || {});
        nextPresence[sid] = {
          sessionId: sid,
          playerId: String(meta?.playerId || ''),
          fname: String(meta?.fname || '').replace(/^@/, '').trim().toLowerCase(),
          pfp: String(meta?.pfp || '').trim(),
          zone: String(meta?.zone || ''),
          updatedAt: Number(meta?.ts || Date.now()),
          present: true,
        };
      }
      setWorldPresence((prev) => {
        for (const sid of Object.keys(prev || {})) {
          if (nextPresence[sid]) continue;
          setRemotePlayers((rp) => {
            if (!rp[sid]) return rp;
            const next = { ...rp };
            delete next[sid];
            return next;
          });
          setTradePlaceholders((tp) => {
            if (!tp[sid]) return tp;
            const next = { ...tp };
            delete next[sid];
            return next;
          });
        }
        return nextPresence;
      });
      const count = ids.length;
      if (count <= maxWorldPlayers) return;
      const admitted = ids.slice().sort().slice(0, maxWorldPlayers);
      if (admitted.includes(playerIdentity.sessionId)) return;
      worldCapKickedRef.current = true;
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('gbz:world-toast', `${worldName} is full (${maxWorldPlayers}/${maxWorldPlayers})`);
        }
      } catch {}
      router.replace('/worlds');
    });

    channel.on('broadcast', { event: 'trade_invite' }, ({ payload }) => {
      console.log('[trade] recv invite', {
        mySessionId: playerIdentity.sessionId,
        toSessionId: String(payload?.toSessionId || '').trim(),
        fromSessionId: String(payload?.fromSessionId || '').trim(),
        roomId: String(payload?.roomId || '').trim(),
        hasIncomingTradeInvite: Boolean(incomingTradeInvite),
      });
      if (incomingTradeInvite) return;
      const toSessionId = String(payload?.toSessionId || '').trim();
      if (toSessionId !== playerIdentity.sessionId) return;
      const fromSessionId = String(payload?.fromSessionId || '').trim();
      const fromPlayerId = String(payload?.fromPlayerId || '').trim();
      const fromFname = String(payload?.fromFname || '').replace(/^@/, '').trim();
      if (!fromSessionId) return;
      setIncomingTradeInvite({
        fromSessionId,
        fromPlayerId,
        fromFname,
        roomId: String(payload?.roomId || ''),
        world: String(payload?.world || worldName),
        at: Number(payload?.ts || Date.now()),
        expiresAt: Number(payload?.expiresAt || Date.now() + 60_000),
      });
    });

    channel.on('broadcast', { event: 'trade_invite_response' }, ({ payload }) => {
      console.log('[trade] recv invite_response', {
        mySessionId: playerIdentity.sessionId,
        toSessionId: String(payload?.toSessionId || '').trim(),
        fromSessionId: String(payload?.fromSessionId || '').trim(),
        roomId: String(payload?.roomId || '').trim(),
        decision: String(payload?.decision || '').trim().toLowerCase(),
        hasOutgoingTradeInvite: Boolean(outgoingTradeInvite),
      });
      const toSessionId = String(payload?.toSessionId || '').trim();
      if (toSessionId !== playerIdentity.sessionId) return;
      const decision = String(payload?.decision || '').trim().toLowerCase();
      const fromName = String(payload?.fromFname || payload?.fromPlayerId || 'player').trim();
      setOutgoingTradeInvite(null);
      if (decision === 'accept') {
        setTradeToast(`${fromName} accepted your trade request`);
        const roomId = String(payload?.roomId || '').trim();
        if (roomId) {
          const senderPlayerId = String(payload?.fromPlayerId || '').trim();
          const senderFname = String(payload?.fromFname || '').replace(/^@/, '').trim();
          const senderSessionId = String(payload?.fromSessionId || '').trim();
          const qs = new URLSearchParams({
            role: 'signer',
            channel: worldName,
            ...(senderPlayerId ? { senderPlayerId } : {}),
            ...(senderFname ? { senderFname } : {}),
            ...(senderSessionId ? { senderSessionId } : {}),
          });
          router.push(`/maker/live/${encodeURIComponent(roomId)}?${qs.toString()}`);
        }
      }
      if (decision === 'decline') {
        const reason = String(payload?.reason || '').trim().toLowerCase();
        if (reason === 'timeout') setTradeToast(`${fromName} did not respond in time`);
        else setTradeToast(`${fromName} declined your trade request`);
      }
    });

    channel.subscribe((status) => {
      worldChannelSubscribedRef.current = status === 'SUBSCRIBED';
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (unmounted) return;
        if (status === 'CLOSED') {
          return;
        }
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(8000, 800 * attempt);
        setTradeToast(`realtime reconnecting... (${attempt})`);
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            skipLeaveOnceRef.current = true;
            setRealtimeRetryTick((v) => v + 1);
          }, delay);
        }
      }
      const localCell = playerCellRef.current;
      if (status === 'SUBSCRIBED') {
        reconnectAttemptRef.current = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        try {
          channel.track({
            sessionId: playerIdentity.sessionId,
            playerId: playerIdentity.playerId,
            fname: localFname,
            pfp: localPfp,
            world: worldName,
            zone: zoneKeyForCell(playerCellRef.current),
            ts: Date.now(),
          });
        } catch {}
        if (localCell) {
          const zoneKey = zoneKeyForCell(localCell);
          currentZoneKeyRef.current = zoneKey;
          syncZoneSubscriptions(localCell);
          sendExactPlayerState({
            world: worldName,
            sessionId: playerIdentity.sessionId,
            playerId: playerIdentity.playerId,
            fname: localFname,
            pfp: localPfp,
            x: localCell.x,
            y: localCell.y,
            zone: zoneKey,
            ts: Date.now(),
          });
        }
      }
    });

    supabaseRef.current = supabase;
    channelRef.current = channel;

    const staleSweep = setInterval(() => {
      const cutoff = Date.now() - 20_000;
      setRemotePlayers((prev) => {
        let dirty = false;
        const next = { ...prev };
        for (const [sid, p] of Object.entries(prev)) {
          if (Number(p?.updatedAt || 0) < cutoff) {
            const leaveName = shortPlayer(p?.fname || p?.playerId || 'player');
            pushWorldLog(`${leaveName} left the world`);
            delete next[sid];
            dirty = true;
          }
        }
        return dirty ? next : prev;
      });
      setTradePlaceholders((prev) => {
        let dirty = false;
        const now = Date.now();
        const next = { ...prev };
        for (const [sid, p] of Object.entries(prev)) {
          const exp = Number(p?.expiresAt || 0);
          if ((exp && now > exp) || Number(p?.updatedAt || 0) < now - (15 * 60 * 1000)) {
            delete next[sid];
            dirty = true;
          }
        }
        return dirty ? next : prev;
      });
    }, 10_000);

    const heartbeat = setInterval(() => {
      const ch = channelRef.current;
      const localCell = playerCellRef.current;
      if (!ch || !localCell) return;
      try {
        ch.track({
          sessionId: playerIdentity.sessionId,
          playerId: playerIdentity.playerId,
          fname: localFname,
          pfp: localPfp,
          world: worldName,
          zone: zoneKeyForCell(localCell),
          ts: Date.now(),
        });
      } catch {}
    }, 20_000);

    return () => {
      if (cleanupDoneRef.current) return;
      cleanupDoneRef.current = true;
      unmounted = true;
      clearInterval(staleSweep);
      clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (skipLeaveOnceRef.current) {
        skipLeaveOnceRef.current = false;
      }
      try {
        supabase.removeChannel(channel);
      } catch {}
      for (const ch of zoneChannelsRef.current.values()) {
        try { supabase.removeChannel(ch); } catch {}
      }
      zoneChannelsRef.current.clear();
      zoneChannelStatusRef.current.clear();
      currentZoneKeyRef.current = '';
      channelRef.current = null;
      supabaseRef.current = null;
      setRemotePlayers({});
      setTradePlaceholders({});
      setWorldPresence({});
    };
  }, [multiplayerEnabled, worldName, supabasePublicKey, playerIdentity.sessionId, playerIdentity.playerId, localFname, localPfp, router, realtimeRetryTick]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(any-pointer: fine) and (hover: hover)');
    const sync = () => {
      const touchPoints = Number(navigator?.maxTouchPoints || 0);
      nonTouchInputRef.current = Boolean(mq.matches) && touchPoints === 0;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    function onDown(e) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenu(null);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setMenu(null);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = worldScrollRef.current;
    if (!el) return;
    const centerWorld = () => {
      const left = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      const top = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
      el.scrollTo({ left, top, behavior: 'auto' });
    };
    centerWorld();
    window.addEventListener('resize', centerWorld);
    return () => window.removeEventListener('resize', centerWorld);
  }, []);

  const centerOnPlayer = (behavior = 'smooth') => {
    const el = worldScrollRef.current;
    if (!el || !playerCell) return;
    const tilePx = boardSidePx / size;
    const targetLeft = (playerCell.x + 0.5) * tilePx - el.clientWidth / 2;
    const targetTop = (playerCell.y + 0.5) * tilePx - el.clientHeight / 2;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const left = Math.max(0, Math.min(maxLeft, targetLeft));
    const top = Math.max(0, Math.min(maxTop, targetTop));
    el.scrollTo({ left, top, behavior });
  };

  useEffect(() => {
    if (!playerCell) return;
    const behavior = playerPath.length ? 'smooth' : 'auto';
    centerOnPlayer(behavior);
  }, [playerCell, boardSidePx]);

  const blockedCells = useMemo(() => {
    const b = new Set();
    for (let i = 0; i < size; i += 1) {
      b.add(cellKey(i, 0));
      b.add(cellKey(i, size - 1));
      b.add(cellKey(0, i));
      b.add(cellKey(size - 1, i));
    }
    for (let fy = fountainOrigin.y; fy < fountainOrigin.y + 3; fy += 1) {
      for (let fx = fountainOrigin.x; fx < fountainOrigin.x + 3; fx += 1) {
        b.add(cellKey(fx, fy));
      }
    }
    for (let by = bankCell.y; by < bankCell.y + 3; by += 1) {
      for (let bx = bankCell.x; bx < bankCell.x + 3; bx += 1) {
        b.add(cellKey(bx, by));
      }
    }
    return b;
  }, [size, fountainOrigin.x, fountainOrigin.y, bankCell.x, bankCell.y]);

  useEffect(() => {
    if (playerCell) {
      setPlayerPosHydrated(true);
      return;
    }
    if (typeof window === 'undefined') {
      setPlayerPosHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(playerPosStorageKey);
      if (raw) {
        const p = JSON.parse(raw);
        const x = Number(p?.x);
        const y = Number(p?.y);
        const inBounds = Number.isFinite(x) && Number.isFinite(y) && x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2;
        if (inBounds && !blockedCells.has(cellKey(x, y))) {
          setPlayerCell({ x, y });
        }
      }
    } catch {}
    setPlayerPosHydrated(true);
  }, [playerCell, blockedCells, playerPosStorageKey, size]);

  useEffect(() => {
    if (!playerCell) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(playerPosStorageKey, JSON.stringify({ x: playerCell.x, y: playerCell.y }));
    } catch {}
  }, [playerCell, playerPosStorageKey]);

  useEffect(() => {
    if (!playerPosHydrated) return;
    if (playerCell) return;
    const candidates = [
      { x: bankCell.x + 1, y: bankCell.y + 3 },
      { x: bankCell.x + 1, y: bankCell.y + 4 },
      { x: bankCell.x - 1, y: bankCell.y + 1 },
      { x: bankCell.x + 3, y: bankCell.y + 1 },
      { x: bankCell.x + 1, y: bankCell.y - 1 },
    ].filter((c) => c.x >= 1 && c.y >= 1 && c.x <= size - 2 && c.y <= size - 2);

    const spawn = candidates.find((c) => !blockedCells.has(cellKey(c.x, c.y))) || { x: center - 1, y: center };
    setPlayerCell(spawn);
  }, [playerPosHydrated, playerCell, blockedCells, bankCell.x, bankCell.y, size, center]);

  useEffect(() => {
    if (!playerPath.length) return;
    const t = setInterval(() => {
      setPlayerPath((prev) => {
        if (!prev.length) return prev;
        const [next, ...rest] = prev;
        setPlayerCell(next);
        return rest;
      });
    }, 170);
    return () => clearInterval(t);
  }, [playerPath.length]);

  useEffect(() => {
    if (playerPath.length) return;
    if (!pendingAction) return;
    const fn = pendingAction;
    setPendingAction(null);
    fn();
  }, [playerPath.length, pendingAction]);

  useEffect(() => {
    if (!multiplayerEnabled || !playerCell) return;
    const ch = channelRef.current;
    if (!ch) return;
    const now = Date.now();
    if (now - lastBroadcastAtRef.current < 250) return;
    lastBroadcastAtRef.current = now;

    const zoneKey = zoneKeyForCell(playerCell);
    const prevZoneKey = currentZoneKeyRef.current;
    if (zoneKey !== prevZoneKey) {
      currentZoneKeyRef.current = zoneKey;
      try {
        ch.track({
          sessionId: playerIdentity.sessionId,
          playerId: playerIdentity.playerId,
          fname: localFname,
          pfp: localPfp,
          world: worldName,
          zone: zoneKey,
          ts: now,
        });
      } catch {}
      syncZoneSubscriptions(playerCell);
    }
    sendExactPlayerState({
      world: worldName,
      sessionId: playerIdentity.sessionId,
      playerId: playerIdentity.playerId,
      fname: localFname,
      pfp: localPfp,
      x: playerCell.x,
      y: playerCell.y,
      zone: zoneKey,
      ts: now,
    });
  }, [multiplayerEnabled, worldName, playerIdentity.sessionId, playerIdentity.playerId, localFname, localPfp, playerCell, sendExactPlayerState]);


  const npcsWithCurrentCast = useMemo(() => {
    const allCasts = (npcs || [])
      .flatMap((n) => (Array.isArray(n?.casts) ? n.casts : []))
      .map((c) => Number(c?.graphIndex))
      .filter((v) => Number.isFinite(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER)
      .sort((a, b) => a - b);

    const maxGraphIndex = allCasts.length ? allCasts[allCasts.length - 1] : 0;
    const eventMs = 2600;
    const loopPauseMs = 3200;
    const linearSpanMs = (maxGraphIndex + 1) * eventMs;
    const loopMs = linearSpanMs + loopPauseMs;
    const t = loopMs > 0 ? nowMs % loopMs : 0;
    const globalCursor = t >= linearSpanMs ? maxGraphIndex : Math.floor(t / eventMs);

    return (npcs || []).map((n) => {
      const list = (Array.isArray(n?.casts) ? n.casts : [])
        .filter((c) => Number.isFinite(Number(c?.graphIndex)) && Number(c?.graphIndex) >= 0 && Number(c?.graphIndex) < Number.MAX_SAFE_INTEGER)
        .sort((a, b) => Number(a.graphIndex) - Number(b.graphIndex));

      const publicOffer = list.find((c) => c?.isPublicSwapOffer) || null;
      if (!list.length) return { ...n, currentCast: null, lastCastShown: null, publicOfferCast: publicOffer };

      // Global ordering projection: latest cast for this user that has appeared in global sequence.
      let shownCast = null;
      for (let i = 0; i < list.length; i += 1) {
        const gi = Number(list[i].graphIndex);
        if (gi <= globalCursor) shownCast = list[i];
        else break;
      }
      if (!shownCast) shownCast = list[0];

      // Hold valid public offers on screen for at least 6s after their global appearance.
      const validHoldMs = 6000;
      const heldOffer = list
        .filter((c) => Boolean(c?.isPublicSwapOffer || c?.publicOfferViable))
        .filter((c) => {
          const gi = Number(c?.graphIndex);
          if (!Number.isFinite(gi) || gi < 0) return false;
          const start = gi * eventMs;
          return t >= start && t < start + validHoldMs;
        })
        .sort((a, b) => Number(b.graphIndex) - Number(a.graphIndex))[0] || null;
      if (heldOffer) shownCast = heldOffer;

      // Keep independent per-tile blink/blank rhythm on top of globally-selected cast.
      const key = String(n?.fid || n?.username || 'npc');
      const isValidPublicOffer = Boolean(shownCast?.isPublicSwapOffer || shownCast?.publicOfferViable);
      const castDurationMs = isValidPublicOffer
        ? 6000
        : (3200 + Math.floor(hashToUnit(`${key}:dur`) * 2800)); // valid offers pinned >=6s; others 3.2s..6s
      const blankDurationMs = isValidPublicOffer ? 0 : Math.floor(castDurationMs * 0.5);
      const tileCycle = castDurationMs + blankDurationMs;
      const tileOffset = Math.floor(hashToUnit(`${key}:phase`) * tileCycle);
      const tilePhase = (nowMs + tileOffset) % tileCycle;
      const showText = tilePhase < castDurationMs;

      return {
        ...n,
        currentCast: showText ? shownCast : null,
        lastCastShown: shownCast,
        publicOfferCast: publicOffer,
      };
    });
  }, [npcs, nowMs]);

  const byCell = useMemo(() => {
    const placed = new Map();
    if (!npcsWithCurrentCast.length) return placed;

    const users = npcsWithCurrentCast.map((n, idx) => ({
      ...n,
      _idx: idx,
      _key: String(n.fid || n.username || idx),
      _score: Number(n.topScore || n.currentCast?.engagementScore || 0),
    }));

    const castOwner = new Map();
    for (const u of users) {
      const list = Array.isArray(u.casts) ? u.casts : [];
      for (const c of list) castOwner.set(String(c.castHash), u._key);
    }

    const edges = new Map();
    const bump = (a, b, w = 1) => {
      if (!a || !b || a === b) return;
      const x = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(x, (edges.get(x) || 0) + w);
    };
    for (const u of users) {
      const list = Array.isArray(u.casts) ? u.casts : [];
      for (const c of list) {
        const parentOwner = castOwner.get(String(c.parentHash || ''));
        if (parentOwner) bump(u._key, parentOwner, 1);
      }
    }

    const nbr = new Map(users.map((u) => [u._key, []]));
    for (const [k, w] of edges.entries()) {
      const [a, b] = k.split('|');
      nbr.get(a)?.push({ to: b, w });
      nbr.get(b)?.push({ to: a, w });
    }

    const seen = new Set();
    const components = [];
    for (const u of users) {
      if (seen.has(u._key)) continue;
      const stack = [u._key];
      seen.add(u._key);
      const comp = [];
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const n of nbr.get(cur) || []) {
          if (seen.has(n.to)) continue;
          seen.add(n.to);
          stack.push(n.to);
        }
      }
      components.push(comp);
    }

    const keyToUser = new Map(users.map((u) => [u._key, u]));
    const maxScore = Math.max(1, ...users.map((u) => u._score));
    const minClusterRadius = Math.max(4, Math.floor(size * 0.22));
    const maxClusterRadius = Math.max(minClusterRadius + 2, Math.floor(size * 0.46));

    const compSorted = components
      .map((comp) => ({
        keys: comp,
        score: comp.reduce((s, k) => s + (keyToUser.get(k)?._score || 0), 0),
      }))
      .sort((a, b) => b.score - a.score);

    const targets = [];
    for (let ci = 0; ci < compSorted.length; ci += 1) {
      const comp = compSorted[ci];
      const clusterAngle = (2 * Math.PI * ci) / Math.max(1, compSorted.length);
      const clusterScoreNorm = Math.min(1, comp.score / Math.max(1, comp.keys.length * maxScore));
      const radialJitter = hashToUnit(`cluster:${ci}:r`);
      const spreadBias = 0.35 + 0.65 * radialJitter;
      const clusterR = Math.round(
        minClusterRadius + (maxClusterRadius - minClusterRadius) * (1 - 0.45 * clusterScoreNorm) * spreadBias
      );
      const cx = center + Math.cos(clusterAngle) * clusterR;
      const cy = center + Math.sin(clusterAngle) * clusterR;

      const keys = [...comp.keys].sort((a, b) => {
        const aw = (nbr.get(a) || []).reduce((s, x) => s + x.w, 0);
        const bw = (nbr.get(b) || []).reduce((s, x) => s + x.w, 0);
        if (bw !== aw) return bw - aw;
        return (keyToUser.get(b)?._score || 0) - (keyToUser.get(a)?._score || 0);
      });

      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const u = keyToUser.get(k);
        if (!u) continue;
        const linkedWeight = (nbr.get(k) || []).reduce((s, x) => s + x.w, 0);
        const scoreNorm = Math.min(1, u._score / maxScore);

        const localR = Math.max(1.4, 3.8 - Math.min(2.3, linkedWeight * 0.22) - scoreNorm * 1.1);
        const localAngle = (2 * Math.PI * i) / Math.max(1, keys.length) + hashToUnit(`${k}:jitter`) * 0.7;
        const tx = cx + Math.cos(localAngle) * localR;
        const ty = cy + Math.sin(localAngle) * localR;
        targets.push({ u, tx, ty, scoreNorm });
      }
    }

    targets.sort((a, b) => b.scoreNorm - a.scoreNorm);

    const bankKey = `${bankCell.x}-${bankCell.y}`;

    for (const t of targets) {
      let x = Math.max(1, Math.min(size - 2, Math.round(t.tx)));
      let y = Math.max(1, Math.min(size - 2, Math.round(t.ty)));
      if (x === center && y === center) x = Math.min(size - 2, x + 1);

      let tries = 0;
      let r = 1;
      while ((x === center && y === center) || `${x}-${y}` === bankKey || placed.has(`${x}-${y}`)) {
        const a = hashToUnit(`${t.u._key}:${tries}:a`) * 2 * Math.PI;
        const nx = Math.round(t.tx + Math.cos(a) * r);
        const ny = Math.round(t.ty + Math.sin(a) * r);
        x = Math.max(1, Math.min(size - 2, nx));
        y = Math.max(1, Math.min(size - 2, ny));
        tries += 1;
        if (tries % 8 === 0) r += 1;
        if (tries > size * size) break;
      }
      if (x === center && y === center) continue;
      placed.set(`${x}-${y}`, t.u);
    }

    return placed;
  }, [npcsWithCurrentCast]);

  const nearbyRemoteByCell = useMemo(() => {
    const out = new Map();
    const here = playerCell;
    if (!here) return out;
    const radius = 8;
    const all = [
      ...Object.values(remotePlayers || {}),
      ...Object.values(tradePlaceholders || {}),
    ];
    for (const p of all) {
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (Math.abs(x - here.x) > radius || Math.abs(y - here.y) > radius) continue;
      const k = cellKey(x, y);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(p);
    }
    return out;
  }, [remotePlayers, tradePlaceholders, playerCell]);

  const presentElsewhereCount = useMemo(() => {
    const nearbyIds = new Set([
      ...Object.keys(remotePlayers || {}),
      ...Object.keys(tradePlaceholders || {}),
    ]);
    return Object.keys(worldPresence || {}).filter((sid) => sid && !nearbyIds.has(sid)).length;
  }, [worldPresence, remotePlayers, tradePlaceholders]);

  const openNpcMenu = (e, npc) => {
    e.preventDefault();
    e.stopPropagation();
    const name = String(npc?.displayName || npc?.username || 'user');
    setMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'npc',
      npc,
      name,
    });
  };

  const openBankMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'bank',
      name: 'Bazaar Bank',
    });
  };

  const openTileMenu = (e, x, y) => {
    if (dragRef.current.active) return;
    if (dragRef.current.suppressClick || dragRef.current.moved) {
      dragRef.current.suppressClick = false;
      dragRef.current.moved = false;
      return;
    }
    e.preventDefault();

    const remotes = nearbyRemoteByCell.get(cellKey(x, y)) || [];
    if (remotes.length) {
      const remote = remotes[0];
      const displayId = String(remote?.fname || remote?.playerId || remote?.sessionId || 'player').trim();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'remote',
        remote,
        name: displayId,
      });
      return;
    }

    if (blockedCells.has(cellKey(x, y))) return;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'tile',
      tile: { x, y },
      name: `Tile ${x},${y}`,
    });
  };

  const onWorldMouseDown = (e) => {
    const el = worldScrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      moved: false,
      suppressClick: false,
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  };

  const onWorldMouseMove = (e) => {
    const el = worldScrollRef.current;
    const st = dragRef.current;
    if (!el || !st.active) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
    el.scrollLeft = st.left - dx;
    el.scrollTop = st.top - dy;
  };

  const onWorldMouseUp = () => {
    const el = worldScrollRef.current;
    dragRef.current.active = false;
    if (dragRef.current.moved) dragRef.current.suppressClick = true;
    if (!el) return;
    el.style.cursor = 'grab';
    el.style.userSelect = '';
  };

  const onWorldDragStart = (e) => {
    e.preventDefault();
  };

  const onWorldPointerDown = (e) => {
    const t = String(e?.pointerType || '').toLowerCase();
    if (t !== 'touch') return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onWorldPointerMove = (e) => {
    const t = String(e?.pointerType || '').toLowerCase();
    if (t !== 'touch') return;
    if (!touchPointsRef.current.has(e.pointerId)) return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onWorldPointerUp = (e) => {
    touchPointsRef.current.delete(e.pointerId);
  };

  const onWorldWheel = () => {};

  const runTalk = (npc) => {
    if (!npc) return;
    const firstCast = Array.isArray(npc?.casts) ? (npc.casts[0] || null) : null;
    const c = npc?.currentCast || npc?.lastCastShown || firstCast;
    const link = c?.permalink || c?.castUrl;
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
  };

  const runTrade = (npc) => {
    if (!npc) return;
    const offerHash = npc?.publicOfferCast?.castHash;
    if (offerHash) {
      router.push(`/c/${offerHash}`);
      return;
    }

    const fname = String(npc?.username || '').replace(/^@/, '').trim();
    if (!fname) return;
    router.push(`/maker?counterparty=${encodeURIComponent(fname)}&channel=${encodeURIComponent(worldName)}`);
  };

  const moveToNpcAdjacentThen = (npc, action) => {
    if (!npc || !playerCell) {
      action?.();
      return;
    }
    const npcCell = [...byCell.entries()].find(([, v]) => v?._key === npc?._key)?.[0] || null;
    if (!npcCell) {
      action?.();
      return;
    }
    const [nx, ny] = npcCell.split('-').map(Number);
    const adjacent = [
      { x: nx + 1, y: ny },
      { x: nx - 1, y: ny },
      { x: nx, y: ny + 1 },
      { x: nx, y: ny - 1 },
    ].filter((c) => c.x >= 1 && c.y >= 1 && c.x <= size - 2 && c.y <= size - 2 && !blockedCells.has(cellKey(c.x, c.y)));

    if (!adjacent.length) {
      action?.();
      return;
    }

    const isAlreadyAdjacent = adjacent.some((c) => c.x === playerCell.x && c.y === playerCell.y);
    if (isAlreadyAdjacent) {
      action?.();
      return;
    }

    const npcCellKey = cellKey(nx, ny);
    const blockedPreferNpcAvoid = withNpcBlocked(blockedCells, [npcCellKey]);
    const blockedFallback = blockedCells;

    const getCandidates = (blockedSet) => adjacent
      .map((goal) => ({ goal, path: findPath({ size, blocked: blockedSet, start: playerCell, goal }) }))
      .filter((x) => x.path.length > 1)
      .sort((a, b) => a.path.length - b.path.length);

    let candidates = getCandidates(blockedPreferNpcAvoid);
    if (!candidates.length) candidates = getCandidates(blockedFallback);

    if (!candidates.length) {
      action?.();
      return;
    }

    const best = candidates[0];
    setPendingAction(() => action);
    setPlayerPath(best.path.slice(1));
  };

  const withNpcBlocked = (baseBlocked = blockedCells, exceptKeys = []) => {
    const out = new Set(baseBlocked);
    for (const [k] of byCell.entries()) out.add(k);
    for (const ex of exceptKeys) {
      if (ex) out.delete(ex);
    }
    return out;
  };

  const onTalk = () => {
    if (!menu?.npc) return;
    const npc = menu.npc;
    setMenu(null);
    moveToNpcAdjacentThen(npc, () => runTalk(npc));
  };

  const onTrade = async () => {
    if (!menu?.npc) return;
    const npc = menu.npc;
    setMenu(null);
    moveToNpcAdjacentThen(npc, () => runTrade(npc));
  };

  const moveToRemoteAdjacentThen = (remote, action) => {
    if (!remote || !playerCell) {
      action?.();
      return;
    }

    const rx = Number(remote?.x);
    const ry = Number(remote?.y);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
      action?.();
      return;
    }

    const adjacent = [
      { x: rx + 1, y: ry },
      { x: rx - 1, y: ry },
      { x: rx, y: ry + 1 },
      { x: rx, y: ry - 1 },
    ].filter((c) => c.x >= 1 && c.y >= 1 && c.x <= size - 2 && c.y <= size - 2 && !blockedCells.has(cellKey(c.x, c.y)));

    if (!adjacent.length) {
      action?.();
      return;
    }

    const isAlreadyAdjacent = adjacent.some((c) => c.x === playerCell.x && c.y === playerCell.y);
    if (isAlreadyAdjacent) {
      action?.();
      return;
    }

    const targetRemoteKey = cellKey(rx, ry);
    const blockedPreferAvoid = new Set(blockedCells);
    for (const [k] of byCell.entries()) blockedPreferAvoid.add(k);
    for (const p of Object.values(remotePlayers || {})) {
      const px = Number(p?.x);
      const py = Number(p?.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      blockedPreferAvoid.add(cellKey(px, py));
    }
    blockedPreferAvoid.delete(targetRemoteKey);

    const getCandidates = (blockedSet) => adjacent
      .map((goal) => ({ goal, path: findPath({ size, blocked: blockedSet, start: playerCell, goal }) }))
      .filter((x) => x.path.length > 1)
      .sort((a, b) => a.path.length - b.path.length);

    let candidates = getCandidates(blockedPreferAvoid);
    if (!candidates.length) candidates = getCandidates(blockedCells);

    if (!candidates.length) {
      action?.();
      return;
    }

    const best = candidates[0];
    setPendingAction(() => action);
    setPlayerPath(best.path.slice(1));
  };

  const onTradeRemote = () => {
    if (!menu?.remote) return;
    const remote = menu.remote;
    const targetSessionId = String(remote?.sessionId || '').trim();
    const targetName = String(remote?.fname || remote?.playerId || 'player').replace(/^@/, '').trim();
    setMenu(null);
    if (!targetSessionId) return;

    moveToRemoteAdjacentThen(remote, () => {
      const ch = channelRef.current;
      if (!ch) {
        setTradeToast('multiplayer channel not ready');
        return;
      }

      // Safety: never finalize invite from overlapping tile.
      // If overlap is detected, nudge initiator one tile aside before broadcasting.
      const localCell = playerCellRef.current;
      const rx = Number(remote?.x);
      const ry = Number(remote?.y);
      if (localCell && Number.isFinite(rx) && Number.isFinite(ry) && localCell.x === rx && localCell.y === ry) {
        const occupied = new Set();
        for (const [k] of byCell.entries()) occupied.add(k);
        for (const p of Object.values(remotePlayers || {})) {
          const px = Number(p?.x);
          const py = Number(p?.y);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          occupied.add(cellKey(px, py));
        }
        // allow target tile check separately; we want a different tile anyway
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
          const nx = localCell.x + dx;
          const ny = localCell.y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (nx === rx && ny === ry) continue;
          const k = cellKey(nx, ny);
          if (occupied.has(k)) continue;
          const nudged = { x: nx, y: ny };
          setPlayerCell(nudged);
          playerCellRef.current = nudged;
          sendExactPlayerState({
            world: worldName,
            sessionId: playerIdentity.sessionId,
            playerId: playerIdentity.playerId,
            fname: localFname,
            pfp: localPfp,
            x: nudged.x,
            y: nudged.y,
            zone: zoneKeyForCell(nudged),
            ts: Date.now(),
          });
          break;
        }
      }

      const expiresAt = Date.now() + 60_000;
      const signerAddr = String(playerIdentity.playerId || '').toLowerCase();
      const senderAddr = String(remote?.playerId || '').toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(signerAddr) || !/^0x[a-f0-9]{40}$/.test(senderAddr)) {
        setTradeToast('trade requires verified wallet addresses');
        return;
      }
      const roomId = createRoomId(signerAddr, senderAddr);
      console.log('[trade] send invite', {
        mySessionId: playerIdentity.sessionId,
        toSessionId: targetSessionId,
        roomId,
      });
      sendToWorldChannel('trade_invite', {
        world: worldName,
        toSessionId: targetSessionId,
        fromSessionId: playerIdentity.sessionId,
        fromPlayerId: playerIdentity.playerId,
        fromFname: localFname,
        roomId,
        ts: Date.now(),
        expiresAt,
      });
      setOutgoingTradeInvite({
        toSessionId: targetSessionId,
        toName: targetName,
        roomId,
        expiresAt,
      });
    });
  };

  const onRespondTradeInvite = (decision) => {
    const invite = incomingTradeInvite;
    setIncomingTradeInvite(null);
    if (!invite) return;
    const ch = channelRef.current;
    if (!ch) return;

    console.log('[trade] send invite_response', {
      mySessionId: playerIdentity.sessionId,
      toSessionId: invite.fromSessionId,
      roomId: invite.roomId,
      decision,
    });
    sendToWorldChannel('trade_invite_response', {
      world: worldName,
      toSessionId: invite.fromSessionId,
      fromSessionId: playerIdentity.sessionId,
      fromPlayerId: playerIdentity.playerId,
      fromFname: localFname,
      roomId: invite.roomId,
      decision,
      ts: Date.now(),
    });

    if (decision === 'accept') {
      const target = String(invite.fromFname || invite.fromPlayerId || '').replace(/^@/, '').trim();
      setTradeToast(`accepted trade with ${target || 'player'}`);
      const roomId = String(invite.roomId || '').trim();
      if (roomId) {
        const signerPlayerId = String(invite.fromPlayerId || '').trim();
        const signerFname = String(invite.fromFname || '').replace(/^@/, '').trim();
        const signerSessionId = String(invite.fromSessionId || '').trim();
        const qs = new URLSearchParams({
          role: 'sender',
          channel: worldName,
          ...(signerPlayerId ? { signerPlayerId } : {}),
          ...(signerFname ? { signerFname } : {}),
          ...(signerSessionId ? { signerSessionId } : {}),
        });
        router.push(`/maker/live/${encodeURIComponent(roomId)}?${qs.toString()}`);
      }
    }
    if (decision === 'decline') {
      setTradeToast('trade request declined');
    }
  };

  const moveToBankAdjacentThen = (action) => {
    if (!playerCell) {
      action?.();
      return;
    }
    const adjacent = [
      { x: bankCell.x + 1, y: bankCell.y },
      { x: bankCell.x - 1, y: bankCell.y },
      { x: bankCell.x, y: bankCell.y + 1 },
      { x: bankCell.x, y: bankCell.y - 1 },
    ].filter((c) => c.x >= 1 && c.y >= 1 && c.x <= size - 2 && c.y <= size - 2 && !blockedCells.has(cellKey(c.x, c.y)));

    const isAlreadyAdjacent = adjacent.some((c) => c.x === playerCell.x && c.y === playerCell.y);
    if (isAlreadyAdjacent) {
      action?.();
      return;
    }

    const blockedPreferNpcAvoid = withNpcBlocked(blockedCells);
    const blockedFallback = blockedCells;

    const getCandidates = (blockedSet) => adjacent
      .map((goal) => ({ goal, path: findPath({ size, blocked: blockedSet, start: playerCell, goal }) }))
      .filter((x) => x.path.length > 1)
      .sort((a, b) => a.path.length - b.path.length);

    let candidates = getCandidates(blockedPreferNpcAvoid);
    if (!candidates.length) candidates = getCandidates(blockedFallback);

    if (!candidates.length) {
      action?.();
      return;
    }

    const best = candidates[0];
    setPendingAction(() => action);
    setPlayerPath(best.path.slice(1));
  };

  const onTradeAnyone = () => {
    setMenu(null);
    moveToBankAdjacentThen(() => {
      router.push(`/maker?channel=${encodeURIComponent(worldName)}`);
    });
  };

  const onMoveHere = () => {
    if (!menu?.tile || !playerCell) return;
    const goal = menu.tile;
    if (blockedCells.has(cellKey(goal.x, goal.y))) {
      setMenu(null);
      return;
    }

    const blockedPreferNpcAvoid = withNpcBlocked(blockedCells);
    const pathPrefer = findPath({ size, blocked: blockedPreferNpcAvoid, start: playerCell, goal });
    const pathFallback = pathPrefer.length > 1 ? pathPrefer : findPath({ size, blocked: blockedCells, start: playerCell, goal });

    if (pathFallback.length > 1) {
      setPlayerPath(pathFallback.slice(1));
    } else {
      setPlayerPath([]);
    }
    setMenu(null);
  };

  const playerTag = localFname ? `@${localFname}` : shortAddr(playerIdentity.playerId || connectedAddress || '');

  const onDisconnectPlayer = async () => {
    try {
      setStoredAuthToken('');
      try { disconnect?.(); } catch {}
      router.replace('/');
    } catch {
      router.replace('/');
    }
  };

  const trees = ['🌲', '🌳', '🌴'];
  const cells = [];
  const labels = [];
  const landmarkOverlays = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x}-${y}`;
      const npc = byCell.get(key);
      const current = npc?.currentCast || null;
      const isFountain = x >= fountainOrigin.x && x < fountainOrigin.x + 3 && y >= fountainOrigin.y && y < fountainOrigin.y + 3;
      const isFountainAnchor = x === fountainOrigin.x + 1 && y === fountainOrigin.y + 1;
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const isBank = x >= bankCell.x && x < bankCell.x + 3 && y >= bankCell.y && y < bankCell.y + 3;
      const isBankAnchor = x === bankCell.x + 1 && y === bankCell.y + 1;
      const isPlayer = playerCell && x === playerCell.x && y === playerCell.y;
      const tree = trees[Math.floor(hashToUnit(`tree:${key}`) * trees.length) % trees.length];
      const remotesAtCell = nearbyRemoteByCell.get(key) || [];
      const primaryRemote = remotesAtCell[0] || null;
      const isScatteredTree = false;
      if (!isFountain && !isBorder && !isBank && npc && current?.text) {
        labels.push({
          key: `lbl-${key}`,
          x,
          y,
          text: trimText(current.text, 140),
          isValidPublicOffer: Boolean(current?.isPublicSwapOffer || current?.publicOfferViable),
        });
      }
      if (isFountainAnchor) {
        landmarkOverlays.push(
          <div
            key="landmark-fountain"
            style={{
              position: 'absolute',
              left: `${((fountainOrigin.x + 1.5) / size) * 100}%`,
              top: `${((fountainOrigin.y + 1.5) / size) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: `${(3 / size) * 100}%`,
              height: `${(3 / size) * 100}%`,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          >
            <span
              style={{
                fontSize: `${Math.max(64, Math.min(140, 88 * zoom))}px`,
                lineHeight: 1,
                filter: 'drop-shadow(0 0 18px rgba(157, 221, 255, 0.98))',
              }}
            >
              ⛲
            </span>
          </div>
        );
      }
      if (isBankAnchor) {
        landmarkOverlays.push(
          <div
            key="landmark-bank"
            style={{
              position: 'absolute',
              left: `${((bankCell.x + 1.5) / size) * 100}%`,
              top: `${((bankCell.y + 1.5) / size) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: `${(3 / size) * 100}%`,
              height: `${(3 / size) * 100}%`,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              pointerEvents: 'none',
              zIndex: 4,
            }}
          >
            <span
              style={{
                fontSize: `${Math.max(64, Math.min(140, 88 * zoom))}px`,
                lineHeight: 1,
                filter: 'drop-shadow(0 0 22px rgba(255, 219, 108, 0.99)) drop-shadow(0 1px 2px rgba(0,0,0,0.7))',
              }}
            >
              🏦
            </span>
          </div>
        );
      }
      cells.push(
        <div
          key={key}
          onClick={(e) => {
            if (isBank) {
              openBankMenu(e);
              return;
            }
            openTileMenu(e, x, y);
          }}
          style={{
            aspectRatio: '1 / 1',
            border: '1px solid rgba(220, 189, 116, 0.25)',
            display: 'grid',
            placeItems: 'center',
            fontSize: isFountain ? Math.max(20, Math.min(48, 30 * zoom)) : 12,
            background: isFountain ? 'rgba(157, 201, 255, 0.18)' : (isBank ? 'rgba(255, 214, 122, 0.12)' : 'rgba(31, 25, 16, 0.4)'),
            boxShadow: isFountain ? '0 0 14px rgba(126, 192, 255, 0.45) inset' : (isBank ? '0 0 16px rgba(255, 212, 94, 0.55), inset 0 0 12px rgba(255, 212, 94, 0.28)' : 'none'),
            color: isFountain ? '#dff2ff' : '#cbb68a',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {isFountain ? null : isBorder || isScatteredTree ? (
            <span
              style={{
                fontSize: isScatteredTree ? 18 : 22,
                opacity: isScatteredTree ? 0.9 : 1,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))',
              }}
            >
              {tree}
            </span>
          ) : isBank ? null : npc ? (
            <>
              <button
                onClick={(e) => openNpcMenu(e, npc)}
                title={`@${npc.username}`}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={npc.pfp}
                  alt={npc.username}
                  draggable={false}
                  style={{ width: '84%', height: '84%', borderRadius: '999px', objectFit: 'cover', border: '1px solid rgba(247,230,181,0.7)', userSelect: 'none', WebkitUserDrag: 'none' }}
                />
              </button>
            </>
          ) : primaryRemote ? (
            <button
              onClick={(e) => openTileMenu(e, x, y)}
              title={String(primaryRemote?.fname || primaryRemote?.playerId || 'player')}
              style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {String(primaryRemote?.pfp || '').trim() ? (
                <img
                  src={primaryRemote.pfp}
                  alt={String(primaryRemote?.fname || primaryRemote?.playerId || 'player')}
                  draggable={false}
                  style={{ width: '84%', height: '84%', borderRadius: '999px', objectFit: 'cover', border: '1px solid rgba(183,240,255,0.8)', boxShadow: '0 0 12px rgba(124, 234, 255, 0.9)', userSelect: 'none', WebkitUserDrag: 'none' }}
                />
              ) : (
                <span style={{ fontSize: `${Math.max(20, Math.min(48, 26 * zoom))}px`, filter: 'drop-shadow(0 0 10px rgba(124, 234, 255, 0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.7))' }}>🧍‍♂️</span>
              )}
              {primaryRemote?.trading ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 16,
                    filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.9))',
                    pointerEvents: 'none',
                  }}
                  title="Trading"
                >
                  💰
                </span>
              ) : null}
            </button>
          ) : null}
          {isPlayer ? (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                fontSize: `${Math.max(18, Math.min(40, 26 * zoom))}px`,
                pointerEvents: 'none',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                filter: 'drop-shadow(0 0 10px rgba(124, 234, 255, 0.95))',
                zIndex: 2,
              }}
              title="You"
            >
              🧍
            </span>
          ) : null}
        </div>
      );
    }
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 16,
        background: 'linear-gradient(180deg, #2d2519 0%, #1c160e 100%)',
        color: '#f7e6b5',
        fontFamily: 'var(--font-pixel), monospace',
        position: 'relative',
      }}
    >
      <div style={{ width: frameWidth, margin: '0 auto' }}>
        <div
          style={{
            marginBottom: 10,
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset',
            background: 'linear-gradient(180deg, #6f6248 0%, #5a4e38 100%)',
            borderRadius: 8,
            padding: '8px 10px',
            letterSpacing: 1,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            onClick={() => router.push('/worlds')}
            style={{
              border: '1px solid rgba(236,200,120,0.55)',
              background: 'rgba(28,22,14,0.75)',
              color: '#f4e3b8',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 14,
              cursor: 'pointer',
              width: 82,
            }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>/{worldName}</div>
          <div style={{ position: 'relative', minWidth: 82, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPlayerMenuOpen((v) => !v);
              }}
              style={{
                border: '1px solid rgba(236,200,120,0.55)',
                background: 'rgba(28,22,14,0.75)',
                color: '#f4e3b8',
                borderRadius: 6,
                padding: '5px 8px',
                fontSize: 12,
                cursor: 'pointer',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={String(playerIdentity.playerId || connectedAddress || '')}
            >
              {playerTag}
            </button>
            {playerMenuOpen ? (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 30,
                  minWidth: 250,
                  border: '1px solid rgba(236,200,120,0.45)',
                  background: 'rgba(20, 16, 10, 0.95)',
                  borderRadius: 8,
                  padding: 8,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>Connected as</div>
                <div style={{ fontSize: 12, marginBottom: 2 }}>{playerTag}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}>{shortAddr(playerIdentity.playerId || connectedAddress || '')}</div>
                <button
                  onClick={onDisconnectPlayer}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(236,120,120,0.6)',
                    background: 'rgba(60, 24, 24, 0.92)',
                    color: '#ffd8d8',
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <section
            ref={worldScrollRef}
            className="rs-hide-scrollbar"
            onMouseDown={onWorldMouseDown}
            onMouseMove={onWorldMouseMove}
            onMouseUp={onWorldMouseUp}
            onMouseLeave={onWorldMouseUp}
            onDragStart={onWorldDragStart}
            onPointerDown={onWorldPointerDown}
            onPointerMove={onWorldPointerMove}
            onPointerUp={onWorldPointerUp}
            onPointerCancel={onWorldPointerUp}
            onWheel={onWorldWheel}
            style={{
              border: '2px solid #7f6a3b',
              boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
              background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
              borderRadius: 12,
              padding: 10,
              overflow: 'auto',
              height: frameHeight,
              boxSizing: 'border-box',
              cursor: 'grab',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              touchAction: 'pan-x pan-y',
              position: 'relative',
            }}
          >
          <div
            style={{
              width: boardSide,
              height: boardSide,
              minWidth: boardSide,
              minHeight: boardSide,
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${size}, 1fr)`,
                gap: 2,
                width: '100%',
                height: '100%',
              }}
            >
              {cells}
            </div>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
              {landmarkOverlays}
              {labels.map((l) => (
                <div
                  key={l.key}
                  style={{
                    position: 'absolute',
                    left: `${((l.x + 0.5) / size) * 100}%`,
                    top: `${(l.y / size) * 100}%`,
                    transform: 'translate(-50%, -102%)',
                    width: '14.5%',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    fontSize: 17,
                    lineHeight: 1.05,
                    color: l.isValidPublicOffer ? '#39ff14' : '#fff8b2',
                    fontWeight: l.isValidPublicOffer ? 500 : 500,
                    textAlign: 'center',
                    textShadow: l.isValidPublicOffer
                      ? '0 2px 0 #000, 0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000'
                      : '0 2px 0 #000, 0 0 10px rgba(0,0,0,1)',
                    filter: 'drop-shadow(0 2px 6px rgba(0,0,0,1))',
                  }}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        </section>
          {(worldLogs.length || presentElsewhereCount > 0) ? (
            <div
              style={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: 20,
                pointerEvents: 'none',
                width: 'min(340px, calc(100% - 28px))',
                display: 'grid',
                gap: 6,
              }}
            >
              {presentElsewhereCount > 0 ? (
                <div
                  style={{
                    background: 'rgba(13, 11, 8, 0.46)',
                    border: '1px solid rgba(236,200,120,0.28)',
                    color: '#f6e3ad',
                    borderRadius: 6,
                    padding: '5px 7px',
                    fontSize: 12,
                    lineHeight: 1.2,
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    backdropFilter: 'blur(1px)',
                  }}
                >
                  {presentElsewhereCount === 1 ? '1 player elsewhere in world' : `${presentElsewhereCount} players elsewhere in world`}
                </div>
              ) : null}
              {worldLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: 'rgba(13, 11, 8, 0.46)',
                    border: '1px solid rgba(236,200,120,0.28)',
                    color: '#f6e3ad',
                    borderRadius: 6,
                    padding: '5px 7px',
                    fontSize: 12,
                    lineHeight: 1.2,
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    backdropFilter: 'blur(1px)',
                  }}
                >
                  {log.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {loadingCasts ? (
        <div className="rs-modal-backdrop" style={{ zIndex: 80 }}>
          <div
            className="rs-panel"
            style={{
              width: 'min(560px, 92vw)',
              border: '3px solid #2f271d',
              background: 'linear-gradient(180deg, #6d5f4d 0%, #5e5345 100%)',
              boxShadow: 'inset 0 0 0 2px #8b785c, 0 8px 0 #1f1912',
              padding: 14,
            }}
          >
            <div className="rs-loading-wrap" style={{ maxWidth: '100%' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
                <div className="rs-loading-label">loading casts</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tradeToast ? (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 22,
            transform: 'translateX(-50%)',
            zIndex: 85,
            border: '2px solid #6d5a34',
            background: 'linear-gradient(180deg, #3c3324 0%, #2d261b 100%)',
            color: '#f6e3ad',
            padding: '8px 12px',
            borderRadius: 6,
            boxShadow: '0 8px 20px rgba(0,0,0,0.6)',
            fontSize: 14,
            whiteSpace: 'nowrap',
            maxWidth: '92vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {tradeToast}
        </div>
      ) : null}

      {incomingTradeInvite ? (
        <div className="rs-modal-backdrop" style={{ zIndex: 90 }}>
          <div
            style={{
              width: 'min(420px, 92vw)',
              border: '3px solid #2f271d',
              background: 'linear-gradient(180deg, #6d5f4d 0%, #5e5345 100%)',
              boxShadow: 'inset 0 0 0 2px #8b785c, 0 8px 0 #1f1912',
              padding: 14,
            }}
          >
            <div style={{ color: '#f6e3ad', fontSize: 20, marginBottom: 8, fontWeight: 800, textAlign: 'center' }}>
              {`${shortPlayer(incomingTradeInvite.fromFname || incomingTradeInvite.fromPlayerId || 'A player')} wishes to trade`}
            </div>
            <div style={{ color: '#f6e3ad', opacity: 0.9, fontSize: 16, marginBottom: 14, textAlign: 'center' }}>
              {`auto-declines in ${Math.max(0, Math.ceil((Number(incomingTradeInvite.expiresAt || 0) - nowMs) / 1000))}s`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="rs-btn rs-btn-positive" onClick={() => onRespondTradeInvite('accept')}>
                Accept
              </button>
              <button className="rs-btn rs-btn-error" onClick={() => onRespondTradeInvite('decline')}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {outgoingTradeInvite ? (
        <div className="rs-modal-backdrop" style={{ zIndex: 88 }}>
          <div
            className="rs-panel"
            style={{
              width: 'min(560px, 92vw)',
              border: '3px solid #2f271d',
              background: 'linear-gradient(180deg, #6d5f4d 0%, #5e5345 100%)',
              boxShadow: 'inset 0 0 0 2px #8b785c, 0 8px 0 #1f1912',
              padding: 14,
            }}
          >
            <div style={{ color: '#f6e3ad', fontSize: 20, fontWeight: 800, marginBottom: 12, textAlign: 'center' }}>
              {`waiting for ${shortPlayer(outgoingTradeInvite.toName || 'player')} (${Math.max(0, Math.ceil((Number(outgoingTradeInvite.expiresAt || 0) - nowMs) / 1000))}s)`}
            </div>
            <div className="rs-loading-wrap" style={{ maxWidth: '100%' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {menu ? (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : menu.x) - 220),
            top: Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : menu.y) - 120),
            width: 220,
            zIndex: 50,
            border: '2px solid #6d5a34',
            boxShadow: '0 0 0 1px #20180f inset, 0 12px 26px rgba(0,0,0,0.75)',
            background: 'linear-gradient(180deg, #3c3324 0%, #2d261b 100%)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '7px 9px', fontSize: 15, borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#f6e3ad' }}>
            Choose Option
          </div>
          {menu.type === 'bank' ? (
            <button
              onClick={onTradeAnyone}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                color: '#b7f0ff',
                border: 'none',
                padding: '9px 11px',
                cursor: 'pointer',
                fontSize: 17,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title="Trade with anyone"
            >
              Trade with anyone
            </button>
          ) : menu.type === 'remote' ? (
            <button
              onClick={onTradeRemote}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                color: '#b7f0ff',
                border: 'none',
                padding: '9px 11px',
                cursor: 'pointer',
                fontSize: 17,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={`Trade with ${menu.name}`}
            >
              {`Trade with ${menu.name}`}
            </button>
          ) : menu.type === 'tile' ? (
            <button
              onClick={onMoveHere}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                color: '#d6f7d6',
                border: 'none',
                padding: '9px 11px',
                cursor: 'pointer',
                fontSize: 17,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title="Move here"
            >
              Move here
            </button>
          ) : (
            <>
              <button
                onClick={onTalk}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  color: '#d6f7d6',
                  border: 'none',
                  padding: '9px 11px',
                  cursor: 'pointer',
                  fontSize: 17,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={`Talk to ${menu.name}`}
              >
                {`Talk to ${menu.name}`}
              </button>
              <button
                onClick={onTrade}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  color: '#b7f0ff',
                  border: 'none',
                  padding: '9px 11px',
                  cursor: 'pointer',
                  fontSize: 17,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={`Trade with ${menu.name}`}
              >
                {`Trade with ${menu.name}`}
              </button>
            </>
          )}
        </div>
      ) : null}
    </main>
  );
}
