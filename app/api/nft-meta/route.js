export const dynamic = 'force-dynamic';

function ipfsGatewayCandidates(u = '') {
  const s = String(u || '').trim();
  if (!s) return [];
  if (!s.startsWith('ipfs://')) return [s];
  const cidPath = s.replace('ipfs://', '').replace(/^ipfs\//, '');
  return [
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://gateway.pinata.cloud/ipfs/${cidPath}`,
    `https://nftstorage.link/ipfs/${cidPath}`,
    `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
  ];
}

function ipfsToHttp(u = '') {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${s.replace('ipfs://', '').replace(/^ipfs\//, '')}`;
  return s;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const uri = String(searchParams.get('uri') || '').trim();
    if (!uri) return Response.json({ ok: false, error: 'missing uri' }, { status: 400 });

    if (uri.startsWith('data:application/json')) {
      try {
        const b64 = uri.split(',')[1] || '';
        const raw = Buffer.from(b64, 'base64').toString('utf8');
        const j = JSON.parse(raw);
        return Response.json({
          ok: true,
          uri,
          image: ipfsToHttp(j?.image || j?.image_url || ''),
          name: j?.name || null,
          symbol: j?.symbol || null,
          source: 'data-uri',
        });
      } catch {
        return Response.json({ ok: false, error: 'invalid data uri' }, { status: 400 });
      }
    }

    const candidates = ipfsGatewayCandidates(uri);
    for (const u of candidates) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) continue;
        const j = await r.json();
        const image = ipfsToHttp(j?.image || j?.image_url || '');
        return Response.json({ ok: true, uri: u, image, name: j?.name || null, symbol: j?.symbol || null, source: 'gateway' });
      } catch {
        // next gateway
      }
    }

    return Response.json({ ok: false, error: 'metadata fetch failed', uri }, { status: 502 });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'metadata fetch failed' }, { status: 500 });
  }
}
