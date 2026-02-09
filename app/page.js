import BazaarMvpClient from '../components/BazaarMvpClient';
import AutoFitTitle from '../components/AutoFitTitle';

export default function Home({ searchParams }) {
  const compressed = searchParams?.order || '';
  const castHash = searchParams?.castHash || searchParams?.cast || searchParams?.c || '';

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient initialCompressed={compressed} initialCastHash={castHash} />
    </main>
  );
}
