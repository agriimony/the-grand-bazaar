import { ImageResponse } from 'next/og';
import { ethers } from 'ethers';
import { decodeCompressedOrder } from '../../../lib/orders';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const TOKEN_META = {
  // Base common tokens
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xcb327b99ff831bf8223cced12b1338ff3aa322ff': { symbol: 'USDbC', decimals: 6 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
};

function qp(url, key, fallback = '') {
  return (url.searchParams.get(key) || fallback).trim();
}

function clampText(v, max = 24) {
  const s = String(v || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function shortAddr(a = '') {
  const s = String(a || '');
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function guessMeta(addr = '') {
  const k = String(addr || '').toLowerCase();
  const m = TOKEN_META[k];
  if (m) return m;
  return { symbol: shortAddr(addr), decimals: 18 };
}

function formatAmount(raw, decimals) {
  try {
    const v = ethers.formatUnits(BigInt(raw), decimals);
    const n = Number(v);
    if (!Number.isFinite(n)) return clampText(v, 14);
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2).replace(/\.00$/, '')}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2).replace(/\.00$/, '')}k`;
    if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, '');
    return n.toPrecision(3).replace(/\.?0+$/, '');
  } catch {
    return '-';
  }
}

function sideText({ amount, symbol, x }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 320,
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ color: '#fff', fontSize: 76, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{amount}</div>
      <div style={{ color: '#fff', fontSize: 62, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{symbol}</div>
    </div>
  );
}

export async function GET(req) {
  const url = new URL(req.url);

  let signerAmount = clampText(qp(url, 'signerAmount', '-'), 14);
  let signerSymbol = clampText(qp(url, 'signerSymbol', 'TOKEN'), 10);
  let senderAmount = clampText(qp(url, 'senderAmount', '-'), 14);
  let senderSymbol = clampText(qp(url, 'senderSymbol', 'TOKEN'), 10);

  const castHash = qp(url, 'castHash', '');
  if (castHash) {
    try {
      const orderRes = await fetch(`${url.origin}/api/order-from-cast?castHash=${encodeURIComponent(castHash)}`, {
        cache: 'no-store',
      });
      const orderData = await orderRes.json();
      if (orderRes.ok && orderData?.ok && orderData?.compressedOrder) {
        const parsed = decodeCompressedOrder(orderData.compressedOrder);
        const signerMeta = guessMeta(parsed.signerToken);
        const senderMeta = guessMeta(parsed.senderToken);
        signerAmount = clampText(formatAmount(parsed.signerAmount, signerMeta.decimals), 14);
        senderAmount = clampText(formatAmount(parsed.senderAmount, senderMeta.decimals), 14);
        signerSymbol = clampText(signerMeta.symbol, 10);
        senderSymbol = clampText(senderMeta.symbol, 10);
      }
    } catch {
      // keep fallback values
    }
  }

  const baseImage = `${url.origin}/og-base.jpg`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '800px',
          display: 'flex',
          position: 'relative',
          fontFamily: 'Arial, sans-serif',
          overflow: 'hidden',
          backgroundColor: '#000',
        }}
      >
        <img
          src={baseImage}
          alt=""
          width={1200}
          height={800}
          style={{
            position: 'absolute',
            inset: 0,
            objectFit: 'cover',
          }}
        />

        {sideText({ amount: signerAmount, symbol: signerSymbol, x: 80 })}
        {sideText({ amount: senderAmount, symbol: senderSymbol, x: 760 })}
      </div>
    ),
    {
      width: 1200,
      height: 800,
      headers: {
        'Cache-Control': castHash
          ? 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400'
          : 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
