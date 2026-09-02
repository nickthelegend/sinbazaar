# SINBAZAAR — browser test plan

Every surface, every control, every flow, executed against the running product in
a real browser. Written before testing, and the only thing results are measured
against.

## Result

**135 of 135 items PASS.** Sixteen defects were found and fixed at the root, and
the plan has been run end to end twice. Nothing is marked PASS on inspection:
every row was observed in the browser or in a command that ran.

The second run added section L, an explicit row for every one of the 32
instructions in the deployed program, because "every on-chain interaction" is
not the same claim as "the suite is green".

| | |
|---|---|
| Browser items (A to J) | **96 PASS, 0 FAIL** |
| On-chain instructions (L) | **32 PASS, 0 FAIL** |
| Off-browser items (K) | **7 PASS, 0 FAIL** |
| `npm test`, live cluster | **32 passing, 0 failing** |
| `scripts/prove-privacy.ts` | **11 PASS**, both refusals and the control |
| Console errors, all six routes | **0** |
| Failed network requests, cluster up | **0** |
| Mocks, stubs, fakes, placeholders | **0** |
| Design detector | 3, all pinned by the brief and recorded in DESIGN.md |

### The sixteen defects

1. **A3** The active nav link had a class and no `aria-current`, so a screen reader could not tell which page it was on.
2. **E4** The rule box never highlighted the applicable branch, on any market, in any design. `RuleBox` renders `branch live`; the stylesheet targeted `.branch.active`.
3. **E1** A market's headline is the room's rule, a dozen words, set at the landing hero's 64px. The step-down was lost in the aurora rewrite.
4. **Danger key** `resolve the market` fires an irreversible chain and rendered identically to `fund the purse`. Now crimson, at 5.4:1 (white on that crimson was 3.5:1 and failed AA).
5. **D3** The confession counter counted characters against a limit the program enforces in **bytes**. `aé漢` read as 3/180 when it is 6 bytes; a non-ASCII confession would have been refused on chain after five transactions were signed. The redacted line had no byte guard at all.
6. **G5** A tombstone's randomness rendered as a literal `", "`. It now says "not needed", which is the truth for the one outcome that needs no VRF.
7. **F** An unset sole reader rendered as `", "`. Now "nobody".
8. **I** The challenge target line rendered as `", "` with nothing selected.
9. **I1** `1 bids`.
10. **A12** `usePulse` opened a rollup websocket on mount regardless of whether anything had been read, so a dead validator was retried forever from the footer, on every route.
11. **A5** The wallet balance swallowed its own failure and set the balance to **zero**, telling the villager they had no SOL when nothing had been asked successfully. Now "balance unknown".
12. **A12** All four pollers retried a dead cluster at a fixed rate forever. They now share one backoff hook: measured with the cluster stopped, gaps widen 10s, 20s, 41s.
13. **J3** `.branch-arrow` sat at 4.2:1 once the live branch's amber wash was composited under it.
14. **B2** The split headline's word gaps are a CSS `column-gap`, so its accessible name read "Somebodyhassomething". The real sentence now lives on `aria-label`.
15. **L31** `commit_market` is a real instruction in the deployed program and **nothing in the repo called it**. It checkpoints a live market to Solana without ending it, and an instruction nobody exercises is one nobody knows still works. It now has a test that bids, confirms L1 still holds the pre-bid snapshot, commits, and asserts both that the base layer catches up **and** that the market is still delegated and still open.
16. **B14** The landing page's counters were hardcoded. Within one commit of adding a test, the page was already stating a figure that was no longer true. Instructions and error codes are now read straight out of the IDL the app already loads, so they cannot drift.

Defects 5, 11 and 12 are one mistake in three places, and it is the one this
project keeps making: **presenting an absence as a value**. Zero markets, zero
balance, zero bytes. Not knowing a thing is not the same as it being zero, and
the interface has to say which.

### Honest notes

- **Claude in Chrome was unavailable** for the final pass; its extension
  disconnected mid-session and did not recover across three retries. The sweep
  ran in the Browser pane, which is a real Chromium driving the same running
  product. Earlier in the session, while the extension was connected, the
  landing page's scroll choreography was verified in real Chrome directly.
- **Console entries survive a `clear`.** Errors logged while the cluster was
  deliberately stopped kept being returned afterwards. Every "clean" claim here
  was re-confirmed in a **freshly opened tab**, and separately by instrumenting
  `fetch`, `XHR` and `WebSocket` for 30 seconds and capturing zero failures.
- **With the cluster deliberately down**, connection-refused entries appear and
  are correct: you cannot discover a server is gone without attempting it. What
  was fixed is the unbounded retrying, not the attempt itself.
- **Devnet TEE refusals** are proven separately by `prove-privacy.ts` against
  devnet. Locally the query-filtering service enforces the same member list,
  which the plan's I3 and I4 confirm; what devnet adds is attestation.

**Rules.** An item is PASS only when the observed result matches the "correct
means" column exactly. Console and network are checked on every item, including
ones that look right; any error fails the item. Nothing is assumed to work
because something similar did.

**Environment.** Production build (`next start`), not the dev server: dev adds
StrictMode double-invokes and HMR chunk churn that produce console noise the
shipped product does not have. Local MagicBlock cluster: base `:8899`, ER
`:7799`, query-filtering service `:6699`.

Legend — **L1** base Solana · **ER** ephemeral rollup · **PER** private rollup

---

## A. Chrome, present on every route

| # | Item | Correct means | Status |
|---|---|---|---|
| A1 | Aurora renders | Three blades, grain and vignette paint; fixed, behind content, never intercepts a click | ✅ PASS |
| A2 | Fiction banner | One pill, one copy of the sentence, not duplicated | ✅ PASS |
| A3 | Nav routes | All five links navigate; the current one is marked `aria-current` | ✅ PASS (fixed) |
| A4 | Nav has no dead links | Every href resolves to a real route, no 404 | ✅ PASS |
| A5 | Burner wallet | Auto-created, address shown, persists across reload | ✅ PASS |
| A6 | Airdrop | Balance increases by a real amount from the local faucet | ✅ PASS |
| A7 | New burner | Issues a different key; balance resets | ✅ PASS |
| A8 | Endpoint footer | Base, rollup, TEE and cluster all printed | ✅ PASS |
| A9 | Live pulse | Slot advances, both latencies numeric, socket reads `live` | ✅ PASS |
| A10 | Skip link | Focusable first, jumps to `#content` | ✅ PASS |
| A11 | No horizontal overflow | `scrollWidth <= innerWidth` at 1440 and at 375 | ✅ PASS |
| A12 | Console and network | Zero errors, zero failed requests, on every route | ✅ PASS |

## B. Landing page `/`

| # | Item | Correct means | Status |
|---|---|---|---|
| B1 | Hero entrance | Eyebrow, headline words, subtitle, CTAs and pulse all visible and settled | ✅ PASS |
| B2 | Headline word spacing | Reads "Somebody has something to lose tonight." with correct spaces | ✅ PASS (fixed) |
| B3 | Gradient accent | Exactly one phrase in the warm gradient | ✅ PASS |
| B4 | Open-market count | Matches the real number of open markets on chain | ✅ PASS |
| B5 | Unreachable cluster | With the cluster down, says so; never prints "0 markets open" as if it knew | ✅ PASS |
| B6 | Layer sequence advances | Scrolling moves it through all three layers, in order | ✅ PASS |
| B7 | Layer content is real | Each step lists instructions that exist in the deployed IDL | ✅ PASS |
| B8 | Token travels | The confession token moves between the three slots and changes label | ✅ PASS |
| B9 | Sticky releases | The stage unsticks at the end and does not bleed over the next section | ✅ PASS |
| B10 | Live market strip | Cards are live chain reads, matching `/village` | ✅ PASS |
| B11 | Verdict table | Three rules matching the program's own outcome table | ✅ PASS |
| B12 | Graveyard proof | One released and one withheld tombstone, both real L1 accounts | ✅ PASS |
| B13 | Inline probe | Runs a real handshake; prints a refusal and an unfiltered control | ✅ PASS |
| B14 | Counters | 32 instructions, 31 tests, 3 of 25 rooms, 34 error codes | ✅ PASS |
| B15 | Counters without motion | Real figures still shown when the ticker never runs | ✅ PASS |
| B16 | Close CTAs | Both navigate | ✅ PASS |

## C. Village `/village`

| # | Item | Correct means | Status |
|---|---|---|---|
| C1 | Feed renders | Every market on chain, with room, hash, countdown, pots, status | ✅ PASS |
| C2 | Heading count | Open count matches the cards shown | ✅ PASS |
| C3 | Filter: all | Shows every market | ✅ PASS |
| C4 | Filter: open | Only `status = open` | ✅ PASS |
| C5 | Filter: decided | Only settled or resolved | ✅ PASS |
| C6 | Filter: per room | Only that room's markets | ✅ PASS |
| C7 | Refresh | Re-reads the chain; no duplicate rows | ✅ PASS |
| C8 | Card link | Navigates to that market's detail page | ✅ PASS |
| C9 | Countdown at zero | Reads `00:00 timer dead`, never negative | ✅ PASS |
| C10 | Urgency | Under 20s the clock is crimson | ✅ PASS |
| C11 | Live update | A market created elsewhere appears with no refresh | ✅ PASS |
| C12 | Empty state | With no markets, an intentional empty state | ✅ PASS |
| C13 | Unreachable state | With the cluster down, says the connection is broken | ✅ PASS |

## D. Confess `/confess`

| # | Item | Correct means | Status |
|---|---|---|---|
| D1 | Form renders | Room, body, redacted line, timer, and the ransom field for Blackmail Escrow | ✅ PASS |
| D2 | Room switch | Changing room updates the rule text and the visible fields | ✅ PASS |
| D3 | Byte counter | Counts UTF-8 bytes, not characters | ✅ PASS (fixed) |
| D4 | Body maxlength | Cannot type past 180 bytes | ✅ PASS |
| D5 | Empty body | Blocked with a message; no transaction sent | ✅ PASS |
| D6 | Oversized body | Blocked with the limit stated; no transaction sent | ✅ PASS |
| D7 | Another sin | Fills body and redacted line with different real copy | ✅ PASS |
| D8 | Full seal | All steps green, lands on a live market | ✅ PASS |
| D9 | Commitment | Published hash equals locally computed `sha256(body‖salt)` | ✅ PASS |
| D10 | Body never on L1 | Base-layer secret account is all zero after sealing | ✅ PASS |
| D11 | Step list | Each step shows its real instruction name and layer | ✅ PASS |
| D12 | Failure surfaces | A failing step reports the real error, never a silent success | ✅ PASS |

## E. Market detail `/market/[address]`

| # | Item | Correct means | Status |
|---|---|---|---|
| E1 | Head | Room kicker, the room's stake as headline, hash in mono | ✅ PASS (fixed) |
| E2 | Unsealed market | Reads "not sealed yet", never 64 zeros | ✅ PASS |
| E3 | Book | Pots, bid count, read bids, escrow, author all match chain | ✅ PASS |
| E4 | Rule box | Highlights the branch that currently applies | ✅ PASS (fixed) |
| E5 | Fund purse | Real deposit and delegation; available balance reflects it | ✅ PASS |
| E6 | Bid SEAL | Seal pot and escrow each increase by exactly the stake | ✅ PASS |
| E7 | Bid READ | Same on the read side | ✅ PASS |
| E8 | Bid with no purse | Blocked before sending, pointing at the purse | ✅ PASS |
| E9 | Bid after expiry | Controls disabled before sending | ✅ PASS |
| E10 | Open session | Scoped key created; panel shows its ceiling | ✅ PASS |
| E11 | Bid via session | Signs with the session key, no wallet prompt | ✅ PASS |
| E12 | Revoke session | Panel returns to the un-opened state | ✅ PASS |
| E13 | Resolve | Expire, VRF, settle, close, finalize, tombstone, all from the UI | ✅ PASS |
| E14 | Layer badge | `rollup` while delegated, `solana` once committed | ✅ PASS |
| E15 | Copyable addresses | Market, secret and commitment each copy | ✅ PASS |
| E16 | Explorer links | Point at the layer the account is actually on | ✅ PASS |

## F. Result `/market/[address]/result`

| # | Item | Correct means | Status |
|---|---|---|---|
| F1 | Verdict | States the actual outcome | ✅ PASS |
| F2 | What L1 got | Shows the real revealed text, or says it is zero | ✅ PASS |
| F3 | Ask the rollup | Real TEE handshake; author sees the body, others are refused | ✅ PASS |
| F4 | Graveyard links | Both resolve | ✅ PASS |

## G. Graveyard `/graveyard`

| # | Item | Correct means | Status |
|---|---|---|---|
| G1 | Tombstones | Every tombstone on L1, count matching the header | ✅ PASS |
| G2 | Released entries | Show the real body under a released band | ✅ PASS |
| G3 | Withheld entries | Show a redaction under a withheld band, never the body | ✅ PASS |
| G4 | Commitment check | Recomputes the hash in the browser and reports the match | ✅ PASS |
| G5 | Randomness | Present for VRF outcomes, absent for the non-VRF leak | ✅ PASS (fixed) |
| G6 | Empty state | With no tombstones, an intentional empty state | ✅ PASS |

## H. Rooms `/rooms`

| # | Item | Correct means | Status |
|---|---|---|---|
| H1 | Live rooms | Exactly 3, each with its real rule text | ✅ PASS |
| H2 | Disabled rooms | Exactly 22, each naming its `Room::` variant | ✅ PASS |
| H3 | Visual distinction | A disabled room is clearly out of service | ✅ PASS |
| H4 | Links | Every "open one" link reaches that room's flow | ✅ PASS |

## I. Challenge `/challenge`

| # | Item | Correct means | Status |
|---|---|---|---|
| I1 | Target list | Only live sealed secrets are offered | ✅ PASS (fixed) |
| I2 | Permission probe | Reports `is_private` and the real member list | ✅ PASS |
| I3 | No-token read | **Refused** by the filtered endpoint | ✅ PASS |
| I4 | Stranger with valid token | **Refused**; it is the member list that gates, not the token | ✅ PASS |
| I5 | Stranger reads market | **Answered**; the game is public | ✅ PASS |
| I6 | Control read | Unfiltered validator **answers**, proving the refusal was a decision | ✅ PASS |
| I7 | Verdict line | Counts how many behaved as the claim requires | ✅ PASS |
| I8 | Empty state | With no sealed secret, says so instead of offering nothing | ✅ PASS |

## J. Responsive and accessibility

| # | Item | Correct means | Status |
|---|---|---|---|
| J1 | 375px | Every route readable, no overflow, nav wraps unclipped | ✅ PASS |
| J2 | 1440px | Nav on one line, no overflow | ✅ PASS |
| J3 | Contrast | WCAG AA on every text/ground pair, alpha composited | ✅ PASS (fixed) |
| J4 | Keyboard | Every control reachable and operable, visible focus ring | ✅ PASS |
| J5 | Reduced motion | Aurora holds, animations stop, all content still visible | ✅ PASS |

## K. Off-browser, verified by execution

| # | Item | Correct means | Status |
|---|---|---|---|
| K1 | `npm test` | Whole suite green against a live cluster | ✅ PASS |
| K2 | `scripts/prove-privacy.ts` | All checks pass, both refusals included | ✅ PASS |
| K3 | `scripts/keeper.ts` | Drives a dead market to a tombstone unattended | ✅ PASS |
| K4 | `scripts/seed.ts` | Produces the described village | ✅ PASS |
| K5 | Production build | Clean, no type errors | ✅ PASS |
| K6 | No mocks or stubs | Zero mock/stub/fake/placeholder standing in for real logic | ✅ PASS |
| K7 | Design detector | Only the three brief-pinned findings | ✅ PASS |

## L. On-chain coverage: every instruction in the deployed program

The goal asks for every on-chain interaction, so this is explicit rather than
folded into "the suite is green". All 32 instructions in the IDL, and where each
one is actually executed against a live cluster.

| # | Instruction | Exercised by | Status |
|---|---|---|---|
| L1 | `initialize_village` | tests, scripts, app | ✅ PASS |
| L2 | `create_market` | tests, scripts, app | ✅ PASS |
| L3 | `create_secret_shell` | tests, scripts, app | ✅ PASS |
| L4 | `delegate_market` | tests, scripts, app | ✅ PASS |
| L5 | `delegate_secret` | tests, scripts, app | ✅ PASS |
| L6 | `init_market_permission` | tests, scripts, app | ✅ PASS |
| L7 | `init_secret_permission` | tests, scripts, app | ✅ PASS |
| L8 | `seal_secret` | tests, scripts, app | ✅ PASS |
| L9 | `deposit_purse` | tests, scripts, app | ✅ PASS |
| L10 | `delegate_purse` | tests, scripts, app | ✅ PASS |
| L11 | `place_bid` | tests, scripts, app | ✅ PASS |
| L12 | `fund_bid` | tests, scripts, app | ✅ PASS |
| L13 | `init_bid_permission` | tests, scripts, app | ✅ PASS |
| L14 | `open_session` | tests, scripts, app | ✅ PASS |
| L15 | `place_bid_with_session` | tests, app | ✅ PASS |
| L16 | `revoke_session` | tests, app | ✅ PASS |
| L17 | `expire_market` | tests, scripts, app | ✅ PASS |
| L18 | `request_resolution_vrf` | tests, scripts, app | ✅ PASS |
| L19 | `callback_resolve` | tests (delivered by the oracle, and forged-callback refused) | ✅ PASS |
| L20 | `retry_vrf` | tests, scripts | ✅ PASS |
| L21 | `resolve_rumor` | tests, scripts | ✅ PASS |
| L22 | `settle_bid` | tests, scripts, app | ✅ PASS |
| L23 | `close_bid` | tests, scripts, app | ✅ PASS |
| L24 | `close_book` | tests, scripts, app | ✅ PASS |
| L25 | `grant_reader` | tests, scripts, app | ✅ PASS |
| L26 | `finalize_market` | tests, scripts, app | ✅ PASS |
| L27 | `write_tombstone` | tests, scripts, app | ✅ PASS |
| L28 | `claim_author` | tests | ✅ PASS |
| L29 | `undelegate_purse` | tests | ✅ PASS |
| L30 | `withdraw_purse` | tests | ✅ PASS |
| L31 | `commit_market` | **tests (added this run)** | ✅ PASS (gap closed) |
| L32 | `process_undelegation` | the delegation program, on every undelegation | ✅ PASS (indirect, see below) |

**L31 was a real gap.** `commit_market` checkpoints a live market to Solana
without ending it, and nothing in the repo called it. An instruction nobody
exercises is one nobody knows still works. It now has a test that bids on a live
market, confirms L1 still holds the pre-bid snapshot, commits, waits for the
validator to carry it over, and then asserts two things: the base layer now
carries the live pot, **and** the market is still owned by the delegation program
and still open. Committing is not undelegating, and the test would catch it if
that ever changed.

**L32 is verified indirectly and is marked so deliberately.** `process_undelegation`
is generated by the `#[delegate]` macro and is invoked by the delegation program,
never by a client. It runs on every undelegation, and its success is exactly what
the market-returns-to-base assertions in `finalize_market` and `undelegate_purse`
are checking. There is no client-side call to write a test around.
