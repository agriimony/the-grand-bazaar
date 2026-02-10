import AutoFitTitle from '../../../components/AutoFitTitle';
import BazaarMvpClient from '../../../components/BazaarMvpClient';

export default function CastHashPage({ params }) {
  const castHash = params?.castHash || '';

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient initialCastHash={castHash} />
    </main>
  );
}
