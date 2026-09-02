# SINBAZAAR — 100 ideas, ranked

Scored `impact × feasibility × fit`. Impact is "would a Blitz judge notice and care",
feasibility is "buildable for real today, no mocks", fit is "does it sharpen the pitch
or clutter it". The pitch is one sentence and everything is measured against it:

> Confession stays in a Private Ephemeral Rollup. The market runs in real time on an
> Ephemeral Rollup. MagicBlock VRF picks the reader. Solana only receives a tombstone.

Judging is creativity, technical depth, and **how clearly the demo proves MagicBlock
primitives**. That last clause is why the top of this list is dominated by things that
make the rollup *visible* rather than by new rooms.

Nothing already built at the time of writing is listed. Status is honest:
**✅ built** means built and seen working in a browser or a test; **⏭️** means not
built, with the reason. Most of this list is ⏭️ — the run's time went to replacing
the visual world, which was the more urgent problem.

---

## What actually shipped from this list

Eight items, all verified working:

| # | Idea | Evidence |
|---|---|---|
| 8 | Final-minute urgency on the countdown | Seal-red ticking clock, card rule thickens to 5px, verified in the browser |
| 11 | "Where does this live right now" layer badge | Fixed to derive from base-layer ownership; settled markets now read SOLANA |
| 13 | Commitment verifier in the graveyard | Recomputes `sha256(sentence ‖ salt)` in the reader's browser |
| 19 | Empty states with real copy and a next action | Graveyard verified with 0 tombstones |
| 20 | Error taxonomy — program errors as human sentences | Lifted out of program logs; "purse has insufficient available lamports." |
| 35 | `prefers-reduced-motion` respected | Disables even the countdown tick |
| 36 | Focus-visible rings, full keyboard operability | 3px custody-blue ring, suppressed for pointer |
| 39 | Byte-accurate confession counter | Pre-existing, verified against the 180-byte program limit |

Plus one that was not on the list, because it came out of the world replacement and
is the strongest single thing built today:

**The redaction bar and classification bands.** A buried tombstone now draws the
withheld shape of the confession under a black `WITHHELD` band, beside a leaked one
under a red `RELEASED` band. Three tombstones side by side explain the whole product
with no caption. This is the demo's best frame and it is a functional consequence of
`Outcome::reveals_text()`, not decoration.

---

## Tier S — the demo lives or dies on these

| # | Idea | Why it wins | Status |
|---|---|---|---|
| 1 | **Live rollup subscriptions instead of polling** — `onAccountChange` on the ER so pots, bids and timers update the instant a transaction lands | The single best proof that this is a rollup and not a website. A judge watches a number change with no refresh. | ⏭️ not built |
| 2 | **Latency meter** — measure real confirmation time for every transaction and show it, base vs rollup, side by side | Turns "10–50ms" from a claim into a number on screen that they watched happen. Devastating next to an L1-only project. | ⏭️ not built |
| 3 | **The privacy challenge, in the app** — a page where anyone generates a key, gets a *real* TEE token, tries to read a live secret, and is refused, with the raw JSON-RPC response shown | The claim the whole project rests on, made falsifiable by the judge in ten seconds. | ⏭️ not built |
| 4 | **Session keys wired into the UI** — one wallet approval, then every bid signs with a scoped ER key, no popup | The program already supports it and the app never used it. Closes the gap between what we built and what we show. | ⏭️ not built |
| 5 | **Magic Actions for the tombstone** — schedule the L1 write from inside the ER commit rather than as a separate client transaction | A named MagicBlock primitive the project claimed in spirit but never used. | ⏭️ not built |
| 6 | **Rollup activity strip** — a live ticker of ER transactions as they land, with signatures | Makes the rollup feel alive and busy during the 60-second video. | ⏭️ not built |
| 7 | **Bid confirmation motion** — the pot bar animates from old value to new the moment the subscription fires | The visual payoff of #1. Motion tied to real chain state, not a fake spinner. | ⏭️ not built |
| 8 | **Final-30-seconds urgency** — the countdown changes character, the market card lifts, the light gets warmer | The last thirty seconds is the interesting part of this game; the UI should know that. | ✅ built |

## Tier A — strong, and directly on-pitch

| # | Idea | Why | Status |
|---|---|---|---|
| 9 | Keeper/crank daemon that expires, resolves and settles any market whose timer is up | Markets resolve themselves during the demo, unattended. | ⏭️ not built |
| 10 | Explorer deep-links for *rollup* transactions, not just base | Lets a judge inspect the ER directly. | ⏭️ not built |
| 11 | "Where does this live right now" badge with the delegation record | Makes delegation legible instead of implied. | ✅ built |
| 12 | Per-transaction receipt drawer — signature, layer, slot, CU, latency | Technical depth on demand without cluttering the page. | ⏭️ not built |
| 13 | Commitment verifier for *any* text, not just tombstones — paste a sentence, check it against a hash | Invites disproof. | ✅ built |
| 14 | Mirror Confession as a fourth live room | The one enumerated room whose rule is genuinely novel. | ⏭️ time |
| 15 | eSPL escrow so pots are denominated in a token | Real, but swaps a working money path for a riskier one mid-demo. | ⏭️ risk/fit |
| 16 | Read-receipt: the secret records *when* the sole reader first opened it | Adds drama, cheap to build. | ⏭️ not built |
| 17 | Author's own view of their live market with the body shown to them alone | Proves the positive side of the permission. | ⏭️ not built |
| 18 | Onboarding rail — first-run guidance on the village | Judges arrive cold. | ⏭️ not built |
| 19 | Empty states everywhere with real copy and a next action | Finished-looking vs actually finished. | ✅ built |
| 20 | Error taxonomy — map every program error code to a human sentence | Already partly done via logs; make it exhaustive. | ✅ built |

## Tier B — good, built if time allowed

| # | Idea | Status |
|---|---|---|
| 21 | Optimistic UI for bids, reconciled against the subscription | ⏭️ redundant once #1 lands |
| 22 | Keyboard shortcuts (`c` confess, `g` graveyard, `/` search) | ⏭️ not built |
| 23 | Market search and sort by pot / timer / room | ⏭️ not built |
| 24 | Shareable market OG images | ⏭️ time |
| 25 | Sound design on resolution | ⏭️ hurts a live demo |
| 26 | A "how it works" diagram page | ⏭️ README covers it |
| 27 | Villager profile — markets authored, bids placed, secrets held | ⏭️ leaks bid participation |
| 28 | Multi-market crank in one transaction | ⏭️ time |
| 29 | Reveal animation — the confession types itself onto the tombstone | ⏭️ not built |
| 30 | Hash scramble that settles into the real digest on load | ⏭️ not built |
| 31 | Live "N villagers watching" presence via ER ephemeral accounts | ⏭️ time |
| 32 | Rollup health indicator (validator identity, slot, region) | ⏭️ not built |
| 33 | Devnet/localnet switcher in the header | ⏭️ not built |
| 34 | Copy-to-clipboard on every address | ⏭️ not built |
| 35 | `prefers-reduced-motion` respected throughout | ✅ built |
| 36 | Focus-visible rings and full keyboard operability | ✅ built |
| 37 | Skip-to-content link | ⏭️ not built |
| 38 | Toast system for background transactions | ⏭️ receipts cover it |
| 39 | Confession character counter with byte-accurate UTF-8 | ✅ built |
| 40 | Redaction helper — pick a sentence from the body as the redaction | ⏭️ not built |

## Tier C — the long tail (41–100)

Functional: 41 inheritance-of-sin room · 42 apology bonds · 43 scapegoat auction ·
44 last-message-wins · 45 curse pool · 46 confession bonding curve · 47 absolution AMM ·
48 anonymous patron · 49 redaction roulette · 50 dead man's tweet · 51 jury of seven ·
52 stain/clean-badge reputation · 53 confessor's booth · 54 sin futures ·
55 reputation hostage · 56 village will · 57 sin oracle · 58 clone confession ·
59 coward's insurance auto-bid · 60 public penance · 61 forgetting annex ·
62 market templates · 63 scheduled market opening · 64 recurring markets ·
65 multi-secret markets · 66 secret bundles · 67 partial reveals by paragraph ·
68 escrow top-ups mid-market · 69 bid cancellation window · 70 anti-snipe timer extension.

MagicBlock depth: 71 delegate to a chosen region and show the latency difference ·
72 cross-region market migration · 73 commit-frequency tuning per market ·
74 fee-vault sponsorship so bidding is gasless · 75 lamports top-up via
`lamportsDelegatedTransferIx` · 76 ephemeral-account chat per market ·
77 pricing-oracle-denominated ransom curve · 78 VRF-weighted selection by stake ·
79 multiple VRF rounds for multi-winner reveals · 80 TEE attestation display.

Design/motion: 81 candle flicker on the light source · 82 ink-bleed on reveal ·
83 wax-seal press on confess · 84 page-turn between rooms · 85 tombstone engraving
animation · 86 pot-bar liquid physics · 87 cursor-follow light · 88 grain overlay ·
89 loading states written as sentences, not spinners · 90 responsive type scale.

Production: 91 retry with backoff on RPC failures · 92 offline detection banner ·
93 stale-data indicator when the subscription drops · 94 transaction queue that
survives reload · 95 idempotent flows safe to re-run · 96 structured client logging ·
97 rate-limit handling · 98 error boundary per route · 99 health-check page ·
100 a `--dry-run` mode for every script.

Of the long tail, **none** were built. They are listed because they are real ideas,
not because they shipped.

---

## The honest ranking principle

A hundred features would hurt this demo. The pitch is one sentence and sixty seconds.
Everything in Tier S makes a MagicBlock primitive *visible*; everything skipped either
duplicates something visible already, or trades a working path for a riskier one on
the day of the demo.
