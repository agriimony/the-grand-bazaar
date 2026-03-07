'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import TokenTile from './TokenTile';

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

const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';
const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const BASE_SWAP_CONTRACT = '0x8a9969ed0A9bb3cDA7521DDaA614aE86e72e0A57';
const BASE_SWAP_CONTRACT_ERC20_ERC20 = '0x95D598D839dE1B030848664960F0A20b848193F4';
const BASE_SWAP_CONTRACT_ERC721 = '0x2aa29F096257bc6B253bfA9F6404B20Ae0ef9C4d';
const BASE_SWAP_CONTRACT_ERC1155 = '0xD19783B48b11AFE1544b001c6d807A513e5A95cf';

const ERC20_ABI = [
  'function approve(address spender,uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
];
const ERC721_ABI = ['function approve(address to,uint256 tokenId)'];
const ERC1155_ABI = ['function setApprovalForAll(address operator,bool approved)'];

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function swap(address recipient,uint256 maxRoyalty,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) external',
];
const SWAP_ERC20_ABI = [
  'function protocolFee() view returns (uint256)',
  'function swap(address recipient,uint256 nonce,uint256 expiry,address signerWallet,address signerToken,uint256 signerAmount,address senderToken,uint256 senderAmount,uint8 v,bytes32 r,bytes32 s) external',
];
const ORDER_TYPES = {
  Order: [
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'protocolFee', type: 'uint256' },
    { name: 'signer', type: 'Party' },
    { name: 'sender', type: 'Party' },
    { name: 'affiliateWallet', type: 'address' },
    { name: 'affiliateAmount', type: 'uint256' },
  ],
  Party: [
    { name: 'wallet', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'kind', type: 'bytes4' },
    { name: 'id', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
};
const ORDER_TYPES_ERC20 = {
  OrderERC20: [
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'signerWallet', type: 'address' },
    { name: 'signerToken', type: 'address' },
    { name: 'signerAmount', type: 'uint256' },
    { name: 'protocolFee', type: 'uint256' },
    { name: 'senderWallet', type: 'address' },
    { name: 'senderToken', type: 'address' },
    { name: 'senderAmount', type: 'uint256' },
  ],
};

const ROYALTY_ABI = [
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function royaltyInfo(uint256 tokenId,uint256 salePrice) view returns (address receiver,uint256 royaltyAmount)',
  'function decimals() view returns (uint8)',
];

function isFilled(sel) {
  return Boolean(String(sel?.token || '').trim() && String(sel?.amount || '').trim());
}

function emptySelection() {
  return { token: '', amount: '', imgUrl: '', symbol: '', tokenId: '', name: '', kind: '', balance: '', decimals: '' };
}

function selectionHash(sel) {
  const s = normalizeSelection(sel);
  return [s.token, s.amount, s.kind, s.tokenId, s.balance].join('|');
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
    decimals: String(sel?.decimals || ''),
  };
}

const IS_SWAP_ERC20 = (addr = '') => String(addr || '').toLowerCase() === String(BASE_SWAP_CONTRACT_ERC20_ERC20).toLowerCase();

function resolveSwapContractForSelections(signerSel, senderSel) {
  const signerKind = String(signerSel?.kind || KIND_ERC20).toLowerCase();
  const senderKind = String(senderSel?.kind || KIND_ERC20).toLowerCase();
  if (senderKind === KIND_ERC721) return BASE_SWAP_CONTRACT_ERC721;
  if (senderKind === KIND_ERC1155) return BASE_SWAP_CONTRACT_ERC1155;
  if (signerKind === KIND_ERC20 && senderKind === KIND_ERC20) return BASE_SWAP_CONTRACT_ERC20_ERC20;
  return BASE_SWAP_CONTRACT;
}

function OfferPanel({ title, selection, editable, onChange, onOpenInventory, feeText = '', footer = '', footerTone = 'ok', insufficient = false }) {
  const token = String(selection?.token || '');
  const amount = String(selection?.amount || '');
  const symbol = String(selection?.symbol || '');
  const tokenId = String(selection?.tokenId || '');
  const imgUrl = String(selection?.imgUrl || fallbackTokenArt(token, symbol) || '');

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{title}</div>
      <div className={`rs-box ${insufficient ? 'rs-danger' : ''}`} style={{ minHeight: 140 }}>
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
              <TokenTile
                amountNode={amount || ''}
                amountClassName="rs-token-cell-amount"
                symbol={symbol || 'TOKEN'}
                symbolClassName="rs-token-cell-symbol"
                imgUrl={imgUrl}
                tokenAddress={String(token).split(':')[0]}
                tokenKind={selection?.kind}
                tokenId={tokenId}
                tokenIdClassName="rs-token-cell-tokenid"
                wrapClassName=""
                iconClassName="rs-token-art"
                fallbackClassName="rs-token-art rs-token-fallback"
                disableLink
                insufficient={insufficient}
              />
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
        {feeText ? <p className="rs-fee-note">{feeText}</p> : null}
        {footer ? <p className={footerTone === 'bad' ? 'rs-footer-bad' : 'rs-footer-ok'}>{footer}</p> : null}
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [peers, setPeers] = useState({});
  const [tradeState, setTradeState] = useState({
    signerSelection: emptySelection(),
    senderSelection: emptySelection(),
  });
  const [approved, setApproved] = useState({ signer: false, sender: false });
  const [approvedHash, setApprovedHash] = useState({ signer: '', sender: '' });
  const [peerSnapshotAtApprove, setPeerSnapshotAtApprove] = useState('');
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [feeInfo, setFeeInfo] = useState({ feeOnSignerSide: false, royaltyHuman: '', royaltyRaw: '0' });
  const [livePhase, setLivePhase] = useState('negotiate'); // negotiate|await_signer|await_sender|swapping|success
  const [signedOrderState, setSignedOrderState] = useState(null); // { byRole, byName, expiresAt, payload }
  const [swapTxHash, setSwapTxHash] = useState('');
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
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
      const hash = String(payload?.selectionHash || '').trim();
      setApproved((prev) => ({ ...prev, [who]: decision === 'approve' }));
      setApprovedHash((prev) => ({ ...prev, [who]: decision === 'approve' ? hash : '' }));
    });

    ch.on('broadcast', { event: 'room_signed_order' }, ({ payload }) => {
      const expiresAt = Number(payload?.expiresAt || 0);
      const byRole = String(payload?.byRole || '').trim();
      const byName = String(payload?.byName || '').trim();
      setSignedOrderState({
        byRole,
        byName,
        expiresAt,
        payload: payload?.signedOrder || null,
      });
      setLivePhase('await_sender');
    });

    ch.on('broadcast', { event: 'room_swapping' }, () => {
      setLivePhase('swapping');
    });

    ch.on('broadcast', { event: 'room_swap_success' }, ({ payload }) => {
      const txHash = String(payload?.txHash || '').trim();
      setSwapTxHash(txHash);
      setLivePhase('success');
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
        decimals: String(knownToken?.decimals || '18'),
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
      decimals: '18',
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
      decimals: '0',
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
      decimals: '0',
    });
  };

  const ownSelection = role === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
  const otherSelection = role === 'signer' ? tradeState.senderSelection : tradeState.signerSelection;

  const ownDone = isFilled(ownSelection);
  const otherDone = isFilled(otherSelection);
  const bothDone = ownDone && otherDone;

  useEffect(() => {
    let dead = false;
    async function computeFees() {
      const signerSel = tradeState.signerSelection;
      const senderSel = tradeState.senderSelection;
      const both = isFilled(signerSel) && isFilled(senderSel);
      if (!both) {
        if (!dead) setFeeInfo({ feeOnSignerSide: false, royaltyHuman: '', royaltyRaw: '0' });
        return;
      }

      const signerKind = String(signerSel?.kind || KIND_ERC20).toLowerCase();
      const senderKind = String(senderSel?.kind || KIND_ERC20).toLowerCase();
      const feeOnSignerSide = signerKind === KIND_ERC20 && senderKind === KIND_ERC20;

      let royaltyRaw = 0n;
      try {
        const signerToken = String(signerSel?.token || '').split(':')[0];
        const signerTokenId = String(signerSel?.tokenId || '').trim();
        const senderAmount = String(senderSel?.amount || '0').trim();
        const senderTokenAddr = String(senderSel?.token || '').split(':')[0];
        if (!feeOnSignerSide && /^0x[a-fA-F0-9]{40}$/.test(signerToken) && signerTokenId && /^0x[a-fA-F0-9]{40}$/.test(senderTokenAddr)) {
          const provider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
          const token = new ethers.Contract(signerToken, ROYALTY_ABI, provider);
          const supports = await token.supportsInterface('0x2a55205a').catch(() => false);
          if (supports) {
            const erc20 = new ethers.Contract(senderTokenAddr, ROYALTY_ABI, provider);
            const decimals = Number(await erc20.decimals().catch(() => 18));
            const salePrice = ethers.parseUnits(senderAmount || '0', Number.isFinite(decimals) ? decimals : 18);
            const [, r] = await token.royaltyInfo(BigInt(signerTokenId), salePrice).catch(() => [ethers.ZeroAddress, 0n]);
            royaltyRaw = BigInt(r || 0n);
          }
        }
      } catch {}

      if (!dead) {
        let royaltyHuman = '';
        try {
          if (royaltyRaw > 0n) royaltyHuman = ethers.formatUnits(royaltyRaw, 18);
        } catch {}
        setFeeInfo({ feeOnSignerSide, royaltyHuman, royaltyRaw: royaltyRaw.toString() });
      }
    }
    computeFees();
    return () => {
      dead = true;
    };
  }, [tradeState.signerSelection, tradeState.senderSelection]);

  const otherPeer = Object.values(peers).find((p) => p?.sessionId && p.sessionId !== identity.sessionId) || null;
  const otherDisplay = String(otherPeer?.fname || otherPeer?.playerId || '').trim() || shortAddr(otherSelection?.token ? '' : '') || 'player';

  const topTitle = role === 'signer' ? 'You offer' : `${otherDisplay} offers`;
  const bottomTitle = role === 'signer' ? `${otherDisplay} offers` : 'You offer';

  const topSelection = tradeState.signerSelection;
  const bottomSelection = tradeState.senderSelection;

  const myRole = role === 'sender' ? 'sender' : 'signer';
  const peerRole = myRole === 'signer' ? 'sender' : 'signer';
  const mySelection = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
  const peerSelection = myRole === 'signer' ? tradeState.senderSelection : tradeState.signerSelection;
  const mySelectionHash = selectionHash(mySelection);
  const peerSelectionHash = selectionHash(peerSelection);

  const localApproved = Boolean(approved[myRole]);
  const peerApproved = Boolean(approved[peerRole]);
  const peerChangedAfterMyApprove = Boolean(localApproved && peerSnapshotAtApprove && peerSnapshotAtApprove !== peerSelectionHash);

  const topEditable = role === 'signer' && !localApproved;
  const bottomEditable = role === 'sender' && !localApproved;

  const midText = !ownDone ? 'select your token(s)' : `waiting for ${otherDisplay}`;

  const protocolFeeBps = 50;
  const feeLabel = `incl. ${(Number(protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`;

  const parseNum = (v) => Number(String(v || '0').trim() || 0);
  const fmtNum = (n) => {
    const x = Number(n || 0);
    if (!Number.isFinite(x) || x <= 0) return '0';
    return x.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };
  const signerAmountNum = parseNum(tradeState.signerSelection.amount);
  const senderAmountNum = parseNum(tradeState.senderSelection.amount);
  const signerBalNum = parseNum(tradeState.signerSelection.balance);
  const senderBalNum = parseNum(tradeState.senderSelection.balance);

  const protocolFeeNum = protocolFeeBps / 10000;
  const royaltyNum = Number(feeInfo.royaltyHuman || 0) || 0;

  // Live-maker UI policy: fee payer amount is shown as full outgoing amount,
  // recipient side is shown net received after deductions.
  const signerOutgoing = signerAmountNum;
  const senderOutgoing = senderAmountNum;
  const signerIncoming = feeInfo.feeOnSignerSide
    ? senderAmountNum
    : Math.max(0, senderAmountNum - (senderAmountNum * protocolFeeNum) - royaltyNum);
  const senderIncoming = feeInfo.feeOnSignerSide
    ? Math.max(0, signerAmountNum - (signerAmountNum * protocolFeeNum))
    : signerAmountNum;

  const signerRequired = signerOutgoing;
  const senderRequired = senderOutgoing;

  const signerInsufficient = bothDone && signerBalNum > 0 && signerRequired > signerBalNum;
  const senderInsufficient = bothDone && senderBalNum > 0 && senderRequired > senderBalNum;

  const topIsSignerPanel = role === 'signer';
  const peerChangedTop = myRole === 'sender' ? peerChangedAfterMyApprove : false;
  const peerChangedBottom = myRole === 'signer' ? peerChangedAfterMyApprove : false;
  const topInsufficient = (topIsSignerPanel ? signerInsufficient : senderInsufficient) || peerChangedTop;
  const bottomInsufficient = (topIsSignerPanel ? senderInsufficient : signerInsufficient) || peerChangedBottom;

  const signerFeeText = bothDone && feeInfo.feeOnSignerSide ? feeLabel : '';
  const senderFeeText = bothDone && !feeInfo.feeOnSignerSide
    ? [feeLabel, feeInfo.royaltyHuman ? `incl. royalty ${feeInfo.royaltyHuman}` : ''].filter(Boolean).join(' • ')
    : '';

  const topFeeText = topIsSignerPanel ? signerFeeText : senderFeeText;
  const bottomFeeText = topIsSignerPanel ? senderFeeText : signerFeeText;

  const signerPanelAmountForViewer = role === 'signer' ? signerOutgoing : senderIncoming;
  const senderPanelAmountForViewer = role === 'signer' ? signerIncoming : senderOutgoing;

  const topDisplayAmount = fmtNum(signerPanelAmountForViewer);
  const bottomDisplayAmount = fmtNum(senderPanelAmountForViewer);

  const topDisplaySelection = {
    ...topSelection,
    amount: bothDone ? topDisplayAmount : topSelection.amount,
  };
  const bottomDisplaySelection = {
    ...bottomSelection,
    amount: bothDone ? bottomDisplayAmount : bottomSelection.amount,
  };

  const topFlowFooter = role === 'signer'
    ? (bothDone ? `You send ${fmtNum(signerOutgoing)}` : '')
    : (bothDone ? `You receive ${fmtNum(senderIncoming)}` : '');
  const bottomFlowFooter = role === 'signer'
    ? (bothDone ? `You receive ${fmtNum(signerIncoming)}` : '')
    : (bothDone ? `You send ${fmtNum(senderOutgoing)}` : '');

  const acceptedTextFor = (panelRole) => {
    if (!bothDone) return '';
    if (panelRole === myRole) return localApproved ? 'You have accepted' : 'You have not accepted yet';
    return peerApproved ? `${otherDisplay} has accepted` : `${otherDisplay} has not accepted yet`;
  };

  const topPanelRole = 'signer';
  const bottomPanelRole = 'sender';

  const topAccepted = acceptedTextFor(topPanelRole);
  const bottomAccepted = acceptedTextFor(bottomPanelRole);

  const topFooter = topInsufficient ? 'Insufficient balance' : (topAccepted || topFlowFooter);
  const bottomFooter = bottomInsufficient ? 'Insufficient balance' : (bottomAccepted || bottomFlowFooter);

  const visibleInventoryItems = useMemo(() => {
    if (inventoryView === 'tokens') return inventoryTokens.slice(0, 23);
    if (inventoryNftSubView === 'collections') return inventoryNftCollections.slice(0, 23);
    const rows = Array.isArray(selectedNftCollection?.nfts) ? selectedNftCollection.nfts : [];
    return rows.slice(0, 23);
  }, [inventoryView, inventoryNftSubView, inventoryNftCollections, selectedNftCollection, inventoryTokens]);

  const bothApproved = Boolean(approved.signer && approved.sender);

  useEffect(() => {
    if (livePhase === 'success' || livePhase === 'swapping') return;
    if (!bothDone) {
      setLivePhase('negotiate');
      setSignedOrderState(null);
      return;
    }
    if (bothApproved && !signedOrderState) {
      setLivePhase('await_signer');
      return;
    }
    if (!bothApproved) {
      setLivePhase('negotiate');
      setSignedOrderState(null);
    }
  }, [bothDone, bothApproved, livePhase, signedOrderState]);

  useEffect(() => {
    if (!signedOrderState?.expiresAt) return;
    const msLeft = signedOrderState.expiresAt - Date.now();
    if (msLeft <= 0) {
      setSignedOrderState(null);
      setLivePhase('await_signer');
      setApproved((prev) => ({ ...prev, signer: false }));
      setApprovedHash((prev) => ({ ...prev, signer: '' }));
      const ch = channelRef.current;
      if (ch) {
        ch.send({
          type: 'broadcast',
          event: 'room_approve',
          payload: { roomId, role: 'signer', decision: 'decline', selectionHash: '', ts: Date.now() },
        });
      }
      return;
    }
    const t = setTimeout(() => setStatus((s) => s), Math.min(msLeft, 1000));
    return () => clearTimeout(t);
  }, [signedOrderState, roomId]);

  const onApprove = async () => {
    if (!bothDone) return;
    if (signerInsufficient || senderInsufficient) return;
    if (approvalBusy) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      setApprovalBusy(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
      const own = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
      const ownKind = String(own?.kind || KIND_ERC20).toLowerCase();
      const tokenAddress = String(own?.token || '').split(':')[0];

      if (ownKind === KIND_ERC20) {
        const decimals = Number(own?.decimals || 18);
        const amountRaw = ethers.parseUnits(String(own?.amount || '0'), Number.isFinite(decimals) ? decimals : 18);
        const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        const tx = await erc20.approve(swapContract, amountRaw);
        await tx.wait();
      } else if (ownKind === KIND_ERC721) {
        const tokenId = BigInt(String(own?.tokenId || '0'));
        const erc721 = new ethers.Contract(tokenAddress, ERC721_ABI, signer);
        const tx = await erc721.approve(swapContract, tokenId);
        await tx.wait();
      } else if (ownKind === KIND_ERC1155) {
        const erc1155 = new ethers.Contract(tokenAddress, ERC1155_ABI, signer);
        const tx = await erc1155.setApprovalForAll(swapContract, true);
        await tx.wait();
      }

      const localHash = mySelectionHash;
      const nextApproved = { ...approved, [myRole]: true };
      const nextHashes = { ...approvedHash, [myRole]: localHash };
      setApproved(nextApproved);
      setApprovedHash(nextHashes);
      setPeerSnapshotAtApprove(peerSelectionHash);

      ch.send({
        type: 'broadcast',
        event: 'room_approve',
        payload: {
          roomId,
          role: myRole,
          decision: 'approve',
          selectionHash: localHash,
          sessionId: identity.sessionId,
          ts: Date.now(),
        },
      });

      if (nextApproved.signer && nextApproved.sender) {
        setLivePhase('await_signer');
      }
    } catch (e) {
      setStatus(`approval failed: ${e?.message || 'unknown'}`);
    } finally {
      setApprovalBusy(false);
    }
  };

  const onSignerSign = async () => {
    if (myRole !== 'signer') return;
    if (!bothApproved) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      const signerWallet = String(identity.playerId || '').trim();
      const senderWallet = String(otherPeer?.playerId || '').trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(signerWallet) || !/^0x[a-fA-F0-9]{40}$/.test(senderWallet)) {
        setStatus('wallet identities missing for live sign');
        return;
      }

      const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
      const isSwapErc20 = IS_SWAP_ERC20(swapContract);
      const readProvider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
      const swap = new ethers.Contract(swapContract, isSwapErc20 ? SWAP_ERC20_ABI : SWAP_ABI, readProvider);
      const protocolFee = await swap.protocolFee();

      const signerDecimals = Number(tradeState.signerSelection?.decimals || 18);
      const senderDecimals = Number(tradeState.senderSelection?.decimals || 18);
      const signerAmount = (String(tradeState.signerSelection?.kind || '').toLowerCase() === KIND_ERC721)
        ? '0'
        : ethers.parseUnits(String(tradeState.signerSelection?.amount || '0'), Number.isFinite(signerDecimals) ? signerDecimals : 18).toString();
      const senderAmount = (String(tradeState.senderSelection?.kind || '').toLowerCase() === KIND_ERC721)
        ? '0'
        : ethers.parseUnits(String(tradeState.senderSelection?.amount || '0'), Number.isFinite(senderDecimals) ? senderDecimals : 18).toString();

      const nonce = (BigInt(Math.floor(Date.now() / 1000)) * 1000000n + BigInt(Math.floor(Math.random() * 1000000))).toString();
      const expirySec = Math.floor(Date.now() / 1000) + 5 * 60;

      const signerToken = String(tradeState.signerSelection?.token || '').split(':')[0];
      const senderToken = String(tradeState.senderSelection?.token || '').split(':')[0];
      const signerKind = String(tradeState.signerSelection?.kind || KIND_ERC20);
      const senderKind = String(tradeState.senderSelection?.kind || KIND_ERC20);
      const signerId = Number(tradeState.signerSelection?.tokenId || 0);
      const senderId = Number(tradeState.senderSelection?.tokenId || 0);

      const domain = {
        name: isSwapErc20 ? 'SWAP_ERC20' : 'SWAP',
        version: isSwapErc20 ? '4.3' : '4.2',
        chainId: 8453,
        verifyingContract: swapContract,
      };

      const typedOrder = {
        nonce,
        expiry: expirySec,
        protocolFee: Number(protocolFee.toString()),
        signer: { wallet: signerWallet, token: signerToken, kind: signerKind, id: signerId, amount: signerAmount },
        sender: { wallet: senderWallet, token: senderToken, kind: senderKind, id: senderId, amount: senderAmount },
        affiliateWallet: ethers.ZeroAddress,
        affiliateAmount: 0,
      };
      const typedOrderErc20 = {
        nonce,
        expiry: expirySec,
        signerWallet,
        signerToken,
        signerAmount,
        protocolFee: Number(protocolFee.toString()),
        senderWallet,
        senderToken,
        senderAmount,
      };

      const provider = new ethers.BrowserProvider(window.ethereum);
      const ws = await provider.getSigner();
      const sig = await ws.signTypedData(domain, isSwapErc20 ? ORDER_TYPES_ERC20 : ORDER_TYPES, isSwapErc20 ? typedOrderErc20 : typedOrder);
      const split = ethers.Signature.from(sig);

      const signedOrder = {
        chainId: 8453,
        swapContract,
        nonce,
        expiry: String(expirySec),
        signerWallet,
        signerToken,
        signerAmount,
        signerKind,
        signerId: String(signerId),
        protocolFee: String(protocolFee),
        senderWallet,
        senderToken,
        senderAmount,
        senderKind,
        senderId: String(senderId),
        v: Number(split.v),
        r: split.r,
        s: split.s,
      };

      const expiresAt = expirySec * 1000;
      const payload = {
        roomId,
        byRole: 'signer',
        byName: localFname || identity.playerId,
        expiresAt,
        signedOrder,
      };

      setSignedOrderState({ byRole: 'signer', byName: localFname || identity.playerId, expiresAt, payload: signedOrder });
      setLivePhase('await_sender');
      ch.send({ type: 'broadcast', event: 'room_signed_order', payload });
    } catch (e) {
      setStatus(`sign failed: ${e?.message || 'unknown'}`);
    }
  };

  const onSenderSwap = async () => {
    if (myRole !== 'sender') return;
    if (!signedOrderState?.payload) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      setLivePhase('swapping');
      ch.send({ type: 'broadcast', event: 'room_swapping', payload: { roomId, ts: Date.now() } });

      const o = signedOrderState.payload;
      const isSwapErc20 = IS_SWAP_ERC20(o.swapContract);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const ws = await provider.getSigner();
      const swap = new ethers.Contract(o.swapContract, isSwapErc20 ? SWAP_ERC20_ABI : SWAP_ABI, ws);

      let tx;
      if (isSwapErc20) {
        tx = await swap.swap(
          identity.playerId,
          BigInt(o.nonce),
          BigInt(o.expiry),
          o.signerWallet,
          o.signerToken,
          BigInt(o.signerAmount),
          o.senderToken,
          BigInt(o.senderAmount),
          Number(o.v),
          o.r,
          o.s
        );
      } else {
        const orderForCall = {
          nonce: BigInt(o.nonce),
          expiry: BigInt(o.expiry),
          signer: { wallet: o.signerWallet, token: o.signerToken, kind: o.signerKind, id: BigInt(o.signerId || 0), amount: BigInt(o.signerAmount) },
          sender: { wallet: o.senderWallet, token: o.senderToken, kind: o.senderKind, id: BigInt(o.senderId || 0), amount: BigInt(o.senderAmount) },
          affiliateWallet: ethers.ZeroAddress,
          affiliateAmount: 0n,
          v: Number(o.v),
          r: o.r,
          s: o.s,
        };
        tx = await swap.swap(identity.playerId, 0n, orderForCall);
      }

      const rec = await tx.wait();
      const txHash = String(rec?.hash || tx?.hash || '');
      setSwapTxHash(txHash);
      setLivePhase('success');
      ch.send({ type: 'broadcast', event: 'room_swap_success', payload: { roomId, txHash, ts: Date.now() } });
    } catch (e) {
      setStatus(`swap failed: ${e?.message || 'unknown'}`);
      setLivePhase('await_sender');
    }
  };

  const onDecline = async () => {
    const ch = channelRef.current;
    if (!ch) return;

    try {
      if (localApproved) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
        const own = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
        const ownKind = String(own?.kind || KIND_ERC20).toLowerCase();
        const tokenAddress = String(own?.token || '').split(':')[0];

        if (ownKind === KIND_ERC20) {
          const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const tx = await erc20.approve(swapContract, 0n);
          await tx.wait();
        } else if (ownKind === KIND_ERC1155) {
          const erc1155 = new ethers.Contract(tokenAddress, ERC1155_ABI, signer);
          const tx = await erc1155.setApprovalForAll(swapContract, false);
          await tx.wait();
        }
      }
    } catch {}

    setApproved((prev) => ({ ...prev, [myRole]: false }));
    setApprovedHash((prev) => ({ ...prev, [myRole]: '' }));
    setPeerSnapshotAtApprove('');
    ch.send({
      type: 'broadcast',
      event: 'room_approve',
      payload: {
        roomId,
        role: myRole,
        decision: 'decline',
        selectionHash: '',
        sessionId: identity.sessionId,
        ts: Date.now(),
      },
    });
  };

  return (
    <div className="rs-window" style={{ overflow: 'hidden' }}>
      <div className="rs-topbar">
        <button className="rs-topbar-back" onClick={() => router.push(`/${initialChannel || 'worlds'}`)}>{'<'}</button>
        <span className="rs-topbar-title">Trading with {otherDisplay || shortAddr(otherPeer?.playerId || '') || 'player'}</span>
      </div>

      <div className="rs-grid" style={{ gridTemplateRows: '1fr auto 1fr', minHeight: 520 }}>
        <OfferPanel
          title={topTitle}
          selection={topDisplaySelection}
          editable={topEditable}
          onChange={onChangeOwn}
          onOpenInventory={openInventory}
          feeText={topFeeText}
          footer={topFooter}
          footerTone={topInsufficient || /not accepted/i.test(topFooter) ? 'bad' : 'ok'}
          insufficient={topInsufficient}
        />

        <div className="rs-center" style={{ display: 'grid', gap: 10 }}>
          {!bothDone || livePhase === 'negotiate' ? (
            bothDone ? (
              <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
                <button className="rs-btn rs-btn-positive" onClick={onApprove} disabled={signerInsufficient || senderInsufficient || approvalBusy}>{approvalBusy ? 'Approving...' : 'Approve'}</button>
                <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
              </div>
            ) : (
              <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
                <div className="rs-loading-track">
                  <div className="rs-loading-fill" />
                  <div className="rs-loading-label">{midText}</div>
                </div>
              </div>
            )
          ) : livePhase === 'await_signer' ? (
            myRole === 'signer' ? (
              <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
                <button className="rs-btn rs-btn-positive" onClick={onSignerSign}>Sign</button>
                <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
              </div>
            ) : (
              <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
                <div className="rs-loading-track"><div className="rs-loading-fill" /><div className="rs-loading-label">{`waiting for ${otherDisplay}`}</div></div>
              </div>
            )
          ) : livePhase === 'await_sender' ? (
            myRole === 'sender' ? (
              <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
                <button className="rs-btn rs-btn-positive" onClick={onSenderSwap}>{`Swap (${Math.max(0, Math.ceil(((signedOrderState?.expiresAt || 0) - nowMs) / 1000))}s)`}</button>
                <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
              </div>
            ) : (
              <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
                <div className="rs-loading-track"><div className="rs-loading-fill" /><div className="rs-loading-label">{`waiting for ${otherDisplay} (${Math.max(0, Math.ceil(((signedOrderState?.expiresAt || 0) - nowMs) / 1000))}s)`}</div></div>
              </div>
            )
          ) : livePhase === 'swapping' ? (
            <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
              <div className="rs-loading-track"><div className="rs-loading-fill" /><div className="rs-loading-label">swapping...</div></div>
            </div>
          ) : (
            <div className="rs-btn-stack" style={{ width: 'min(420px, 92vw)' }}>
              <div className="rs-btn rs-btn-positive" style={{ cursor: 'default' }}>Swap success</div>
              {swapTxHash ? <a className="rs-btn" href={`https://basescan.org/tx/${swapTxHash}`} target="_blank" rel="noreferrer">View on BaseScan</a> : null}
            </div>
          )}
          <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.75 }}>{status}</div>
        </div>

        <OfferPanel
          title={bottomTitle}
          selection={bottomDisplaySelection}
          editable={bottomEditable}
          onChange={onChangeOwn}
          onOpenInventory={openInventory}
          feeText={bottomFeeText}
          footer={bottomFooter}
          footerTone={bottomInsufficient || /not accepted/i.test(bottomFooter) ? 'bad' : 'ok'}
          insufficient={bottomInsufficient}
        />
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
                              <TokenTile
                                amountNode={null}
                                symbol={collSymbol}
                                symbolClassName="rs-token-cell-symbol"
                                imgUrl={collImg}
                                tokenAddress={collAddr}
                                tokenKind="0x80ac58cd"
                                wrapClassName="rs-token-cell-wrap"
                                iconClassName="rs-token-cell-icon"
                                fallbackClassName="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback"
                                disableLink
                              />
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
                              decimals: String(item?.decimals || (isToken ? '18' : '0')),
                            })}
                            title={isToken ? `${symbol} ${amount}` : `${item?.name || symbol} #${tokenId}`}
                          >
                            <TokenTile
                              amountNode={isToken ? amount : null}
                              amountClassName="rs-token-cell-amount"
                              symbol={symbol}
                              symbolClassName="rs-token-cell-symbol"
                              imgUrl={imgUrl}
                              tokenAddress={String(token).split(':')[0]}
                              tokenKind={item?.kind || (isToken ? '0x20' : '0x80ac58cd')}
                              tokenId={tokenId}
                              tokenIdClassName="rs-token-cell-tokenid"
                              wrapClassName="rs-token-cell-wrap"
                              iconClassName="rs-token-cell-icon"
                              fallbackClassName="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback"
                              disableLink
                            />
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
