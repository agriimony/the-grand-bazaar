import { ImageResponse } from 'next/og';
import { ethers } from 'ethers';
import { decodeCompressedOrder } from '../../../lib/orders';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const TOKEN_META = {
  // Base token catalog first
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
  '0x0578d8a44db98b23bf096a382e016e29a5ce0ffe': { symbol: 'HIGHER', decimals: 18 },
  '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { symbol: 'DEGEN', decimals: 18 },
  // legacy/common
  '0xcb327b99ff831bf8223cced12b1338ff3aa322ff': { symbol: 'USDbC', decimals: 6 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
};

const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';

const ERC20_IFACE = new ethers.Interface([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const ERC721_IFACE = new ethers.Interface([
  'function tokenURI(uint256 tokenId) view returns (string)',
]);
const ERC1155_IFACE = new ethers.Interface([
  'function uri(uint256 id) view returns (string)',
]);

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

async function readOnchainMeta(addr = '') {
  const to = String(addr || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return null;
  try {
    const rpc = 'https://mainnet.base.org';
    const [symbolData, decimalsData] = await Promise.all([
      fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data: ERC20_IFACE.encodeFunctionData('symbol', []) }, 'latest'] }),
        cache: 'no-store',
      }).then((r) => r.json()),
      fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to, data: ERC20_IFACE.encodeFunctionData('decimals', []) }, 'latest'] }),
        cache: 'no-store',
      }).then((r) => r.json()),
    ]);

    const symbol = symbolData?.result ? String(ERC20_IFACE.decodeFunctionResult('symbol', symbolData.result)?.[0] || '') : '';
    const decimals = decimalsData?.result ? Number(ERC20_IFACE.decodeFunctionResult('decimals', decimalsData.result)?.[0] || 18) : 18;
    if (!symbol) return null;
    return { symbol, decimals: Number.isFinite(decimals) ? decimals : 18 };
  } catch {
    return null;
  }
}

async function guessMeta(addr = '', kind = KIND_ERC20) {
  const k = String(addr || '').toLowerCase();
  const m = TOKEN_META[k];
  if (m) return m;

  const kk = String(kind || '').toLowerCase();
  if (kk === KIND_ERC721 || kk === KIND_ERC1155) {
    const to = String(addr || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return { symbol: 'NFT', decimals: 0 };
    try {
      const rpc = 'https://mainnet.base.org';
      const symbolData = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to, data: ERC20_IFACE.encodeFunctionData('symbol', []) }, 'latest'] }),
        cache: 'no-store',
      }).then((r) => r.json());
      const symbol = symbolData?.result ? String(ERC20_IFACE.decodeFunctionResult('symbol', symbolData.result)?.[0] || '') : '';
      return { symbol: symbol || 'NFT', decimals: 0 };
    } catch {
      return { symbol: 'NFT', decimals: 0 };
    }
  }

  const onchain = await readOnchainMeta(addr);
  if (onchain) return onchain;
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

function formatAmountByKind(kind, raw, decimals, tokenId) {
  const k = String(kind || '').toLowerCase();
  if (k === KIND_ERC721) return `#${String(tokenId ?? 0)}`;
  if (k === KIND_ERC1155) return clampText(String(raw || '0'), 14);
  return formatAmount(raw, decimals);
}

function ipfsToHttp(u = '') {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${s.replace('ipfs://', '').replace(/^ipfs\//, '')}`;
  return s;
}

async function rpcCall(rpc, to, data, id) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    cache: 'no-store',
  });
  return r.json();
}

async function fetchNftImage(token, kind, tokenId = '0') {
  const k = String(kind || '').toLowerCase();
  if (k !== KIND_ERC721 && k !== KIND_ERC1155) return '';
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(token || ''))) return '';
  const rpc = 'https://mainnet.base.org';
  try {
    const data = k === KIND_ERC721
      ? ERC721_IFACE.encodeFunctionData('tokenURI', [BigInt(tokenId || '0')])
      : ERC1155_IFACE.encodeFunctionData('uri', [BigInt(tokenId || '0')]);
    const res = await rpcCall(rpc, token, data, 11);
    const rawUri = res?.result
      ? (k === KIND_ERC721
        ? String(ERC721_IFACE.decodeFunctionResult('tokenURI', res.result)?.[0] || '')
        : String(ERC1155_IFACE.decodeFunctionResult('uri', res.result)?.[0] || ''))
      : '';
    if (!rawUri) return '';

    const hexId = BigInt(String(tokenId || '0')).toString(16).padStart(64, '0');
    const tokenUri = ipfsToHttp(rawUri.replaceAll('{id}', hexId).replace('{id}', String(tokenId || '0')));
    if (!tokenUri) return '';

    if (tokenUri.startsWith('data:application/json')) {
      const b64 = tokenUri.split(',')[1] || '';
      const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return ipfsToHttp(j?.image || j?.image_url || '');
    }

    const metaRes = await fetch(tokenUri, { cache: 'no-store' });
    if (!metaRes.ok) return '';
    const j = await metaRes.json();
    return ipfsToHttp(j?.image || j?.image_url || '');
  } catch {
    return '';
  }
}

function sideText({ amount, symbol, x, imageUrl, isNft }) {
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
      {isNft && imageUrl ? (
        <img
          src={imageUrl}
          alt={symbol}
          width={130}
          height={130}
          style={{ borderRadius: 18, objectFit: 'cover', border: '3px solid rgba(255,255,255,0.8)' }}
        />
      ) : (
        <div style={{ color: '#fff', fontSize: 62, fontWeight: 900, textShadow: '3px 3px 0 #000, 0 0 14px rgba(0,0,0,0.9)' }}>{symbol}</div>
      )}
    </div>
  );
}

export async function GET(req) {
  const url = new URL(req.url);

  let signerAmount = clampText(qp(url, 'signerAmount', '-'), 14);
  let signerSymbol = clampText(qp(url, 'signerSymbol', 'TOKEN'), 10);
  let senderAmount = clampText(qp(url, 'senderAmount', '-'), 14);
  let senderSymbol = clampText(qp(url, 'senderSymbol', 'TOKEN'), 10);
  let signerKind = KIND_ERC20;
  let senderKind = KIND_ERC20;
  let signerToken = '';
  let senderToken = '';
  let signerId = '0';
  let senderId = '0';
  let signerImage = '';
  let senderImage = '';

  const castHash = qp(url, 'castHash', '');
  if (castHash) {
    try {
      const orderRes = await fetch(`${url.origin}/api/order-from-cast?castHash=${encodeURIComponent(castHash)}`, {
        cache: 'no-store',
      });
      const orderData = await orderRes.json();
      if (orderRes.ok && orderData?.ok && orderData?.compressedOrder) {
        const parsed = decodeCompressedOrder(orderData.compressedOrder);
        signerKind = String(parsed.signerKind || KIND_ERC20).toLowerCase();
        senderKind = String(parsed.senderKind || KIND_ERC20).toLowerCase();
        signerToken = String(parsed.signerToken || '');
        senderToken = String(parsed.senderToken || '');
        signerId = String(parsed.signerId || '0');
        senderId = String(parsed.senderId || '0');

        const [signerMeta, senderMeta] = await Promise.all([
          guessMeta(parsed.signerToken, parsed.signerKind),
          guessMeta(parsed.senderToken, parsed.senderKind),
        ]);
        signerAmount = clampText(formatAmountByKind(parsed.signerKind, parsed.signerAmount, signerMeta.decimals, parsed.signerId), 14);
        senderAmount = clampText(formatAmountByKind(parsed.senderKind, parsed.senderAmount, senderMeta.decimals, parsed.senderId), 14);
        signerSymbol = clampText((signerKind === KIND_ERC721 || signerKind === KIND_ERC1155) ? (signerMeta.symbol || 'NFT') : signerMeta.symbol, 10);
        senderSymbol = clampText((senderKind === KIND_ERC721 || senderKind === KIND_ERC1155) ? (senderMeta.symbol || 'NFT') : senderMeta.symbol, 10);

        [signerImage, senderImage] = await Promise.all([
          fetchNftImage(signerToken, signerKind, signerId),
          fetchNftImage(senderToken, senderKind, senderId),
        ]);

        const embedUrls = Array.isArray(orderData?.embedUrls)
          ? orderData.embedUrls.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u))
          : [];
        const signerIsNft = signerKind === KIND_ERC721 || signerKind === KIND_ERC1155;
        const senderIsNft = senderKind === KIND_ERC721 || senderKind === KIND_ERC1155;

        // Cast embed fallback mapping for deeplinked OG:
        // - both NFT legs: embed[0]=signer, embed[1]=sender
        // - single NFT leg: embed[0] for that leg
        if (!signerImage && !senderImage && signerIsNft && senderIsNft) {
          signerImage = embedUrls[0] || '';
          senderImage = embedUrls[1] || '';
        } else {
          if (!signerImage && signerIsNft) signerImage = embedUrls[0] || '';
          if (!senderImage && senderIsNft) senderImage = embedUrls[0] || '';
        }
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

        {sideText({ amount: senderAmount, symbol: senderSymbol, x: 80, imageUrl: senderImage, isNft: senderKind === KIND_ERC721 || senderKind === KIND_ERC1155 })}
        {sideText({ amount: signerAmount, symbol: signerSymbol, x: 760, imageUrl: signerImage, isNft: signerKind === KIND_ERC721 || signerKind === KIND_ERC1155 })}
      </div>
    ),
    {
      width: 1200,
      height: 800,
      headers: {
        'Cache-Control': castHash
          ? 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400'
          : 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
