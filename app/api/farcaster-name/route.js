import fs from 'fs';
import os from 'os';
import path from 'path';

function truncateAddress(addr = '') {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

function getPrimaryAddress(u) {
  return (
    u?.verified_addresses?.primary?.eth_address
    || u?.custody_address
    || u?.verified_addresses?.eth_addresses?.[0]
    || ''
  );
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const address = (searchParams.get('address') || '').trim();
    const queryRaw = (searchParams.get('query') || '').trim();
    const query = queryRaw.replace(/^@+/, '').trim();
    if (!address && !query) return Response.json({ name: '', fallback: '', profileUrl: '', address: '' });

    const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
    let apiKey = process.env.NEYNAR_API_KEY || '';
    if (!apiKey && fs.existsSync(credPath)) {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey = raw?.apiKey || '';
    }

    if (!apiKey) {
      return Response.json({ name: '', fallback: truncateAddress(address), profileUrl: '', address: address || '' });
    }

    if (query && !address) {
      const url = `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(query)}&limit=8`;
      const r = await fetch(url, {
        headers: { accept: 'application/json', api_key: apiKey },
        cache: 'no-store',
      });
      if (!r.ok) return Response.json({ name: '', fallback: query, profileUrl: '', address: '', users: [] });
      const data = await r.json();
      const usersRaw = data?.result?.users || data?.users || [];
      const users = usersRaw.map((u) => {
        const username = u?.username || u?.display_name || '';
        return {
          name: username,
          profileUrl: username ? `https://warpcast.com/${String(username).replace(/^@/, '')}` : '',
          address: getPrimaryAddress(u) || '',
          pfpUrl: u?.pfp_url || u?.pfp?.url || '',
        };
      });
      const first = users[0] || { name: '', profileUrl: '', address: '', pfpUrl: '' };
      return Response.json({ ...first, fallback: query, users });
    }

    const addrTypes = ['verified_address', 'custody_address'];
    let name = '';
    let primaryAddress = address || '';
    let pfpUrl = '';

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
      primaryAddress = getPrimaryAddress(u) || primaryAddress;
      pfpUrl = u?.pfp_url || u?.pfp?.url || pfpUrl;
      if (name) break;
    }

    const profileUrl = name ? `https://warpcast.com/${String(name).replace(/^@/, '')}` : '';
    return Response.json({ name, fallback: truncateAddress(address), profileUrl, address: primaryAddress || '', pfpUrl });
  } catch {
    return Response.json({ name: '', fallback: '', profileUrl: '', address: '' });
  }
}
