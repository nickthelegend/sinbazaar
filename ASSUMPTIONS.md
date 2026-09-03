# SINBAZAAR — Assumptions and judgment calls

Every decision on this page is a choice, not a fact about the world. Each entry says what we assumed,
why, what it costs, and where in the code to check it. If a judge disagrees with one of these, they
should be able to find the exact lines and argue with them.

Referenced files: `programs/sinbazaar/src/lib.rs`, `programs/sinbazaar/src/state.rs`,
`programs/sinbazaar/src/error.rs`, `sdk/src/index.ts`, `tests/harness.ts`,
`scripts/prove-privacy.ts`, `scripts/local-env.sh`.

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

### 4. Five error variants are reserved; `EscrowNotEmpty` no longer is

`SinError::EscrowNotEmpty` used to be defined and never thrown, and this entry used to say so. It is
now the last check in `close_book`: once `closed_bid_count == bid_count`, the only escrow left must be
what the author is owed, so the program requires `escrow_lamports == author_payout` before it will mark
a market `Settled`. That moves "the refunds add up" out of the class of things we reasoned about and
into the class of things a transaction fails on.

Five variants genuinely are still unused — `MissingBid`, `DuplicateBid`, `CommitmentMismatch`,
`VrfAlreadyRequested`, `VrfNotDelivered` — all leftovers from the earlier design where `resolve` walked
every bid through `remaining_accounts` in one transaction. They are annotated as reserved in
`error.rs` and kept rather than deleted: removing one renumbers every variant below it, and the IDL,
the SDK and every error code in a log would shift under anyone reading them. Called out here so nobody
mistakes them for live checks.

---

## Instruction splits, and the bug one of them hid

### 5. Two instructions, one transaction — enforced by the client, not the program

**Assumption.** `place_bid` creates and records the bid; `fund_bid` moves the money; the client always
sends both in a single atomic transaction (see `tests/harness.ts`, which builds one transaction from
`[open, fund]`).

**Why split them at all.** Not for tidiness — the runtime refuses the alternative. An instruction that
CPIs the magic program for an ephemeral account **and** moves lamports itself fails with
`UnbalancedInstruction`: "sum of account balances before and after instruction do not match." The magic
program settles the ephemeral account's rent outside this instruction's own accounting, so the
runtime's balance check sees the program's own transfer as unmatched and rejects the whole thing. We
found this by writing the single fused instruction first and watching every bid fail. The transaction
is still atomic, so a bid is opened and funded together or not at all — *when the client behaves*.

**What the program does instead.** It makes an unfunded bid harmless: `funded` starts `false`,
`fund_bid` is the only thing that touches a pot, and `settle_bid` computes a payout of `0` for any bid
where `!bid.funded`.

**The residual, stated honestly.** A hand-built transaction can call `place_bid` alone. That bid
consumes one of the eight `MAX_BIDDERS` slots — `bid_count` is incremented in `record_bid`, which the
bid instructions call and `fund_bid` does not.

It used to cost more than a slot, in two separate ways, and both are now closed.

`read_rank` was stamped in `place_bid` from a `read_bid_count` that only advanced in `fund_bid`, so an
unfunded READ bid took the rank the next funded READ bid would also take, and either could be named the
sole reader depending on settlement order. `read_rank` is now assigned in `fund_bid`, in the same breath
as the counter it is read from. An unfunded READ bid keeps its initial `u8::MAX`, which
`randomness % read_bid_count` can never equal.

`is_chosen_bid` is now gated on `bid.funded` and returns `false` before it looks at the outcome at all
(`lib.rs`, first lines of the function). A bid that never paid cannot be drawn as the sole reader and
cannot inherit a confession. That closes the reader-identity exposure this section used to describe.

**What survives.** One quirk, and it is a liveness quirk rather than a privacy one. The `Inherited`
branch draws `pick = randomness % market.bid_count`, and `bid_count` counts unfunded bids. If the draw
lands on the index of a bid that never paid, `is_chosen_bid` refuses it for being unfunded and refuses
every other bid for having the wrong index, so **nobody inherits**. The secret stays sealed and every
bid is refunded, which is a safe failure rather than a wrong one, but it is not the outcome the room
advertises. Drawing against a funded-bid counter instead of `bid_count` would close it. That is a
program change and a redeploy, and it is not in this build.

An unfunded bid also still consumes one of the eight `MAX_BIDDERS` slots, as described above.

### 6. `settle_bid` and `close_bid` are the same split, for the same reason

`settle_bid` moves the money and marks the bid settled. `close_bid` CPIs the magic program to close the
bid's permission and then the ephemeral bid account, refunding the sponsored rent to the market, and
increments `closed_bid_count`. Same `UnbalancedInstruction` rule as §5, same fix: one instruction does
the lamport arithmetic, the other does the magic-program CPI, and the client sends them in one
transaction (`settleAll` in `tests/harness.ts`).

**The residual is narrower here.** `close_bid` requires `bid.settled`, so the pair cannot run out of
order, and `close_book` refuses to mark a market `Settled` until `closed_bid_count == bid_count`. A
client that calls `settle_bid` without `close_bid` therefore does not strand money — it strands the
market, which anyone can then unstick by cranking the missing `close_bid`. Both are permissionless.

### 7. `place_bid` and `place_bid_with_session` are two instructions, not one with an optional account

The obvious design is a single `place_bid` with an optional `session` account: present when a session
key signs, absent when the wallet does. The ER does not allow it. A writable account that is not
delegated is rejected, and the session scope **must** be writable on the session path because the bid
is charged against `spent`. So the wallet-signed path must not carry that account at all, which in
Anchor means a second instruction with a second `Accounts` struct rather than an `Option`.

The duplication is real: both handlers run the same `check_biddable`, the same purse checks, and the
same `create_ephemeral_bid` + `record_bid`. That shared body is why the checks live in free functions
instead of being inlined twice. `place_bid` additionally requires `signer == bidder`; only the session
path lets a third key sign for a villager, and only after `charge_session` has held it to the scope its
owner consented to.

### 8. `finalize_market` had to flush Anchor's state before undelegating — a real bug, found late

**What broke.** `finalize_market` writes `market.revealed` and then `commit_and_undelegate`s the market
in the same instruction. `commit_and_undelegate` hands the account to the delegation program *inside*
that instruction, so by the time Anchor's automatic exit-serialization ran, it was writing to an account
the program no longer owned. The runtime rejected it: `ExternalAccountDataModified`.

**Why it hid.** The failure only occurs when the instruction actually dirtied the account — which is
exactly the two verdicts that publish text, `PublicLeak` and `RandomReveal`. Every other outcome zeroes
a buffer that is already zero. A passing `SoleReader` run therefore proves nothing about this path, and
that is how it stayed in the build: the confession loop we exercised most was the one that never
reveals anything.

**The fix.** `ctx.accounts.market.exit(&crate::ID)?` immediately before building the intent bundle —
flush our own writes while we still own the account, then hand it over. It is not a workaround; it is
the pattern `counter`, `session-keys` and `rock-paper-scissor` all use in magicblock-engine-examples
before a commit. We had read those examples and still missed it, because the one place it matters is
the one path a green test run does not touch.

---

## Privacy

### 9. The Secret is never undelegated, and that is the product

No instruction includes the `Secret` account in a `commit_and_undelegate` bundle. `finalize_market`
undelegates the **market only**, and reads the secret one last time on the way out.

**Consequence we accept.** A buried confession lives in the rollup and nowhere else. If that rollup's
state is discarded, the confession is gone — there is no L1 copy for any outcome except `PublicLeak`
and `RandomReveal`. We think that is the correct trade for a product whose entire promise is "this does
not end up on a public ledger," but it is a real durability trade and we are not going to describe an
Ephemeral-Rollup-resident secret as permanent storage.

### 10. The market's permission is public on purpose

`init_market_permission` passes `is_private: false`. The hash, the timer, the pots and the status *are*
the market — a game where nobody can see the order book is not a game. Only the body is private, and it
never lives on the `Market` account.

### 11. Whisper IPO's secret is public, and the same account does both jobs

`init_secret_permission` computes `is_private = market.room.is_confession_market()`, which is true for
`GuiltMarket` and `BlackmailEscrow` and false for `WhisperIpo`. We reused the `Secret` account to hold
the rumor headline rather than adding a fourth account type: in a rumor market the headline is meant to
be read and it is the *positions* that stay hidden, which the private per-bid permissions already
handle.

### 12. `seal_secret` can be called more than once

There is no "already sealed" guard. While `status == Open`, the author can call `seal_secret` again,
overwriting the body, the salt and the redaction, and rewriting `market.commitment_hash`. Anyone
watching sees the hash change, so it is detectable rather than silent — but a bidder who bid against
hash *X* can find themselves settled against hash *Y*. Treated as a product question (do you want an
author to be able to withdraw and rewrite before the first bid?) that we did not have time to answer
properly. In week 1 it is unguarded.

### 13. The commitment proves consistency, not honesty

`sha256(body || salt)` lets anyone verify a *revealed* body against what was sealed. For a `Buried`
market it proves nothing at all — the author may have sealed 180 bytes of noise. Deliberate: making the
content provable would require reading it, which would defeat the point.

### 14. `fiction_mode` is a declaration, not a control

`initialize_village` stores it on-chain and it defaults to on. The program cannot read the body, so it
cannot moderate the body. Content safety here is the seed data, the front end and the social contract.
`state.rs` says this in a comment; we are repeating it here so it is not read as a filter.

---

## Randomness and resolution

### 15. The VRF callback picks the outcome *class*; `settle_bid` picks the person

`callback_resolve` records `randomness`, sets the `Outcome`, and stops. The specific winner is derived
in `settle_bid` from `randomness % read_bid_count` (or `% bid_count` for `Inherited`).

**Why.** It keeps the callback's account list fixed at one account. The alternative — passing every bid
account into the callback via `accounts_metas` — makes the request's account list depend on how many
people bid, which is fragile and puts a `MAX_BIDDERS`-sized transaction on the oracle's critical path.
`bid.index` is stamped when the bid is opened and `bid.read_rank` when it is funded, precisely so that
any cranker derives the same winner without holding every bid account at once.

### 16. `client_seed` is caller-supplied and unvalidated

`request_resolution_vrf(market_id, client_seed: u8)` expands to `caller_seed: [client_seed; 32]`. The
instruction is effectively permissionless, so a determined caller can choose the seed. MagicBlock's VRF
guidance explicitly warns against user-controlled seed grinding where the result has economic value.
Mitigating factors in this build: the request moves `status` to `VrfPending` and the instruction
requires `Expired`, so a seed cannot simply be resubmitted until it pleases the caller, and the caller
cannot see the VRF keypair's output in advance.

That first mitigation is weaker than it was. `retry_vrf` (§17) returns a stalled market to `Expired`,
which by construction allows a fresh request with a fresh seed. It costs 120 seconds per attempt and
requires the previous request to have gone unanswered, so it is not a grinding oracle — but it is no
longer true that the seed is chosen exactly once. We did not add a program-derived seed. Named here
rather than glossed.

### 17. `retry_vrf` is a retry, not a timeout

A market whose callback never arrives used to sit in `VrfPending` forever with the escrow stuck behind
it; recovery was operational, not programmatic. `retry_vrf` fixes the stranding without inventing an
authority. It is permissionless, requires `status == VrfPending`, and only fires once
`now >= expires_at + VRF_GRACE_SECS` (120 seconds), at which point it puts the market back to
`Expired` — where anyone may request randomness again.

**The line we held.** It never decides an outcome. A stalled oracle must not be able to hand anyone a
verdict, and the grace period keeps a live request from being yanked out from under an oracle that is
merely slow.

**What it still is not.** It is not the explicit timed-out state the MagicBlock security guidance
recommends. If the oracle is down for good, the loop is request → wait → retry, indefinitely, and the
escrow stays put. Every alternative we sketched ended with *someone* deciding an outcome the randomness
was supposed to decide, so we shipped the honest half.

### 18. The zero-pot public leak needs no randomness

`expire_market` short-circuits: a confession market with `seal_pot == 0` **and** `read_pot == 0` goes
straight to `Outcome::PublicLeak` and `MarketStatus::Resolved`, skipping VRF entirely. It is a rule, not
a draw — nobody paid, so there is nothing to decide. (`callback_resolve` reaches the same conclusion for
`GuiltMarket` if it ever runs with both pots empty, so the two paths agree.)

### 19. The Blackmail Escrow ransom curve is linear and evaluated once

`ransom_due(now) = ransom_floor + ransom_slope * (now - created_at)`, evaluated at `resolved_at` inside
`callback_resolve`. A linear curve was chosen for legibility on a market card, not because it is the
right economic shape.

**A sharp edge.** The `Buried` branch requires `seal_pot >= due && due > 0`. A market created with
`ransom_floor = 0` and `ransom_slope = 0` therefore has `due == 0` and **can never be buried**, however
much SEAL money it attracts — it always falls through to the randomness branch. `create_market` does not
reject those parameters. If you seed a Blackmail Escrow market, give it a non-zero floor.

### 20. Whisper IPO settles by author attestation

`resolve_rumor` requires the signer to equal `market.author` and takes the result (`1` = YES, `2` = NO)
as an argument. There is no oracle and no proof the rumor was true.

**Why.** An oracle-resolved rumor market is a different project. The payout path reads
`market.rumor_result` and nothing else, so swapping in a real oracle is a change to one signature check.

**A naming wart, now fixed.** The error on that check used to be `SinError::NotVillageAuthority`, left
over from a design where the village authority resolved rumors — a message that would have misled
anyone reading a failed transaction, against a constraint that was correct. It is `SinError::NotAuthor`
now. `NotVillageAuthority` still exists in `error.rs` and is thrown nowhere; it stays only so the error
numbers below it do not move (§4).

**And a lock the room had to be protected from.** `request_resolution_vrf` now requires
`market.room.is_confession_market()`. Without it, anyone could push a Whisper IPO into `VrfPending`,
where `callback_resolve` rejects it as `WrongRoom` and `resolve_rumor` — which only accepts
`Open | Expired` — can no longer reach it. That was a permanent lock on any rumor market for the price
of one permissionless transaction; `retry_vrf` (§17) would now dig it out after two minutes, only for
the next caller to do it again. Found by asking what happens when the wrong room is fed to the right
instruction — a question worth asking of every permissionless crank on this list.

---

## Rooms and scope

### 21. Three rooms live, twenty-two enumerated and rejected

`Room::is_live()` matches `GuiltMarket | BlackmailEscrow | WhisperIpo`. `create_market` rejects
everything else with `RoomNotLive`.

**Why enumerate the rest at all.** The `Room` enum is the shape of the village. Typing the twenty-two
disabled rooms into the program (rather than into a slide) makes the scope claim checkable: a judge can
read `state.rs` and see exactly which rooms have a code path and which are cards in a UI.

### 22. MirrorConfession is deferred, even though the enum groups it with the live rooms

`state.rs` places `MirrorConfession` under the `// ---- live ----` comment, but `is_live()` does not
match it. That grouping is a leftover from when it was going to ship in week 1; the behaviour is
`RoomNotLive`, same as the Phase-7 block.

**Why it was cut.** Mirror Confession requires two authors, two secrets, and a permission update that is
only valid if *both* sides commit — a two-party atomic exchange across two private accounts. That is a
second state machine, not a variant of the first. Cutting it kept the resolution path to one shape.

The comment grouping is misleading and would be worth fixing; we did not touch it because other agents
are working in that file.

### 23. `Outcome` carries three variants nothing can produce

`ExportWinner`, `CurseHit` and `CurseMiss` are unreachable in week 1 — reserved for Phase-7 rooms. They
land in `compute_payout`'s fallback arm (`_ => bid.amount`), so if one were ever set, every bid would be
refunded. A safe default rather than a designed one.

---

## Sessions

### 24. SINBAZAAR implements its own session scope, not `gpl-session`

The `session-keys` example uses the `gpl_session` token program. We use a `SessionScope` PDA at
`[b"session", market, owner]`, created as an ephemeral account and validated by `charge_session` on the
`place_bid_with_session` path (§7).

**Why.** Everything we needed to bound — one market, a spend ceiling, an expiry, revocability — is
application policy, which the MagicBlock security guidance says the application must implement anyway.
Adding a second program to the CPI graph to then re-check all of it in our own program was not worth it
for a single-market bidding flow.

**Cost.** No cross-program session reuse: a SINBAZAAR session key is a SINBAZAAR session key. And the
scope is stored in an *ephemeral* account, so it exists only inside the rollup — which is where every
instruction that consults it runs.

### 25. Sessions are pinned to one market and cannot be widened

`SessionScope::is_valid` requires `scope.market == *market`, and `open_session` sets
`market: ctx.accounts.market.key()`, so a wildcard `Pubkey::default()` scope cannot be constructed
through the program. `charge_session` re-derives the session PDA from
`[SESSION_SEED, market, bidder]` and checks the account is owned by this program, so a caller cannot
substitute a session account from another market. `spent` is incremented and written back on every bid.

Deliberate: the wallet consents to a bounded thing, and the *program* is what holds it to that bound.

---

## Client SDK

### 26. The permission byte layout is parsed by hand

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

### 27. Three connections, and the auth token is a query parameter

`baseConnection()`, `erConnection()` and `teeConnection()` are separate on purpose — never reuse a base
blockhash for an ER transaction. `teeConnection()` obtains a JWT via `getAuthToken` (sign the
validator's challenge with `nacl.sign.detached`) and appends `?token=<jwt>` to **both** the HTTP URL and
the WebSocket URL. A header does not work. Any keypair can get a token; the token supplies the
*identity* the validator checks against the permission member list, not the authorisation itself.

### 28. `isRealTee()` is a substring check

```ts
export function isRealTee(url = ENDPOINTS.tee): boolean { return url.includes("tee"); }
```

Good enough to distinguish `https://devnet-tee.magicblock.app` from `http://localhost:6699` and drive a
UI warning. It is not a TEE attestation and must not be presented as one — verifying a TDX quote, and
checking its measurements against an expected workload allowlist, is a separate job this build does not
do.

### 29. The devnet TEE hostname — settled

The SDK defaults `TEE_PROVIDER_ENDPOINT` to `https://devnet-tee.magicblock.app`, while the MagicBlock
skill's resource table lists the devnet TEE region's FQDN as `devnet-tee-as.magicblock.app`. We did not
know which one resolved, so this entry was a warning.

It is answered now. `scripts/prove-privacy.ts` ran against `https://devnet-tee.magicblock.app`, with
the market and its secret delegated to validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, and
every check passed including the two refusals — see the README's
[Proven on devnet](README.md#proven-on-devnet). The endpoint set that run used is written into
`.env.devnet`, so nothing has to depend on an SDK default staying correct. Regions still go down;
`https://status.magicblock.app/api/services` remains the first thing to check before blaming the code.

---

## Sizes, caps and cranks

### 30. `MAX_BIDDERS = 8`, and it is eight *bidders*

The bid PDA is seeded `[b"bid", market, bidder]`, so one bidder can hold at most one bid per market and
the cap is eight distinct keys. The cap bounds the ER rent the market PDA must float — `create_market`
transfers `rent(EphemeralPermission::size_of(MAX_BIDDERS + 2)) + SPONSOR_FLOAT` (40,000,000 lamports)
up front — and it was originally set by a resolution design that walked every bid in one transaction.
That design is gone; the cap stayed because the sponsorship maths depends on it.

### 31. Fixed-size text, and a reveal buffer every market pays rent for

`MAX_BODY_LEN = 180`, `MAX_REDACTED_LEN = 96`, `MAX_TOMB_BODY = 180`. Fixed-size arrays, so a
three-word confession costs the same rent as a full one. `Market` carries a 180-byte `revealed` buffer
on **every** market, including the ones that will never reveal anything, because the buffer has to
exist on the account that gets committed to L1. A variable-length reveal account created only for
reveal outcomes would be cheaper; it would also be a fourth account and another delegation. We chose
the fixed buffer.

The 180-byte cap doubles as a product constraint: long enough for one sentence, too short for a dossier.

### 32. The author writes their own redaction

`RandomReveal` publishes `secret.redacted`, which the author supplied at `seal_secret`. The program does
not derive a redaction from the body and cannot check that the two are related. An author can supply a
redaction that says nothing. Accepted: the alternative is on-chain text processing over a secret the
program is not supposed to reason about.

### 33. `market_id` is caller-supplied; `market_count` is only a tally

`create_market(market_id, ...)` takes the id as an argument and seeds the PDA with it.
`village.market_count` is incremented but never used to derive an id. Clients pick ids (`tests/harness.ts`
counts up from a random start, `scripts/prove-privacy.ts` uses the clock); collisions fail on `init`.
Deliberate — it lets a client compute the market PDA before sending anything — but it does mean
"market #7" is not a meaningful thing to say.

### 34. Cranks are permissionless because absent authors are a real failure mode

`expire_market`, `retry_vrf`, `settle_bid`, `close_bid`, `close_book` and `write_tombstone` can be
called by anyone. A market must not be holdable-open by an author who closed their laptop, and a
bidder's refund must not depend on someone else showing up. It is safe because the destination and the
content are pinned by state: `settle_bid` can only pay the bidder's own purse, `close_bid` refunds rent
to the market that sponsored it, `retry_vrf` only moves a status backwards to a state that decides
nothing, and `write_tombstone` copies fields off the market.

The demo relies on this — the video has no time for anyone to click "resolve."

---

## Environment

### 35. The local stack is not a TEE, and we do not pretend otherwise

`scripts/local-env.sh` sets `TEE_PROVIDER_ENDPOINT=$QFS_ENDPOINT` (`http://localhost:6699`) so the
client code path is identical locally and on devnet. It is a query-filtering service, not a trusted
execution environment. Locally you can verify the permission exists, that `is_private` is true, and that
`grant_reader` changes the member list. You cannot verify that a stranger is *refused* the body —
`scripts/prove-privacy.ts` prints those two assertions as `N/A` rather than as passes, because a local
green run is not evidence of confidentiality and should never be shown as if it were.

The claim has been exercised where it can be. `prove-privacy.ts` ran against
`https://devnet-tee.magicblock.app` and both refusals passed: an unauthenticated rollup read, and a
stranger holding a *valid* TEE token who is turned away for not being on the member list rather than
for failing to authenticate. Output and explorer links are in the README's
[Proven on devnet](README.md#proven-on-devnet). What that still does not establish is attestation —
that the enclave is running the workload we think it is (§28).

### 36. Randomness is requested from the delegated queue only

`request_resolution_vrf` runs inside the rollup, so it must use the delegated queue
(`5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` on devnet,
`Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT` locally). There is no base-layer fallback path. The local
stack starts a second oracle against the base queue only because the stack script starts both; SINBAZAAR
does not use it.

### 37. The market and its secret must be delegated to the same validator

Both `delegate_market` and `delegate_secret` accept the same optional `validator` account, and the SDK's
`VALIDATOR` constant is commented "must host both the market and its secret." `finalize_market` reads
the secret and writes the market in a single ER transaction; if they landed on different validators that
instruction could not execute. Nothing in the program enforces it — it is a client responsibility.

### 38. Version pins

`anchor-lang` `=1.0.2` and `ephemeral-rollups-sdk` `0.16.2` on the Rust side; `@coral-xyz/anchor`
`0.32.1` and `@magicblock-labs/ephemeral-rollups-sdk` `0.17.0` on the TypeScript side. The Rust and TS
ER SDK versions are not the same line, which is how the `deserializePermission` mismatch in §26 became
visible. Pinned as a known-good snapshot for the hackathon, not as a recommendation.

---

## What we would do next, in order

Five things came off this list while the program was being finished: `read_rank` moved to `fund_bid`
(§5), `is_chosen_bid` is now gated on `bid.funded` so an unpaid bid cannot inherit a confession (§5),
`close_book` now enforces `escrow_lamports == author_payout` (§4), the `resolve_rumor` check throws
`NotAuthor` (§20), and `retry_vrf` unsticks a market whose randomness never arrived (§17).

What is left, in order. Each was re-checked against the program on the date of this edit:

1. Draw `Inherited` against a funded-bid counter rather than `bid_count`, so a draw cannot land on an
   unfunded bid and select nobody (§5).
2. Make `retry_vrf` a real timed-out state rather than an unbounded retry loop. It currently sets the
   status back to `Expired` with no attempt ceiling (`lib.rs`, `retry_vrf`) (§17).
3. Derive the VRF `caller_seed` from program state instead of taking it from the caller. It is still
   `caller_seed: [client_seed; 32]` (§16).
4. Guard `seal_secret` against re-sealing once a bid has landed (§12).
5. Reject `ransom_floor == 0 && ransom_slope == 0` in `create_market` for Blackmail Escrow (§19).
6. Verify a real TEE attestation quote against an expected measurement, instead of trusting a substring
   in a hostname (§28).
7. Swap the lamport escrow for SPL, following `magicblock-engine-examples/spl-tokens` (§1).
