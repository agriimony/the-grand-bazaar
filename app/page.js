import BazaarMvpClient from '../components/BazaarMvpClient';
import AutoFitTitle from '../components/AutoFitTitle';

export default function Home({ searchParams }) {
  const compressed = searchParams?.order || '';

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient initialCompressed={compressed} />
    </main>
  );
}
