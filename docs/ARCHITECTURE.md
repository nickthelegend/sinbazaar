# SINBAZAAR — Architecture

Reference for the program at `2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN`.
Everything on this page is transcribed from `programs/sinbazaar/src/lib.rs`,
`programs/sinbazaar/src/state.rs` and `target/idl/sinbazaar.json`. Where a number appears, it is the
number in the code.

Contents:
[Constants](#constants) ·
[Accounts](#accounts) ·
[State machine](#state-machine) ·
[Instructions by layer](#instructions-by-layer) ·
[Payouts](#payouts) ·
[Winner selection](#winner-selection) ·
[Trust model](#trust-model)

---

## Constants

| Constant | Value | Why |
|---|---|---|
| `MAX_BIDDERS` | `8` | Bounds the ER rent the market PDA has to sponsor, and bounded the original single-transaction resolution design. Enforced against `market.bid_count` in `place_bid`. |
| `MAX_BODY_LEN` | `180` | The confession body. Fixed-size array inside `Secret`. |
| `MAX_REDACTED_LEN` | `96` | The author-supplied single sentence — the most a `RandomReveal` ever publishes. |
| `MAX_TOMB_BODY` | `= MAX_BODY_LEN` (180) | Reveal buffer size on both `Market` and `Tombstone`. |
| `SPONSOR_FLOAT` | `40_000_000` lamports | Transferred author → market PDA at `create_market`, on top of `ephemeral_accounts::rent(EphemeralPermission::size_of(MAX_BIDDERS + 2))`. Pays for the market's own permission, the secret's permission, and one ephemeral account + permission per bidder. |

Seeds: `village`, `market`, `secret`, `bid`, `purse`, `session`, `tomb`.

---

## Accounts

"Delegated" means handed to the Delegation Program on L1 and cloned into the Ephemeral Rollup, where it
keeps its original program owner. "Ephemeral" means it is born in the ER and never settles to Solana.

| Account | Seeds | Lives on | Delegated? | Ephemeral permission |
|---|---|---|---|---|
| **Village** | `[b"village", authority]` | L1 only | Never | None |
| **Market** | `[b"market", village, market_id.to_le_bytes()]` | L1 → ER → L1 | Yes, by `delegate_market`; returns via `commit_and_undelegate` in `finalize_market` | **Public.** `is_private = false`, `members = [market.author]`. Created by `init_market_permission`. Hash, timer, pots and status are meant to be readable. |
| **Secret** | `[b"secret", market]` | L1 (empty) → ER (filled) | Yes, by `delegate_secret`. **Never undelegated.** | **Private for confession rooms.** `init_secret_permission` passes `is_private = market.room.is_confession_market()` — true for `GuiltMarket` and `BlackmailEscrow`, false for `WhisperIpo`. `members = [secret.author]`, becoming `[author, sole_reader]` after `grant_reader`. |
| **Bid** | `[b"bid", market, bidder]` | ER only | n/a — ephemeral account (`#[ephemeral_accounts]`, `eph`), sponsored by the market PDA | **Private.** `is_private = true`, `members = [bid.bidder]`. Created by `init_bid_permission`; closed by `settle_bid` before the bid account itself. |
| **Purse** | `[b"purse", owner]` | L1 → ER → L1 | Yes, by `delegate_purse`; returns via `undelegate_purse` (refuses while `locked != 0`) | **None.** The program creates no permission for a purse. |
| **SessionScope** | `[b"session", market, owner]` | ER only | n/a — ephemeral account, sponsored by the market PDA | **None.** |
| **Tombstone** | `[b"tomb", market]` | L1 only | Never | None. Written once by `write_tombstone`; never deleted. |

Notes that matter:

- **The `Secret` is allocated empty and delegated before a single byte is written.** `create_secret_shell`
  zeroes `salt`, `body`, `redacted` on L1. `delegate_secret` hands it over. `seal_secret` — ER-only —
  writes the body and sets `market.commitment_hash = sha256(body || salt)`. There is no base-layer
  transaction anywhere in that sequence that carries plaintext.
- **One bid per bidder per market.** The bid PDA is seeded by the bidder, so `MAX_BIDDERS` is eight
  distinct keys, not eight bids.
- **The market PDA is the escrow.** Funded bids move lamports into it (`fund_bid`), settlements move
  them back out (`settle_bid`), and `market.escrow_lamports` tracks the bidder-owned portion separately
  from the account's rent and `SPONSOR_FLOAT`.
- **The market and its secret must be on the same ER validator.** `finalize_market` reads the secret
  and writes the market in one ER transaction. Both `delegate_market` and `delegate_secret` take the
  same optional `validator` account.

---

## State machine

`MarketStatus` has five states. `Outcome` starts at `Pending` and is written once.

```
                                create_market
                                      |
                                      v
                                 [ Open ]  <-- place_bid + fund_bid, seal_secret,
                                      |         open_session / revoke_session
                                      |
                    expire_market  (permissionless, requires now >= expires_at)
                                      |
              +-----------------------+------------------------------+
              |                                                      |
   confession room AND                                       everything else
   seal_pot == 0 AND read_pot == 0                                   |
              |                                                      v
              v                                               [ Expired ]
      outcome = PublicLeak                                            |
      status  = Resolved  ------------------+          request_resolution_vrf
      (no randomness needed)                |                        |
                                            |                        v
                                            |                 [ VrfPending ]
                                            |                        |
                                            |     callback_resolve   |  <-- signed by the VRF
                                            |     (MagicBlock VRF)   |      program identity PDA
                                            |                        |
                                            +------------------------+
                                                         |
                                                         v
                                                   [ Resolved ]
                                                         |
                                  settle_bid  x bid_count  (permissionless)
                                                         |
                                       close_book  (closed_bid_count == bid_count)
                                                         |
                                                         v
                                                   [ Settled ]
                                                         |
                     grant_reader (only if outcome is SoleReader | Inherited)
                                                         |
                            finalize_market  -> fills market.revealed IF AND ONLY IF
                                                outcome.reveals_text(), then
                                                commit_and_undelegate(market)
                                                         |
                                                         v
                                         ===== back on SOLANA L1 =====
                                                         |
                                    write_tombstone   (requires Settled, !tombstoned)
                                    claim_author      (requires Settled, author_payout > 0)
```

**Whisper IPO takes the side door.** `resolve_rumor` accepts status `Open` **or** `Expired` and jumps
straight to `Resolved` with `Forgiven` (result 1) or `Slashed` (result 2). `callback_resolve` explicitly
returns `WrongRoom` for any room that is not `GuiltMarket` or `BlackmailEscrow`, so a rumor market can
never be resolved by randomness.

**Outcome selection in `callback_resolve`:**

```rust
Room::GuiltMarket => {
    if market.seal_pot > 0        { Outcome::Buried }
    else if market.read_pot > 0   { Outcome::SoleReader }
    else                          { Outcome::PublicLeak }
}
Room::BlackmailEscrow => {
    let due = market.ransom_due(market.resolved_at);   // ransom_floor + ransom_slope * elapsed
    if market.seal_pot >= due && due > 0                     { Outcome::Buried }
    else if vrf_sdk::rnd::random_bool(&randomness)           { Outcome::RandomReveal }
    else if market.read_bid_count > 0 || market.bid_count > 0 { Outcome::Inherited }
    else                                                      { Outcome::PublicLeak }
}
_ => return err!(SinError::WrongRoom),
```

**The reveal gate**, `finalize_market`:

| Outcome | What is copied into `market.revealed` |
|---|---|
| `PublicLeak` | `secret.body[..body_len]` — the whole confession |
| `RandomReveal` | `secret.redacted[..redacted_len]` — the author's own single sentence |
| everything else | nothing; `revealed` is zeroed and `revealed_len = 0` |

`write_tombstone` then repeats the check as defense in depth: `if market.outcome.reveals_text()` copy,
`else` write zeros. `Outcome::reveals_text()` is `matches!(self, PublicLeak | RandomReveal)`.

---

## Instructions by layer

28 program instructions. (`process_undelegation` also appears in the IDL — it is injected by
`#[ephemeral]`, not hand-written.)

**Base layer (Solana L1)** — `initialize_village`, `create_market`, `create_secret_shell`,
`delegate_market`, `delegate_secret`, `deposit_purse`, `delegate_purse`, `withdraw_purse`,
`write_tombstone`, `claim_author`.

**Ephemeral Rollup — permissions** — `init_market_permission`, `init_secret_permission`, `seal_secret`,
`grant_reader`.

**Ephemeral Rollup — sessions and bidding** — `open_session`, `revoke_session`, `place_bid`, `fund_bid`,
`init_bid_permission`.

**Ephemeral Rollup — expiry, randomness, resolution** — `expire_market`, `request_resolution_vrf`,
`callback_resolve`, `resolve_rumor`, `settle_bid`, `close_book`, `finalize_market`, `commit_market`,
`undelegate_purse`.

**Permissionless cranks** (anyone may call; the destination or the content is pinned by state):
`expire_market`, `settle_bid` (funds only ever move to the bidder's own purse), `close_book`,
`write_tombstone` (content fixed by market state).

**Bidding is two instructions in one transaction.** `place_bid` creates and records the bid; `fund_bid`
moves the lamports `purse -> market`. They are split because creating an ephemeral account is a CPI to
the magic program, and keeping the program's own lamport arithmetic in its own instruction makes each
instruction's balance change trivially auditable. The client sends them in a single atomic transaction.
An unfunded bid stays `funded = false`, contributes to no pot, and settles for zero.

---

## Payouts

Transcribed from `compute_payout(market, bid)` in `lib.rs`. `settle_bid` calls it **only when
`bid.funded` is true**; an unfunded bid's payout is `0` without consulting this table.

| `market.outcome` | `bid.side` | Payout |
|---|---|---|
| **Buried** | `Seal` | `0` |
| **Buried** | `Read` / `Yes` / `No` | `bid.amount` |
| **SoleReader** | `Read` **and** this is the chosen bid | `0` |
| **SoleReader** | any other case | `bid.amount` |
| **RandomReveal** | `Seal` | `bid.amount` |
| **RandomReveal** | `Read` / `Yes` / `No` | `0` |
| **Inherited** | `Seal` | `bid.amount` |
| **Inherited** | `Read` / `Yes` / `No` | `0` |
| **PublicLeak** | any | `bid.amount` |
| **Forgiven** (`win_side = Yes`, `win_pot = yes_pot`, `lose_pot = no_pot`) | — | see the prediction formula below |
| **Slashed** (`win_side = No`, `win_pot = no_pot`, `lose_pot = yes_pot`) | — | see the prediction formula below |
| **Cancelled** | any | `bid.amount` |
| `Pending`, `ExportWinner`, `CurseHit`, `CurseMiss` (fallback arm `_`) | any | `bid.amount` |

**Prediction formula** (`Forgiven` / `Slashed`), computed in `u128` then narrowed:

```
if win_pot == 0            ->  bid.amount                                  // no counterparty: refund all
else if bid.side == win_side ->  bid.amount + (bid.amount * lose_pot) / win_pot
else                        ->  0
```

**What happens to the difference.** In `settle_bid`:

```
staked    = bid.funded ? bid.amount : 0
forfeited = staked - min(payout, staked)
```

`forfeited` is added to `market.author_payout`, `payout` is moved market → purse and added to
`purse.available`, `purse.locked` is reduced by `staked`, and `market.escrow_lamports` is reduced by
`payout`. The author later claims `author_payout` on L1 with `claim_author`, which requires
`status == Settled`.

**Read this as a rule of the bazaar, one room at a time:**

| Room | Outcome | Who pays whom |
|---|---|---|
| GuiltMarket | `Buried` | Seal bidders bought the silence and lose their stakes to the author. Read bidders are made whole. |
| GuiltMarket | `SoleReader` | The one VRF-chosen reader pays for the privilege (payout 0 → forfeited to the author). Every other Read bidder is refunded. |
| GuiltMarket / BlackmailEscrow | `PublicLeak` | Nobody paid, so there is nothing to settle. Everyone is refunded. |
| BlackmailEscrow | `Buried` | The ransom was met. Seal money goes to the author. |
| BlackmailEscrow | `RandomReveal` | The ransom failed, so Seal money is returned — it bought nothing. Read money bought the outcome and stays with the author. |
| BlackmailEscrow | `Inherited` | Same split as `RandomReveal`; the body goes to one random bidder instead of to L1. |
| WhisperIpo | `Forgiven` / `Slashed` | Winners take their stake plus a pro-rata slice of the losing book. Losers take nothing, which becomes `author_payout`. With no counterparty on the winning side, everyone is refunded. |

---

## Winner selection

`callback_resolve` records the randomness and picks the outcome *class*. It does **not** name the
winner — that keeps its account list fixed at one account. The specific villager is derived
deterministically in `settle_bid` via `is_chosen_bid`, so every cranker computes the same answer:

```rust
Outcome::SoleReader => {
    if market.read_bid_count == 0 || bid.side != BidSide::Read { return false; }
    let pick = (market.randomness % market.read_bid_count as u64) as u8;
    bid.read_rank == pick
}
Outcome::Inherited => {
    if market.bid_count == 0 { return false; }
    let pick = (market.randomness % market.bid_count as u64) as u8;
    bid.index == pick
}
_ => false,
```

`market.randomness` is `vrf_sdk::rnd::random_u64(&randomness)` over the 32 bytes the oracle delivered,
kept on the market and copied to the tombstone so the draw is auditable after the fact.

`bid.index` is assigned in `place_bid` from `market.bid_count` (arrival order across all bids).
`bid.read_rank` is assigned in `place_bid` from `market.read_bid_count`, and is `u8::MAX` for non-READ
bids. Note that `read_bid_count` is incremented in **`fund_bid`**, not `place_bid` — see
[ASSUMPTIONS.md](../ASSUMPTIONS.md) for what that means when the two are not sent together.

When `settle_bid` finds the chosen bid it writes `market.sole_reader = bid.bidder`. `grant_reader` then
refuses to run unless the outcome is `SoleReader` or `Inherited` **and** `sole_reader != Pubkey::default()`,
and rewrites the secret's permission to `is_private: true, members: [author, sole_reader]`.

---

## Trust model

These are different kinds of claim and they must not be blurred.

### What MagicBlock guarantees (protocol)

- **Delegation.** While an account is delegated, the base-layer account is locked under the Delegation
  Program and its ER clone keeps the original program owner. That is what lets `fund_bid` move lamports
  between two SINBAZAAR-owned PDAs inside the rollup. Delegation is a *routing and lifecycle* fact, not
  an authorization boundary.
- **Ephemeral permissions.** The permission program stores `is_private` and a member list against an
  account. A validator serving a private account refuses reads from identities not on that list. The
  client authenticates with the documented signed-challenge flow and carries the resulting token as a
  `?token=` query parameter.
- **TEE.** On the TEE-backed devnet region, the validator runs inside a trusted execution environment,
  so the operator is not trivially able to read private ER state. Attestation verifies a genuine quote
  bound to a challenge; it does not by itself prove *which* workload is running unless you separately
  check the measurements against an allowlist. SINBAZAAR does not perform that allowlist check.
- **VRF.** `#[vrf_callback]` injects a `vrf_program_identity` signer constrained to
  `scoped_vrf_identity(&crate::ID)` — a PDA only the VRF program can sign for. A successful request is
  not fulfillment; the outcome exists only after the callback lands.
- **Ephemeral accounts.** ER-only lifecycle with a declared sponsor paying rent, and an ER-side
  guarantee that the account must sign its own creation (via its `eph` seeds) so addresses cannot be
  squatted.
- **`commit` / `commit_and_undelegate`.** The magic program carries committed state back to Solana.

### What SINBAZAAR's own program enforces (application)

None of these come from MagicBlock. They are `require!`s in `lib.rs`.

- **The body is never in an L1 transaction.** Enforced structurally: `create_secret_shell` writes zeros,
  `seal_secret` is only reachable on the ER, and the secret is delegated in between.
- **Plaintext reaches L1 only when the verdict authorised it.** `finalize_market` gates the copy on
  `outcome.reveals_text()`, and `write_tombstone` re-checks the same predicate before copying — two
  independent checks in two different runtimes.
- **The secret is never undelegated.** No instruction includes the `Secret` in a
  `commit_and_undelegate` bundle.
- **Who may become the reader.** `grant_reader` requires outcome ∈ {`SoleReader`, `Inherited`} and a
  non-default `sole_reader`, and the winner index is derived from the recorded randomness, not chosen
  by a caller.
- **Session scope.** `authorise_bidder` re-derives the session PDA from
  `[b"session", market, bidder]`, checks the account is owned by this program and non-empty, then
  validates `!revoked`, `session_key == signer`, `market == this market`, `now < expires_at`, and
  `spent + amount <= max_spend` — writing `spent` back. The client cannot widen its own scope.
- **Bid legality.** Side must match the room (`Yes`/`No` only in `WhisperIpo`, `Seal`/`Read`
  everywhere else), `amount > 0`, market `Open` and `now < expires_at`, `bid_count < MAX_BIDDERS`, and
  the purse must be the bidder's own with sufficient `available`.
- **Settlement completeness.** `close_book` refuses to mark a market `Settled` until
  `closed_bid_count == bid_count`, which in turn gates `finalize_market`. Escrow cannot be stranded by
  undelegating early. (This is the `sealed-auction` example's cleanup gate.)
- **Purse safety.** `withdraw_purse` and `undelegate_purse` both refuse while `locked != 0`.
- **Arithmetic.** Every pot, payout and balance mutation uses `checked_*` or `saturating_*`.

### What nothing guarantees

Say these out loud rather than let a judge discover them.

- **The author already knows the secret.** Privacy protects it from everyone else, not from its author,
  who can publish it anywhere at any time.
- **A granted reader can copy the text.** Once a key is on the member list, the plaintext is in that
  person's client. No permission change takes it back.
- **Outside a real TEE, the validator operator can read ER state.** That is exactly the situation on the
  local stack, where `TEE_PROVIDER_ENDPOINT` points at a query-filtering service on `localhost:6699`.
  The privacy assertion is only fully exercised against `https://devnet-tee.magicblock.app`.
- **The commitment hash proves consistency, not honesty.** It lets anyone verify that a revealed body
  matches what was sealed. For a `Buried` market, where nothing is ever revealed, it proves nothing
  about the content at all.
- **Whisper IPO's result is an attestation.** `resolve_rumor` trusts `market.author`'s signature and
  takes the result as an argument. There is no oracle and no proof.
- **`fiction_mode` is a label, not a filter.** The program cannot inspect the body — that is the whole
  design — so it cannot moderate it.
- **Late or missing VRF.** The market sits in `VrfPending` until a callback arrives. There is no
  timeout path in the program; recovery is operational.
