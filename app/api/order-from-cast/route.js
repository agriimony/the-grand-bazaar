import fs from 'fs';
import os from 'os';
import path from 'path';

function extractCompressedOrder(text = '') {
  // Strict parser format: GBZ1:<compressedOrder>
  const m = text.match(/(?:^|\n)GBZ1:([A-Za-z0-9+\-_%]+)(?:\n|$)/);
  if (!m) return null;
  return m[1];
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const castHash = (searchParams.get('castHash') || searchParams.get('hash') || '').trim();
    if (!castHash) {
      return Response.json({ ok: false, error: 'Missing castHash' }, { status: 400 });
    }

    const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
    let apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey && fs.existsSync(credPath)) {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey = raw?.apiKey || '';
    }
    if (!apiKey) {
      return Response.json({ ok: false, error: 'Neynar API key missing on server' }, { status: 500 });
    }

    const url = `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(castHash)}&type=hash`;
    const r = await fetch(url, {
      headers: { api_key: apiKey, accept: 'application/json' },
      cache: 'no-store',
    });

    if (!r.ok) {
      return Response.json({ ok: false, error: 'Cast not found from hash' }, { status: 404 });
    }

    const data = await r.json();
    let sourceCast = data?.cast || null;
    const text = sourceCast?.text || '';
    let compressedOrder = extractCompressedOrder(text);
    let sourceCastHash = castHash;

    // Fallback for step-2 deeplink/reply casts: try parent cast for GBZ1 payload.
    if (!compressedOrder) {
      const parentHash = String(
        data?.cast?.parent_hash
        || data?.cast?.parentHash
        || data?.cast?.parent?.hash
        || ''
      ).trim();

      if (parentHash) {
        const parentUrl = `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(parentHash)}&type=hash`;
        const pr = await fetch(parentUrl, {
          headers: { api_key: apiKey, accept: 'application/json' },
          cache: 'no-store',
        });
        if (pr.ok) {
          const pd = await pr.json();
          compressedOrder = extractCompressedOrder(pd?.cast?.text || '');
          if (compressedOrder) {
            sourceCastHash = parentHash;
            sourceCast = pd?.cast || sourceCast;
          }
        }
      }
    }

    if (!compressedOrder) {
      return Response.json({ ok: false, error: 'Malformed cast format. Expected GBZ1:<compressedOrder>' }, { status: 422 });
    }

    const embedUrls = Array.isArray(sourceCast?.embeds)
      ? sourceCast.embeds
          .map((e) => String(e?.url || e?.cast?.url || '').trim())
          .filter(Boolean)
      : [];

    return Response.json({
      ok: true,
      castHash,
      sourceCastHash,
      compressedOrder,
      embedUrls,
      authorFid: data?.cast?.author?.fid || null,
    });
  } catch {
    return Response.json({ ok: false, error: 'Failed to load order from cast hash' }, { status: 500 });
  }
}
