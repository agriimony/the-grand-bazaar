import {
  BAZAAR_URL,
  buildSnap,
  corsHeaders,
  fallbackResponse,
  getContextFromEnvelope,
  getSnapContent,
  parseJfsEnvelope,
  snapHeaders,
  wantsSnap,
} from '../../lib/snap.js';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(req) {
  if (!wantsSnap(req)) {
    return fallbackResponse();
  }

  return Response.json(
    buildSnap(
      getSnapContent(null, {
        submitTarget: `${BAZAAR_URL}snap`,
      })
    ),
    {
      headers: snapHeaders(),
    }
  );
}

export async function POST(req) {
  if (!wantsSnap(req)) {
    return fallbackResponse(406);
  }

  let requestBody = null;

  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      requestBody = await req.json();
    } else {
      requestBody = await req.text();
    }
  } catch {
    requestBody = null;
  }

  const envelope = parseJfsEnvelope(requestBody);
  const context = getContextFromEnvelope(envelope);

  return Response.json(buildSnap(getSnapContent(context, {
    submitTarget: `${BAZAAR_URL}snap`,
  })), {
    headers: snapHeaders(),
  });
}
