import BazaarMvpClient from '../components/BazaarMvpClient';

export default function Home({ searchParams }) {
  const compressed = searchParams?.order || '';

  return (
    <main className="bazaar-shell">
      <h1 className="app-title">The Grand Bazaar</h1>
      <BazaarMvpClient initialCompressed={compressed} />
    </main>
  );
}
