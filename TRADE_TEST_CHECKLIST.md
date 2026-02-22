# Trade Test Checklist

Scope: Private counterparty permutations first.

## Legend
- Status: ⬜ not started, 🟨 in progress, ✅ pass, ❌ fail
- Notes: include tx hash, cast hash, and any UI/API issues

## Private Counterparty Matrix

| # | Make Kind | Take Kind | Status | Notes |
|---|---|---|---|---|
| 1 | ERC20 | ERC20 | ✅ | Private flow validated on routed SwapERC20 (`0x95D598...`). New round confirmed both legs operational after protocol-specific signer/taker path fixes. Fill tx: 0x77bc36a80caeae69ea3009e2c8c7cb298c94e59fd1c396574992ebe7b6400c4b from offer cast 0x702a03ddffee9b9ccec8fc564cefad9a9168b252 with success reply cast 0xdddae6703829c70cd1cf75c8ef741f3d709eed96. Key fixes validated: maker sign ABI/domain split, taker simulation ABI routing, signer-side fee accounting, approve amount/checker includes signer fee, and pre-sign preview fee placement (footer/amount/value) on correct side. |
| 2 | ERC20 | ERC721 | ⬜ | |
| 3 | ERC20 | ERC1155 | ✅ | Private flow validated. Offer cast: 0x906953a6b7897b45316fa6c46fbdaf46c8debb71. Fill tx: 0x2285af4997b71c10da45d1a7d92db04f1384bbcc59188a245da622920fa04ded. Success reply cast: 0xc4cc8a08da1f235280676d0c7d703678b61363e4. Reverse maker order posted before fill cycle: step1 0xe709aad907d03e1f4f680dfdb5e2403e71d7c47e, step2 0xbf4c79f3343b26f8c75f82167df34ff6347d3b32. |
| 4 | ERC721 | ERC20 | ⬜ | |
| 5 | ERC721 | ERC721 | ⬜ | |
| 6 | ERC721 | ERC1155 | ⬜ | |
| 7 | ERC1155 | ERC20 | ✅ | Private flow validated. Offer cast: 0x8177bafd3667fce3345665337716c8c411c1db7e. Fill tx: 0x7c456808bfc3e42fcc9dc08805e61217fafe1a408ab122d288a3a403b61c07da. Success reply cast: 0x9bf39ae710d26a0d93279ab80c0f194190cdea69. Reverse maker order posted back: step1 0xa23e44cbb6229ff1cf8e5f87dad198ea041e17d6, step2 0xf673812c52a74aae4a30db0d6236a1768e0344cb. |
| 8 | ERC1155 | ERC721 | ⬜ | |
| 9 | ERC1155 | ERC1155 | ⬜ | |

## Per-Test Validation Checklist

- [ ] Maker token selection works
- [ ] Counterparty token selection works
- [ ] Amount entry and fee-inclusive display are correct
- [ ] Insufficient-balance behavior is correct for private flow
- [ ] Approval flow works
- [ ] Signature flow works
- [ ] Taker execution succeeds
- [ ] Final balances look correct
- [ ] Post-swap cast/reply flow works

## Session Log

- Start: 2026-02-21 (Asia/Singapore)
