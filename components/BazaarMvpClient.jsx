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
const FEE_TIERS = [500, 3000, 10000];

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

function canonAddr(addr = '') {
  try {
    return ethers.getAddress(String(addr || '').trim()).toLowerCase();
  } catch {
    return String(addr || '').trim().toLowerCase();
  }
}

function isStableToken(addr = '') {
  const a = canonAddr(addr);
  return a === BASE_USDC.toLowerCase();
}

function guessSymbol(addr = '') {
  const a = canonAddr(addr);
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
    if (isStableToken(token)) {
      return Number(ethers.formatUnits(amountRaw, 6));
    }

    const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, readProvider);
    for (const fee of FEE_TIERS) {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: token,
          tokenOut: BASE_USDC,
          amountIn: amountRaw,
          fee,
          sqrtPriceLimitX96: 0,
        });
        return Number(ethers.formatUnits(amountOut, 6));
      } catch {
        // try next fee tier
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
    if (Number(chainId) === 8453) {
      return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksum}/logo.png`;
    }
  } catch {}
  return '';
}

function ethIconUrl() {
  return '/eth-icon.png';
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
  try {
    return ethers.getAddress(a).toLowerCase();
  } catch {
    return String(a || '').toLowerCase();
  }
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

  const dbg = (msg) => {
    setDebugLog((prev) => [...prev.slice(-7), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
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
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org');
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

      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org');
      const swap = new ethers.Contract(parsed.swapContract, SWAP_ABI, readProvider);

      if (!latestChecks.takerBalanceOk) {
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

  function loadOrder() {
    try {
      const decoded = decodeCompressedOrder(compressed.trim());
      setOrderData(decoded);
      setChecks(null);
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
    ? 'Insufficient Balance'
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
    : /approving/i.test(status)
    ? status
    : /simulating swap|sending swap tx|swapping/i.test(status)
    ? 'swapping'
    : '';
  const showLoadingBar = Boolean(loadingStage) && (!checks || /approving|simulating swap|sending swap tx|swapping|checking order|checking wallet|connecting wallet|loading order/i.test(status));

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
    : '—';

  const counterpartyAmountDisplay = hasCheckAmounts
    ? formatTokenAmount(ethers.formatUnits(checks.signerAmount, checks.signerDecimals))
    : parsed
    ? formatTokenAmount(ethers.formatUnits(parsed.signerAmount, signerDecimalsFallback))
    : '—';

  const senderSymbolDisplay = checks?.senderSymbol || (parsed ? guessSymbol(parsed.senderToken) : 'TOKEN');
  const signerSymbolDisplay = checks?.signerSymbol || (parsed ? guessSymbol(parsed.signerToken) : 'TOKEN');
  const wrapAmountNeeded = typeof checks?.wrapAmountNeeded === 'bigint' ? checks.wrapAmountNeeded : 0n;
  const showWrapHint = Boolean(checks?.canWrapFromEth) && wrapAmountNeeded > 0n;

  return (
    <>
      <section className="rs-window">
        <div className="rs-topbar">Trading with {parsed ? counterpartyName : 'Counterparty'}</div>

        <div className="rs-grid">
          <TradePanel
            title="Your Offer"
            amount={yourAmountDisplay}
            symbol={senderSymbolDisplay}
            tokenAddress={parsed?.senderToken}
            chainId={parsed?.chainId}
            danger={Boolean(checks && !checks.takerBalanceOk)}
            insufficientBalance={Boolean(checks && !checks.takerBalanceOk)}
            valueText={checks?.senderUsdValue != null ? `Value: $${formatTokenAmount(checks.senderUsdValue)}` : 'Value: Not found'}
            feeText={checks?.protocolFeeMismatch
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
            footer={checks
              ? checks.takerBalanceOk && checks.takerApprovalOk
                ? 'You have accepted'
                : 'You have not yet accepted'
              : ''}
            footerTone={checks
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
            ) : (
              <div className="rs-btn-stack">
                <button className={`rs-btn ${primaryLabel === 'Connect' || primaryLabel === 'Approve' || primaryLabel === 'Swap' ? 'rs-btn-positive' : ''} ${isErrorState ? 'rs-btn-error' : ''}`} onClick={onPrimaryAction} disabled={isExpired || isTaken || isProtocolFeeMismatch}>{primaryLabel}</button>
                <button className="rs-btn decline" disabled>Decline</button>
              </div>
            )}
          </div>

          <TradePanel
            title={`${fitOfferName(counterpartyName)}'s Offer`}
            titleLink={counterpartyProfileUrl}
            amount={counterpartyAmountDisplay}
            symbol={signerSymbolDisplay}
            tokenAddress={parsed?.signerToken}
            chainId={parsed?.chainId}
            danger={Boolean(checks && !checks.makerBalanceOk)}
            insufficientBalance={Boolean(checks && !checks.makerBalanceOk)}
            valueText={checks?.signerUsdValue != null ? `Value: $${formatTokenAmount(checks.signerUsdValue)}` : 'Value: Not found'}
            footer={checks
              ? checks.makerAccepted
                ? `${fitOfferName(counterpartyName)} accepted`
                : `${fitOfferName(counterpartyName)} has not yet accepted`
              : ''}
            footerTone={checks
              ? checks.makerAccepted
                ? 'ok'
                : 'bad'
              : 'ok'}
          />
        </div>
      </section>

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

function TradePanel({ title, titleLink, amount, symbol, footer, footerTone = 'ok', feeText, feeTone = 'ok', tokenAddress, chainId, danger, insufficientBalance = false, wrapHint = false, wrapAmount = '', onWrap, wrapBusy = false, valueText = 'Value: Not found' }) {
  const icon = tokenIconUrl(chainId, tokenAddress || '');
  const ethIcon = ethIconUrl();
  const amountMatch = String(amount).match(/^(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);
  const valueMatch = String(valueText).match(/^Value:\s\$(-?\d+(?:\.\d+)?)([kMBTQ]?)$/);

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{titleLink ? <a href={titleLink} target="_blank" rel="noreferrer" className="rs-title-link">{title}</a> : title}</div>
      <div className={`rs-box ${danger ? 'rs-danger' : ''}`}>
        <p className="rs-value">
          {valueMatch ? (
            <>Value: ${valueMatch[1]}<span className={`amt-sfx ${suffixClass(valueMatch[2])}`}>{valueMatch[2]}</span></>
          ) : valueText}
        </p>
        <div className="rs-asset-stage">
          <div className="rs-token-wrap">
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
              href={tokenAddress ? `https://basescan.org/token/${tokenAddress}` : undefined}
              target="_blank"
              rel="noreferrer"
              className="rs-token-link"
            >
              {icon ? <img src={icon} alt={symbol} className="rs-token-art" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <div className="rs-token-art rs-token-fallback">{symbol || '???'}</div>}
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
              <img src={ethIcon} alt="ETH" className="rs-token-art rs-eth-art" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          ) : null}
        </div>
        {feeText ? <p className={feeTone === 'bad' ? 'rs-fee-note-bad' : 'rs-fee-note'}>{feeText}</p> : null}
        {footer ? <p className={footerTone === 'bad' ? 'rs-footer-bad' : 'rs-footer-ok'}>{footer}</p> : null}
      </div>
    </div>
  );
}
