# SINBAZAAR — web app

> The confession stays in a Private Ephemeral Rollup. The market runs in real time on an
> Ephemeral Rollup. MagicBlock VRF picks the reader. Solana only receives a tombstone.

Next.js 15 (App Router, TypeScript, one global stylesheet).

## Run

```sh
cp .env.local.example .env.local     # localnet values, mirrors ../scripts/local-env.sh
npm install
npm run dev                          # http://localhost:3000
```

`npm run dev` and `npm run build` both run `copy-idl` first, which copies
`../target/idl/sinbazaar.json` into `src/idl/` and falls back to the committed copy when the
program has not been built on this machine.

The MagicBlock stack has to be up separately (`npm run stack` at the repo root) for anything to
load — the app talks to three live endpoints and fakes none of them.

## Wallets

Two ways to hold a key, switched from the top-right of every page:

- **burner** — a keypair in `localStorage`, auto-airdropped on localnet. The default when
  `NEXT_PUBLIC_CLUSTER=localnet`, because a browser extension cannot reach a local validator.
- **wallet** — `@solana/wallet-adapter-react`, for devnet. Phantom, Solflare and anything else
  that registers through the Wallet Standard shows up on its own.

## Screens

| route | what it is |
| --- | --- |
| `/` | the village feed — live markets polled off the ER |
| `/confess` | the create flow, one ticked-off step per instruction |
| `/market/[address]` | one stall: bid SEAL/READ, the timer, the pots, the rule box |
| `/market/[address]/result` | the verdict, plus the authenticated read of the confession |
| `/graveyard` | tombstones, read from the BASE layer only |
| `/rooms` | 3 live rooms and the 22 the program enumerates and rejects |

## Where each thing talks

- `NEXT_PUBLIC_BASE_RPC` — creation, delegation, tombstones, real SOL.
- `NEXT_PUBLIC_ER_RPC` — bidding, expiry, VRF, settlement.
- `NEXT_PUBLIC_TEE_RPC` — the authenticated read. A JWT rides as `?token=` on both the http and
  the ws URL, never as a header. Whether it answers is decided by the account's permission
  member list, not by the token.

`src/lib/magicblock.ts` restates the few MagicBlock constants and the auth handshake rather than
importing the SDK entry point, which re-exports a wasm TEE quote verifier this app never calls.

## Fiction mode

Every seeded confession is startup-village satire — decks, demos, cofounders. The banner is
part of the product, not decoration.
