# SINBAZAAR — a second hundred, ranked

`docs/IDEAS.md` holds the first hundred. **Nothing from that list is repeated here**,
and nothing already built is proposed. Since that list was written, its Tier S has
largely shipped: live subscriptions, the latency meter, the challenge page, Magic
Actions, the activity strip, the keeper, the receipt drawer and the read receipt are
all built and verified.

Scored the same way: `impact × feasibility × fit`, against the same one sentence.

> Confession stays in a Private Ephemeral Rollup. The market runs in real time on an
> Ephemeral Rollup. MagicBlock VRF picks the reader. Solana only receives a tombstone.

Two constraints shape the ranking and are stated up front rather than discovered
halfway down:

- **Devnet is unfundable right now.** The deployer holds 0.1334 SOL and every faucet
  refuses. So anything whose only proof is a devnet redeploy is ranked as blocked,
  not as available. Program changes are still real: they build, deploy and are tested
  against the live local stack.
- **The demo is sixty seconds.** A hundred features would hurt it. Rank accordingly.

**A correction, kept visible rather than edited away.** This list first opened with
session keys at #1, on the claim that `lib/session.ts` existed and no page imported
it. That was wrong, and it was wrong because of a bad grep: I searched for
`createSession|useSession|sessionPda` in the app directory, and the real names are
`openSession`, `bidWithSession`, `revokeSession`, `loadSession` and `forgetSession`.
The market page imports all five, opens a scoped session on one approval, signs bids
with it and never shows a popup, and refuses to silently fall back to the wallet when
a session is revoked.

So old list #4 is **built**, the ranking below starts where it should, and the near
miss is left on the page because "I checked before building" is the only reason it
did not become an afternoon spent reimplementing a working feature.

---

## Tier S — build these first

| # | Idea | Why it wins |
|---|---|---|
| 1 | **The layer race** — one button fires an identical transaction at base and rollup at the same instant, two stopwatches run live, both stop on their own confirmation | The latency row states two numbers. This makes a judge *watch* the gap open in real time. Same transaction, same moment, one finishes while the other is still going |
| 2 | **Delegation lifecycle strip** — for one market: created on L1, delegated, N writes on the rollup, committed, undelegated, each step a real signature and slot | Delegation is the primitive everything else rests on and it is currently invisible. This turns it into a thing with a shape |
| 3 | **Commit compression counter** — "N rollup writes → 1 Solana commit", counted from real transactions for the market on screen | The economic argument for a rollup, as a number derived from this demo rather than a claim from a docs page |
| 4 | **Live permission inspector** — for any account, render the ephemeral permission's member list and decode its flags, updating as membership changes | The privacy claim is enforced by this list. Showing it live turns "trust us" into "look" |
| 5 | **VRF grace countdown in the UI** — when a market sits in `VrfPending`, show the real grace window and the retry that becomes available at zero | The program has `retry_vrf` and a 120s grace, tested in `vrf-stall.ts`, and the UI never mentions it. A stalled oracle currently looks like a hung app |
| 6 | **Headstone texture from the commitment hash** — each tombstone's grain, cracks and lettering derived deterministically from its own 32 bytes | Every tombstone becomes visually unique and the uniqueness *is* the data. Pure design, zero protocol risk, and it is the image a judge remembers |
| 7 | **Aurora responds to the chain** — a bid landing pushes real energy through the light blades, driven by the existing subscription | The signature visual becomes an instrument reading the rollup instead of decoration that happens to be nearby |

## Tier A — strong, on-pitch

| # | Idea | Why |
|---|---|---|
| 9 | Pot odometer — digits roll from old value to new when the subscription fires | The visual payoff of live subscriptions, on the number that matters |
| 10 | Shared-element transition from market card into the market page | Framer `layoutId` on a card that already exists; makes navigation feel like one continuous surface |
| 11 | "What Solana sees" split pane while confessing — your sentence on the left, the hash updating live on the right, and nothing else | Teaches the entire privacy model in the five seconds someone is already typing |
| 12 | Per-route error boundaries with real recovery, not just the root one | A thrown error on `/graveyard` currently takes the whole app to a generic page |
| 13 | Wrong-network and locked-wallet states | The two most common ways a judge's first click fails |
| 14 | Insufficient-funds precheck before a signature is requested | Asking someone to sign a transaction you already know will fail is a small betrayal |
| 15 | Clock-skew detector — compare the client clock to chain time and say so when they disagree | Every countdown in this app is client-side. A skewed laptop silently shows the wrong timer |
| 16 | Anonymised bid depth — counts and totals per side, never identities | Shows the book has shape without leaking who bid, which is the whole constraint |
| 17 | Author's private view of their own live market, body visible to them alone | Proves the positive half of the permission: it admits as precisely as it refuses |
| 18 | Undelegation refusal demo — try to write on the rollup after undelegation, show the exact rejection | The boundary made visible from the failing side |
| 19 | Rollup slot-rate readout — measured slots per second, both layers | One more number a judge can watch move |
| 20 | Byte-exact truncation that never splits a UTF-8 character | The counter is byte-accurate; the truncation must be too |

## Tier B — good, if time allows

| # | Idea |
|---|---|
| 21 | Market search and filter by room, pot size and time remaining |
| 22 | Keyboard shortcuts with a discoverable `?` overlay |
| 23 | Skip-to-content link |
| 24 | Copy-to-clipboard on every address, not just the market page |
| 25 | Reduced-data mode that stops all polling on request |
| 26 | A market that resolves while you are mid-bid, handled gracefully |
| 27 | Duplicate-transaction guard on rapid double-clicks |
| 28 | Burner-wallet reset and export flow |
| 29 | Browser-storage quota and private-mode handling |
| 30 | Hydration-safe rendering for every time-based value |
| 31 | Deterministic room colour derived from the room enum |
| 32 | The redaction bar you can try to scrub, and cannot |
| 33 | Confession typed onto the headstone at reveal, at reading speed |
| 34 | Hash scramble settling into the real digest on load |
| 35 | Loading states written as sentences about the chain, not spinners |
| 36 | Focus trap and escape handling in every overlay |
| 37 | `aria-live` on every value that changes without interaction |
| 38 | High-contrast mode honoured |
| 39 | Print stylesheet for a tombstone |
| 40 | An OG image per market rendered from real state |

## Tier C — the long tail (41–100)

**Protocol depth (program changes, all buildable and testable locally):**
41 author's panic burn before expiry at a penalty · 42 second-price seal auction ·
43 dutch-auction read price that falls with the clock · 44 proof-of-authorship
challenge without revealing the body · 45 tombstone lineage, a confession about a
confession · 46 village treasury with a visible protocol cut · 47 transferable read
right before opening · 48 deadman switch that leaks after N days of author silence ·
49 minimum-bid floor per room · 50 bid withdrawal inside a grace window ·
51 anti-snipe extension when a bid lands in the last seconds · 52 co-signed
confessions with two authors · 53 partial reveal by sentence index · 54 a room where
the author bids against the village · 55 escrow top-up mid-market · 56 refund-all
abort when no bid is funded · 57 per-room configurable VRF weighting ·
58 confession expiry with no market at all · 59 sealed counter-offers ·
60 a room whose outcome depends on two VRF draws.

**MagicBlock depth:** 61 measured latency per region, chosen at delegation ·
62 commit-frequency tuning exposed per market · 63 gasless bidding via fee-vault
sponsorship · 64 ephemeral-account presence showing live watchers · 65 rollup
transaction replay scrubber over one market's history · 66 the delegation record
decoded on screen, owner and validator and delegated-at · 67 base-vs-rollup cost
comparison in lamports from real fees · 68 an ER-only account that never touches L1,
to make the distinction concrete · 69 multi-market crank in one transaction ·
70 validator passport: identity, version, genesis, both layers.

**Design and motion:** 71 candle flicker driven by real slot jitter · 72 ink bleed on
reveal · 73 wax seal pressing shut on confess · 74 the countdown as a burning fuse ·
75 market card breathing at the rollup's slot rate · 76 cursor-follow warmth on the
aurora · 77 tombstones settling into the graveyard grid on arrival · 78 the pot bar
as liquid with real inertia · 79 a scroll-driven descent from village to graveyard ·
80 first-visit cold-open that states the premise in one line and gets out of the way.

**Production:** 81 a debug panel behind a key chord showing every subscription's
state · 82 client-side structured logs with a copy-as-JSON button · 83 a synthetic
end-to-end check runnable from the browser · 84 script `--dry-run` everywhere ·
85 keeper lock file so two keepers cannot fight · 86 explicit rent-exemption warnings ·
87 RPC failover to a second endpoint · 88 request coalescing across hooks ·
89 a version banner tying the UI to a program hash · 90 a first-run self-test that
checks every endpoint before the judge clicks anything · 91 graceful degradation when
websockets are blocked · 92 a machine-readable `/health` route · 93 seeded demo reset
in one command · 94 screenshot-stable mode that freezes all motion and clocks ·
95 an accessibility audit route rendering every component state · 96 bundle-size
budget enforced at build · 97 source-mapped errors in production · 98 a route that
renders the full error taxonomy from the IDL · 99 dependency and toolchain versions
printed by one command · 100 a teardown script that leaves no orphan processes.

---

## The ranking principle, restated

The first list's principle held and is worth keeping: **everything at the top makes a
MagicBlock primitive visible.** The difference this time is that the obvious ones are
already built, so Tier S here is about the primitives that are real in the code and
still invisible in the interface — sessions, delegation, permissions, and the grace
period around a stalled oracle.

Design items rank high only when the visual *is* the data: a headstone whose texture
comes from its own commitment hash, an aurora driven by real bids. Decoration that
merely sits nearby ranks low no matter how good it looks.
