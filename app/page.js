import BazaarMvpClient from '../components/BazaarMvpClient';

export default function Home({ searchParams }) {
  const compressed = searchParams?.order || '';

  return (
    <main className="bazaar-shell">
      <h1>The Grand Bazaar</h1>
      <p>RuneScape-style trade layout for Base swaps.</p>
      <BazaarMvpClient initialCompressed={compressed} />
    </main>
  );
}
