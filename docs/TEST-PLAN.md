# SINBAZAAR — verification plan

Every component and every flow, with an explicit definition of *correct* for each.
This is the checklist the run is measured against. Status column is filled in by
execution, not by inspection: an item is PASS only when the observed result matches
the "correct means" column exactly, with a clean console and no failed network calls.

Legend — **L1** base Solana · **ER** ephemeral rollup · **PER** private (TEE) rollup

---

## A. On-chain program — instruction level

The program is the product. Each row is exercised by `tests/sinbazaar.ts` against a
live local MagicBlock cluster (real validators, real delegation, real VRF oracles,
real signed transactions) unless the row says devnet.

| # | Item | Layer | Correct means | Status |
|---|---|---|---|---|
| A1 | `initialize_village` | L1 | Village PDA exists, `authority` = signer, `market_count` = 0, `fiction_mode` = true | |
| A2 | `create_market` | L1 | Market PDA at `[market, village, id]`; status Open; `expires_at = now + duration`; PDA pre-funded with permission rent + `SPONSOR_FLOAT` | |
| A3 | `create_market` rejects a disabled room | L1 | `MirrorConfession` → `RoomNotLive` (6002); no account created | |
| A4 | `create_secret_shell` | L1 | Secret PDA allocated with **all-zero body**; author recorded | |
| A5 | `delegate_market` | L1→ER | Base owner becomes the delegation program; account appears on the ER | |
| A6 | `delegate_secret` | L1→PER | Same, on the TEE validator; authorship checked before handing over | |
| A7 | `delegate_secret` by a non-author | L1 | Fails `NotAuthor` (6022) | |
| A8 | `deposit_purse` + `delegate_purse` | L1→ER | Real SOL moves into the purse PDA; `available` matches; purse appears on the ER | |
| A9 | `init_market_permission` | ER | Permission exists, `is_private = false`, members `[author]` | |
| A10 | `init_secret_permission` (confession room) | PER | `is_private = **true**`, members exactly `[author]` | |
| A11 | `init_secret_permission` (Whisper IPO) | ER | `is_private = false` — a rumor is meant to be read | |
| A12 | `seal_secret` | PER | Body written **only** on the rollup; `market.commitment_hash == sha256(body‖salt)` | |
| A13 | `seal_secret` by a stranger | PER | Fails; body unchanged | |
| A14 | `seal_secret` with empty / oversized body | PER | `InvalidBodyLength` (6019) | |
| A15 | `place_bid` + `fund_bid` (one tx) | ER | Ephemeral bid created; lamports move purse→market by exactly the stake; correct pot incremented; `escrow_lamports` matches | |
| A16 | `place_bid` after expiry | ER | `MarketNotOpen` (6004) | |
| A17 | `place_bid` beyond `MAX_BIDDERS` | ER | `TooManyBidders` (6011) | |
| A18 | `place_bid` with a side the room forbids | ER | `InvalidBidSide` (6016) — SEAL/READ on Whisper, YES/NO on Guilt | |
| A19 | `place_bid` with an underfunded purse | ER | `InsufficientFunds` (6017) | |
| A20 | `init_bid_permission` | ER | `is_private = true`, members exactly `[bidder]` — **author not included** | |
| A21 | `open_session` | ER | Ephemeral session scope; market, ceiling and expiry recorded | |
| A22 | `place_bid_with_session` in scope | ER | Bid lands, signed by the session key, no wallet signature | |
| A23 | same session key on a different market | ER | `InvalidSession` (6023) | |
| A24 | session spend over the ceiling | ER | `SessionLimitExceeded` (6024) | |
| A25 | `revoke_session` then bid | ER | `InvalidSession` | |
| A26 | `expire_market` before the timer | ER | `MarketStillOpen` (6005) | |
| A27 | `expire_market` permissionless | ER | Any signer can crank it; status → Expired | |
| A28 | `expire_market` with both pots empty | ER | Short-circuits to `PublicLeak` + Resolved, **no VRF needed** | |
| A29 | `request_resolution_vrf` | ER | Status → VrfPending; request accepted by the ephemeral queue | |
| A30 | `request_resolution_vrf` on Whisper IPO | ER | `WrongRoom` (6003) — otherwise the market would lock forever | |
| A31 | `callback_resolve` delivered by the oracle | ER | Status → Resolved; `randomness` non-zero; outcome matches the room's rule table | |
| A32 | **forged** `callback_resolve` | ER | Rejected — the identity signer is a PDA only the VRF program can sign for; market stays Pending | |
| A33 | `retry_vrf` before the grace period | ER | `MarketStillOpen` | |
| A34 | `retry_vrf` after grace | ER | VrfPending → Expired, re-requestable; never decides an outcome | |
| A35 | `resolve_rumor` by the author | ER | Outcome `Forgiven` (1) or `Slashed` (2); status Resolved | |
| A36 | `resolve_rumor` by anyone else | ER | `NotAuthor` (6022) | |
| A37 | `resolve_rumor` with an invalid result | ER | `InvalidRumorResult` (6029) | |
| A38 | `settle_bid` — BURIED | ER | Seal stake → author; READ bidder refunded **in full** | |
| A39 | `settle_bid` — SOLE_READER | ER | The VRF-chosen READ bidder forfeits; every other READ bidder refunded in full | |
| A40 | `settle_bid` — Whisper IPO | ER | Winner gets `stake + stake × losing_pot / winning_pot`; loser gets 0; **author gets nothing** | |
| A41 | `settle_bid` twice | ER | `BidAlreadySettled` (6015) | |
| A42 | `close_bid` | ER | Bid permission closed, ephemeral account closed, rent back to the market, `closed_bid_count` +1 | |
| A43 | `close_book` before every bid closed | ER | `UnsettledBids` (6010) | |
| A44 | `close_book` escrow invariant | ER | `escrow_lamports == author_payout`, else `EscrowNotEmpty` (6033) | |
| A45 | `grant_reader` | PER | Secret members become exactly `[author, sole_reader]`; still `is_private` | |
| A46 | `grant_reader` on a non-reader outcome | PER | `RevealNotAuthorised` (6027) | |
| A47 | `finalize_market` before settled | ER | `NotSettled` (6009); market stays delegated | |
| A48 | `finalize_market` — BURIED | ER→L1 | `revealed_len = 0`; market committed and undelegated | |
| A49 | `finalize_market` — PUBLIC_LEAK | ER→L1 | Full body copied into `revealed`; commits without `ExternalAccountDataModified` | |
| A50 | `finalize_market` — RANDOM_REVEAL | ER→L1 | **Only** the author's redacted sentence — never the body | |
| A51 | `write_tombstone` | L1 | Tombstone PDA with hash, outcome, pots, sole reader, randomness; text only when authorised | |
| A52 | `write_tombstone` twice | L1 | `AlreadyTombstoned` (6028) | |
| A53 | `claim_author` | L1 | `author_payout` lamports reach the author; field zeroed | |
| A54 | `withdraw_purse` with funds locked | L1 | `PurseLocked` (6018) | |
| A55 | `undelegate_purse` → `withdraw_purse` | ER→L1 | Real SOL returns to the wallet; totals reconcile | |
| A56 | The secret is **never** undelegated | PER | After a buried market settles, the secret is still on the rollup, still private | |

## B. Privacy — the claim the project rests on

Only rows marked **devnet** can prove refusal; the local QFS answers reads a TEE
would refuse, so locally they are marked N/A rather than PASS.

| # | Item | Correct means | Status |
|---|---|---|---|
| B1 | Body never in an L1 transaction | The shell is allocated all-zero and the body is only ever written on the rollup | |
| B2 | Base-layer read after sealing | L1 still shows an all-zero body | |
| B3 | Author reads via their own TEE token | Exact body returned | |
| B4 | **devnet** unauthenticated rollup read | Account **refused** (null) | |
| B5 | **devnet** stranger holding a *valid* TEE token | **Refused** — not on the member list | |
| B6 | **devnet** stranger reads the *market* | **Allowed** — the game is public, the secret is not | |
| B7 | Commitment verifiability | `sha256(revealed‖salt)` equals the published hash after a leak | |
| B8 | Bid privacy | Author cannot enumerate individual bids; only aggregates are public | |

## C. Web app — every page, every flow

Executed in a real browser against the running app. **Every item additionally
requires a clean console and no failed network requests.**

| # | Surface / flow | Correct means | Status |
|---|---|---|---|
| C1 | Village feed | Live markets render from chain with room, hash, countdown, pots, status | |
| C2 | Feed filters | All / Open / Decided / per-room narrow the set correctly | |
| C3 | Feed empty state | With no markets, an intentional empty state — not a blank page or spinner | |
| C4 | Countdown at zero | Flips to "timer dead" without going negative | |
| C5 | Burner wallet | Auto-created, persisted across reload, airdrop funds it on localnet | |
| C6 | Confess — valid | Walks all 7 steps and lands on a live market whose hash matches locally computed sha256 | |
| C7 | Confess — empty body | Blocked client-side with a real message; no transaction sent | |
| C8 | Confess — body over 180 bytes | Blocked with the limit stated | |
| C9 | Confess — mid-flow failure | Failing step is reported with the actual error; no silent success | |
| C10 | Market detail | Hash, timer, pots, room rule box, addresses all correct | |
| C11 | Fund the purse | Real deposit + delegation; balance reflects it | |
| C12 | Bid SEAL | Real ER transaction; seal pot increases by exactly the amount | |
| C13 | Bid READ | Same for the read pot | |
| C14 | Bid with no purse | Blocked with a message pointing at the purse, not a raw error | |
| C15 | Bid on an expired market | Blocked before sending | |
| C16 | Resolve / crank | Expire → VRF → settle → close → finalize → tombstone, driven from the UI | |
| C17 | Result screen | States the actual verdict; a sole reader sees the plaintext, nobody else does | |
| C18 | Graveyard | Tombstones from L1; leaked text shown **only** for reveal outcomes | |
| C19 | Graveyard — buried entry | Hash only, with copy that says the body never left the rollup | |
| C20 | Rooms page | 3 live, 22 disabled with names, rules and `Room::` variant | |
| C21 | Fiction-mode banner | Present on every page | |
| C22 | Navigation | Every nav item routes; no dead links | |
| C23 | Mobile viewport | Readable and usable at 390px; no horizontal scroll | |
| C24 | Explorer links | Resolve to the right account on the right cluster | |

## D. Scripts and infrastructure

| # | Item | Correct means | Status |
|---|---|---|---|
| D1 | `anchor build` | Clean build, IDL regenerated | |
| D2 | `scripts/setup.sh` | Installs skill, examples, binaries, deps from scratch | |
| D3 | `scripts/local-stack.sh` | Base + ER + QFS + 2 VRF oracles all healthy | |
| D4 | `scripts/stop-stack.sh` | Stops everything and waits for ports to free | |
| D5 | `scripts/rebuild.sh` | Rebuild + restart so the ER runs the new binary | |
| D6 | `scripts/smoke.ts` | Full loop end to end, exits 0 | |
| D7 | `scripts/seed.ts` | 5 markets in the described states; green twice in a row | |
| D8 | `scripts/demo.ts` | Narrates every beat of DEMO.md against a live cluster, exits 0 | |
| D9 | `scripts/prove-privacy.ts` — local | All non-refusal checks pass; refusals marked N/A | |
| D10 | `scripts/prove-privacy.ts` — **devnet** | Every check PASS including both refusals | |
| D11 | `scripts/deploy-devnet.sh` | Deploys and writes `.env.devnet` | |
| D12 | Devnet deployment | Program executable at its address on devnet | |
| D13 | `npm test` | Whole suite green | |
| D14 | `cd app && npm run build` | Clean production build | |

## E. Hygiene

| # | Item | Correct means | Status |
|---|---|---|---|
| E1 | No mocks or stubs | Zero mock/stub/fake/dummy/placeholder standing in for real logic | |
| E2 | No stray TODO/FIXME | None left in shipped paths | |
| E3 | No secrets committed | `keys/`, `.env.devnet`, seed manifests all git-ignored | |
| E4 | Docs match the code | Every instruction named in the docs exists in the IDL | |
| E5 | No plaintext in localStorage | Beyond the author's own session | |

---

## Known deviations, declared up front

- **B4/B5/B6 and D10 require the devnet TEE.** The local query-filtering service is
  not a TEE and answers reads it would refuse. These are proven separately on devnet
  and marked N/A locally — never PASS on local evidence.
- **Devnet funding.** The deployer holds ~0.19 SOL after the deploy consumed ~4.8 SOL
  of program rent-exemption. Enough for the privacy path; not enough to seed a village
  or run bidding on devnet. Rows A1–A56 therefore run on the local cluster, which is
  real MagicBlock software with real signed transactions.
