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

const CATALOG_ICON_BY_SYMBOL = {
  higher: '/higher-icon.png',
  eth: '/eth-icon.png',
  weth: '/eth-icon.png',
};

function tokenIconUrl(token = '') {
  const t = String(token || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return '';
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${t}/logo.png`;
}

function fallbackTokenArt(token = '', symbol = '') {
  const bySymbol = CATALOG_ICON_BY_SYMBOL[String(symbol || '').trim().toLowerCase()];
  if (bySymbol) return bySymbol;

  const addrOnly = String(token || '').split(':')[0].trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(addrOnly)) return tokenIconUrl(addrOnly);

  return '';
}

function isFilled(sel) {
  return Boolean(String(sel?.token || '').trim() && String(sel?.amount || '').trim());
}

function emptySelection() {
  return { token: '', amount: '', imgUrl: '', symbol: '', tokenId: '', name: '', kind: '', balance: '' };
}

function normalizeSelection(sel) {
  const base = emptySelection();
  return {
    ...base,
    ...(sel || {}),
    token: String(sel?.token || ''),
    amount: String(sel?.amount || ''),
    imgUrl: String(sel?.imgUrl || ''),
    symbol: String(sel?.symbol || ''),
    tokenId: String(sel?.tokenId || ''),
    name: String(sel?.name || ''),
    kind: String(sel?.kind || ''),
    balance: String(sel?.balance || ''),
  };
}

function OfferPanel({ title, selection, editable, onChange, onOpenInventory }) {
  const token = String(selection?.token || '');
  const amount = String(selection?.amount || '');
  const symbol = String(selection?.symbol || '');
  const tokenId = String(selection?.tokenId || '');
  const imgUrl = String(selection?.imgUrl || fallbackTokenArt(token, symbol) || '');

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{title}</div>
      <div className="rs-box" style={{ minHeight: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => editable && onOpenInventory?.()}
            disabled={!editable}
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
              cursor: editable ? 'pointer' : 'default',
            }}
          >
            {token ? (
              <>
                {imgUrl ? (
                  <img className="rs-token-art" src={imgUrl} alt={symbol || 'token'} style={{ width: 58, height: 58 }} />
                ) : (
                  <span style={{ fontSize: 28 }}>🪙</span>
                )}
                {amount ? <span className="rs-token-cell-amount">{amount}</span> : null}
                {symbol ? <span className="rs-token-cell-symbol">{symbol}</span> : null}
                {tokenId ? <span className="rs-token-cell-tokenid">#{tokenId}</span> : null}
              </>
            ) : '+'}
          </button>
          <div style={{ flex: 1 }}>
            <input
              className="rs-amount-input"
              style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
              value={token}
              onChange={() => {}}
              placeholder={editable ? 'Select token from tile' : 'Token'}
              disabled
            />
            <input
              className="rs-amount-input"
              style={{ width: '100%', margin: 0, fontSize: 16, textAlign: 'left' }}
              value={amount}
              onChange={(e) => editable && onChange('amount', e.target.value)}
              placeholder={editable ? 'Amount' : 'Amount'}
              disabled={!editable}
              title={selection?.balance ? `Max: ${selection.balance}` : ''}
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
    signerSelection: emptySelection(),
    senderSelection: emptySelection(),
  });
  const [approved, setApproved] = useState({ signer: false, sender: false });
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryTokens, setInventoryTokens] = useState([]);
  const [inventoryNfts, setInventoryNfts] = useState([]);
  const [inventoryNftCollections, setInventoryNftCollections] = useState([]);
  const [inventoryNftSubView, setInventoryNftSubView] = useState('collections');
  const [selectedNftCollection, setSelectedNftCollection] = useState(null);
  const [customTokenStep, setCustomTokenStep] = useState('none'); // none|custom|custom-id|custom-amount
  const [customTokenValue, setCustomTokenValue] = useState('');
  const [customTokenAmount, setCustomTokenAmount] = useState('');
  const [customTokenError, setCustomTokenError] = useState('');
  const [customTokenPreview, setCustomTokenPreview] = useState(null);
  const [inventoryView, setInventoryView] = useState('tokens');

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
        signerSelection: normalizeSelection(payload?.signerSelection),
        senderSelection: normalizeSelection(payload?.senderSelection),
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

    ch.on('broadcast', { event: 'room_approve' }, ({ payload }) => {
      const who = String(payload?.role || '').trim().toLowerCase();
      const decision = String(payload?.decision || '').trim().toLowerCase();
      if (who !== 'signer' && who !== 'sender') return;
      setApproved((prev) => ({ ...prev, [who]: decision === 'approve' }));
    });

    ch.on('broadcast', { event: 'room_start_maker' }, ({ payload }) => {
      const toSessionId = String(payload?.toSessionId || '').trim();
      if (toSessionId && toSessionId !== identity.sessionId) return;
      const cp = String(payload?.counterparty || '').replace(/^@/, '').trim();
      const nextUrl = `/maker?counterparty=${encodeURIComponent(cp)}&channel=${encodeURIComponent(initialChannel || '')}`;
      if (!unmounted) router.push(nextUrl);
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

    const normalized = {
      signerSelection: normalizeSelection(next?.signerSelection),
      senderSelection: normalizeSelection(next?.senderSelection),
    };

    const nextVersion = versionRef.current + 1;
    setStateVersion(nextVersion);
    setTradeState(normalized);

    ch.send({
      type: 'broadcast',
      event: 'room_state_patch',
      payload: {
        roomId,
        stateVersion: nextVersion,
        signerSelection: normalized.signerSelection,
        senderSelection: normalized.senderSelection,
        fromSessionId: identity.sessionId,
        fromRole: role,
        ts: Date.now(),
      },
    });
  };

  const onChangeOwn = (k, v) => {
    const current = role === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
    let nextVal = v;

    if (k === 'amount') {
      const raw = String(v || '').trim();
      const bal = Number(current?.balance || 0);
      const amt = Number(raw || 0);
      if (Number.isFinite(bal) && bal > 0 && Number.isFinite(amt) && amt > bal) {
        nextVal = String(current?.balance || '');
      }
    }

    if (role === 'signer') {
      publishPatch({
        ...tradeState,
        signerSelection: { ...tradeState.signerSelection, [k]: nextVal },
      });
      return;
    }

    publishPatch({
      ...tradeState,
      senderSelection: { ...tradeState.senderSelection, [k]: nextVal },
    });
  };

  const openInventory = async () => {
    setCustomTokenStep('none');
    setCustomTokenValue('');
    setCustomTokenAmount('');
    setCustomTokenError('');
    setCustomTokenPreview(null);
    setInventoryView('tokens');
    setInventoryNftSubView('collections');
    setSelectedNftCollection(null);

    const owner = String(identity.playerId || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      setInventoryError('wallet not connected');
      setInventoryOpen(true);
      return;
    }

    setInventoryOpen(true);
    setInventoryLoading(true);
    setInventoryError('');

    const cacheKey = `gbz:zapper:${String(owner).toLowerCase()}`;
    const cacheTtlMs = 15 * 60 * 1000;

    try {
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            const ts = Number(parsed?.ts || 0);
            const age = Date.now() - ts;
            if (age >= 0 && age < cacheTtlMs && Array.isArray(parsed?.tokens)) {
              const tokens = parsed.tokens;
              const nftCollections = Array.isArray(parsed?.nftCollections) ? parsed.nftCollections : [];
              const nfts = nftCollections.flatMap((c) => (Array.isArray(c?.nfts) ? c.nfts : [])).slice(0, 120);
              setInventoryTokens(tokens);
              setInventoryNftCollections(nftCollections);
              setInventoryNfts(nfts);
              setInventoryLoading(false);
              return;
            }
          }
        } catch {}
      }

      const r = await fetch(`/api/zapper-wallet?address=${encodeURIComponent(owner)}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setInventoryTokens([]);
        setInventoryNfts([]);
        setInventoryError(String(d?.error || 'failed to load inventory'));
      } else {
        const tokens = Array.isArray(d?.tokens) ? d.tokens : [];
        const nftCollections = Array.isArray(d?.nftCollections) ? d.nftCollections : [];
        const nfts = nftCollections.flatMap((c) => (Array.isArray(c?.nfts) ? c.nfts : [])).slice(0, 120);
        setInventoryTokens(tokens);
        setInventoryNftCollections(nftCollections);
        setInventoryNfts(nfts);

        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tokens, nftCollections }));
          } catch {}
        }
      }
    } catch {
      setInventoryTokens([]);
      setInventoryNfts([]);
      setInventoryError('failed to load inventory');
    } finally {
      setInventoryLoading(false);
    }
  };

  const pickInventoryToken = (selectionPatch = {}) => {
    const patch = normalizeSelection({
      ...(role === 'signer' ? tradeState.signerSelection : tradeState.senderSelection),
      ...selectionPatch,
    });

    if (role === 'signer') {
      publishPatch({ ...tradeState, signerSelection: patch });
    } else {
      publishPatch({ ...tradeState, senderSelection: patch });
    }
    setInventoryOpen(false);
  };

  const applyCustomToken = () => {
    const token = String(customTokenValue || '').trim();
    if (!token) {
      setCustomTokenError('enter a token address');
      return;
    }

    const knownToken = inventoryTokens.find((t) => String(t?.token || '').toLowerCase() === token.toLowerCase());
    if (knownToken) {
      pickInventoryToken({
        token: knownToken?.token || token,
        amount: String(customTokenAmount || knownToken?.balance || '').trim(),
        imgUrl: knownToken?.imgUrl || '',
        symbol: knownToken?.symbol || shortAddr(token),
        tokenId: '',
        name: knownToken?.symbol || token,
        kind: '0x20',
        balance: String(knownToken?.balance || ''),
      });
      return;
    }

    const coll = inventoryNftCollections.find((c) => String(c?.collectionAddress || '').toLowerCase() === token.toLowerCase());
    if (coll) {
      setInventoryView('nfts');
      setSelectedNftCollection(coll);
      setCustomTokenStep('custom-id');
      setCustomTokenError('');
      return;
    }

    // fallback ERC20-like custom token
    pickInventoryToken({
      token,
      amount: String(customTokenAmount || '').trim(),
      imgUrl: '',
      symbol: /^0x[a-fA-F0-9]{40}$/.test(token) ? shortAddr(token) : token,
      tokenId: '',
      name: token,
      kind: '',
      balance: '',
    });
  };

  const applyCustomTokenId = () => {
    const tokenId = String(customTokenValue || '').trim();
    if (!selectedNftCollection) {
      setCustomTokenError('select an NFT collection first');
      return;
    }
    if (!tokenId) {
      setCustomTokenError('enter token id');
      return;
    }
    const row = (selectedNftCollection?.nfts || []).find((n) => String(n?.tokenId || '') === tokenId);
    if (!row) {
      setCustomTokenError('token id not found in your holdings');
      return;
    }
    setCustomTokenPreview(row);
    if (String(row?.kind || '').toLowerCase() === '0xd9b67a26' || Number(row?.balance || 1) > 1) {
      setCustomTokenAmount(String(row?.balance || '1'));
      setCustomTokenStep('custom-amount');
      setCustomTokenError('');
      return;
    }

    pickInventoryToken({
      token: `${row?.token || selectedNftCollection?.collectionAddress || ''}:${row?.tokenId || tokenId}`,
      amount: String(row?.balance || '1'),
      imgUrl: row?.imgUrl || '',
      symbol: row?.symbol || selectedNftCollection?.symbol || 'NFT',
      tokenId: String(row?.tokenId || tokenId),
      name: row?.name || row?.symbol || 'NFT',
      kind: row?.kind || '0x80ac58cd',
      balance: String(row?.balance || '1'),
    });
  };

  const applyCustomTokenAmount = () => {
    const row = customTokenPreview;
    if (!row) return;
    const raw = String(customTokenAmount || '').trim();
    if (!raw || !/^\d+$/.test(raw)) {
      setCustomTokenError('enter valid integer amount');
      return;
    }
    if (Number(raw) > Number(row?.balance || 0)) {
      setCustomTokenError('amount exceeds your balance');
      return;
    }
    pickInventoryToken({
      token: `${row?.token || selectedNftCollection?.collectionAddress || ''}:${row?.tokenId || ''}`,
      amount: raw,
      imgUrl: row?.imgUrl || '',
      symbol: row?.symbol || selectedNftCollection?.symbol || 'NFT',
      tokenId: String(row?.tokenId || ''),
      name: row?.name || row?.symbol || 'NFT',
      kind: row?.kind || '0xd9b67a26',
      balance: String(row?.balance || '1'),
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

  const visibleInventoryItems = useMemo(() => {
    if (inventoryView === 'tokens') return inventoryTokens.slice(0, 23);
    if (inventoryNftSubView === 'collections') return inventoryNftCollections.slice(0, 23);
    const rows = Array.isArray(selectedNftCollection?.nfts) ? selectedNftCollection.nfts : [];
    return rows.slice(0, 23);
  }, [inventoryView, inventoryNftSubView, inventoryNftCollections, selectedNftCollection, inventoryTokens]);

  useEffect(() => {
    setApproved({ signer: false, sender: false });
  }, [tradeState.signerSelection.token, tradeState.signerSelection.amount, tradeState.senderSelection.token, tradeState.senderSelection.amount]);

  const onApprove = () => {
    if (!bothDone) return;
    const ch = channelRef.current;
    if (!ch) return;

    ch.send({
      type: 'broadcast',
      event: 'room_approve',
      payload: {
        roomId,
        role,
        decision: 'approve',
        sessionId: identity.sessionId,
        ts: Date.now(),
      },
    });

    const nextApproved = { ...approved, [role]: true };
    setApproved(nextApproved);

    if (nextApproved.signer && nextApproved.sender) {
      const cp = String(otherPeer?.fname || otherPeer?.playerId || '').replace(/^@/, '').trim();
      ch.send({
        type: 'broadcast',
        event: 'room_start_maker',
        payload: {
          roomId,
          counterparty: cp,
          ts: Date.now(),
        },
      });
      router.push(`/maker?counterparty=${encodeURIComponent(cp)}&channel=${encodeURIComponent(initialChannel || '')}`);
    }
  };

  const onDecline = () => {
    const ch = channelRef.current;
    if (!ch) return;
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
    router.push(`/${initialChannel || 'worlds'}`);
  };

  return (
    <div className="rs-window" style={{ overflow: 'hidden' }}>
      <div className="rs-topbar">
        <button className="rs-topbar-back" onClick={() => router.push(`/${initialChannel || 'worlds'}`)}>{'<'}</button>
        <span className="rs-topbar-title">Trading with {otherDisplay || shortAddr(otherPeer?.playerId || '') || 'player'}</span>
      </div>

      <div className="rs-grid" style={{ gridTemplateRows: '1fr auto 1fr', minHeight: 520 }}>
        <OfferPanel title={topTitle} selection={topSelection} editable={topEditable} onChange={onChangeOwn} onOpenInventory={openInventory} />

        <div className="rs-center" style={{ display: 'grid', gap: 10 }}>
          {bothDone ? (
            <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
              <button className="rs-btn rs-btn-positive" onClick={onApprove}>Approve</button>
              <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
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

        <OfferPanel title={bottomTitle} selection={bottomSelection} editable={bottomEditable} onChange={onChangeOwn} onOpenInventory={openInventory} />
      </div>

      {inventoryOpen ? (
        <div className="rs-modal-backdrop" style={{ zIndex: 95 }}>
          <div className="rs-modal" style={{ width: 'min(860px, 96vw)' }}>
            <button className="rs-modal-close" onClick={() => setInventoryOpen(false)}>X</button>
            <div className="rs-panel" style={{ paddingTop: 18 }}>
              <div className="rs-modal-titlebar">Your inventory</div>

              {inventoryLoading ? (
                <div className="rs-loading-wrap">
                  <div className="rs-loading-track">
                    <div className="rs-loading-fill" />
                    <div className="rs-loading-label">loading inventory</div>
                  </div>
                </div>
              ) : inventoryError ? (
                <div className="rs-inline-error" style={{ width: '100%', marginTop: 12 }}>{inventoryError}</div>
              ) : (
                <>
                  <div className="rs-inv-toggle-row">
                    <button className={`rs-inv-toggle ${inventoryView === 'tokens' ? 'active' : ''}`} onClick={() => { setInventoryView('tokens'); setInventoryNftSubView('collections'); setSelectedNftCollection(null); setCustomTokenStep('none'); }}>Tokens</button>
                    <button className={`rs-inv-toggle ${inventoryView === 'nfts' ? 'active' : ''}`} onClick={() => { setInventoryView('nfts'); setInventoryNftSubView('collections'); setSelectedNftCollection(null); setCustomTokenStep('none'); }}>NFT</button>
                  </div>

                  {inventoryView === 'tokens' && customTokenStep === 'custom' ? (
                    <div className="rs-token-grid-wrap" style={{ marginBottom: 10 }}>
                      <button className="rs-modal-back" onClick={() => { setCustomTokenStep('none'); setCustomTokenError(''); }}>← Back</button>
                      <div className="rs-panel-title" style={{ marginTop: 0 }}>Custom token</div>
                      <input
                        className="rs-amount-input"
                        style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
                        value={customTokenValue}
                        onChange={(e) => { setCustomTokenValue(e.target.value); if (customTokenError) setCustomTokenError(''); }}
                        placeholder="Token address"
                      />
                      <input
                        className="rs-amount-input"
                        style={{ width: '100%', margin: 0, fontSize: 16, textAlign: 'left' }}
                        value={customTokenAmount}
                        onChange={(e) => setCustomTokenAmount(e.target.value)}
                        placeholder="Amount optional"
                      />
                      {customTokenError ? <div className="rs-inline-error" style={{ marginTop: 8 }}>{customTokenError}</div> : null}
                      <div className="rs-btn-stack" style={{ marginTop: 10 }}>
                        <button className="rs-btn rs-btn-positive" onClick={applyCustomToken}>Confirm</button>
                      </div>
                    </div>
                  ) : null}

                  {inventoryView === 'nfts' && customTokenStep === 'custom-id' ? (
                    <div className="rs-token-grid-wrap" style={{ marginBottom: 10 }}>
                      <button className="rs-modal-back" onClick={() => { setCustomTokenStep('custom'); setCustomTokenError(''); }}>← Back</button>
                      <div className="rs-panel-title" style={{ marginTop: 0 }}>Select Token ID</div>
                      <input
                        className="rs-amount-input"
                        style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
                        value={customTokenValue}
                        onChange={(e) => { setCustomTokenValue(e.target.value); if (customTokenError) setCustomTokenError(''); }}
                        placeholder="token id"
                      />
                      {customTokenError ? <div className="rs-inline-error" style={{ marginTop: 8 }}>{customTokenError}</div> : null}
                      <div className="rs-btn-stack" style={{ marginTop: 10 }}>
                        <button className="rs-btn rs-btn-positive" onClick={applyCustomTokenId}>Lookup</button>
                      </div>
                    </div>
                  ) : null}

                  {inventoryView === 'nfts' && customTokenStep === 'custom-amount' ? (
                    <div className="rs-token-grid-wrap" style={{ marginBottom: 10 }}>
                      <button className="rs-modal-back" onClick={() => { setCustomTokenStep('custom-id'); setCustomTokenError(''); }}>← Back</button>
                      <div className="rs-panel-title" style={{ marginTop: 0 }}>Enter Amount</div>
                      <input
                        className="rs-amount-input"
                        style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
                        value={customTokenAmount}
                        onChange={(e) => { setCustomTokenAmount(e.target.value); if (customTokenError) setCustomTokenError(''); }}
                        placeholder="amount"
                      />
                      {customTokenError ? <div className="rs-inline-error" style={{ marginTop: 8 }}>{customTokenError}</div> : null}
                      <div className="rs-btn-stack" style={{ marginTop: 10 }}>
                        <button className="rs-btn rs-btn-positive" onClick={applyCustomTokenAmount}>Confirm</button>
                      </div>
                    </div>
                  ) : null}

                  {inventoryView === 'nfts' && inventoryNftSubView === 'items' ? (
                    <button className="rs-modal-back" onClick={() => { setInventoryNftSubView('collections'); setSelectedNftCollection(null); }}>← Back</button>
                  ) : null}
                  <div className="rs-token-grid-wrap">
                    <div className="rs-token-grid">
                      {visibleInventoryItems.map((item, i) => {
                        const isToken = inventoryView === 'tokens';
                        const isNftCollection = inventoryView === 'nfts' && inventoryNftSubView === 'collections';

                        if (isNftCollection) {
                          const collAddr = String(item?.collectionAddress || item?.token || '');
                          const collSymbol = String(item?.symbol || 'NFT');
                          const collImg = String(item?.nfts?.[0]?.imgUrl || '');
                          return (
                            <button
                              key={`nft-coll-${collAddr}-${i}`}
                              className="rs-token-cell"
                              onClick={() => { setSelectedNftCollection(item); setInventoryNftSubView('items'); }}
                              title={String(item?.collectionName || collSymbol)}
                            >
                              <div className="rs-token-cell-wrap" style={{ position: 'relative' }}>
                                {collImg ? (
                                  <img className="rs-token-cell-icon" src={collImg} alt={collSymbol} />
                                ) : (
                                  <div className="rs-token-cell-fallback">🖼️</div>
                                )}
                                <span className="rs-token-cell-symbol">{collSymbol}</span>
                              </div>
                            </button>
                          );
                        }

                        const token = isToken ? (item?.token || item?.symbol || '') : `${item?.token || ''}:${item?.tokenId || ''}`;
                        const amount = isToken ? (item?.balance || '') : (item?.balance || '1');
                        const symbol = isToken ? (item?.symbol || 'TOKEN') : (item?.symbol || 'NFT');
                        const tokenId = isToken ? '' : String(item?.tokenId || '');
                        const imgUrl = item?.imgUrl || fallbackTokenArt(token, symbol) || '';
                        return (
                          <button
                            key={`${inventoryView}-${String(token)}-${i}`}
                            className="rs-token-cell"
                            onClick={() => pickInventoryToken({
                              token,
                              amount,
                              imgUrl,
                              symbol,
                              tokenId,
                              name: item?.name || symbol,
                              kind: item?.kind || (isToken ? '0x20' : ''),
                              balance: amount,
                            })}
                            title={isToken ? `${symbol} ${amount}` : `${item?.name || symbol} #${tokenId}`}
                          >
                            <div className="rs-token-cell-wrap" style={{ position: 'relative' }}>
                              {String(imgUrl).trim() ? (
                                <img className="rs-token-cell-icon" src={imgUrl} alt={symbol} />
                              ) : (
                                <div className="rs-token-cell-fallback">{isToken ? '🪙' : '🖼️'}</div>
                              )}
                              {isToken ? (
                                <>
                                  <span className="rs-token-cell-amount">{amount}</span>
                                  <span className="rs-token-cell-symbol">{symbol}</span>
                                </>
                              ) : (
                                <span className="rs-token-cell-tokenid">#{tokenId}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      <button
                        className="rs-token-cell rs-token-cell-plus"
                        onClick={() => {
                          if (inventoryView === 'tokens') {
                            setCustomTokenStep('custom');
                            setCustomTokenValue('');
                            setCustomTokenAmount('');
                            setCustomTokenError('');
                          }
                        }}
                        title={inventoryView === 'tokens' ? 'Custom token' : 'Custom NFT not yet supported'}
                        disabled={inventoryView !== 'tokens'}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
