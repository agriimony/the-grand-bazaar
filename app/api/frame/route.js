export async function POST() {
  return Response.json({
    type: 'frame',
    action: 'open',
    url: 'https://dev-bazaar.agrimonys.com/',
  });
}
