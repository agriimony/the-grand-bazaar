'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { useAccount } from 'wagmi';

function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function shortAddr(v = '') {
  const s = String(v || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function isFilled(sel) {
  return Boolean(String(sel?.token || '').trim() && String(sel?.amount || '').trim());
}

function OfferPanel({ title, selection, editable, onChange }) {
  const token = String(selection?.token || '');
  const amount = String(selection?.amount || '');

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{title}</div>
      <div className="rs-box" style={{ minHeight: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            className={`rs-token-wrap ${editable ? 'rs-token-editable' : ''}`}
            style={{
              width: 76,
              height: 76,
              border: '2px solid #3b3227',
              background: 'rgba(0,0,0,0.2)',
              display: 'grid',
              placeItems: 'center',
              color: '#f4d77c',
              fontSize: 36,
              flex: '0 0 auto',
            }}
          >
            {token ? '🪙' : '+'}
          </div>
          <div style={{ flex: 1 }}>
            <input
              className="rs-amount-input"
              style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
              value={token}
              onChange={(e) => editable && onChange('token', e.target.value)}
              placeholder={editable ? 'Token contract or symbol' : 'Token'}
              disabled={!editable}
            />
            <input
              className="rs-amount-input"
              style={{ width: '100%', margin: 0, fontSize: 16, textAlign: 'left' }}
              value={amount}
              onChange={(e) => editable && onChange('amount', e.target.value)}
              placeholder={editable ? 'Amount' : 'Amount'}
              disabled={!editable}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LiveMakerClient({ roomId = '', initialRole = 'signer', initialChannel = '' }) {
  const router = useRouter();
  const { address } = useAccount();

  const [role] = useState(initialRole === 'sender' ? 'sender' : 'signer');
  const [localFname, setLocalFname] = useState('');
  const [stateVersion, setStateVersion] = useState(0);
  const [status, setStatus] = useState('connecting...');
  const [peers, setPeers] = useState({});
  const [tradeState, setTradeState] = useState({
    signerSelection: { token: '', amount: '' },
    senderSelection: { token: '', amount: '' },
  });

  const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublicKey && roomId);

  const identity = useMemo(() => {
    if (typeof window === 'undefined') return { playerId: randomId('player'), sessionId: randomId('session') };
    const walletPlayerId = String(address || '').trim().toLowerCase();

    let playerId = walletPlayerId || window.localStorage.getItem('gbz:player-id');
    if (!playerId) playerId = randomId('player');
    window.localStorage.setItem('gbz:player-id', playerId);

    let sessionId = window.sessionStorage.getItem('gbz:session-id');
    if (!sessionId) {
      sessionId = randomId('session');
      window.sessionStorage.setItem('gbz:session-id', sessionId);
    }

    return { playerId, sessionId };
  }, [address]);

  const channelRef = useRef(null);
  const versionRef = useRef(0);

  useEffect(() => {
    versionRef.current = stateVersion;
  }, [stateVersion]);

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
        const name = String(ctx?.user?.username || ctx?.user?.fname || '').replace(/^@/, '').trim().toLowerCase();
        if (!dead) setLocalFname(name);
      } catch {
        if (!dead) setLocalFname('');
      }
    }
    loadFnameFromSdk();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('realtime not configured');
      return;
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey);
    const ch = supabase.channel(`maker_live:${roomId}`, { config: { broadcast: { self: false } } });
    let unmounted = false;

    ch.on('broadcast', { event: 'room_join' }, ({ payload }) => {
      const sid = String(payload?.sessionId || '').trim();
      if (!sid) return;
      setPeers((prev) => ({
        ...prev,
        [sid]: {
          sessionId: sid,
          playerId: String(payload?.playerId || ''),
          fname: String(payload?.fname || '').replace(/^@/, '').trim().toLowerCase(),
          role: String(payload?.role || ''),
        },
      }));
    });

    ch.on('broadcast', { event: 'room_state_patch' }, ({ payload }) => {
      const nextV = Number(payload?.stateVersion || 0);
      if (nextV <= versionRef.current) return;

      setStateVersion(nextV);
      setTradeState({
        signerSelection: {
          token: String(payload?.signerSelection?.token || ''),
          amount: String(payload?.signerSelection?.amount || ''),
        },
        senderSelection: {
          token: String(payload?.senderSelection?.token || ''),
          amount: String(payload?.senderSelection?.amount || ''),
        },
      });
    });

    ch.on('broadcast', { event: 'room_leave' }, ({ payload }) => {
      const sid = String(payload?.sessionId || '').trim();
      if (!sid || sid === identity.sessionId) return;
      const leaver = String(payload?.fname || payload?.playerId || 'player').trim();
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('gbz:world-toast', `${leaver} declined your trade request`);
        }
      } catch {}
      const nextPath = `/${initialChannel || 'worlds'}`;
      if (!unmounted) router.push(nextPath);
    });

    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        setStatus('live room connected');
        ch.send({
          type: 'broadcast',
          event: 'room_join',
          payload: {
            roomId,
            role,
            sessionId: identity.sessionId,
            playerId: identity.playerId,
            fname: localFname,
            ts: Date.now(),
          },
        });
      }
    });

    channelRef.current = ch;

    const announceLeave = () => {
      try {
        ch.send({
          type: 'broadcast',
          event: 'room_leave',
          payload: {
            roomId,
            sessionId: identity.sessionId,
            playerId: identity.playerId,
            fname: localFname,
            role,
            ts: Date.now(),
          },
        });
      } catch {}
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', announceLeave);
    }

    return () => {
      unmounted = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', announceLeave);
      }
      announceLeave();
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
    };
  }, [enabled, roomId, role, identity.sessionId, identity.playerId, localFname, supabasePublicKey, router, initialChannel]);

  const publishPatch = (next) => {
    const ch = channelRef.current;
    if (!ch) return;

    const nextVersion = versionRef.current + 1;
    setStateVersion(nextVersion);
    setTradeState(next);

    ch.send({
      type: 'broadcast',
      event: 'room_state_patch',
      payload: {
        roomId,
        stateVersion: nextVersion,
        signerSelection: next.signerSelection,
        senderSelection: next.senderSelection,
        fromSessionId: identity.sessionId,
        fromRole: role,
        ts: Date.now(),
      },
    });
  };

  const onChangeOwn = (k, v) => {
    if (role === 'signer') {
      publishPatch({
        ...tradeState,
        signerSelection: { ...tradeState.signerSelection, [k]: v },
      });
      return;
    }

    publishPatch({
      ...tradeState,
      senderSelection: { ...tradeState.senderSelection, [k]: v },
    });
  };

  const ownSelection = role === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
  const otherSelection = role === 'signer' ? tradeState.senderSelection : tradeState.signerSelection;

  const ownDone = isFilled(ownSelection);
  const otherDone = isFilled(otherSelection);
  const bothDone = ownDone && otherDone;

  const otherPeer = Object.values(peers).find((p) => p?.sessionId && p.sessionId !== identity.sessionId) || null;
  const otherDisplay = String(otherPeer?.fname || otherPeer?.playerId || '').trim() || shortAddr(otherSelection?.token ? '' : '') || 'player';

  const topTitle = role === 'signer' ? 'You offer' : `${otherDisplay} offers`;
  const bottomTitle = role === 'signer' ? `${otherDisplay} offers` : 'You offer';

  const topSelection = tradeState.signerSelection;
  const bottomSelection = tradeState.senderSelection;

  const topEditable = role === 'signer';
  const bottomEditable = role === 'sender';

  const midText = !ownDone ? 'select your token(s)' : `waiting for ${otherDisplay}`;

  return (
    <div className="rs-window" style={{ overflow: 'hidden' }}>
      <div className="rs-topbar">
        <button className="rs-topbar-back" onClick={() => router.push(`/${initialChannel || 'worlds'}`)}>{'<'}</button>
        <span className="rs-topbar-title">Trading with {otherDisplay || shortAddr(otherPeer?.playerId || '') || 'player'}</span>
      </div>

      <div className="rs-grid" style={{ gridTemplateRows: '1fr auto 1fr', minHeight: 520 }}>
        <OfferPanel title={topTitle} selection={topSelection} editable={topEditable} onChange={onChangeOwn} />

        <div className="rs-center" style={{ display: 'grid', gap: 10 }}>
          {bothDone ? (
            <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
              <button className="rs-btn rs-btn-positive">Approve</button>
              <button className="rs-btn rs-btn-error">Decline</button>
            </div>
          ) : (
            <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
                <div className="rs-loading-label">{midText}</div>
              </div>
            </div>
          )}
          <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.75 }}>{status}</div>
        </div>

        <OfferPanel title={bottomTitle} selection={bottomSelection} editable={bottomEditable} onChange={onChangeOwn} />
      </div>
    </div>
  );
}
