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

export async function GET(req) {
  const url = new URL(req.url);

  const signerAmount = clampText(qp(url, 'signerAmount', '-'), 18);
  const signerSymbol = clampText(qp(url, 'signerSymbol', 'TOKEN'), 10);
  const signerIcon = qp(url, 'signerIcon', '');

  const senderAmount = clampText(qp(url, 'senderAmount', '-'), 18);
  const senderSymbol = clampText(qp(url, 'senderSymbol', 'TOKEN'), 10);
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
        {/* background */}
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

        {/* left receive card */}
        <div
          style={{
            position: 'absolute',
            left: 120,
            top: 210,
            width: 340,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 64, lineHeight: 1, filter: 'drop-shadow(2px 2px 0 #000)' }}>⬇️</div>
          <div style={{ color: '#f4d77c', fontSize: 60, fontWeight: 900, textShadow: '3px 3px 0 #000' }}>{signerAmount}</div>
          <div style={{ color: '#ffe19c', fontSize: 42, fontWeight: 900, textShadow: '3px 3px 0 #000' }}>{signerSymbol}</div>
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: 999,
              background: '#1f1d1a',
              border: '6px solid #6d5f4d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {signerIcon ? (
              <img src={signerIcon} alt="" width={110} height={110} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ color: '#ffe19c', fontSize: 28, fontWeight: 900 }}>{signerSymbol.slice(0, 3)}</div>
            )}
          </div>
        </div>

        {/* right receive card */}
        <div
          style={{
            position: 'absolute',
            right: 120,
            top: 210,
            width: 340,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 64, lineHeight: 1, filter: 'drop-shadow(2px 2px 0 #000)' }}>⬇️</div>
          <div style={{ color: '#f4d77c', fontSize: 60, fontWeight: 900, textShadow: '3px 3px 0 #000' }}>{senderAmount}</div>
          <div style={{ color: '#ffe19c', fontSize: 42, fontWeight: 900, textShadow: '3px 3px 0 #000' }}>{senderSymbol}</div>
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: 999,
              background: '#1f1d1a',
              border: '6px solid #6d5f4d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {senderIcon ? (
              <img src={senderIcon} alt="" width={110} height={110} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ color: '#ffe19c', fontSize: 28, fontWeight: 900 }}>{senderSymbol.slice(0, 3)}</div>
            )}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 800 }
  );
}
