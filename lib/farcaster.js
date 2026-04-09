import fs from 'fs';
import os from 'os';
import path from 'path';
import { neynarCachedGetJson } from './neynar-cache.js';

export const FARCASTER_API_BASE_URL = 'https://haatz.quilibrium.com';
export const NEYNAR_API_BASE_URL = 'https://api.neynar.com';

export function getFarcasterApiKey() {
  const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'neynar.json');
  let apiKey = process.env.NEYNAR_API_KEY || '';
  if (!apiKey && fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    apiKey = raw?.apiKey || '';
  }
  return apiKey;
}

function buildHeaders() {
  const apiKey = getFarcasterApiKey();
  const headers = { accept: 'application/json' };
  if (apiKey) headers.api_key = apiKey;
  return headers;
}

function toNeynarUrl(url) {
  return String(url || '').replace(FARCASTER_API_BASE_URL, NEYNAR_API_BASE_URL);
}

async function fetchJson(url, { cache = 'no-store' } = {}) {
  const res = await fetch(url, { headers: buildHeaders(), cache });
  if (!res.ok) {
    const error = new Error(`Farcaster API request failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchFarcasterJsonWithFallback(url, {
  cache = 'no-store',
  namespace = 'farcaster',
  ttlSeconds = 300,
  isMissing,
} = {}) {
  let primaryError = null;

  try {
    const json = await fetchJson(url, { cache });
    if (!isMissing?.(json)) return json;
    primaryError = new Error('Farcaster API primary returned no result');
    primaryError.code = 'PRIMARY_MISS';
  } catch (error) {
    primaryError = error;
  }

  const fallbackUrl = toNeynarUrl(url);
  const { ok, status, json } = await neynarCachedGetJson({
    url: fallbackUrl,
    headers: buildHeaders(),
    namespace,
    ttlSeconds,
  });

  if (ok && !isMissing?.(json)) return json;

  const error = new Error(
    primaryError?.message
      || `Farcaster API fallback failed with ${status || 'unknown status'}`
  );
  error.status = primaryError?.status || status;
  throw error;
}
