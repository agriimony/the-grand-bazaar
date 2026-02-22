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
    const text = data?.cast?.text || '';
    const compressedOrder = extractCompressedOrder(text);

    if (!compressedOrder) {
      return Response.json({ ok: false, error: 'Malformed cast format. Expected GBZ1:<compressedOrder>' }, { status: 422 });
    }

    const embedUrls = Array.isArray(data?.cast?.embeds)
      ? data.cast.embeds
          .map((e) => String(e?.url || e?.cast?.url || '').trim())
          .filter(Boolean)
      : [];

    return Response.json({
      ok: true,
      castHash,
      compressedOrder,
      embedUrls,
      authorFid: data?.cast?.author?.fid || null,
    });
  } catch {
    return Response.json({ ok: false, error: 'Failed to load order from cast hash' }, { status: 500 });
  }
}
