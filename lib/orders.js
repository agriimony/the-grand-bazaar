import LZString from 'lz-string';

const KIND_ERC20 = '0x36372b07';

export function decodeCompressedOrder(compressed) {
  const csv = LZString.decompressFromEncodedURIComponent(compressed);
  if (!csv) throw new Error('Invalid compressed order');
  const s = csv.split(',');
  if (s.length < 14) throw new Error('Malformed order payload');
  return {
    chainId: Number(s[0]),
    swapContract: s[1],
    nonce: s[2],
    expiry: s[3],
    signerWallet: s[4],
    signerToken: s[5],
    signerAmount: s[6],
    protocolFee: s[7],
    senderWallet: s[8],
    senderToken: s[9],
    senderAmount: s[10],
    v: s[11],
    r: s[12],
    s: s[13],
    signerKind: s[14] || KIND_ERC20,
    signerId: s[15] || '0',
    senderKind: s[16] || KIND_ERC20,
    senderId: s[17] || '0',
  };
}

export function encodeCompressedOrder(fullOrder) {
  const csv = [
    String(fullOrder.chainId),
    String(fullOrder.swapContract),
    String(fullOrder.nonce),
    String(fullOrder.expiry),
    String(fullOrder.signerWallet),
    String(fullOrder.signerToken),
    String(fullOrder.signerAmount),
    String(fullOrder.protocolFee),
    String(fullOrder.senderWallet),
    String(fullOrder.senderToken),
    String(fullOrder.senderAmount),
    String(fullOrder.v),
    String(fullOrder.r),
    String(fullOrder.s),
    String(fullOrder.signerKind || KIND_ERC20),
    String(fullOrder.signerId || 0),
    String(fullOrder.senderKind || KIND_ERC20),
    String(fullOrder.senderId || 0),
  ].join(',');
  return LZString.compressToEncodedURIComponent(csv);
}

export const seedOrders = [];
