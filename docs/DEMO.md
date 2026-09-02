# SINBAZAAR — 60-second demo script

One take, three wallets, two browser windows. Everything below is a real transaction against a running
stack; nothing is mocked. Read [What is live vs. what is pre-staged](#what-is-live-vs-what-is-pre-staged)
before you shoot — it matters that we do not overclaim.

---

## Before you hit record

**Stack**

```bash
npm run build
bash scripts/local-stack.sh --detach     # base :8899, ER :7799, QFS :6699, 2x vrf-oracle
. ./scripts/local-env.sh
npm run seed                             # village + the seeded fiction markets
```

For the privacy shot to be worth anything, point the TEE endpoint at the **real** devnet TEE. Locally
the query-filtering service on `:6699` runs the same code path but does not enforce the boundary:

```bash
export TEE_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app
```

**Wallets**

| Wallet | Role | Pre-staged before recording |
|---|---|---|
| **A** — the author | Creates the market, types the confession | Funded on L1 |
| **B** — the sealer | Bids SEAL | Purse deposited **and delegated** (`deposit_purse` + `delegate_purse`) |
| **C** — the reader | Bids READ, wins | Purse deposited **and delegated** |

Purses must already be on the ER. `deposit_purse` and `delegate_purse` are base-layer transactions and
there is no time for them inside sixty seconds — that is the point of the purse, not a cheat.

**Be precise about what removes the popup.** The app signs with a burner keypair held in the browser
(`app/src/lib/burner.ts`), which is why bidding is one click. That is *not* the program's session-key
path: `open_session` + `place_bid_with_session` are real, scoped to one market with a spend ceiling and
a TTL, and exercised by the test suite — but the UI does not call them. Say "no wallet popup," not
"session key," when you are pointing at the browser.

**Seeded markets that must already exist**

- One `GuiltMarket` with **zero bids** and a timer expiring around **0:50** — the public-leak beat.
- One `WhisperIpo` rumor, open, with YES and NO money on both sides — the 0:58 beat.
- At least one already-completed market in the graveyard, so the graveyard is not empty on first frame.

**Window layout** — this is the whole visual argument, so lock it before the take:

```
+---------------------------------+----------------------------------+
|  LEFT  (2/3)                    |  RIGHT (1/3)                     |
|  Wallet A / B / C — the bazaar  |  INCOGNITO, no wallet connected   |
|  Market card, timer, pots       |  Same market URL                  |
|                                 |  "PRIVATE — not on your key"     |
+---------------------------------+----------------------------------+
|  FICTION MODE banner pinned across the top of both                  |
+---------------------------------------------------------------------+
```

Set the market's `duration_secs` to **25** so the timer runs out at 0:32. Have a cranker loop running so
`expire_market`, `settle_bid`, `close_bid`, `close_book`, `finalize_market` and `write_tombstone` fire
the moment they become legal — every one of them is permissionless, which is why nobody has to click
them on camera.

**Rehearse it in the terminal first.** `npm run demo` runs `scripts/demo.ts`, which walks these same
beats headlessly against a live cluster and prints what each one actually did on-chain. It also makes a
good second pane in the edit: the browser shows the village, the terminal shows the transactions.

One difference to expect: `demo.ts` bids **both** sides on the 0:40 market, so `seal_pot > 0` and it
resolves `BURIED` — "silence was bought, Solana got the hash and nothing else." That is the rule the
shooting note below is about, demonstrated rather than worked around. To rehearse the `SOLE_READER`
payoff you need a READ-only market.

---

## Shot list

| Time | Shot | On screen | Narration (say exactly this) |
|---|---|---|---|
| **0:00** | Wide, left window | Wallet A clicks **Connect**. Address appears. FICTION MODE banner visible. | "This is SINBAZAAR. The thing being traded is a secret." |
| **0:05** | Push in on the input | Wallet A types `I reused my teammate's pitch deck.` and hits **Seal**. | "I write one line. It never touches Solana." |
| **0:10** | Split — both windows | Left: market card resolves to a hash, timer counting from 25, SEAL 0 / READ 0. Right: incognito shows the same hash, same timer, body **PRIVATE**. | "The village gets a hash and a timer. The private rollup keeps the sentence. Second window, no key — nothing." |
| **0:18** | Left, wallet switcher | Wallet B bids **0.5 SOL SEAL**. One click, no popup. SEAL pot ticks up instantly. | "Wallet two pays to bury it. Rollup speed, no wallet popup, no base-layer transaction." |
| **0:24** | Left, wallet switcher | Wallet C bids **0.5 SOL READ**. READ pot ticks up. Neither card shows who bid what. | "Wallet three pays to read it. Every bid is a private account — nobody sees the other side." |
| **0:32** | Timer to zero, cut to the resolution strip | Timer hits 0. Status flips `Open → Expired → VrfPending`. VRF badge spins. | "Timer's out. The market asks MagicBlock VRF who gets to read." |
| **0:40** | Split — the payoff | Left, as Wallet C: the confession renders in plaintext. Right, incognito, unchanged: **PRIVATE**. Graveyard card shows the hash and **SOLE_READER**. | "One key was added to the permission. Wallet three sees it. Nobody else ever will. The graveyard gets the hash." |
| **0:50** | Cut to a different card | The zero-bid seeded market expires. Status → **PUBLIC_LEAK**. The body appears, in full, carved into the tombstone. | "Here's a market nobody paid for. Nobody sealed it, nobody bought it — so the village takes it. That one is on Solana forever." |
| **0:58** | Cut to Whisper IPO | Rumor card resolves; YES and NO settle, winners' balances move. | "And the rumor market settles. Confessions in private. Markets in real time." |

---

## The beats in full

### 0:00 — Connect

**Action.** Left window, front. Wallet A clicks **Connect wallet** in the bazaar header; the address
badge fills in. The FICTION MODE banner is already pinned at the top of frame — do not let the first
frame exist without it.

**Narration.** *"This is SINBAZAAR. The thing being traded is a secret."*

---

### 0:05 — Type the confession

**Action.** Push in on the compose field in the **Guilt Market** room. Wallet A types, visibly, at
normal speed:

```
I reused my teammate's pitch deck.
```

Timer preset **25s**. Click **Seal**.

Behind that one click: `create_market` and `create_secret_shell` on L1 (the shell is allocated with an
all-zero body), then `delegate_market` and `delegate_secret`, then on the rollup
`init_market_permission` (public), `init_secret_permission` (private, member list `[A]`) and
`seal_secret`.

**Narration.** *"I write one line. It never touches Solana."*

That sentence is literally true and it is the claim the whole project rests on: `seal_secret` only
exists on the rollup, and the account it writes into was delegated while it was still empty.

---

### 0:10 — Hash and timer, and the second window that sees nothing

**Action.** Pull back to the split. Left: the market card now shows a 64-hex `commitment_hash`, a
25-second countdown, SEAL `0` / READ `0`, status **OPEN**. Right, incognito, no wallet: the *same*
market, the *same* hash, the *same* timer — and where the body would be, a lock and **PRIVATE — not
readable on your key**.

Hold this for a full three seconds. It is the most important frame in the video.

**Narration.** *"The village gets a hash and a timer. The private rollup keeps the sentence. Second
window, no key — nothing."*

---

### 0:18 — Wallet B bids SEAL

**Action.** Switch to Wallet B on the left. Click **SEAL · 0.5 SOL**. No wallet popup. The SEAL pot
goes to `0.5` in well under a second.

One transaction, two instructions: `place_bid` creates the ER-only bid account and `fund_bid` moves
0.5 SOL from B's delegated purse into the market PDA. They are two instructions because the runtime
refuses one that both CPIs the magic program for an ephemeral account and moves lamports itself
(`UnbalancedInstruction`) — see [ASSUMPTIONS.md](../ASSUMPTIONS.md) §5. `init_bid_permission` then
hides the bid behind a private permission whose only member is B.

**Narration.** *"Wallet two pays to bury it. Rollup speed, no wallet popup, no base-layer
transaction."*

All three claims are literally true and none of them is the session-key claim. The one click is the
browser's burner key; the rollup speed and the absent L1 transaction are the delegation.

---

### 0:24 — Wallet C bids READ

**Action.** Switch to Wallet C. Click **READ · 0.5 SOL**. READ pot goes to `0.5`. Neither the market
card nor the incognito window shows who bid, or on which side — only the two totals.

**Narration.** *"Wallet three pays to read it. Every bid is a private account — nobody sees the other
side."*

If there is room in the frame, show the per-bid panel for C rendering their own bid and the same panel
under B's key showing nothing.

---

### 0:32 — The timer ends, VRF runs

**Action.** The countdown hits `0`. The status chip walks: **OPEN → EXPIRED → VRF PENDING**, with the
randomness badge spinning. The cranker sent `expire_market` and then `request_resolution_vrf`, which
asks the *delegated* oracle queue for randomness from inside the rollup.

Note for the edit: this beat has genuine variable latency. Cut on the status chip changing, not on a
fixed frame count.

**Narration.** *"Timer's out. The market asks MagicBlock VRF who gets to read."*

---

### 0:40 — The sole reader, and the graveyard

**Action.** `callback_resolve` lands, signed by the VRF program's scoped identity PDA. Seal pot was
greater than zero here — **so hold on.** For the SOLE_READER beat you want the take where **only C
bid**, or where B's SEAL bid did not land. Shoot it that way: in the Guilt Market, any seal money at
all means BURIED.

> **Shooting note.** Under the live rule (`seal_pot > 0 → BURIED`), the 0:18 SEAL bid and the 0:40
> SOLE_READER payoff cannot both be in the same market. Shoot beats 0:18–0:24 on **market #1** to show
> two-sided bidding, then cut at 0:32 to **market #2** — same room, same timer, READ-only — for the
> resolution. Same UI, same wallets, one cut. Do not fake a `seal_pot > 0` market resolving to
> SOLE_READER; the tombstone would contradict you on camera.

Left window as Wallet C: the card flips open and the plaintext renders — *"I reused my teammate's pitch
deck."* Right window, incognito, unchanged: still **PRIVATE**. Below, the graveyard card shows the
truncated hash and the badge **SOLE_READER**, with C's key as the reader.

What just ran: `settle_bid` + `close_bid` per bid, in one transaction each (the winner is derived in
`settle_bid` from `randomness % read_bid_count`; `close_bid` reclaims the ephemeral account and its
permission). Then `close_book`, which will not pass until every bid is closed *and*
`escrow_lamports == author_payout`. Then `grant_reader` — the single `UpdateEphemeralPermissionCpi`
that rewrites the secret's member list from `[A]` to `[A, C]`. Then `finalize_market`, which publishes
nothing, because `SoleReader` is not a reveal outcome, and `commit_and_undelegate`s the market home.

**Narration.** *"One key was added to the permission. Wallet three sees it. Nobody else ever will. The
graveyard gets the hash."*

---

### 0:50 — A market nobody paid for leaks

**Action.** Cut to the seeded zero-bid market, timer just expiring. `expire_market` sees a confession
market with `seal_pot == 0` and `read_pot == 0`, and sets **PUBLIC_LEAK** on the spot — no randomness
needed, that is the rule of the bazaar. `close_book` passes trivially (`0 == 0`), `finalize_market`
copies `secret.body` into `market.revealed`, and `write_tombstone` carves it into L1.

Worth knowing before you shoot it: this is the one path that writes bytes before undelegating, and it
is where `finalize_market`'s `ExternalAccountDataModified` bug lived until late — a `SoleReader` run
never touches it. It works now; see [ASSUMPTIONS.md](../ASSUMPTIONS.md) §8. Rehearse this beat rather
than trusting a green run of the other one.

On screen: the card turns from a lock into a full sentence, with a **PUBLIC_LEAK** badge and an
explorer link to the tombstone account on Solana.

**Narration.** *"Here's a market nobody paid for. Nobody sealed it, nobody bought it — so the village
takes it. That one is on Solana forever."*

---

### 0:58 — Whisper IPO

**Action.** Cut to the Whisper IPO room. The rumor headline is readable — that market's secret carries
a **public** permission on purpose; it is the positions that stay hidden. The author signs
`resolve_rumor`, the card flips to **FORGIVEN**, and the YES side's balances move: stake back plus a
pro-rata slice of the NO pot.

End on the graveyard, scrolling.

**Narration.** *"And the rumor market settles. Confessions in private. Markets in real time."*

---

## What is live vs. what is pre-staged

Say this in the submission text, not in the voiceover — but do not omit it.

**Live on camera, real transactions:** market creation, the empty secret shell, both delegations, the
seal, both bids and their ER-native lamport moves, expiry, the VRF request and callback, settlement,
`grant_reader`, the public leak, and the Whisper IPO resolution.

**Pre-staged before the take, because it is base-layer work with no time budget:** wallet funding,
`deposit_purse` + `delegate_purse` for B and C, the village, the seeded markets, and at least one older
graveyard entry.

**Not in the video at all:** `open_session` and `place_bid_with_session`. The scoped session key is a
real program feature with a real test (`tests/sinbazaar.ts`, "a session key is bound to one market and
one spend ceiling"), but the web app bids with a burner key, so do not narrate it as if the browser
were using it.

**Timing caveat you should mention:** `finalize_market` does `commit_and_undelegate`, and the market
takes a few seconds to land back on L1 before `write_tombstone` can run. The graveyard card shows the
resolved outcome from the rollup immediately and flips to "on Solana" with an explorer link when the
tombstone actually lands. In a 60-second cut the tombstone for the 0:40 market may land after the
video ends. Do not imply otherwise — show the 0:50 leak's tombstone, which is fast because it has no
bids to settle and needs no randomness.

**Privacy caveat:** shoot the incognito shot against `https://devnet-tee.magicblock.app`. The local
query-filtering service exercises the same client code path but is not a TEE and does not enforce the
read boundary. If you shoot locally, say so.

If there is room in the cut — or in the submission text — this is the shot that settles it:

```bash
. ./.env.devnet && npx ts-node scripts/prove-privacy.ts
```

It has been run against the devnet TEE and every check passed, including a stranger holding a *valid*
TEE token being refused the confession. The output and the explorer links are in the README's
[Proven on devnet](../README.md#proven-on-devnet). An incognito browser window is the picture; that
terminal is the proof.
