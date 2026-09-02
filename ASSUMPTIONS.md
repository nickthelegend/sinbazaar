# SINBAZAAR — Assumptions and judgment calls

Every decision on this page is a choice, not a fact about the world. Each entry says what we assumed,
why, what it costs, and where in the code to check it. If a judge disagrees with one of these, they
should be able to find the exact lines and argue with them.

Referenced files: `programs/sinbazaar/src/lib.rs`, `programs/sinbazaar/src/state.rs`,
`programs/sinbazaar/src/error.rs`, `sdk/src/index.ts`, `scripts/local-env.sh`.

---

## Money and escrow

### 1. Week 1 holds SOL/lamports, not SPL tokens

**Assumption.** The market PDA is the escrow and it holds native lamports. `deposit_purse` transfers
real SOL on L1; `fund_bid` moves lamports `purse -> market` inside the rollup with a direct
`try_borrow_mut_lamports` on two accounts this program owns.

**Why.** It is the shortest path to a *real* ER-native value transfer. An SPL escrow adds token
accounts, an ATA per bidder, delegation of those accounts, and the `spl-tokens` example's
deposit/withdraw dance — none of which makes the privacy or the randomness argument any stronger.

**Cost.** No stablecoin denomination, no token-gated rooms, and the ER-side balance is a raw lamport
number rather than a token balance a wallet renders natively.

**Migration surface.** Nothing in `compute_payout`, the `Outcome` enum, or the state machine assumes
the asset is SOL. The change is confined to `deposit_purse`, `fund_bid`, `settle_bid`, `withdraw_purse`
and `claim_author`. `magicblock-engine-examples/spl-tokens` is the target.

### 2. Lamport bookkeeping is duplicated on purpose

`market.escrow_lamports` and `purse.available` / `purse.locked` track the bidder-owned portion
separately from the accounts' actual lamport balances, because those balances also contain rent and the
market's `SPONSOR_FLOAT`. Two numbers that must agree is a place bugs live; we accepted it so that
"how much of this PDA belongs to bidders" is answerable without knowing the rent schedule.

### 3. The author is paid on L1, after settlement, by pull

`settle_bid` accrues forfeited stakes into `market.author_payout` rather than paying the author
immediately. `claim_author` moves the lamports out on the base layer once `status == Settled`. Pull
over push: `settle_bid` is permissionless and we did not want a cranker's transaction to require the
author's account.

### 4. `EscrowNotEmpty` is defined but never enforced

`SinError::EscrowNotEmpty` exists in `error.rs` and appears nowhere in `lib.rs`. Neither
`write_tombstone` nor `claim_author` asserts `escrow_lamports == 0`. In the intended flow `close_book`
already required every bid closed before `Settled`, so the escrow is drained by then — but that is an
invariant we reasoned about, not one the program checks. Along with `MissingBid`, `DuplicateBid`,
`CommitmentMismatch`, `VrfAlreadyRequested` and `VrfNotDelivered`, it is a leftover from the earlier
design where `resolve` walked every bid through `remaining_accounts` in one transaction. Left in place
deliberately rather than deleted mid-hackathon; called out here so nobody mistakes them for live checks.

---

## The place_bid / fund_bid split

### 5. Two instructions, one transaction — enforced by the client, not the program

**Assumption.** `place_bid` creates and records the bid; `fund_bid` moves the money; the client always
sends both in a single atomic transaction (see `scripts/smoke.ts`, which builds
`new Transaction().add(bidIx, fundIx)`).

**Why split them at all.** Creating an ephemeral account is a CPI into the magic program. Keeping the
program's own lamport arithmetic in a separate instruction means each instruction's balance change is
trivially auditable, and the ephemeral-account CPI does not have to be reasoned about alongside an
escrow move. The transaction is still atomic, so a bid is opened and funded together or not at all —
*when the client behaves*.

**What the program does instead.** It makes an unfunded bid harmless: `funded` starts `false`,
`fund_bid` is the only thing that touches a pot, and `settle_bid` computes a payout of `0` for any bid
where `!bid.funded`.

**The residual, stated honestly.** A hand-built transaction can call `place_bid` alone. That bid:

- consumes one of the eight `MAX_BIDDERS` slots (`bid_count` is incremented in `place_bid`);
- takes a `read_rank` — because `read_rank` is read from `market.read_bid_count` in `place_bid`, but
  `read_bid_count` is only incremented in `fund_bid`. So an unfunded READ bid is assigned the same
  `read_rank` as the next funded READ bid;
- is still examined by `is_chosen_bid` in `settle_bid`, which is **not** gated on `bid.funded` before it
  writes `market.sole_reader`. With a colliding `read_rank`, whichever of the two is settled last wins
  the assignment.

The chosen bid's *payout* is unaffected (an unfunded bid gets `0` and forfeits nothing, since
`staked == 0`). The exposure is the identity of the reader, not the money. The fix is one line — assign
`read_rank` in `fund_bid`, or require `bid.funded` in `is_chosen_bid` — and it is not in this build. We
are documenting it rather than claiming the split is free.

---

## Privacy

### 6. The Secret is never undelegated, and that is the product

No instruction includes the `Secret` account in a `commit_and_undelegate` bundle. `finalize_market`
undelegates the **market only**, and reads the secret one last time on the way out.

**Consequence we accept.** A buried confession lives in the rollup and nowhere else. If that rollup's
state is discarded, the confession is gone — there is no L1 copy for any outcome except `PublicLeak`
and `RandomReveal`. We think that is the correct trade for a product whose entire promise is "this does
not end up on a public ledger," but it is a real durability trade and we are not going to describe an
Ephemeral-Rollup-resident secret as permanent storage.

### 7. The market's permission is public on purpose

`init_market_permission` passes `is_private: false`. The hash, the timer, the pots and the status *are*
the market — a game where nobody can see the order book is not a game. Only the body is private, and it
never lives on the `Market` account.

### 8. Whisper IPO's secret is public, and the same account does both jobs

`init_secret_permission` computes `is_private = market.room.is_confession_market()`, which is true for
`GuiltMarket` and `BlackmailEscrow` and false for `WhisperIpo`. We reused the `Secret` account to hold
the rumor headline rather than adding a fourth account type: in a rumor market the headline is meant to
be read and it is the *positions* that stay hidden, which the private per-bid permissions already
handle.

### 9. `seal_secret` can be called more than once

There is no "already sealed" guard. While `status == Open`, the author can call `seal_secret` again,
overwriting the body, the salt and the redaction, and rewriting `market.commitment_hash`. Anyone
watching sees the hash change, so it is detectable rather than silent — but a bidder who bid against
hash *X* can find themselves settled against hash *Y*. Treated as a product question (do you want an
author to be able to withdraw and rewrite before the first bid?) that we did not have time to answer
properly. In week 1 it is unguarded.

### 10. The commitment proves consistency, not honesty

`sha256(body || salt)` lets anyone verify a *revealed* body against what was sealed. For a `Buried`
market it proves nothing at all — the author may have sealed 180 bytes of noise. Deliberate: making the
content provable would require reading it, which would defeat the point.

### 11. `fiction_mode` is a declaration, not a control

`initialize_village` stores it on-chain and it defaults to on. The program cannot read the body, so it
cannot moderate the body. Content safety here is the seed data, the front end and the social contract.
`state.rs` says this in a comment; we are repeating it here so it is not read as a filter.

---

## Randomness and resolution

### 12. The VRF callback picks the outcome *class*; `settle_bid` picks the person

`callback_resolve` records `randomness`, sets the `Outcome`, and stops. The specific winner is derived
in `settle_bid` from `randomness % read_bid_count` (or `% bid_count` for `Inherited`).

**Why.** It keeps the callback's account list fixed at one account. The alternative — passing every bid
account into the callback via `accounts_metas` — makes the request's account list depend on how many
people bid, which is fragile and puts a `MAX_BIDDERS`-sized transaction on the oracle's critical path.
`bid.read_rank` and `bid.index` are stamped at bid time precisely so that any cranker derives the same
winner without holding every bid account at once.

### 13. `client_seed` is caller-supplied and unvalidated

`request_resolution_vrf(market_id, client_seed: u8)` expands to `caller_seed: [client_seed; 32]`. The
instruction is effectively permissionless, so a determined caller can choose the seed. MagicBlock's VRF
guidance explicitly warns against user-controlled seed grinding where the result has economic value.
Mitigating factors in this build: the request can only be made once (`status` moves to `VrfPending` and
the instruction requires `Expired`), and the caller cannot see the VRF keypair's output in advance. We
did not add a program-derived seed. Named here rather than glossed.

### 14. There is no timeout out of `VrfPending`

If the callback never arrives, the market sits in `VrfPending` forever and the escrow stays put.
Recovery is operational (re-run the oracle), not programmatic. A production version needs an explicit
timed-out state, as the MagicBlock security guidance recommends.

### 15. The zero-pot public leak needs no randomness

`expire_market` short-circuits: a confession market with `seal_pot == 0` **and** `read_pot == 0` goes
straight to `Outcome::PublicLeak` and `MarketStatus::Resolved`, skipping VRF entirely. It is a rule, not
a draw — nobody paid, so there is nothing to decide. (`callback_resolve` reaches the same conclusion for
`GuiltMarket` if it ever runs with both pots empty, so the two paths agree.)

### 16. The Blackmail Escrow ransom curve is linear and evaluated once

`ransom_due(now) = ransom_floor + ransom_slope * (now - created_at)`, evaluated at `resolved_at` inside
`callback_resolve`. A linear curve was chosen for legibility on a market card, not because it is the
right economic shape.

**A sharp edge.** The `Buried` branch requires `seal_pot >= due && due > 0`. A market created with
`ransom_floor = 0` and `ransom_slope = 0` therefore has `due == 0` and **can never be buried**, however
much SEAL money it attracts — it always falls through to the randomness branch. `create_market` does not
reject those parameters. If you seed a Blackmail Escrow market, give it a non-zero floor.

### 17. Whisper IPO settles by author attestation

`resolve_rumor` requires the signer to equal `market.author` and takes the result (`1` = YES, `2` = NO)
as an argument. There is no oracle and no proof the rumor was true.

**Why.** An oracle-resolved rumor market is a different project. The payout path reads
`market.rumor_result` and nothing else, so swapping in a real oracle is a change to one signature check.

**A naming wart.** The error on that check is `SinError::NotVillageAuthority`, left over from a design
where the village authority resolved rumors. The check is against `market.author`. The error message
will mislead anyone reading a failed transaction; the constraint itself is correct for
"author attestation."

---

## Rooms and scope

### 18. Three rooms live, twenty-two enumerated and rejected

`Room::is_live()` matches `GuiltMarket | BlackmailEscrow | WhisperIpo`. `create_market` rejects
everything else with `RoomNotLive`.

**Why enumerate the rest at all.** The `Room` enum is the shape of the village. Typing the twenty-two
disabled rooms into the program (rather than into a slide) makes the scope claim checkable: a judge can
read `state.rs` and see exactly which rooms have a code path and which are cards in a UI.

### 19. MirrorConfession is deferred, even though the enum groups it with the live rooms

`state.rs` places `MirrorConfession` under the `// ---- live ----` comment, but `is_live()` does not
match it. That grouping is a leftover from when it was going to ship in week 1; the behaviour is
`RoomNotLive`, same as the Phase-7 block.

**Why it was cut.** Mirror Confession requires two authors, two secrets, and a permission update that is
only valid if *both* sides commit — a two-party atomic exchange across two private accounts. That is a
second state machine, not a variant of the first. Cutting it kept the resolution path to one shape.

The comment grouping is misleading and would be worth fixing; we did not touch it because other agents
are working in that file.

### 20. `Outcome` carries three variants nothing can produce

`ExportWinner`, `CurseHit` and `CurseMiss` are unreachable in week 1 — reserved for Phase-7 rooms. They
land in `compute_payout`'s fallback arm (`_ => bid.amount`), so if one were ever set, every bid would be
refunded. A safe default rather than a designed one.

---

## Sessions

### 21. SINBAZAAR implements its own session scope, not `gpl-session`

The `session-keys` example uses the `gpl_session` token program. We use a `SessionScope` PDA at
`[b"session", market, owner]`, created as an ephemeral account and validated by `authorise_bidder`.

**Why.** Everything we needed to bound — one market, a spend ceiling, an expiry, revocability — is
application policy, which the MagicBlock security guidance says the application must implement anyway.
Adding a second program to the CPI graph to then re-check all of it in our own program was not worth it
for a single-market bidding flow.

**Cost.** No cross-program session reuse: a SINBAZAAR session key is a SINBAZAAR session key. And the
scope is stored in an *ephemeral* account, so it exists only inside the rollup — which is where every
instruction that consults it runs.

### 22. Sessions are pinned to one market and cannot be widened

`SessionScope::is_valid` requires `scope.market == *market`, and `open_session` sets
`market: ctx.accounts.market.key()`, so a wildcard `Pubkey::default()` scope cannot be constructed
through the program. `authorise_bidder` re-derives the session PDA from
`[SESSION_SEED, market, bidder]` and checks the account is owned by this program, so a caller cannot
substitute a session account from another market. `spent` is incremented and written back on every bid.

Deliberate: the wallet consents to a bounded thing, and the *program* is what holds it to that bound.

---

## Client SDK

### 23. The permission byte layout is parsed by hand

`readPermission()` in `sdk/src/index.ts` walks the account data directly:

```
[0]      discriminator
[1]      bump
[2..34)  permissioned account
[34]     is_private
[35..]   members, 33 bytes each: flags(1) || pubkey(32)
```

**Why not the SDK helper.** `deserializePermission` from `@magicblock-labs/ephemeral-rollups-sdk`
(0.17.0) expects an older shape — a `hasMembers` byte followed by a `u32` count — and reads a garbage
length against the layout the on-chain permission program actually writes. It is re-exported from our
SDK for compatibility but deliberately not used on the read path.

**Cost.** A layout change upstream breaks our parser silently rather than loudly. The parser also drops
the program's own key from the member list, because the permission program adds it itself and it is
noise in a UI that shows "who can read this."

**This is the assumption we would most like a MagicBlock engineer to check**, because every privacy
assertion in the demo is rendered through it.

### 24. Three connections, and the auth token is a query parameter

`baseConnection()`, `erConnection()` and `teeConnection()` are separate on purpose — never reuse a base
blockhash for an ER transaction. `teeConnection()` obtains a JWT via `getAuthToken` (sign the
validator's challenge with `nacl.sign.detached`) and appends `?token=<jwt>` to **both** the HTTP URL and
the WebSocket URL. A header does not work. Any keypair can get a token; the token supplies the
*identity* the validator checks against the permission member list, not the authorisation itself.

### 25. `isRealTee()` is a substring check

```ts
export function isRealTee(url = ENDPOINTS.tee): boolean { return url.includes("tee"); }
```

Good enough to distinguish `https://devnet-tee.magicblock.app` from `http://localhost:6699` and drive a
UI warning. It is not a TEE attestation and must not be presented as one — verifying a TDX quote, and
checking its measurements against an expected workload allowlist, is a separate job this build does not
do.

### 26. The devnet TEE hostname may need updating

The SDK defaults `TEE_PROVIDER_ENDPOINT` to `https://devnet-tee.magicblock.app`. The MagicBlock skill's
resource table lists the devnet TEE region's FQDN as `devnet-tee-as.magicblock.app`. We did not change
the SDK (other agents depend on it) and did not verify which resolves today. Before a devnet demo,
check `https://status.magicblock.app/api/services` and set `TEE_PROVIDER_ENDPOINT` explicitly rather
than relying on the default.

---

## Sizes, caps and cranks

### 27. `MAX_BIDDERS = 8`, and it is eight *bidders*

The bid PDA is seeded `[b"bid", market, bidder]`, so one bidder can hold at most one bid per market and
the cap is eight distinct keys. The cap bounds the ER rent the market PDA must float — `create_market`
transfers `rent(EphemeralPermission::size_of(MAX_BIDDERS + 2)) + SPONSOR_FLOAT` (40,000,000 lamports)
up front — and it was originally set by a resolution design that walked every bid in one transaction.
That design is gone; the cap stayed because the sponsorship maths depends on it.

### 28. Fixed-size text, and a reveal buffer every market pays rent for

`MAX_BODY_LEN = 180`, `MAX_REDACTED_LEN = 96`, `MAX_TOMB_BODY = 180`. Fixed-size arrays, so a
three-word confession costs the same rent as a full one. `Market` carries a 180-byte `revealed` buffer
on **every** market, including the ones that will never reveal anything, because the buffer has to
exist on the account that gets committed to L1. A variable-length reveal account created only for
reveal outcomes would be cheaper; it would also be a fourth account and another delegation. We chose
the fixed buffer.

The 180-byte cap doubles as a product constraint: long enough for one sentence, too short for a dossier.

### 29. The author writes their own redaction

`RandomReveal` publishes `secret.redacted`, which the author supplied at `seal_secret`. The program does
not derive a redaction from the body and cannot check that the two are related. An author can supply a
redaction that says nothing. Accepted: the alternative is on-chain text processing over a secret the
program is not supposed to reason about.

### 30. `market_id` is caller-supplied; `market_count` is only a tally

`create_market(market_id, ...)` takes the id as an argument and seeds the PDA with it.
`village.market_count` is incremented but never used to derive an id. Clients pick ids (`smoke.ts` uses
a random `u64`); collisions fail on `init`. Deliberate — it lets a client compute the market PDA before
sending anything — but it does mean "market #7" is not a meaningful thing to say.

### 31. Cranks are permissionless because absent authors are a real failure mode

`expire_market`, `settle_bid`, `close_book` and `write_tombstone` can be called by anyone. A market must
not be holdable-open by an author who closed their laptop, and a bidder's refund must not depend on
someone else showing up. It is safe because the destination and the content are pinned by state:
`settle_bid` can only pay the bidder's own purse, and `write_tombstone` copies fields off the market.

The demo relies on this — the video has no time for anyone to click "resolve."

---

## Environment

### 32. The local stack is not a TEE, and we do not pretend otherwise

`scripts/local-env.sh` sets `TEE_PROVIDER_ENDPOINT=$QFS_ENDPOINT` (`http://localhost:6699`) so the
client code path is identical locally and on devnet. It is a query-filtering service, not a trusted
execution environment. Locally you can verify the permission exists, that `is_private` is true, and that
`grant_reader` changes the member list. You cannot verify that a stranger is *refused* the body. The
confidentiality claim is only fully exercised against `https://devnet-tee.magicblock.app`.

### 33. Randomness is requested from the delegated queue only

`request_resolution_vrf` runs inside the rollup, so it must use the delegated queue
(`5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` on devnet,
`Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT` locally). There is no base-layer fallback path. The local
stack starts a second oracle against the base queue only because the stack script starts both; SINBAZAAR
does not use it.

### 34. The market and its secret must be delegated to the same validator

Both `delegate_market` and `delegate_secret` accept the same optional `validator` account, and the SDK's
`VALIDATOR` constant is commented "must host both the market and its secret." `finalize_market` reads
the secret and writes the market in a single ER transaction; if they landed on different validators that
instruction could not execute. Nothing in the program enforces it — it is a client responsibility.

### 35. Version pins

`anchor-lang` `=1.0.2` and `ephemeral-rollups-sdk` `0.16.2` on the Rust side; `@coral-xyz/anchor`
`0.32.1` and `@magicblock-labs/ephemeral-rollups-sdk` `0.17.0` on the TypeScript side. The Rust and TS
ER SDK versions are not the same line, which is how the `deserializePermission` mismatch in §23 became
visible. Pinned as a known-good snapshot for the hackathon, not as a recommendation.

---

## What we would do next, in order

1. Assign `read_rank` in `fund_bid`, or require `bid.funded` in `is_chosen_bid` (§5).
2. Add an explicit timed-out state out of `VrfPending` (§14).
3. Derive the VRF `caller_seed` from program state instead of taking it from the caller (§13).
4. Guard `seal_secret` against re-sealing once a bid has landed (§9).
5. Reject `ransom_floor == 0 && ransom_slope == 0` in `create_market` for Blackmail Escrow (§16).
6. Rename `NotVillageAuthority` on the `resolve_rumor` check, or move the check to the village
   authority and mean it (§17).
7. Swap the lamport escrow for SPL, following `magicblock-engine-examples/spl-tokens` (§1).
