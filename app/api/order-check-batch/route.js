import { runOrderCheckBatch } from '../../../lib/orderCheckBatch';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const result = await runOrderCheckBatch(items);
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'order-check batch failed' }, { status: 500 });
  }
}
