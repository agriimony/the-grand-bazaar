import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bazaar.agrimonys.com';

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

async function fromCoinGecko(addr) {
  const u = `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${addr}&vs_currencies=usd`;
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) return null;
  const d = await r.json();
  const k = String(addr).toLowerCase();
  const p = Number(d?.[k]?.usd);
  return Number.isFinite(p) && p > 0 ? p : null;
}

async function fromDexScreener(addr) {
  const u = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) return null;
  const d = await r.json();
  const pairs = Array.isArray(d?.pairs) ? d.pairs : [];
  const basePairs = pairs.filter((p) => String(p?.chainId || '').toLowerCase() === 'base');
  const sorted = basePairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  for (const p of sorted) {
    const v = Number(p?.priceUsd);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export async function GET(req) {
  try {
    if (!isAllowedOrigin(req)) return Response.json({ ok: false, error: 'forbidden origin' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const tokenIn = searchParams.get('token') || '';
    let token;
    try {
      token = ethers.getAddress(tokenIn).toLowerCase();
    } catch {
      return Response.json({ ok: false, error: 'invalid token' }, { status: 400 });
    }

    const ETH_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const WETH = '0x4200000000000000000000000000000000000006';
    const lookupToken = token === ETH_SENTINEL ? WETH : token;

    const cg = await fromCoinGecko(lookupToken);
    if (cg != null) return Response.json({ ok: true, token, source: 'coingecko', priceUsd: cg });

    const ds = await fromDexScreener(lookupToken);
    if (ds != null) return Response.json({ ok: true, token, source: 'dexscreener', priceUsd: ds });

    return Response.json({ ok: true, token, source: 'none', priceUsd: null });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'token price lookup failed' }, { status: 500 });
  }
}
