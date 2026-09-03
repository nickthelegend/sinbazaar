# SINBAZAAR — Blitz v8 submission pack

Everything a judge needs, in the order they will ask for it.
Submit at <https://build.magicblock.app/?stage=blitz#submit>.

---

## One-liner

A village of markets where the underlying is a secret. The venue is a Private Ephemeral Rollup.
VRF is the court. Solana is the graveyard.

## The sentence that explains the whole project

> Confession stays in a Private Ephemeral Rollup. The market runs in real time on an Ephemeral Rollup.
> MagicBlock VRF picks the reader. Solana only receives a tombstone.

## Elevator paragraph

Solana cannot hide a confession. A Private Ephemeral Rollup can. SINBAZAAR seals one sentence inside a
TEE-backed rollup, publishes only its hash and a timer, and runs a live market on top of it: pay SEAL
to keep it buried, pay READ for the chance to be its one reader. Bidding is ER-native — lamports move
between two delegated PDAs at rollup speed, and every bid hides behind its own permission, so nobody
sees anyone else's side or size. When the timer hits zero MagicBlock VRF returns a number, the program
picks the verdict, and exactly one key is added to the confession's member list. Solana receives a
tombstone: hash, outcome, pots, randomness — and the sentence itself only when the village voted for
that by paying nothing at all.

---

## Links

| | |
|---|---|
| Repo | <https://github.com/nickthelegend/sinbazaar> |
| Program (devnet) | [`2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN`](https://explorer.solana.com/address/2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN?cluster=devnet) |
| Privacy proof (devnet, real TEE) | `. ./.env.devnet && npx ts-node scripts/prove-privacy.ts` |
| Public market from that run | [`9tE7qFDnVug5iEeSdgtb6xg6MiAJyeXtLxDGqbfUtYh1`](https://explorer.solana.com/address/9tE7qFDnVug5iEeSdgtb6xg6MiAJyeXtLxDGqbfUtYh1?cluster=devnet) |
| Private secret from that run | [`9ZyuZERpymZGpy68CFTornYViCY4LYYncrSYaFWGPaiL`](https://explorer.solana.com/address/9ZyuZERpymZGpy68CFTornYViCY4LYYncrSYaFWGPaiL?cluster=devnet) |
| Demo video | *(record from [DEMO.md](DEMO.md); `npx ts-node scripts/demo.ts` narrates the same beats in a terminal)* |
| Live app | *(optional; the app runs locally with `cd app && npm run dev`)* |

---

## MagicBlock primitives used

Every one of these is load-bearing. Nothing here is decoration.

| Primitive | What it does in SINBAZAAR | Where to look |
|---|---|---|
| **Private Ephemeral Rollups** | The confession lives in a TEE-backed rollup behind an ephemeral permission with `is_private = true` and a member list that starts as `[author]`. It is written only on the ER and **never undelegated**. | `init_secret_permission`, `seal_secret`, `grant_reader` |
| **Ephemeral permissions as access control** | The VRF verdict is executed by *rewriting the member list* from `[author]` to `[author, sole_reader]`. Access control, not encryption. | `grant_reader` |
| **Ephemeral Rollups** | The market is delegated so bidding is real-time; bids move lamports between two program-owned delegated PDAs with no base-layer transaction. | `delegate_market`, `delegate_purse`, `fund_bid` |
| **Ephemeral Accounts** | Bids and session scopes are ER-only accounts sponsored by the market PDA. They are born, used and closed inside the rollup. | `place_bid`, `open_session`, `close_bid` |
| **MagicBlock VRF** | Decides the verdict while the market is still delegated, through a callback authenticated by a scoped identity PDA only the VRF program can sign for. | `request_resolution_vrf`, `callback_resolve` |
| **Session keys** | A villager mints a key scoped to one market with a spend ceiling and an expiry, then bids without a wallet popup. Scope is enforced by the program. | `open_session`, `place_bid_with_session` |
| **commit / commit_and_undelegate** | The market is committed and handed back to Solana; the tombstone is written on the base layer against the returned account. | `finalize_market`, `commit_market`, `write_tombstone` |
| **Permissionless cranks** | `expire_market`, `settle_bid`, `close_bid`, `close_book` and `retry_vrf` are all callable by anyone, so no market can be held hostage by an absent author or a stalled oracle. | those instructions |

## Official examples this was built from

Cloned from <https://github.com/magicblock-labs/magicblock-engine-examples> and transplanted, not admired:

| Example | What was taken |
|---|---|
| `private-counter` | The whole PER shape: delegate the data account only, create the ephemeral permission on the ER, flip privacy by rewriting members. |
| `sealed-auction` | Sealed bids as ephemeral accounts with per-bid private permissions; a sponsor PDA floating ER rent; cleanup-gated undelegation. |
| `roll-dice` | `create_request_scoped_randomness_ix`, the `#[vrf]` / `#[vrf_callback]` macro pair, and `rnd::random_u64`. |
| `rewards-delegated-vrf` | Requesting randomness against the *ephemeral* queue while the account is delegated. |
| `binary-prediction` | The two-sided book and pro-rata settlement behind Whisper IPO. |
| `counter`, `session-keys`, `rock-paper-scissor` | `exit(&crate::ID)` before a commit — the line whose absence broke our public-leak path. |
| `spl-tokens` | The migration target for moving escrow off native SOL. |

---

## What we would build in Forge

1. **Silence as a transferable object.** Right now the sole reader is a name on a permission list. Make
   that position an asset: a `Relic` that can be sold, inherited, or burned. Reselling the right to
   read is a market that cannot exist on a public chain.
2. **Inheritance of Sin.** A dead-man's switch: name a successor, go quiet past the deadline, and the
   permission executes the will on its own. The enum variant is already there.
3. **Replace the attestation resolver.** Whisper IPO settles today on the author's word. Wire the
   MagicBlock Pricing Oracle where a rumor is price-shaped, and a jury-of-seven vote (also enumerated)
   where it is not.
4. **eSPL escrow.** Move the pots to a stablecoin so a confession has a denominated price, using the
   `spl-tokens` lifecycle rather than raw lamports.
5. **Stain and CleanBadge.** Reputation that accrues from behaviour inside the bazaar — who buries,
   who reads, who leaks — without ever exposing what any individual confession said.
6. **The challenge page, hosted.** `scripts/prove-privacy.ts` as a public URL anyone can point at their
   own key: get a valid TEE token, try to read the confession, be refused, see the receipt.

---

## Team

*(fill in before submitting — name, handle, and one line on who built what)*

---

## Safety

Fiction mode is on by default and the seeded content is startup-village satire. SINBAZAAR is a social
game and a dark-market simulation, not a venue for real leverage over real people. The program is
deliberately unable to read the confessions it escrows — that is the design — so content safety lives
in the front end, the seed data, and the social contract, and the README says so plainly.
