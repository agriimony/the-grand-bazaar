# The Grand Bazaar

MVP Farcaster miniapp for sharing and taking Base swap orders.

## Current MVP

- Decode AirSwap compressed orders
- Farcaster SDK-first wallet connection flow
- Probe signing using in-app provider

## Run

```bash
npm install
npm run dev
```

App runs on `http://localhost:3410`.

## Notes

- Wallet flow prioritizes `@farcaster/frame-sdk` provider
- Falls back to injected provider only if Farcaster SDK provider is unavailable
- `.well-known/farcaster.json` is scaffolded and needs real production URLs + account association values
