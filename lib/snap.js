import { ethers } from 'ethers';
import { decodeCompressedOrder } from './orders.js';
import { fetchFarcasterJsonWithFallback, FARCASTER_API_BASE_URL } from './farcaster.js';

export const SNAP_MEDIA_TYPE = 'application/vnd.farcaster.snap+json';
export const BAZAAR_URL = 'https://bazaar.agrimonys.com/';
const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';
const MAX_SEARCH_DEPTH = 6;
const BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const ERC20_METADATA_ABI = [
  'function decimals() view returns (uint8)',
];
const TOKEN_METADATA_TTL_MS = 1000 * 60 * 60 * 6;
const MAKER_PROFILE_TTL_MS = 1000 * 60 * 30;
const tokenMetadataCache = new Map();
const makerProfileCache = new Map();

export function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Accept, Content-Type',
    'access-control-max-age': '86400',
  };
}

export function wantsSnap(req) {
  const accept = req.headers.get('accept') || '';
  return accept
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .includes(SNAP_MEDIA_TYPE);
}

export function snapHeaders() {
  return {
    ...corsHeaders(),
    'content-type': SNAP_MEDIA_TYPE,
    'cache-control': 'no-store',
    vary: 'Accept',
  };
}

export function fallbackHeaders() {
  return {
    ...corsHeaders(),
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Accept',
  };
}

export function fallbackResponse(status = 200) {
  return new Response(
    `This endpoint serves a Farcaster Snap. Send Accept: ${SNAP_MEDIA_TYPE} or open ${BAZAAR_URL}`,
    {
      status,
      headers: fallbackHeaders(),
    }
  );
}

function decodeBase64UrlString(value) {
  if (typeof value !== 'string' || !value.length) return null;
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function decodeBase64UrlJson(value) {
  try {
    const decoded = decodeBase64UrlString(value);
    return decoded ? JSON.parse(decoded) : null;
  } catch {
    return null;
  }
}

export function parseJfsEnvelope(body) {
  if (typeof body === 'string') {
    const parts = body.split('.');
    if (parts.length === 3) {
      return {
        compact: body,
        header: decodeBase64UrlJson(parts[0]),
        payload: decodeBase64UrlJson(parts[1]),
        signature: parts[2],
      };
    }

    try {
      const parsed = JSON.parse(body);
      return parseJfsEnvelope(parsed);
    } catch {
      return { compact: body, header: null, payload: null, signature: null };
    }
  }

  if (body && typeof body === 'object') {
    if (typeof body.header === 'string' && typeof body.payload === 'string') {
      return {
        compact: [body.header, body.payload, body.signature].filter(Boolean).join('.'),
        header: decodeBase64UrlJson(body.header),
        payload: decodeBase64UrlJson(body.payload),
        signature: typeof body.signature === 'string' ? body.signature : null,
      };
    }

    if (typeof body.jfs === 'string') {
      return parseJfsEnvelope(body.jfs);
    }
  }

  return { compact: null, header: null, payload: null, signature: null };
}

export function extractCompressedOrder(text = '') {
  const match = String(text || '').match(/(?:^|\s)GBZ1:\s*(([A-Za-z0-9+\-$]+(?:\s+[A-Za-z0-9+\-$]+)*))/i);
  if (!match) return null;
  const cleaned = String(match[1] || '')
    .trim()
    .replace(/["'`’”.,;:!?\])}>]+$/g, '')
    .replace(/\s+/g, '');
  return cleaned || null;
}

function collectCastCandidates(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value) || depth > MAX_SEARCH_DEPTH) return [];
  seen.add(value);

  const candidates = [];
  const looksLikeCast = typeof value.hash === 'string'
    || typeof value.text === 'string'
    || typeof value.castHash === 'string'
    || typeof value.parent_hash === 'string';

  if (looksLikeCast) {
    candidates.push(value);
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      candidates.push(...collectCastCandidates(nested, depth + 1, seen));
    }
  }

  return candidates;
}

function normalizeCastCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const hash = [candidate.hash, candidate.castHash, candidate.cast_hash]
    .find((item) => typeof item === 'string' && item.trim());
  const text = [candidate.text, candidate.castText, candidate.cast_text, candidate.body]
    .find((item) => typeof item === 'string');
  const authorFid = [candidate.author?.fid, candidate.authorFid, candidate.author_fid, candidate.fid]
    .find((item) => typeof item === 'number' || (typeof item === 'string' && item.trim()));

  if (!hash && !text) return null;

  return {
    hash: typeof hash === 'string' ? hash.trim() : null,
    text: typeof text === 'string' ? text : '',
    authorFid: authorFid == null ? null : Number(authorFid),
  };
}

export function getContextFromEnvelope(envelope) {
  const sources = [envelope?.payload, envelope?.header].filter(Boolean);
  const normalized = sources
    .flatMap((source) => collectCastCandidates(source))
    .map((candidate) => normalizeCastCandidate(candidate))
    .filter(Boolean);

  const hostCast = normalized.find((candidate) => candidate.text || candidate.hash) || null;
  const castHash = normalized.find((candidate) => candidate.hash)?.hash || null;
  const castText = hostCast?.text || '';
  const compressedOrder = extractCompressedOrder(castText);

  let order = null;
  let orderError = null;

  if (compressedOrder) {
    try {
      order = decodeCompressedOrder(compressedOrder);
    } catch (error) {
      orderError = error instanceof Error ? error.message : 'Invalid GBZ1 blob';
    }
  }

  return {
    source: 'envelope',
    castHash,
    castText,
    hostCast,
    compressedOrder,
    order,
    orderError,
  };
}

function shortenHex(value, left = 6, right = 4) {
  const text = String(value || '');
  if (text.length <= left + right + 3) return text;
  return `${text.slice(0, left)}...${text.slice(-right)}`;
}

function kindLabel(kind) {
  const normalized = String(kind || KIND_ERC20).toLowerCase();
  if (normalized === KIND_ERC721) return 'ERC721';
  if (normalized === KIND_ERC1155) return 'ERC1155';
  return 'ERC20';
}

function isFresh(entry, ttlMs) {
  return Boolean(entry && (Date.now() - entry.updatedAt) < ttlMs);
}

function trimTrailingZeros(text) {
  return String(text || '')
    .replace(/(\.\d*?[1-9])0+$/,'$1')
    .replace(/\.0+$/,'');
}

function formatTokenAmount(amount, decimals) {
  try {
    const raw = BigInt(amount);
    const safeDecimals = Math.max(0, Math.min(36, Number(decimals) || 0));
    const formatted = ethers.formatUnits(raw, safeDecimals);
    const [whole, frac = ''] = formatted.split('.');
    if (!frac) return whole;
    const clippedFrac = frac.slice(0, 6);
    const combined = `${whole}.${clippedFrac}`;
    return trimTrailingZeros(combined);
  } catch {
    return String(amount || '0');
  }
}

async function readContractString(provider, address, signatures) {
  for (const signature of signatures) {
    try {
      const iface = new ethers.Interface([signature]);
      const data = iface.encodeFunctionData(signature.match(/function\s+([^\(]+)/)?.[1] || 'symbol');
      const result = await provider.call({ to: address, data });
      const decoded = iface.decodeFunctionResult(signature.match(/function\s+([^\(]+)/)?.[1] || 'symbol', result)?.[0];
      if (typeof decoded === 'string' && decoded.trim()) return decoded.trim();
      if (typeof decoded === 'string') return decoded;
      if (decoded && typeof decoded === 'object' && typeof decoded.toString === 'function') {
        const asString = decoded.toString();
        if (asString && !/^0x0*$/i.test(asString)) return asString;
      }
    } catch {
      continue;
    }
  }
  return '';
}

async function resolveErc20Metadata(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!ethers.isAddress(normalized)) {
    return { symbol: shortenHex(token, 8, 4), decimals: null, source: 'invalid' };
  }

  const cached = tokenMetadataCache.get(normalized);
  if (isFresh(cached, TOKEN_METADATA_TTL_MS)) return cached.value;

  let fallback = { symbol: shortenHex(normalized, 8, 4), decimals: null, source: 'fallback' };
  for (const rpc of BASE_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
      const contract = new ethers.Contract(normalized, ERC20_METADATA_ABI, provider);
      const [decimalsRaw, symbolRaw] = await Promise.all([
        contract.decimals().catch(() => null),
        readContractString(provider, normalized, [
          'function symbol() view returns (string)',
          'function symbol() view returns (bytes32)',
        ]),
      ]);
      const value = {
        symbol: symbolRaw || fallback.symbol,
        decimals: Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : null,
        source: 'rpc',
      };
      tokenMetadataCache.set(normalized, { value, updatedAt: Date.now() });
      return value;
    } catch {
      continue;
    }
  }

  tokenMetadataCache.set(normalized, { value: fallback, updatedAt: Date.now() });
  return fallback;
}

function getPrimaryAddress(u) {
  return (
    u?.verified_addresses?.primary?.eth_address
    || u?.custody_address
    || u?.verified_addresses?.eth_addresses?.[0]
    || ''
  );
}


async function resolveMakerProfile(address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!ethers.isAddress(normalized)) return null;

  const cached = makerProfileCache.get(normalized);
  if (isFresh(cached, MAKER_PROFILE_TTL_MS)) return cached.value;

  for (const addressType of ['verified_address', 'custody_address']) {
    try {
      const url = `${FARCASTER_API_BASE_URL}/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(normalized)}&address_types=${addressType}`;
      const json = await fetchFarcasterJsonWithFallback(url, {
        namespace: `snap-maker:${addressType}`,
        ttlSeconds: 1800,
        isMissing: (data) => {
          const users = data?.[normalized] || data?.[String(address || '')] || [];
          return !users?.length;
        },
      });
      const users = json?.[normalized] || json?.[String(address || '')] || [];
      const user = users?.[0] || null;
      const username = String(user?.username || '').trim();
      const fname = String(user?.display_name || user?.displayName || '').trim();
      const value = {
        username,
        fname,
        fid: user?.fid ?? null,
        address: getPrimaryAddress(user) || normalized,
      };
      if (username || fname) {
        makerProfileCache.set(normalized, { value, updatedAt: Date.now() });
        return value;
      }
    } catch {
      continue;
    }
  }

  makerProfileCache.set(normalized, { value: null, updatedAt: Date.now() });
  return null;
}

function isZeroAddress(address) {
  return String(address || '').trim().toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

function formatProfileLabel(profile, fallbackAddress, prefix) {
  if (profile?.username) {
    const name = `@${profile.username}`;
    if (profile?.fname && profile.fname.toLowerCase() !== profile.username.toLowerCase()) {
      return `${prefix}: ${name} · ${profile.fname}`;
    }
    return `${prefix}: ${name}`;
  }

  if (profile?.fname) {
    return `${prefix}: ${profile.fname}`;
  }

  return `${prefix}: ${shortenHex(fallbackAddress, 8, 4)}`;
}

async function formatAsset(order, side) {
  const kind = side === 'signer' ? order?.signerKind : order?.senderKind;
  const token = side === 'signer' ? order?.signerToken : order?.senderToken;
  const amount = side === 'signer' ? order?.signerAmount : order?.senderAmount;
  const tokenId = side === 'signer' ? order?.signerId : order?.senderId;
  const label = kindLabel(kind);

  if (label === 'ERC20') {
    const metadata = await resolveErc20Metadata(token);
    const renderedAmount = metadata?.decimals == null ? String(amount) : formatTokenAmount(amount, metadata.decimals);
    return `${renderedAmount} ${metadata?.symbol || shortenHex(token, 8, 4)}`;
  }

  return `${label} ${shortenHex(token, 8, 4)}#${tokenId || '0'}`;
}

function textElement(content, extra = {}) {
  return {
    type: 'text',
    props: { content, size: 'sm', ...extra },
  };
}

function formatExpiryLabel(expiry) {
  const expiryMs = Number(expiry) * 1000;
  if (!Number.isFinite(expiryMs)) return null;

  const diffSeconds = Math.floor((expiryMs - Date.now()) / 1000);
  if (diffSeconds <= 0) return 'Expired';

  const units = [
    { label: 'year', seconds: 60 * 60 * 24 * 365 },
    { label: 'month', seconds: 60 * 60 * 24 * 30 },
    { label: 'week', seconds: 60 * 60 * 24 * 7 },
    { label: 'day', seconds: 60 * 60 * 24 },
    { label: 'hour', seconds: 60 * 60 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 },
  ];

  const unit = units.find((candidate) => diffSeconds >= candidate.seconds) || units[units.length - 1];
  const value = Math.max(1, Math.floor(diffSeconds / unit.seconds));
  const suffix = value === 1 ? '' : 's';
  return `In ${value} ${unit.label}${suffix}`;
}

function buildExpiryElements(expiry, prefix) {
  const label = formatExpiryLabel(expiry);
  if (!label) return {};

  const isExpired = label === 'Expired';
  return {
    [`${prefix}ExpiryRow`]: {
      type: 'stack',
      props: { direction: 'horizontal', justify: 'center' },
      children: [`${prefix}ExpiryBadge`],
    },
    [`${prefix}ExpiryBadge`]: {
      type: 'badge',
      props: {
        label: isExpired ? 'Offer expired' : `Offer expires in ${label.slice(3).toLowerCase()}`,
        color: isExpired ? 'red' : 'green',
      },
    },
  };
}

function buildPartyCardElements(prefix, partyLabel, assetLabel) {
  return {
    [`${prefix}Card`]: {
      type: 'item_group',
      props: { border: true, separator: true },
      children: [`${prefix}PartyItem`, `${prefix}AssetItem`],
    },
    [`${prefix}PartyItem`]: {
      type: 'item',
      props: {
        title: partyLabel,
        description: 'Party',
      },
    },
    [`${prefix}AssetItem`]: {
      type: 'item',
      props: {
        title: assetLabel,
        description: 'Asset',
      },
    },
  };
}

export function buildSnap({ title, description, contextLine, bodyElementIds = [], extraElements = {}, primaryButton, secondaryButton }) {
  const elements = {
    page: {
      type: 'stack',
      props: {},
      children: ['title'],
    },
    title: {
      type: 'text',
      props: { content: title, weight: 'bold' },
    },
    ...extraElements,
  };

  if (description) {
    elements.page.children.push('desc');
    elements.desc = textElement(description);
  }

  if (contextLine) {
    elements.page.children.push('context');
    elements.context = textElement(contextLine);
  }

  if (Array.isArray(bodyElementIds) && bodyElementIds.length > 0) {
    elements.page.children.push(...bodyElementIds);
  }

  const actionIds = [];
  if (primaryButton) {
    actionIds.push('primaryButton');
    elements.primaryButton = {
      type: 'button',
      props: { label: primaryButton.label, variant: 'primary' },
      on: { press: primaryButton.onPress },
    };
  }
  if (secondaryButton) {
    actionIds.push('secondaryButton');
    elements.secondaryButton = {
      type: 'button',
      props: { label: secondaryButton.label, variant: secondaryButton.variant || 'secondary' },
      on: { press: secondaryButton.onPress },
    };
  }

  if (actionIds.length === 1) {
    elements.page.children.push(actionIds[0]);
  } else if (actionIds.length > 1) {
    elements.page.children.push('actions');
    elements.actions = {
      type: 'stack',
      props: { direction: 'horizontal', gap: 'sm' },
      children: actionIds,
    };
  }

  return {
    version: '1.0',
    theme: { accent: 'purple' },
    ui: {
      root: 'page',
      elements,
    },
  };
}

export async function getSnapContent(context, options = {}) {
  const submitTarget = options.submitTarget || `${BAZAAR_URL}snap`;
  const castHash = context?.castHash || null;
  const castTarget = castHash ? `${BAZAAR_URL}c/${castHash}` : BAZAAR_URL;

  if (context?.order) {
    const takerWallet = context.order?.senderWallet;
    const takerIsAnyone = isZeroAddress(takerWallet);
    const [signerAsset, senderAsset, makerProfile, takerProfile] = await Promise.all([
      formatAsset(context.order, 'signer'),
      formatAsset(context.order, 'sender'),
      resolveMakerProfile(context.order?.signerWallet),
      takerIsAnyone ? Promise.resolve(null) : resolveMakerProfile(takerWallet),
    ]);
    const makerLabel = formatProfileLabel(makerProfile, context.order?.signerWallet, 'Maker');
    const takerLabel = takerIsAnyone
      ? 'Taker: Anyone'
      : formatProfileLabel(takerProfile, takerWallet, 'Taker');

    return {
      title: 'Grand Bazaar Order',
      bodyElementIds: ['comparisonStack'],
      extraElements: {
        comparisonStack: {
          type: 'stack',
          props: { gap: 'md' },
          children: ['makerCard', 'swapIndicator', 'takerCard', 'orderExpiryRow'],
        },
        ...buildPartyCardElements('maker', makerLabel, signerAsset),
        swapIndicator: {
          type: 'stack',
          props: { gap: 'sm', justify: 'center' },
          children: ['swapSeparatorTop', 'swapArrow', 'swapWord', 'swapSeparatorBottom'],
        },
        swapSeparatorTop: {
          type: 'separator',
          props: {},
        },
        swapArrow: textElement('⇅', { weight: 'bold', align: 'center' }),
        swapWord: textElement('Swap', { align: 'center' }),
        swapSeparatorBottom: {
          type: 'separator',
          props: {},
        },
        ...buildPartyCardElements('taker', takerLabel, senderAsset),
        ...buildExpiryElements(context.order?.expiry, 'order'),
      },
      primaryButton: {
        label: 'View order',
        onPress: {
          action: 'open_mini_app',
          params: { target: castTarget },
        },
      },
      secondaryButton: castHash
        ? {
            label: 'View cast',
            onPress: {
              action: 'view_cast',
              params: { hash: castHash },
            },
          }
        : null,
    };
  }

  if (context?.compressedOrder && context?.orderError) {
    return {
      title: 'Grand Bazaar Cast',
      description: 'Found a GBZ1 blob in the cast, but it did not decode cleanly.',
      contextLine: context.orderError,
      primaryButton: {
        label: 'Open Bazaar',
        onPress: {
          action: 'open_mini_app',
          params: { target: castTarget },
        },
      },
      secondaryButton: castHash
        ? {
            label: 'View cast',
            onPress: {
              action: 'view_cast',
              params: { hash: castHash },
            },
          }
        : null,
    };
  }

  if (castHash || context?.castText) {
    return {
      title: 'Grand Bazaar Cast',
      description: castHash
        ? `Attached cast ${shortenHex(castHash, 10, 6)} has no decodable GBZ1 order blob.`
        : 'Attached cast context received, but no decodable GBZ1 order blob was found.',
      contextLine: context?.castText
        ? `Cast preview: ${String(context.castText).replace(/\s+/g, ' ').slice(0, 90)}`
        : null,
      primaryButton: {
        label: 'Open Bazaar',
        onPress: {
          action: 'open_mini_app',
          params: { target: castTarget },
        },
      },
      secondaryButton: castHash
        ? {
            label: 'View cast',
            onPress: {
              action: 'view_cast',
              params: { hash: castHash },
            },
          }
        : null,
    };
  }

  return {
    title: 'Grand Bazaar Snap',
    description: 'This generic snap cannot read the host cast context. Open the bazaar directly, or use a cast-specific snap link to inspect a GBZ1 order.',
    contextLine: 'For cast-aware previews, use /snap/c/[castHash].',
    primaryButton: {
      label: 'Open Bazaar',
      onPress: {
        action: 'open_mini_app',
        params: { target: BAZAAR_URL },
      },
    },
  };
}

export async function getContextFromCastHash(castHash) {
  const normalizedHash = String(castHash || '').trim();
  if (!normalizedHash) {
    return {
      source: 'url',
      castHash: null,
      castText: '',
      compressedOrder: null,
      order: null,
      orderError: 'Missing cast hash',
    };
  }

  try {
    const url = `${FARCASTER_API_BASE_URL}/v2/farcaster/cast?identifier=${encodeURIComponent(normalizedHash)}&type=hash`;
    const data = await fetchFarcasterJsonWithFallback(url, {
      namespace: `snap-cast:${normalizedHash}`,
      ttlSeconds: 300,
      isMissing: (payload) => !payload?.cast,
    });
    let sourceCast = data?.cast || null;
    let sourceHash = String(sourceCast?.hash || normalizedHash).trim() || normalizedHash;
    let castText = String(sourceCast?.text || '');
    let compressedOrder = extractCompressedOrder(castText);

    if (!compressedOrder) {
      const parentHash = String(
        sourceCast?.parent_hash
        || sourceCast?.parentHash
        || sourceCast?.parent?.hash
        || ''
      ).trim();

      if (parentHash) {
        try {
          const parentUrl = `${FARCASTER_API_BASE_URL}/v2/farcaster/cast?identifier=${encodeURIComponent(parentHash)}&type=hash`;
          const parentData = await fetchFarcasterJsonWithFallback(parentUrl, {
            namespace: `snap-cast-parent:${parentHash}`,
            ttlSeconds: 300,
            isMissing: (payload) => !payload?.cast,
          });
          const parentCast = parentData?.cast || null;
          const parentText = String(parentCast?.text || '');
          const parentCompressed = extractCompressedOrder(parentText);
          if (parentCompressed) {
            sourceCast = parentCast;
            sourceHash = String(parentCast?.hash || parentHash).trim() || parentHash;
            castText = parentText;
            compressedOrder = parentCompressed;
          }
        } catch {
          // Ignore parent lookup failures and keep graceful fallback to the original cast.
        }
      }
    }

    let order = null;
    let orderError = null;
    if (compressedOrder) {
      try {
        order = decodeCompressedOrder(compressedOrder);
      } catch (error) {
        orderError = error instanceof Error ? error.message : 'Invalid GBZ1 blob';
      }
    }

    return {
      source: 'url',
      castHash: sourceHash,
      castText,
      hostCast: sourceCast,
      compressedOrder,
      order,
      orderError,
    };
  } catch (error) {
    return {
      source: 'url',
      castHash: normalizedHash,
      castText: '',
      compressedOrder: null,
      order: null,
      orderError: error instanceof Error ? error.message : 'Failed to load cast hash',
    };
  }
}
