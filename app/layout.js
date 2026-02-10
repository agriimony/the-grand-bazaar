import './globals.css';
import { Press_Start_2P, VT323 } from 'next/font/google';

const pressStart2P = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--font-pixel-heading' });
const vt323 = VT323({ subsets: ['latin'], weight: '400', variable: '--font-pixel-body' });

const miniAppEmbed = {
  version: '1',
  imageUrl: 'https://the-grand-bazaar.vercel.app/og.svg',
  button: {
    title: 'Open Bazaar',
    action: {
      type: 'launch_frame',
      name: 'The Grand Bazaar',
      url: 'https://the-grand-bazaar.vercel.app/',
      splashImageUrl: 'https://the-grand-bazaar.vercel.app/splash.svg',
      splashBackgroundColor: '#111111',
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
      <body>{children}</body>
    </html>
  );
}
