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

function tokenTile({ amount, symbol, icon, x, title }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 210,
        width: 320,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div
        style={{
          color: '#ffffff',
          fontSize: 62,
          fontWeight: 900,
          textTransform: 'lowercase',
          textShadow: '3px 3px 0 #000, 0 0 10px rgba(0,0,0,0.8)',
        }}
      >
        {title}
      </div>

      <div
        style={{
          width: 220,
          height: 220,
          position: 'relative',
          border: '4px solid #3a3024',
          background: 'rgba(0,0,0,0.25)',
          boxShadow: '0 8px 0 rgba(0,0,0,0.35), inset 0 0 0 2px rgba(255,225,156,0.1)',
          overflow: 'hidden',
        }}
      >
        {icon ? (
          <img
            src={icon}
            alt=""
            width={220}
            height={220}
            style={{
              width: '220px',
              height: '220px',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: '#1f1d1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffe19c',
              fontSize: 70,
              fontWeight: 900,
              textShadow: '2px 2px 0 #000',
            }}
          >
            {symbol.slice(0, 3)}
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 8,
            zIndex: 2,
            color: '#f4d77c',
            fontSize: 52,
            fontWeight: 900,
            lineHeight: 1,
            textShadow: '3px 3px 0 #000, 0 0 8px rgba(0,0,0,0.95)',
          }}
        >
          {amount}
        </div>

        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 6,
            zIndex: 2,
            maxWidth: 190,
            color: '#ffe19c',
            fontSize: 46,
            fontWeight: 900,
            lineHeight: 1,
            textShadow: '3px 3px 0 #000, 0 0 8px rgba(0,0,0,0.95)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {symbol}
        </div>
      </div>
    </div>
  );
}

export async function GET(req) {
  const url = new URL(req.url);

  const signerAmount = clampText(qp(url, 'signerAmount', '-'), 12);
  const signerSymbol = clampText(qp(url, 'signerSymbol', 'TOKEN'), 8);
  const signerIcon = qp(url, 'signerIcon', '');

  const senderAmount = clampText(qp(url, 'senderAmount', '-'), 12);
  const senderSymbol = clampText(qp(url, 'senderSymbol', 'TOKEN'), 8);
  const senderIcon = qp(url, 'senderIcon', '');

  const baseImage = `${url.origin}/og-base.jpg`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '800px',
          display: 'flex',
          position: 'relative',
          fontFamily: 'Verdana, Arial, sans-serif',
          backgroundColor: '#000',
          overflow: 'hidden',
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

        {tokenTile({ amount: signerAmount, symbol: signerSymbol, icon: signerIcon, x: 90, title: 'i receive' })}
        {tokenTile({ amount: senderAmount, symbol: senderSymbol, icon: senderIcon, x: 790, title: 'you receive' })}
      </div>
    ),
    { width: 1200, height: 800 }
  );
}
