import crypto from 'node:crypto';
import { getNeonSql } from './neon';

const ensuredTables = new Set();

function safeTableName(raw) {
  const name = String(raw || '').trim();
  if (!name) return 'neynar_feed';
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : 'neynar_feed';
}

function cacheKey(namespace, url) {
  return crypto
    .createHash('sha256')
    .update(`${String(namespace || 'default')}|${String(url || '')}`)
    .digest('hex');
}

async function ensureCacheTable(sql, table) {
  if (!sql || ensuredTables.has(table)) return;
  await sql.query(`
    create table if not exists ${table} (
      cache_key text primary key,
      response_json jsonb not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(`create index if not exists ${table}_expires_at_idx on ${table} (expires_at)`);
  ensuredTables.add(table);
}

export async function neynarCachedGetJson({
  url,
  headers,
  namespace = 'default',
  ttlSeconds = 300,
}) {
  const safeTtl = Math.max(1, Math.floor(Number(ttlSeconds) || 300));
  const sql = getNeonSql();
  const table = safeTableName(process.env.GBZ_NEYNAR_CACHE_TABLE || 'neynar_get_cache');
  const key = cacheKey(namespace, url);

  if (sql) {
    try {
      await ensureCacheTable(sql, table);
      const hit = await sql.query(
        `select response_json from ${table} where cache_key = $1 and expires_at > now() limit 1`,
        [key]
      );
      const row = Array.isArray(hit) ? hit[0] : null;
      if (row?.response_json && typeof row.response_json === 'object') {
        return { ok: true, status: 200, json: row.response_json, cached: true };
      }
    } catch {
      // Fall through to live fetch.
    }
  }

  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return { ok: false, status: res.status, json: null, cached: false };

  const json = await res.json();

  if (sql) {
    try {
      await sql.query(
        `
          insert into ${table} (cache_key, response_json, expires_at, updated_at)
          values ($1, $2::jsonb, now() + make_interval(secs => $3::int), now())
          on conflict (cache_key)
          do update set
            response_json = excluded.response_json,
            expires_at = excluded.expires_at,
            updated_at = now()
        `,
        [key, JSON.stringify(json), safeTtl]
      );
    } catch {
      // Ignore cache write failures.
    }
  }

  return { ok: true, status: res.status, json, cached: false };
}
