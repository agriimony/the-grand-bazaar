export async function GET(req) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const skillBase = `${origin}/skills/grand-bazaar-swap`;

  return Response.json({
    ok: true,
    app: 'the-grand-bazaar',
    agentManifestVersion: 1,
    skills: [
      {
        name: 'grand-bazaar-swap',
        bundleBaseUrl: skillBase,
        entry: `${skillBase}/SKILL.md`,
        references: [
          `${skillBase}/references/base-mainnet-deployments.md`,
          `${skillBase}/references/pricing-params.md`,
        ],
        scripts: [
          `${skillBase}/scripts/signer_make_order.js`,
          `${skillBase}/scripts/sender_execute_order.js`,
          `${skillBase}/scripts/make_cast_payload.js`,
        ],
        installHint: 'Download this folder and place it under your OpenClaw skills directory as grand-bazaar-swap.',
      },
    ],
  });
}
