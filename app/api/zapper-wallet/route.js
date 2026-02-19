import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const ZAPPER_URL = 'https://public.zapper.xyz/graphql';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://the-grand-bazaar.vercel.app';

function normHost(v = '') {
  try {
    return new URL(v).host.toLowerCase();
  } catch {
    return String(v || '').toLowerCase();
  }
}

function shortAddress(v = '') {
  const s = String(v || '');
  return s.length > 10 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function isAllowedOrigin(req) {
  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';
  const appHost = normHost(APP_ORIGIN);
  const originHost = normHost(origin);
  const refererHost = normHost(referer);

  if (originHost && originHost === appHost) return true;
  if (refererHost && refererHost === appHost) return true;
  return false;
}

const QUERY = `
  query PortfolioV2Query($addresses: [Address!]!, $chainIds: [Int!]) {
    portfolioV2(addresses: $addresses, chainIds: $chainIds) {
      tokenBalances {
        byToken(first: 100) {
          edges {
            node {
              tokenAddress
              symbol
              balance
              balanceUSD
              imgUrlV2
              network { name }
            }
          }
        }
      }
      nftBalances {
        byToken(first: 200) {
          edges {
            node {
              tokenAddress
              tokenId
              symbol
              name
              balance
              imgUrlV2
              network { name }
            }
          }
        }
      }
    }
  }
`;

export async function GET(req) {
  try {
    if (!isAllowedOrigin(req)) {
      return Response.json({ ok: false, error: 'forbidden origin' }, { status: 403 });
    }

    const apiKey = process.env.ZAPPER_API_KEY;
    if (!apiKey) {
      return Response.json({ ok: false, error: 'zapper api key missing' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const addressIn = searchParams.get('address') || '';

    let address;
    try {
      address = ethers.getAddress(addressIn);
    } catch {
      return Response.json({ ok: false, error: 'invalid address' }, { status: 400 });
    }

    const r = await fetch(ZAPPER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zapper-api-key': apiKey,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          addresses: [address],
          chainIds: [8453],
        },
      }),
      cache: 'no-store',
    });

    const out = await r.json();
    if (!r.ok || (!out?.data && out?.errors)) {
      return Response.json({ ok: false, error: 'zapper query failed', details: out?.errors || out }, { status: 502 });
    }

    const tokenEdges = out?.data?.portfolioV2?.tokenBalances?.byToken?.edges || [];
    const tokens = tokenEdges
      .map((e) => e?.node)
      .filter(Boolean)
      .filter((n) => (n?.network?.name || '').toLowerCase().includes('base'))
      .map((n) => {
        const balance = Number(n.balance || 0);
        const usdValue = Number(n.balanceUSD || 0);
        const priceUsd = balance > 0 ? (usdValue / balance) : null;
        return {
          token: n.tokenAddress,
          symbol: n.symbol || 'TOKEN',
          balance: String(n.balance || '0'),
          usdValue,
          priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
          imgUrl: n.imgUrlV2 || null,
        };
      })
      .filter((n) => Number(n.balance) > 0)
      .sort((a, b) => b.usdValue - a.usdValue);

    const nftEdges = out?.data?.portfolioV2?.nftBalances?.byToken?.edges || [];
    const nfts = nftEdges
      .map((e) => e?.node)
      .filter(Boolean)
      .filter((n) => (n?.network?.name || '').toLowerCase().includes('base'))
      .map((n) => ({
        token: n.tokenAddress,
        tokenId: String(n.tokenId || ''),
        symbol: n.symbol || 'NFT',
        name: n.name || '',
        balance: String(n.balance || '1'),
        imgUrl: n.imgUrlV2 || null,
      }))
      .filter((n) => n.token && n.tokenId);

    const byCollection = new Map();
    for (const n of nfts) {
      const key = String(n.token).toLowerCase();
      if (!byCollection.has(key)) {
        byCollection.set(key, {
          collectionAddress: n.token,
          collectionName: n.symbol || shortAddress(n.token),
          symbol: n.symbol || 'NFT',
          nfts: [],
        });
      }
      byCollection.get(key).nfts.push(n);
    }

    const nftCollections = Array.from(byCollection.values()).map((c) => ({
      ...c,
      nfts: c.nfts.sort((a, b) => {
        try {
          const aa = BigInt(a.tokenId);
          const bb = BigInt(b.tokenId);
          if (aa === bb) return 0;
          return aa < bb ? -1 : 1;
        } catch {
          return String(a.tokenId).localeCompare(String(b.tokenId));
        }
      }),
    }));

    return Response.json({ ok: true, address, tokens, nftCollections, warnings: out?.errors || [] });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'zapper route failed' }, { status: 500 });
  }
}
