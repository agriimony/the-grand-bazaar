import {
  BAZAAR_URL,
  buildSnap,
  corsHeaders,
  fallbackResponse,
  getContextFromCastHash,
  getSnapContent,
  snapHeaders,
  wantsSnap,
} from '../../../../lib/snap.js';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(req, { params }) {
  if (!wantsSnap(req)) {
    return fallbackResponse();
  }

  const context = await getContextFromCastHash(params?.castHash || '');

  return Response.json(buildSnap(await getSnapContent(context, {
    submitTarget: `${BAZAAR_URL}snap`,
  })), {
    headers: snapHeaders(),
  });
}
