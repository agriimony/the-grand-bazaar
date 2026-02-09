export async function POST() {
  return Response.json({
    type: 'frame',
    action: 'open',
    url: 'https://the-grand-bazaar.vercel.app/',
  });
}
