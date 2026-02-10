import { ethers } from 'ethers';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const IFACE = new ethers.Interface(ERC20_ABI);
const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const API_VERSION = 'token-batch-v2';

function canonAddr(addr = '') {
  try {
    return ethers.getAddress(String(addr || '').trim());
  } catch {
    return String(addr || '').trim();
  }
}

async function rpcBatchCall(calls) {
  for (const rpc of BASE_RPCS) {
    try {
      const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      const out = await r.json();
      if (!Array.isArray(out)) continue;
      const byId = new Map(out.map((x) => [x.id, x]));
      return { rpc, results: calls.map((_, i) => byId.get(i + 1)), mode: 'batch' };
    } catch {
      // try next
    }
  }
  return null;
}

async function rpcDirectRead(token, owner, spender) {
  for (const rpc of BASE_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
      const [symbol, decimals, balance, allowance] = await Promise.all([
        erc20.symbol().catch(() => '???'),
        erc20.decimals().catch(() => 18),
        erc20.balanceOf(owner).catch(() => 0n),
        erc20.allowance(owner, spender).catch(() => 0n),
      ]);
      return { rpc, mode: 'direct', symbol: String(symbol), decimals: Number(decimals), balance: BigInt(balance).toString(), allowance: BigInt(allowance).toString(), raw: [] };
    } catch {
      // try next
    }
  }
  return { rpc: 'none', mode: 'direct', symbol: '???', decimals: 18, balance: '0', allowance: '0', raw: [] };
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
    const tokenIn = searchParams.get('token') || '';
    const ownerIn = searchParams.get('owner') || '';
    const spenderIn = searchParams.get('spender') || '';
    const token = canonAddr(tokenIn);
    const owner = canonAddr(ownerIn);
    const spender = canonAddr(spenderIn);
    if (!token || !owner || !spender) {
      return Response.json({ ok: false, error: 'missing params', version: API_VERSION }, { status: 400 });
    }

    const calls = [
      { to: token, data: IFACE.encodeFunctionData('symbol', []) },
      { to: token, data: IFACE.encodeFunctionData('decimals', []) },
      { to: token, data: IFACE.encodeFunctionData('balanceOf', [owner]) },
      { to: token, data: IFACE.encodeFunctionData('allowance', [owner, spender]) },
    ];

    const debugBase = { version: API_VERSION, tokenIn, ownerIn, spenderIn, token, owner, spender };

    const batch = await rpcBatchCall(calls);
    if (batch) {
      const { rpc, results, mode } = batch;
      const symbol = String(decode(results, 'symbol', 0, '???'));
      const decimals = Number(decode(results, 'decimals', 1, 18));
      const balance = decode(results, 'balanceOf', 2, 0n).toString();
      const allowance = decode(results, 'allowance', 3, 0n).toString();

      const looksBad = token.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' && Number(decimals) !== 6;
      if (!looksBad) {
        console.log('[token-batch]', { ...debugBase, rpc, mode, symbol, decimals, balance, allowance });
        return Response.json({ ok: true, rpc, mode, symbol, decimals, balance, allowance, raw: results, debug: debugBase });
      }
    }

    const direct = await rpcDirectRead(token, owner, spender);
    console.log('[token-batch-direct]', { ...debugBase, ...direct });
    return Response.json({ ok: true, ...direct, debug: debugBase });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'token batch failed', version: API_VERSION }, { status: 500 });
  }
}
