import './globals.css';
import { Press_Start_2P, VT323 } from 'next/font/google';
import WagmiProvider from '../components/WagmiProvider';
import { Analytics } from '@vercel/analytics/next';

const pressStart2P = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--font-pixel-heading' });
const vt323 = VT323({ subsets: ['latin'], weight: '400', variable: '--font-pixel-body' });

const miniAppEmbed = {
  version: '1',
  imageUrl: 'https://bazaar.agrimonys.com/api/og',
  castShareUrl: 'https://bazaar.agrimonys.com/share',
  button: {
    title: 'Enter the Bazaar',
    action: {
      type: 'launch_frame',
      name: 'The Grand Bazaar',
      splashImageUrl: 'https://bazaar.agrimonys.com/splash.jpg',
      splashBackgroundColor: '#A8CB58',
    },
  },
};

export const metadata = {
  title: 'The Grand Bazaar',
  description: 'P2P swap bazaar for Farcaster + Base',
  other: {
    'fc:miniapp': JSON.stringify(miniAppEmbed),
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${pressStart2P.variable} ${vt323.variable}`}>
      <body>
        <WagmiProvider>{children}</WagmiProvider>
        <Analytics />
      </body>
    </html>
  );
}
