'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';

export default function LandingConnect() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let mounted = true;
    async function signalReady() {
      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        await sdk?.actions?.ready?.();
      } catch {
        // no-op outside farcaster clients
      }
    }
    if (mounted) signalReady();
    return () => {
      mounted = false;
    };
  }, []);

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
      background: 'linear-gradient(180deg, #403729 0%, #2a2318 45%, #18130d 100%)',
      color: '#f7e6b5',
      fontFamily: 'var(--font-pixel), monospace',
      padding: 16,
    }}>
      <div style={{
        width: 'min(92vw, 520px)',
        border: '2px solid #7f6a3b',
        boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 14px 36px rgba(0,0,0,0.55)',
        background: 'linear-gradient(180deg, #4a4231 0%, #3b3326 55%, #30291f 100%)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px',
          background: 'linear-gradient(180deg, #6f6248 0%, #5a4e38 100%)',
          borderBottom: '2px solid #8f7a4b',
          textAlign: 'center',
          fontSize: 18,
          letterSpacing: 1,
          textShadow: '0 1px 0 #1a150e',
        }}>
          THE GRAND BAZAAR
        </div>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <p style={{ margin: '6px 0 16px', color: '#f1deaa' }}>Welcome to the Grand Bazaar</p>
          <div style={{
            border: '2px solid #6c5a35',
            boxShadow: '0 0 0 1px #231c11 inset',
            borderRadius: 6,
            background: 'linear-gradient(180deg, #3a3225 0%, #2c251b 100%)',
            padding: 10,
          }}>
            <button
              onClick={onConnect}
              disabled={busy}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 4,
                border: '2px solid #8f7a49',
                boxShadow: '0 0 0 1px #2a2216 inset',
                background: busy ? '#6d6248' : 'linear-gradient(180deg, #a89160 0%, #7d6940 100%)',
                color: '#17120b',
                fontWeight: 800,
                fontSize: 20,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy ? 'Connecting...' : 'Connect'}
            </button>
          </div>
          {err ? <p style={{ marginTop: 10, color: '#ffb4a8' }}>{err}</p> : null}
        </div>
      </div>
    </div>
  );
}
