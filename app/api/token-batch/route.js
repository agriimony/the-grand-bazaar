import { ethers } from 'ethers';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const IFACE = new ethers.Interface(ERC20_ABI);
const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];

async function rpcBatchCall(calls) {
  for (const rpc of BASE_RPCS) {
    try {
      const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      const out = await r.json();
      if (!Array.isArray(out)) continue;
      const byId = new Map(out.map((x) => [x.id, x]));
      return { rpc, results: calls.map((_, i) => byId.get(i + 1)) };
    } catch {
      // try next
    }
  }
  return { rpc: 'none', results: calls.map(() => ({ error: { message: 'all rpc failed' } })) };
}

function decode(results, fn, idx, fallback) {
  try {
    const hex = results[idx]?.result;
    if (!hex) return fallback;
    return IFACE.decodeFunctionResult(fn, hex)?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token') || '';
    const owner = searchParams.get('owner') || '';
    const spender = searchParams.get('spender') || '';
    if (!token || !owner || !spender) {
      return Response.json({ ok: false, error: 'missing params' }, { status: 400 });
    }

    const calls = [
      { to: token, data: IFACE.encodeFunctionData('symbol', []) },
      { to: token, data: IFACE.encodeFunctionData('decimals', []) },
      { to: token, data: IFACE.encodeFunctionData('balanceOf', [owner]) },
      { to: token, data: IFACE.encodeFunctionData('allowance', [owner, spender]) },
    ];

    const { rpc, results } = await rpcBatchCall(calls);
    const symbol = String(decode(results, 'symbol', 0, '???'));
    const decimals = Number(decode(results, 'decimals', 1, 18));
    const balance = decode(results, 'balanceOf', 2, 0n).toString();
    const allowance = decode(results, 'allowance', 3, 0n).toString();

    return Response.json({ ok: true, rpc, symbol, decimals, balance, allowance, raw: results });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'token batch failed' }, { status: 500 });
  }
}
