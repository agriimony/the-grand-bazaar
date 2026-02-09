'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';

function short(a = '') {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '';
}

export default function FarcasterWalletPanel() {
  const [sdk, setSdk] = useState(null);
  const [status, setStatus] = useState('loading-sdk');
  const [provider, setProvider] = useState(null);
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState('');

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const mod = await import('@farcaster/frame-sdk');
        const fcSdk = mod?.sdk || mod?.default || mod;
        if (!mounted) return;
        setSdk(fcSdk);

        // Signals that the miniapp is ready inside Farcaster clients.
        await fcSdk?.actions?.ready?.();
        setStatus('ready');
      } catch (e) {
        setStatus('sdk-unavailable');
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const sdkProviderGetter = useMemo(() => {
    if (!sdk) return null;
    return (
      sdk?.wallet?.getEthereumProvider ||
      sdk?.wallet?.ethProvider ||
      sdk?.actions?.getEthereumProvider ||
      null
    );
  }, [sdk]);

  async function connect() {
    try {
      setStatus('connecting');

      let eip1193 = null;
      if (sdkProviderGetter) {
        eip1193 = await sdkProviderGetter();
      }

      if (!eip1193 && typeof window !== 'undefined' && window.ethereum) {
        eip1193 = window.ethereum;
      }

      if (!eip1193) {
        setStatus('no-provider');
        return;
      }

      const browserProvider = new ethers.BrowserProvider(eip1193);
      const signer = await browserProvider.getSigner();
      const addr = await signer.getAddress();
      const net = await browserProvider.getNetwork();

      setProvider(browserProvider);
      setAddress(addr);
      setChainId(String(net.chainId));
      setStatus('connected');
    } catch (e) {
      setStatus(`error: ${e?.message || 'connect failed'}`);
    }
  }

  async function signProbe() {
    if (!provider) return;
    try {
      const signer = await provider.getSigner();
      const msg = `The Grand Bazaar miniapp auth\n${new Date().toISOString()}`;
      await signer.signMessage(msg);
      setStatus('sign-ok');
    } catch (e) {
      setStatus(`sign-error: ${e?.message || 'failed'}`);
    }
  }

  return (
    <section style={{ marginTop: 20, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
      <h3>Farcaster SDK Wallet Flow</h3>
      <p style={{ marginTop: 0 }}>Prioritizes Farcaster in-app provider first. Falls back to injected provider only if needed.</p>
      <p><b>Status:</b> {status}</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={connect}>Connect via Farcaster SDK</button>
        <button onClick={signProbe} disabled={!provider}>Sign probe message</button>
      </div>

      {address && (
        <ul>
          <li>address: {short(address)}</li>
          <li>chainId: {chainId}</li>
        </ul>
      )}
    </section>
  );
}
