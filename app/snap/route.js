export async function GET() {
  return Response.json(
    {
      version: '1',
      title: 'Grand Bazaar',
      description: 'Decode GBZ1 swap orders and open Grand Bazaar',
      ui: {
        root: 'screen',
        elements: {
          screen: {
            type: 'container',
            props: { direction: 'vertical', gap: 12 },
            children: ['title', 'desc', 'cta'],
          },
          title: {
            type: 'text',
            props: { text: 'Grand Bazaar Snap', weight: 'bold', size: 'lg' },
          },
          desc: {
            type: 'text',
            props: {
              text: 'Launch Grand Bazaar and parse GBZ1 order blobs from casts.',
            },
          },
          cta: {
            type: 'button',
            props: { label: 'Open Grand Bazaar', variant: 'primary' },
            on: {
              press: {
                action: 'open_url',
                params: { url: 'https://bazaar.agrimonys.com/' },
              },
            },
          },
        },
      },
    },
    {
      headers: {
        'content-type': 'application/vnd.farcaster.snap+json',
        'cache-control': 'no-store',
      },
    }
  );
}

export async function POST(req) {
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

  const openUrl = castHash
    ? `https://bazaar.agrimonys.com/c/${castHash}`
    : 'https://bazaar.agrimonys.com/';

  return Response.json(
    {
      version: '1',
      title: 'Grand Bazaar',
      description: 'Open the order in Grand Bazaar',
      ui: {
        root: 'screen',
        elements: {
          screen: {
            type: 'container',
            props: { direction: 'vertical', gap: 12 },
            children: ['title', 'meta', 'cta'],
          },
          title: {
            type: 'text',
            props: { text: 'Grand Bazaar Order', weight: 'bold', size: 'lg' },
          },
          meta: {
            type: 'text',
            props: {
              text: castHash
                ? `Cast: ${castHash.slice(0, 10)}...${castHash.slice(-6)}`
                : 'No cast hash detected in payload',
              size: 'sm',
            },
          },
          cta: {
            type: 'button',
            props: { label: 'Open in Grand Bazaar', variant: 'primary' },
            on: {
              press: {
                action: 'open_url',
                params: { url: openUrl },
              },
            },
          },
        },
      },
    },
    {
      headers: {
        'content-type': 'application/vnd.farcaster.snap+json',
        'cache-control': 'no-store',
      },
    }
  );
}
