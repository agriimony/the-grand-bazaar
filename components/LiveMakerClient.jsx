'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import TokenTile from './TokenTile';
import { fetchSession, getStoredAuthToken } from '../lib/client-auth';

function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function shortAddr(v = '') {
  const s = String(v || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function shortErr(v = '', max = 140) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'unknown';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function decodeKnownRevert(err) {
  const raw = String(err?.data || err?.info?.error?.data || err?.error?.data || '').toLowerCase();
  if (raw.startsWith('0x7939f424')) return 'TransferFromFailed()';
  return '';
}

function shortPlayer(v = '', max = 14) {
  const s = shortAddr(String(v || '').trim());
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatTokenAmountParts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { number: String(value), suffix: '' };
  const abs = Math.abs(n);
  const suffixes = ['', 'k', 'M', 'B', 'T', 'Q'];
  let tier = 0;
  while (tier < suffixes.length - 1 && abs >= Math.pow(1000, tier + 1)) tier += 1;

  let scaled = n / Math.pow(1000, tier);
  if (Math.abs(scaled) < 1000 && tier > 0) {
    const downScaled = n / Math.pow(1000, tier - 1);
    if (Math.abs(downScaled) < 10000) {
      tier -= 1;
      scaled = downScaled;
    }
  }

  const absScaled = Math.abs(scaled);
  let number;
  if (absScaled >= 1000) number = scaled.toFixed(0);
  else if (absScaled >= 100) number = scaled.toFixed(1);
  else if (absScaled >= 10) number = scaled.toFixed(2);
  else number = scaled.toFixed(3);

  return { number, suffix: suffixes[tier] };
}

function toSubscriptDigits(v = '') {
  const map = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  return String(v).split('').map((c) => map[c] || c).join('');
}

function formatSmallWithSubscript(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const s = abs.toFixed(12).replace(/0+$/, '');
  const [, frac = ''] = s.split('.');
  const m = frac.match(/^(0+)(\d+)/);
  if (!m) return `${sign}${s}`;
  const zeroCount = m[1].length;
  const sig = ((m[2] || '').slice(0, 2) || '00').padEnd(2, '0');
  return `${sign}0.0${toSubscriptDigits(String(zeroCount))}${sig}`;
}

function formatTokenAmount(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n !== 0 && Math.abs(n) < 0.001) {
    return formatSmallWithSubscript(n);
  }
  const p = formatTokenAmountParts(value);
  return `${p.number}${p.suffix}`;
}

function formatIntegerAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value || '0');
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);
  const suffixes = ['', 'k', 'M', 'B', 'T', 'Q'];
  let tier = 0;
  while (tier < suffixes.length - 1 && v >= Math.pow(1000, tier + 1)) tier += 1;
  let scaled = v / Math.pow(1000, tier);
  if (scaled < 1000 && tier > 0) {
    const downScaled = v / Math.pow(1000, tier - 1);
    if (downScaled < 10000) {
      tier -= 1;
      scaled = downScaled;
    }
  }
  let decimals = 0;
  if (scaled < 10) decimals = 3;
  else if (scaled < 100) decimals = 2;
  else if (scaled < 1000) decimals = 1;
  const s = scaled.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return `${s}${suffixes[tier]}`;
}

function suffixClass(suffix = '') {
  const s = (suffix || '').toLowerCase();
  if (s === 'k') return 'amt-k';
  if (s === 'm') return 'amt-m';
  if (s === 'b') return 'amt-b';
  if (s === 't') return 'amt-t';
  if (s === 'q') return 'amt-q';
  return 'amt-n';
}

function renderAmountColored(amountText) {
  const m = String(amountText || '').match(/^(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);
  if (!m) return <>{amountText}</>;
  const cls = suffixClass(m[2]);
  return <><span className={cls}>{m[1]}</span><span className={`amt-sfx ${cls}`}>{m[2]}</span></>;
}

function formatTokenIdLabel(v = '') {
  const s = String(v || '');
  return s.length > 12 ? `#${s.slice(0, 4)}…${s.slice(-4)}` : `#${s}`;
}

const BASE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const TOKEN_CATALOG = [
  { token: BASE_ETH, iconArt: '/eth-icon.png' },
  { token: BASE_USDC, iconArt: '' },
  { token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', iconArt: '' },
  { token: BASE_WETH, iconArt: '/weth-icon.png' },
  { token: '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe', iconArt: '/higher-icon.png' },
  { token: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', iconArt: '' },
];

const CATALOG_ICON_BY_SYMBOL = {
  higher: '/higher-icon.png',
  eth: '/eth-icon.png',
  weth: '/weth-icon.png',
};

function canonAddr(addr = '') {
  const a = String(addr || '').trim().toLowerCase();
  if (!a) return '';
  return a;
}

function isEthSentinelAddr(addr = '') {
  const a = canonAddr(addr);
  return a === canonAddr(BASE_ETH)
    || a === '0x0000000000000000000000000000000000000000'
    || a === '0x000000000000000000000000000000000000dead'
    || a === 'eth';
}

function tokenKey(addr = '') {
  return isEthSentinelAddr(addr) ? canonAddr(BASE_ETH) : canonAddr(addr);
}

function catalogIconArt(token = '') {
  const t = tokenKey(token || '');
  const found = TOKEN_CATALOG.find((x) => tokenKey(x?.token || '') === t);
  return found?.iconArt || '';
}

function tokenIconUrl(token = '') {
  const t = String(token || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return '';
  let checksum = t;
  try { checksum = ethers.getAddress(t); } catch {}
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksum}/logo.png`;
}

function fallbackTokenArt(token = '', symbol = '') {
  const addrOnly = String(token || '').split(':')[0].trim();
  const byCatalog = catalogIconArt(addrOnly);
  if (byCatalog) return byCatalog;

  const bySymbol = CATALOG_ICON_BY_SYMBOL[String(symbol || '').trim().toLowerCase()];
  if (bySymbol) return bySymbol;

  if (/^0x[a-fA-F0-9]{40}$/.test(addrOnly)) return tokenIconUrl(addrOnly);

  return '';
}

function isAddress(v = '') {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim());
}

function parseRoomBinding(roomId = '') {
  const m = String(roomId || '').trim().match(/^r:(\d+):(0x[a-fA-F0-9]{40}):(0x[a-fA-F0-9]{40}):([a-zA-Z0-9]+)$/);
  if (!m) return null;
  return {
    chainId: Number(m[1] || 0),
    signer: String(m[2] || '').toLowerCase(),
    sender: String(m[3] || '').toLowerCase(),
    nonce: String(m[4] || ''),
  };
}

function channelTopicFromRoomId(roomId = '') {
  const s = String(roomId || '').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `maker_live_${hex}`;
}

async function getPreferredEip1193Provider() {
  if (typeof window === 'undefined') return { provider: null, info: null };
  const eth = window.ethereum;
  if (!eth) return { provider: null, info: null };

  const providers = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];

  let pref = null;
  try {
    pref = JSON.parse(window.sessionStorage.getItem('gbz:wallet-preferred') || 'null');
  } catch {}

  const id = String(pref?.id || '').toLowerCase();
  const rdns = String(pref?.rdns || '').toLowerCase();
  const name = String(pref?.name || '').toLowerCase();
  const uuid = String(pref?.uuid || '').trim();

  const announced = [];
  if (typeof window !== 'undefined') {
    const onAnnounce = (event) => {
      const info = event?.detail?.info || {};
      const provider = event?.detail?.provider;
      if (!provider) return;
      announced.push({
        uuid: String(info?.uuid || ''),
        rdns: String(info?.rdns || ''),
        name: String(info?.name || ''),
        provider,
      });
    };
    try {
      window.addEventListener('eip6963:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      await new Promise((r) => setTimeout(r, 500));
    } catch {}
    try {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    } catch {}
  }

  if (uuid) {
    const exact = announced.find((a) => a.uuid === uuid);
    if (exact?.provider) return { provider: exact.provider, info: exact };
    if (id.startsWith('eip6963:')) return { provider: null, info: null };
  }

  const pickByHint = providers.find((p) => {
    if (rdns.includes('metamask') || name.includes('metamask') || id.includes('metamask')) return Boolean(p?.isMetaMask);
    if (rdns.includes('rabby') || name.includes('rabby') || id.includes('rabby')) return Boolean(p?.isRabby);
    if (rdns.includes('coinbase') || name.includes('coinbase') || id.includes('coinbase')) return Boolean(p?.isCoinbaseWallet);
    return false;
  });

  return { provider: pickByHint || providers[0] || eth, info: null };
}

function normalizeChainId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 0n;
  try {
    if (v.startsWith('0x')) return BigInt(v);
    return BigInt(parseInt(v, 10));
  } catch {
    return 0n;
  }
}

async function ensureBaseNetwork(eip1193) {
  let chainId = 0n;
  try {
    const raw = await eip1193.request?.({ method: 'eth_chainId' });
    chainId = normalizeChainId(raw);
  } catch {}
  if (chainId === 8453n) return 8453n;

  try {
    await eip1193.request?.({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
  } catch {
    throw new Error(`wrong network: detected ${chainId.toString()} switch wallet to Base (8453)`);
  }

  let after = 0n;
  try {
    const raw2 = await eip1193.request?.({ method: 'eth_chainId' });
    after = normalizeChainId(raw2);
  } catch {}
  if (after !== 8453n) {
    throw new Error(`wrong network: detected ${after.toString()} switch wallet to Base (8453)`);
  }
  return after;
}

async function getPreferredSigner(expectedAddress = '') {
  const picked = await getPreferredEip1193Provider();
  const eip1193 = picked?.provider;
  if (!eip1193) throw new Error('selected wallet provider unavailable. reconnect using your intended wallet');
  await ensureBaseNetwork(eip1193);
  const provider = new ethers.BrowserProvider(eip1193);
  const signer = await provider.getSigner();
  const addr = String(await signer.getAddress()).toLowerCase();
  const exp = String(expectedAddress || '').toLowerCase();
  if (exp && addr !== exp) {
    throw new Error(`wallet mismatch: connected ${shortAddr(addr)} expected ${shortAddr(exp)}`);
  }
  return { provider, signer, address: addr, providerInfo: picked?.info || null };
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
const ERC721_READ_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];
const ERC1155_ABI = ['function setApprovalForAll(address operator,bool approved)'];
const ERC1155_READ_ABI = [
  'function balanceOf(address account,uint256 id) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];
const ERC20_READ_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];
const ERC165_ABI = ['function supportsInterface(bytes4 interfaceId) view returns (bool)'];
const WETH_ABI = ['function deposit() payable'];

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

function normalizeKind(kind = '') {
  const k = String(kind || '').trim().toLowerCase();
  if (!k) return '';
  if (k === KIND_ERC20 || k === '0x20' || k === 'erc20') return KIND_ERC20;
  if (k === KIND_ERC721 || k === '0x721' || k === 'erc721') return KIND_ERC721;
  if (k === KIND_ERC1155 || k === '0x1155' || k === 'erc1155') return KIND_ERC1155;
  return k;
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
    kind: normalizeKind(sel?.kind || ''),
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

function OfferPanel({ title, selection, editable, onChange, onOpenInventory, onLockedTileClick, feeText = '', footer = '', footerTone = 'ok', insufficient = false }) {
  const token = String(selection?.token || '');
  const amount = String(selection?.amount || '');
  const symbol = String(selection?.symbol || '');
  const tokenId = String(selection?.tokenId || '');
  const kind = String(selection?.kind || '').toLowerCase();
  const is1155 = kind === KIND_ERC1155;
  const is721 = kind === KIND_ERC721;
  const amountDisplay = is721
    ? formatTokenIdLabel(tokenId || '0')
    : (is1155 ? formatIntegerAmount(amount || '0') : formatTokenAmount(amount || '0'));
  const symbolDisplay = symbol || (tokenId ? 'NFT' : 'TOKEN');
  const imgUrl = String(selection?.imgUrl || fallbackTokenArt(token, symbol) || '');

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{title}</div>
      <div className={`rs-box ${insufficient ? 'rs-danger' : ''}`} style={{ minHeight: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 16, gap: 12 }}>
          <button
            type="button"
            onClick={() => {
              if (editable) {
                onOpenInventory?.();
                return;
              }
              const tokenAddr = String(token || '').split(':')[0].trim();
              onLockedTileClick?.();
              if (/^0x[a-fA-F0-9]{40}$/.test(tokenAddr) && typeof window !== 'undefined') {
                window.open(`https://basescan.org/token/${tokenAddr}`, '_blank', 'noopener,noreferrer');
              }
            }}
            className={editable ? 'rs-token-editable' : ''}
            style={{
              width: 92,
              height: 92,
              border: 0,
              background: 'transparent',
              display: 'grid',
              placeItems: 'center',
              color: '#f4d77c',
              fontSize: 36,
              flex: '0 0 auto',
              padding: 0,
              cursor: (editable || /^0x[a-fA-F0-9]{40}$/.test(String(token || '').split(':')[0].trim())) ? 'pointer' : 'default',
            }}
          >
            {token ? (
              <TokenTile
                amountNode={renderAmountColored(amountDisplay)}
                amountClassName="rs-token-cell-amount"
                symbol={symbolDisplay}
                symbolClassName="rs-token-cell-symbol"
                imgUrl={imgUrl}
                tokenAddress={String(token).split(':')[0]}
                tokenKind={selection?.kind}
                tokenId={tokenId}
                tokenIdClassName="rs-token-cell-tokenid"
                wrapClassName="rs-token-cell-wrap"
                iconClassName="rs-token-cell-icon"
                fallbackClassName="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback"
                disableLink
                insufficient={insufficient}
              />
            ) : '+'}
          </button>
        </div>
        {feeText ? <p className="rs-fee-note">{feeText}</p> : null}
        {footer ? <p className={footerTone === 'bad' ? 'rs-footer-bad' : 'rs-footer-ok'}>{footer}</p> : null}
      </div>
    </div>
  );
}

export default function LiveMakerClient({
  roomId = '',
  initialRole = 'signer',
  initialChannel = '',
  initialSignerPlayerId = '',
  initialSignerFname = '',
  initialPeerPlayerId = '',
  initialPeerFname = '',
  initialPeerSessionId = '',
}) {
  const router = useRouter();
  const { address } = useAccount();

  const [role] = useState(initialRole === 'sender' ? 'sender' : 'signer');
  const [localFname, setLocalFname] = useState('');
  const localFnameRef = useRef('');
  const [stateVersion, setStateVersion] = useState(0);
  const [status, setStatus] = useState('connecting...');
  const [channelSubscribed, setChannelSubscribed] = useState(false);
  const [walletProviderLabel, setWalletProviderLabel] = useState('');
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
  const [isWrapping, setIsWrapping] = useState(false);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeInfo, setFeeInfo] = useState({ feeOnSignerSide: false, royaltyHuman: '', royaltyRaw: '0', royaltyDecimals: 18, protocolFeeBps: 100 });
  const [livePhase, setLivePhase] = useState('negotiate'); // negotiate|await_signer|await_sender|swapping|success
  const [signedOrderState, setSignedOrderState] = useState(null); // { byRole, byName, expiresAt, payload }
  const [swapTxHash, setSwapTxHash] = useState('');
  const [successCloseAt, setSuccessCloseAt] = useState(0);

  const sendToWorldWithToast = (message, useReplace = true) => {
    try {
      if (typeof window !== 'undefined' && message) {
        window.sessionStorage.setItem('gbz:world-toast', String(message));
      }
    } catch {}
    const nextPath = `/${initialChannel || 'worlds'}`;
    if (useReplace) router.replace(nextPath);
    else router.push(nextPath);
  };

  const debugLog = (...args) => {
    try {
      // eslint-disable-next-line no-console
      console.log('[live-maker]', ...args);
    } catch {}
  };
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryTokens, setInventoryTokens] = useState([]);
  const [inventoryNfts, setInventoryNfts] = useState([]);
  const [inventoryNftCollections, setInventoryNftCollections] = useState([]);
  const [inventoryNftSubView, setInventoryNftSubView] = useState('collections');
  const [selectedNftCollection, setSelectedNftCollection] = useState(null);
  const [customTokenStep, setCustomTokenStep] = useState('none'); // none|custom|custom-id|amount
  const [amountStepBack, setAmountStepBack] = useState('grid'); // grid|custom|custom-id|items
  const [customTokenValue, setCustomTokenValue] = useState('');
  const [customTokenAmount, setCustomTokenAmount] = useState('');
  const [customTokenError, setCustomTokenError] = useState('');
  const [customTokenPreview, setCustomTokenPreview] = useState(null);
  const [inventoryView, setInventoryView] = useState('tokens');
  const [authedPlayerId, setAuthedPlayerId] = useState('');
  const reconnectAttemptRef = useRef(0);
  const skipLeaveOnceRef = useRef(false);
  const [realtimeRetryTick, setRealtimeRetryTick] = useState(0);

  const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const liveRoomId = useMemo(() => {
    const raw = String(roomId || '').trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [roomId]);
  const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublicKey && liveRoomId);
  const liveTopic = useMemo(() => channelTopicFromRoomId(liveRoomId), [liveRoomId]);
  const roomBinding = useMemo(() => parseRoomBinding(liveRoomId), [liveRoomId]);

  useEffect(() => {
    let dead = false;
    async function loadAuth() {
      if (!address) return;
      const token = getStoredAuthToken();
      if (!token) {
        router.replace('/');
        return;
      }
      const r = await fetchSession(token);
      const player = String(r?.session?.playerId || '').trim().toLowerCase();
      if (!r?.ok || !isAddress(player) || player !== String(address).toLowerCase()) {
        if (!dead) router.replace('/');
        return;
      }
      if (!dead) setAuthedPlayerId(player);
    }
    loadAuth();
    return () => { dead = true; };
  }, [address, router]);

  const identity = useMemo(() => {
    if (typeof window === 'undefined') return { playerId: '', sessionId: randomId('session') };
    const playerId = String(authedPlayerId || '').trim().toLowerCase();

    let sessionId = window.sessionStorage.getItem('gbz:session-id');
    if (!sessionId) {
      sessionId = randomId('session');
      window.sessionStorage.setItem('gbz:session-id', sessionId);
    }

    return { playerId, sessionId };
  }, [authedPlayerId]);

  const channelRef = useRef(null);
  const versionRef = useRef(0);
  const tradeStateRef = useRef(tradeState);
  const approvedRef = useRef(approved);
  const approvedHashRef = useRef(approvedHash);
  const livePhaseRef = useRef(livePhase);
  const signedOrderRef = useRef(signedOrderState);

  useEffect(() => {
    versionRef.current = stateVersion;
  }, [stateVersion]);

  useEffect(() => { tradeStateRef.current = tradeState; }, [tradeState]);
  useEffect(() => { approvedRef.current = approved; }, [approved]);
  useEffect(() => { approvedHashRef.current = approvedHash; }, [approvedHash]);
  useEffect(() => { livePhaseRef.current = livePhase; }, [livePhase]);
  useEffect(() => { signedOrderRef.current = signedOrderState; }, [signedOrderState]);
  useEffect(() => { localFnameRef.current = localFname; }, [localFname]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!roomBinding) {
      sendToWorldWithToast('Invalid room id');
      return;
    }
    if (!identity.playerId) return;
    const required = role === 'signer' ? roomBinding.signer : roomBinding.sender;
    if (required !== identity.playerId) {
      sendToWorldWithToast('Wallet not authorized for this room role');
    }
  }, [roomBinding, identity.playerId, role]);

  useEffect(() => {
    if (livePhase !== 'success') {
      setSuccessCloseAt(0);
      return;
    }
    const closeAt = Date.now() + 8000;
    setSuccessCloseAt(closeAt);
    const t = setTimeout(() => {
      router.push(`/${initialChannel || 'worlds'}`);
    }, 8000);
    return () => clearTimeout(t);
  }, [livePhase, router, initialChannel]);

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
    let dead = false;
    async function loadWalletLabel() {
      const picked = await getPreferredEip1193Provider();
      const info = picked?.info;
      const label = info?.name ? `${info.name}${info?.uuid ? ` (${String(info.uuid).slice(0, 8)})` : ''}` : 'selected wallet';
      if (!dead) setWalletProviderLabel(label);
    }
    loadWalletLabel();
    return () => { dead = true; };
  }, [identity.playerId]);

  useEffect(() => {
    if (!enabled) {
      sendToWorldWithToast('Realtime not configured');
      return;
    }

    if (!isAddress(String(identity.playerId || '').toLowerCase())) {
      setStatus('');
      debugLog('waiting for authenticated wallet');
      return;
    }

    const supabase = getSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey);
    if (!supabase) return;
    setChannelSubscribed(false);
    let reconnectTimer = null;
    const ch = supabase.channel(liveTopic, { config: { broadcast: { self: false } } });
    let unmounted = false;

    const sendRoomSnapshot = (toSessionId = '') => {
      try {
        ch.send({
          type: 'broadcast',
          event: 'room_snapshot',
          payload: {
            roomId: liveRoomId,
            toSessionId,
            fromSessionId: identity.sessionId,
            fromRole: role,
            fromPlayerId: identity.playerId,
            fromFname: localFnameRef.current,
            stateVersion: versionRef.current,
            tradeState: tradeStateRef.current,
            approved: approvedRef.current,
            approvedHash: approvedHashRef.current,
            livePhase: livePhaseRef.current,
            signedOrderState: signedOrderRef.current,
            ts: Date.now(),
          },
        });
      } catch {}
    };

    ch.on('broadcast', { event: 'room_join' }, ({ payload }) => {
      const sid = String(payload?.sessionId || '').trim();
      if (!sid) return;
      const joinRole = String(payload?.role || '').trim().toLowerCase();
      const playerId = String(payload?.playerId || '').trim().toLowerCase();
      const expected = joinRole === 'signer' ? roomBinding?.signer : (joinRole === 'sender' ? roomBinding?.sender : '');
      if (!expected || playerId !== expected) return;
      setPeers((prev) => ({
        ...prev,
        [sid]: {
          sessionId: sid,
          playerId,
          fname: String(payload?.fname || '').replace(/^@/, '').trim().toLowerCase(),
          role: joinRole,
        },
      }));
      if (sid !== identity.sessionId) sendRoomSnapshot(sid);
    });

    ch.on('broadcast', { event: 'room_sync_request' }, ({ payload }) => {
      const fromSessionId = String(payload?.fromSessionId || '').trim();
      const fromRole = String(payload?.fromRole || '').trim().toLowerCase();
      const fromPlayerId = String(payload?.fromPlayerId || '').trim().toLowerCase();
      const expected = fromRole === 'signer' ? roomBinding?.signer : (fromRole === 'sender' ? roomBinding?.sender : '');
      if (!fromSessionId || !expected || fromPlayerId !== expected) return;
      if (fromSessionId === identity.sessionId) return;
      sendRoomSnapshot(fromSessionId);
    });

    ch.on('broadcast', { event: 'room_snapshot' }, ({ payload }) => {
      const toSessionId = String(payload?.toSessionId || '').trim();
      if (toSessionId && toSessionId !== identity.sessionId) return;
      const fromSessionId = String(payload?.fromSessionId || '').trim();
      const fromRole = String(payload?.fromRole || '').trim().toLowerCase();
      const fromPlayerId = String(payload?.fromPlayerId || '').trim().toLowerCase();
      const expected = fromRole === 'signer' ? roomBinding?.signer : (fromRole === 'sender' ? roomBinding?.sender : '');
      if (!expected || expected !== fromPlayerId) return;

      if (fromSessionId) {
        setPeers((prev) => ({
          ...prev,
          [fromSessionId]: {
            sessionId: fromSessionId,
            playerId: fromPlayerId,
            fname: String(payload?.fromFname || '').replace(/^@/, '').trim().toLowerCase(),
            role: fromRole,
          },
        }));
      }

      const nextV = Number(payload?.stateVersion || 0);
      if (nextV < versionRef.current) return;

      setStateVersion(nextV);
      versionRef.current = nextV;
      const nextTrade = payload?.tradeState || {};
      const nextTradeState = {
        signerSelection: normalizeSelection(nextTrade?.signerSelection),
        senderSelection: normalizeSelection(nextTrade?.senderSelection),
      };
      tradeStateRef.current = nextTradeState;
      setTradeState(nextTradeState);
      const nextApproved = {
        signer: Boolean(payload?.approved?.signer),
        sender: Boolean(payload?.approved?.sender),
      };
      approvedRef.current = nextApproved;
      setApproved(nextApproved);
      const nextApprovedHash = {
        signer: String(payload?.approvedHash?.signer || ''),
        sender: String(payload?.approvedHash?.sender || ''),
      };
      approvedHashRef.current = nextApprovedHash;
      setApprovedHash(nextApprovedHash);
      const phase = String(payload?.livePhase || 'negotiate');
      livePhaseRef.current = phase;
      setLivePhase(phase);
      signedOrderRef.current = payload?.signedOrderState || null;
      setSignedOrderState(payload?.signedOrderState || null);
    });

    ch.on('broadcast', { event: 'room_state_patch' }, ({ payload }) => {
      const fromRole = String(payload?.fromRole || '').trim().toLowerCase();
      const fromPlayerId = String(payload?.fromPlayerId || '').trim().toLowerCase();
      const expected = fromRole === 'signer' ? roomBinding?.signer : (fromRole === 'sender' ? roomBinding?.sender : '');
      if (!expected || expected !== fromPlayerId) return;
      const nextV = Number(payload?.stateVersion || 0);
      if (nextV <= versionRef.current) return;

      setStateVersion(nextV);
      const nextTradeState = {
        signerSelection: normalizeSelection(payload?.signerSelection),
        senderSelection: normalizeSelection(payload?.senderSelection),
      };
      versionRef.current = nextV;
      tradeStateRef.current = nextTradeState;
      setTradeState(nextTradeState);
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
      const fromPlayerId = String(payload?.playerId || '').trim().toLowerCase();
      const expected = who === 'signer' ? roomBinding?.signer : (who === 'sender' ? roomBinding?.sender : '');
      if ((who !== 'signer' && who !== 'sender') || !expected || expected !== fromPlayerId) return;
      const hash = String(payload?.selectionHash || '').trim();
      debugLog('event:room_approve', { who, decision, hash, fromSessionId: payload?.sessionId || '' });
      setApproved((prev) => {
        const next = { ...prev, [who]: decision === 'approve' };
        approvedRef.current = next;
        return next;
      });
      setApprovedHash((prev) => {
        const next = { ...prev, [who]: decision === 'approve' ? hash : '' };
        approvedHashRef.current = next;
        return next;
      });
    });

    ch.on('broadcast', { event: 'room_signed_order' }, ({ payload }) => {
      const byRole = String(payload?.byRole || '').trim().toLowerCase();
      const byPlayerId = String(payload?.playerId || '').trim().toLowerCase();
      if (byRole !== 'signer' || byPlayerId !== roomBinding?.signer) return;
      const expiresAt = Number(payload?.expiresAt || 0);
      const byName = String(payload?.byName || '').trim();
      debugLog('event:room_signed_order', { byRole, byName, expiresAt, hasPayload: Boolean(payload?.signedOrder) });
      setSignedOrderState({
        byRole,
        byName,
        expiresAt,
        payload: payload?.signedOrder || null,
      });
      setLivePhase('await_sender');
    });

    ch.on('broadcast', { event: 'room_swapping' }, ({ payload }) => {
      if (String(payload?.playerId || '').trim().toLowerCase() !== roomBinding?.sender) return;
      debugLog('event:room_swapping');
      setLivePhase('swapping');
    });

    ch.on('broadcast', { event: 'room_swap_success' }, ({ payload }) => {
      if (String(payload?.playerId || '').trim().toLowerCase() !== roomBinding?.sender) return;
      const txHash = String(payload?.txHash || '').trim();
      debugLog('event:room_swap_success', { txHash });
      setSwapTxHash(txHash);
      setLivePhase('success');
    });

    ch.on('broadcast', { event: 'room_close' }, ({ payload }) => {
      const reason = String(payload?.reason || '').trim().toLowerCase();
      const byRole = String(payload?.byRole || '').trim().toLowerCase();
      const expected = byRole === 'signer' ? roomBinding?.signer : (byRole === 'sender' ? roomBinding?.sender : '');
      if (!expected || String(payload?.playerId || '').trim().toLowerCase() !== expected) return;
      debugLog('event:room_close', { reason, byRole: payload?.byRole || '' });
      if (reason === 'decline') {
        router.push(`/${initialChannel || 'worlds'}`);
      }
    });

    ch.subscribe((s) => {
      debugLog('channel_state', s, {
        roomId: liveRoomId,
        topic: liveTopic,
        role,
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
        visibility: typeof document !== 'undefined' ? document.visibilityState : undefined,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      });
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        if (unmounted) return;
        if (s === 'CLOSED') {
          console.warn('[live-maker] channel closed', {
            roomId: liveRoomId,
            topic: liveTopic,
            role,
            playerId: identity.playerId,
            sessionId: identity.sessionId,
          });
          return;
        }
        console.error('[live-maker] realtime subscription problem', {
          state: s,
          roomId: liveRoomId,
          topic: liveTopic,
          role,
          playerId: identity.playerId,
          sessionId: identity.sessionId,
        });
        setChannelSubscribed(false);
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = (s === 'TIMED_OUT' && attempt === 1)
          ? 150
          : Math.min(8000, 800 * attempt);
        setStatus('');
        debugLog('reconnecting live room', { attempt });
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            skipLeaveOnceRef.current = true;
            setRealtimeRetryTick((v) => v + 1);
          }, delay);
        }
      }
      if (s === 'SUBSCRIBED') {
        reconnectAttemptRef.current = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        setChannelSubscribed(true);
        if (!identity.playerId) {
          setStatus('');
          debugLog('auth pending');
          return;
        }
        const expected = role === 'signer' ? roomBinding?.signer : roomBinding?.sender;
        if (!expected || expected !== identity.playerId) {
          sendToWorldWithToast('Room auth mismatch');
          return;
        }
        debugLog('live room connected', { roomId: liveRoomId, role, sessionId: identity.sessionId, playerId: identity.playerId, fname: localFnameRef.current });
        debugLog('event:room_join:send', { roomId: liveRoomId, role, sessionId: identity.sessionId, playerId: identity.playerId, fname: localFnameRef.current });
        ch.send({
          type: 'broadcast',
          event: 'room_join',
          payload: {
            roomId: liveRoomId,
            role,
            sessionId: identity.sessionId,
            playerId: identity.playerId,
            fname: localFnameRef.current,
            ts: Date.now(),
          },
        });
        ch.send({
          type: 'broadcast',
          event: 'room_sync_request',
          payload: {
            roomId: liveRoomId,
            fromSessionId: identity.sessionId,
            fromRole: role,
            fromPlayerId: identity.playerId,
            ts: Date.now(),
          },
        });
        setTimeout(() => {
          try {
            ch.send({
              type: 'broadcast',
              event: 'room_sync_request',
              payload: {
                roomId: liveRoomId,
                fromSessionId: identity.sessionId,
                fromRole: role,
                fromPlayerId: identity.playerId,
                ts: Date.now(),
              },
            });
          } catch {}
        }, 1000);
      }
    });

    channelRef.current = ch;

    const announceLeave = () => {
      try {
        ch.send({
          type: 'broadcast',
          event: 'room_leave',
          payload: {
            roomId: liveRoomId,
            sessionId: identity.sessionId,
            playerId: identity.playerId,
            fname: localFnameRef.current,
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', announceLeave);
      }
      if (skipLeaveOnceRef.current) {
        skipLeaveOnceRef.current = false;
      } else {
        announceLeave();
      }
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
    };
  }, [enabled, liveRoomId, liveTopic, role, identity.sessionId, identity.playerId, supabasePublicKey, router, initialChannel, roomBinding, realtimeRetryTick]);

  const publishPatch = (next) => {
    const ch = channelRef.current;
    if (!ch) return;

    const normalized = {
      signerSelection: normalizeSelection(next?.signerSelection),
      senderSelection: normalizeSelection(next?.senderSelection),
    };

    const nextVersion = versionRef.current + 1;
    versionRef.current = nextVersion;
    tradeStateRef.current = normalized;
    setStateVersion(nextVersion);
    setTradeState(normalized);

    ch.send({
      type: 'broadcast',
      event: 'room_state_patch',
      payload: {
        roomId: liveRoomId,
        stateVersion: nextVersion,
        signerSelection: normalized.signerSelection,
        senderSelection: normalized.senderSelection,
        fromSessionId: identity.sessionId,
        fromRole: role,
        fromPlayerId: identity.playerId,
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
    const cacheTtlMs = 24 * 60 * 60 * 1000;

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

  const detectCustomKind = async (token, provider) => {
    try {
      const c = new ethers.Contract(token, ERC165_ABI, provider);
      const is1155 = await c.supportsInterface(KIND_ERC1155).catch(() => false);
      if (is1155) return KIND_ERC1155;
      const is721 = await c.supportsInterface(KIND_ERC721).catch(() => false);
      if (is721) return KIND_ERC721;
    } catch {}
    return KIND_ERC20;
  };

  const applyCustomToken = async () => {
    const token = String(customTokenValue || '').trim();
    if (!token) {
      setCustomTokenError('enter a token address');
      return;
    }
    if (!isAddress(token)) {
      setCustomTokenError('enter valid token address');
      return;
    }

    const knownToken = inventoryTokens.find((t) => String(t?.token || '').toLowerCase() === token.toLowerCase());
    if (knownToken) {
      setCustomTokenPreview({
        token: knownToken?.token || token,
        amount: String(knownToken?.balance || '').trim(),
        imgUrl: knownToken?.imgUrl || '',
        symbol: knownToken?.symbol || shortAddr(token),
        tokenId: '',
        name: knownToken?.symbol || token,
        kind: KIND_ERC20,
        balance: String(knownToken?.balance || ''),
        decimals: String(knownToken?.decimals || '18'),
      });
      setCustomTokenAmount('');
      setCustomTokenError('');
      setAmountStepBack('custom');
      setCustomTokenStep('amount');
      return;
    }

    const coll = inventoryNftCollections.find((c) => String(c?.collectionAddress || '').toLowerCase() === token.toLowerCase());
    if (coll) {
      setInventoryView('nfts');
      setSelectedNftCollection({ ...coll, kind: String(coll?.kind || coll?.nfts?.[0]?.kind || KIND_ERC721).toLowerCase() });
      setCustomTokenStep('custom-id');
      setCustomTokenError('');
      return;
    }

    const owner = String(identity.playerId || '').trim();
    if (!isAddress(owner)) {
      setCustomTokenError('wallet identity unavailable');
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
      const kind = await detectCustomKind(token, provider);

      if (kind === KIND_ERC20) {
        const c = new ethers.Contract(token, ERC20_READ_ABI, provider);
        const [balRaw, decimalsRaw, symbolRaw, nameRaw] = await Promise.all([
          c.balanceOf(owner).catch(() => 0n),
          c.decimals().catch(() => 18),
          c.symbol().catch(() => shortAddr(token)),
          c.name().catch(() => ''),
        ]);
        const decimals = Number(decimalsRaw || 18);
        const balance = ethers.formatUnits(BigInt(balRaw || 0n), Number.isFinite(decimals) ? decimals : 18);
        if (!(Number(balance || 0) > 0)) {
          setCustomTokenError('no balance for this token in your wallet');
          return;
        }
        setCustomTokenPreview({
          token,
          amount: balance,
          imgUrl: fallbackTokenArt(token, symbolRaw),
          symbol: String(symbolRaw || shortAddr(token)),
          tokenId: '',
          name: String(nameRaw || symbolRaw || token),
          kind: KIND_ERC20,
          balance,
          decimals: String(decimals),
        });
        setCustomTokenAmount('');
        setCustomTokenError('');
        setAmountStepBack('custom');
        setCustomTokenStep('amount');
        return;
      }

      setInventoryView('nfts');
      setSelectedNftCollection({
        collectionAddress: token,
        collectionName: shortAddr(token),
        symbol: 'NFT',
        kind,
        nfts: [],
      });
      setCustomTokenStep('custom-id');
      setCustomTokenError('');
    } catch {
      setCustomTokenError('failed to resolve token contract');
    }
  };

  const applyCustomTokenId = async () => {
    const tokenId = String(customTokenValue || '').trim();
    if (!selectedNftCollection) {
      setCustomTokenError('select an NFT collection first');
      return;
    }
    if (!tokenId) {
      setCustomTokenError('enter token id');
      return;
    }
    const collectionAddr = String(selectedNftCollection?.collectionAddress || '').trim();
    const localRow = (selectedNftCollection?.nfts || []).find((n) => String(n?.tokenId || '') === tokenId) || null;
    let row = localRow;

    if (!row && isAddress(collectionAddr) && isAddress(String(identity.playerId || '').trim())) {
      try {
        const provider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
        const owner = String(identity.playerId || '').trim();
        const kind = String(selectedNftCollection?.kind || await detectCustomKind(collectionAddr, provider)).toLowerCase();
        if (kind === KIND_ERC721) {
          const c721 = new ethers.Contract(collectionAddr, ERC721_READ_ABI, provider);
          const ownerOf = String(await c721.ownerOf(BigInt(tokenId))).toLowerCase();
          if (ownerOf !== owner.toLowerCase()) {
            setCustomTokenError('you do not own this token id');
            return;
          }
          const sym = await c721.symbol().catch(() => selectedNftCollection?.symbol || 'NFT');
          row = {
            token: collectionAddr,
            tokenId,
            balance: '1',
            kind: KIND_ERC721,
            symbol: String(sym || 'NFT'),
            name: String(sym || 'NFT'),
            imgUrl: '',
          };
        } else {
          const c1155 = new ethers.Contract(collectionAddr, ERC1155_READ_ABI, provider);
          const bal = await c1155.balanceOf(owner, BigInt(tokenId)).catch(() => 0n);
          if (!(BigInt(bal || 0n) > 0n)) {
            setCustomTokenError('you do not own this token id');
            return;
          }
          row = {
            token: collectionAddr,
            tokenId,
            balance: String(bal),
            kind: KIND_ERC1155,
            symbol: String(selectedNftCollection?.symbol || 'NFT'),
            name: String(selectedNftCollection?.symbol || 'NFT'),
            imgUrl: '',
          };
        }
      } catch {
        setCustomTokenError('token id not found in your holdings');
        return;
      }
    }

    if (!row) {
      setCustomTokenError('token id not found in your holdings');
      return;
    }

    if (Number(row?.balance || 0) <= 0) {
      setCustomTokenError('you do not own this token id');
      return;
    }
    const kind = normalizeKind(row?.kind || KIND_ERC721);
    setCustomTokenPreview({
      token: `${row?.token || selectedNftCollection?.collectionAddress || ''}:${row?.tokenId || tokenId}`,
      amount: String(row?.balance || '1'),
      imgUrl: row?.imgUrl || '',
      symbol: row?.symbol || selectedNftCollection?.symbol || 'NFT',
      tokenId: String(row?.tokenId || tokenId),
      name: row?.name || row?.symbol || 'NFT',
      kind,
      balance: String(row?.balance || '1'),
      decimals: '0',
    });
    setCustomTokenAmount(kind === KIND_ERC721 ? '1' : String(row?.balance || '1'));
    setAmountStepBack('custom-id');
    setCustomTokenStep('amount');
    setCustomTokenError('');
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
        if (!dead) {
          setFeeLoading(false);
          setFeeInfo({ feeOnSignerSide: false, royaltyHuman: '', royaltyRaw: '0', royaltyDecimals: 18, protocolFeeBps: 100 });
        }
        return;
      }

      if (!dead) setFeeLoading(true);

      const signerKind = String(signerSel?.kind || KIND_ERC20).toLowerCase();
      const senderKind = String(senderSel?.kind || KIND_ERC20).toLowerCase();
      const feeOnSignerSide = signerKind === KIND_ERC20 && senderKind === KIND_ERC20;

      let protocolFeeBps = 100;
      let royaltyRaw = 0n;
      let royaltyDecimals = 18;
      try {
        const swapContract = resolveSwapContractForSelections(signerSel, senderSel);
        const provider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
        const swap = new ethers.Contract(swapContract, IS_SWAP_ERC20(swapContract) ? SWAP_ERC20_ABI : SWAP_ABI, provider);
        const pf = await swap.protocolFee().catch(() => 100n);
        const pfNum = Number(pf || 100n);
        if (Number.isFinite(pfNum) && pfNum >= 0) protocolFeeBps = pfNum;

        const signerToken = String(signerSel?.token || '').split(':')[0];
        const signerTokenId = String(signerSel?.tokenId || '').trim();
        const senderAmount = String(senderSel?.amount || '0').trim();
        const senderTokenAddr = String(senderSel?.token || '').split(':')[0];
        if (!feeOnSignerSide && /^0x[a-fA-F0-9]{40}$/.test(signerToken) && signerTokenId && /^0x[a-fA-F0-9]{40}$/.test(senderTokenAddr)) {
          const token = new ethers.Contract(signerToken, ROYALTY_ABI, provider);
          const supports = await token.supportsInterface('0x2a55205a').catch(() => false);
          if (supports) {
            const erc20 = new ethers.Contract(senderTokenAddr, ROYALTY_ABI, provider);
            const decimals = Number(await erc20.decimals().catch(() => 18));
            royaltyDecimals = Number.isFinite(decimals) ? decimals : 18;
            const salePrice = ethers.parseUnits(senderAmount || '0', royaltyDecimals);
            const [, r] = await token.royaltyInfo(BigInt(signerTokenId), salePrice).catch(() => [ethers.ZeroAddress, 0n]);
            royaltyRaw = BigInt(r || 0n);
          }
        }
      } catch {}

      if (!dead) {
        let royaltyHuman = '';
        try {
          if (royaltyRaw > 0n) royaltyHuman = ethers.formatUnits(royaltyRaw, royaltyDecimals);
        } catch {}
        setFeeInfo({ feeOnSignerSide, royaltyHuman, royaltyRaw: royaltyRaw.toString(), royaltyDecimals, protocolFeeBps });
        setFeeLoading(false);
      }
    }
    computeFees();
    return () => {
      dead = true;
    };
  }, [tradeState.signerSelection, tradeState.senderSelection]);

  const otherPeer = Object.values(peers).find((p) => p?.sessionId && p.sessionId !== identity.sessionId) || null;
  const roomHasSigner = role === 'signer' || Object.values(peers).some((p) => String(p?.role || '').toLowerCase() === 'signer');
  const roomHasSender = role === 'sender' || Object.values(peers).some((p) => String(p?.role || '').toLowerCase() === 'sender');
  const bothPartiesJoined = roomHasSigner && roomHasSender;
  const inviteSignerDisplay = role === 'sender'
    ? String(initialSignerFname || initialSignerPlayerId || '').trim()
    : '';
  const initialPeerDisplay = String(initialPeerFname || initialPeerPlayerId || initialPeerSessionId || inviteSignerDisplay || '').trim();
  const peerWalletFallback = String(otherPeer?.playerId || initialPeerPlayerId || '').trim();
  const rawOtherDisplay = String(otherPeer?.fname || otherPeer?.playerId || otherPeer?.sessionId || initialPeerDisplay || '').trim();
  const otherDisplay = shortPlayer(rawOtherDisplay || '') || 'player';

  const topTitle = role === 'signer' ? 'You offer' : 'You receive';
  const bottomTitle = role === 'signer' ? 'You receive' : 'You offer';

  const topSelection = tradeState.signerSelection;
  const bottomSelection = tradeState.senderSelection;

  const myRole = role === 'sender' ? 'sender' : 'signer';
  const peerRole = myRole === 'signer' ? 'sender' : 'signer';
  // Semantic aliases for UI clarity. Keep signer/sender for contract payload boundaries.
  const myFlowRole = myRole === 'signer' ? 'offer maker' : 'offer taker';
  const peerFlowRole = peerRole === 'signer' ? 'offer maker' : 'offer taker';

  useEffect(() => {
    debugLog('wallet context', { walletProviderLabel: walletProviderLabel || 'resolving...' });
  }, [walletProviderLabel]);

  useEffect(() => {
    debugLog('flow roles', { you: myFlowRole, peer: peerFlowRole });
  }, [myFlowRole, peerFlowRole]);
  const mySelection = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
  const peerSelection = myRole === 'signer' ? tradeState.senderSelection : tradeState.signerSelection;
  const mySelectionHash = selectionHash(mySelection);
  const peerSelectionHash = selectionHash(peerSelection);

  const localApproved = Boolean(approved[myRole]);
  const peerApproved = Boolean(approved[peerRole]);
  const peerChangedAfterMyApprove = Boolean(localApproved && peerSnapshotAtApprove && peerSnapshotAtApprove !== peerSelectionHash);

  const topEditable = bothPartiesJoined && role === 'signer' && !localApproved;
  const bottomEditable = bothPartiesJoined && role === 'sender' && !localApproved;

  const midText = !bothPartiesJoined
    ? `waiting for ${otherDisplay} to join`
    : (!ownDone ? 'select your token(s)' : `waiting for ${otherDisplay}`);

  const protocolFeeBps = Number(feeInfo.protocolFeeBps || 100);
  const feeLabel = `incl. ${(Number(protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`;

  const parseNum = (v) => Number(String(v || '0').trim() || 0);
  const fmtNum = (n, kind = KIND_ERC20) => {
    const x = Number(n || 0);
    if (!Number.isFinite(x) || x <= 0) return '0';
    return String(kind || '').toLowerCase() === KIND_ERC1155
      ? formatIntegerAmount(String(x))
      : formatTokenAmount(String(x));
  };
  const signerAmountNum = parseNum(tradeState.signerSelection.amount);
  const senderAmountNum = parseNum(tradeState.senderSelection.amount);
  const signerBalNum = parseNum(tradeState.signerSelection.balance);
  const senderBalNum = parseNum(tradeState.senderSelection.balance);

  const protocolFeeNum = protocolFeeBps / 10000;
  const royaltyNum = (() => {
    try {
      return Number(ethers.formatUnits(BigInt(String(feeInfo.royaltyRaw || '0')), Number(feeInfo.royaltyDecimals || 18))) || 0;
    } catch {
      return Number(feeInfo.royaltyHuman || 0) || 0;
    }
  })();

  // Onchain-consistent display policy:
  // - order amounts are base transfer amounts
  // - fee payer sends fee on top of base amount
  // - counterparty receives full base amount
  const signerKindNow = String(tradeState.signerSelection?.kind || KIND_ERC20).toLowerCase();
  const senderKindNow = String(tradeState.senderSelection?.kind || KIND_ERC20).toLowerCase();
  const signerIs1155 = signerKindNow === KIND_ERC1155;
  const senderIs1155 = senderKindNow === KIND_ERC1155;

  const signerFeeTopup = (() => {
    if (!feeInfo.feeOnSignerSide) return 0;
    if (signerIs1155) {
      const a = BigInt(Math.max(0, Math.floor(signerAmountNum)));
      return Number((a * BigInt(Math.max(0, protocolFeeBps))) / 10000n);
    }
    return signerAmountNum * protocolFeeNum;
  })();
  const senderFeeTopup = (() => {
    if (feeInfo.feeOnSignerSide) return 0;
    if (senderIs1155) {
      const a = BigInt(Math.max(0, Math.floor(senderAmountNum)));
      return Number((a * BigInt(Math.max(0, protocolFeeBps))) / 10000n);
    }
    return senderAmountNum * protocolFeeNum;
  })();

  const signerOutgoing = signerAmountNum + signerFeeTopup;
  const senderOutgoing = senderAmountNum + senderFeeTopup + (feeInfo.feeOnSignerSide ? 0 : royaltyNum);
  const signerIncoming = senderAmountNum;
  const senderIncoming = signerAmountNum;

  const signerRequired = signerOutgoing;
  const senderRequired = senderOutgoing;

  const signerInsufficient = bothDone && signerBalNum > 0 && signerRequired > signerBalNum;
  const senderInsufficient = bothDone && senderBalNum > 0 && senderRequired > senderBalNum;
  const myInsufficient = myRole === 'signer' ? signerInsufficient : senderInsufficient;

  const topIsSignerPanel = true; // top panel always renders signerSelection
  const peerChangedTop = myRole === 'sender' ? peerChangedAfterMyApprove : false;
  const peerChangedBottom = myRole === 'signer' ? peerChangedAfterMyApprove : false;
  const topInsufficient = (topIsSignerPanel ? signerInsufficient : senderInsufficient) || peerChangedTop;
  const bottomInsufficient = (topIsSignerPanel ? senderInsufficient : signerInsufficient) || peerChangedBottom;

  const royaltySymbol = String(tradeState.senderSelection?.symbol || '').trim();
  const royaltyWithSymbol = feeInfo.royaltyHuman
    ? `${feeInfo.royaltyHuman}${royaltySymbol ? ` ${royaltySymbol}` : ''}`
    : '';

  const signerFeeText = bothDone && feeInfo.feeOnSignerSide ? feeLabel : '';
  const senderFeeText = bothDone && !feeInfo.feeOnSignerSide
    ? [feeLabel, royaltyWithSymbol ? `incl. ${royaltyWithSymbol} royalty` : ''].filter(Boolean).join(' • ')
    : '';

  const protocolPctLabel = `${(Number(protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
  const receiverBreakdown = [
    `after ${protocolPctLabel} protocol fee`,
    royaltyWithSymbol ? `+ ${royaltyWithSymbol} royalty` : '',
  ].filter(Boolean).join(' ');

  const signerReceiveNote = bothDone && feeInfo.feeOnSignerSide ? receiverBreakdown : '';
  const senderReceiveNote = bothDone && !feeInfo.feeOnSignerSide ? receiverBreakdown : '';

  const topFeeText = role === 'signer'
    ? signerFeeText
    : signerReceiveNote;
  const bottomFeeText = role === 'signer'
    ? senderFeeText
    : senderFeeText;

  const signerPanelAmountForViewer = role === 'signer' ? signerOutgoing : senderIncoming;
  const senderPanelAmountForViewer = role === 'signer' ? signerIncoming : senderOutgoing;

  const topDisplayAmount = fmtNum(signerPanelAmountForViewer, topSelection?.kind || KIND_ERC20);
  const bottomDisplayAmount = fmtNum(senderPanelAmountForViewer, bottomSelection?.kind || KIND_ERC20);

  const topDisplaySelection = {
    ...topSelection,
    amount: bothDone ? topDisplayAmount : topSelection.amount,
  };
  const bottomDisplaySelection = {
    ...bottomSelection,
    amount: bothDone ? bottomDisplayAmount : bottomSelection.amount,
  };

  const topFlowFooter = role === 'signer'
    ? (bothDone ? `You send ${fmtNum(signerOutgoing, tradeState.signerSelection?.kind || KIND_ERC20)}` : '')
    : (bothDone ? `You receive ${fmtNum(senderIncoming, tradeState.senderSelection?.kind || KIND_ERC20)}` : '');
  const bottomFlowFooter = role === 'signer'
    ? (bothDone ? `You receive ${fmtNum(signerIncoming, tradeState.signerSelection?.kind || KIND_ERC20)}` : '')
    : (bothDone ? `You send ${fmtNum(senderOutgoing, tradeState.senderSelection?.kind || KIND_ERC20)}` : '');

  const acceptedTextFor = (panelRole) => {
    if (!bothDone) return '';
    if (panelRole === myRole) return localApproved ? 'You have accepted' : 'You have not accepted yet';
    return peerApproved ? `${otherDisplay} has accepted` : `${otherDisplay} has not accepted yet`;
  };

  const topPanelRole = 'signer';
  const bottomPanelRole = 'sender';

  const topAccepted = acceptedTextFor(topPanelRole);
  const bottomAccepted = acceptedTextFor(bottomPanelRole);

  const topFooter = peerChangedTop
    ? 'This offer has been changed'
    : (topInsufficient ? 'Insufficient balance' : (topAccepted || topFlowFooter));
  const bottomFooter = peerChangedBottom
    ? 'This offer has been changed'
    : (bottomInsufficient ? 'Insufficient balance' : (bottomAccepted || bottomFlowFooter));

  const visibleInventoryItems = useMemo(() => {
    if (inventoryView === 'tokens') return inventoryTokens.slice(0, 23);
    if (inventoryNftSubView === 'collections') return inventoryNftCollections.slice(0, 23);
    const rows = Array.isArray(selectedNftCollection?.nfts) ? selectedNftCollection.nfts : [];
    return rows.slice(0, 23);
  }, [inventoryView, inventoryNftSubView, inventoryNftCollections, selectedNftCollection, inventoryTokens]);
  const showInventoryGrid = customTokenStep === 'none';
  const amountStepRow = customTokenPreview;
  const amountStepKind = String(amountStepRow?.kind || KIND_ERC20).toLowerCase();
  const amountStepOwnedBal = Number(amountStepRow?.balance || 0);
  const amountStepRaw = amountStepKind === KIND_ERC721 ? '1' : String(customTokenAmount || '').trim();
  const amountStepBaseNum = Number(amountStepRaw || 0);
  const amountStepOver = amountStepBaseNum > amountStepOwnedBal;
  const amountStepIsEthLike = isEthSentinelAddr(String(amountStepRow?.token || '').split(':')[0]) || String(amountStepRow?.symbol || '').toUpperCase() === 'ETH';
  const amountStepDisplay = amountStepKind === KIND_ERC721
    ? formatTokenIdLabel(amountStepRow?.tokenId || '0')
    : (amountStepKind === KIND_ERC1155
      ? formatIntegerAmount((customTokenAmount || amountStepRow?.balance || '0'))
      : formatTokenAmount((customTokenAmount || amountStepRow?.balance || '0')));
  const amountStepInputMode = amountStepKind === KIND_ERC1155 ? 'numeric' : 'decimal';
  const amountStepMaxInput = (() => {
    if (!(Number.isFinite(amountStepOwnedBal) && amountStepOwnedBal > 0)) return '';
    if (amountStepKind === KIND_ERC721) return '1';
    return String(amountStepOwnedBal);
  })();

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
          payload: { roomId: liveRoomId, role: 'signer', decision: 'decline', selectionHash: '', playerId: identity.playerId, ts: Date.now() },
        });
      }
      return;
    }
    const t = setTimeout(() => setStatus((s) => s), Math.min(msLeft, 1000));
    return () => clearTimeout(t);
  }, [signedOrderState, liveRoomId]);

  const onApprove = async () => {
    setStatus('');
    debugLog('approve:start', { bothDone, signerInsufficient, senderInsufficient, approvalBusy, myRole });
    if (!bothDone) return;
    if (signerInsufficient || senderInsufficient) return;
    if (approvalBusy) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      setApprovalBusy(true);
      const { signer } = await getPreferredSigner(identity.playerId);

      const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
      const own = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
      const ownKind = normalizeKind(own?.kind || KIND_ERC20);
      const tokenAddress = String(own?.token || '').split(':')[0];
      debugLog('approve:context', { myRole, ownKind, tokenAddress, swapContract, amount: own?.amount, balance: own?.balance, protocolFeeBps: feeInfo.protocolFeeBps, royaltyRaw: feeInfo.royaltyRaw });

      let didSubmitApproval = false;
      if (ownKind === KIND_ERC20) {
        if (isEthSentinelAddr(tokenAddress)) {
          setStatus('ETH does not need approve; wrap to WETH first');
          return;
        }
        const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        let decimals = Number(own?.decimals || 18);
        try {
          const onchainDecimals = Number(await erc20.decimals().catch(() => decimals));
          if (Number.isFinite(onchainDecimals) && onchainDecimals >= 0) decimals = onchainDecimals;
        } catch {}
        const amountRaw = ethers.parseUnits(String(own?.amount || '0'), Number.isFinite(decimals) ? decimals : 18);
        const feeBps = BigInt(Math.max(0, Number(feeInfo.protocolFeeBps || 0)));
        let requiredRaw = amountRaw;
        if (feeInfo.feeOnSignerSide && myRole === 'signer') {
          requiredRaw = amountRaw + ((amountRaw * feeBps) / 10000n);
        } else if (!feeInfo.feeOnSignerSide && myRole === 'sender') {
          requiredRaw = amountRaw + ((amountRaw * feeBps) / 10000n);

          let royaltyRawForApproval = 0n;
          try {
            royaltyRawForApproval = BigInt(String(feeInfo.royaltyRaw || '0'));
          } catch {
            royaltyRawForApproval = 0n;
          }

          try {
            const signerSel = tradeState.signerSelection;
            const senderSel = tradeState.senderSelection;
            const signerKind = String(signerSel?.kind || KIND_ERC20).toLowerCase();
            const signerToken = String(signerSel?.token || '').split(':')[0];
            const signerTokenId = String(signerSel?.tokenId || '').trim();
            const senderTokenAddr = String(senderSel?.token || '').split(':')[0];
            const senderAmountHuman = String(senderSel?.amount || '0');

            if ((signerKind === KIND_ERC721 || signerKind === KIND_ERC1155) && /^0x[a-fA-F0-9]{40}$/.test(signerToken) && signerTokenId && /^0x[a-fA-F0-9]{40}$/.test(senderTokenAddr)) {
              const royaltyToken = new ethers.Contract(signerToken, ROYALTY_ABI, signer.provider);
              const supports = await royaltyToken.supportsInterface('0x2a55205a').catch(() => false);
              if (supports) {
                const senderErc20Read = new ethers.Contract(senderTokenAddr, ERC20_READ_ABI, signer.provider);
                const senderDec = Number(await senderErc20Read.decimals().catch(() => 18));
                const senderAmountRawForRoyalty = ethers.parseUnits(senderAmountHuman || '0', Number.isFinite(senderDec) ? senderDec : 18);
                const [, royaltyAmount] = await royaltyToken.royaltyInfo(BigInt(signerTokenId), senderAmountRawForRoyalty).catch(() => [ethers.ZeroAddress, 0n]);
                royaltyRawForApproval = BigInt(royaltyAmount || 0n);
              }
            }
          } catch {}

          if (royaltyRawForApproval > 0n) requiredRaw += royaltyRawForApproval;
        }
        const tx = await erc20.approve(swapContract, requiredRaw);
        debugLog('approve:erc20:submitted', { txHash: tx?.hash || '', requiredRaw: requiredRaw.toString() });
        await tx.wait();
        debugLog('approve:erc20:mined', { txHash: tx?.hash || '' });
        didSubmitApproval = true;
      } else if (ownKind === KIND_ERC721) {
        const tokenId = BigInt(String(own?.tokenId || '0'));
        const erc721 = new ethers.Contract(tokenAddress, ERC721_ABI, signer);
        const tx = await erc721.approve(swapContract, tokenId);
        debugLog('approve:erc721:submitted', { txHash: tx?.hash || '', tokenId: tokenId.toString() });
        await tx.wait();
        debugLog('approve:erc721:mined', { txHash: tx?.hash || '' });
        didSubmitApproval = true;
      } else if (ownKind === KIND_ERC1155) {
        const erc1155 = new ethers.Contract(tokenAddress, ERC1155_ABI, signer);
        const tx = await erc1155.setApprovalForAll(swapContract, true);
        debugLog('approve:erc1155:submitted', { txHash: tx?.hash || '' });
        await tx.wait();
        debugLog('approve:erc1155:mined', { txHash: tx?.hash || '' });
        didSubmitApproval = true;
      } else {
        setStatus('unsupported token kind for approval');
        return;
      }

      if (!didSubmitApproval) {
        setStatus('approval not submitted');
        return;
      }

      const localHash = mySelectionHash;
      const nextApproved = { ...approved, [myRole]: true };
      const nextHashes = { ...approvedHash, [myRole]: localHash };
      approvedRef.current = nextApproved;
      approvedHashRef.current = nextHashes;
      setApproved(nextApproved);
      setApprovedHash(nextHashes);
      setPeerSnapshotAtApprove(peerSelectionHash);

      ch.send({
        type: 'broadcast',
        event: 'room_approve',
        payload: {
          roomId: liveRoomId,
          role: myRole,
          decision: 'approve',
          selectionHash: localHash,
          sessionId: identity.sessionId,
          playerId: identity.playerId,
          ts: Date.now(),
        },
      });

      if (nextApproved.signer && nextApproved.sender) {
        setLivePhase('await_signer');
      }
    } catch (e) {
      setStatus(`approval failed: ${shortErr(e?.message || 'unknown')}`);
    } finally {
      setApprovalBusy(false);
    }
  };

  const onUseMax = () => {
    const own = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
    const maxAmt = String(own?.balance || '').trim();
    if (!maxAmt) return;
    onChangeOwn('amount', maxAmt);
    setStatus('set amount to max balance');
  };

  const onModalWrapEth = async () => {
    const row = customTokenPreview;
    if (!row) return;
    const tokenAddr = String(row?.token || '').split(':')[0];
    const isEthLike = isEthSentinelAddr(tokenAddr) || String(row?.symbol || '').toUpperCase() === 'ETH';
    if (!isEthLike) return;

    const raw = String(customTokenAmount || '').trim();
    if (!raw || !/^\d*\.?\d+$/.test(raw) || Number(raw) <= 0) {
      setCustomTokenError('enter valid amount');
      return;
    }
    if (Number(raw) > Number(row?.balance || 0)) {
      setCustomTokenError('amount exceeds your balance');
      return;
    }

    try {
      setIsWrapping(true);
      setCustomTokenError('');
      const { signer } = await getPreferredSigner(identity.playerId);
      const weth = new ethers.Contract(BASE_WETH, WETH_ABI, signer);
      const value = ethers.parseUnits(raw, 18);
      const tx = await weth.deposit({ value });
      await tx.wait();
      setCustomTokenPreview((prev) => prev ? ({
        ...prev,
        token: BASE_WETH,
        symbol: 'WETH',
        imgUrl: '/weth-icon.png',
        kind: KIND_ERC20,
        tokenId: '',
        decimals: '18',
      }) : prev);
      setStatus('wrapped ETH to WETH');
    } catch (e) {
      setCustomTokenError(`wrap failed: ${shortErr(e?.message || 'unknown')}`);
    } finally {
      setIsWrapping(false);
    }
  };

  const onSignerSign = async () => {
    setStatus('');
    debugLog('sign:start', { myRole, bothApproved });
    if (myRole !== 'signer') return;
    if (!bothApproved) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      const signerWallet = String(identity.playerId || '').trim();
      const senderWallet = String(otherPeer?.playerId || peerWalletFallback || '').trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(signerWallet) || !/^0x[a-fA-F0-9]{40}$/.test(senderWallet)) {
        debugLog('sign:wallet_missing', { signerWallet, senderWallet, peerWalletFallback, otherPeer });
        setStatus('wallet identities missing for live sign');
        return;
      }

      const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
      const isSwapErc20 = IS_SWAP_ERC20(swapContract);
      const readProvider = new ethers.JsonRpcProvider(BASE_RPCS[0]);
      const swap = new ethers.Contract(swapContract, isSwapErc20 ? SWAP_ERC20_ABI : SWAP_ABI, readProvider);
      const protocolFee = await swap.protocolFee();
      debugLog('sign:context', { swapContract, protocolFee: protocolFee.toString(), isSwapErc20 });

      const signerToken = String(tradeState.signerSelection?.token || '').split(':')[0];
      const senderToken = String(tradeState.senderSelection?.token || '').split(':')[0];
      const signerKind = String(tradeState.signerSelection?.kind || KIND_ERC20);
      const senderKind = String(tradeState.senderSelection?.kind || KIND_ERC20);

      const signerIsErc20 = String(signerKind).toLowerCase() === KIND_ERC20;
      const senderIsErc20 = String(senderKind).toLowerCase() === KIND_ERC20;

      let signerDecimals = Number(tradeState.signerSelection?.decimals || 18);
      let senderDecimals = Number(tradeState.senderSelection?.decimals || 18);

      if (signerIsErc20 && /^0x[a-fA-F0-9]{40}$/.test(signerToken) && !isEthSentinelAddr(signerToken)) {
        try {
          const signerErc20Read = new ethers.Contract(signerToken, ERC20_READ_ABI, readProvider);
          const onchainSignerDecimals = Number(await signerErc20Read.decimals().catch(() => signerDecimals));
          if (Number.isFinite(onchainSignerDecimals) && onchainSignerDecimals >= 0) signerDecimals = onchainSignerDecimals;
        } catch {}
      }

      if (senderIsErc20 && /^0x[a-fA-F0-9]{40}$/.test(senderToken) && !isEthSentinelAddr(senderToken)) {
        try {
          const senderErc20Read = new ethers.Contract(senderToken, ERC20_READ_ABI, readProvider);
          const onchainSenderDecimals = Number(await senderErc20Read.decimals().catch(() => senderDecimals));
          if (Number.isFinite(onchainSenderDecimals) && onchainSenderDecimals >= 0) senderDecimals = onchainSenderDecimals;
        } catch {}
      }

      const signerAmount = (String(tradeState.signerSelection?.kind || '').toLowerCase() === KIND_ERC721)
        ? '0'
        : ethers.parseUnits(String(tradeState.signerSelection?.amount || '0'), Number.isFinite(signerDecimals) ? signerDecimals : 18).toString();
      const senderAmount = (String(tradeState.senderSelection?.kind || '').toLowerCase() === KIND_ERC721)
        ? '0'
        : ethers.parseUnits(String(tradeState.senderSelection?.amount || '0'), Number.isFinite(senderDecimals) ? senderDecimals : 18).toString();

      const nonce = (BigInt(Math.floor(Date.now() / 1000)) * 1000000n + BigInt(Math.floor(Math.random() * 1000000))).toString();
      const expirySec = Math.floor(Date.now() / 1000) + 5 * 60;

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

      const { signer: ws } = await getPreferredSigner(identity.playerId);
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
        roomId: liveRoomId,
        byRole: 'signer',
        byName: localFname || identity.playerId,
        playerId: identity.playerId,
        expiresAt,
        signedOrder,
      };

      setSignedOrderState({ byRole: 'signer', byName: localFname || identity.playerId, expiresAt, payload: signedOrder });
      setLivePhase('await_sender');
      debugLog('sign:success', { nonce, expirySec, expiresAt, senderWallet, signerWallet });
      ch.send({ type: 'broadcast', event: 'room_signed_order', payload });
    } catch (e) {
      setStatus(`sign failed: ${shortErr(e?.message || 'unknown')}`);
    }
  };

  const onSenderSwap = async () => {
    setStatus('');
    debugLog('swap:start', { myRole, hasSignedOrder: Boolean(signedOrderState?.payload) });
    if (myRole !== 'sender') return;
    if (!signedOrderState?.payload) return;

    const ch = channelRef.current;
    if (!ch) return;

    try {
      setLivePhase('swapping');
      ch.send({ type: 'broadcast', event: 'room_swapping', payload: { roomId: liveRoomId, playerId: identity.playerId, ts: Date.now() } });

      const o = signedOrderState.payload;
      const isSwapErc20 = IS_SWAP_ERC20(o.swapContract);
      const { signer: ws } = await getPreferredSigner(identity.playerId);
      const swap = new ethers.Contract(o.swapContract, isSwapErc20 ? SWAP_ERC20_ABI : SWAP_ABI, ws);
      const senderKindNow = String(o.senderKind || KIND_ERC20).toLowerCase();

      let tx;
      debugLog('swap:context', { isSwapErc20, swapContract: o.swapContract, nonce: o.nonce, expiry: o.expiry });

      if (senderKindNow === KIND_ERC20 && String(o.senderToken || '').toLowerCase() !== ethers.ZeroAddress.toLowerCase()) {
        try {
          const erc20 = new ethers.Contract(o.senderToken, ERC20_READ_ABI, ws);
          const [bal, allowance] = await Promise.all([
            erc20.balanceOf(identity.playerId).catch(() => 0n),
            erc20.allowance(identity.playerId, o.swapContract).catch(() => 0n),
          ]);
          const needed = BigInt(o.senderAmount || '0');
          if (BigInt(bal || 0n) < needed) {
            throw new Error(`insufficient sender balance: have ${String(bal)} need ${needed.toString()}`);
          }
          if (BigInt(allowance || 0n) < needed) {
            throw new Error(`insufficient sender allowance: have ${String(allowance)} need ${needed.toString()}`);
          }
        } catch (pre) {
          setStatus(`swap precheck failed: ${shortErr(pre?.message || 'sender token balance/allowance')}`);
          setLivePhase('await_sender');
          return;
        }
      }

      const signerKindNow = String(o.signerKind || KIND_ERC20).toLowerCase();
      if (signerKindNow === KIND_ERC20 && String(o.signerToken || '').toLowerCase() !== ethers.ZeroAddress.toLowerCase()) {
        try {
          const erc20Signer = new ethers.Contract(o.signerToken, ERC20_READ_ABI, ws);
          const [signerBal, signerAllowance] = await Promise.all([
            erc20Signer.balanceOf(o.signerWallet).catch(() => 0n),
            erc20Signer.allowance(o.signerWallet, o.swapContract).catch(() => 0n),
          ]);
          const signerNeeded = BigInt(o.signerAmount || '0');
          if (BigInt(signerBal || 0n) < signerNeeded) {
            throw new Error(`signer insufficient balance: have ${String(signerBal)} need ${signerNeeded.toString()}`);
          }
          if (BigInt(signerAllowance || 0n) < signerNeeded) {
            throw new Error(`signer insufficient allowance: have ${String(signerAllowance)} need ${signerNeeded.toString()}`);
          }
        } catch (pre) {
          setStatus(`swap precheck failed: ${shortErr(pre?.message || 'signer token balance/allowance')}`);
          setLivePhase('await_sender');
          return;
        }
      }
      if (isSwapErc20) {
        try {
          await swap.swap.staticCall(
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
        } catch (pre) {
          setStatus(`swap simulation failed: ${shortErr(pre?.message || 'reverted')}`);
          setLivePhase('await_sender');
          return;
        }
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
        debugLog('swap:submitted:erc20', { txHash: tx?.hash || '' });
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

        let maxRoyaltyForCall = 0n;
        try {
          const signerKindNow = String(o.signerKind || KIND_ERC20).toLowerCase();
          const signerIsNft = signerKindNow === KIND_ERC721 || signerKindNow === KIND_ERC1155;
          if (signerIsNft) {
            const royaltyToken = new ethers.Contract(o.signerToken, ROYALTY_ABI, ws.provider);
            const supports = await royaltyToken.supportsInterface('0x2a55205a').catch(() => false);
            if (supports) {
              const [, royaltyAmount] = await royaltyToken
                .royaltyInfo(BigInt(o.signerId || 0), BigInt(o.senderAmount || 0))
                .catch(() => [ethers.ZeroAddress, 0n]);
              maxRoyaltyForCall = BigInt(royaltyAmount || 0n);
            }
          }
        } catch {
          maxRoyaltyForCall = 0n;
        }

        try {
          await swap.swap.staticCall(identity.playerId, maxRoyaltyForCall, orderForCall);
        } catch (pre) {
          setStatus(`swap simulation failed: ${shortErr(pre?.message || 'reverted')}`);
          setLivePhase('await_sender');
          return;
        }
        tx = await swap.swap(identity.playerId, maxRoyaltyForCall, orderForCall);
        debugLog('swap:submitted:generic', { txHash: tx?.hash || '', maxRoyaltyForCall: maxRoyaltyForCall.toString() });
      }

      const rec = await tx.wait();
      debugLog('swap:mined', { txHash: String(rec?.hash || tx?.hash || '') });
      const txHash = String(rec?.hash || tx?.hash || '');
      setSwapTxHash(txHash);
      setLivePhase('success');
      ch.send({ type: 'broadcast', event: 'room_swap_success', payload: { roomId: liveRoomId, txHash, playerId: identity.playerId, ts: Date.now() } });
    } catch (e) {
      const known = decodeKnownRevert(e);
      if (known) setStatus(`swap failed: ${known} ${shortErr(e?.message || '')}`);
      else setStatus(`swap failed: ${shortErr(e?.message || 'unknown')}`);
      setLivePhase('await_sender');
    }
  };

  const onAcknowledgeChangedOffer = () => {
    setStatus('');
    setPeerSnapshotAtApprove(peerSelectionHash);
  };

  const onDecline = async () => {
    setStatus('');
    const ch = channelRef.current;
    if (!ch) return;

    let revokeOk = true;
    try {
      if (localApproved) {
        const { signer } = await getPreferredSigner(identity.playerId);
        const swapContract = resolveSwapContractForSelections(tradeState.signerSelection, tradeState.senderSelection);
        const own = myRole === 'signer' ? tradeState.signerSelection : tradeState.senderSelection;
        const ownKind = normalizeKind(own?.kind || KIND_ERC20);
        const tokenAddress = String(own?.token || '').split(':')[0];

        if (ownKind === KIND_ERC20) {
          if (isEthSentinelAddr(tokenAddress)) {
            revokeOk = true;
          } else {
            const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
            const tx = await erc20.approve(swapContract, 0n);
            await tx.wait();
          }
        } else if (ownKind === KIND_ERC1155) {
          const erc1155 = new ethers.Contract(tokenAddress, ERC1155_ABI, signer);
          const tx = await erc1155.setApprovalForAll(swapContract, false);
          await tx.wait();
        }
      }
    } catch (e) {
      revokeOk = false;
      setStatus(`decline revoke failed: ${shortErr(e?.message || 'unknown')}`);
      debugLog('decline:revoke_failed', { myRole, error: e?.message || 'unknown' });
    }

    if (!revokeOk) return;

    if (!localApproved) {
      ch.send({
        type: 'broadcast',
        event: 'room_close',
        payload: {
          roomId: liveRoomId,
          byRole: myRole,
          reason: 'decline',
          sessionId: identity.sessionId,
          playerId: identity.playerId,
          ts: Date.now(),
        },
      });
      router.push(`/${initialChannel || 'worlds'}`);
      return;
    }

    setApproved((prev) => ({ ...prev, [myRole]: false }));
    setApprovedHash((prev) => ({ ...prev, [myRole]: '' }));
    setPeerSnapshotAtApprove('');
    ch.send({
      type: 'broadcast',
      event: 'room_approve',
      payload: {
        roomId: liveRoomId,
        role: myRole,
        decision: 'decline',
        selectionHash: '',
        sessionId: identity.sessionId,
        playerId: identity.playerId,
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
          onLockedTileClick={() => {}}
          feeText={topFeeText}
          footer={topFooter}
          footerTone={topInsufficient || /not accepted/i.test(topFooter) ? 'bad' : 'ok'}
          insufficient={topInsufficient}
        />

        <div className="rs-center" style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
          {!channelSubscribed ? (
            <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
                <div className="rs-loading-label">joining room...</div>
              </div>
            </div>
          ) : !bothPartiesJoined ? (
            <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
                <div className="rs-loading-label">{`waiting for ${otherDisplay} to join`}</div>
              </div>
            </div>
          ) : (!bothDone || livePhase === 'negotiate') ? (
            bothDone ? (
              (localApproved && peerChangedAfterMyApprove) ? (
                <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
                  <button className="rs-btn rs-btn-positive" onClick={onAcknowledgeChangedOffer}>Approve</button>
                  <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
                </div>
              ) : (myRole === 'signer' && localApproved && !bothApproved) ? (
                <div className="rs-loading-wrap" style={{ width: 'min(420px, 92vw)' }}>
                  <div className="rs-loading-track">
                    <div className="rs-loading-fill" />
                    <div className="rs-loading-label">{`waiting for ${otherDisplay}`}</div>
                  </div>
                </div>
              ) : (
                <div className="rs-btn-stack" style={{ width: 'min(360px, 92vw)' }}>
                  <button
                    className="rs-btn rs-btn-positive"
                    onClick={myInsufficient ? onUseMax : onApprove}
                    disabled={approvalBusy || (!myInsufficient && (signerInsufficient || senderInsufficient)) || (myInsufficient && !String(mySelection?.balance || '').trim())}
                  >
                    {approvalBusy ? 'Approving...' : (myInsufficient ? 'Use max' : 'Approve')}
                  </button>
                  <button className="rs-btn rs-btn-error" onClick={onDecline}>Decline</button>
                </div>
              )
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
            <div className="rs-order-success" style={{ width: 'min(420px, 92vw)', margin: '0 auto' }}>
              <div>Swap success</div>
              <div style={{ fontSize: 14 }}>{`Returning to world in ${Math.max(0, Math.ceil((successCloseAt - nowMs) / 1000))}s`}</div>
              {swapTxHash ? <a href={`https://basescan.org/tx/${swapTxHash}`} target="_blank" rel="noreferrer">View on BaseScan</a> : null}
            </div>
          )}
          <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.75, maxWidth: 'min(520px, 92vw)', overflowWrap: 'anywhere' }}>{status}</div>
          {feeLoading ? (
            <div className="rs-loading-wrap" style={{ width: 'min(320px, 86vw)' }}>
              <div className="rs-loading-track">
                <div className="rs-loading-fill" />
                <div className="rs-loading-label">checking protocol fee</div>
              </div>
            </div>
          ) : null}
        </div>

        <OfferPanel
          title={bottomTitle}
          selection={bottomDisplaySelection}
          editable={bottomEditable}
          onChange={onChangeOwn}
          onOpenInventory={openInventory}
          onLockedTileClick={() => {}}
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
                  {showInventoryGrid ? (
                    <div className="rs-inv-toggle-row">
                      <button className={`rs-inv-toggle ${inventoryView === 'tokens' ? 'active' : ''}`} onClick={() => { setInventoryView('tokens'); setInventoryNftSubView('collections'); setSelectedNftCollection(null); setCustomTokenStep('none'); }}>Tokens</button>
                      <button className={`rs-inv-toggle ${inventoryView === 'nfts' ? 'active' : ''}`} onClick={() => { setInventoryView('nfts'); setInventoryNftSubView('collections'); setSelectedNftCollection(null); setCustomTokenStep('none'); }}>NFT</button>
                    </div>
                  ) : null}

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

                      {customTokenError ? <div className="rs-inline-error" style={{ marginTop: 8 }}>{customTokenError}</div> : null}
                      <div className="rs-btn-stack" style={{ marginTop: 10 }}>
                        <button className="rs-btn rs-btn-positive" onClick={applyCustomToken}>Confirm</button>
                      </div>
                    </div>
                  ) : null}

                  {customTokenStep === 'amount' ? (
                    <div className="rs-token-grid-wrap" style={{ marginBottom: 10 }}>
                      <button className="rs-modal-back" onClick={() => {
                        const back = amountStepBack;
                        if (back === 'custom') setCustomTokenStep('custom');
                        else if (back === 'custom-id') setCustomTokenStep('custom-id');
                        else setCustomTokenStep('none');
                        setCustomTokenAmount('');
                        setCustomTokenError('');
                        if (back !== 'custom' && back !== 'custom-id') setCustomTokenPreview(null);
                      }}>← Back</button>
                      <div className="rs-panel-title" style={{ marginTop: 0 }}>Enter Amount</div>
                      {amountStepRow ? (
                        <div className="rs-token-center" style={{ marginTop: 6, marginBottom: 6 }}>
                          <div className="rs-modal-wrap-row">
                            <TokenTile
                              amountNode={renderAmountColored(amountStepDisplay)}
                              amountClassName="rs-token-cell-amount"
                              symbol={amountStepRow?.symbol || 'TOKEN'}
                              symbolClassName="rs-token-cell-symbol"
                              imgUrl={amountStepRow?.imgUrl}
                              tokenAddress={String(amountStepRow?.token || '').split(':')[0]}
                              tokenKind={normalizeKind(amountStepRow?.kind || KIND_ERC20)}
                              tokenId={amountStepRow?.tokenId || ''}
                              tokenIdClassName="rs-token-cell-tokenid"
                              wrapClassName="rs-token-cell-wrap"
                              iconClassName="rs-token-cell-icon"
                              fallbackClassName="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback"
                              insufficient={amountStepOver}
                              disableLink
                            />

                            {amountStepIsEthLike ? (
                              <>
                                <button type="button" className="rs-wrap-arrow" onClick={onModalWrapEth} disabled={isWrapping}>➡️</button>
                                <div className="rs-token-wrap rs-token-cell-wrap">
                                  <div className="rs-amount-overlay rs-token-cell-amount">{renderAmountColored(amountStepDisplay)}</div>
                                  <img
                                    src="/weth-icon.png"
                                    alt="WETH"
                                    className="rs-token-cell-icon"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      const fb = e.currentTarget.nextElementSibling;
                                      if (fb) fb.style.display = 'flex';
                                    }}
                                  />
                                  <div className="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback" style={{ display: 'none' }}>WE</div>
                                  <div className="rs-symbol-overlay rs-token-cell-symbol">WETH</div>
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <div style={{ color: '#fff', fontSize: 12, textAlign: 'center', opacity: 0.85 }}>fees calculated after selection</div>
                      <input
                        className="rs-amount-input"
                        style={{ width: '100%', margin: '0 0 8px 0', fontSize: 16, textAlign: 'left' }}
                        value={customTokenAmount}
                        inputMode={amountStepInputMode}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          if (amountStepKind === KIND_ERC1155) {
                            if (v === '' || /^\d+$/.test(v)) setCustomTokenAmount(v);
                          } else if (amountStepKind !== KIND_ERC721) {
                            if (v === '' || /^\d*\.?\d*$/.test(v)) setCustomTokenAmount(v);
                          }
                          if (customTokenError) setCustomTokenError('');
                        }}
                        placeholder="amount"
                        disabled={amountStepKind === KIND_ERC721}
                      />
                      {customTokenError ? <div className="rs-inline-error" style={{ marginTop: 8 }}>{customTokenError}</div> : null}
                      {amountStepOver ? <p className="rs-footer-bad">Insufficient balance</p> : null}
                      <div className="rs-btn-stack" style={{ marginTop: 10 }}>
                        <button
                          className="rs-btn rs-btn-positive"
                          disabled={isWrapping}
                          onClick={async () => {
                            const row = amountStepRow;
                            if (!row) {
                              setCustomTokenError('select token first');
                              return;
                            }
                            if (!(amountStepOwnedBal > 0)) {
                              setCustomTokenError('balance unavailable for selected token');
                              return;
                            }
                            if (amountStepOver) {
                              setCustomTokenAmount(String(amountStepMaxInput || row?.balance || ''));
                              setCustomTokenError('');
                              return;
                            }
                            const raw = amountStepRaw;
                            if (amountStepKind === KIND_ERC1155) {
                              if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) {
                                setCustomTokenError('enter valid integer amount');
                                return;
                              }
                            } else if (amountStepKind !== KIND_ERC721) {
                              if (!raw || !/^\d*\.?\d+$/.test(raw) || Number(raw) <= 0) {
                                setCustomTokenError('enter valid amount');
                                return;
                              }
                            }

                            if (amountStepIsEthLike) {
                              await onModalWrapEth();
                              return;
                            }

                            pickInventoryToken({
                              token: row.token,
                              amount: raw,
                              imgUrl: row.imgUrl || '',
                              symbol: row.symbol || 'TOKEN',
                              tokenId: String(row.tokenId || ''),
                              name: row.name || row.symbol || 'TOKEN',
                              kind: normalizeKind(row.kind || KIND_ERC20),
                              balance: String(row.balance || ''),
                              decimals: String(row.decimals || '18'),
                            });
                          }}
                        >
                          {amountStepOver
                            ? 'Use max'
                            : (amountStepIsEthLike ? (isWrapping ? 'Wrapping...' : 'Wrap') : 'Confirm')}
                        </button>
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


                  {showInventoryGrid && inventoryView === 'nfts' && inventoryNftSubView === 'items' ? (
                    <button className="rs-modal-back" onClick={() => { setInventoryNftSubView('collections'); setSelectedNftCollection(null); }}>← Back</button>
                  ) : null}
                  {showInventoryGrid ? (
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
                            onClick={() => {
                              if (isToken) {
                                setCustomTokenPreview({
                                  token,
                                  amount,
                                  imgUrl,
                                  symbol,
                                  tokenId,
                                  name: item?.name || symbol,
                                  kind: normalizeKind(item?.kind || KIND_ERC20),
                                  balance: amount,
                                  decimals: String(item?.decimals || '18'),
                                });
                                setCustomTokenAmount('');
                                setCustomTokenError('');
                                setAmountStepBack('grid');
                                setCustomTokenStep('amount');
                                return;
                              }
                              const nftKind = String(item?.kind || KIND_ERC721).toLowerCase();
                              const nftBalance = String(item?.balance || '1');
                              setCustomTokenPreview({
                                token,
                                amount: nftBalance,
                                imgUrl,
                                symbol,
                                tokenId,
                                name: item?.name || symbol,
                                kind: nftKind,
                                balance: nftBalance,
                                decimals: '0',
                              });
                              setCustomTokenAmount(nftKind === KIND_ERC721 ? '1' : '');
                              setCustomTokenError('');
                              setAmountStepBack('items');
                              setCustomTokenStep('amount');
                              return;
                            }}
                            title={isToken ? `${symbol} ${amount}` : `${item?.name || symbol} #${tokenId}`}
                          >
                            <TokenTile
                              amountNode={isToken
                                ? renderAmountColored(formatTokenAmount(amount || '0'))
                                : (String(item?.kind || '').toLowerCase() === KIND_ERC721
                                  ? formatTokenIdLabel(tokenId || '0')
                                  : (String(item?.kind || '').toLowerCase() === KIND_ERC1155
                                    ? renderAmountColored(formatIntegerAmount(amount || '0'))
                                    : null))}
                              amountClassName="rs-token-cell-amount"
                              symbol={symbol}
                              symbolClassName="rs-token-cell-symbol"
                              imgUrl={imgUrl}
                              tokenAddress={String(token).split(':')[0]}
                              tokenKind={normalizeKind(item?.kind || (isToken ? KIND_ERC20 : KIND_ERC721))}
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
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
