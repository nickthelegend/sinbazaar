# SINBAZAAR — browser test plan

Every surface, every control, every flow, executed against the running product in
a real browser. Written before testing, and the only thing results are measured
against.

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
| A1 | Aurora renders | Three blades, grain and vignette paint; fixed, behind content, never intercepts a click | |
| A2 | Fiction banner | One pill, one copy of the sentence, not duplicated | |
| A3 | Nav routes | All five links navigate; the current one is marked `aria-current` | |
| A4 | Nav has no dead links | Every href resolves to a real route, no 404 | |
| A5 | Burner wallet | Auto-created, address shown, persists across reload | |
| A6 | Airdrop | Balance increases by a real amount from the local faucet | |
| A7 | New burner | Issues a different key; balance resets | |
| A8 | Endpoint footer | Base, rollup, TEE and cluster all printed | |
| A9 | Live pulse | Slot advances, both latencies numeric, socket reads `live` | |
| A10 | Skip link | Focusable first, jumps to `#content` | |
| A11 | No horizontal overflow | `scrollWidth <= innerWidth` at 1440 and at 375 | |
| A12 | Console and network | Zero errors, zero failed requests, on every route | |

## B. Landing page `/`

| # | Item | Correct means | Status |
|---|---|---|---|
| B1 | Hero entrance | Eyebrow, headline words, subtitle, CTAs and pulse all visible and settled | |
| B2 | Headline word spacing | Reads "Somebody has something to lose tonight." with correct spaces | |
| B3 | Gradient accent | Exactly one phrase in the warm gradient | |
| B4 | Open-market count | Matches the real number of open markets on chain | |
| B5 | Unreachable cluster | With the cluster down, says so; never prints "0 markets open" as if it knew | |
| B6 | Layer sequence advances | Scrolling moves it through all three layers, in order | |
| B7 | Layer content is real | Each step lists instructions that exist in the deployed IDL | |
| B8 | Token travels | The confession token moves between the three slots and changes label | |
| B9 | Sticky releases | The stage unsticks at the end and does not bleed over the next section | |
| B10 | Live market strip | Cards are live chain reads, matching `/village` | |
| B11 | Verdict table | Three rules matching the program's own outcome table | |
| B12 | Graveyard proof | One released and one withheld tombstone, both real L1 accounts | |
| B13 | Inline probe | Runs a real handshake; prints a refusal and an unfiltered control | |
| B14 | Counters | 32 instructions, 31 tests, 3 of 25 rooms, 34 error codes | |
| B15 | Counters without motion | Real figures still shown when the ticker never runs | |
| B16 | Close CTAs | Both navigate | |

## C. Village `/village`

| # | Item | Correct means | Status |
|---|---|---|---|
| C1 | Feed renders | Every market on chain, with room, hash, countdown, pots, status | |
| C2 | Heading count | Open count matches the cards shown | |
| C3 | Filter: all | Shows every market | |
| C4 | Filter: open | Only `status = open` | |
| C5 | Filter: decided | Only settled or resolved | |
| C6 | Filter: per room | Only that room's markets | |
| C7 | Refresh | Re-reads the chain; no duplicate rows | |
| C8 | Card link | Navigates to that market's detail page | |
| C9 | Countdown at zero | Reads `00:00 timer dead`, never negative | |
| C10 | Urgency | Under 20s the clock is crimson | |
| C11 | Live update | A market created elsewhere appears with no refresh | |
| C12 | Empty state | With no markets, an intentional empty state | |
| C13 | Unreachable state | With the cluster down, says the connection is broken | |

## D. Confess `/confess`

| # | Item | Correct means | Status |
|---|---|---|---|
| D1 | Form renders | Room, body, redacted line, timer, and the ransom field for Blackmail Escrow | |
| D2 | Room switch | Changing room updates the rule text and the visible fields | |
| D3 | Byte counter | Counts UTF-8 bytes, not characters | |
| D4 | Body maxlength | Cannot type past 180 bytes | |
| D5 | Empty body | Blocked with a message; no transaction sent | |
| D6 | Oversized body | Blocked with the limit stated; no transaction sent | |
| D7 | Another sin | Fills body and redacted line with different real copy | |
| D8 | Full seal | All steps green, lands on a live market | |
| D9 | Commitment | Published hash equals locally computed `sha256(body‖salt)` | |
| D10 | Body never on L1 | Base-layer secret account is all zero after sealing | |
| D11 | Step list | Each step shows its real instruction name and layer | |
| D12 | Failure surfaces | A failing step reports the real error, never a silent success | |

## E. Market detail `/market/[address]`

| # | Item | Correct means | Status |
|---|---|---|---|
| E1 | Head | Room kicker, the room's stake as headline, hash in mono | |
| E2 | Unsealed market | Reads "not sealed yet", never 64 zeros | |
| E3 | Book | Pots, bid count, read bids, escrow, author all match chain | |
| E4 | Rule box | Highlights the branch that currently applies | |
| E5 | Fund purse | Real deposit and delegation; available balance reflects it | |
| E6 | Bid SEAL | Seal pot and escrow each increase by exactly the stake | |
| E7 | Bid READ | Same on the read side | |
| E8 | Bid with no purse | Blocked before sending, pointing at the purse | |
| E9 | Bid after expiry | Controls disabled before sending | |
| E10 | Open session | Scoped key created; panel shows its ceiling | |
| E11 | Bid via session | Signs with the session key, no wallet prompt | |
| E12 | Revoke session | Panel returns to the un-opened state | |
| E13 | Resolve | Expire, VRF, settle, close, finalize, tombstone, all from the UI | |
| E14 | Layer badge | `rollup` while delegated, `solana` once committed | |
| E15 | Copyable addresses | Market, secret and commitment each copy | |
| E16 | Explorer links | Point at the layer the account is actually on | |

## F. Result `/market/[address]/result`

| # | Item | Correct means | Status |
|---|---|---|---|
| F1 | Verdict | States the actual outcome | |
| F2 | What L1 got | Shows the real revealed text, or says it is zero | |
| F3 | Ask the rollup | Real TEE handshake; author sees the body, others are refused | |
| F4 | Graveyard links | Both resolve | |

## G. Graveyard `/graveyard`

| # | Item | Correct means | Status |
|---|---|---|---|
| G1 | Tombstones | Every tombstone on L1, count matching the header | |
| G2 | Released entries | Show the real body under a released band | |
| G3 | Withheld entries | Show a redaction under a withheld band, never the body | |
| G4 | Commitment check | Recomputes the hash in the browser and reports the match | |
| G5 | Randomness | Present for VRF outcomes, absent for the non-VRF leak | |
| G6 | Empty state | With no tombstones, an intentional empty state | |

## H. Rooms `/rooms`

| # | Item | Correct means | Status |
|---|---|---|---|
| H1 | Live rooms | Exactly 3, each with its real rule text | |
| H2 | Disabled rooms | Exactly 22, each naming its `Room::` variant | |
| H3 | Visual distinction | A disabled room is clearly out of service | |
| H4 | Links | Every "open one" link reaches that room's flow | |

## I. Challenge `/challenge`

| # | Item | Correct means | Status |
|---|---|---|---|
| I1 | Target list | Only live sealed secrets are offered | |
| I2 | Permission probe | Reports `is_private` and the real member list | |
| I3 | No-token read | **Refused** by the filtered endpoint | |
| I4 | Stranger with valid token | **Refused**; it is the member list that gates, not the token | |
| I5 | Stranger reads market | **Answered**; the game is public | |
| I6 | Control read | Unfiltered validator **answers**, proving the refusal was a decision | |
| I7 | Verdict line | Counts how many behaved as the claim requires | |
| I8 | Empty state | With no sealed secret, says so instead of offering nothing | |

## J. Responsive and accessibility

| # | Item | Correct means | Status |
|---|---|---|---|
| J1 | 375px | Every route readable, no overflow, nav wraps unclipped | |
| J2 | 1440px | Nav on one line, no overflow | |
| J3 | Contrast | WCAG AA on every text/ground pair, alpha composited | |
| J4 | Keyboard | Every control reachable and operable, visible focus ring | |
| J5 | Reduced motion | Aurora holds, animations stop, all content still visible | |

## K. Off-browser, verified by execution

| # | Item | Correct means | Status |
|---|---|---|---|
| K1 | `npm test` | Whole suite green against a live cluster | |
| K2 | `scripts/prove-privacy.ts` | All checks pass, both refusals included | |
| K3 | `scripts/keeper.ts` | Drives a dead market to a tombstone unattended | |
| K4 | `scripts/seed.ts` | Produces the described village | |
| K5 | Production build | Clean, no type errors | |
| K6 | No mocks or stubs | Zero mock/stub/fake/placeholder standing in for real logic | |
| K7 | Design detector | Only the three brief-pinned findings | |
