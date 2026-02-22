import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const SWAP_ABI = [
  'function protocolFee() view returns (uint256)',
  'function requiredSenderKind() view returns (bytes4)',
  'function nonceUsed(address signer,uint256 nonce) view returns (bool)',
  'function check(address senderWallet,(uint256 nonce,uint256 expiry,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) signer,(address wallet,address token,bytes4 kind,uint256 id,uint256 amount) sender,address affiliateWallet,uint256 affiliateAmount,uint8 v,bytes32 r,bytes32 s) order) view returns (bytes32[])',
];
const SWAP_ERC20_ABI = [
  'function protocolFee() view returns (uint256)',
  'function nonceUsed(address signer,uint256 nonce) view returns (bool)',
  'function check(address senderWallet,uint256 nonce,uint256 expiry,address signerWallet,address signerToken,uint256 signerAmount,address senderToken,uint256 senderAmount,uint8 v,bytes32 r,bytes32 s) view returns (bytes32[])',
];
const SWAP_ERC20 = '0x95D598D839dE1B030848664960F0A20b848193F4';
const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';
const NFT_ABI = ['function isApprovedForAll(address owner,address operator) view returns (bool)'];

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
        const isSwapErc20 = norm(swapContract) === norm(SWAP_ERC20);
        const swap = new ethers.Contract(swapContract, isSwapErc20 ? SWAP_ERC20_ABI : SWAP_ABI, provider);

        const [protocolFeeOnchain, nonceUsed, requiredSenderKind] = await Promise.all([
          swap.protocolFee(),
          swap.nonceUsed(norm(order.signer.wallet), BigInt(order.nonce)).catch(() => false),
          isSwapErc20 ? Promise.resolve(KIND_ERC20) : swap.requiredSenderKind(),
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

        const rawErrors = isSwapErc20
          ? await swap.check(
            senderWallet,
            BigInt(order.nonce),
            BigInt(order.expiry),
            norm(order.signer.wallet),
            norm(order.signer.token),
            BigInt(order.signer.amount),
            norm(order.sender.token),
            BigInt(order.sender.amount),
            Number(order.v || 0),
            order.r,
            order.s
          ).catch(() => [])
          : await swap.check(senderWallet, onchainOrder).catch(() => []);

        const checkErrors = Array.isArray(rawErrors)
          ? rawErrors.map(toUtf8OrHex).filter(Boolean)
          : [];
        const rawErrorsHex = Array.isArray(rawErrors) ? rawErrors.map((v) => String(v || '')) : [];

        const signerKindNow = String(onchainOrder?.signer?.kind || '').toLowerCase();
        const signerIsNft = signerKindNow === KIND_ERC721 || signerKindNow === KIND_ERC1155;
        let signerApprovalFallbackOk = false;
        let checkErrorsFiltered = checkErrors;

        if (signerIsNft && checkErrors.includes('SignerAllowanceLow')) {
          try {
            const signerNft = new ethers.Contract(onchainOrder.signer.token, NFT_ABI, provider);
            signerApprovalFallbackOk = Boolean(await signerNft.isApprovedForAll(onchainOrder.signer.wallet, swapContract));
            if (signerApprovalFallbackOk) {
              checkErrorsFiltered = checkErrors.filter((e) => e !== 'SignerAllowanceLow');
            }
          } catch {
            signerApprovalFallbackOk = false;
          }
        }

        console.log('[order-check][result]', {
          rpc,
          requiredSenderKind,
          protocolFeeOnchain: protocolFeeOnchain.toString(),
          nonceUsed: Boolean(nonceUsed),
          rawErrorsHex,
          checkErrors,
          checkErrorsFiltered,
          signerApprovalFallbackOk,
        });

        return Response.json({
          ok: true,
          rpc,
          requiredSenderKind,
          protocolFeeOnchain: protocolFeeOnchain.toString(),
          nonceUsed: Boolean(nonceUsed),
          checkErrors: checkErrorsFiltered,
          checkErrorsRaw: checkErrors,
          signerApprovalFallbackOk,
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
