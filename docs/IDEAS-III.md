# SINBAZAAR — a third hundred, ranked

`docs/IDEAS.md` and `docs/IDEAS-II.md` hold the first two hundred. **Nothing from
either is repeated here**, and nothing already built is proposed. Since IDEAS-II
was written its entire Tier S has shipped: the layer race, the delegation
lifecycle strip, the commit-compression claim, the permission inspector, the VRF
grace countdown, the hash-cut headstones and the chain-driven aurora, plus the
pot odometer and the what-Solana-sees pane.

Scored `impact × feasibility × fit` against the same sentence.

> Confession stays in a Private Ephemeral Rollup. The market runs in real time on
> an Ephemeral Rollup. MagicBlock VRF picks the reader. Solana only receives a
> tombstone.

## Where the remaining headroom actually is

Two hundred ideas in, **the interface is no longer the gap**. Every MagicBlock
primitive this project uses is now visible on some surface, and the last browser
pass closed eleven real defects across 138 items. What is still missing is the
thing that would make a sceptical judge stop arguing.

Today a judge is invited to believe the screen. Every proof in this project runs
*inside* the app: the challenge probes, the commitment verifier, the layer race,
the lifecycle strip. All of them are our code reporting on our code. The whole
top of this list is about handing over the means to check the claims **without
us** — from public data, offline, with our code as the thing under test rather
than the thing doing the testing.

Devnet remains unfundable (the deployer holds 0.1334 SOL and every faucet
refuses), so anything whose only proof is a devnet redeploy is ranked blocked,
not available.

---

## Built and verified

| # | What was built | Evidence |
|---|---|---|
| 1 | **Offline verifier** — `npm run verify:market <address>` or `--all` | **453 assertions, all passing, across 65 markets**, from public base-layer data alone: no rollup, no TEE, no key. It found a real defect on its first run (below) |

**It earned its place immediately.** The first run reported 2 failures on one
market: an outcome of `pending` where the room's rule said `publicLeak`, and a
market not marked tombstoned. Both were true. The account was an **allocated but
uncarved headstone** — `open_tombstone` creates one in advance so a Magic Action
has somewhere to land, and until it is carved `buried_at` is 0.

That exposed a product defect the whole browser pass had missed: **the graveyard
was counting and rendering that empty allocation as a verdict**, badge and all.
It now filters on `buried_at`, the field the program itself uses to mean
genuinely buried. Verified: 64 shown against 64 carved on chain, and no `pending`
badge anywhere.

The verifier was wrong too, and is fixed the same way: asserting a rule against
an uncarved headstone was it inventing a claim the chain never made.

---

## Tier S — hand the judge the means to disprove us

| # | Idea | Why it wins |
|---|---|---|
| 1 ✅ | **Offline verifier** — `npm run verify:market <address>` reconstructs a market's whole claim from **public data alone**: checks the commitment against the published body and salt, checks the outcome against the published randomness, checks the money conserves, and prints PASS or FAIL per assertion | Every proof here currently runs inside the app. This one runs outside it, reads only what anyone can read, and is able to fail. That asymmetry is the difference between a demo and evidence |
| 2 | **VRF determinism proof** — re-derive the outcome from the randomness the program published, and show the room's rule mapping it, step by step | The VRF is the one part a judge cannot watch happen. Showing the outcome is a pure function of published randomness turns "trust the oracle" into arithmetic anyone can repeat |
| 3 | **Program-hash attestation** — print the sha256 of the deployed programdata beside the sha256 of the built artifact | The code shown is the code running, or it is not, and the page says which. Forecloses the obvious "how do I know this is what is deployed" |
| 4 | **Money conservation ledger** — for a settled market, every lamport in and every lamport out, summed, from real account data | "The money is correct" sits in this project's own definition of done and has never had a surface. This makes it a number that must balance |
| 5 | **Base-vs-rollup field diff** — the same market read from both layers, field by field, disagreements highlighted | Non-equivocation shown rather than asserted, and the clearest possible picture of what a commit actually does |
| 6 | **Digest fingerprint** — the commitment rendered as a deterministic identicon beside its hex, everywhere a hash appears | 64 hex characters are unreadable; a shape is recognisable across pages. The same confession becomes identifiable without ever being revealed |
| 7 | **What it would take to cheat** — each attack (read another's confession, bid after zero, settle twice, publish a body the verdict did not authorise) with the mechanism that blocks it and a live probe | Inviting disproof on the record is the strongest position a privacy claim can take |
| 8 | **Delegation record decoded** — the delegation program's own account for this market: owner, authority, validator, delegation slot | The lifecycle strip shows delegation as history; this shows the record the runtime actually enforces it from |

## Tier A — depth a judge would notice

| # | Idea | Why |
|---|---|---|
| 9 | Implied probability from the two pots, live | The book has a price and nothing displays it |
| 10 | Minimum flip: the lamports that would change the verdict right now | Turns a static book into a decision |
| 11 | Outcome distribution per room, from real tombstones | The village has history and never shows it |
| 12 | Refund matrix: what each side receives under every outcome | The rule box says what happens; this says what you get |
| 13 | One key's positions across every market | A villager has no view of themselves |
| 14 | Author earnings ledger from real `author_payout` | The same, for the other side of the trade |
| 15 | Village volume and settlement totals from real accounts | The honest headline number the landing page lacks |
| 16 | Commit interval actually observed, in seconds | A measured MagicBlock property nobody quotes |
| 17 | Rollup-vs-base slot-time ratio, live | One more number only a rollup can produce |
| 18 | Which accounts of this market are delegated, and to whom | Delegation at account granularity |
| 19 | The magic context account, decoded | The primitive's own bookkeeping, made visible |
| 20 | Prove a non-delegated authority cannot write to the rollup | The boundary from the failing side |

## Tier B — polish with a reason

| # | Idea |
|---|---|
| 21 | The graveyard laid out as a field with depth, nearer stones larger |
| 22 | The confession visibly leaving the browser and landing in the rollup |
| 23 | The seal animation beating once per real confirmation: nine steps, nine beats |
| 24 | A tombstone's epitaph carving deeper on hover |
| 25 | Night falling across the page as a market nears zero |
| 26 | Pot bar with inertia driven by subscription events |
| 27 | An ember trail following the cursor across the aurora |
| 28 | Market cards tilting toward the pointer |
| 29 | The verdict arriving as a stamp pressed onto the page |
| 30 | The rollup's slot height as a quiet heartbeat in the chrome |
| 31 | A single `npm run verify:all` gate running every standing check |
| 32 | Structured JSON client logging behind a flag |
| 33 | A `/health` route reporting every endpoint |
| 34 | Request coalescing across hooks asking the same question |
| 35 | Per-endpoint retry budget, surfaced when spent |
| 36 | Commit stamp in the footer tied to the program hash |
| 37 | Graceful degradation when websockets are blocked outright |
| 38 | Screenshot-stable mode freezing all motion and clocks |
| 39 | An accessibility audit route rendering every component state |
| 40 | One-command seeded demo reset |

## Tier C — the long tail (41–100)

**Verification and proof:** 41 exportable per-market attestation JSON ·
42 batch commitment across a village's tombstones · 43 proof `expires_at` never
moved · 44 proof no bidder identity appears in any tombstone · 45 replay of a
market's rollup history from logs alone · 46 signature-count reconciliation
between layers · 47 a diff of the IDL against the deployed program · 48 a salt
reuse check across markets · 49 proof the reveal buffer is zero for every
non-revealing outcome · 50 an independent read using only a public RPC.

**Protocol depth:** 51 author-set reserve price · 52 partial seal refunds ·
53 bid laddering across a curve · 54 a room where the author bids against the
village · 55 escrowed apology bonds · 56 confession bundles sharing one verdict ·
57 sealed counter-offers · 58 a second VRF draw for ties · 59 configurable grace
per room · 60 an explicit abort path when no bid is funded.

**MagicBlock depth:** 61 measured latency per region at delegation time ·
62 exposed commit-frequency tuning · 63 gasless bidding via fee-vault sponsorship
· 64 live watcher presence via ephemeral accounts · 65 an ER-only account that
never touches L1 · 66 undelegate and re-delegate round trip · 67 delegation cost
accounting in lamports · 68 transaction ordering compared across layers ·
69 multi-market crank in one transaction · 70 a validator passport across layers.

**Design and motion:** 71 candle flicker driven by real slot jitter · 72 ink
bleed on reveal · 73 a wax seal pressing shut · 74 the countdown as a burning
fuse · 75 cards breathing at the rollup's slot rate · 76 cursor-follow warmth ·
77 tombstones settling into the grid on arrival · 78 a scroll-driven descent from
village to graveyard · 79 a first-visit cold open · 80 the redaction bar
resisting a scrub.

**Production:** 81 a debug panel behind a key chord · 82 copy-as-JSON on every
error · 83 a browser-run synthetic end-to-end check · 84 `--dry-run` on every
script · 85 a keeper lock file · 86 rent-exemption warnings · 87 RPC failover ·
88 a bundle-size budget enforced at build · 89 source-mapped production errors ·
90 a route rendering the full error taxonomy from the IDL · 91 toolchain versions
from one command · 92 a teardown leaving no orphan processes · 93 offline
detection · 94 a stale-data indicator when a subscription drops · 95 a
transaction queue surviving reload · 96 idempotent re-runnable flows · 97
rate-limit handling · 98 per-route error boundaries · 99 a first-run self-test
before a judge clicks anything · 100 a machine-readable submission manifest.

---

## The ranking principle, third time

The first list said: make the primitives visible. The second said: make the
primitives that are real in code but invisible in the interface visible too.
Both are now largely done, which is why this list says something different.

**Stop asking to be believed and start being checkable.** Everything in Tier S is
a way for somebody who distrusts this project to test it without our help. That
is the only axis where a sixty-second demo can still gain, because the interface
has run out of things to prove and the claims have not.
