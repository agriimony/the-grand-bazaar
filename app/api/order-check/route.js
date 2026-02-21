import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function nonceUsed(address signer,uint256 nonce) view returns (bool)',
  'function check(address senderWallet,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) view returns (bytes32[])',
];

const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];

function toUtf8OrHex(v) {
  try {
    const s = ethers.decodeBytes32String(v);
    return String(s || '').trim();
  } catch {
    return String(v || '');
  }
}

function norm(addr = '') {
  try {
    return ethers.getAddress(String(addr || '').trim());
  } catch {
    return String(addr || '').trim();
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const swapContract = norm(body?.swapContract || '');
    const senderWallet = norm(body?.senderWallet || ethers.ZeroAddress);
    const order = body?.order || {};

    console.log('[order-check][request]', {
      swapContract,
      senderWallet,
      signerWallet: norm(order?.signer?.wallet || ''),
      senderTargetWallet: norm(order?.sender?.wallet || ''),
      nonce: String(order?.nonce || ''),
      expiry: String(order?.expiry || ''),
      signerKind: String(order?.signer?.kind || ''),
      senderKind: String(order?.sender?.kind || ''),
    });

    if (!swapContract || !order?.signer?.wallet || order?.nonce == null) {
      return Response.json({ ok: false, error: 'missing required params' }, { status: 400 });
    }

    let lastErr = null;
    for (const rpc of BASE_RPCS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
        const swap = new ethers.Contract(swapContract, SWAP_ABI, provider);

        const [requiredSenderKind, protocolFeeOnchain, nonceUsed] = await Promise.all([
          swap.requiredSenderKind(),
          swap.protocolFee(),
          swap.nonceUsed(norm(order.signer.wallet), BigInt(order.nonce)).catch(() => false),
        ]);

        const onchainOrder = {
          nonce: BigInt(order.nonce),
          expiry: BigInt(order.expiry),
          signer: {
            wallet: norm(order.signer.wallet),
            token: norm(order.signer.token),
            kind: String(order.signer.kind || requiredSenderKind),
            id: BigInt(order.signer.id || 0),
            amount: BigInt(order.signer.amount),
          },
          sender: {
            wallet: norm(order.sender.wallet || ethers.ZeroAddress),
            token: norm(order.sender.token),
            kind: String(order.sender.kind || requiredSenderKind),
            id: BigInt(order.sender.id || 0),
            amount: BigInt(order.sender.amount),
          },
          affiliateWallet: norm(order.affiliateWallet || ethers.ZeroAddress),
          affiliateAmount: BigInt(order.affiliateAmount || 0),
          v: Number(order.v || 0),
          r: order.r,
          s: order.s,
        };

        const rawErrors = await swap.check(senderWallet, onchainOrder).catch(() => []);

        const checkErrors = Array.isArray(rawErrors)
          ? rawErrors.map(toUtf8OrHex).filter(Boolean)
          : [];
        const rawErrorsHex = Array.isArray(rawErrors) ? rawErrors.map((v) => String(v || '')) : [];

        console.log('[order-check][result]', {
          rpc,
          requiredSenderKind,
          protocolFeeOnchain: protocolFeeOnchain.toString(),
          nonceUsed: Boolean(nonceUsed),
          rawErrorsHex,
          checkErrors,
        });

        return Response.json({
          ok: true,
          rpc,
          requiredSenderKind,
          protocolFeeOnchain: protocolFeeOnchain.toString(),
          nonceUsed: Boolean(nonceUsed),
          checkErrors,
          debug: {
            rawErrorsHex,
            senderWallet,
            signerWallet: onchainOrder.signer.wallet,
            senderTargetWallet: onchainOrder.sender.wallet,
          },
        });
      } catch (e) {
        lastErr = e;
        console.log('[order-check][rpc-error]', { rpc, error: e?.message || 'order-check rpc failed' });
      }
    }

    return Response.json({ ok: false, error: lastErr?.message || 'order-check failed' }, { status: 500 });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'order-check failed' }, { status: 500 });
  }
}
