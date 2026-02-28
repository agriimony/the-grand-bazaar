'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';

export default function LandingConnect() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onConnect() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      let connected = false;
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        const inMiniApp = Boolean(await sdk?.isInMiniApp?.());
        if (inMiniApp) {
          const getter = sdk?.wallet?.getEthereumProvider || sdk?.actions?.getEthereumProvider;
          const eip1193 = getter ? await getter() : null;
          if (eip1193) {
            const bp = new ethers.BrowserProvider(eip1193);
            const signer = await bp.getSigner();
            await signer.getAddress();
            connected = true;
          }
        }
      } catch {
        // ignore and try injected wallets
      }

      if (!connected && typeof window !== 'undefined' && window.ethereum?.request) {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        connected = true;
      }

      if (!connected) throw new Error('No wallet provider found');
      router.push('/maker');
    } catch (e) {
      setErr(e?.message || 'Connect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'grid',
      placeItems: 'center',
      background: 'radial-gradient(circle at 50% 20%, #5d5032 0%, #2b2417 50%, #14100a 100%)',
      color: '#f7e6b5',
      fontFamily: 'var(--font-pixel), monospace',
      padding: 16,
    }}>
      <div style={{
        width: 'min(92vw, 520px)',
        border: '2px solid #b08a3c',
        boxShadow: '0 0 0 2px #3f3115 inset, 0 12px 36px rgba(0,0,0,0.5)',
        background: 'linear-gradient(180deg, #3a2f1a 0%, #2a2214 100%)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 16px',
          background: 'linear-gradient(180deg, #6e5a2d 0%, #4d3e1f 100%)',
          borderBottom: '2px solid #b08a3c',
          textAlign: 'center',
          fontSize: 18,
          letterSpacing: 1,
        }}>
          THE GRAND BAZAAR
        </div>
        <div style={{ padding: 18, textAlign: 'center' }}>
          <p style={{ margin: '4px 0 14px', opacity: 0.9 }}>Trade like it&apos;s 2007, but on Base.</p>
          <button
            onClick={onConnect}
            disabled={busy}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 6,
              border: '2px solid #e0b85c',
              background: busy ? '#6f6038' : 'linear-gradient(180deg, #b99345 0%, #8e6f2d 100%)',
              color: '#20180d',
              fontWeight: 800,
              fontSize: 16,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Connecting...' : 'Connect Wallet'}
          </button>
          {err ? <p style={{ marginTop: 10, color: '#ffb4a8' }}>{err}</p> : null}
        </div>
      </div>
    </div>
  );
}
