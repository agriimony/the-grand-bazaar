'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { useAccount, useConnect, usePublicClient, useSendTransaction } from 'wagmi';
import { decodeCompressedOrder } from '../lib/orders';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender,uint256 amount) returns (bool)',
];
const ERC20_IFACE = new ethers.Interface(ERC20_ABI);
const WETH_IFACE = new ethers.Interface(['function deposit() payable']);

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function nonceUsed(address signer,uint256 nonce) view returns (bool)',
  'function swap(address recipient,uint256 maxRoyalty,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) external',
];
const SWAP_IFACE = new ethers.Interface(SWAP_ABI);

// removed duplicate abi block
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
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

function suffixClass(suffix = '') {
  const s = (suffix || '').toLowerCase();
  if (s === 'k') return 'amt-k';
  if (s === 'm') return 'amt-m';
  if (s === 'b') return 'amt-b';
  if (s === 't') return 'amt-t';
  if (s === 'q') return 'amt-q';
  return 'amt-n';
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
  const publicClient = usePublicClient();
  const [status, setStatus] = useState('ready');
  const [lastSwapTxHash, setLastSwapTxHash] = useState('');
  const [debugLog, setDebugLog] = useState([]);
  const [checks, setChecks] = useState(null);
  const [counterpartyName, setCounterpartyName] = useState('Counterparty');
  const [counterpartyProfileUrl, setCounterpartyProfileUrl] = useState('');
  const [autoConnectTried, setAutoConnectTried] = useState(false);
  const [isWrapping, setIsWrapping] = useState(false);
  const [makerMode, setMakerMode] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenModalLoading, setTokenModalLoading] = useState(false);
  const [tokenModalStep, setTokenModalStep] = useState('grid');
  const [tokenModalPanel, setTokenModalPanel] = useState('sender');
  const [tokenModalWallet, setTokenModalWallet] = useState('');
  const [tokenOptions, setTokenOptions] = useState([]);
  const [pendingToken, setPendingToken] = useState(null);
  const [pendingAmount, setPendingAmount] = useState('');
  const [makerOverrides, setMakerOverrides] = useState({});
  const [makerExpirySec, setMakerExpirySec] = useState(24 * 60 * 60);

  const dbg = (msg) => {
    setDebugLog((prev) => [...prev.slice(-30), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  };

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
        setCounterpartyName('Counterparty');
        setCounterpartyProfileUrl('');
        return;
      }
      try {
        const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(orderData.signerWallet)}`);
        const d = await r.json();
        const label = d?.name ? fitName(`@${d.name.replace(/^@/, '')}`) : (d?.fallback || short(orderData.signerWallet));
        setCounterpartyName(label || short(orderData.signerWallet));
        setCounterpartyProfileUrl(d?.profileUrl || '');
      } catch {
        setCounterpartyName(short(orderData.signerWallet));
        setCounterpartyProfileUrl('');
      }
    }
    resolveName();
  }, [orderData?.signerWallet]);

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

  function buildOrderForCall(requiredSenderKind) {
    if (!parsed) throw new Error('No order loaded');
    return {
      nonce: BigInt(parsed.nonce),
      expiry: BigInt(parsed.expiry),
      signer: {
        wallet: parsed.signerWallet,
        token: parsed.signerToken,
        kind: requiredSenderKind,
        id: 0n,
        amount: BigInt(parsed.signerAmount),
      },
      sender: {
        wallet: parsed.senderWallet,
        token: parsed.senderToken,
        kind: requiredSenderKind,
        id: 0n,
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
      const swap = new ethers.Contract(parsed.swapContract, SWAP_ABI, readProvider);
      const [requiredSenderKind, protocolFeeOnchain, nonceUsed] = await Promise.all([
        swap.requiredSenderKind(),
        swap.protocolFee(),
        swap.nonceUsed(parsed.signerWallet, parsed.nonce).catch(() => false),
      ]);

      const encodedProtocolFee = BigInt(parsed.protocolFee || 0);
      const onchainProtocolFee = BigInt(protocolFeeOnchain.toString());
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

      const senderOwner = address || parsed.senderWallet || ethers.ZeroAddress;
      const pairRead = await readPairBatch({
        signerToken: parsed.signerToken,
        signerOwner: parsed.signerWallet,
        senderToken: parsed.senderToken,
        senderOwner,
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
      const takerAllowance = senderRead.allowance;
      const connectedNorm = normalizeAddr(address);
      const ownerNorm = normalizeAddr(senderOwner);
      const ownerMatches = Boolean(connectedNorm) && connectedNorm === ownerNorm;
      const takerBalanceOk = ownerMatches ? takerBalance >= totalRequired : false;
      const takerApprovalOk = ownerMatches ? takerAllowance >= totalRequired : false;

      const senderIsWeth = normalizeAddr(parsed.senderToken) === BASE_WETH.toLowerCase();
      const wrapAmountNeeded = ownerMatches && senderIsWeth && takerBalance < totalRequired ? (totalRequired - takerBalance) : 0n;
      const takerEthBalance = ownerMatches && senderIsWeth ? await readProvider.getBalance(address) : 0n;
      const canWrapFromEth = wrapAmountNeeded > 0n && takerEthBalance >= wrapAmountNeeded;

      const baseChecks = {
        requiredSenderKind,
        nonceUsed: false,
        protocolFeeMismatch: false,
        ownerMatches,
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
    if (!parsed?.swapContract) {
      setStatus('order not loaded');
      return;
    }
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

    try {
      const rawAmount = ethers.parseUnits(String(amount), decimals);
      const sym = makerOverrides.senderSymbol || guessSymbol(token);
      setStatus(`approving ${sym}`);
      const approveData = ERC20_IFACE.encodeFunctionData('approve', [parsed.swapContract, rawAmount]);
      const txHash = await sendTransactionAsync({
        account: address,
        chainId: 8453,
        to: token,
        data: approveData,
        value: 0n,
      });
      setStatus(`approving ${sym}: confirming`);
      await waitForTxConfirmation({ publicClient, txHash });
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
    const panelWallet = panel === 'sender' ? parsed?.senderWallet : parsed?.signerWallet;
    const wallet = panelWallet || address || '';
    if (!wallet) {
      setStatus('connect wallet');
      return;
    }
    setTokenModalPanel(panel);
    setTokenModalWallet(wallet);
    setTokenModalOpen(true);
    setTokenModalStep('grid');
    setTokenModalLoading(true);
    dbg(`maker selector open panel=${panel} wallet=${wallet}`);

    const cacheKey = `gbz:zapper:${normalizeAddr(wallet)}`;
    const cacheTtlMs = 15 * 60 * 1000;

    try {
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
              dbg(`maker selector cache hit tokens=${hydrated.length} ageMs=${age}`);
              setTokenOptions(hydrated);
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

        dbg(`maker selector zapper tokens=${list.length}`);
        setTokenOptions(list);
        if (typeof window !== 'undefined') {
          try {
            const cacheTokens = list.map((t) => ({ ...t, availableRaw: typeof t.availableRaw === 'bigint' ? t.availableRaw.toString() : String(t.availableRaw || '0') }));
            window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tokens: cacheTokens }));
          } catch {
            // ignore cache write failures
          }
        }
        return;
      }
      dbg(`maker selector zapper fallback reason=${zd?.error || zr.status}`);

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

      const nonzero = rawRows.filter((r) => r && r.balance > 0n);
      const withUsd = await mapInChunks(nonzero, 5, async (r) => {
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

      const list = withUsd.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
      dbg(`maker selector rows=${rawRows.length} nonzero=${list.length}`);
      setTokenOptions(list);
    } finally {
      setTokenModalLoading(false);
    }
  }

  function onTokenSelect(option) {
    setPendingToken(option);
    setPendingAmount('');
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

  async function onAddCustomToken() {
    const tokenInput = prompt('Token contract address');
    if (!tokenInput) return;

    let tokenAddr = '';
    try {
      tokenAddr = ethers.getAddress(tokenInput.trim()).toLowerCase();
    } catch {
      setStatus('invalid token address');
      return;
    }

    try {
      setTokenModalLoading(true);
      const option = await fetchTokenOption(tokenAddr, tokenModalWallet);
      setTokenOptions((prev) => {
        const dedup = prev.filter((t) => t.token !== tokenAddr);
        return [option, ...dedup];
      });
      onTokenSelect(option);
    } catch (e) {
      setStatus('custom token lookup failed');
      dbg(`custom token lookup failed ${tokenAddr}: ${errText(e)}`);
    } finally {
      setTokenModalLoading(false);
    }
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

    setMakerOverrides((prev) => ({
      ...prev,
      [`${panel}Token`]: pendingToken.token,
      [`${panel}Symbol`]: pendingToken.symbol,
      [`${panel}Decimals`]: pendingToken.decimals,
      [`${panel}ImgUrl`]: pendingToken.imgUrl || null,
      [`${panel}AvailableRaw`]: typeof pendingToken.availableRaw === 'bigint' ? pendingToken.availableRaw.toString() : String(pendingToken.availableRaw || '0'),
      [`${panel}Amount`]: pendingAmount,
      [`${panel}Usd`]: selectedUsd,
    }));
    setTokenModalOpen(false);
    setPendingToken(null);
    setPendingAmount('');
  }

  function loadOrder() {
    try {
      const decoded = decodeCompressedOrder(compressed.trim());
      setOrderData(decoded);
      setChecks(null);
      setMakerMode(false);
      setMakerOverrides({});
      setStatus('order loaded');
    } catch (e) {
      setStatus('order not found');
      setOrderData(null);
    }
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
  const protocolFeeBpsFallback = parsed ? BigInt(parsed.protocolFee || 0) : 0n;
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
  const pendingAmountDisplay = pendingAmount ? formatTokenAmount(pendingAmount) : (pendingToken?.amountDisplay || '0');
  const pendingIsEth = isEthLikeToken(pendingToken);
  const pendingAvailableNum = Number(pendingToken?.availableAmount ?? NaN);
  const pendingInsufficient =
    Number.isFinite(pendingAmountNum)
    && pendingAmountNum > 0
    && Number.isFinite(pendingAvailableNum)
    && pendingAvailableNum >= 0
    && pendingAmountNum > (pendingAvailableNum + 1e-12);

  const yourAmountDisplayFinal = makerOverrides.senderAmount
    ? formatTokenAmount(makerOverrides.senderAmount)
    : yourAmountDisplay;

  let counterpartyAmountDisplayFinal = makerOverrides.signerAmount
    ? formatTokenAmount(makerOverrides.signerAmount)
    : counterpartyAmountDisplay;
  if (makerMode && makerOverrides.signerAmount) {
    const n = Number(makerOverrides.signerAmount);
    if (Number.isFinite(n) && n >= 0) {
      const withFee = n * (1 + Number(uiProtocolFeeBps) / 10000);
      counterpartyAmountDisplayFinal = formatTokenAmount(String(withFee));
    }
  }

  const senderTokenAddressFinal = makerOverrides.senderToken || parsed?.senderToken;
  const signerTokenAddressFinal = makerOverrides.signerToken || parsed?.signerToken;
  const senderTokenImgFinal = makerOverrides.senderImgUrl || null;
  const signerTokenImgFinal = makerOverrides.signerImgUrl || null;

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
      const inRaw = makerOverrides.signerAmount ? ethers.parseUnits(String(makerOverrides.signerAmount), dec) : 0n;
      const availRaw = BigInt(makerOverrides.signerAvailableRaw || '0');
      makerSignerInsufficient = inRaw > 0n && inRaw > availRaw;
    } catch {}
  }

  return (
    <>
      <section className="rs-window">
        <div className="rs-topbar">Trading with {parsed ? counterpartyName : 'Counterparty'}</div>

        <div className="rs-grid">
          <TradePanel
            title="You offer"
            amount={yourAmountDisplayFinal}
            symbol={senderSymbolDisplay}
            tokenAddress={senderTokenAddressFinal}
            tokenImage={senderTokenImgFinal}
            chainId={parsed?.chainId}
            editable={makerMode}
            onEdit={() => openTokenSelector('sender')}
            danger={makerMode ? makerSenderInsufficient : Boolean(checks && !checks.takerBalanceOk)}
            insufficientBalance={makerMode ? makerSenderInsufficient : Boolean(checks && !checks.takerBalanceOk)}
            valueText={yourValueTextFinal}
            feeText={makerMode ? '' : checks?.protocolFeeMismatch
              ? 'Incorrect protocol fees'
              : checks?.protocolFeeBps != null
              ? `incl. ${(Number(checks.protocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
              : parsed
              ? `incl. ${(Number(protocolFeeBpsFallback) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
              : ''}
            feeTone={checks?.protocolFeeMismatch ? 'bad' : 'ok'}
            wrapHint={showWrapHint}
            wrapAmount={showWrapHint ? formatTokenAmount(ethers.formatUnits(wrapAmountNeeded, 18)) : ''}
            onWrap={onWrapFromEth}
            wrapBusy={isWrapping}
            footer={makerMode
              ? 'You have not yet accepted'
              : checks
              ? checks.takerBalanceOk && checks.takerApprovalOk
                ? 'You have accepted'
                : 'You have not yet accepted'
              : ''}
            footerTone={makerMode
              ? 'bad'
              : checks
              ? checks.takerBalanceOk && checks.takerApprovalOk
                ? 'ok'
                : 'bad'
              : 'ok'}
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
              <div className="rs-order-blocked">Wrong Wallet!</div>
            ) : isExpired || isTaken ? (
              <div className="rs-order-blocked">
                {isExpired ? 'Order Expired!' : 'Order Already Taken!'}
              </div>
            ) : showLoadingBar ? (
              <div className="rs-loading-wrap">
                <div className="rs-loading-track">
                  <div className="rs-loading-fill" />
                  <div className="rs-loading-label">{loadingStage}</div>
                </div>
              </div>
            ) : makerMode ? (
              <div className="rs-btn-stack">
                <button
                  className={`rs-btn ${makerSenderInsufficient ? '' : 'rs-btn-positive'}`}
                  onClick={onMakerApprove}
                  disabled={makerSenderInsufficient}
                >
                  {makerSenderInsufficient ? 'Insufficient balance' : 'Approve'}
                </button>
                <button className="rs-btn" onClick={cycleMakerExpiry}>{makerExpiryLabel(makerExpirySec)}</button>
              </div>
            ) : (
              <div className="rs-btn-stack">
                <button className={`rs-btn ${primaryLabel === 'Connect' || primaryLabel === 'Approve' || primaryLabel === 'Swap' || primaryLabel === 'Wrap' ? 'rs-btn-positive' : ''} ${isErrorState ? 'rs-btn-error' : ''}`} onClick={onPrimaryAction} disabled={isExpired || isTaken || isProtocolFeeMismatch}>{primaryLabel}</button>
                <button className="rs-btn decline" onClick={() => { setMakerMode(true); setMakerExpirySec(24 * 60 * 60); setMakerOverrides((prev) => ({ ...prev, expirySec: 24 * 60 * 60 })); setStatus('maker flow'); }}>Decline</button>
              </div>
            )}
          </div>

          <TradePanel
            title={`${fitOfferName(counterpartyName)} offers`}
            titleLink={counterpartyProfileUrl}
            amount={counterpartyAmountDisplayFinal}
            symbol={signerSymbolDisplay}
            tokenAddress={signerTokenAddressFinal}
            tokenImage={signerTokenImgFinal}
            chainId={parsed?.chainId}
            editable={makerMode}
            onEdit={() => openTokenSelector('signer')}
            danger={makerMode ? makerSignerInsufficient : Boolean(checks && !checks.makerBalanceOk)}
            insufficientBalance={makerMode ? makerSignerInsufficient : Boolean(checks && !checks.makerBalanceOk)}
            valueText={counterpartyValueTextFinal}
            feeText={makerMode
              ? `incl. ${(Number(uiProtocolFeeBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}% protocol fees`
              : ''}
            feeTone={checks?.protocolFeeMismatch ? 'bad' : 'ok'}
            footer={makerMode
              ? `${fitOfferName(counterpartyName)} has not yet accepted`
              : checks
              ? checks.makerAccepted
                ? `${fitOfferName(counterpartyName)} accepted`
                : `${fitOfferName(counterpartyName)} has not yet accepted`
              : ''}
            footerTone={makerMode
              ? 'bad'
              : checks
              ? checks.makerAccepted
                ? 'ok'
                : 'bad'
              : 'ok'}
          />
        </div>
      </section>

      {tokenModalOpen ? (
        <div className="rs-modal-backdrop">
          <div className="rs-modal rs-panel">
            <button className="rs-modal-close" onClick={() => setTokenModalOpen(false)}>✕</button>
            {tokenModalStep === 'grid' ? (
              <>
                <div className="rs-modal-titlebar">{tokenModalPanel === 'sender' ? 'Your Inventory' : `${fitOfferName(counterpartyName)}'s Inventory`}</div>
                {tokenModalLoading ? (
                  <div className="rs-loading-wrap">
                    <div className="rs-loading-track">
                      <div className="rs-loading-fill" />
                      <div className="rs-loading-label">loading tokens</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {tokenOptions.length === 0 ? <p>No supported tokens with balance found for {short(tokenModalWallet)}</p> : null}
                    <div className="rs-token-grid-wrap">
                      <div className="rs-token-grid">
                        {tokenOptions.slice(0, 23).map((t) => (
                          <button key={t.token} className="rs-token-cell" onClick={() => onTokenSelect(t)}>
                            <div className="rs-token-wrap rs-token-cell-wrap">
                              <div className="rs-amount-overlay rs-token-cell-amount">{t.amountDisplay}</div>
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
                              <div className="rs-symbol-overlay rs-token-cell-symbol">{t.symbol}</div>
                            </div>
                          </button>
                        ))}
                        <button className="rs-token-cell rs-token-cell-plus" onClick={onAddCustomToken}>+</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <button className="rs-modal-back" onClick={() => setTokenModalStep('grid')}>← Back</button>
                <div className="rs-token-center">
                  <div className="rs-modal-wrap-row">
                    <div className="rs-token-wrap rs-token-cell-wrap rs-token-center-wrap">
                      <div className="rs-amount-overlay rs-selected-token-amount">{pendingAmountDisplay}</div>
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
                          <div className="rs-amount-overlay rs-selected-token-amount">{pendingAmountDisplay}</div>
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
                  inputMode="decimal"
                  value={pendingAmount}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setPendingAmount(v);
                  }}
                  onBlur={() => {
                    const n = Number(pendingAmount);
                    if (Number.isFinite(n) && n >= 0) setPendingAmount(String(n));
                    else if (pendingAmount !== '') setPendingAmount('');
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
        <div style={{ display: 'grid', gap: 8 }}>
          <label htmlFor="order">Compressed order</label>
          <textarea id="order" name="order" rows={5} value={compressed} onChange={(e) => setCompressed(e.target.value)} placeholder="Paste compressed order" />
          <button type="button" onClick={loadOrder}>Load into trade window</button>
        </div>
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

function TradePanel({ title, titleLink, amount, symbol, footer, footerTone = 'ok', feeText, feeTone = 'ok', tokenAddress, tokenImage, chainId, danger, editable = false, onEdit, insufficientBalance = false, wrapHint = false, wrapAmount = '', onWrap, wrapBusy = false, valueText = 'Value: Not found' }) {
  const icon = tokenImage || tokenIconUrl(chainId, tokenAddress || '');
  const ethIcon = ethIconUrl();
  const amountMatch = String(amount).match(/^(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);
  const valueMatch = String(valueText).match(/^Value:\s\$(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{titleLink ? <a href={titleLink} target="_blank" rel="noreferrer" className="rs-title-link">{title}</a> : title}</div>
      <div className={`rs-box ${danger ? 'rs-danger' : ''}`} onClick={editable ? onEdit : undefined}>
        <p className="rs-value">
          {valueMatch ? (
            <>Value: ${valueMatch[1]}<span className={`amt-sfx ${suffixClass(valueMatch[2])}`}>{valueMatch[2]}</span></>
          ) : valueText}
        </p>
        <div className="rs-asset-stage">
          <div className={`rs-token-wrap ${editable ? 'rs-token-editable' : ''}`}>
            <div className="rs-amount-overlay">
              {amountMatch ? (
                <>{amountMatch[1]}<span className={`amt-sfx ${suffixClass(amountMatch[2])}`}>{amountMatch[2]}</span></>
              ) : (
                <>{amount}</>
              )}
            </div>
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
                {wrapAmount}
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
