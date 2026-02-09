import './globals.css';
import { Press_Start_2P, VT323 } from 'next/font/google';

const pressStart2P = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--font-pixel-heading' });
const vt323 = VT323({ subsets: ['latin'], weight: '400', variable: '--font-pixel-body' });

export const metadata = {
  title: 'The Grand Bazaar',
  description: 'P2P swap bazaar for Farcaster + Base',
  other: {
    'fc:frame': 'vNext',
    'fc:frame:image': 'https://example.com/og.png',
    'fc:frame:button:1': 'Open Bazaar',
    'fc:frame:post_url': 'https://example.com/api/frame',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${pressStart2P.variable} ${vt323.variable}`}>
      <body>{children}</body>
    </html>
  );
}
