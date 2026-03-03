import AutoFitTitle from '../../../components/AutoFitTitle';
import BazaarMvpClient from '../../../components/BazaarMvpClient';

export function generateMetadata({ params }) {
  const castHash = params?.castHash || '';
  const appUrl = `https://bazaar.agrimonys.com/c/${castHash}`;
  const imageUrl = `https://bazaar.agrimonys.com/api/og?castHash=${encodeURIComponent(castHash)}`;

  const miniAppEmbed = {
    version: '1',
    imageUrl,
    button: {
      title: 'Enter the Bazaar',
      action: {
        type: 'launch_frame',
        name: 'The Grand Bazaar',
        url: appUrl,
        splashImageUrl: 'https://bazaar.agrimonys.com/splash.jpg',
        splashBackgroundColor: '#111111',
      },
    },
  };

  return {
    title: 'The Grand Bazaar',
    description: 'P2P swap bazaar for Farcaster + Base',
    other: {
      'fc:miniapp': JSON.stringify(miniAppEmbed),
    },
  };
}

export default function CastHashPage({ params }) {
  const castHash = params?.castHash || '';

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient initialCastHash={castHash} />
    </main>
  );
}
