'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import { useAccount, useConnect, usePublicClient, useSendTransaction, useSignTypedData } from 'wagmi';
import { decodeCompressedOrder, encodeCompressedOrder } from '../lib/orders';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender,uint256 amount) returns (bool)',
];
const ERC20_IFACE = new ethers.Interface(ERC20_ABI);
const ERC721_ABI = [
  'function symbol() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];
const ERC1155_ABI = [
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address account,uint256 id) view returns (uint256)',
  'function exists(uint256 id) view returns (bool)',
  'function totalSupply(uint256 id) view returns (uint256)',
];
const NFT_LABEL_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];
const NFT_APPROVAL_ABI = [
  'function setApprovalForAll(address operator,bool approved)',
];
const NFT_APPROVAL_IFACE = new ethers.Interface(NFT_APPROVAL_ABI);
const WETH_IFACE = new ethers.Interface(['function deposit() payable']);

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function nonceUsed(address signer,uint256 nonce) view returns (bool)',
  'function cancel(uint256[] nonces) external',
  'function swap(address recipient,uint256 maxRoyalty,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) external',
];
const SWAP_IFACE = new ethers.Interface(SWAP_ABI);
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

// removed duplicate abi block
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const BASE_SWAP_CONTRACT = '0x8a9969ed0A9bb3cDA7521DDaA614aE86e72e0A57';
const BASE_SWAP_CONTRACT_ERC721 = '0x2aa29F096257bc6B253bfA9F6404B20Ae0ef9C4d';
const BASE_SWAP_CONTRACT_ERC1155 = '0xD19783B48b11AFE1544b001c6d807A513e5A95cf';
const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';
const TOKEN_CATALOG = [
  { token: BASE_ETH, symbol: 'ETH', decimals: 18, native: true, iconArt: '/eth-icon.png' },
  { token: BASE_USDC, symbol: 'USDC', decimals: 6 },
  { token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', symbol: 'USDT', decimals: 6 },
  { token: BASE_WETH, symbol: 'WETH', decimals: 18, iconArt: '/weth-icon.png' },
  { token: '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe', symbol: 'HIGHER', decimals: 18, iconArt: '/higher-icon.png' },
  { token: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', symbol: 'DEGEN', decimals: 18 },
];
const FEE_TIERS = [500, 3000, 10000];
const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
];

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
];

function short(a = '') {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '';
}

function fitName(v = '', max = 22) {
  if (!v) return '';
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function fitOfferName(v = '', max = 15) {
  if (!v) return '@counterparty';
  const clean = v.startsWith('@') ? v : `@${v}`;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function formatTokenIdLabel(tokenId = '', maxDigits = 5) {
  const raw = String(tokenId || '').replace(/^#/, '');
  if (!raw) return '#0';
  if (raw.length <= maxDigits) return `#${raw}`;
  return `#${raw.slice(0, maxDigits)}…`;
}

function normalizeTokenIdInput(v = '') {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) {
    try { return BigInt(s).toString(); } catch { return null; }
  }
  if (/^\d+$/.test(s)) return s;
  return null;
}

function compactAmount(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  const trim = (s) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (abs >= 1_000_000_000) return `${trim((n / 1_000_000_000).toFixed(digits))}B`;
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(digits))}M`;
  if (abs >= 1_000) return `${trim((n / 1_000).toFixed(digits))}k`;
  if (abs >= 1) return trim(n.toFixed(digits));
  return trim(n.toPrecision(3));
}

function offerExpiryInLabel(sec) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) return 'soon';
  if (n % (24 * 3600) === 0) {
    const d = n / (24 * 3600);
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (n % 3600 === 0) {
    const h = n / 3600;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (n % 60 === 0) {
    const m = n / 60;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  return `${n}s`;
}

function formatTokenAmountParts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { number: String(value), suffix: '' };
  const abs = Math.abs(n);
  const suffixes = ['', 'k', 'M', 'B', 'T', 'Q'];
  let tier = 0;

  while (tier < suffixes.length - 1 && abs >= Math.pow(1000, tier + 1)) tier += 1;

  let scaled = n / Math.pow(1000, tier);

  // Prefer 4-digit style on lower tier when possible, e.g. 1.234M -> 1234k
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

  // Prefer 4-digit style on lower tier when possible (e.g. 1.234M -> 1234k)
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

function tokenInitials(symbol = '??') {
  return String(symbol || '??').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??';
}

function canonAddr(addr = '') {
  try {
    return ethers.getAddress(String(addr || '').trim()).toLowerCase();
  } catch {
    return String(addr || '').trim().toLowerCase();
  }
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

async function detectTokenKind(tokenAddr, provider) {
  if (!tokenAddr || isEthSentinelAddr(tokenAddr)) return KIND_ERC20;
  try {
    const c = new ethers.Contract(tokenAddr, ['function supportsInterface(bytes4 interfaceId) view returns (bool)'], provider);
    const [is721, is1155] = await Promise.all([
      c.supportsInterface(KIND_ERC721).catch(() => false),
      c.supportsInterface(KIND_ERC1155).catch(() => false),
    ]);
    if (is1155) return KIND_ERC1155;
    if (is721) return KIND_ERC721;
  } catch {}
  return KIND_ERC20;
}

async function readNftContractLabel(tokenAddr, provider) {
  try {
    const c = new ethers.Contract(tokenAddr, NFT_LABEL_ABI, provider);
    const sym = await c.symbol().catch(() => '');
    if (String(sym || '').trim()) return String(sym).trim();
    const nm = await c.name().catch(() => '');
    if (String(nm || '').trim()) return String(nm).trim();
  } catch {}
  return 'NFT';
}

async function resolveSwapForSenderToken(senderToken, provider) {
  const kind = await detectTokenKind(senderToken, provider);
  if (kind === KIND_ERC721) return { kind, swapContract: BASE_SWAP_CONTRACT_ERC721 };
  if (kind === KIND_ERC1155) return { kind, swapContract: BASE_SWAP_CONTRACT_ERC1155 };
  return { kind: KIND_ERC20, swapContract: BASE_SWAP_CONTRACT };
}

async function detectCollectionNftKind(tokenAddr) {
  try {
    const p = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
    return await detectTokenKind(tokenAddr, p);
  } catch {
    return KIND_ERC721;
  }
}

function ipfsToHttp(u = '') {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${s.replace('ipfs://', '').replace(/^ipfs\//, '')}`;
  return s;
}

async function readNftImageFromTokenUri(tokenUri = '') {
  const uri = ipfsToHttp(tokenUri);
  if (!uri) return '';
  if (uri.startsWith('data:application/json')) {
    try {
      const b64 = uri.split(',')[1] || '';
      const raw = atob(b64);
      const j = JSON.parse(raw);
      return ipfsToHttp(j?.image || j?.image_url || '');
    } catch {
      return '';
    }
  }
  try {
    const r = await fetch(uri, { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    return ipfsToHttp(j?.image || j?.image_url || '');
  } catch {
    return '';
  }
}

async function hasValidErc1155Metadata(tokenUri = '', tokenId = '') {
  const normalized = String(tokenId || '').toLowerCase();
  const paddedHex = normalized ? BigInt(normalized).toString(16).padStart(64, '0') : '';
  const uri = ipfsToHttp(String(tokenUri || '').replaceAll('{id}', paddedHex || normalized));
  if (!uri) return false;

  if (uri.startsWith('data:application/json')) {
    try {
      const b64 = uri.split(',')[1] || '';
      const raw = atob(b64);
      const j = JSON.parse(raw);
      return Boolean(j && typeof j === 'object');
    } catch {
      return false;
    }
  }

  try {
    const r = await fetch(uri, { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j && typeof j === 'object');
  } catch {
    return false;
  }
}

function isStableToken(addr = '') {
  const a = canonAddr(addr);
  return a === BASE_USDC.toLowerCase();
}

function guessSymbol(addr = '') {
  const a = canonAddr(addr);
  if (a === BASE_ETH.toLowerCase()) return 'ETH';
  if (a === BASE_USDC.toLowerCase()) return 'USDC';
  if (a === BASE_WETH.toLowerCase()) return 'WETH';
  return '???';
}

function guessDecimals(addr = '') {
  const a = canonAddr(addr);
  if (a === BASE_USDC.toLowerCase()) return 6;
  return 18;
}

async function quoteUsdValue(readProvider, token, amountRaw, decimals) {
  try {
    if (isStableToken(token)) return Number(ethers.formatUnits(amountRaw, 6));

    const tokenInResolved = canonAddr(token) === canonAddr(BASE_ETH) ? BASE_WETH : token;
    const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, readProvider);
    const quoteSingle = async (tokenIn, tokenOut, amountIn) => {
      for (const fee of FEE_TIERS) {
        try {
          const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
            tokenIn,
            tokenOut,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0,
          });
          if (amountOut > 0n) return amountOut;
        } catch {
          // try next fee tier
        }
      }
      return null;
    };

    // direct token -> USDC
    const direct = await quoteSingle(tokenInResolved, BASE_USDC, amountRaw);
    if (direct != null) return Number(ethers.formatUnits(direct, 6));

    // fallback two-hop token -> WETH -> USDC for custom tokens without direct USDC pool
    if (canonAddr(tokenInResolved) !== canonAddr(BASE_WETH)) {
      const viaWeth = await quoteSingle(tokenInResolved, BASE_WETH, amountRaw);
      if (viaWeth != null) {
        const wethToUsdc = await quoteSingle(BASE_WETH, BASE_USDC, viaWeth);
        if (wethToUsdc != null) return Number(ethers.formatUnits(wethToUsdc, 6));
      }
    }

    return null;
  } catch {
    return null;
  }
}

function tokenIconUrl(chainId, token) {
  try {
    const checksum = ethers.getAddress(token);
    const localArt = catalogIconArt(checksum);
    if (localArt) return localArt;
    if (canonAddr(checksum) === canonAddr(BASE_ETH)) return ethIconUrl();
    if (Number(chainId) === 8453) {
      return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksum}/logo.png`;
    }
  } catch {}
  return '';
}

function ethIconUrl() {
  return '/eth-icon.png';
}

function catalogIconArt(token) {
  const t = tokenKey(token || '');
  const found = TOKEN_CATALOG.find((x) => tokenKey(x?.token || '') === t);
  return found?.iconArt || '';
}

function isEthLikeToken(option) {
  if (!option) return false;
  const sym = String(option.symbol || '').toUpperCase();
  return sym === 'ETH' || isEthSentinelAddr(option.token || '');
}

async function readPairBatch({ signerToken, signerOwner, senderToken, senderOwner, spender }) {
  try {
    const qs = new URLSearchParams({
      signerToken: canonAddr(signerToken),
      signerOwner: canonAddr(signerOwner),
      senderToken: canonAddr(senderToken),
      senderOwner: canonAddr(senderOwner),
      spender: canonAddr(spender),
      t: String(Date.now()),
    });
    const r = await fetch(`/api/token-batch?${qs.toString()}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok || !d?.ok) throw new Error(d?.error || 'pair batch failed');

    const toPart = (part, token) => ({
      rpc: d.rpc || 'none',
      mode: d.mode || 'unknown',
      symbol: part?.symbol || guessSymbol(token),
      decimals: Number(part?.decimals ?? guessDecimals(token)),
      balance: BigInt(part?.balance || '0'),
      allowance: BigInt(part?.allowance || '0'),
      raw: part?.raw || [],
      debug: { ...(d.debug || {}), version: d.version || 'n/a' },
    });

    return {
      signer: toPart(d.signer, signerToken),
      sender: toPart(d.sender, senderToken),
    };
  } catch (e) {
    return {
      signer: { rpc: 'none', mode: 'fallback', symbol: guessSymbol(signerToken), decimals: guessDecimals(signerToken), balance: 0n, allowance: 0n, raw: [], debug: { error: e?.message || 'readPairBatch failed' } },
      sender: { rpc: 'none', mode: 'fallback', symbol: guessSymbol(senderToken), decimals: guessDecimals(senderToken), balance: 0n, allowance: 0n, raw: [], debug: { error: e?.message || 'readPairBatch failed' } },
    };
  }
}

function normalizeAddr(a = '') {
  return tokenKey(a);
}

async function mapInChunks(items, chunkSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const rows = await Promise.all(chunk.map(fn));
    out.push(...rows);
  }
  return out;
}

async function readKnownTokenBalance(tokenAddr, wallet, native = false) {
  for (const rpc of BASE_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
      if (native || canonAddr(tokenAddr) === canonAddr(BASE_ETH)) {
        const bal = await p.getBalance(wallet);
        return { ok: true, rpc, balance: bal };
      }
      const c = new ethers.Contract(tokenAddr, ERC20_ABI, p);
      const bal = await c.balanceOf(wallet);
      return { ok: true, rpc, balance: bal };
    } catch {
      // try next RPC
    }
  }
  return { ok: false, rpc: 'none', balance: 0n };
}

async function readTokenForWallet(tokenAddr, wallet) {
  if (canonAddr(tokenAddr) === canonAddr(BASE_ETH)) {
    for (const rpc of BASE_RPCS) {
      try {
        const p = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
        const bal = await p.getBalance(wallet);
        return { ok: true, rpc, balance: bal, decimals: 18, symbol: 'ETH' };
      } catch {}
    }
    return { ok: false, rpc: 'none', balance: 0n, decimals: 18, symbol: 'ETH' };
  }

  for (const rpc of BASE_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
      const c = new ethers.Contract(tokenAddr, ERC20_ABI, p);
      const [bal, dec, sym] = await Promise.all([
        c.balanceOf(wallet),
        c.decimals().catch(() => guessDecimals(tokenAddr)),
        c.symbol().catch(() => guessSymbol(tokenAddr)),
      ]);
      return { ok: true, rpc, balance: bal, decimals: Number(dec), symbol: sym || guessSymbol(tokenAddr) };
    } catch (e) {
      // try next RPC
    }
  }
  return { ok: false, rpc: 'none', balance: 0n, decimals: guessDecimals(tokenAddr), symbol: guessSymbol(tokenAddr) };
}

async function waitForTxConfirmation({ publicClient, txHash, timeoutMs = 180000 }) {
  if (!publicClient) throw new Error('public client unavailable');
  return publicClient.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs, confirmations: 1 });
}

function errText(e) {
  return e?.shortMessage || e?.reason || e?.message || 'unknown error';
}

export default function BazaarMvpClient({ initialCompressed = '', initialCastHash = '' }) {
  const router = useRouter();
  const [compressed, setCompressed] = useState(initialCompressed);
  const [orderData, setOrderData] = useState(() => {
    if (!initialCompressed) return null;
    try {
      return decodeCompressedOrder(initialCompressed);
    } catch {
      return null;
    }
  });
  const [provider, setProvider] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [address, setAddress] = useState('');
  const { address: wagmiAddress, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState('ready');
  const [lastSwapTxHash, setLastSwapTxHash] = useState('');
  const [swapThanksSent, setSwapThanksSent] = useState(false);
  const [swapThanksBusy, setSwapThanksBusy] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [checks, setChecks] = useState(null);
  const [counterpartyName, setCounterpartyName] = useState('Counterparty');
  const [counterpartyHandle, setCounterpartyHandle] = useState('');
  const [counterpartyProfileUrl, setCounterpartyProfileUrl] = useState('');
  const [counterpartyPfpUrl, setCounterpartyPfpUrl] = useState('');
  const [senderPartyName, setSenderPartyName] = useState('Anybody');
  const [senderPartyProfileUrl, setSenderPartyProfileUrl] = useState('');
  const [userPfpUrl, setUserPfpUrl] = useState('');
  const [autoConnectTried, setAutoConnectTried] = useState(false);
  const [isWrapping, setIsWrapping] = useState(false);
  const [makerMode, setMakerMode] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenModalLoading, setTokenModalLoading] = useState(false);
  const [tokenModalStep, setTokenModalStep] = useState('grid');
  const [tokenModalPanel, setTokenModalPanel] = useState('sender');
  const [tokenModalWallet, setTokenModalWallet] = useState('');
  const [customTokenInput, setCustomTokenInput] = useState('');
  const [customTokenError, setCustomTokenError] = useState('');
  const [customTokenNftContract, setCustomTokenNftContract] = useState('');
  const [customTokenNftKind, setCustomTokenNftKind] = useState('');
  const [customTokenNftSymbol, setCustomTokenNftSymbol] = useState('');
  const [customTokenAmountInput, setCustomTokenAmountInput] = useState('');
  const [customTokenPreview, setCustomTokenPreview] = useState(null);
  const [customTokenResolvedOption, setCustomTokenResolvedOption] = useState(null);
  const [tokenOptions, setTokenOptions] = useState([]);
  const [tokenNftCollections, setTokenNftCollections] = useState([]);
  const [tokenModalView, setTokenModalView] = useState('tokens');
  const [tokenNftSubView, setTokenNftSubView] = useState('collections');
  const [selectedNftCollection, setSelectedNftCollection] = useState(null);
  const [pendingToken, setPendingToken] = useState(null);
  const [pendingAmount, setPendingAmount] = useState('');
  const [tokenAmountError, setTokenAmountError] = useState('');
  const [makerOverrides, setMakerOverrides] = useState({});
  const [makerProtocolFeeBps, setMakerProtocolFeeBps] = useState(50);
  const [counterpartyModalOpen, setCounterpartyModalOpen] = useState(false);
  const [counterpartyInput, setCounterpartyInput] = useState('');
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [counterpartyError, setCounterpartyError] = useState('');
  const [counterpartyResults, setCounterpartyResults] = useState([]);
  const [makerExpirySec, setMakerExpirySec] = useState(24 * 60 * 60);
  const [makerStep, setMakerStep] = useState('approve');
  const [makerCompressedOrder, setMakerCompressedOrder] = useState('');
  const [makerCastText, setMakerCastText] = useState('');
  const [makerOfferCastHash, setMakerOfferCastHash] = useState('');
  const [makerEmbedPosted, setMakerEmbedPosted] = useState(false);

  const dbg = (msg) => {
    setDebugLog((prev) => [...prev.slice(-30), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  };

  const showTopbarClose = Boolean(initialCompressed || initialCastHash);

  function clearCounterpartyToPublic() {
    setMakerOverrides((prev) => ({ ...prev, counterpartyWallet: ethers.ZeroAddress }));
    setCounterpartyName('Anybody');
    setCounterpartyHandle('');
    setCounterpartyProfileUrl('');
    setCounterpartyPfpUrl('');
    setCounterpartyInput('');
    setCounterpartyError('');
    setCounterpartyResults([]);
    setStatus('public order mode');
  }

  function openCounterpartySelector() {
    setCounterpartyError('');
    setCounterpartyResults([]);
    if (hasSpecificMakerCounterparty) {
      setCounterpartyInput(String(counterpartyHandle || counterpartyName || '').replace(/^@/, ''));
    } else {
      setCounterpartyInput('');
    }
    setCounterpartyModalOpen(true);
  }

  function resetToMainMakerFlow() {
    setCompressed('');
    setOrderData(null);
    setChecks(null);
    setLastSwapTxHash('');
    setMakerMode(true);
    setMakerOverrides({});
    setMakerStep('approve');
    setMakerCompressedOrder('');
    setMakerCastText('');
    setMakerOfferCastHash('');
    setMakerEmbedPosted(false);
    setStatus('maker flow');
    router.replace('/');
  }

  useEffect(() => {
    if (!makerMode) return;
    setMakerStep('approve');
    setMakerCompressedOrder('');
    setMakerCastText('');
    setMakerOfferCastHash('');
    setMakerEmbedPosted(false);
  }, [
    makerMode,
    makerOverrides.senderToken,
    makerOverrides.senderAmount,
    makerOverrides.senderDecimals,
    makerExpirySec,
  ]);

  useEffect(() => {
    if (initialCompressed || initialCastHash) return;
    setMakerMode(true);
    setStatus('maker flow');
  }, [initialCompressed, initialCastHash]);

  useEffect(() => {
    const fee = Number(orderData?.protocolFee || 0);
    if (Number.isFinite(fee) && fee > 0) setMakerProtocolFeeBps(fee);
  }, [orderData?.protocolFee]);

  useEffect(() => {
    let cancelled = false;
    async function loadLiveProtocolFee() {
      if (!makerMode || orderData) return;
      try {
        const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
        const swap = new ethers.Contract(BASE_SWAP_CONTRACT, SWAP_ABI, rp);
        const fee = Number((await swap.protocolFee()).toString());
        if (!cancelled && Number.isFinite(fee) && fee > 0) {
          setMakerProtocolFeeBps(fee);
        }
      } catch {
        // keep fallback state
      }
    }
    loadLiveProtocolFee();
    return () => { cancelled = true; };
  }, [makerMode, orderData]);

  useEffect(() => {
    async function loadFromCastHash() {
      if (initialCompressed || !initialCastHash) {
        dbg(`skip cast load initialCompressed=${Boolean(initialCompressed)} castHash=${initialCastHash || 'none'}`);
        return;
      }
      try {
        setStatus('loading order');
        dbg(`fetch cast hash ${initialCastHash}`);
        const r = await fetch(`/api/order-from-cast?castHash=${encodeURIComponent(initialCastHash)}`);
        const d = await r.json();
        dbg(`api status=${r.status} ok=${Boolean(d?.ok)} hasOrder=${Boolean(d?.compressedOrder)}`);
        if (!r.ok || !d?.compressedOrder) {
          setStatus('order not found');
          return;
        }
        const decoded = decodeCompressedOrder(d.compressedOrder);
        setCompressed(d.compressedOrder);
        setOrderData(decoded);
        setChecks(null);
        setStatus('order loaded from cast');
        dbg('cast order decoded and set');
      } catch (e) {
        setStatus('order not found');
        dbg(`cast load exception: ${e?.message || 'unknown'}`);
      }
    }
    loadFromCastHash();
  }, [initialCastHash, initialCompressed]);

  useEffect(() => {
    async function resolveName() {
      if (!orderData?.signerWallet) {
        if (makerMode) {
          setCounterpartyName('Anybody');
        } else {
          setCounterpartyName('Counterparty');
        }
        setCounterpartyHandle('');
        setCounterpartyProfileUrl('');
        setCounterpartyPfpUrl('');
        return;
      }
      try {
        const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(orderData.signerWallet)}`);
        const d = await r.json();
        const rawHandle = d?.name ? `@${String(d.name).replace(/^@/, '')}` : '';
        const label = rawHandle ? fitName(rawHandle) : (d?.fallback || short(orderData.signerWallet));
        setCounterpartyName(label || short(orderData.signerWallet));
        setCounterpartyHandle(rawHandle);
        setCounterpartyProfileUrl(d?.profileUrl || '');
        setCounterpartyPfpUrl(d?.pfpUrl || '');
      } catch {
        setCounterpartyName(short(orderData.signerWallet));
        setCounterpartyHandle('');
        setCounterpartyProfileUrl('');
        setCounterpartyPfpUrl('');
      }
    }
    resolveName();
  }, [orderData?.signerWallet, makerMode]);

  useEffect(() => {
    async function resolveSenderName() {
      const senderWallet = String(orderData?.senderWallet || '');
      if (!senderWallet || normalizeAddr(senderWallet) === ethers.ZeroAddress.toLowerCase()) {
        setSenderPartyName('Anybody');
        setSenderPartyProfileUrl('');
        return;
      }
      try {
        const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(senderWallet)}`);
        const d = await r.json();
        const rawHandle = d?.name ? `@${String(d.name).replace(/^@/, '')}` : '';
        const label = rawHandle ? fitName(rawHandle) : (d?.fallback || short(senderWallet));
        setSenderPartyName(label || short(senderWallet));
        setSenderPartyProfileUrl(d?.profileUrl || '');
      } catch {
        setSenderPartyName(short(senderWallet));
        setSenderPartyProfileUrl('');
      }
    }
    resolveSenderName();
  }, [orderData?.senderWallet]);

  const parsed = useMemo(() => {
    if (!orderData) return null;
    return {
      ...orderData,
      signerAmountBI: BigInt(orderData.signerAmount),
      senderAmountBI: BigInt(orderData.senderAmount),
      protocolFeeBI: BigInt(orderData.protocolFee),
    };
  }, [orderData]);

  useEffect(() => {
    let mounted = true;
    async function signalReady() {
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        await sdk?.actions?.ready?.();
        if (mounted) setStatus((s) => (s === 'ready' ? s : 'app ready'));
      } catch {
        // no-op outside farcaster clients
      }
    }
    signalReady();
    return () => { mounted = false; };
  }, []);

  async function connectWallet() {
    try {
      setStatus('connecting wallet');
      if (!isConnected && connectors?.[0]) {
        try { await connect({ connector: connectors[0] }); } catch {}
      }
      const mod = await import('@farcaster/miniapp-sdk');
      const sdk = mod?.sdk || mod?.default || mod;
      let eip1193 = null;
      const getter = sdk?.wallet?.getEthereumProvider || sdk?.actions?.getEthereumProvider;
      if (getter) eip1193 = await getter();
      if (!eip1193 && typeof window !== 'undefined' && window.ethereum) eip1193 = window.ethereum;
      if (!eip1193) throw new Error('No wallet provider found');
      const bp = new ethers.BrowserProvider(eip1193);
      const signer = await bp.getSigner();
      setAddress(await signer.getAddress());
      setProvider(bp);
      setWalletProvider(eip1193);
      setStatus('wallet connected');
      await sdk?.actions?.ready?.();
    } catch (e) {
      setStatus(`connect error: ${e.message}`);
    }
  }

  useEffect(() => {
    if (wagmiAddress && wagmiAddress !== address) setAddress(wagmiAddress);
  }, [wagmiAddress]);

  useEffect(() => {
    async function resolveUserPfp() {
      if (!address) {
        setUserPfpUrl('');
        return;
      }
      try {
        const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(address)}`, { cache: 'no-store' });
        const d = await r.json();
        setUserPfpUrl(d?.pfpUrl || '');
      } catch {
        setUserPfpUrl('');
      }
    }
    resolveUserPfp();
  }, [address]);

  useEffect(() => {
    async function autoConnectIfMiniApp() {
      if (autoConnectTried || address) return;
      if (!parsed) return;
      if (Number(parsed.expiry) <= Math.floor(Date.now() / 1000)) {
        setAutoConnectTried(true);
        return;
      }
      if (checks?.nonceUsed) {
        setAutoConnectTried(true);
        return;
      }
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        const inMiniApp = await sdk?.isInMiniApp?.();
        if (inMiniApp) {
          if (!isConnected && connectors?.[0]) {
            try { await connect({ connector: connectors[0] }); } catch {}
          }
          setAutoConnectTried(true);
          await connectWallet();
          return;
        }
      } catch {
        // ignore
      }
      setAutoConnectTried(true);
    }
    autoConnectIfMiniApp();
  }, [autoConnectTried, address, isConnected, connectors, connect, parsed, checks?.nonceUsed]);

  useEffect(() => {
    if (!parsed) return;
    if (lastSwapTxHash) return;
    runChecks();
  }, [parsed, provider, address, lastSwapTxHash]);

  useEffect(() => {
    if (!initialCastHash || !lastSwapTxHash) return;
    if (swapThanksSent || swapThanksBusy) return;
    onSwapComposeThanks();
  }, [initialCastHash, lastSwapTxHash, swapThanksSent, swapThanksBusy]);

  function buildOrderForCall(requiredSenderKind) {
    if (!parsed) throw new Error('No order loaded');
    return {
      nonce: BigInt(parsed.nonce),
      expiry: BigInt(parsed.expiry),
      signer: {
        wallet: parsed.signerWallet,
        token: parsed.signerToken,
        kind: String(parsed.signerKind || KIND_ERC20),
        id: BigInt(parsed.signerId || 0),
        amount: BigInt(parsed.signerAmount),
      },
      sender: {
        wallet: parsed.senderWallet,
        token: parsed.senderToken,
        kind: String(parsed.senderKind || requiredSenderKind || KIND_ERC20),
        id: BigInt(parsed.senderId || 0),
        amount: BigInt(parsed.senderAmount),
      },
      affiliateWallet: ethers.ZeroAddress,
      affiliateAmount: 0n,
      v: Number(parsed.v),
      r: parsed.r,
      s: parsed.s,
    };
  }

  async function runChecks() {
    if (!parsed) {
      setStatus('order not found');
      return null;
    }
    if (lastSwapTxHash) return checks;

    try {
      setStatus('checking order');
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });

      const configuredSenderOwner = parsed.senderWallet || ethers.ZeroAddress;
      const connectedNormPre = normalizeAddr(address);
      const signerNormPre = normalizeAddr(parsed.signerWallet);
      const senderNormPre = normalizeAddr(configuredSenderOwner);
      const isOpenOrder = senderNormPre === ethers.ZeroAddress.toLowerCase();
      const connectedIsSignerPre = Boolean(connectedNormPre) && connectedNormPre === signerNormPre;
      const effectiveSenderOwner = isOpenOrder && !connectedIsSignerPre
        ? (address || ethers.ZeroAddress)
        : configuredSenderOwner;

      const checkReq = await fetch('/api/order-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          swapContract: parsed.swapContract,
          senderWallet: effectiveSenderOwner,
          order: {
            nonce: parsed.nonce,
            expiry: parsed.expiry,
            signer: { wallet: parsed.signerWallet, token: parsed.signerToken, kind: parsed.signerKind || KIND_ERC20, id: parsed.signerId || 0, amount: parsed.signerAmount },
            sender: { wallet: parsed.senderWallet, token: parsed.senderToken, kind: parsed.senderKind || KIND_ERC20, id: parsed.senderId || 0, amount: parsed.senderAmount },
            affiliateWallet: ethers.ZeroAddress,
            affiliateAmount: 0,
            v: parsed.v,
            r: parsed.r,
            s: parsed.s,
          },
        }),
      });
      const checkData = await checkReq.json();
      if (!checkReq.ok || !checkData?.ok) throw new Error(checkData?.error || 'order check failed');

      const requiredSenderKind = checkData.requiredSenderKind;
      const nonceUsed = Boolean(checkData.nonceUsed);
      const checkErrors = Array.isArray(checkData.checkErrors) ? checkData.checkErrors : [];

      const encodedProtocolFee = BigInt(parsed.protocolFee || 0);
      const onchainProtocolFee = BigInt(checkData.protocolFeeOnchain || 0);
      const protocolFeeMismatch = encodedProtocolFee !== onchainProtocolFee;

      if (Number(parsed.expiry) <= Math.floor(Date.now() / 1000)) {
        setChecks((prev) => ({ ...(prev || {}), requiredSenderKind, nonceUsed: false, protocolFeeBps: encodedProtocolFee, protocolFeeMismatch: false }));
        setStatus('order expired');
        return null;
      }
      if (nonceUsed) {
        setChecks((prev) => ({ ...(prev || {}), requiredSenderKind, nonceUsed: true, protocolFeeBps: encodedProtocolFee, protocolFeeMismatch: false }));
        setStatus('order already taken');
        return null;
      }

      if (protocolFeeMismatch) {
        setChecks((prev) => ({
          ...(prev || {}),
          requiredSenderKind,
          nonceUsed: false,
          protocolFeeMismatch: true,
          protocolFeeBps: encodedProtocolFee,
          onchainProtocolFeeBps: onchainProtocolFee,
        }));
        setStatus('incorrect protocol fees');
        return null;
      }

      const protocolFee = onchainProtocolFee;
      const senderAmount = BigInt(parsed.senderAmount);
      const feeAmount = (senderAmount * protocolFee) / 10000n;
      const totalRequired = senderAmount + feeAmount;

      const signerSymbol = guessSymbol(parsed.signerToken);
      const signerDecimals = guessDecimals(parsed.signerToken);
      const senderSymbol = guessSymbol(parsed.senderToken);
      const senderDecimals = guessDecimals(parsed.senderToken);

      const [signerUsdValue, senderUsdValue] = await Promise.all([
        quoteUsdValue(readProvider, parsed.signerToken, BigInt(parsed.signerAmount), signerDecimals),
        quoteUsdValue(readProvider, parsed.senderToken, totalRequired, senderDecimals),
      ]);

      if (!address) {
        setChecks((prev) => ({
          ...(prev || {}),
          requiredSenderKind,
          nonceUsed: false,
          protocolFeeMismatch: false,
          protocolFeeBps: protocolFee,
          signerUsdValue,
          senderUsdValue,
        }));
        setStatus('connecting wallet');
        return null;
      }

      const currentChainId = provider
        ? Number((await provider.getNetwork()).chainId)
        : Number(publicClient?.chain?.id || 0);

      if (!currentChainId) {
        setStatus('connecting wallet');
        return null;
      }

      if (currentChainId !== 8453) {
        setStatus(`wrong network: switch wallet to Base (8453), current ${currentChainId}`);
        return null;
      }

      setStatus('checking wallet');

      const pairRead = await readPairBatch({
        signerToken: parsed.signerToken,
        signerOwner: parsed.signerWallet,
        senderToken: parsed.senderToken,
        senderOwner: effectiveSenderOwner,
        spender: parsed.swapContract,
      });
      const signerRead = pairRead.signer;
      const senderRead = pairRead.sender;

      const finalSignerSymbol = signerRead.symbol || signerSymbol;
      const finalSignerDecimals = signerRead.decimals ?? signerDecimals;
      const finalSenderSymbol = senderRead.symbol || senderSymbol;
      const finalSenderDecimals = senderRead.decimals ?? senderDecimals;

      const makerBalanceOk = signerRead.balance >= BigInt(parsed.signerAmount);
      const makerApprovalOk = signerRead.allowance >= BigInt(parsed.signerAmount);
      const makerAccepted = makerBalanceOk && makerApprovalOk;

      const takerBalance = senderRead.balance;
      const connectedNorm = normalizeAddr(address);
      const signerNorm = normalizeAddr(parsed.signerWallet);
      const senderNorm = normalizeAddr(configuredSenderOwner);
      const connectedIsSigner = Boolean(connectedNorm) && connectedNorm === signerNorm;
      const connectedIsSender = isOpenOrder
        ? (Boolean(connectedNorm) && !connectedIsSigner)
        : (Boolean(connectedNorm) && connectedNorm === senderNorm);
      const ownerMatches = connectedIsSender || connectedIsSigner;
      const senderBalanceLow = checkErrors.includes('SenderBalanceLow');
      const senderAllowanceLow = checkErrors.includes('SenderAllowanceLow');
      const takerBalanceOk = connectedIsSender
        ? !senderBalanceLow
        : connectedIsSigner
        ? (isOpenOrder ? true : !senderBalanceLow)
        : false;
      const takerApprovalOk = connectedIsSender
        ? !senderAllowanceLow
        : connectedIsSigner
        ? (isOpenOrder ? true : !senderAllowanceLow)
        : false;

      const senderIsWeth = normalizeAddr(parsed.senderToken) === BASE_WETH.toLowerCase();
      const wrapAmountNeeded = ownerMatches && senderIsWeth && takerBalance < totalRequired ? (totalRequired - takerBalance) : 0n;
      const takerEthBalance = ownerMatches && senderIsWeth ? await readProvider.getBalance(address) : 0n;
      const canWrapFromEth = wrapAmountNeeded > 0n && takerEthBalance >= wrapAmountNeeded;

      const baseChecks = {
        requiredSenderKind,
        nonceUsed: false,
        protocolFeeMismatch: false,
        ownerMatches,
        connectedRole: connectedIsSender ? 'sender' : (connectedIsSigner ? 'signer' : 'none'),
        senderIsWeth,
        wrapAmountNeeded,
        takerEthBalance,
        canWrapFromEth,
        signerSymbol: finalSignerSymbol,
        senderSymbol: finalSenderSymbol,
        signerDecimals: finalSignerDecimals,
        senderDecimals: finalSenderDecimals,
        makerAccepted,
        makerBalanceOk,
        makerApprovalOk,
        takerBalanceOk,
        takerApprovalOk,
        totalRequired,
        feeAmount,
        protocolFeeBps: protocolFee,
        checkErrors,
        signerAmount: BigInt(parsed.signerAmount),
        senderAmount: BigInt(parsed.senderAmount),
        signerUsdValue,
        senderUsdValue,
      };

      setChecks(baseChecks);
      setStatus('checks complete');
      return baseChecks;
    } catch (e) {
      setStatus(`check error: ${e.message}`);
      return null;
    }
  }

  async function onSwapComposeThanks() {
    const txHash = String(lastSwapTxHash || '').trim();
    const parentHash = String(initialCastHash || '').trim();
    if (!txHash || !parentHash) return;

    try {
      setSwapThanksBusy(true);
      const mod = await import('@farcaster/miniapp-sdk');
      const sdk = mod?.sdk || mod?.default || mod;
      const compose = sdk?.actions?.composeCast;
      if (!compose) throw new Error('composeCast unavailable');

      const txUrl = `https://basescan.org/tx/${txHash}`;
      const text = `Thanks for the swap 🤝\n${txUrl}`;

      try {
        await compose({
          text,
          embeds: [txUrl],
          parent: { type: 'cast', hash: parentHash },
        });
      } catch {
        await compose(text);
      }

      setSwapThanksSent(true);
      setStatus('swap thanks reply composer opened');
    } catch (e) {
      setStatus(`compose error: ${errText(e)}`);
    } finally {
      setSwapThanksBusy(false);
    }
  }

  async function onPrimaryAction() {
    if (!address) {
      await connectWallet();
      return;
    }
    if (!parsed) {
      setStatus('no order loaded');
      return;
    }
    if (Number(parsed.expiry) <= Math.floor(Date.now() / 1000)) {
      setStatus('order expired');
      return;
    }
    if (checks?.nonceUsed) {
      setStatus('order already taken');
      return;
    }

    const latestChecks = checks;
    if (!latestChecks) {
      setStatus('checks not ready');
      return;
    }

    try {
      const currentChainId = provider
        ? Number((await provider.getNetwork()).chainId)
        : Number(publicClient?.chain?.id || 0);
      if (currentChainId !== 8453) {
        setStatus(`wrong network: switch wallet to Base (8453), current ${currentChainId || 'unknown'}`);
        return;
      }

      if (!sendTransactionAsync || !publicClient) {
        setStatus('wallet connector not ready');
        return;
      }

      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });
      const swap = new ethers.Contract(parsed.swapContract, SWAP_ABI, readProvider);

      if (!latestChecks.takerBalanceOk) {
        if (latestChecks.canWrapFromEth) {
          await onWrapFromEth();
          return;
        }
        setStatus('insufficient balance');
        return;
      }

      if (!latestChecks.takerApprovalOk) {
        try {
          const approveSymbol = latestChecks.senderSymbol || 'token';
          setStatus(`approving ${approveSymbol}`);
          const approveData = ERC20_IFACE.encodeFunctionData('approve', [parsed.swapContract, latestChecks.totalRequired]);
          const txHash = await sendTransactionAsync({
            account: address,
            chainId: 8453,
            to: parsed.senderToken,
            data: approveData,
            value: 0n,
          });

          setStatus(`approving ${approveSymbol}: confirming`);
          await waitForTxConfirmation({ publicClient, txHash });
          setChecks((prev) => (prev ? { ...prev, takerApprovalOk: true } : prev));
          setStatus(`approve confirmed: ${String(txHash).slice(0, 10)}... ready to swap`);
        } catch (e) {
          setStatus(`approve error: ${errText(e)}`);
        }
        return;
      }

      setStatus('simulating swap');
      const orderForCall = buildOrderForCall(latestChecks.requiredSenderKind);
      try {
        await swap.swap.staticCall(address, 0, orderForCall, { from: address });
      } catch (e) {
        const msg = errText(e);
        if (/missing revert data|over rate limit|unknown custom error/i.test(msg)) {
          dbg(`swap simulation soft-fail: ${msg}`);
          setStatus('simulation unavailable, proceeding to submit');
        } else {
          throw new Error(`swap simulation failed: ${msg}`);
        }
      }

      setStatus('sending swap tx');
      let gasLimit;
      try {
        const estimatedGas = await swap.swap.estimateGas(address, 0, orderForCall, { from: address });
        const gasLimitCap = 900000n;
        if (estimatedGas > gasLimitCap) throw new Error(`Gas estimate too high: ${estimatedGas}`);
        gasLimit = (estimatedGas * 150n) / 100n;
        dbg(`gas estimated=${estimatedGas.toString()} gasLimit=${gasLimit.toString()}`);
      } catch (e) {
        const msg = errText(e);
        if (/missing revert data|over rate limit/i.test(msg)) {
          dbg(`estimateGas soft-fail: ${msg}`);
          gasLimit = 650000n;
        } else {
          throw e;
        }
      }
      const swapData = SWAP_IFACE.encodeFunctionData('swap', [address, 0, orderForCall]);
      const txHash = await sendTransactionAsync({
        account: address,
        chainId: 8453,
        to: parsed.swapContract,
        data: swapData,
        gas: gasLimit,
        value: 0n,
      });
      await waitForTxConfirmation({ publicClient, txHash });
      setLastSwapTxHash(txHash);
      setStatus(`swap confirmed: ${txHash.slice(0, 10)}...`);
      setChecks((prev) => (prev ? { ...prev, takerApprovalOk: true } : prev));
      await runChecks();
    } catch (e) {
      setStatus(`action error: ${errText(e)}`);
    }
  }

  async function onMakerApprove() {
    if (!makerMode) return;
    if (!address || !sendTransactionAsync || !publicClient) {
      setStatus('wallet connector not ready');
      return;
    }

    const token = makerOverrides.senderToken;
    const amount = makerOverrides.senderAmount;
    const decimals = Number(makerOverrides.senderDecimals ?? 18);
    if (!token || !amount) {
      setStatus('select your offer token and amount first');
      return;
    }
    if (isEthSentinelAddr(token)) {
      setStatus('ETH does not require approve');
      return;
    }

    const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });
    const senderTokenForOrder = makerOverrides.signerToken || parsed?.signerToken;
    const { swapContract } = await resolveSwapForSenderToken(senderTokenForOrder, readProvider);

    try {
      const rawAmount = ethers.parseUnits(String(amount), decimals);
      const sym = makerOverrides.senderSymbol || guessSymbol(token);
      const offeredKind = String(makerOverrides.senderKind || KIND_ERC20);
      const isNftOffer = offeredKind === KIND_ERC721 || offeredKind === KIND_ERC1155;
      setStatus(`approving ${sym}`);
      const approveData = isNftOffer
        ? NFT_APPROVAL_IFACE.encodeFunctionData('setApprovalForAll', [swapContract, true])
        : ERC20_IFACE.encodeFunctionData('approve', [swapContract, rawAmount]);

      let txHash;
      try {
        txHash = await sendTransactionAsync({
          account: address,
          chainId: 8453,
          to: token,
          data: approveData,
          value: 0n,
        });
      } catch (e1) {
        const msg = errText(e1);
        if (!/getChainId is not a function/i.test(msg)) throw e1;

        let eip1193 = walletProvider;
        if (!eip1193?.request) {
          try {
            const mod = await import('@farcaster/miniapp-sdk');
            const sdk = mod?.sdk || mod?.default || mod;
            const getter = sdk?.wallet?.getEthereumProvider || sdk?.actions?.getEthereumProvider;
            if (getter) eip1193 = await getter();
          } catch {
            // no-op
          }
        }
        if (!eip1193?.request && typeof window !== 'undefined' && window.ethereum?.request) {
          eip1193 = window.ethereum;
        }
        if (!eip1193?.request) throw e1;

        const hash = await eip1193.request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: token,
            data: approveData,
            value: '0x0',
          }],
        });
        txHash = String(hash || '');
      }

      setStatus(`approving ${sym}: confirming`);
      await waitForTxConfirmation({ publicClient, txHash });
      setMakerStep('sign');
      setStatus(`approve confirmed: ${String(txHash).slice(0, 10)}...`);
    } catch (e) {
      setStatus(`approve error: ${errText(e)}`);
    }
  }

  function cycleMakerExpiry() {
    const options = [3600, 6 * 3600, 12 * 3600, 24 * 3600, 2 * 24 * 3600, 7 * 24 * 3600];
    const idx = options.indexOf(makerExpirySec);
    const next = options[(idx + 1) % options.length];
    setMakerExpirySec(next);
    setMakerOverrides((prev) => ({ ...prev, expirySec: next }));
  }

  function makerExpiryLabel(sec) {
    if (sec % (24 * 3600) === 0) {
      const d = sec / (24 * 3600);
      return d === 1 ? 'Expiry: 1 day' : `Expiry: ${d} days`;
    }
    if (sec % 3600 === 0) {
      const h = sec / 3600;
      return h === 1 ? 'Expiry: 1 hour' : `Expiry: ${h} hours`;
    }
    return `Expiry: ${sec}s`;
  }

  async function onMakerSign() {
    dbg('maker sign clicked');
    if (!makerMode) { dbg('maker sign aborted: no makerMode'); return; }
    if (!address) {
      dbg('maker sign aborted: no address');
      setStatus('connect wallet');
      return;
    }

    const signerToken = makerOverrides.senderToken || parsed?.senderToken;
    const signerDecimals = Number(makerOverrides.senderDecimals ?? checks?.senderDecimals ?? guessDecimals(signerToken));
    const signerAmountHuman = makerOverrides.senderAmount || (parsed ? ethers.formatUnits(parsed.senderAmount, signerDecimals) : '');

    const senderToken = makerOverrides.signerToken || parsed?.signerToken;
    const senderDecimals = Number(makerOverrides.signerDecimals ?? checks?.signerDecimals ?? guessDecimals(senderToken));
    const senderAmountHuman = makerOverrides.signerAmount || (parsed ? ethers.formatUnits(parsed.signerAmount, senderDecimals) : '');

    if (!signerToken || !signerAmountHuman || !senderToken || !senderAmountHuman) {
      setStatus('select your offer token and amount first');
      return;
    }

    try {
      setStatus('signing maker order');
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });
      const { kind: routedSenderKind, swapContract } = await resolveSwapForSenderToken(senderToken, readProvider);
      const swap = new ethers.Contract(swapContract, SWAP_ABI, readProvider);
      const [protocolFee, requiredSenderKind] = await Promise.all([
        swap.protocolFee(),
        swap.requiredSenderKind(),
      ]);

      const signerAmount = ethers.parseUnits(String(signerAmountHuman), signerDecimals).toString();
      const senderAmount = ethers.parseUnits(String(senderAmountHuman), senderDecimals).toString();
      const nonce = (BigInt(Math.floor(Date.now() / 1000)) * 1000000n + BigInt(Math.floor(Math.random() * 1000000))).toString();
      const expiry = Math.floor(Date.now() / 1000) + Number(makerExpirySec || 24 * 3600);

      const selectedCounterpartyWallet = String(makerOverrides.counterpartyWallet || parsed?.signerWallet || ethers.ZeroAddress);

      const signerKind = String(makerOverrides.senderKind || KIND_ERC20);
      const senderKind = String(makerOverrides.signerKind || routedSenderKind || requiredSenderKind || KIND_ERC20);
      const signerTokenId = Number(makerOverrides.senderTokenId || 0);
      const senderTokenId = Number(makerOverrides.signerTokenId || 0);

      const typedOrder = {
        nonce,
        expiry,
        protocolFee: Number(protocolFee.toString()),
        signer: {
          wallet: address,
          token: signerToken,
          kind: signerKind,
          id: signerTokenId,
          amount: signerAmount,
        },
        sender: {
          wallet: selectedCounterpartyWallet,
          token: senderToken,
          kind: senderKind,
          id: senderTokenId,
          amount: senderAmount,
        },
        affiliateWallet: ethers.ZeroAddress,
        affiliateAmount: 0,
      };

      const domain = {
        name: 'SWAP',
        version: '4.2',
        chainId: 8453,
        verifyingContract: swapContract,
      };

      let sig;
      try {
        if (!walletProvider?.request) throw new Error('wagmi skipped: no walletProvider.request');
        dbg('maker sign via wagmi useSignTypedData');
        sig = await signTypedDataAsync({
          domain,
          types: ORDER_TYPES,
          primaryType: 'Order',
          message: typedOrder,
        });
        dbg('maker sign wagmi success');
      } catch (e1) {
        dbg(`maker sign wagmi failed: ${errText(e1)}`);

        let eip1193 = walletProvider;
        if (!eip1193?.request) {
          try {
            const mod = await import('@farcaster/miniapp-sdk');
            const sdk = mod?.sdk || mod?.default || mod;
            const getter = sdk?.wallet?.getEthereumProvider || sdk?.actions?.getEthereumProvider;
            if (getter) eip1193 = await getter();
            dbg(`maker sign sdk provider ${eip1193?.request ? 'found' : 'missing'}`);
          } catch (e2) {
            dbg(`maker sign sdk provider lookup failed: ${errText(e2)}`);
          }
        }
        if (!eip1193?.request && typeof window !== 'undefined' && window.ethereum?.request) {
          eip1193 = window.ethereum;
          dbg('maker sign using window.ethereum provider');
        }
        if (!eip1193?.request) throw new Error('wallet signing unavailable');

        const typedData = JSON.stringify({
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            ...ORDER_TYPES,
          },
          domain,
          primaryType: 'Order',
          message: typedOrder,
        });
        try {
          dbg('maker sign via eth_signTypedData_v4');
          sig = await eip1193.request({
            method: 'eth_signTypedData_v4',
            params: [address, typedData],
          });
          dbg('maker sign v4 success');
        } catch (e3) {
          dbg(`maker sign v4 failed: ${errText(e3)}`);
          dbg('maker sign via eth_signTypedData');
          sig = await eip1193.request({
            method: 'eth_signTypedData',
            params: [address, typedData],
          });
          dbg('maker sign legacy success');
        }
      }
      const split = ethers.Signature.from(sig);

      const fullOrder = {
        chainId: 8453,
        swapContract,
        nonce,
        expiry: String(expiry),
        signerWallet: address,
        signerToken,
        signerAmount,
        signerKind,
        signerId: String(signerTokenId),
        protocolFee: String(protocolFee),
        senderWallet: selectedCounterpartyWallet,
        senderToken,
        senderAmount,
        senderKind,
        senderId: String(senderTokenId),
        v: String(split.v),
        r: split.r,
        s: split.s,
      };

      dbg('maker sign signature parsed, encoding compressed order');
      const compressed = encodeCompressedOrder(fullOrder);
      const miniappUrl = `https://the-grand-bazaar.vercel.app/?order=${encodeURIComponent(compressed)}`;
      const isPrivateOrder = String(selectedCounterpartyWallet || '').toLowerCase() !== ethers.ZeroAddress.toLowerCase();
      const mentionPrefix = isPrivateOrder && counterpartyHandle ? `${counterpartyHandle} ` : '';
      const lines = [
        `${mentionPrefix}WTS: ${formatTokenAmount(signerAmountHuman)} ${makerOverrides.senderSymbol || guessSymbol(signerToken)} for ${formatTokenAmount(senderAmountHuman)} ${makerOverrides.signerSymbol || guessSymbol(senderToken)}`,
        `Offer expires in ${offerExpiryInLabel(makerExpirySec)}`,
        `GBZ1:${compressed}`,
      ];
      const castText = lines.join('\n');

      setMakerCompressedOrder(compressed);
      setMakerCastText(castText);
      setMakerOfferCastHash('');
      setMakerEmbedPosted(false);
      setMakerOverrides((prev) => ({ ...prev, composeEmbed: miniappUrl }));
      setMakerStep('cast');
      setStatus('maker order signed');
      dbg('maker sign complete -> cast step');
    } catch (e) {
      dbg(`maker sign error: ${errText(e)}`);
      setStatus(`sign error: ${errText(e)}`);
    }
  }

  async function onMakerCast() {
    if (!makerCastText) {
      setStatus('sign order first');
      return;
    }

    try {
      const mod = await import('@farcaster/miniapp-sdk');
      const sdk = mod?.sdk || mod?.default || mod;
      const compose = sdk?.actions?.composeCast;
      if (!compose) throw new Error('composeCast unavailable');

      const isPrivateOrder = String(parsed?.signerWallet || '').toLowerCase() !== ethers.ZeroAddress.toLowerCase();
      let mentionHandle = counterpartyHandle;
      if (isPrivateOrder && !mentionHandle && parsed?.signerWallet) {
        try {
          const rr = await fetch(`/api/farcaster-name?address=${encodeURIComponent(parsed.signerWallet)}`, { cache: 'no-store' });
          const dd = await rr.json();
          mentionHandle = dd?.name ? `@${String(dd.name).replace(/^@/, '')}` : '';
          if (mentionHandle) {
            setCounterpartyHandle(mentionHandle);
            setCounterpartyName(fitName(mentionHandle));
          }
        } catch {
          // no-op
        }
      }
      if (isPrivateOrder && !mentionHandle) {
        const fallback = String(counterpartyName || '').trim();
        if (fallback.startsWith('@') && !fallback.includes('…')) mentionHandle = fallback;
      }

      const step1Text = (isPrivateOrder && mentionHandle)
        ? (makerCastText.startsWith(`${mentionHandle} `)
          ? makerCastText
          : makerCastText.replace(/^WTS:/, `${mentionHandle} WTS:`))
        : makerCastText;

      const publishEmbedStep = async (offerCastHash) => {
        const deeplink = `https://the-grand-bazaar.vercel.app/c/${encodeURIComponent(offerCastHash)}`;
        const embedText = `🛒 Take this offer in the Grand Bazaar\n${deeplink}`;

        let step2Hash = '';
        try {
          const second = await compose({
            text: embedText,
            embeds: [deeplink],
            parent: { type: 'cast', hash: offerCastHash },
          });
          step2Hash = String(second?.cast?.hash || '').trim();
        } catch (e2) {
          dbg(`step2 compose object failed: ${errText(e2)}`);
          const second = await compose(embedText);
          step2Hash = String(second?.cast?.hash || '').trim();
        }

        if (step2Hash) {
          setMakerEmbedPosted(true);
          setStatus(`Waiting for ${fitOfferName(counterpartyName)} to accept`);
        } else {
          setMakerOfferCastHash(offerCastHash);
          setMakerEmbedPosted(false);
          setStatus('Step 1 posted. Post step 2 to publish the app link, then wait for a taker.');
        }
      };

      // Step 2 retry path: step 1 already published previously.
      if (makerOfferCastHash && !makerEmbedPosted) {
        await publishEmbedStep(makerOfferCastHash);
        return;
      }

      // Step 1: publish offer text as a cast
      const parentHash = String(initialCastHash || '').trim();
      const parent = parentHash ? { type: 'cast', hash: parentHash } : undefined;
      let offerCastHash = '';

      try {
        const first = await compose({
          text: step1Text,
          ...(parent ? { parent } : {}),
        });
        offerCastHash = String(first?.cast?.hash || '').trim();
      } catch (e1) {
        dbg(`step1 compose object failed: ${errText(e1)}`);
        const first = await compose(step1Text);
        offerCastHash = String(first?.cast?.hash || '').trim();
      }

      if (!offerCastHash) {
        setStatus('offer composer closed or not posted');
        return;
      }

      setMakerOfferCastHash(offerCastHash);
      await publishEmbedStep(offerCastHash);
    } catch (e) {
      setStatus(`compose error: ${errText(e)}`);
    }
  }

  async function onParsedSignerPublishOrder() {
    if (!parsed) {
      setStatus('order not loaded');
      return;
    }

    try {
      const mod = await import('@farcaster/miniapp-sdk');
      const sdk = mod?.sdk || mod?.default || mod;
      const compose = sdk?.actions?.composeCast;
      if (!compose) throw new Error('composeCast unavailable');

      const signerDecimals = guessDecimals(parsed.signerToken);
      const senderDecimals = guessDecimals(parsed.senderToken);
      const signerAmountHuman = ethers.formatUnits(parsed.signerAmount, signerDecimals);
      const senderAmountHuman = ethers.formatUnits(parsed.senderAmount, senderDecimals);
      const orderPayload = (compressed || '').trim() || encodeCompressedOrder(parsed);
      const remaining = Math.max(0, Number(parsed.expiry || 0) - Math.floor(Date.now() / 1000));
      const castText = [
        `WTS: ${formatTokenAmount(signerAmountHuman)} ${guessSymbol(parsed.signerToken)} for ${formatTokenAmount(senderAmountHuman)} ${guessSymbol(parsed.senderToken)}`,
        `Offer expires in ${offerExpiryInLabel(remaining)}`,
        `GBZ1:${orderPayload}`,
      ].join('\n');

      const publishEmbedStep = async (offerCastHash) => {
        const deeplink = `https://the-grand-bazaar.vercel.app/c/${encodeURIComponent(offerCastHash)}`;
        const embedText = `🛒 Take this offer in the Grand Bazaar\n${deeplink}`;
        try {
          await compose({
            text: embedText,
            embeds: [deeplink],
            parent: { type: 'cast', hash: offerCastHash },
          });
          setStatus('order published');
        } catch {
          await compose(embedText);
          setStatus('order published');
        }
      };

      let offerCastHash = '';
      const parentHash = String(initialCastHash || '').trim();
      const parent = parentHash ? { type: 'cast', hash: parentHash } : undefined;
      try {
        const first = await compose({ text: castText, ...(parent ? { parent } : {}) });
        offerCastHash = String(first?.cast?.hash || '').trim();
      } catch {
        const first = await compose(castText);
        offerCastHash = String(first?.cast?.hash || '').trim();
      }

      if (!offerCastHash) {
        setStatus('offer composer closed or not posted');
        return;
      }

      await publishEmbedStep(offerCastHash);
    } catch (e) {
      setStatus(`compose error: ${errText(e)}`);
    }
  }

  async function onParsedSignerCancelOrder() {
    if (!parsed) {
      setStatus('order not loaded');
      return;
    }
    if (!address || !sendTransactionAsync || !publicClient) {
      setStatus('wallet connector not ready');
      return;
    }

    const cancelData = SWAP_IFACE.encodeFunctionData('cancel', [[BigInt(parsed.nonce)]]);

    try {
      setStatus('cancelling order');
      let txHash;
      try {
        txHash = await sendTransactionAsync({
          account: address,
          chainId: 8453,
          to: parsed.swapContract,
          data: cancelData,
          value: 0n,
        });
      } catch (e1) {
        const msg = errText(e1);
        if (!/getChainId is not a function/i.test(msg)) throw e1;

        let eip1193 = walletProvider;
        if (!eip1193?.request && typeof window !== 'undefined' && window.ethereum?.request) {
          eip1193 = window.ethereum;
        }
        if (!eip1193?.request) throw e1;

        const hash = await eip1193.request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: parsed.swapContract,
            data: cancelData,
            value: '0x0',
          }],
        });
        txHash = String(hash || '');
      }

      setStatus('cancelling order: confirming');
      await waitForTxConfirmation({ publicClient, txHash });
      setChecks((prev) => ({ ...(prev || {}), nonceUsed: true }));
      setStatus(`order cancelled: ${String(txHash).slice(0, 10)}...`);
    } catch (e) {
      setStatus(`cancel error: ${errText(e)}`);
    }
  }

  async function onWrapFromEth() {
    if (!parsed || !checks) return;
    if (!checks.canWrapFromEth || !checks.wrapAmountNeeded || checks.wrapAmountNeeded <= 0n) return;
    if (!address || !sendTransactionAsync || !publicClient) {
      setStatus('wallet connector not ready');
      return;
    }

    try {
      setIsWrapping(true);
      setStatus('wrapping ETH to WETH');
      const txHash = await sendTransactionAsync({
        account: address,
        chainId: 8453,
        to: BASE_WETH,
        data: WETH_IFACE.encodeFunctionData('deposit', []),
        value: checks.wrapAmountNeeded,
      });
      setStatus('wrapping ETH to WETH: confirming');
      await waitForTxConfirmation({ publicClient, txHash });
      setStatus(`wrap confirmed: ${String(txHash).slice(0, 10)}...`);
      await runChecks();
    } catch (e) {
      setStatus(`wrap error: ${errText(e)}`);
    } finally {
      setIsWrapping(false);
    }
  }

  async function openTokenSelector(panel) {
    if (!makerMode) return;
    const hasSpecificCounterparty = Boolean(
      makerMode
      && !parsed
      && makerOverrides?.counterpartyWallet
      && String(makerOverrides.counterpartyWallet).toLowerCase() !== ethers.ZeroAddress.toLowerCase()
    );
    const isPublicCounterpartyPanel = panel === 'signer' && makerMode && !parsed && !hasSpecificCounterparty;
    const panelWallet = panel === 'sender'
      ? (parsed?.senderWallet || address || '')
      : (parsed?.signerWallet || (hasSpecificCounterparty ? String(makerOverrides.counterpartyWallet || '') : ''));
    const wallet = panelWallet || '';
    if (!wallet && !isPublicCounterpartyPanel) {
      setStatus('connect wallet');
      return;
    }
    setTokenModalPanel(panel);
    setTokenModalWallet(wallet);
    setTokenModalOpen(true);
    setTokenModalStep('grid');
    setTokenModalView('tokens');
    setTokenNftSubView('collections');
    setSelectedNftCollection(null);
    setCustomTokenInput('');
    setCustomTokenError('');
    setCustomTokenNftContract('');
    setCustomTokenNftKind('');
    setCustomTokenNftSymbol('');
    setCustomTokenAmountInput('');
    setCustomTokenPreview(null);
    setCustomTokenResolvedOption(null);
    setTokenAmountError('');
    setTokenModalLoading(true);
    setTokenOptions([]);
    setTokenNftCollections([]);
    setTokenNftSubView('collections');
    setSelectedNftCollection(null);
    dbg(`maker selector open panel=${panel} wallet=${wallet || 'none'} publicCounterparty=${isPublicCounterpartyPanel}`);

    const cacheKey = `gbz:zapper:${panel}:${normalizeAddr(wallet)}`;
    const cacheTtlMs = 15 * 60 * 1000;

    try {
      if (isPublicCounterpartyPanel) {
        setTokenNftCollections([]);
        const list = TOKEN_CATALOG.map((entry) => {
          const tokenAddr = normalizeAddr(entry?.token || '');
          return {
            token: tokenAddr,
            symbol: entry?.symbol || guessSymbol(tokenAddr),
            decimals: Number(entry?.decimals ?? guessDecimals(tokenAddr)),
            balance: '0',
            availableAmount: 0,
            availableRaw: 0n,
            usdValue: 0,
            priceUsd: 0,
            amountDisplay: '',
            imgUrl: entry?.iconArt || tokenIconUrl(8453, tokenAddr) || null,
          };
        });
        setTokenOptions(list);
        return;
      }
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(cacheKey);
          if (raw) {
            const parsedCache = JSON.parse(raw);
            const age = Date.now() - Number(parsedCache?.ts || 0);
            if (Array.isArray(parsedCache?.tokens) && age >= 0 && age < cacheTtlMs) {
              const hydrated = parsedCache.tokens.map((t) => ({
                ...t,
                availableRaw: t?.availableRaw ? BigInt(t.availableRaw) : 0n,
              }));
              const cachedNfts = Array.isArray(parsedCache?.nftCollections) ? parsedCache.nftCollections : [];
              dbg(`maker selector cache hit tokens=${hydrated.length} nfts=${cachedNfts.length} ageMs=${age}`);
              setTokenOptions(hydrated);
              setTokenNftCollections(cachedNfts);
              return;
            }
          }
        } catch {
          // ignore cache parse errors
        }
      }

      const zr = await fetch(`/api/zapper-wallet?address=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
      const zd = await zr.json();
      if (zr.ok && zd?.ok && Array.isArray(zd.tokens)) {
        const list = zd.tokens.map((t) => {
          const decimals = guessDecimals(t.token);
          let availableRaw = 0n;
          try { availableRaw = ethers.parseUnits(String(t.balance || '0'), decimals); } catch {}
          return {
            token: normalizeAddr(t.token),
            symbol: t.symbol || guessSymbol(t.token),
            decimals,
            balance: String(t.balance || '0'),
            availableAmount: Number(t.balance || 0),
            availableRaw,
            usdValue: Number(t.usdValue || 0),
            priceUsd: Number(t.priceUsd || 0),
            amountDisplay: formatTokenAmount(String(t.balance || '0')),
            imgUrl: catalogIconArt(t.token) || t.imgUrl || tokenIconUrl(8453, t.token) || null,
          };
        });

        const nftCollections = Array.isArray(zd?.nftCollections) ? zd.nftCollections : [];
        dbg(`maker selector zapper tokens=${list.length} nftCollections=${nftCollections.length}`);
        setTokenOptions(list);
        setTokenNftCollections(nftCollections);
        if (typeof window !== 'undefined') {
          try {
            const cacheTokens = list.map((t) => ({ ...t, availableRaw: typeof t.availableRaw === 'bigint' ? t.availableRaw.toString() : String(t.availableRaw || '0') }));
            window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tokens: cacheTokens, nftCollections }));
          } catch {
            // ignore cache write failures
          }
        }
        return;
      }
      const detail = Array.isArray(zd?.details)
        ? zd.details.map((e) => e?.message || JSON.stringify(e)).join(' | ')
        : (typeof zd?.details === 'string' ? zd.details : JSON.stringify(zd?.details || ''));
      dbg(`maker selector zapper fallback reason=${zd?.error || zr.status} requestId=${zd?.requestId || 'none'} details=${detail || 'none'}`);

      const readProvider = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });

      const rawRows = await mapInChunks(TOKEN_CATALOG, 5, async (entry) => {
        const tokenAddr = normalizeAddr(entry?.token || '');
        const row = await readKnownTokenBalance(tokenAddr, wallet, Boolean(entry?.native));
        if (!row.ok) {
          dbg(`maker token ${tokenAddr} read error across RPC fallbacks`);
          return null;
        }
        const symbol = entry?.symbol || guessSymbol(tokenAddr);
        const decimals = Number(entry?.decimals ?? guessDecimals(tokenAddr));
        dbg(`maker token ${tokenAddr} sym=${symbol} balRaw=${row.balance.toString()} dec=${decimals} rpc=${row.rpc}`);
        return {
          token: tokenAddr,
          symbol,
          decimals,
          balance: row.balance,
          imgUrl: entry?.iconArt || tokenIconUrl(8453, tokenAddr) || null,
        };
      });

      const known = rawRows.filter(Boolean);
      const withUsd = await mapInChunks(known, 5, async (r) => {
        const balanceFormatted = ethers.formatUnits(r.balance, r.decimals);
        const usd = await quoteUsdValue(readProvider, r.token, r.balance, r.decimals);
        const availableAmount = Number(balanceFormatted);
        const usdValue = usd ?? 0;
        return {
          ...r,
          availableAmount,
          availableRaw: BigInt(r.balance),
          usdValue,
          priceUsd: availableAmount > 0 ? (usdValue / availableAmount) : 0,
          amountDisplay: formatTokenAmount(balanceFormatted),
        };
      });

      const list = withUsd;
      dbg(`maker selector rows=${rawRows.length} known=${list.length}`);
      setTokenOptions(list);
      setTokenNftCollections([]);
    } finally {
      setTokenModalLoading(false);
    }
  }

  async function onTokenSelect(option) {
    if (option?.isCollection) {
      const picked = tokenNftCollections.find((c) => c.collectionAddress === option.collectionAddress) || null;
      if (!picked) return;
      let resolvedKind = String(picked?.nfts?.[0]?.kind || '');
      if (!resolvedKind || resolvedKind === KIND_ERC721) {
        resolvedKind = await detectCollectionNftKind(picked.collectionAddress);
      }
      const withKind = {
        ...picked,
        nfts: Array.isArray(picked.nfts)
          ? picked.nfts.map((n) => ({ ...n, kind: resolvedKind === KIND_ERC1155 ? KIND_ERC1155 : (n?.kind || KIND_ERC721) }))
          : [],
      };
      setSelectedNftCollection(withKind);
      setTokenNftSubView('items');
      return;
    }

    if (option?.isNft) {
      const panel = tokenModalPanel;
      const floorUsd = Number(option?.floorUsd || 0);
      const nftKind = String(option?.kind || KIND_ERC721);
      const nftAvailable = String(option?.balance || option?.availableRaw || '1');
      const nftSelected = String(option?.selectedAmount || (nftKind === KIND_ERC1155 ? nftAvailable : '1'));

      if (nftKind === KIND_ERC1155 && !option?.confirmedAmount) {
        let availableRaw = 0n;
        try { availableRaw = BigInt(nftAvailable || '0'); } catch {}
        const pending1155 = {
          ...option,
          decimals: 0,
          availableRaw,
          availableAmount: Number(availableRaw),
          amountDisplay: formatIntegerAmount(nftAvailable),
          priceUsd: 0,
          usdValue: Number.isFinite(floorUsd) && floorUsd > 0 ? floorUsd : 0,
        };
        setPendingToken(pending1155);
        setPendingAmount('');
        setTokenAmountError('');
        setTokenModalStep('amount');
        return;
      }

      setMakerOverrides((prev) => ({
        ...prev,
        [`${panel}Token`]: option.token,
        [`${panel}Symbol`]: option.symbol,
        [`${panel}Decimals`]: 0,
        [`${panel}ImgUrl`]: option.imgUrl || null,
        [`${panel}AvailableRaw`]: nftAvailable,
        [`${panel}Amount`]: nftSelected,
        [`${panel}Usd`]: Number.isFinite(floorUsd) && floorUsd > 0 ? floorUsd : null,
        [`${panel}TokenId`]: String(option.tokenId || '0'),
        [`${panel}Kind`]: nftKind,
      }));
      setTokenModalOpen(false);
      setPendingToken(null);
      setPendingAmount('');
      return;
    }
    setPendingToken(option);
    setPendingAmount('');
    setTokenAmountError('');
    setTokenModalStep('amount');
  }

  async function fetchTokenOption(tokenAddr, wallet, symbolHint = null) {
    const row = await readTokenForWallet(tokenAddr, wallet);
    const decimals = Number(row?.decimals ?? guessDecimals(tokenAddr));
    const symbol = symbolHint || row?.symbol || guessSymbol(tokenAddr);
    const balanceRaw = row?.balance ?? 0n;
    const amount = ethers.formatUnits(balanceRaw, decimals);

    let priceUsd = null;
    try {
      const pr = await fetch(`/api/token-price?token=${encodeURIComponent(tokenAddr)}`, { cache: 'no-store' });
      const pd = await pr.json();
      if (pr.ok && pd?.ok && Number.isFinite(Number(pd.priceUsd))) priceUsd = Number(pd.priceUsd);
    } catch {}

    let usd = null;
    if (Number.isFinite(priceUsd)) {
      usd = Number(amount || 0) * Number(priceUsd);
    } else {
      const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
      usd = await quoteUsdValue(rp, tokenAddr, balanceRaw, decimals);
      priceUsd = Number.isFinite(Number(usd)) && Number(amount || 0) > 0 ? (Number(usd) / Number(amount || 0)) : null;
    }

    return {
      token: tokenAddr,
      symbol,
      decimals,
      balance: amount,
      availableAmount: Number(amount || 0),
      availableRaw: BigInt(balanceRaw || 0n),
      usdValue: Number(usd || 0),
      priceUsd: Number.isFinite(Number(priceUsd)) ? Number(priceUsd) : 0,
      amountDisplay: formatTokenAmount(amount),
      imgUrl: catalogIconArt(tokenAddr) || tokenIconUrl(8453, tokenAddr),
    };
  }

  async function fetchErc721Option(tokenAddr, wallet, tokenId, symbolHint = null, { skipOwnershipCheck = false } = {}) {
    const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
    const c = new ethers.Contract(tokenAddr, ERC721_ABI, rp);
    const [owner, symbol, tokenUri] = await Promise.all([
      c.ownerOf(tokenId),
      c.symbol().catch(() => symbolHint || 'NFT'),
      c.tokenURI(tokenId).catch(() => ''),
    ]);
    if (!skipOwnershipCheck && normalizeAddr(owner) !== normalizeAddr(wallet)) {
      throw new Error(`Token #${tokenId} is not owned by wallet ${owner} expected ${wallet}`);
    }
    const imgUrl = await readNftImageFromTokenUri(tokenUri);
    return {
      token: tokenAddr,
      symbol: String(symbol || symbolHint || 'NFT'),
      decimals: 0,
      balance: '1',
      availableAmount: 1,
      availableRaw: 1n,
      usdValue: 0,
      priceUsd: 0,
      amountDisplay: formatTokenIdLabel(String(tokenId)),
      tokenId: String(tokenId),
      kind: KIND_ERC721,
      isNft: true,
      ownerWallet: String(owner || ''),
      imgUrl: imgUrl || null,
    };
  }

  async function fetchErc1155Option(tokenAddr, wallet, tokenId, symbolHint = null, { skipOwnershipCheck = false } = {}) {
    const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
    const c = new ethers.Contract(tokenAddr, ERC1155_ABI, rp);
    const safeWallet = /^0x[a-fA-F0-9]{40}$/.test(String(wallet || '')) ? wallet : ethers.ZeroAddress;
    const [balanceRaw, uri] = await Promise.all([
      c.balanceOf(safeWallet, tokenId).catch(() => 0n),
      c.uri(tokenId).catch(() => ''),
    ]);
    const bal = BigInt(balanceRaw || 0n);

    if (!skipOwnershipCheck && bal <= 0n) {
      throw new Error(`Token #${tokenId} is not owned by wallet`);
    }

    if (skipOwnershipCheck) {
      let existsKnown = false;
      let existsOk = false;

      try {
        const ex = await c.exists(tokenId);
        existsKnown = true;
        existsOk = Boolean(ex);
      } catch {}

      if (!existsKnown) {
        try {
          const ts = await c.totalSupply(tokenId);
          existsKnown = true;
          existsOk = BigInt(ts || 0n) > 0n;
        } catch {}
      }

      if (!existsKnown) {
        const metadataOk = await hasValidErc1155Metadata(uri, tokenId);
        if (!metadataOk) throw new Error('Token id not found');
      } else if (!existsOk) {
        throw new Error('Token id not found');
      }
    }

    let imgUrl = '';
    try {
      const tokenUri = String(uri || '').replace('{id}', String(tokenId));
      imgUrl = await readNftImageFromTokenUri(tokenUri);
    } catch {}

    return {
      token: tokenAddr,
      symbol: String(symbolHint || 'NFT'),
      decimals: 0,
      balance: String(bal),
      availableAmount: Number(bal),
      availableRaw: bal,
      usdValue: 0,
      floorUsd: 0,
      priceUsd: 0,
      amountDisplay: formatIntegerAmount(String(bal)),
      tokenId: String(tokenId),
      kind: KIND_ERC1155,
      isNft: true,
      imgUrl: imgUrl || null,
    };
  }

  async function fetchErc721Options(tokenAddr, wallet, maxItems = 24) {
    const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
    const c = new ethers.Contract(tokenAddr, ERC721_ABI, rp);
    const [symbol, balance, isEnumerable] = await Promise.all([
      c.symbol().catch(() => 'NFT'),
      c.balanceOf(wallet),
      c.supportsInterface('0x780e9d63').catch(() => false),
    ]);

    if (!isEnumerable) {
      try {
        const zr = await fetch(`/api/zapper-wallet?address=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
        const zd = await zr.json();
        if (zr.ok && zd?.ok && Array.isArray(zd?.nftCollections)) {
          const match = zd.nftCollections.find((col) => normalizeAddr(col?.collectionAddress || '') === normalizeAddr(tokenAddr));
          const nfts = Array.isArray(match?.nfts) ? match.nfts : [];
          if (nfts.length > 0) {
            dbg(`erc721 non-enum loaded via zapper ${tokenAddr} rows=${nfts.length}`);
            return nfts.slice(0, maxItems).map((n) => ({
              token: tokenAddr,
              symbol: String(symbol || n?.symbol || 'NFT'),
              decimals: 0,
              balance: '1',
              availableAmount: 1,
              availableRaw: 1n,
              usdValue: Number(n?.usdValue || 0),
              floorUsd: Number(n?.floorUsd || 0),
              priceUsd: 0,
              amountDisplay: formatTokenIdLabel(String(n?.tokenId || '')),
              tokenId: String(n?.tokenId || ''),
              kind: KIND_ERC721,
              isNft: true,
              imgUrl: n?.imgUrl || null,
            })).filter((r) => r.tokenId);
          }
        }
      } catch (e) {
        dbg(`erc721 non-enum zapper load failed ${tokenAddr}: ${errText(e)}`);
      }
      return [];
    }

    const count = Number(balance > BigInt(maxItems) ? BigInt(maxItems) : balance);
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      const tokenId = await c.tokenOfOwnerByIndex(wallet, i);
      ids.push(BigInt(tokenId).toString());
    }
    ids.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

    const rows = [];
    for (const id of ids) {
      try {
        const option = await fetchErc721Option(tokenAddr, wallet, id, String(symbol || 'NFT'));
        rows.push(option);
      } catch (e) {
        dbg(`erc721 option skip ${tokenAddr}#${id}: ${errText(e)}`);
      }
    }
    return rows;
  }


  function applyCounterpartySelection({ name, address: wallet, profileUrl, pfpUrl }) {
    const n = String(name || '').replace(/^@/, '');
    const handle = n ? `@${n}` : '';
    setCounterpartyHandle(handle);
    setCounterpartyName(handle ? fitName(handle) : 'Anybody');
    setCounterpartyProfileUrl(profileUrl || (n ? `https://warpcast.com/${n}` : ''));
    setCounterpartyPfpUrl(pfpUrl || '');
    setMakerOverrides((prev) => ({
      ...prev,
      counterpartyWallet: /^0x[a-fA-F0-9]{40}$/.test(String(wallet || '')) ? ethers.getAddress(String(wallet)).toLowerCase() : ethers.ZeroAddress,
    }));
    setCounterpartyModalOpen(false);
    setCounterpartyResults([]);
    setStatus('counterparty set');
  }

  async function onSelectCounterparty() {
    const raw = String(counterpartyInput || '').trim();
    setCounterpartyError('');
    setCounterpartyResults([]);
    if (!raw) {
      clearCounterpartyToPublic();
      setCounterpartyModalOpen(false);
      return;
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      let wallet = '';
      try {
        wallet = ethers.getAddress(raw).toLowerCase();
      } catch {
        setCounterpartyError('Invalid wallet address');
        setStatus('invalid wallet address');
        return;
      }
      setCounterpartyName(short(wallet));
      setCounterpartyHandle('');
      setCounterpartyProfileUrl('');
      setCounterpartyPfpUrl('');
      setMakerOverrides((prev) => ({ ...prev, counterpartyWallet: wallet }));
      setCounterpartyModalOpen(false);
      setStatus('counterparty set');
      return;
    }

    try {
      setCounterpartyLoading(true);
      const r = await fetch(`/api/farcaster-name?query=${encodeURIComponent(raw)}`, { cache: 'no-store' });
      const d = await r.json();
      const users = Array.isArray(d?.users) ? d.users : [];

      if (users.length > 1) {
        setCounterpartyResults(users.slice(0, 6));
        setCounterpartyError('');
        setStatus('multiple users found');
        return;
      }

      if (users.length === 1) {
        applyCounterpartySelection(users[0]);
        return;
      }

      setCounterpartyError('User not found');
      setStatus('counterparty not found');
    } catch {
      setCounterpartyError('Counterparty lookup failed');
      setStatus('counterparty lookup failed');
    } finally {
      setCounterpartyLoading(false);
    }
  }

  function onAddCustomToken() {
    setCustomTokenInput('');
    setCustomTokenError('');
    setCustomTokenNftContract('');
    setCustomTokenNftKind('');
    setCustomTokenNftSymbol('');
    setCustomTokenAmountInput('');
    setCustomTokenPreview(null);
    setCustomTokenResolvedOption(null);
    setTokenModalStep('custom');
  }

  function onAddCustomTokenId() {
    if (!customTokenNftContract) return;
    setCustomTokenInput('');
    setCustomTokenAmountInput('');
    setCustomTokenError('');
    setCustomTokenPreview(null);
    setCustomTokenResolvedOption(null);
    setTokenModalStep('custom-id');
  }

  async function onConfirmCustomToken() {
    const tokenInput = String(customTokenInput || '').trim();
    if (!tokenInput) {
      setCustomTokenError('Enter token address');
      return;
    }

    let tokenAddr = '';
    try {
      tokenAddr = ethers.getAddress(tokenInput).toLowerCase();
    } catch {
      setCustomTokenError('Invalid token address');
      setStatus('invalid token address');
      return;
    }

    try {
      setTokenModalLoading(true);
      const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
      const kind = await detectTokenKind(tokenAddr, rp);
      if (kind === KIND_ERC721 || kind === KIND_ERC1155) {
        const nftSymbol = await readNftContractLabel(tokenAddr, rp);

        setCustomTokenNftContract(tokenAddr);
        setCustomTokenNftKind(kind);
        setCustomTokenNftSymbol(nftSymbol);
        setCustomTokenInput('');
        setCustomTokenAmountInput('');
        setCustomTokenError('');
        setCustomTokenPreview(null);
        setCustomTokenResolvedOption(null);
        setTokenModalStep('custom-id');
        setStatus(kind === KIND_ERC1155 ? 'erc1155 contract set; enter token id' : 'erc721 contract set; enter token id');
        return;
      }

      const option = await fetchTokenOption(tokenAddr, tokenModalWallet);
      setTokenOptions((prev) => {
        const dedup = prev.filter((t) => t.token !== tokenAddr);
        return [option, ...dedup];
      });
      onTokenSelect(option);
    } catch (e) {
      const msg = errText(e);
      if (/unconfigured name/i.test(msg)) {
        setCustomTokenNftContract(tokenAddr);
        setCustomTokenNftSymbol('NFT');
        setCustomTokenInput('');
        setCustomTokenPreview(null);
        setCustomTokenResolvedOption(null);
        setCustomTokenError('Name metadata unavailable. Enter token id directly.');
        setTokenModalStep('custom-id');
        setStatus('name lookup unavailable; enter token id');
      } else {
        setCustomTokenError('Lookup failed');
        setStatus('custom token lookup failed');
      }
      dbg(`custom token lookup failed ${tokenAddr}: ${msg}`);
    } finally {
      setTokenModalLoading(false);
    }
  }

  async function onConfirmCustomTokenId() {
    const tokenId = normalizeTokenIdInput(customTokenInput);
    if (!tokenId) {
      setCustomTokenError('Enter valid token id');
      return;
    }
    if (!customTokenNftContract) {
      setCustomTokenError('Select NFT contract first');
      return;
    }

    const isPublicCounterpartyPanel = tokenModalPanel === 'signer' && makerMode && !parsed && !hasSpecificMakerCounterparty;

    try {
      setTokenModalLoading(true);

      const alreadyResolved = customTokenResolvedOption
        && String(customTokenResolvedOption.tokenId || '') === tokenId
        && normalizeAddr(customTokenResolvedOption.token || '') === normalizeAddr(customTokenNftContract);

      if (isPublicCounterpartyPanel && alreadyResolved) {
        const owner = String(customTokenResolvedOption.ownerWallet || '').toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(owner)) {
          try {
            const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(owner)}`, { cache: 'no-store' });
            const d = await r.json();
            applyCounterpartySelection({
              name: d?.name || '',
              address: owner,
              profileUrl: d?.profileUrl || '',
              pfpUrl: d?.pfpUrl || '',
            });
          } catch {
            applyCounterpartySelection({ name: '', address: owner, profileUrl: '', pfpUrl: '' });
          }
        }
        onTokenSelect(customTokenResolvedOption);
        return;
      }

      const is1155 = String(customTokenNftKind || '') === KIND_ERC1155;
      const option = is1155
        ? await fetchErc1155Option(
            customTokenNftContract,
            tokenModalWallet,
            tokenId,
            customTokenNftSymbol || null,
            { skipOwnershipCheck: isPublicCounterpartyPanel }
          )
        : await fetchErc721Option(
            customTokenNftContract,
            tokenModalWallet,
            tokenId,
            customTokenNftSymbol || null,
            { skipOwnershipCheck: isPublicCounterpartyPanel }
          );

      if (is1155) {
        setCustomTokenPreview(option);
        setCustomTokenResolvedOption(option);
        setCustomTokenAmountInput('');
        setCustomTokenError('');
        setTokenModalStep('custom-amount');
        setStatus('enter 1155 amount');
        return;
      }

      if (isPublicCounterpartyPanel) {
        const owner = String(option?.ownerWallet || '').toLowerCase();
        let ownerDisplay = short(owner);
        if (/^0x[a-f0-9]{40}$/.test(owner)) {
          try {
            const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(owner)}`, { cache: 'no-store' });
            const d = await r.json();
            ownerDisplay = d?.name ? `@${String(d.name).replace(/^@/, '')}` : short(owner);
          } catch {
            ownerDisplay = short(owner);
          }
        }
        const resolved = { ...option, ownerDisplay };
        setCustomTokenPreview(resolved);
        setCustomTokenResolvedOption(resolved);
        setCustomTokenError('');
        setStatus('owner found; confirm to set private counterparty');
        return;
      }

      setCustomTokenPreview(null);
      setCustomTokenResolvedOption(null);
      onTokenSelect(option);
    } catch (e) {
      const msg = errText(e);
      if (/not owned by wallet/i.test(msg)) {
        try {
          const preview = String(customTokenNftKind || '') === KIND_ERC1155
            ? await fetchErc1155Option(
                customTokenNftContract,
                tokenModalWallet,
                tokenId,
                customTokenNftSymbol || null,
                { skipOwnershipCheck: true }
              )
            : await fetchErc721Option(
                customTokenNftContract,
                tokenModalWallet,
                tokenId,
                customTokenNftSymbol || null,
                { skipOwnershipCheck: true }
              );
          setCustomTokenPreview(preview);
        } catch {
          setCustomTokenPreview(null);
        }
        setCustomTokenResolvedOption(null);
        setCustomTokenError(tokenModalPanel === 'signer' ? "They don't own this NFT!" : "You don't own this NFT!");
        setStatus('nft token not owned by selected wallet');
      } else {
        setCustomTokenPreview(null);
        setCustomTokenResolvedOption(null);
        setCustomTokenError('Token id not found on this contract');
        setStatus('nft token id lookup failed');
      }
      dbg(`nft token id lookup failed ${customTokenNftContract}#${tokenId}: ${msg}`);
    } finally {
      setTokenModalLoading(false);
    }
  }


  function onConfirmCustomTokenAmount() {
    const n = String(customTokenAmountInput || '').trim();
    if (!customTokenResolvedOption) {
      setCustomTokenError('Lookup token id first');
      return;
    }
    if (!/^\d+$/.test(n) || Number(n) <= 0) {
      setCustomTokenError('Enter valid amount');
      return;
    }

    const want = BigInt(n);
    const feeBps = BigInt(uiProtocolFeeBps || 0);
    const appliesFee = makerMode && tokenModalPanel === 'signer';
    const required = appliesFee ? (want + ((want * feeBps) / 10000n)) : want;
    const available = BigInt(customTokenResolvedOption.balance || '0');
    if (!isPublicCounterpartyPanel && required > available) {
      setCustomTokenError('Insufficient balance');
      return;
    }

    const option = {
      ...customTokenResolvedOption,
      selectedAmount: String(want),
      availableRaw: BigInt(customTokenResolvedOption.balance || '0'),
      availableAmount: Number(customTokenResolvedOption.balance || 0),
      amountDisplay: formatIntegerAmount(String(want)),
      kind: KIND_ERC1155,
      confirmedAmount: true,
    };
    setCustomTokenError('');
    onTokenSelect(option);
  }

  async function swapPendingEthToWeth() {
    const n = Number(pendingAmount || 0);
    const wethOption = await fetchTokenOption(BASE_WETH.toLowerCase(), tokenModalWallet, 'WETH');
    setTokenOptions((prev) => {
      const dedup = prev.filter((t) => t.token !== BASE_WETH.toLowerCase());
      return [wethOption, ...dedup];
    });
    setPendingToken(wethOption);
    if (Number.isFinite(n) && n > 0) setPendingAmount(String(n));
  }

  async function onModalWrapEth() {
    if (!pendingToken || !isEthLikeToken(pendingToken)) return;
    const n = Number(pendingAmount || 0);
    if (!Number.isFinite(n) || n <= 0) return;

    if (tokenModalPanel !== 'sender' || normalizeAddr(tokenModalWallet) !== normalizeAddr(address)) {
      const wethOption = await fetchTokenOption(BASE_WETH.toLowerCase(), tokenModalWallet, 'WETH');
      const panel = tokenModalPanel;
      const usd = Number.isFinite(Number(wethOption.priceUsd))
        ? Number(wethOption.priceUsd) * n
        : (Number.isFinite(Number(wethOption.usdValue)) && Number.isFinite(Number(wethOption.availableAmount)) && Number(wethOption.availableAmount) > 0
          ? Number(wethOption.usdValue) * (n / Number(wethOption.availableAmount))
          : null);

      setMakerOverrides((prev) => ({
        ...prev,
        [`${panel}Token`]: wethOption.token,
        [`${panel}Symbol`]: 'WETH',
        [`${panel}Decimals`]: wethOption.decimals,
        [`${panel}ImgUrl`]: wethOption.imgUrl || null,
        [`${panel}AvailableRaw`]: typeof wethOption.availableRaw === 'bigint' ? wethOption.availableRaw.toString() : String(wethOption.availableRaw || '0'),
        [`${panel}Amount`]: String(n),
        [`${panel}Usd`]: usd,
      }));
      setTokenModalOpen(false);
      setPendingToken(null);
      setPendingAmount('');
      return;
    }

    if (!address || !sendTransactionAsync || !publicClient) {
      setStatus('wallet connector not ready');
      return;
    }

    try {
      setIsWrapping(true);
      const amountRaw = ethers.parseUnits(String(pendingAmount), 18);
      setStatus('wrapping ETH to WETH');
      const txHash = await sendTransactionAsync({
        account: address,
        chainId: 8453,
        to: BASE_WETH,
        data: WETH_IFACE.encodeFunctionData('deposit', []),
        value: amountRaw,
      });
      setStatus('wrapping ETH to WETH: confirming');
      await waitForTxConfirmation({ publicClient, txHash });
      await swapPendingEthToWeth();
      setStatus(`wrap confirmed: ${String(txHash).slice(0, 10)}...`);
    } catch (e) {
      setStatus(`wrap error: ${errText(e)}`);
    } finally {
      setIsWrapping(false);
    }
  }

  async function onConfirmTokenAmount() {
    if (!pendingToken || !pendingAmount) return;
    const panel = tokenModalPanel;

    if (String(pendingToken?.kind || '') === KIND_ERC1155 && !/^\d+$/.test(String(pendingAmount || '').trim())) {
      setStatus('1155 amount must be an integer');
      return;
    }

    if (pendingInsufficient) {
      setTokenAmountError('Insufficient balance');
      return;
    }

    setTokenAmountError('');
    let selectedUsd = null;
    const amountNum = Number(pendingAmount || 0);

    if (Number.isFinite(amountNum) && amountNum >= 0 && Number.isFinite(Number(pendingToken.priceUsd)) && Number(pendingToken.priceUsd) > 0) {
      selectedUsd = amountNum * Number(pendingToken.priceUsd);
    }

    if (!(Number.isFinite(Number(selectedUsd)) && Number(selectedUsd) >= 0)) {
      try {
        const pr = await fetch(`/api/token-price?token=${encodeURIComponent(pendingToken.token)}`, { cache: 'no-store' });
        const pd = await pr.json();
        if (pr.ok && pd?.ok && Number.isFinite(Number(pd.priceUsd)) && Number(pd.priceUsd) > 0) {
          selectedUsd = amountNum * Number(pd.priceUsd);
        }
      } catch {
        // fallback below
      }
    }

    if (!(Number.isFinite(Number(selectedUsd)) && Number(selectedUsd) >= 0)) {
      try {
        const dec = Number(pendingToken.decimals ?? 18);
        const amountRaw = ethers.parseUnits(String(pendingAmount), dec);
        const rp = new ethers.JsonRpcProvider(BASE_RPCS[0], undefined, { batchMaxCount: 1 });
        selectedUsd = await quoteUsdValue(rp, pendingToken.token, amountRaw, dec);
      } catch {
        // fallback below
      }
    }

    if (!(Number.isFinite(Number(selectedUsd)) && Number(selectedUsd) >= 0)) {
      const availNum = Number(pendingToken.availableAmount || 0);
      selectedUsd = Number.isFinite(amountNum) && Number.isFinite(availNum) && availNum > 0
        ? (Number(pendingToken.usdValue || 0) * (amountNum / availNum))
        : null;
    }

    if (!(Number.isFinite(Number(selectedUsd)) && Number(selectedUsd) >= 0)) {
      selectedUsd = null;
    }

    const nextOverrides = {
      ...makerOverrides,
      [`${panel}Token`]: pendingToken.token,
      [`${panel}Symbol`]: pendingToken.symbol,
      [`${panel}Decimals`]: pendingToken.decimals,
      [`${panel}ImgUrl`]: pendingToken.imgUrl || null,
      [`${panel}AvailableRaw`]: typeof pendingToken.availableRaw === 'bigint' ? pendingToken.availableRaw.toString() : String(pendingToken.availableRaw || '0'),
      [`${panel}Amount`]: String(pendingToken?.kind === KIND_ERC1155 ? Math.floor(Number(pendingAmount || 0)) : pendingAmount),
      [`${panel}Usd`]: selectedUsd,
      [`${panel}Kind`]: pendingToken?.kind || KIND_ERC20,
      [`${panel}TokenId`]: pendingToken?.tokenId ? String(pendingToken.tokenId) : '0',
    };
    setMakerOverrides(nextOverrides);

    if (makerMode && panel === 'sender') {
      const token = nextOverrides.senderToken;
      const amount = nextOverrides.senderAmount;
      const dec = Number(nextOverrides.senderDecimals ?? 18);
      let insufficient = false;
      try {
        const inRaw = amount ? ethers.parseUnits(String(amount), dec) : 0n;
        const availRaw = BigInt(nextOverrides.senderAvailableRaw || '0');
        insufficient = inRaw > 0n && inRaw > availRaw;
      } catch {}

      if (!insufficient && token && amount) {
        if (isEthSentinelAddr(token)) {
          setMakerStep('sign');
        } else if (address) {
          try {
            const rp = new ethers.JsonRpcProvider('https://mainnet.base.org', undefined, { batchMaxCount: 1 });
            const c = new ethers.Contract(token, ERC20_ABI, rp);
            const need = ethers.parseUnits(String(amount), dec);
            const senderTokenForOrder = nextOverrides.signerToken || parsed?.signerToken;
            const { swapContract } = await resolveSwapForSenderToken(senderTokenForOrder, rp);
            const allowance = await c.allowance(address, swapContract);
            setMakerStep(allowance >= need ? 'sign' : 'approve');
          } catch {
            setMakerStep('approve');
          }
        } else {
          setMakerStep('approve');
        }
      } else {
        setMakerStep('approve');
      }
    }

    setTokenModalOpen(false);
    setPendingToken(null);
    setPendingAmount('');
  }

  function applyDemoValues() {
    if (!parsed) return;
    const senderDecimals = guessDecimals(parsed.senderToken);
    const signerDecimals = guessDecimals(parsed.signerToken);
    const senderAmount = BigInt(parsed.senderAmount);
    const signerAmount = BigInt(parsed.signerAmount);
    const protocolFeeBps = BigInt(parsed.protocolFee || 30);
    const feeAmount = (senderAmount * protocolFeeBps) / 10000n;
    const totalRequired = senderAmount + feeAmount;

    setChecks({
      requiredSenderKind: '0x36372b07',
      signerSymbol: guessSymbol(parsed.signerToken),
      senderSymbol: guessSymbol(parsed.senderToken),
      signerDecimals,
      senderDecimals,
      makerAccepted: true,
      makerBalanceOk: true,
      makerApprovalOk: true,
      takerBalanceOk: true,
      takerApprovalOk: true,
      totalRequired,
      feeAmount,
      protocolFeeBps,
      signerAmount,
      senderAmount,
      signerUsdValue: null,
      senderUsdValue: null,
    });
    setStatus('demo values loaded');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = parsed ? Number(parsed.expiry) : 0;
  const isExpired = Boolean(parsed) && Number.isFinite(expirySec) && expirySec <= nowSec;
  const isTaken = Boolean(checks?.nonceUsed);

  const primaryLabel = !address
    ? 'Connect'
    : isExpired
    ? 'Expired'
    : isTaken
    ? 'Taken'
    : checks?.takerBalanceOk === false
    ? checks?.canWrapFromEth
      ? 'Wrap'
      : 'Insufficient Balance'
    : checks?.takerApprovalOk
    ? 'Swap'
    : 'Approve';

  const isOrderNotFound = /order not found/i.test(status || '');
  const isProtocolFeeMismatch = Boolean(checks?.protocolFeeMismatch) || /incorrect protocol fees/i.test(status || '');
  const isWrongWallet = Boolean(checks && checks.ownerMatches === false);
  const isErrorState = isExpired || isTaken || isOrderNotFound || isProtocolFeeMismatch || isWrongWallet || /error|expired|taken/i.test(status || '');
  const hasSpecificMakerCounterparty = Boolean(
    makerMode
    && !parsed
    && makerOverrides?.counterpartyWallet
    && String(makerOverrides.counterpartyWallet).toLowerCase() !== ethers.ZeroAddress.toLowerCase()
  );
  const publicCounterpartyLabel = hasSpecificMakerCounterparty
    ? (counterpartyName || 'counterparty')
    : 'anybody';
  const isConnectedSignerView = !makerMode && checks?.connectedRole === 'signer';
  const topbarCounterpartyLabel = isConnectedSignerView ? senderPartyName : counterpartyName;

  const loadingStage = /loading order/i.test(status)
    ? 'loading order'
    : /checking order|running preflight/i.test(status)
    ? 'checking order'
    : /connecting wallet/i.test(status)
    ? 'connecting wallet'
    : /checking wallet|checks not ready/i.test(status)
    ? 'checking wallet'
    : /wrapping/i.test(status)
    ? 'wrapping'
    : /approving/i.test(status)
    ? status
    : /simulating swap|sending swap tx|swapping/i.test(status)
    ? 'swapping'
    : '';
  const showLoadingBar = Boolean(loadingStage) && (!checks || /wrapping|approving|simulating swap|sending swap tx|swapping|checking order|checking wallet|connecting wallet|loading order/i.test(status));

  const senderDecimalsFallback = parsed ? guessDecimals(parsed.senderToken) : 18;
  const signerDecimalsFallback = parsed ? guessDecimals(parsed.signerToken) : 18;
  const protocolFeeBpsFallback = parsed ? BigInt(parsed.protocolFee || 0) : BigInt(makerProtocolFeeBps || 50);
  const senderAmountFallback = parsed ? BigInt(parsed.senderAmount) : 0n;
  const feeFallback = (senderAmountFallback * protocolFeeBpsFallback) / 10000n;
  const senderTotalFallback = senderAmountFallback + feeFallback;

  const hasCheckAmounts = Boolean(
    checks
    && checks.totalRequired != null
    && checks.senderDecimals != null
    && checks.signerAmount != null
    && checks.signerDecimals != null
  );

  const yourAmountDisplay = hasCheckAmounts
    ? formatTokenAmount(ethers.formatUnits(checks.totalRequired, checks.senderDecimals))
    : parsed
    ? formatTokenAmount(ethers.formatUnits(senderTotalFallback.toString(), senderDecimalsFallback))
    : '-';

  const counterpartyAmountDisplay = hasCheckAmounts
    ? formatTokenAmount(ethers.formatUnits(checks.signerAmount, checks.signerDecimals))
    : parsed
    ? formatTokenAmount(ethers.formatUnits(parsed.signerAmount, signerDecimalsFallback))
    : '-';

  const senderSymbolDisplay = makerOverrides.senderSymbol || checks?.senderSymbol || (parsed ? guessSymbol(parsed.senderToken) : 'TOKEN');
  const signerSymbolDisplay = makerOverrides.signerSymbol || checks?.signerSymbol || (parsed ? guessSymbol(parsed.signerToken) : 'TOKEN');
  const wrapAmountNeeded = typeof checks?.wrapAmountNeeded === 'bigint' ? checks.wrapAmountNeeded : 0n;
  const showWrapHint = Boolean(checks?.canWrapFromEth) && wrapAmountNeeded > 0n;

  const uiProtocolFeeBps = checks?.protocolFeeBps != null ? BigInt(checks.protocolFeeBps) : protocolFeeBpsFallback;

  const pendingAmountNum = Number(pendingAmount || 0);
  const pendingIsErc1155 = String(pendingToken?.kind || '') === KIND_ERC1155;
  const pendingFeeApplies = makerMode && tokenModalPanel === 'signer';
  const pendingFeeAdjustedNum = pendingFeeApplies
    ? (pendingAmountNum * (1 + Number(uiProtocolFeeBps) / 10000))
    : pendingAmountNum;
  let pendingEffectiveNum = pendingFeeAdjustedNum;
  if (pendingIsErc1155) {
    const base = BigInt(Math.max(0, Math.floor(pendingAmountNum || 0)));
    if (pendingFeeApplies) {
      const fee = (base * BigInt(uiProtocolFeeBps || 0)) / 10000n;
      pendingEffectiveNum = Number(base + fee);
    } else {
      pendingEffectiveNum = Number(base);
    }
  }
  const pendingAmountDisplay = pendingAmount
    ? (String(pendingToken?.kind || '') === KIND_ERC1155
      ? formatIntegerAmount(String(pendingEffectiveNum))
      : formatTokenAmount(String(pendingEffectiveNum)))
    : (pendingToken?.amountDisplay || '0');
  const modalDisplayOptions = tokenModalView === 'nfts'
    ? (tokenNftSubView === 'collections'
      ? tokenNftCollections.map((c, idx) => ({
          token: c.collectionAddress || `collection-${idx}`,
          symbol: fitName(c.collectionName || c.symbol || 'Collection', 12),
          amountDisplay: `${Array.isArray(c?.nfts) ? c.nfts.reduce((acc, n) => acc + Number(n?.balance || 1), 0) : 0}`,
          imgUrl: (Array.isArray(c?.nfts) ? c.nfts.find((n) => n?.imgUrl)?.imgUrl : null) || null,
          isCollection: true,
          collectionAddress: c.collectionAddress,
        }))
      : (Array.isArray(selectedNftCollection?.nfts) ? selectedNftCollection.nfts.map((n) => {
          const kind = String(n?.kind || KIND_ERC721);
          const balanceText = String(n?.balance || '1');
          return {
            token: selectedNftCollection.collectionAddress || n.token,
            symbol: selectedNftCollection.symbol || n.symbol || 'NFT',
            amountDisplay: kind === KIND_ERC1155 ? formatIntegerAmount(balanceText) : formatTokenIdLabel(n.tokenId),
            imgUrl: n.imgUrl || null,
            tokenId: String(n.tokenId),
            floorUsd: Number(n?.floorUsd || 0),
            balance: balanceText,
            isNft: true,
            kind,
          };
        }) : []))
    : tokenOptions.filter((o) => !o?.isNft);
  const pendingIsEth = isEthLikeToken(pendingToken);
  const pendingAvailableNum = Number(pendingToken?.availableAmount ?? NaN);
  const isPublicCounterpartyPanel = tokenModalPanel === 'signer' && makerMode && !parsed && !hasSpecificMakerCounterparty;
  const pendingInsufficient =
    !isPublicCounterpartyPanel
    && Number.isFinite(pendingEffectiveNum)
    && pendingEffectiveNum > 0
    && Number.isFinite(pendingAvailableNum)
    && pendingAvailableNum >= 0
    && pendingEffectiveNum > (pendingAvailableNum + 1e-12);
  const customAmountNum = Number(customTokenAmountInput || 0);
  const customBalanceNum = Number(customTokenResolvedOption?.balance || 0);
  const customFeeApplies = makerMode && tokenModalPanel === 'signer';
  const customFeeAdjustedNum = customFeeApplies
    ? (customAmountNum * (1 + Number(uiProtocolFeeBps) / 10000))
    : customAmountNum;
  const customBase = BigInt(Math.max(0, Math.floor(customAmountNum || 0)));
  const customEffectiveNum = Number(customFeeApplies
    ? (customBase + ((customBase * BigInt(uiProtocolFeeBps || 0)) / 10000n))
    : customBase);
  const custom1155Insufficient =
    !isPublicCounterpartyPanel
    && Number.isFinite(customEffectiveNum)
    && customEffectiveNum > 0
    && Number.isFinite(customBalanceNum)
    && customEffectiveNum > customBalanceNum;
  const customAmountDisplay = (Number.isFinite(customAmountNum) && customAmountNum > 0)
    ? (String(customTokenResolvedOption?.kind || '') === KIND_ERC1155
      ? formatIntegerAmount(String(customEffectiveNum))
      : formatTokenAmount(String(customFeeAdjustedNum)))
    : (String(customTokenResolvedOption?.kind || '') === KIND_ERC1155
      ? formatIntegerAmount(String(customTokenResolvedOption?.balance || '0'))
      : formatTokenAmount(String(customTokenResolvedOption?.balance || '0')));

  const senderIsErc721Selected = makerMode && String(makerOverrides.senderKind || '') === KIND_ERC721 && makerOverrides.senderTokenId;
  const signerIsErc721Selected = makerMode && String(makerOverrides.signerKind || '') === KIND_ERC721 && makerOverrides.signerTokenId;
  const senderIsErc1155Selected = makerMode && String(makerOverrides.senderKind || '') === KIND_ERC1155;
  const signerIsErc1155Selected = makerMode && String(makerOverrides.signerKind || '') === KIND_ERC1155;

  const yourAmountDisplayFinal = senderIsErc721Selected
    ? formatTokenIdLabel(String(makerOverrides.senderTokenId))
    : (makerOverrides.senderAmount
      ? (senderIsErc1155Selected ? formatIntegerAmount(String(Math.max(0, Math.floor(Number(makerOverrides.senderAmount) || 0)))) : formatTokenAmount(makerOverrides.senderAmount))
      : yourAmountDisplay);

  let counterpartyAmountDisplayFinal = signerIsErc721Selected
    ? formatTokenIdLabel(String(makerOverrides.signerTokenId))
    : (makerOverrides.signerAmount
      ? (signerIsErc1155Selected ? formatIntegerAmount(String(Math.max(0, Math.floor(Number(makerOverrides.signerAmount) || 0)))) : formatTokenAmount(makerOverrides.signerAmount))
      : counterpartyAmountDisplay);
  if (makerMode && makerOverrides.signerAmount && !signerIsErc721Selected) {
    const n = Number(makerOverrides.signerAmount);
    if (Number.isFinite(n) && n >= 0) {
      if (signerIsErc1155Selected) {
        const base = BigInt(Math.max(0, Math.floor(n)));
        const withFee = base + ((base * BigInt(uiProtocolFeeBps || 0)) / 10000n);
        counterpartyAmountDisplayFinal = formatIntegerAmount(String(withFee));
      } else {
        const withFee = n * (1 + Number(uiProtocolFeeBps) / 10000);
        counterpartyAmountDisplayFinal = formatTokenAmount(String(withFee));
      }
    }
  }

  const senderTokenAddressFinal = makerOverrides.senderToken || parsed?.senderToken;
  const signerTokenAddressFinal = makerOverrides.signerToken || parsed?.signerToken;
  const senderTokenImgFinal = makerOverrides.senderImgUrl || null;
  const signerTokenImgFinal = makerOverrides.signerImgUrl || null;
  const senderKindFinal = makerOverrides.senderKind || parsed?.senderKind || KIND_ERC20;
  const signerKindFinal = makerOverrides.signerKind || parsed?.signerKind || KIND_ERC20;
  const senderTokenIdFinal = String(makerOverrides.senderTokenId || parsed?.senderId || '0');
  const signerTokenIdFinal = String(makerOverrides.signerTokenId || parsed?.signerId || '0');

  const hasMakerSenderUsd = Object.prototype.hasOwnProperty.call(makerOverrides, 'senderUsd');
  const makerSenderUsd = makerOverrides.senderUsd;
  const makerSenderUsdOk = typeof makerSenderUsd === 'number' && Number.isFinite(makerSenderUsd) && makerSenderUsd >= 0;
  const yourValueTextFinal = makerMode && hasMakerSenderUsd
    ? (makerSenderUsdOk ? `Value: $${formatTokenAmount(String(makerSenderUsd))}` : 'Value: Not Found')
    : (checks?.senderUsdValue != null ? `Value: $${formatTokenAmount(checks.senderUsdValue)}` : 'Value: Not found');

  const hasMakerSignerUsd = Object.prototype.hasOwnProperty.call(makerOverrides, 'signerUsd');
  const counterpartyUsdBase = makerOverrides.signerUsd;
  const counterpartyUsdWithFee = (typeof counterpartyUsdBase === 'number' && Number.isFinite(counterpartyUsdBase) && counterpartyUsdBase >= 0)
    ? counterpartyUsdBase * (1 + Number(uiProtocolFeeBps) / 10000)
    : null;
  const counterpartyValueTextFinal = makerMode && hasMakerSignerUsd
    ? (typeof counterpartyUsdWithFee === 'number' && Number.isFinite(counterpartyUsdWithFee)
      ? `Value: $${formatTokenAmount(String(counterpartyUsdWithFee))}`
      : 'Value: Not Found')
    : (checks?.signerUsdValue != null ? `Value: $${formatTokenAmount(checks.signerUsdValue)}` : 'Value: Not found');

  let makerSenderInsufficient = false;
  let makerSignerInsufficient = false;
  if (makerMode) {
    try {
      const dec = Number(makerOverrides.senderDecimals ?? 18);
      const inRaw = makerOverrides.senderAmount ? ethers.parseUnits(String(makerOverrides.senderAmount), dec) : 0n;
      const availRaw = BigInt(makerOverrides.senderAvailableRaw || '0');
      makerSenderInsufficient = inRaw > 0n && inRaw > availRaw;
    } catch {}
    try {
      const dec = Number(makerOverrides.signerDecimals ?? 18);
      const signerKind = String(makerOverrides.signerKind || '');
      const is721 = signerKind === KIND_ERC721;
      const is1155 = signerKind === KIND_ERC1155;
      const feeBps = BigInt(uiProtocolFeeBps || 0);
      const baseAmount = String(makerOverrides.signerAmount || '0');

      let inRaw = 0n;
      if (is721) {
        inRaw = ethers.parseUnits(baseAmount, dec);
      } else if (is1155) {
        const baseUnits = BigInt(Math.max(0, Math.floor(Number(baseAmount) || 0)));
        const feeUnits = (baseUnits * feeBps) / 10000n;
        inRaw = baseUnits + feeUnits;
      } else {
        const baseRaw = ethers.parseUnits(baseAmount, dec);
        const feeRaw = (baseRaw * feeBps) / 10000n;
        inRaw = baseRaw + feeRaw;
      }

      const availRaw = BigInt(makerOverrides.signerAvailableRaw || '0');
      makerSignerInsufficient = inRaw > 0n && inRaw > availRaw;
    } catch {}
  }

  const flipForSigner = !makerMode && checks?.connectedRole === 'signer';
  const showSignerOwnerActions = Boolean(parsed) && !makerMode && checks?.connectedRole === 'signer';
  const isNeitherParty = !makerMode && checks?.connectedRole === 'none';
  const isPublicMakerOffer = makerMode && !parsed && !hasSpecificMakerCounterparty;
  const topTitle = isNeitherParty
    ? `${senderPartyName === 'Anybody' ? 'Anybody' : fitOfferName(senderPartyName)} offers`
    : 'You offer';
  const topAmount = flipForSigner ? counterpartyAmountDisplayFinal : yourAmountDisplayFinal;
  const topSymbol = flipForSigner ? signerSymbolDisplay : senderSymbolDisplay;
  const topTokenAddress = flipForSigner ? signerTokenAddressFinal : senderTokenAddressFinal;
  const topTokenImage = flipForSigner ? signerTokenImgFinal : senderTokenImgFinal;
  const topTokenKind = flipForSigner ? signerKindFinal : senderKindFinal;
  const topTokenId = flipForSigner ? signerTokenIdFinal : senderTokenIdFinal;
  const topDanger = makerMode ? makerSenderInsufficient : Boolean(checks && (flipForSigner ? !checks.makerBalanceOk : !checks.takerBalanceOk));
  const topInsufficient = topDanger;
  const topValueText = flipForSigner ? counterpartyValueTextFinal : yourValueTextFinal;
  const topFeeText = makerMode
    ? ''
    : (flipForSigner
      ? ''
      : (checks?.protocolFeeMismatch
        ? 'Incorrect protocol fees'
        : checks?.protocolFeeBps != null
        ? `incl. ${(Number(checks.protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
        : parsed
        ? `incl. ${(Number(protocolFeeBpsFallback) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
        : ''));
  const topFooter = makerMode
    ? (makerStep === 'cast' ? 'You have accepted' : 'You have not yet accepted')
    : checks
    ? (flipForSigner
      ? (checks.makerAccepted ? 'You have accepted' : 'You have not yet accepted')
      : (checks.takerBalanceOk && checks.takerApprovalOk ? 'You have accepted' : 'You have not yet accepted'))
    : '';
  const topFooterTone = makerMode
    ? (makerStep === 'cast' ? 'ok' : 'bad')
    : checks
    ? (flipForSigner
      ? (checks.makerAccepted ? 'ok' : 'bad')
      : (checks.takerBalanceOk && checks.takerApprovalOk ? 'ok' : 'bad'))
    : 'ok';

  const bottomTitle = makerMode && !parsed && !hasSpecificMakerCounterparty
    ? 'Anybody offers'
    : (flipForSigner && senderPartyName === 'Anybody'
      ? 'Anybody offers'
      : `${fitOfferName(flipForSigner ? senderPartyName : counterpartyName)} offers`);
  const bottomTitleLink = makerMode && !parsed && !hasSpecificMakerCounterparty
    ? ''
    : (flipForSigner ? senderPartyProfileUrl : counterpartyProfileUrl);
  const bottomTitleAvatar = makerMode && !parsed && !hasSpecificMakerCounterparty
    ? ''
    : (flipForSigner ? '' : counterpartyPfpUrl);
  const bottomAmount = flipForSigner ? yourAmountDisplayFinal : counterpartyAmountDisplayFinal;
  const bottomSymbol = flipForSigner ? senderSymbolDisplay : signerSymbolDisplay;
  const bottomTokenAddress = flipForSigner ? senderTokenAddressFinal : signerTokenAddressFinal;
  const bottomTokenImage = flipForSigner ? senderTokenImgFinal : signerTokenImgFinal;
  const bottomTokenKind = flipForSigner ? senderKindFinal : signerKindFinal;
  const bottomTokenId = flipForSigner ? senderTokenIdFinal : signerTokenIdFinal;
  const bottomDanger = makerMode
    ? (isPublicMakerOffer ? false : makerSignerInsufficient)
    : Boolean(checks && (flipForSigner ? !checks.takerBalanceOk : !checks.makerBalanceOk));
  const bottomInsufficient = bottomDanger;
  const bottomValueText = flipForSigner ? yourValueTextFinal : counterpartyValueTextFinal;
  const bottomFeeText = makerMode
    ? `incl. ${(Number(uiProtocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
    : (flipForSigner
      ? (checks?.protocolFeeMismatch
        ? 'Incorrect protocol fees'
        : checks?.protocolFeeBps != null
        ? `incl. ${(Number(checks.protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
        : parsed
        ? `incl. ${(Number(protocolFeeBpsFallback) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
        : '')
      : '');
  const bottomFooter = makerMode
    ? (hasSpecificMakerCounterparty ? `${fitOfferName(counterpartyName)} has not yet accepted` : 'Nobody has accepted yet')
    : checks
    ? (flipForSigner
      ? (checks.takerBalanceOk && checks.takerApprovalOk
        ? `${senderPartyName === 'Anybody' ? 'Anybody' : fitOfferName(senderPartyName)} accepted`
        : `${senderPartyName === 'Anybody' ? 'Anybody' : fitOfferName(senderPartyName)} has not yet accepted`)
      : (checks.makerAccepted
        ? `${fitOfferName(counterpartyName)} accepted`
        : `${fitOfferName(counterpartyName)} has not yet accepted`))
    : '';
  const bottomFooterTone = makerMode
    ? 'bad'
    : checks
    ? (flipForSigner
      ? (checks.takerBalanceOk && checks.takerApprovalOk ? 'ok' : 'bad')
      : (checks.makerAccepted ? 'ok' : 'bad'))
    : 'ok';

  return (
    <>
      <section className="rs-window">
        <div className="rs-topbar">
          {showTopbarClose ? <button className="rs-topbar-close" onClick={resetToMainMakerFlow} aria-label="Close order">✕</button> : null}
          {makerMode && !parsed ? (
            <button className="rs-title-btn rs-topbar-title" onClick={openCounterpartySelector}>
              <span>Trading with</span>
              <span>{publicCounterpartyLabel}</span>
            </button>
          ) : (
            <span className="rs-topbar-title">
              <span>Trading with</span>
              <span>{parsed ? topbarCounterpartyLabel : 'Counterparty'}</span>
            </span>
          )}
        </div>

        <div className="rs-grid">
          <TradePanel
            title={topTitle}
            titleAvatarUrl={isNeitherParty ? '' : (flipForSigner ? '' : userPfpUrl)}
            amount={topAmount}
            symbol={topSymbol}
            tokenAddress={topTokenAddress}
            tokenImage={topTokenImage}
            tokenKind={topTokenKind}
            tokenId={topTokenId}
            chainId={parsed?.chainId}
            editable={makerMode && !makerEmbedPosted}
            onEdit={() => openTokenSelector('sender')}
            danger={topDanger}
            insufficientBalance={topInsufficient}
            valueText={topValueText}
            feeText={topFeeText}
            feeTone={checks?.protocolFeeMismatch ? 'bad' : 'ok'}
            wrapHint={!flipForSigner && showWrapHint}
            wrapAmount={!flipForSigner && showWrapHint ? formatTokenAmount(ethers.formatUnits(wrapAmountNeeded, 18)) : ''}
            onWrap={onWrapFromEth}
            wrapBusy={isWrapping}
            footer={topFooter}
            footerTone={topFooterTone}
          />

          <div className="rs-center">
            {lastSwapTxHash ? (
              <div className="rs-order-success">
                <div>Swap Complete!</div>
                <a href={`https://basescan.org/tx/${lastSwapTxHash}`} target="_blank" rel="noreferrer">View on BaseScan</a>
              </div>
            ) : isOrderNotFound ? (
              <div className="rs-order-blocked">Order Not Found</div>
            ) : isWrongWallet ? (
              <div className="rs-order-blocked">This trade is not meant for you!</div>
            ) : isExpired || isTaken ? (
              <div className="rs-order-blocked">
                {isExpired ? 'Order Expired!' : 'Order no longer available!'}
              </div>
            ) : showLoadingBar ? (
              <div className="rs-loading-wrap">
                <div className="rs-loading-track">
                  <div className="rs-loading-fill" />
                  <div className="rs-loading-label">{loadingStage}</div>
                </div>
              </div>
            ) : makerMode ? (
              makerEmbedPosted ? (
                <div className="rs-order-blocked">Waiting for {fitOfferName(counterpartyName)} to accept</div>
              ) : (
                <div className="rs-btn-stack">
                  {makerStep === 'cast' ? (
                    <button className="rs-btn rs-btn-positive" onClick={onMakerCast}>
                      {makerOfferCastHash ? 'Embed Link' : 'Publish Offer'}
                    </button>
                  ) : makerStep === 'sign' ? (
                    <button className="rs-btn rs-btn-positive" onClick={onMakerSign}>Sign</button>
                  ) : (
                    <button
                      className={`rs-btn ${makerSenderInsufficient ? '' : 'rs-btn-positive'}`}
                      onClick={onMakerApprove}
                      disabled={makerSenderInsufficient}
                    >
                      {makerSenderInsufficient ? 'Insufficient balance' : 'Approve'}
                    </button>
                  )}
                  <button className="rs-btn" onClick={cycleMakerExpiry}>{makerExpiryLabel(makerExpirySec)}</button>
                </div>
              )
            ) : showSignerOwnerActions ? (
              <div className="rs-btn-stack">
                <button className="rs-btn rs-btn-positive" onClick={onParsedSignerPublishOrder}>Publish order</button>
                <button className="rs-btn decline" onClick={onParsedSignerCancelOrder}>Cancel</button>
              </div>
            ) : (
              <div className="rs-btn-stack">
                <button className={`rs-btn ${primaryLabel === 'Connect' || primaryLabel === 'Approve' || primaryLabel === 'Swap' || primaryLabel === 'Wrap' ? 'rs-btn-positive' : ''} ${isErrorState ? 'rs-btn-error' : ''}`} onClick={onPrimaryAction} disabled={isExpired || isTaken || isProtocolFeeMismatch}>{primaryLabel}</button>
                <button className="rs-btn decline" onClick={() => { setMakerMode(true); setMakerExpirySec(24 * 60 * 60); setMakerOverrides((prev) => ({ ...prev, expirySec: 24 * 60 * 60 })); setStatus('maker flow'); }}>Decline</button>
              </div>
            )}
          </div>

          <TradePanel
            title={bottomTitle}
            titleLink={bottomTitleLink}
            titleAvatarUrl={bottomTitleAvatar}
            onTitleClick={makerMode && !parsed ? openCounterpartySelector : undefined}
            onTitleClear={makerMode && !parsed && hasSpecificMakerCounterparty ? clearCounterpartyToPublic : undefined}
            amount={bottomAmount}
            symbol={bottomSymbol}
            tokenAddress={bottomTokenAddress}
            tokenImage={bottomTokenImage}
            tokenKind={bottomTokenKind}
            tokenId={bottomTokenId}
            chainId={parsed?.chainId}
            editable={makerMode && !makerEmbedPosted}
            onEdit={() => openTokenSelector('signer')}
            danger={bottomDanger}
            insufficientBalance={bottomInsufficient}
            valueText={bottomValueText}
            feeText={bottomFeeText}
            feeTone={checks?.protocolFeeMismatch ? 'bad' : 'ok'}
            footer={bottomFooter}
            footerTone={bottomFooterTone}
          />
        </div>
      </section>

      {counterpartyModalOpen ? (
        <div className="rs-modal-backdrop">
          <div className="rs-modal rs-panel">
            <button className="rs-modal-close" onClick={() => setCounterpartyModalOpen(false)}>✕</button>
            <div className="rs-modal-titlebar">Select Counterparty</div>
            <div className="rs-counterparty-input-wrap">
              <input
                className="rs-amount-input rs-counterparty-input"
                placeholder="Anybody"
                value={counterpartyInput}
                onChange={(e) => {
                  setCounterpartyInput(e.target.value);
                  if (counterpartyError) setCounterpartyError('');
                  if (counterpartyResults.length) setCounterpartyResults([]);
                }}
                autoFocus
              />
              {makerMode && !parsed && counterpartyInput ? (
                <button
                  className="rs-counterparty-clear"
                  aria-label="Clear counterparty"
                  onClick={() => {
                    setCounterpartyInput('');
                    setCounterpartyError('');
                    setCounterpartyResults([]);
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>
            {counterpartyError ? <div className="rs-inline-error">{counterpartyError}</div> : null}
            {counterpartyResults.length > 0 ? (
              <div className="rs-counterparty-results">
                {counterpartyResults.map((u, i) => (
                  <button
                    key={`${u?.name || 'user'}-${i}`}
                    className="rs-counterparty-result"
                    onClick={() => applyCounterpartySelection(u)}
                  >
                    {u?.pfpUrl ? (
                      <>
                        <img
                          src={u.pfpUrl}
                          alt={u?.name || 'user'}
                          className="rs-counterparty-result-pfp"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fb = e.currentTarget.nextElementSibling;
                            if (fb) fb.style.display = 'inline-flex';
                          }}
                        />
                        <span className="rs-counterparty-result-pfp rs-counterparty-result-pfp-fallback" style={{ display: 'none' }}>?</span>
                      </>
                    ) : <span className="rs-counterparty-result-pfp rs-counterparty-result-pfp-fallback">?</span>}
                    <span>@{String(u?.name || '').replace(/^@/, '')}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button className="rs-btn rs-btn-positive rs-token-confirm-btn" onClick={onSelectCounterparty} disabled={counterpartyLoading}>
              {counterpartyLoading ? 'Searching...' : 'Confirm'}
            </button>
          </div>
        </div>
      ) : null}

      {tokenModalOpen ? (
        <div className="rs-modal-backdrop">
          <div className="rs-modal rs-panel">
            <button className="rs-modal-close" onClick={() => setTokenModalOpen(false)}>✕</button>
            {tokenModalStep === 'grid' ? (
              <>
                <div className="rs-modal-titlebar">{tokenModalPanel === 'sender' ? 'Your Inventory' : `${fitOfferName(counterpartyName)}'s Inventory`}</div>
                {!tokenModalLoading ? (
                  <div className="rs-inv-toggle-row">
                    <button className={`rs-inv-toggle ${tokenModalView === 'tokens' ? 'active' : ''}`} onClick={() => { setTokenModalView('tokens'); setTokenNftSubView('collections'); setSelectedNftCollection(null); }}>Tokens</button>
                    <button className={`rs-inv-toggle ${tokenModalView === 'nfts' ? 'active' : ''}`} onClick={() => { setTokenModalView('nfts'); setTokenNftSubView('collections'); setSelectedNftCollection(null); }}>NFTs</button>
                  </div>
                ) : null}
                {tokenModalLoading ? (
                  <div className="rs-loading-wrap">
                    <div className="rs-loading-track">
                      <div className="rs-loading-fill" />
                      <div className="rs-loading-label">loading tokens</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {tokenModalView === 'nfts' && tokenNftSubView === 'items' ? (
                      <button className="rs-modal-back" onClick={() => { setTokenNftSubView('collections'); setSelectedNftCollection(null); }}>← Back</button>
                    ) : null}
                    {modalDisplayOptions.length === 0 ? <p>{tokenModalView === 'nfts' ? '' : (customTokenNftContract ? `No ERC721 holdings found for ${short(tokenModalWallet)}` : `No supported tokens with balance found for ${short(tokenModalWallet)}`)}</p> : null}
                    <div className="rs-token-grid-wrap">
                      <div className="rs-token-grid">
                        {modalDisplayOptions.slice(0, 23).map((t, idx) => (
                          <button key={`${tokenModalView}-${t.token}-${t.tokenId || 'na'}-${idx}`} className="rs-token-cell" onClick={() => onTokenSelect(t)}>
                            <div className="rs-token-wrap rs-token-cell-wrap">
                              <div className="rs-amount-overlay rs-token-cell-amount">{renderAmountColored(t.amountDisplay)}</div>
                              <img
                                src={t.imgUrl || tokenIconUrl(8453, t.token)}
                                alt={t.symbol}
                                className="rs-token-cell-icon"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fb = e.currentTarget.nextElementSibling;
                                  if (fb) fb.style.display = 'flex';
                                }}
                              />
                              <div className="rs-token-cell-icon rs-token-fallback rs-token-cell-fallback" style={{ display: 'none' }}>{tokenInitials(t.symbol)}</div>
                              {String(t?.kind || '') === KIND_ERC1155 && t?.tokenId ? (
                                <div className="rs-tokenid-overlay rs-token-cell-tokenid">{formatTokenIdLabel(String(t.tokenId))}</div>
                              ) : null}
                              <div className="rs-symbol-overlay rs-token-cell-symbol">{t.symbol}</div>
                            </div>
                          </button>
                        ))}
                        <button className="rs-token-cell rs-token-cell-plus" onClick={customTokenNftContract ? onAddCustomTokenId : onAddCustomToken}>+</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : tokenModalStep === 'custom' ? (
              <>
                <button className="rs-modal-back" onClick={() => setTokenModalStep('grid')}>← Back</button>
                <div className="rs-modal-subtitle">Contract Address</div>
                <input
                  className="rs-amount-input rs-counterparty-input"
                  placeholder="0x token address"
                  value={customTokenInput}
                  onChange={(e) => {
                    setCustomTokenInput(e.target.value);
                    if (customTokenError) setCustomTokenError('');
                  }}
                />
                {customTokenError ? <div className="rs-inline-error">{customTokenError}</div> : null}
                <button className="rs-btn rs-btn-positive rs-token-confirm-btn" onClick={onConfirmCustomToken} disabled={tokenModalLoading}>
                  {tokenModalLoading ? 'Loading...' : 'Confirm'}
                </button>
              </>
            
            ) : tokenModalStep === 'custom-id' ? (
              <>
                <button className="rs-modal-back" onClick={() => { setTokenModalStep('custom'); setCustomTokenInput(''); setCustomTokenError(''); setCustomTokenPreview(null); setCustomTokenResolvedOption(null); }}>← Back</button>
                <div className="rs-modal-subtitle">Select Token ID</div>
                {customTokenPreview ? (
                  <div className="rs-token-center" style={{ marginTop: 6, marginBottom: 6 }}>
                    <div className="rs-token-wrap rs-token-cell-wrap rs-token-center-wrap">
                      <div className="rs-amount-overlay rs-selected-token-amount">{formatTokenIdLabel(String(customTokenPreview.tokenId || ''))}</div>
                      {customTokenError ? <div className="rs-insufficient-mark">❗</div> : null}
                      <img
                        src={customTokenPreview.imgUrl || tokenIconUrl(8453, customTokenPreview.token || '')}
                        alt={customTokenPreview.symbol || 'NFT'}
                        className="rs-token-art rs-selected-token-icon"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fb = e.currentTarget.nextElementSibling;
                          if (fb) fb.style.display = 'flex';
                        }}
                      />
                      <div className="rs-selected-token-icon rs-token-fallback" style={{ display: 'none' }}>{tokenInitials(customTokenPreview.symbol || 'NFT')}</div>
                      <div className="rs-symbol-overlay rs-selected-token-symbol">{customTokenPreview.symbol || 'NFT'}</div>
                    </div>
                    {customTokenPreview?.ownerWallet ? (
                      <div className="rs-token-balance-note">Owner: {customTokenPreview.ownerDisplay || short(customTokenPreview.ownerWallet)}</div>
                    ) : null}
                  </div>
                ) : null}
                <input
                  className="rs-amount-input rs-counterparty-input"
                  placeholder="token id"
                  inputMode="text"
                  value={customTokenInput}
                  onChange={(e) => {
                    setCustomTokenInput(e.target.value);
                    if (customTokenError) setCustomTokenError('');
                    if (customTokenPreview) setCustomTokenPreview(null);
                    if (customTokenResolvedOption) setCustomTokenResolvedOption(null);
                  }}
                />
                {customTokenError ? <div className="rs-inline-error">{customTokenError}</div> : null}
                <button className="rs-btn rs-btn-positive rs-token-confirm-btn" onClick={onConfirmCustomTokenId} disabled={tokenModalLoading}>
                  {tokenModalLoading
                    ? 'Loading...'
                    : ((tokenModalPanel === 'signer' && makerMode && !parsed && !hasSpecificMakerCounterparty && customTokenResolvedOption)
                      ? 'Confirm'
                      : 'Lookup')}
                </button>
              </>
            ) : tokenModalStep === 'custom-amount' ? (
              <>
                <button className="rs-modal-back" onClick={() => { setTokenModalStep('custom-id'); setCustomTokenAmountInput(''); setCustomTokenError(''); }}>← Back</button>
                <div className="rs-modal-subtitle">Enter Amount</div>
                {customTokenResolvedOption ? (
                  <div className="rs-token-center" style={{ marginTop: 6, marginBottom: 6 }}>
                    <div className="rs-token-wrap rs-token-cell-wrap rs-token-center-wrap">
                      <div className="rs-amount-overlay rs-selected-token-amount">{renderAmountColored(customAmountDisplay)}</div>
                      {String(customTokenResolvedOption?.kind || '') === KIND_ERC1155 && customTokenResolvedOption?.tokenId ? (
                        <div className="rs-tokenid-overlay rs-selected-token-tokenid">{formatTokenIdLabel(String(customTokenResolvedOption.tokenId))}</div>
                      ) : null}
                      {custom1155Insufficient ? <div className="rs-insufficient-mark">❗</div> : null}
                      <img
                        src={customTokenResolvedOption.imgUrl || tokenIconUrl(8453, customTokenResolvedOption.token || '')}
                        alt={customTokenResolvedOption.symbol || 'NFT'}
                        className="rs-token-art rs-selected-token-icon"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fb = e.currentTarget.nextElementSibling;
                          if (fb) fb.style.display = 'flex';
                        }}
                      />
                      <div className="rs-selected-token-icon rs-token-fallback" style={{ display: 'none' }}>{tokenInitials(customTokenResolvedOption.symbol || 'NFT')}</div>
                      <div className="rs-symbol-overlay rs-selected-token-symbol">{customTokenResolvedOption.symbol || 'NFT'}</div>
                    </div>
                  </div>
                ) : null}
                {customFeeApplies ? <div style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>Total includes protocol fee</div> : null}
                <input
                  className="rs-amount-input rs-counterparty-input"
                  placeholder="amount"
                  inputMode="numeric"
                  value={customTokenAmountInput}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === '' || /^\d+$/.test(v)) setCustomTokenAmountInput(v);
                    if (customTokenError) setCustomTokenError('');
                  }}
                />
                {customTokenError ? <div className="rs-inline-error">{customTokenError}</div> : null}
                <button className="rs-btn rs-btn-positive rs-token-confirm-btn" onClick={onConfirmCustomTokenAmount}>
                  Confirm
                </button>
              </>
            ) : (
              <>
                <button className="rs-modal-back" onClick={() => setTokenModalStep('grid')}>← Back</button>
                <div className="rs-token-center">
                  <div className="rs-modal-wrap-row">
                    <div className="rs-token-wrap rs-token-cell-wrap rs-token-center-wrap">
                      <div className="rs-amount-overlay rs-selected-token-amount">{renderAmountColored(pendingAmountDisplay)}</div>
                      {pendingIsErc1155 && pendingToken?.tokenId ? (
                        <div className="rs-tokenid-overlay rs-selected-token-tokenid">{formatTokenIdLabel(String(pendingToken.tokenId))}</div>
                      ) : null}
                      {pendingInsufficient ? <div className="rs-insufficient-mark">❗</div> : null}
                      <img
                        key={`selected-${pendingToken?.imgUrl || pendingToken?.token || 'none'}`}
                        src={pendingToken?.imgUrl || tokenIconUrl(8453, pendingToken?.token || '') || ethIconUrl()}
                        alt={pendingToken?.symbol || 'TOKEN'}
                        className="rs-token-art rs-selected-token-icon"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fb = e.currentTarget.nextElementSibling;
                          if (fb) fb.style.display = 'flex';
                        }}
                      />
                      <div className="rs-token-art rs-token-fallback rs-selected-token-icon" style={{ display: 'none' }}>
                        {tokenInitials(pendingToken?.symbol || '??')}
                      </div>
                      <div className="rs-symbol-overlay rs-selected-token-symbol">{pendingToken?.symbol || 'TOKEN'}</div>
                    </div>

                    {pendingIsEth ? (
                      <>
                        <button type="button" className="rs-wrap-arrow" onClick={onModalWrapEth}>➡️</button>
                        <div className="rs-token-wrap rs-token-cell-wrap rs-token-center-wrap">
                          <div className="rs-amount-overlay rs-selected-token-amount">{renderAmountColored(pendingAmountDisplay)}</div>
                          <img
                            src={tokenIconUrl(8453, BASE_WETH) || ethIconUrl()}
                            alt="WETH"
                            className="rs-token-art rs-selected-token-icon"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fb = e.currentTarget.nextElementSibling;
                              if (fb) fb.style.display = 'flex';
                            }}
                          />
                          <div className="rs-token-art rs-token-fallback rs-selected-token-icon" style={{ display: 'none' }}>{tokenInitials('WETH')}</div>
                          <div className="rs-symbol-overlay rs-selected-token-symbol">WETH</div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
                {pendingFeeApplies ? <div style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>Total includes protocol fee</div> : null}
                {tokenAmountError ? <div className="rs-inline-error">{tokenAmountError}</div> : null}
                {isWrapping ? (
                  <div className="rs-loading-wrap" style={{ marginTop: 8 }}>
                    <div className="rs-loading-track">
                      <div className="rs-loading-fill" />
                      <div className="rs-loading-label">wrapping</div>
                    </div>
                  </div>
                ) : null}
                <input
                  className="rs-amount-input"
                  placeholder="Amount"
                  inputMode={pendingIsErc1155 ? 'numeric' : 'decimal'}
                  value={pendingAmount}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (pendingIsErc1155) {
                      if (v === '' || /^\d+$/.test(v)) setPendingAmount(v);
                    } else if (v === '' || /^\d*\.?\d*$/.test(v)) {
                      setPendingAmount(v);
                    }
                    if (tokenAmountError) setTokenAmountError('');
                  }}
                  onBlur={() => {
                    const n = Number(pendingAmount);
                    if (Number.isFinite(n) && n >= 0) {
                      setPendingAmount(String(pendingIsErc1155 ? Math.floor(n) : n));
                    } else if (pendingAmount !== '') setPendingAmount('');
                  }}
                  disabled={isWrapping}
                />
                <button
                  className="rs-btn rs-btn-positive rs-token-confirm-btn"
                  onClick={pendingIsEth ? onModalWrapEth : onConfirmTokenAmount}
                  disabled={isWrapping}
                >
                  {isWrapping ? 'Wrapping...' : (pendingIsEth && tokenModalPanel === 'sender' ? 'Wrap' : 'Confirm')}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="meta-block">
        <p>Status: {status}</p>
        {lastSwapTxHash ? (
          <p>
            Last swap tx:{' '}
            <a href={`https://basescan.org/tx/${lastSwapTxHash}`} target="_blank" rel="noreferrer">
              {`${lastSwapTxHash.slice(0, 10)}...`}
            </a>
          </p>
        ) : null}
        <p>Wallet: {address ? short(address) : 'not connected'}</p>
        {debugLog.length > 0 ? (
          <div>
            <p style={{ marginBottom: 6 }}>Debug log:</p>
            <ul style={{ marginTop: 0 }}>
              {debugLog.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}

function TradePanel({ title, titleLink, titleAvatarUrl, onTitleClick, onTitleClear, amount, symbol, footer, footerTone = 'ok', feeText, feeTone = 'ok', tokenAddress, tokenImage, tokenKind, tokenId, chainId, danger, editable = false, onEdit, insufficientBalance = false, wrapHint = false, wrapAmount = '', onWrap, wrapBusy = false, valueText = 'Value: Not found' }) {
  const icon = tokenImage || tokenIconUrl(chainId, tokenAddress || '');
  const ethIcon = ethIconUrl();
  const amountMatch = String(amount).match(/^(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);
  const valueMatch = String(valueText).match(/^Value:\s\$(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);
  const renderTitleAvatar = () => {
    if (!titleAvatarUrl) return null;
    return (
      <>
        <img
          key={`title-pfp-${titleAvatarUrl}`}
          src={titleAvatarUrl}
          alt={title}
          className="rs-title-pfp"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const fb = e.currentTarget.nextElementSibling;
            if (fb) fb.style.display = 'inline-flex';
          }}
        />
        <span key={`title-pfp-fallback-${titleAvatarUrl}`} className="rs-title-pfp rs-title-pfp-fallback" style={{ display: 'none' }}>?</span>
      </>
    );
  };

  return (
    <div className="rs-panel">
      <div className="rs-panel-title rs-panel-title-row">
        <span className="rs-panel-title-main">
          {titleLink ? (
            <a href={titleLink} target="_blank" rel="noreferrer" className="rs-title-link rs-title-with-pfp">
              {renderTitleAvatar()}
              <span>{title}</span>
            </a>
          ) : onTitleClick ? (
            <button className="rs-title-btn rs-title-with-pfp" onClick={onTitleClick}>
              {renderTitleAvatar()}
              <span>{title}</span>
            </button>
          ) : (
            <span className="rs-title-with-pfp">
              {renderTitleAvatar()}
              <span>{title}</span>
            </span>
          )}
        </span>
        {onTitleClear ? (
          <button className="rs-title-clear" aria-label="Clear private counterparty" onClick={onTitleClear}>✕</button>
        ) : null}
      </div>
      <div className={`rs-box ${danger ? 'rs-danger' : ''}`} onClick={editable ? onEdit : undefined}>
        <p className="rs-value">
          {valueMatch ? (
            <>Value: $<span className={suffixClass(valueMatch[2])}>{valueMatch[1]}</span><span className={`amt-sfx ${suffixClass(valueMatch[2])}`}>{valueMatch[2]}</span></>
          ) : valueText}
        </p>
        <div className="rs-asset-stage">
          <div className={`rs-token-wrap ${editable ? 'rs-token-editable' : ''}`}>
            <div className="rs-amount-overlay">
              {amountMatch ? (
                <><span className={suffixClass(amountMatch[2])}>{amountMatch[1]}</span><span className={`amt-sfx ${suffixClass(amountMatch[2])}`}>{amountMatch[2]}</span></>
              ) : (
                <>{amount}</>
              )}
            </div>
            {String(tokenKind || '') === KIND_ERC1155 && String(tokenId || '0') !== '0' ? (
              <div className="rs-tokenid-overlay rs-selected-token-tokenid">{formatTokenIdLabel(String(tokenId))}</div>
            ) : null}
            <div className="rs-symbol-overlay">{symbol || '???'}</div>
            {insufficientBalance ? <div className="rs-insufficient-mark">❗</div> : null}
            <a
              href={!editable && tokenAddress ? `https://basescan.org/token/${tokenAddress}` : undefined}
              target={!editable ? "_blank" : undefined}
              rel={!editable ? "noreferrer" : undefined}
              className="rs-token-link"
              onClick={editable ? (e) => e.preventDefault() : undefined}
            >
              {icon ? (
                <>
                  <img
                    key={`panel-${icon || 'none'}-${symbol || ''}`}
                    src={icon}
                    alt={symbol}
                    className="rs-token-art"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fb = e.currentTarget.nextElementSibling;
                      if (fb) fb.style.display = 'flex';
                    }}
                  />
                  <div className="rs-token-art rs-token-fallback" style={{ display: 'none' }}>{tokenInitials(symbol || '??')}</div>
                </>
              ) : <div className="rs-token-art rs-token-fallback">{tokenInitials(symbol || '??')}</div>}
            </a>
          </div>

          {wrapHint ? (
            <button type="button" className="rs-wrap-arrow" onClick={onWrap} disabled={wrapBusy}>⬅️</button>
          ) : null}

          {wrapHint ? (
            <div className="rs-token-wrap rs-token-wrap-secondary">
              <div className="rs-amount-overlay">
                {renderAmountColored(wrapAmount)}
              </div>
              <div className="rs-symbol-overlay">ETH</div>
              <img
                src={ethIcon}
                alt="ETH"
                className="rs-token-art rs-eth-art"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fb = e.currentTarget.nextElementSibling;
                  if (fb) fb.style.display = 'flex';
                }}
              />
              <div className="rs-token-art rs-token-fallback" style={{ display: 'none' }}>{tokenInitials('ETH')}</div>
            </div>
          ) : null}
        </div>
        {feeText ? <p className={feeTone === 'bad' ? 'rs-fee-note-bad' : 'rs-fee-note'}>{feeText}</p> : null}
        {footer ? <p className={footerTone === 'bad' ? 'rs-footer-bad' : 'rs-footer-ok'}>{footer}</p> : null}
      </div>
    </div>
  );
}
