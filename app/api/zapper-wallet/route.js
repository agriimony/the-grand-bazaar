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
              network {
                name
              }
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
    if (!r.ok || out?.errors) {
      return Response.json({ ok: false, error: 'zapper query failed', details: out?.errors || out }, { status: 502 });
    }

    const edges = out?.data?.portfolioV2?.tokenBalances?.byToken?.edges || [];
    const tokens = edges
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

    return Response.json({ ok: true, address, tokens });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'zapper route failed' }, { status: 500 });
  }
}
