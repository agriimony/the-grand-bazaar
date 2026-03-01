import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const ZAPPER_URL = 'https://public.zapper.xyz/graphql';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bazaar.agrimonys.com';
const APP_ORIGIN_DEV = process.env.APP_ORIGIN_DEV || 'https://dev-bazaar.agrimonys.com';

function normHost(v = '') {
  try { return new URL(v).host.toLowerCase(); } catch { return String(v || '').toLowerCase(); }
}

function shortAddress(v = '') {
  const s = String(v || '');
  return s.length > 10 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function isAllowedOrigin(req) {
  const originHost = normHost(req.headers.get('origin') || '');
  const refererHost = normHost(req.headers.get('referer') || '');
  const hostHeader = String(req.headers.get('x-forwarded-host') || req.headers.get('host') || '').toLowerCase();
  const requestHost = normHost(req.url || '');
  const allowedHosts = new Set([
    normHost(APP_ORIGIN),
    normHost(APP_ORIGIN_DEV),
    hostHeader,
    requestHost,
  ].filter(Boolean));

  // Same-origin server/client fetches may omit Origin; allow when Host matches allowed domain.
  if (!originHost && !refererHost) return allowedHosts.has(hostHeader) || allowedHosts.has(requestHost);

  return (originHost && allowedHosts.has(originHost)) || (refererHost && allowedHosts.has(refererHost));
}

const QUERY = `
  query PortfolioV2Combined($addresses: [Address!]!, $chainIds: [Int!]) {
    portfolioV2(addresses: $addresses, chainIds: $chainIds) {
      tokenBalances {
        byToken(first: 24) {
          edges {
            node {
              tokenAddress
              symbol
              balance
              balanceUSD
              imgUrlV2
            }
          }
        }
      }
      nftBalances {
        byCollection(first: 24, order: { by: USD_WORTH, direction: DESC }) {
          edges {
            node {
              balanceUSD
              collection {
                address
                name
                symbol
                floorPrice {
                  valueUsd
                }
              }
              tokens(first: 24, order: { by: USD_WORTH, direction: DESC }) {
                edges {
                  node {
                    tokenId
                    balance
                    balanceUSD
                    token {
                      __typename
                      tokenId
                      name
                      mediasV2 {
                        ... on Image {
                          thumbnail
                          original
                        }
                      }
                    }
                  }
                }
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
    if (!isAllowedOrigin(req)) return Response.json({ ok: false, error: 'forbidden origin' }, { status: 403 });

    const apiKey = process.env.ZAPPER_API_KEY;
    if (!apiKey) return Response.json({ ok: false, error: 'zapper api key missing' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const addressIn = searchParams.get('address') || '';

    let address;
    try { address = ethers.getAddress(addressIn); } catch { return Response.json({ ok: false, error: 'invalid address' }, { status: 400 }); }

    const requestId = `zw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const r = await fetch(ZAPPER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zapper-api-key': apiKey },
      body: JSON.stringify({ query: QUERY, variables: { addresses: [address], chainIds: [8453] } }),
      cache: 'no-store',
    });

    const out = await r.json();
    if (!r.ok || (!out?.data && out?.errors)) {
      console.error('[zapper-wallet] query failed', {
        requestId,
        status: r.status,
        statusText: r.statusText,
        address,
        origin: req.headers.get('origin') || null,
        referer: req.headers.get('referer') || null,
        errors: out?.errors || null,
      });
      return Response.json({ ok: false, error: 'zapper query failed', requestId, details: out?.errors || out }, { status: 502 });
    }

    const warnings = Array.isArray(out?.errors) ? out.errors : [];

    const tokenEdges = out?.data?.portfolioV2?.tokenBalances?.byToken?.edges || [];
    const tokens = tokenEdges
      .map((e) => e?.node)
      .filter(Boolean)
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
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, 24);

    const collectionEdges = out?.data?.portfolioV2?.nftBalances?.byCollection?.edges || [];
    const nftDebugRows = [];
    const nftCollections = collectionEdges
      .map((e) => e?.node)
      .filter(Boolean)
      .map((c) => {
        const nftRows = (c?.tokens?.edges || [])
          .map((e) => e?.node)
          .filter(Boolean)
          .map((n) => {
            const media = Array.isArray(n?.token?.mediasV2) ? n.token.mediasV2.find((m) => m?.thumbnail || m?.original) : null;
            const floorUsd = Number(c?.collection?.floorPrice?.valueUsd || 0);
            const tokenType = String(n?.token?.__typename || '');
            const balNum = Number(n?.balance || 0);
            const kind = /1155/i.test(tokenType) || balNum > 1 ? '0xd9b67a26' : '0x80ac58cd';
            nftDebugRows.push({
              collection: c?.collection?.address || null,
              tokenId: String(n?.token?.tokenId || n.tokenId || ''),
              balance: String(n.balance || '1'),
              __typename: tokenType || null,
              inferredKind: kind,
            });
            return {
              token: c?.collection?.address,
              tokenId: String(n?.token?.tokenId || n.tokenId || ''),
              symbol: c?.collection?.symbol || 'NFT',
              name: n?.token?.name || '',
              balance: String(n.balance || '1'),
              usdValue: Number(n.balanceUSD || 0),
              floorUsd: Number.isFinite(floorUsd) ? floorUsd : 0,
              kind,
              imgUrl: media?.thumbnail || media?.original || null,
            };
          })
          .filter((n) => n.token && n.tokenId)
          .slice(0, 24);

        return {
          collectionAddress: c?.collection?.address,
          collectionName: c?.collection?.name || shortAddress(c?.collection?.address),
          symbol: c?.collection?.symbol || 'NFT',
          totalBalanceUSD: Number(c.balanceUSD || 0),
          nfts: nftRows,
        };
      })
      .filter((c) => c.collectionAddress)
      .sort((a, b) => (b.totalBalanceUSD || 0) - (a.totalBalanceUSD || 0))
      .slice(0, 24);

    console.log('[zapper-wallet] nft typename sample', {
      address,
      count: nftDebugRows.length,
      sample: nftDebugRows.slice(0, 40),
    });

    return Response.json({ ok: true, address, tokens, nftCollections, warnings });
  } catch (e) {
    console.error('[zapper-wallet] route exception', { message: e?.message, stack: e?.stack });
    return Response.json({ ok: false, error: e?.message || 'zapper route failed' }, { status: 500 });
  }
}
