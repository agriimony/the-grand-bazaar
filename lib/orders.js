import LZString from 'lz-string';

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
  };
}

export const seedOrders = [];
