'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { useAccount } from 'wagmi';

function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function LiveMakerClient({ roomId = '', initialRole = 'signer', initialChannel = '' }) {
  const router = useRouter();
  const { address } = useAccount();
  const [role] = useState(initialRole === 'sender' ? 'sender' : 'signer');
  const [stateVersion, setStateVersion] = useState(0);
  const [status, setStatus] = useState('connecting...');
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
    if (!enabled) {
      setStatus('realtime not configured');
      return;
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey);
    const ch = supabase.channel(`maker_live:${roomId}`, { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'room_state_patch' }, ({ payload }) => {
      const nextV = Number(payload?.stateVersion || 0);
      if (nextV <= versionRef.current) return;
      setStateVersion(nextV);
      setTradeState((prev) => ({
        signerSelection: {
          token: String(payload?.signerSelection?.token ?? prev.signerSelection.token ?? ''),
          amount: String(payload?.signerSelection?.amount ?? prev.signerSelection.amount ?? ''),
        },
        senderSelection: {
          token: String(payload?.senderSelection?.token ?? prev.senderSelection.token ?? ''),
          amount: String(payload?.senderSelection?.amount ?? prev.senderSelection.amount ?? ''),
        },
      }));
    });

    ch.on('broadcast', { event: 'room_join' }, () => {
      const snapVersion = versionRef.current;
      const snapState = tradeState;
      ch.send({
        type: 'broadcast',
        event: 'room_state_patch',
        payload: {
          roomId,
          stateVersion: snapVersion,
          signerSelection: snapState.signerSelection,
          senderSelection: snapState.senderSelection,
        },
      });
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
            ts: Date.now(),
          },
        });
      }
    });

    channelRef.current = ch;

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
    };
  }, [enabled, roomId, role, identity.sessionId, identity.playerId, supabasePublicKey]);

  const publishPatch = (patch) => {
    const ch = channelRef.current;
    if (!ch) return;
    const nextVersion = versionRef.current + 1;
    setStateVersion(nextVersion);
    const nextState = {
      signerSelection: patch?.signerSelection || tradeState.signerSelection,
      senderSelection: patch?.senderSelection || tradeState.senderSelection,
    };
    setTradeState(nextState);
    ch.send({
      type: 'broadcast',
      event: 'room_state_patch',
      payload: {
        roomId,
        stateVersion: nextVersion,
        signerSelection: nextState.signerSelection,
        senderSelection: nextState.senderSelection,
      },
    });
  };

  const roleSelection = role === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
  const otherSelection = role === 'signer' ? tradeState.senderSelection : tradeState.signerSelection;

  const onChangeOwn = (k, v) => {
    const next = { ...roleSelection, [k]: v };
    if (role === 'signer') publishPatch({ signerSelection: next });
    else publishPatch({ senderSelection: next });
  };

  return (
    <div className="rs-window" style={{ overflow: 'hidden' }}>
      <div className="rs-topbar">
        <button className="rs-topbar-back" onClick={() => router.push(`/${initialChannel || 'worlds'}`)}>←</button>
        <span className="rs-topbar-title">Live Maker · {roomId} · {role}</span>
      </div>

      <div className="rs-grid" style={{ gridTemplateRows: 'auto auto auto', minHeight: 440 }}>
        <div className="rs-panel">
          <div className="rs-panel-title">Room Status</div>
          <div className="rs-box" style={{ minHeight: 64 }}>
            <div style={{ fontSize: 16, color: '#f4d77c' }}>{status}</div>
            <div style={{ fontSize: 14, marginTop: 6 }}>State version: {stateVersion}</div>
          </div>
        </div>

        <div className="rs-panel" style={{ borderTop: '2px solid #332b21', borderBottom: '2px solid #332b21' }}>
          <div className="rs-panel-title">Your Side · {role === 'signer' ? 'Signer' : 'Sender'}</div>
          <input
            className="rs-amount-input"
            style={{ width: 'min(420px, 92%)' }}
            value={roleSelection.token}
            onChange={(e) => onChangeOwn('token', e.target.value)}
            placeholder="Your token contract or symbol"
          />
          <input
            className="rs-amount-input"
            style={{ width: 'min(420px, 92%)' }}
            value={roleSelection.amount}
            onChange={(e) => onChangeOwn('amount', e.target.value)}
            placeholder="Your amount"
          />
        </div>

        <div className="rs-panel">
          <div className="rs-panel-title">Counterparty Side · {role === 'signer' ? 'Sender' : 'Signer'}</div>
          <div className="rs-box" style={{ minHeight: 100 }}>
            <div style={{ fontSize: 14, marginBottom: 8, color: '#f4d77c' }}>Token: {otherSelection.token || '-'}</div>
            <div style={{ fontSize: 14, color: '#f4d77c' }}>Amount: {otherSelection.amount || '-'}</div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
            Only your own side is editable in this live room.
          </div>
        </div>
      </div>
    </div>
  );
}
