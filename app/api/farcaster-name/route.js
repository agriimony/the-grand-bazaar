import fs from 'fs';
import os from 'os';
import path from 'path';

function truncateAddress(addr = '') {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const address = (searchParams.get('address') || '').trim();
    if (!address) return Response.json({ name: '', fallback: '', profileUrl: '' });

    const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
    let apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey && fs.existsSync(credPath)) {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey = raw?.apiKey || '';
    }

    if (!apiKey) {
      return Response.json({ name: '', fallback: truncateAddress(address), profileUrl: '' });
    }

    const addrTypes = ['verified_address', 'custody_address'];
    let name = '';

    for (const t of addrTypes) {
      const url = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(address)}&address_types=${t}`;
      const r = await fetch(url, {
        headers: {
          accept: 'application/json',
          api_key: apiKey,
        },
        cache: 'no-store',
      });

      if (!r.ok) continue;
      const data = await r.json();
      const users = data?.[address.toLowerCase()] || data?.[address] || [];
      const u = users?.[0];
      name = u?.username || u?.display_name || '';
      if (name) break;
    }

    const profileUrl = name ? `https://warpcast.com/${String(name).replace(/^@/, '')}` : '';
    return Response.json({ name, fallback: truncateAddress(address), profileUrl });
  } catch {
    return Response.json({ name: '', fallback: '', profileUrl: '' });
  }
}
