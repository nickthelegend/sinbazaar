# SINBAZAAR

> **Confession stays in a Private Ephemeral Rollup. The market runs in real time on an Ephemeral Rollup.
> MagicBlock VRF picks the reader. Solana only receives a tombstone.**

MagicBlock Solana Blitz v8 submission.
Program: [`2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN`](programs/sinbazaar/src/lib.rs) — Anchor, 35 instructions,
[deployed to devnet](#proven-on-devnet).

**FICTION MODE.** Every confession in this build is startup-village satire. No real secrets, no real
targets, no real leverage. See [Safety / fiction mode](#safety--fiction-mode).

---

## What SINBAZAAR is

A candlelit village of markets where the underlying asset is a secret.

You type one line — *"I reused my teammate's pitch deck."* — and the village gets a hash and a timer.
Not the sentence. For the next few minutes anyone can pay to **SEAL** it (keep it buried) or pay to
**READ** it (become a candidate for the one pair of eyes that ever sees it). The bidding runs at rollup
speed: no wallet popup per click, no base-layer transaction per bid, and nobody can see anyone else's
side or size.

When the timer hits zero the village stops arguing and randomness decides. MagicBlock VRF returns, the
program picks the outcome class, and — if the verdict is `SOLE_READER` — exactly one key is added to
the confession's permission member list. That person, and nobody else, can now fetch the plaintext.

Then Solana gets a gravestone: the hash, the outcome, the pots, the winner's key, the randomness. The
body is on it only if the village voted for that by paying nothing at all.

The confession never leaves the rollup. Not on the way in, not on the way out.

---

## Why Solana L1 alone cannot do this

**1. A confession on L1 is public forever.**
There is no private account on Solana. If the body were an instruction argument it would be in the
transaction, in the block, in every RPC's history, and on every explorer — permanently, before a single
bid was placed. Encrypting it just moves the problem: you then need somewhere to put the key, and
handing the key to one person later is the same problem again. SINBAZAAR never submits the body in a
base-layer transaction at all. `create_secret_shell` allocates the `Secret` account **empty** on L1,
`delegate_secret` hands it to the rollup, and only then does `seal_secret` — an ER-only instruction —
write the bytes. There is no block, log, or explorer view in which the plaintext could appear.

**2. A market on L1 is too slow and too expensive to bid on every few seconds.**
The interesting part of this game is the last thirty seconds, when SEAL and READ are trading blows.
On L1 that is one signed transaction and one fee per click, at ~400ms finality, with a wallet popup
each time. On the ER a bid is a lamport move between two PDAs the program already owns, confirmed in
tens of milliseconds, signed by a scoped session key. The `Purse` and the `Market` are both delegated,
so `fund_bid` moves real value without touching the base layer.

**3. There is no way on L1 to hand read access to exactly one randomly chosen person.**
Solana has no notion of "this account is readable by these keys." Even if it did, you would still need
unbiasable randomness that a market participant cannot grind. SINBAZAAR uses both halves of the
MagicBlock stack: VRF supplies the number (delivered through a callback that only the VRF program's
scoped identity PDA can sign for), and the ephemeral permission supplies the access control —
`grant_reader` rewrites the secret's member list from `[author]` to `[author, sole_reader]`, and the
TEE validator refuses the read to everyone else.

---

## Architecture

```
                                  the author
                                       |
                 writes the body ONLY here, never in an L1 transaction
                                       |
                                       v
  +==========================================================================+
  |  PRIVATE EPHEMERAL ROLLUP  --  TEE validator, authenticated ?token= reads |
  |                                                                          |
  |   Secret        seeds [ b"secret", market ]                              |
  |     body[180]   salt[32]   redacted[96]                                  |
  |     permission: is_private = TRUE   members = [ author ]                 |
  |                                     members = [ author, sole_reader ]    |
  |                                               after grant_reader         |
  |                                                                          |
  |     allocated EMPTY on L1  ->  delegated  ->  filled by seal_secret      |
  |     NEVER undelegated. A buried confession stays in here.                |
  +==========================================================================+
                                       ^
              finalize_market reads it exactly once, and only when
              outcome.reveals_text()  ==  PublicLeak | RandomReveal
                                       |
  +==========================================================================+
  |  EPHEMERAL ROLLUP  --  same rollup, public reads                         |
  |                                                                          |
  |   Market   [ b"market", village, market_id ]                             |
  |     permission: is_private = FALSE   <- hash, timer, pots are the market |
  |     commitment_hash  expires_at  seal_pot  read_pot  status  outcome     |
  |     also the escrow PDA: it holds every funded bid's lamports            |
  |                                                                          |
  |   Bid      [ b"bid", market, bidder ]       EPHEMERAL ACCOUNT (ER-only)  |
  |     side  amount  index  read_rank  funded                               |
  |     permission: is_private = TRUE   members = [ bidder ]                 |
  |                                                                          |
  |   Session  [ b"session", market, owner ]    EPHEMERAL ACCOUNT (ER-only)  |
  |   Purse    [ b"purse", owner ]              delegated; lamports move     |
  |                                             purse -> market, ER-native   |
  |                                                                          |
  |   expire_market -> request_resolution_vrf -> callback_resolve   [VRF]    |
  |   settle_bid + close_bid (xN) -> close_book -> grant_reader              |
  |                               -> finalize_market                         |
  +==========================================================================+
                                       |
                        commit_and_undelegate  (market only)
                                       v
  +==========================================================================+
  |  SOLANA L1                                                               |
  |                                                                          |
  |   Village    [ b"village", authority ]      never delegated              |
  |   Market     home again, status = Settled                                |
  |   Tombstone  [ b"tomb", market ]            write_tombstone              |
  |     commitment_hash  outcome  seal_pot  read_pot  sole_reader            |
  |     randomness  buried_at                                                |
  |     revealed[..]  <- stays all-zero unless the outcome authorised text   |
  +==========================================================================+
```

Full account-by-account detail, the state machine and the payout tables are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## MagicBlock primitives used

| Primitive | What it does in SINBAZAAR | Look at |
|---|---|---|
| **Private Ephemeral Rollups** — ephemeral permissions, `is_private` + member list | The `Secret` account's permission is created with `is_private = true` and `members = [author]`, so the confession body is unreadable over any RPC — TEE endpoint included — by anyone else. The same CPI creates the `Market`'s permission with `is_private = false`, deliberately: hash, timer, pots and status *are* the market. `grant_reader` rewrites the secret's member list to `[author, sole_reader]` — that single `UpdateEphemeralPermissionCpi` is the entire reveal mechanism. | `init_secret_permission`, `init_market_permission`, `grant_reader` |
| **Ephemeral Rollups** — delegation, ER-native lamport escrow | `Market`, `Secret` and `Purse` are created on L1 and delegated with `DelegateConfig { validator }` so the market and its secret land on the same validator. Because a delegated account keeps its original program owner inside the ER, `fund_bid` moves lamports `purse -> market` directly between two program-owned PDAs: real value, no base-layer transaction, no wallet round trip. | `delegate_market`, `delegate_secret`, `delegate_purse`, `fund_bid` |
| **Ephemeral Accounts** — ER-only lifecycle | `Bid` and `SessionScope` are born in the rollup and die there, via `#[ephemeral_accounts]` with the market PDA as `sponsor` and the account itself marked `eph`. The market's `SPONSOR_FLOAT` (40,000,000 lamports, transferred at `create_market`) pays their ER rent, so bidders never pay for storage. `close_bid` closes the bid's permission and then the bid itself, refunding that rent to the market — a separate instruction from `settle_bid`, which moves the money. | `place_bid`, `open_session`, `close_bid` |
| **MagicBlock VRF** — request + authenticated callback | `request_resolution_vrf` calls `create_request_scoped_randomness_ix` against the *ephemeral* oracle queue from inside the rollup, while the market is still delegated, passing the market as a writable callback account. `callback_resolve` is declared `#[vrf_callback]`, which injects a `vrf_program_identity` signer constrained to `scoped_vrf_identity(&crate::ID)` — a PDA only the VRF program can sign for. No user transaction can forge a verdict. `retry_vrf` is the escape hatch: permissionless, and only `VRF_GRACE_SECS` (120s) past expiry, it returns a stalled market to `Expired` so randomness can be asked for again. It never decides an outcome. | `request_resolution_vrf`, `callback_resolve`, `retry_vrf` |
| **`commit` / `commit_and_undelegate`** | `finalize_market` builds a `MagicIntentBundleBuilder` and `commit_and_undelegate`s the **market only**, immediately after deciding whether `market.revealed` may be filled. `commit_market` pushes live state to L1 mid-market without ending it. `undelegate_purse` sends a purse home so its owner can withdraw real SOL. The `Secret` is deliberately in none of these calls. | `finalize_market`, `commit_market`, `undelegate_purse` |
| **Session keys** — scoped delegated signing | A villager mints a `SessionScope` (an ephemeral account) pinned to **one market**, with a spend ceiling and a TTL, then bids repeatedly with no wallet popup via `place_bid_with_session`. The scope is validated by *this program*, not by the client: `charge_session` re-derives the session PDA, checks `revoked` / `session_key` / `market` / `expires_at`, and increments `spent` against `max_spend` on every bid. `Pubkey::default()` as the market is not accepted. | `open_session`, `revoke_session`, `place_bid_with_session`, `charge_session` in `lib.rs` |

The client side of all of this — the three connections, the `?token=` auth flow, PDA derivation and the
hand-rolled permission parser — is in [`sdk/src/index.ts`](sdk/src/index.ts).
[`tests/harness.ts`](tests/harness.ts) drives the whole loop and
[`scripts/demo.ts`](scripts/demo.ts) narrates it.

---

## Built from the official examples

Everything here is assembled from patterns in
**https://github.com/magicblock-labs/magicblock-engine-examples** (vendored at
`vendor/magicblock-engine-examples`).

| Example | What SINBAZAAR took from it |
|---|---|
| [`private-counter`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/private-counter) | The PER permission pattern outright: `CreateEphemeralPermissionCpi` / `UpdateEphemeralPermissionCpi` paid for by the permissioned PDA, `EphemeralMembersArgs { is_private, members }`, `authority_is_signer: false` with PDA seeds, and the "same TEE endpoint + token, different result based on the flag" demo. SINBAZAAR's secret is that counter with the flag pinned on and the member list as the game mechanic. |
| [`sealed-auction`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/sealed-auction) | Sealed bids as private-permissioned ephemeral accounts, and cleanup-gated undelegation: the example refuses to `commit_and_undelegate` until `closed_bid_count == bid_count`. SINBAZAAR's `close_book` is that exact gate, and `finalize_market` will not run until it passes. |
| [`roll-dice`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/roll-dice) | The VRF request/callback shape: `RequestRandomnessParams`, the callback discriminator, `SerializableAccountMeta` for the accounts the callback needs, and `#[vrf_callback]` for the authenticated identity. |
| [`rewards-delegated-vrf`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/rewards-delegated-vrf) | Requesting randomness *while delegated*, from the ER, against the delegated (ephemeral) queue rather than the base-layer queue. |
| [`binary-prediction`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/binary-prediction) | The Whisper IPO room: a two-sided YES/NO book with pro-rata payout from the losing pot, driven by session keys. |
| [`crank-counter`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/crank-counter) | Permissionless cranking. `expire_market`, `settle_bid` and `close_book` can be called by anyone, so an absent author cannot hold a market open or hold a bidder's money hostage. |
| [`session-keys`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/session-keys) | The delegated-signer model. SINBAZAAR implements its own `SessionScope` PDA rather than the `gpl-session` token program (see [ASSUMPTIONS.md](ASSUMPTIONS.md)), but the shape — temporary key, wallet-consented scope, program-side validation — is the example's. |
| [`spl-tokens`](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/spl-tokens) | The reference for ER-side token escrow. Week 1 deliberately uses SOL/lamports instead; this example is the migration target. |

---

## Endpoints

Devnet values are the SDK defaults in [`sdk/src/index.ts`](sdk/src/index.ts); local values are exported
by [`scripts/local-env.sh`](scripts/local-env.sh). Every one is overridable by environment variable.

| Role | Env var | Devnet default | Local |
|---|---|---|---|
| Base Solana (RPC / WS) | `PROVIDER_ENDPOINT` / `WS_ENDPOINT` | `https://api.devnet.solana.com` | `http://localhost:8899` / `ws://localhost:8900` |
| Ephemeral Rollup (RPC / WS) | `EPHEMERAL_PROVIDER_ENDPOINT` / `EPHEMERAL_WS_ENDPOINT` | `https://devnet-as.magicblock.app` | `http://localhost:7799` / `ws://localhost:7800` |
| Authenticated private read path | `TEE_PROVIDER_ENDPOINT` / `TEE_WS_ENDPOINT` | `https://devnet-tee.magicblock.app` | `http://localhost:6699` / `ws://localhost:6700` (QFS) |
| Router | `ROUTER_ENDPOINT` | `https://devnet-router.magicblock.app` | points at the ER (no local router) |
| ER validator identity | `VALIDATOR` | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` | `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev` |
| VRF queue, delegated (ER) | `VRF_EPHEMERAL_QUEUE` | `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` | `Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT` |
| VRF queue, base layer | `VRF_BASE_QUEUE` | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` | `GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb` |

SINBAZAAR requests randomness from inside the rollup, so the **delegated** queue is the one that
matters — it is the only one the program ever touches. The base queue is listed for completeness because
`scripts/local-stack.sh` also runs an oracle against it; the local value comes from `local-env.sh`, the
devnet value from the MagicBlock skill's queue table (`ephemeral_vrf_sdk::consts::DEFAULT_QUEUE`), not
from a default in this repo.

**The auth token is a query parameter, not a header.** `teeConnection()` obtains a JWT by signing the
validator's challenge, then appends `?token=<jwt>` to **both** the HTTP and the WebSocket URL. A header
will not work. Any keypair can get a token; what the token buys is the *identity* the validator checks
against each account's permission member list.

---

## Install the MagicBlock skill

```bash
npx skills add https://github.com/magicblock-labs/magicblock-dev-skill
```

Pinned for this repo in [`skills-lock.json`](skills-lock.json); the vendored copy lives at
`.agents/skills/magicblock/`.

---

## Run it locally

**Prerequisites**

```bash
# Solana + Anchor toolchain (anchor_version = 1.0.2, see Anchor.toml)
solana --version && anchor --version

# MagicBlock local stack: provides the mb-stack supervisor
npm install -g @magicblock-labs/ephemeral-validator

# VRF oracle binary, platform-specific
npm install -g @magicblock-labs/vrf-oracle-$(uname -s | tr A-Z a-z)-$(uname -m)

# a funded local wallet at ~/.config/solana/id.json
solana-keygen new --no-bip39-passphrase
```

Or do all of that in one go — it also vendors the official examples and installs the MagicBlock skill:

```bash
bash scripts/setup.sh
```

**Build, bring the cluster up, seed it**

```bash
npm install

# anchor keys sync && anchor build
npm run build

# base :8899, ER :7799, QFS :6699, plus two vrf-oracle processes.
# Preloads target/deploy/sinbazaar.so as an upgradeable program.
bash scripts/local-stack.sh            # foreground, Ctrl-C to stop
bash scripts/local-stack.sh --detach   # background; stop with scripts/stop-stack.sh

# in a second terminal
npm run seed        # opens the village and the seeded fiction markets
npm test            # the spec suite: tests/sinbazaar.ts against the live stack
npm run demo        # the 60-second demo, narrated, beat by beat
```

Those two scripts are the end-to-end probes, and both print every assertion they check.
`npm run demo` walks create → delegate → seal → bid (ER-native lamport move) → expire → VRF → settle
+ close bid → close book → `commit_and_undelegate` → tombstone, asserting along the way that the secret
shell is all-zero on L1, that each bid's permission lists only its bidder, and that
`tomb.revealed_len == 0` when nothing leaked.

**Prove the privacy claim on its own:**

```bash
. ./scripts/local-env.sh && npx ts-node scripts/prove-privacy.ts
```

Locally it checks the permission flags and the empty L1 shell, and reports the two refusal assertions
against the local query-filtering service, which enforces the member list too. Against the devnet TEE
it reports them as `PASS`; see [Proven on devnet](#proven-on-devnet).

**The web app**

```bash
cd app && npm install && npm run dev
```

Point it at the local stack by sourcing `scripts/local-env.sh` first, or at devnet by leaving the
endpoint variables unset.

---

## Deploy to devnet

```bash
npm run build                        # anchor keys sync && anchor build
bash scripts/deploy-devnet.sh        # program id 2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN

# the script writes .env.devnet — source it instead of scripts/local-env.sh
. ./.env.devnet && npx ts-node scripts/prove-privacy.ts
. ./.env.devnet && npx ts-node scripts/demo.ts
```

`deploy-devnet.sh` checks the deployer's balance against the binary's rent before it tries, because
devnet's faucet is rate limited and a half-funded `solana program deploy` is a bad afternoon.

Two things must line up or delegation silently goes to the wrong place:

- **`VALIDATOR` must be a real devnet ER validator identity**, and the `Market` and its `Secret` must
  be delegated to the *same* one — `finalize_market` reads the secret and writes the market in a single
  ER transaction.
- **`VRF_EPHEMERAL_QUEUE` must be the delegated queue**, not the base-layer queue, because
  `request_resolution_vrf` runs inside the rollup.

Check that the ER and TEE regions you are pointing at are actually up before blaming the code:
`curl -sS https://status.magicblock.app/api/services`.

---

## Rooms

### Live in week 1

`Room::is_live()` accepts exactly these three. Everything else is rejected by `create_market` with
`RoomNotLive`.

| Room | Rule |
|---|---|
| **GuiltMarket** | The core game. `seal_pot > 0` → **BURIED**. `seal_pot == 0` and `read_pot > 0` → VRF picks one READ bidder as **SOLE_READER**. Both pots zero → **PUBLIC_LEAK**, and the body is carved into the L1 tombstone. |
| **BlackmailEscrow** | A rising ransom: `ransom_floor + ransom_slope × seconds_elapsed`. Meet it with SEAL money and it is **BURIED**. Miss it and the coin flips: **RANDOM_REVEAL** publishes the author's own single redacted sentence on L1, otherwise the body is **INHERITED** by one random bidder. No bidders at all → **PUBLIC_LEAK**. |
| **WhisperIpo** | A rumor market, not a confession market. The `Secret` holds the rumor headline with a **public** permission — the rumor is meant to be read; it is the positions that stay hidden. YES/NO book, resolved to **FORGIVEN** or **SLASHED**, winners take their stake plus a pro-rata slice of the losing pot. |

### Phase 7 — enumerated, disabled

These are real variants of the `Room` enum, deliberately typed into the program and deliberately
rejected by `create_market`. The UI shows them as disabled cards. **The names and the state machine
hooks exist; the rules below are design intent, not implemented code.** `MirrorConfession` sits in the
enum's "live" block but `is_live()` rejects it too, so 22 rooms are disabled in total.

| Room | Intended rule |
|---|---|
| **MirrorConfession** | Two authors each seal a confession and each is given read access to the other's — a mutual hostage exchange, settled only if both sides commit. |
| ApologyBonds | The author issues a bond against a future apology; holders are paid when the village attests it was made, slashed if the deadline passes. |
| InheritanceOfSin | The secret is not revealed but transferred: the winner becomes its new author and inherits the right to re-list it. |
| ScapegoatAuction | The village bids on *who* is named in a confession, not on whether it is read. |
| LastMessageWins | A rolling timer that resets on every bid; the final bidder before it runs out takes the whole book. |
| CursePool | Bidders join a pool against a named market; the pool pays out only if that market ends in a leak. |
| ConfessionBondingCurve | Read access is priced on a bonding curve — each additional reader costs strictly more than the last. |
| AbsolutionAmm | A two-sided pool of guilt and absolution; the price of being forgiven floats against how much guilt is in the pool. |
| AnonymousPatron | A third party funds the SEAL side without ever being linked to the author on-chain. |
| RedactionRoulette | The randomness chooses *which sentence* of the body is published, not whether it is published. |
| DeadMansTweet | The confession auto-leaks unless the author cranks a heartbeat before every expiry. |
| JuryOfSeven | VRF draws seven villagers; a majority vote, not a pot, decides the outcome. |
| Stain | A permanent reputation mark attached to an author's key, tradeable and removable only by buying it out. |
| ConfessorsBooth | One-to-one: the author picks the reader themselves and the village only prices the transaction. |
| SinFutures | Bid on a confession that has not been written yet; the author is bound to deliver one by the deadline. |
| ReputationHostage | The author stakes their own accumulated reputation rather than SOL against the seal. |
| VillageWill | On the author's key going inactive for N days, their sealed confessions are distributed to named heirs. |
| SinOracle | The market resolves against a real off-chain fact instead of against randomness. |
| CloneConfession | Anyone may re-list an already-revealed confession under their own key; the original author earns a royalty. |
| CowardsInsurance | Buy a policy that refunds your READ stake if the market ends BURIED. |
| PublicPenance | The author can buy their way out of a leak by completing a public, verifiable task. |
| ForgettingAnnex | A market that pays to have an existing tombstone's text struck from the front end. |

The `Outcome` enum likewise carries `ExportWinner`, `CurseHit` and `CurseMiss`, which no week-1 code
path can produce; they are reserved for the rooms above.

---

## Safety / fiction mode

SINBAZAAR is a **social game and dark-market simulation**. It is not a tool for leverage over real
people, and it is not built to be one.

- **Every seeded confession is startup-village satire.** *"I reused my teammate's pitch deck." / "Our
  village demo is vaporware." / "I shorted my cofounder's token." / "I voted no on this project in
  private."* Fictional, self-deprecating, and about nobody in particular.
- **A FICTION MODE banner is visible in the UI at all times**, on every room and every market card.
- `initialize_village` records `fiction_mode` on-chain and it defaults to on. To be precise about what
  that is: **a product-level declaration, not a security control** — the program does not and cannot
  inspect the body, which is the entire point of the privacy design.
- `MAX_BODY_LEN` is 180 bytes. One sentence. Long enough for a joke, too short for a dossier.
- The rooms named `BlackmailEscrow` and `Stain` are *game* mechanics with fictional stakes. Real
  blackmail, doxxing, threats, and targeting of private individuals are out of scope and out of bounds.
- Nothing here should be pointed at a secret whose exposure would actually hurt someone. Once a key is
  added to a permission member list, that person can copy the text anywhere; no rollup can take it back.

---

## Proven on devnet

Program `2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN` is deployed to Solana devnet, and the privacy
claim has been run against the real TEE validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`:

```bash
. ./.env.devnet && npx ts-node scripts/prove-privacy.ts
```

```
tee  https://devnet-tee.magicblock.app  (real TEE)

1. The confession is never submitted in a base-layer transaction
  PASS  the Secret account is allocated EMPTY on L1
2. It is written only inside the rollup
  PASS  the secret's ephemeral permission is PRIVATE
  PASS  the member list is exactly [author]
3. The author — and only the author — can read it
  PASS  the author reads it back through their own TEE token
  PASS  the public commitment is sha256(body || salt)
4. Nobody else can
  PASS  the base layer still shows an empty body
  PASS  an unauthenticated rollup connection is refused the account
  PASS  a stranger with a VALID TEE token is refused the confession
  PASS  the market itself is public — hash, timer and pots are readable
  PASS  a stranger CAN read the market — the game is public, the secret is not

PRIVACY PROVEN against the devnet TEE.
```

The two refusal lines are the ones that matter, and the only two a local run cannot produce —
`prove-privacy.ts` proves them on both clusters. The local query-filtering service enforces the member list; what devnet adds is attestation. It answers reads
a TEE refuses. The unauthenticated read is the same devnet host with no `?token=` on the URL. The
stranger is a freshly generated keypair that completes the TEE's own challenge/response handshake and
holds a valid JWT — it is refused because it is not on the account's permission member list, not
because it failed to authenticate.

Try it yourself on a market from that run:

| | |
|---|---|
| market (public) | [`9tE7qFDnVug5iEeSdgtb6xg6MiAJyeXtLxDGqbfUtYh1`](https://explorer.solana.com/address/9tE7qFDnVug5iEeSdgtb6xg6MiAJyeXtLxDGqbfUtYh1?cluster=devnet) |
| secret (private) | [`9ZyuZERpymZGpy68CFTornYViCY4LYYncrSYaFWGPaiL`](https://explorer.solana.com/address/9ZyuZERpymZGpy68CFTornYViCY4LYYncrSYaFWGPaiL?cluster=devnet) |

The explorer shows the secret as an account owned by the delegation program with an all-zero body.
That is not a rendering quirk — that is the whole design.

---

## A gotcha worth knowing

`solana program deploy` upgrades the program on the base layer, but the **ephemeral
validator keeps its own copy**. Until it reloads, ER transactions run the *old*
bytecode, which surfaces as account-list errors that look like application bugs —
`AccountNotEnoughKeys`, `InvalidWritableAccount` — whenever an instruction's accounts
changed. Locally the reliable redeploy is a stack restart, which preloads the fresh
binary at genesis:

```bash
bash scripts/rebuild.sh      # anchor build + stop-stack + local-stack
```

---

## Known limitations

Honest list. These are things we would say out loud in the demo.

**1. The privacy claim is proven on devnet, not on the local stack.**
`bash scripts/local-stack.sh` brings up a query-filtering service on `:6699` and the SDK routes
`TEE_PROVIDER_ENDPOINT` there, so the code path is identical. The local QFS is not attested hardware, but it
does refuse the reads it should. Locally you can verify the permission exists, that `is_private` is
true, and that the member list changes when `grant_reader` runs; you cannot verify that a stranger is
turned away. `scripts/prove-privacy.ts` reports those two assertions as `N/A` locally and as `PASS`
against `https://devnet-tee.magicblock.app`, where they have been run — see
[Proven on devnet](#proven-on-devnet). Do not read a green local run as proof of confidentiality.

**2. Whisper IPO settles by author attestation, not by an oracle.**
`resolve_rumor` requires the signer to equal `market.author` and takes the result as an argument. There
is no proof the rumor was true. The payout path reads `market.rumor_result` and nothing else, so
swapping in a real oracle is a change to one signature check — but that swap has not been made.

**3. `MAX_BIDDERS` is 8.**
A market accepts at most eight bids and the bid PDA is seeded `[b"bid", market, bidder]`, so that is
eight *distinct* bidders, one bid each. This is not an arbitrary cap: it bounds the sponsored ER rent
the market PDA has to float, and it kept the original resolution design inside one transaction. A
ninth bidder gets `TooManyBidders`.

**4. The body is capped at 180 bytes** (`MAX_BODY_LEN`), the redacted sentence at 96
(`MAX_REDACTED_LEN`), and the tombstone reveal buffer at 180 (`MAX_TOMB_BODY`). Fixed-size arrays, so
the rent is paid for the full 180 whether you use it or not.

**5. Three pairs of instructions must be sent together, and the program does not require it.**
`place_bid` + `fund_bid`, and `settle_bid` + `close_bid`, are split because the runtime rejects a
single instruction that both CPIs the magic program for an ephemeral account and moves lamports itself
(`UnbalancedInstruction`). The client always sends each pair in one atomic transaction, so a bid is
opened and funded together or not at all — but a hand-built transaction can call `place_bid` alone,
leaving a bid with `funded = false` that contributes to no pot and settles for zero while still
consuming one of the eight bid slots. `settle_bid` alone leaves a settled bid whose ephemeral account
is still open, which `close_book` then refuses to look past. See [ASSUMPTIONS.md](ASSUMPTIONS.md) for
what an unfunded bid can and can no longer do.

**6. Money is SOL/lamports, not SPL.** Week 1 holds value directly in the market PDA. The
`spl-tokens` example is the migration target and nothing in the outcome or payout logic depends on the
asset being native SOL, but the swap has not been done.

**7. The `Secret` is never undelegated — by design, with a consequence.** A buried confession stays
inside the rollup forever, which is the guarantee. It also means that if that rollup's state is torn
down, the confession is gone: there is no L1 copy, ever, for any outcome except the two that authorise
publication. That is the trade we chose, not an accident.

**8. `fiction_mode` is a label.** The program cannot read the body — that is the design — so it cannot
moderate it. Content safety here is the front end, the seed data, and the social contract.

**9. Rooms beyond the three live ones are enumerated, not implemented.** 22 of the 25 `Room` variants
are rejected by `create_market`. They are in the enum to show the shape of the village, and they are
shown in the UI as disabled.

**10. A browser can only settle the bids it placed itself.**
`settle_bid` is permissionless, but its bid PDA is seeded `[b"bid", market, bidder]`
and bid accounts sit behind a permission listing only the bidder — so there is no way
to *enumerate* a market's bidders. The web app keeps a `localStorage` list of the bids
that browser placed and settles those; if another villager also bid, `close_book`
correctly refuses until they open the market and resolve it too. The UI says so in
those words rather than showing a raw `UnsettledBids`. This is a direct consequence of
the privacy design, not an oversight: publishing a bidder roster on the public market
would tell everyone who participated, and with a small book that is most of the secret.
The scripts (`seed.ts`, `demo.ts`, the test suites) know every bidder they created, so
they settle markets end to end.

**11. The commitment hash proves consistency, not honesty.** `sha256(body || salt)` published at seal
time lets anyone verify that a *revealed* body is the one that was sealed. It proves nothing about a
`BURIED` market: the author could have sealed 180 bytes of noise, and no one will ever know.

---

## Repo map

```
programs/sinbazaar/src/lib.rs     the Anchor program — 35 instructions
programs/sinbazaar/src/state.rs   accounts, Room / MarketStatus / Outcome / BidSide, the constants
programs/sinbazaar/src/error.rs   SinError
sdk/src/index.ts                  TypeScript client: PDAs, the three connections, ?token= auth,
                                  commitment hashing, the hand-rolled permission parser
tests/harness.ts                  one market through the whole lifecycle, reusable
tests/sinbazaar.ts                the spec suite the harness exists for
scripts/setup.sh                  one-time: toolchain, skill, vendored examples, deps
scripts/local-env.sh              every endpoint, as environment variables
scripts/local-stack.sh            base + ER + QFS + two VRF oracles, one command
scripts/rebuild.sh                anchor build + stack restart (the ER caches the program)
scripts/stop-stack.sh             kill the stack and wait for the ports
scripts/deploy-devnet.sh          devnet deploy, balance-checked, writes .env.devnet
scripts/demo.ts                   the 60-second demo, narrated, beat by beat
scripts/prove-privacy.ts          the privacy challenge — the claim, on its own
target/idl/sinbazaar.json         the IDL — authoritative for account names and argument order
docs/ARCHITECTURE.md              accounts, state machine, payout tables, trust model
docs/DEMO.md                      the 60-second video script
ASSUMPTIONS.md                    every judgment call, written down
```

---

*Built for MagicBlock Solana Blitz v8. Fiction only.*
