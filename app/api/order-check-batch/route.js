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
const ERC721_APPROVAL_ABI = ['function getApproved(uint256 tokenId) view returns (address)'];
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

function isEthSentinelAddr(addr = '') {
  const a = String(addr || '').trim().toLowerCase();
  return a === 'eth'
    || a === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    || a === ethers.ZeroAddress.toLowerCase()
    || a === '0x000000000000000000000000000000000000dead';
}

function isValidTokenRef(v) {
  const raw = String(v || '').trim();
  if (!raw) return false;
  if (isEthSentinelAddr(raw)) return true;
  return ethers.isAddress(raw);
}

function precheck(order, senderWallet) {
  const isHex32 = (v) => /^0x[a-fA-F0-9]{64}$/.test(String(v || '').trim());
  const isOpenOrder = String(order?.sender?.wallet || '').trim().toLowerCase() === ethers.ZeroAddress.toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);

  if (Number(order?.expiry || 0) <= nowSec) return { ok: false, reason: 'expired' };
  if (!ethers.isAddress(String(order?.swapContract || '').trim())) return { ok: false, reason: 'bad_swap_contract' };
  if (!ethers.isAddress(String(order?.signer?.wallet || '').trim())) return { ok: false, reason: 'bad_signer_wallet' };
  if (!isOpenOrder && !ethers.isAddress(String(order?.sender?.wallet || '').trim())) return { ok: false, reason: 'bad_sender_wallet' };
  if (!isValidTokenRef(order?.signer?.token)) return { ok: false, reason: 'bad_signer_token' };
  if (!isValidTokenRef(order?.sender?.token)) return { ok: false, reason: 'bad_sender_token' };
  if (!Number.isFinite(Number(order?.nonce))) return { ok: false, reason: 'bad_nonce' };
  if (!Number.isFinite(Number(order?.expiry))) return { ok: false, reason: 'bad_expiry' };
  if (BigInt(order?.signer?.amount || 0) <= 0n) return { ok: false, reason: 'bad_signer_amount' };
  if (BigInt(order?.sender?.amount || 0) <= 0n) return { ok: false, reason: 'bad_sender_amount' };
  if (Number(order?.v || 0) <= 0) return { ok: false, reason: 'bad_v' };
  if (!isHex32(order?.r) || !isHex32(order?.s)) return { ok: false, reason: 'bad_sig' };
  if (!ethers.isAddress(String(senderWallet || ethers.ZeroAddress))) return { ok: false, reason: 'bad_sender_wallet_effective' };

  return { ok: true };
}

async function checkOne({ rpc, item }) {
  const startedAt = Date.now();
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
  const swapContract = norm(item.swapContract || '');
  const senderWallet = norm(item.senderWallet || ethers.ZeroAddress);
  const order = item.order || {};

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

  const checkErrors = Array.isArray(rawErrors) ? rawErrors.map(toUtf8OrHex).filter(Boolean) : [];

  const signerKindNow = String(onchainOrder?.signer?.kind || '').toLowerCase();
  const senderKindNow = String(onchainOrder?.sender?.kind || '').toLowerCase();
  const signerIsNft = signerKindNow === KIND_ERC721 || signerKindNow === KIND_ERC1155;
  const senderIsNft = senderKindNow === KIND_ERC721 || senderKindNow === KIND_ERC1155;
  let checkErrorsFiltered = [...checkErrors];

  if (signerIsNft && checkErrorsFiltered.includes('SignerAllowanceLow')) {
    try {
      let signerApprovalFallbackOk = false;
      if (signerKindNow === KIND_ERC721) {
        const c721 = new ethers.Contract(onchainOrder.signer.token, ERC721_APPROVAL_ABI, provider);
        const approvedTo = norm(await c721.getApproved(onchainOrder.signer.id));
        signerApprovalFallbackOk = approvedTo === norm(swapContract);
      } else {
        const signerNft = new ethers.Contract(onchainOrder.signer.token, NFT_ABI, provider);
        signerApprovalFallbackOk = Boolean(await signerNft.isApprovedForAll(onchainOrder.signer.wallet, swapContract));
      }
      if (signerApprovalFallbackOk) checkErrorsFiltered = checkErrorsFiltered.filter((e) => e !== 'SignerAllowanceLow');
    } catch {}
  }

  if (senderIsNft && checkErrorsFiltered.includes('SenderAllowanceLow') && senderWallet && senderWallet !== ethers.ZeroAddress) {
    try {
      let senderApprovalFallbackOk = false;
      if (senderKindNow === KIND_ERC721) {
        const c721 = new ethers.Contract(onchainOrder.sender.token, ERC721_APPROVAL_ABI, provider);
        const approvedTo = norm(await c721.getApproved(onchainOrder.sender.id));
        senderApprovalFallbackOk = approvedTo === norm(swapContract);
      } else {
        const senderNft = new ethers.Contract(onchainOrder.sender.token, NFT_ABI, provider);
        senderApprovalFallbackOk = Boolean(await senderNft.isApprovedForAll(senderWallet, swapContract));
      }
      if (senderApprovalFallbackOk) checkErrorsFiltered = checkErrorsFiltered.filter((e) => e !== 'SenderAllowanceLow');
    } catch {}
  }

  if (item.publicMode) {
    checkErrorsFiltered = checkErrorsFiltered.filter((e) => e !== 'SenderBalanceLow' && e !== 'SenderAllowanceLow');
  }

  console.log('[order-check-batch][item]', {
    id: item.id,
    rpc,
    publicMode: Boolean(item.publicMode),
    swapContract,
    senderWallet,
    signerWallet: norm(order?.signer?.wallet || ''),
    nonce: String(order?.nonce || ''),
    expiry: String(order?.expiry || ''),
    nonceUsed: Boolean(nonceUsed),
    protocolFeeOnchain: protocolFeeOnchain.toString(),
    checkErrors,
    checkErrorsFiltered,
    pass: !Boolean(nonceUsed) && checkErrorsFiltered.length === 0,
    ms: Date.now() - startedAt,
  });

  return {
    ok: true,
    id: item.id,
    requiredSenderKind,
    protocolFeeOnchain: protocolFeeOnchain.toString(),
    nonceUsed: Boolean(nonceUsed),
    checkErrors: checkErrorsFiltered,
  };
}

export async function POST(req) {
  try {
    const startedAt = Date.now();
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      console.log('[order-check-batch] empty items');
      return Response.json({ ok: true, results: [] });
    }

    console.log('[order-check-batch] start', {
      total: items.length,
      ids: items.map((i, idx) => i?.id || String(idx)),
    });

    const prechecked = items.map((item, idx) => {
      const ord = item?.order || {};
      const payload = {
        id: item?.id || String(idx),
        swapContract: item?.swapContract,
        senderWallet: item?.senderWallet || ethers.ZeroAddress,
        publicMode: Boolean(item?.publicMode),
        order: {
          nonce: ord?.nonce,
          expiry: ord?.expiry,
          signer: ord?.signer || {},
          sender: ord?.sender || {},
          affiliateWallet: ord?.affiliateWallet || ethers.ZeroAddress,
          affiliateAmount: ord?.affiliateAmount || 0,
          v: ord?.v,
          r: ord?.r,
          s: ord?.s,
          swapContract: item?.swapContract,
        },
      };
      const p = precheck(payload, payload.senderWallet);
      return { payload, pre: p };
    });

    const ready = prechecked.filter((x) => x.pre.ok).map((x) => x.payload);
    const earlyRejects = prechecked
      .filter((x) => !x.pre.ok)
      .map((x) => ({ ok: false, id: x.payload.id, error: x.pre.reason, preRpcRejected: true }));

    if (earlyRejects.length) {
      console.log('[order-check-batch] pre-rpc rejects', earlyRejects);
    }
    console.log('[order-check-batch] rpc-ready', ready.map((r) => ({ id: r.id, nonce: String(r?.order?.nonce || ''), swapContract: r.swapContract })));

    const results = [];
    for (const item of ready) {
      let lastErr = null;
      let success = null;
      for (const rpc of BASE_RPCS) {
        try {
          success = await checkOne({ rpc, item });
          break;
        } catch (e) {
          lastErr = e;
          console.log('[order-check-batch][rpc-error]', { id: item.id, rpc, error: e?.message || 'rpc failed' });
        }
      }
      if (success) results.push(success);
      else results.push({ ok: false, id: item.id, error: lastErr?.message || 'order-check failed' });
    }

    const merged = [...earlyRejects, ...results];
    console.log('[order-check-batch] done', {
      total: items.length,
      preRejected: earlyRejects.length,
      rpcProcessed: ready.length,
      passed: merged.filter((r) => r?.ok && !r?.nonceUsed && Array.isArray(r?.checkErrors) && r.checkErrors.length === 0).length,
      failed: merged.filter((r) => !r?.ok || r?.nonceUsed || (Array.isArray(r?.checkErrors) && r.checkErrors.length > 0)).length,
      ms: Date.now() - startedAt,
    });
    return Response.json({ ok: true, results: merged });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'order-check batch failed' }, { status: 500 });
  }
}
