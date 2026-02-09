'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { decodeCompressedOrder } from '../lib/orders';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender,uint256 amount) returns (bool)',
];

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function swap(address recipient,uint256 maxRoyalty,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) external',
];

const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
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

  // Prefer 4-digit integer style when possible, e.g. 1.234M -> 1234k
  if (Math.abs(scaled) < 1000 && tier > 0) {
    const downScaled = n / Math.pow(1000, tier - 1);
    if (Math.abs(downScaled) < 10000) {
      tier -= 1;
      scaled = downScaled;
    }
  }

  const rounded = Math.round(scaled);
  return { number: String(rounded), suffix: suffixes[tier] };
}

function formatTokenAmount(value) {
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

function isStableToken(addr = '') {
  const a = (addr || '').toLowerCase();
  return a === BASE_USDC.toLowerCase();
}

function guessSymbol(addr = '') {
  const a = (addr || '').toLowerCase();
  if (a === BASE_USDC.toLowerCase()) return 'USDC';
  if (a === '0x4200000000000000000000000000000000000006') return 'WETH';
  return 'TOKEN';
}

function guessDecimals(addr = '') {
  const a = (addr || '').toLowerCase();
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
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('ready');
  const [checks, setChecks] = useState(null);
  const [counterpartyName, setCounterpartyName] = useState('Counterparty');
  const [autoConnectTried, setAutoConnectTried] = useState(false);

  useEffect(() => {
    async function loadFromCastHash() {
      if (initialCompressed || !initialCastHash) return;
      try {
        setStatus('loading order from cast hash');
        const r = await fetch(`/api/order-from-cast?castHash=${encodeURIComponent(initialCastHash)}`);
        const d = await r.json();
        if (!r.ok || !d?.compressedOrder) {
          setStatus(`cast decode error: ${d?.error || 'order not found'}`);
          return;
        }
        const decoded = decodeCompressedOrder(d.compressedOrder);
        setCompressed(d.compressedOrder);
        setOrderData(decoded);
        setChecks(null);
        setStatus('order loaded from cast');
      } catch {
        setStatus('cast decode error: failed to load from cast hash');
      }
    }
    loadFromCastHash();
  }, [initialCastHash, initialCompressed]);

  useEffect(() => {
    async function resolveName() {
      if (!orderData?.signerWallet) {
        setCounterpartyName('Counterparty');
        return;
      }
      try {
        const r = await fetch(`/api/farcaster-name?address=${encodeURIComponent(orderData.signerWallet)}`);
        const d = await r.json();
        const label = d?.name ? fitName(`@${d.name.replace(/^@/, '')}`) : (d?.fallback || short(orderData.signerWallet));
        setCounterpartyName(label || short(orderData.signerWallet));
      } catch {
        setCounterpartyName(short(orderData.signerWallet));
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
      setStatus('wallet connected');
      await sdk?.actions?.ready?.();
    } catch (e) {
      setStatus(`connect error: ${e.message}`);
    }
  }

  useEffect(() => {
    async function autoConnectIfMiniApp() {
      if (autoConnectTried || address) return;
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        const inMiniApp = await sdk?.isInMiniApp?.();
        if (inMiniApp) {
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
  }, [autoConnectTried, address]);

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
    if (!parsed) return;
    try {
      setStatus('checking order');
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org');
      const swap = new ethers.Contract(parsed.swapContract, SWAP_ABI, readProvider);
      const [requiredSenderKind, protocolFeeOnchain] = await Promise.all([
        swap.requiredSenderKind(),
        swap.protocolFee(),
      ]);

      const signerToken = new ethers.Contract(parsed.signerToken, ERC20_ABI, readProvider);
      const senderToken = new ethers.Contract(parsed.senderToken, ERC20_ABI, readProvider);

      const [signerBal, signerAllow, signerSymbol, signerDecimals] = await Promise.all([
        signerToken.balanceOf(parsed.signerWallet),
        signerToken.allowance(parsed.signerWallet, parsed.swapContract),
        signerToken.symbol().catch(() => 'TOKEN'),
        signerToken.decimals().catch(() => 18),
      ]);

      const [senderSymbol, senderDecimals] = await Promise.all([
        senderToken.symbol().catch(() => 'TOKEN'),
        senderToken.decimals().catch(() => 18),
      ]);

      const makerBalanceOk = signerBal >= BigInt(parsed.signerAmount);
      const makerApprovalOk = signerAllow >= BigInt(parsed.signerAmount);
      const makerAccepted = makerBalanceOk && makerApprovalOk;

      const protocolFee = BigInt(protocolFeeOnchain.toString());
      const senderAmount = BigInt(parsed.senderAmount);
      const feeAmount = (senderAmount * protocolFee) / 10000n;
      const totalRequired = senderAmount + feeAmount;

      const [signerUsdValue, senderUsdValue] = await Promise.all([
        quoteUsdValue(readProvider, parsed.signerToken, BigInt(parsed.signerAmount), signerDecimals),
        quoteUsdValue(readProvider, parsed.senderToken, totalRequired, senderDecimals),
      ]);

      let takerBalance = 0n;
      let takerAllowance = 0n;
      let takerBalanceOk = false;
      let takerApprovalOk = false;

      if (provider && address) {
        const senderTokenW = new ethers.Contract(parsed.senderToken, ERC20_ABI, provider);
        takerBalance = await senderTokenW.balanceOf(address);
        takerAllowance = await senderTokenW.allowance(address, parsed.swapContract);
        takerBalanceOk = takerBalance >= totalRequired;
        takerApprovalOk = takerAllowance >= totalRequired;
      }

      setChecks({
        requiredSenderKind,
        signerSymbol,
        senderSymbol,
        signerDecimals,
        senderDecimals,
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
      });
      setStatus('checks complete');
    } catch (e) {
      setStatus(`check error: ${e.message}`);
    }
  }

  async function onPrimaryAction() {
    if (!provider || !address) {
      await connectWallet();
      return;
    }
    if (!parsed || !checks) return;

    try {
      const signer = await provider.getSigner();
      const senderToken = new ethers.Contract(parsed.senderToken, ERC20_ABI, signer);
      const swap = new ethers.Contract(parsed.swapContract, SWAP_ABI, signer);

      if (!checks.takerBalanceOk) {
        setStatus('insufficient balance');
        return;
      }

      if (!checks.takerApprovalOk) {
        setStatus('sending approve tx');
        const tx = await senderToken.approve(parsed.swapContract, checks.totalRequired);
        await tx.wait();
        setStatus(`approve confirmed: ${tx.hash.slice(0, 10)}...`);
        await runChecks();
        return;
      }

      setStatus('sending swap tx');
      const orderForCall = buildOrderForCall(checks.requiredSenderKind);
      const estimatedGas = await swap.swap.estimateGas(address, 0, orderForCall);
      const gasLimitCap = 400000n;
      if (estimatedGas > gasLimitCap) throw new Error(`Gas estimate too high: ${estimatedGas}`);
      const gasLimit = (estimatedGas * 120n) / 100n;
      const tx = await swap.swap(address, 0, orderForCall, { gasLimit });
      await tx.wait();
      setStatus(`swap confirmed: ${tx.hash.slice(0, 10)}...`);
      await runChecks();
    } catch (e) {
      setStatus(`action error: ${e.message}`);
    }
  }

  function loadOrder() {
    try {
      const decoded = decodeCompressedOrder(compressed.trim());
      setOrderData(decoded);
      setChecks(null);
      setStatus('order loaded');
    } catch (e) {
      setStatus(`decode error: ${e.message}`);
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

  const primaryLabel = !address
    ? 'Connect'
    : checks?.takerBalanceOk === false
    ? 'Insufficient Balance'
    : checks?.takerApprovalOk
    ? 'Accept'
    : 'Approve';

  return (
    <>
      <section className="rs-window">
        <div className="rs-topbar">Trading with {parsed ? counterpartyName : 'Counterparty'}</div>

        <div className="rs-grid">
          <TradePanel
            title="Your Offer"
            amount={checks ? formatTokenAmount(ethers.formatUnits(checks.totalRequired, checks.senderDecimals)) : '—'}
            symbol={checks?.senderSymbol || 'TOKEN'}
            tokenAddress={parsed?.senderToken}
            chainId={parsed?.chainId}
            danger={Boolean(checks && !checks.takerBalanceOk)}
            valueText={checks?.senderUsdValue != null ? `Value: $${formatTokenAmount(checks.senderUsdValue)}` : 'Value: Not found'}
            feeText={checks ? `Includes ${formatTokenAmount(ethers.formatUnits(checks.feeAmount, checks.senderDecimals))} ${checks.senderSymbol} protocol fee (${checks.protocolFeeBps.toString()} bps)` : ''}
            footer={checks?.takerApprovalOk ? 'You have accepted' : ''}
          />

          <div className="rs-center">
            <div className="rs-btn-stack">
              <button className="rs-btn" onClick={onPrimaryAction}>{primaryLabel}</button>
              <button className="rs-btn decline" disabled>Decline</button>
            </div>
          </div>

          <TradePanel
            title="Counterparty Offer"
            amount={checks ? formatTokenAmount(ethers.formatUnits(checks.signerAmount, checks.signerDecimals)) : '—'}
            symbol={checks?.signerSymbol || 'TOKEN'}
            tokenAddress={parsed?.signerToken}
            chainId={parsed?.chainId}
            danger={Boolean(checks && !checks.makerBalanceOk)}
            valueText={checks?.signerUsdValue != null ? `Value: $${formatTokenAmount(checks.signerUsdValue)}` : 'Value: Not found'}
            footer={checks?.makerAccepted ? 'Counterparty has accepted' : ''}
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
        <p>Wallet: {address ? short(address) : 'not connected'}</p>
      </div>
    </>
  );
}

function TradePanel({ title, amount, symbol, footer, feeText, tokenAddress, chainId, danger, valueText = 'Value: Not found' }) {
  const icon = tokenIconUrl(chainId, tokenAddress || '');
  const amountMatch = String(amount).match(/^(-?\d+)([kMBTQ]?)$/);
  const valueMatch = String(valueText).match(/^Value:\s\$(-?\d+)([kMBTQ]?)$/);

  return (
    <div className="rs-panel">
      <div className="rs-panel-title">{title}</div>
      <div className={`rs-box ${danger ? 'rs-danger' : ''}`}>
        <p className="rs-value">
          {valueMatch ? (
            <>Value: ${valueMatch[1]}<span className={`amt-sfx ${suffixClass(valueMatch[2])}`}>{valueMatch[2]}</span></>
          ) : valueText}
        </p>
        <div className="rs-asset-stage">
          <div className="rs-item rs-item-overlay">
            {amountMatch ? (
              <>{amountMatch[1]}<span className={`amt-sfx ${suffixClass(amountMatch[2])}`}>{amountMatch[2]}</span> {symbol}</>
            ) : (
              <>{amount} {symbol}</>
            )}
          </div>
          <a
            href={tokenAddress ? `https://basescan.org/token/${tokenAddress}` : undefined}
            target="_blank"
            rel="noreferrer"
            className="rs-token-link"
          >
            {icon ? <img src={icon} alt={symbol} className="rs-token-art" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <div className="rs-token-art rs-token-fallback">{symbol}</div>}
          </a>
        </div>
        {feeText ? <p className="rs-fee-note">{feeText}</p> : null}
        {footer ? <p className="rs-footer-ok">{footer}</p> : null}
      </div>
    </div>
  );
}
