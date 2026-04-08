import fs from 'fs';
import os from 'os';
import path from 'path';
import { decodeCompressedOrder } from './orders.js';

export const SNAP_MEDIA_TYPE = 'application/vnd.farcaster.snap+json';
export const BAZAAR_URL = 'https://bazaar.agrimonys.com/';
const KIND_ERC20 = '0x36372b07';
const KIND_ERC721 = '0x80ac58cd';
const KIND_ERC1155 = '0xd9b67a26';
const MAX_SEARCH_DEPTH = 6;

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

function formatAsset(order, side) {
  const kind = side === 'signer' ? order?.signerKind : order?.senderKind;
  const token = side === 'signer' ? order?.signerToken : order?.senderToken;
  const amount = side === 'signer' ? order?.signerAmount : order?.senderAmount;
  const tokenId = side === 'signer' ? order?.signerId : order?.senderId;
  const label = kindLabel(kind);

  if (label === 'ERC20') {
    return `${amount} ${shortenHex(token, 8, 4)}`;
  }

  return `${label} ${shortenHex(token, 8, 4)}#${tokenId || '0'}`;
}

function textElement(content, extra = {}) {
  return {
    type: 'text',
    props: { content, size: 'sm', ...extra },
  };
}

export function buildSnap({ title, description, contextLine, primaryButton, secondaryButton }) {
  const elements = {
    page: {
      type: 'stack',
      props: {},
      children: ['title', 'desc'],
    },
    title: {
      type: 'text',
      props: { content: title, weight: 'bold' },
    },
    desc: textElement(description),
  };

  if (contextLine) {
    elements.page.children.push('context');
    elements.context = textElement(contextLine);
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

export function getSnapContent(context, options = {}) {
  const submitTarget = options.submitTarget || `${BAZAAR_URL}snap`;
  const castHash = context?.castHash || null;
  const castTarget = castHash ? `${BAZAAR_URL}c/${castHash}` : BAZAAR_URL;

  if (context?.order) {
    return {
      title: 'Grand Bazaar Order',
      description: `${formatAsset(context.order, 'signer')} ↔ ${formatAsset(context.order, 'sender')}`,
      contextLine: castHash
        ? `Decoded GBZ1 from cast ${shortenHex(castHash, 10, 6)}`
        : 'Decoded GBZ1 from attached cast context',
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

function getNeynarApiKey() {
  const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
  let apiKey = process.env.NEYNAR_API_KEY || '';
  if (!apiKey && fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    apiKey = raw?.apiKey || '';
  }
  return apiKey;
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

  const apiKey = getNeynarApiKey();
  if (!apiKey) {
    return {
      source: 'url',
      castHash: normalizedHash,
      castText: '',
      compressedOrder: null,
      order: null,
      orderError: 'Neynar API key missing on server',
    };
  }

  try {
    const url = `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(normalizedHash)}&type=hash`;
    const res = await fetch(url, {
      headers: { api_key: apiKey, accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        source: 'url',
        castHash: normalizedHash,
        castText: '',
        compressedOrder: null,
        order: null,
        orderError: 'Cast not found from hash',
      };
    }

    const data = await res.json();
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
        const parentUrl = `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(parentHash)}&type=hash`;
        const parentRes = await fetch(parentUrl, {
          headers: { api_key: apiKey, accept: 'application/json' },
          cache: 'no-store',
        });

        if (parentRes.ok) {
          const parentData = await parentRes.json();
          const parentCast = parentData?.cast || null;
          const parentText = String(parentCast?.text || '');
          const parentCompressed = extractCompressedOrder(parentText);
          if (parentCompressed) {
            sourceCast = parentCast;
            sourceHash = String(parentCast?.hash || parentHash).trim() || parentHash;
            castText = parentText;
            compressedOrder = parentCompressed;
          }
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
