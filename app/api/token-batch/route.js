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

    const signerTokenIn = searchParams.get('signerToken') || '';
    const signerOwnerIn = searchParams.get('signerOwner') || '';
    const senderTokenIn = searchParams.get('senderToken') || '';
    const senderOwnerIn = searchParams.get('senderOwner') || '';
    const spenderIn = searchParams.get('spender') || '';

    if (!(signerTokenIn && signerOwnerIn && senderTokenIn && senderOwnerIn && spenderIn)) {
      return Response.json({
        ok: false,
        error: 'missing required params for pair mode',
        expected: ['signerToken', 'signerOwner', 'senderToken', 'senderOwner', 'spender'],
        version: API_VERSION,
      }, { status: 400 });
    }

    const signerToken = canonAddr(signerTokenIn);
    const signerOwner = canonAddr(signerOwnerIn);
    const senderToken = canonAddr(senderTokenIn);
    const senderOwner = canonAddr(senderOwnerIn);
    const spender = canonAddr(spenderIn);

    const calls = [
      { to: signerToken, data: IFACE.encodeFunctionData('symbol', []) },
      { to: signerToken, data: IFACE.encodeFunctionData('decimals', []) },
      { to: signerToken, data: IFACE.encodeFunctionData('balanceOf', [signerOwner]) },
      { to: signerToken, data: IFACE.encodeFunctionData('allowance', [signerOwner, spender]) },
      { to: senderToken, data: IFACE.encodeFunctionData('symbol', []) },
      { to: senderToken, data: IFACE.encodeFunctionData('decimals', []) },
      { to: senderToken, data: IFACE.encodeFunctionData('balanceOf', [senderOwner]) },
      { to: senderToken, data: IFACE.encodeFunctionData('allowance', [senderOwner, spender]) },
    ];

    const batch = await rpcBatchCall(calls);
    if (batch) {
      const { rpc, results, mode } = batch;
      return Response.json({
        ok: true,
        rpc,
        mode,
        version: API_VERSION,
        signer: {
          symbol: String(decode(results, 'symbol', 0, '???')),
          decimals: Number(decode(results, 'decimals', 1, 18)),
          balance: decode(results, 'balanceOf', 2, 0n).toString(),
          allowance: decode(results, 'allowance', 3, 0n).toString(),
        },
        sender: {
          symbol: String(decode(results, 'symbol', 4, '???')),
          decimals: Number(decode(results, 'decimals', 5, 18)),
          balance: decode(results, 'balanceOf', 6, 0n).toString(),
          allowance: decode(results, 'allowance', 7, 0n).toString(),
        },
        debug: { signerToken, signerOwner, senderToken, senderOwner, spender },
      });
    }

    const signerDirect = await rpcDirectRead(signerToken, signerOwner, spender);
    const senderDirect = await rpcDirectRead(senderToken, senderOwner, spender);
    return Response.json({
      ok: true,
      rpc: signerDirect.rpc || senderDirect.rpc,
      mode: 'direct',
      version: API_VERSION,
      signer: signerDirect,
      sender: senderDirect,
      debug: { signerToken, signerOwner, senderToken, senderOwner, spender },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'token batch failed', version: API_VERSION }, { status: 500 });
  }
}
