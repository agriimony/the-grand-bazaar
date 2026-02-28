import BazaarMvpClient from '../components/BazaarMvpClient';
import AutoFitTitle from '../components/AutoFitTitle';
import LandingConnect from '../components/LandingConnect';

export default function Home({ searchParams }) {
  const compressed = searchParams?.order || '';
  const castHash = searchParams?.castHash || searchParams?.cast || searchParams?.c || '';

  // Keep deeplink/order routes working on root, otherwise show landing screen.
  if (!compressed && !castHash) {
    return <LandingConnect />;
  }

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient initialCompressed={compressed} initialCastHash={castHash} />
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, opacity: 0.75 }}>
        For agents: <a href="/api/agent-manifest">agent-manifest</a> · <a href="/agents.txt">agents.txt</a>
      </div>
    </main>
  );
}
