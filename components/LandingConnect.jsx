'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import { setStoredAuthToken } from '../lib/client-auth';

export default function LandingConnect() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [connectors, setConnectors] = useState([]);
  const [selectedConnectorId, setSelectedConnectorId] = useState('');

  useEffect(() => {
    let mounted = true;
    const eip6963 = new Map();

    const normalizeAnnounced = (detail) => {
      const info = detail?.info || {};
      const provider = detail?.provider;
      const uuid = String(info?.uuid || '').trim();
      if (!provider || !uuid) return null;
      const rdns = String(info?.rdns || '').toLowerCase();
      const rawName = String(info?.name || '').trim();
      let name = rawName || 'Injected Wallet';
      if (rdns.includes('metamask')) name = 'MetaMask';
      else if (rdns.includes('rabby')) name = 'Rabby';
      else if (rdns.includes('coinbase')) name = 'Coinbase Wallet';
      return {
        id: `eip6963:${uuid}`,
        name,
        provider,
        authMethod: 'siwe',
        rdns,
        uuid,
      };
    };

    const applyConnectors = async () => {
      const found = [];

      try {
        const mod = await import('@farcaster/miniapp-sdk');
        const sdk = mod?.sdk || mod?.default || mod;
        await sdk?.actions?.ready?.();
        const inMiniApp = Boolean(await sdk?.isInMiniApp?.());
        if (inMiniApp) {
          const getter = sdk?.wallet?.getEthereumProvider || sdk?.actions?.getEthereumProvider;
          const p = getter ? await getter() : null;
          if (p) found.push({ id: 'farcaster', name: 'Farcaster Wallet', provider: p, authMethod: 'farcaster' });
        }
      } catch {}

      const announced = Array.from(eip6963.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      for (const a of announced) found.push(a);

      if (!announced.length && typeof window !== 'undefined' && window.ethereum) {
        const providers = Array.isArray(window.ethereum.providers) && window.ethereum.providers.length
          ? window.ethereum.providers
          : [window.ethereum];
        for (const p of providers) {
          const isMetaMask = Boolean(p?.isMetaMask);
          const isCoinbase = Boolean(p?.isCoinbaseWallet);
          const isRabby = Boolean(p?.isRabby);
          const name = isRabby ? 'Rabby' : (isMetaMask ? 'MetaMask' : (isCoinbase ? 'Coinbase Wallet' : 'Injected Wallet'));
          const id = isRabby ? 'rabby' : (isMetaMask ? 'metamask' : (isCoinbase ? 'coinbase' : `injected-${found.length}`));
          if (!found.some((x) => x.id === id)) found.push({ id, name, provider: p, authMethod: 'siwe' });
        }
      }

      if (mounted) {
        setConnectors(found);
        setSelectedConnectorId((prev) => {
          if (prev && found.some((x) => x.id === prev)) return prev;
          const fc = found.find((x) => x.authMethod === 'farcaster');
          if (fc) return fc.id;
          const metamask = found.find((x) => String(x.name || '').toLowerCase().includes('metamask') || String(x.rdns || '').includes('metamask'));
          if (metamask) return metamask.id;
          return found[0]?.id || '';
        });
      }
    };

    const onAnnounce = (event) => {
      const c = normalizeAnnounced(event?.detail);
      if (!c) return;
      eip6963.set(c.uuid, c);
      applyConnectors();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('eip6963:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    }

    applyConnectors();

    return () => {
      mounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
      }
    };
  }, []);

  const selectedConnector = connectors.find((x) => x.id === selectedConnectorId) || connectors[0] || null;

  async function onConnect(connector = selectedConnector) {
    if (busy || !connector?.provider) return;
    setBusy(true);
    setErr('');
    try {
      const provider = new ethers.BrowserProvider(connector.provider);
      try {
        await connector.provider.request?.({ method: 'eth_requestAccounts' });
      } catch {}
      const signer = await provider.getSigner();
      const address = String(await signer.getAddress()).toLowerCase();

      const authMethod = String(connector.authMethod || 'siwe');
      let fid = '';
      if (authMethod === 'farcaster') {
        try {
          const mod = await import('@farcaster/miniapp-sdk');
          const sdk = mod?.sdk || mod?.default || mod;
          let ctx = null;
          try {
            if (typeof sdk?.context === 'function') ctx = await sdk.context();
            else ctx = sdk?.context || null;
          } catch {}
          fid = String(ctx?.user?.fid || '').trim();
        } catch {}
      }

      const c = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, fid }),
      });
      const cd = await c.json();
      if (!c.ok || !cd?.ok || !cd?.message || !cd?.challengeToken) {
        throw new Error(cd?.error || 'Auth challenge failed');
      }

      const signature = await signer.signMessage(cd.message);

      const v = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address,
          fid,
          authMethod,
          message: cd.message,
          signature,
          challengeToken: cd.challengeToken,
        }),
      });
      const vd = await v.json();
      if (!v.ok || !vd?.ok || !vd?.sessionToken) {
        throw new Error(vd?.error || 'Auth verify failed');
      }

      setStoredAuthToken(vd.sessionToken);
      router.push('/worlds');
    } catch (e) {
      setErr(e?.message || 'Connect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      position: 'relative',
      display: 'grid',
      placeItems: 'center',
      color: '#f7e6b5',
      fontFamily: 'var(--font-pixel), monospace',
      padding: 16,
      overflow: 'hidden',
      background: '#17120b',
    }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -24,
          backgroundImage: 'url(/landing-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(4.5px) brightness(0.5) saturate(0.9)',
          transform: 'scale(1.04)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 40%, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.72) 100%)',
        }}
      />
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: 'min(92vw, 520px)',
        border: '2px solid #7f6a3b',
        boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
        background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
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
            <div style={{ display: 'grid', gap: 8 }}>
              <button
                onClick={() => onConnect()}
                disabled={busy || !selectedConnector}
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
                {busy ? 'Connecting...' : `Connect${selectedConnector ? ` ${selectedConnector.name}` : ''}`}
              </button>

              {connectors.length > 1 ? (
                <select
                  value={selectedConnectorId}
                  onChange={(e) => setSelectedConnectorId(String(e.target.value || ''))}
                  disabled={busy}
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    borderRadius: 4,
                    border: '2px solid #8f7a49',
                    background: 'rgba(28,22,14,0.75)',
                    color: '#f4e3b8',
                    fontSize: 14,
                  }}
                >
                  {connectors.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {!connectors.length ? (
                <div style={{ color: '#ffb4a8', fontSize: 12 }}>No wallet provider found</div>
              ) : null}
            </div>
          </div>
          {err ? <p style={{ marginTop: 10, color: '#ffb4a8' }}>{err}</p> : null}
        </div>
      </div>
    </div>
  );
}
