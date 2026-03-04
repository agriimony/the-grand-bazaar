import { NextResponse } from 'next/server';
import { getNeonSql } from '../../../../lib/neon';

export const dynamic = 'force-dynamic';

function parseTokenId(raw = '') {
  const s = String(raw || '').trim().replace(/\.json$/i, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s).toString(10);
  return null;
}

function toAttrArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(_req, { params }) {
  try {
    const tokenId = parseTokenId(params?.id);
    if (!tokenId) return NextResponse.json({ error: 'invalid token id' }, { status: 400 });

    const sql = getNeonSql();
    if (!sql) return NextResponse.json({ error: 'missing database url' }, { status: 500 });

    const tableRaw = process.env.GBZ_1155_TABLE || 'items_1155';
    const table = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableRaw) ? tableRaw : 'items_1155';
    const query = `
      select
        token_id,
        name,
        symbol,
        description,
        image,
        animation_url,
        external_url,
        background_color,
        attributes,
        properties
      from ${table}
      where token_id = $1
      limit 1
    `;

    const rows = await sql.query(query, [tokenId]);
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      return NextResponse.json({ error: 'metadata not found', tokenId }, { status: 404 });
    }

    const out = {
      name: row.name || `Grand Bazaar Item #${tokenId}`,
      description: row.description || '',
      image: row.image || '',
      attributes: toAttrArray(row.attributes),
    };

    if (row.symbol) out.symbol = String(row.symbol);

    if (row.animation_url) out.animation_url = row.animation_url;
    if (row.external_url) out.external_url = row.external_url;
    if (row.background_color) out.background_color = row.background_color;
    if (row.properties && typeof row.properties === 'object') out.properties = row.properties;

    return NextResponse.json(out, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'metadata fetch failed' }, { status: 500 });
  }
}
