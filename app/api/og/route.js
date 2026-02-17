import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function qp(url, key, fallback = '') {
  return (url.searchParams.get(key) || fallback).trim();
}

function clampText(v, max = 24) {
  const s = String(v || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function sideText({ title, amount, symbol, x }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 230,
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ color: '#fff', fontSize: 60, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{title}</div>
      <div style={{ color: '#fff', fontSize: 76, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{amount}</div>
      <div style={{ color: '#fff', fontSize: 62, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{symbol}</div>
    </div>
  );
}

export async function GET(req) {
  const url = new URL(req.url);

  const signerAmount = clampText(qp(url, 'signerAmount', '-'), 14);
  const signerSymbol = clampText(qp(url, 'signerSymbol', 'TOKEN'), 10);
  const senderAmount = clampText(qp(url, 'senderAmount', '-'), 14);
  const senderSymbol = clampText(qp(url, 'senderSymbol', 'TOKEN'), 10);

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

        {sideText({ title: 'i receive', amount: signerAmount, symbol: signerSymbol, x: 80 })}
        {sideText({ title: 'you receive', amount: senderAmount, symbol: senderSymbol, x: 760 })}
      </div>
    ),
    { width: 1200, height: 800 }
  );
}
