'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig, WagmiProvider as BaseWagmiProvider, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http('https://mainnet.base.org'),
  },
  connectors: [farcasterMiniApp()],
});

const queryClient = new QueryClient();

export default function WagmiProvider({ children }) {
  return (
    <BaseWagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </BaseWagmiProvider>
  );
}
