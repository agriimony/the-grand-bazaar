const SNAP_MEDIA_TYPE = 'application/vnd.farcaster.snap+json';
const BAZAAR_URL = 'https://bazaar.agrimonys.com/';

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Accept, Content-Type',
    'access-control-max-age': '86400',
  };
}

function wantsSnap(req) {
  const accept = req.headers.get('accept') || '';
  return accept
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .includes(SNAP_MEDIA_TYPE);
}

function snapHeaders() {
  return {
    ...corsHeaders(),
    'content-type': SNAP_MEDIA_TYPE,
    'cache-control': 'no-store',
    vary: 'Accept',
  };
}

function fallbackHeaders() {
  return {
    ...corsHeaders(),
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Accept',
  };
}

function fallbackResponse(status = 200) {
  return new Response(
    `This endpoint serves a Farcaster Snap. Send Accept: ${SNAP_MEDIA_TYPE} or open ${BAZAAR_URL}`,
    {
      status,
      headers: fallbackHeaders(),
    }
  );
}

function buildSnap({ title, description, target }) {
  return {
    version: '1.0',
    theme: { accent: 'purple' },
    ui: {
      root: 'page',
      elements: {
        page: {
          type: 'stack',
          props: {},
          children: ['title', 'desc', 'cta'],
        },
        title: {
          type: 'text',
          props: { content: title, weight: 'bold' },
        },
        desc: {
          type: 'text',
          props: { content: description, size: 'sm' },
        },
        cta: {
          type: 'button',
          props: { label: 'Open Grand Bazaar', variant: 'primary' },
          on: {
            press: {
              action: 'open_url',
              params: { target },
            },
          },
        },
      },
    },
  };
}

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
    buildSnap({
      title: 'Grand Bazaar Snap',
      description: 'Launch Grand Bazaar and parse GBZ1 order blobs from casts.',
      target: BAZAAR_URL,
    }),
    {
      headers: snapHeaders(),
    }
  );
}

export async function POST(req) {
  if (!wantsSnap(req)) {
    return fallbackResponse(406);
  }
  let castHash = null;

  try {
    const body = await req.json();
    const payloadRaw = body?.payload;
    if (typeof payloadRaw === 'string' && payloadRaw.length) {
      const padded = payloadRaw + '='.repeat((4 - (payloadRaw.length % 4)) % 4);
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      const possibleHash = decoded?.cast?.hash || decoded?.hash || null;
      if (typeof possibleHash === 'string' && possibleHash.startsWith('0x')) {
        castHash = possibleHash;
      }
    }
  } catch {
    // ignore malformed body for MVP
  }

  const target = castHash ? `https://bazaar.agrimonys.com/c/${castHash}` : BAZAAR_URL;

  return Response.json(
    buildSnap({
      title: 'Grand Bazaar Order',
      description: castHash
        ? `Cast: ${castHash.slice(0, 10)}...${castHash.slice(-6)}`
        : 'No cast hash detected in payload',
      target,
    }),
    {
      headers: snapHeaders(),
    }
  );
}
