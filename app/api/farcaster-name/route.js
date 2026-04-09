import fs from 'fs';
import os from 'os';
import path from 'path';

const FARCASTER_API_BASE_URL = 'https://haatz.quilibrium.com';

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

function getFarcasterApiKey() {
  const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
  let apiKey = process.env.NEYNAR_API_KEY || '';
  if (!apiKey && fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    apiKey = raw?.apiKey || '';
  }
  return apiKey;
}

async function fetchFarcasterJson(url) {
  const apiKey = getFarcasterApiKey();
  const headers = { accept: 'application/json' };
  if (apiKey) headers.api_key = apiKey;
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`Farcaster API request failed with ${r.status}`);
  return r.json();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const address = (searchParams.get('address') || '').trim();
    const fidRaw = (searchParams.get('fid') || '').trim();
    const fid = Number(fidRaw);
    const queryRaw = (searchParams.get('query') || '').trim();
    const query = queryRaw.replace(/^@+/, '').trim();
    if (!address && !query && !Number.isFinite(fid)) return Response.json({ name: '', fallback: '', profileUrl: '', address: '' });

    if (Number.isFinite(fid) && fid > 0 && !address && !query) {
      const url = `${FARCASTER_API_BASE_URL}/v2/farcaster/user/bulk?fids=${encodeURIComponent(String(fid))}`;
      const data = await fetchFarcasterJson(url).catch(() => null);
      if (!data) return Response.json({ name: '', fallback: String(fid), profileUrl: '', address: '', pfpUrl: '' });
      const users = data?.users || data?.result?.users || [];
      const u = users[0] || null;
      const username = u?.username || u?.display_name || '';
      const profileUrl = username ? `https://warpcast.com/${String(username).replace(/^@/, '')}` : '';
      return Response.json({ name: username, fallback: String(fid), profileUrl, address: getPrimaryAddress(u) || '', pfpUrl: u?.pfp_url || u?.pfp?.url || '' });
    }

    if (query && !address) {
      const url = `${FARCASTER_API_BASE_URL}/v2/farcaster/user/search?q=${encodeURIComponent(query)}&limit=8`;
      const data = await fetchFarcasterJson(url).catch(() => null);
      if (!data) return Response.json({ name: '', fallback: query, profileUrl: '', address: '', users: [] });
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
      const url = `${FARCASTER_API_BASE_URL}/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(address)}&address_types=${t}`;
      const data = await fetchFarcasterJson(url).catch(() => null);
      if (!data) continue;
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
