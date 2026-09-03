# SINBAZAAR — browser test plan II

Written before any testing in this run. `docs/BROWSER-TEST-PLAN.md` is the
previous pass (135 items, all PASS); since it was written the app gained nine
features and the program gained three instructions, so this plan is rewritten
from the current surface rather than amended.

**Method.** Every item is executed in **Claude in Chrome** against the running
app, not read from source. Console and network are checked on every item, not
only failing-looking ones. An item passes only when the observed result matches
the stated expectation exactly.

**The standard.** "Correct" below is a specific observable outcome. "The button
did something" is a FAIL. A visible console error or a failed network request
anywhere in an item is a FAIL for that item regardless of what the UI shows.

**Surface under test**
- 8 routes plus `not-found` and `error`
- 16 components
- 35 program instructions, 6 accounts, 35 error codes
- 3 layers: base `:8899`, ephemeral rollup `:7799`, TEE/QFS `:6699`

---

## A. Shell and chrome

| # | Item | Correct means | Result |
|---|---|---|---|
| A1 | Fiction-mode banner | Renders above the nav on every route, exact text "Fiction mode, startup village sins only." plus the satire line | ✅ PASS |
| A2 | Floating nav pill | Five links (Village, Confess, Rooms, Graveyard, Challenge) plus the wordmark; a translucent pill, not a full-bleed bar | ✅ PASS — `.topnav` is a 999px, 16px-blur glass pill at 1140px in a 1425px viewport |
| A3 | Active route marked | The current route's link carries the active treatment and no other link does | ✅ PASS — only "Village" active on /village |
| A4 | Nav at 375px | Nav stacks into its own rows; no link is clipped; no horizontal overflow | ✅ PASS — 375px, overflow 0, no clipped link, nav in 2 rows |
| A5 | Wallet mode toggle | Two chips, burner and wallet; exactly one is `on`; clicking switches which | ✅ PASS |
| A6 | Burner key created | On localnet a burner exists on first load; the readout shows a real shortened base58 key, never `…` | ✅ PASS — real key, never `…` |
| A7 | Airdrop | Clicking airdrop raises the displayed balance to a real on-chain figure within 10s | ✅ PASS — balance rose to a real on-chain figure |
| A8 | New burner | Clicking `new` produces a *different* key and a balance of 0.00 until airdropped | ✅ PASS **after fix** — showed the *previous* key's 34.94 SOL on a fresh empty burner; now reads "balance unknown" instantly, then resolves |
| A9 | Pulse row | rollup ms, base ms, slot and socket all show real values; slot increases over 10s | ✅ PASS — slot advanced 172,938 → 173,132 |
| A10 | Pulse when a layer is down | A dead endpoint reads "unreachable", never `0 ms` | ⏳ deferred to the controlled outage window with J3/J4 |
| A11 | Skip-to-content | A skip link is the first focusable element and moves focus to main | ✅ PASS |
| A12 | Wordmark to home | Clicking the wordmark navigates to `/` | ✅ PASS — wordmark href `/` |

## B. Landing page `/`

| # | Item | Correct means | Result |
|---|---|---|---|
| B1 | Hero renders | H1 visible with exactly one `.flare` gradient word; subtitle present | ✅ PASS — one `.flare` word ("to lose") |
| B2 | Hero after motion | Content is visible with animations disabled; nothing stuck at opacity 0 | ✅ PASS |
| B3 | Keycap + ghost CTAs | "Write a confession" links `/confess`; "Watch the village" links `/village` | ✅ PASS — both CTAs point correctly |
| B4 | Pulse row on landing | Four live figures, same rules as A9 | ✅ PASS |
| B5 | Activity strip: subscribed | Header reads "rollup activity" + "subscribed" when the rollup is reachable | ✅ PASS |
| B6 | Activity strip: waiting | With no traffic since load, shows the waiting sentence, **never "0 transactions"** | ✅ PASS — waiting copy, never "0 transactions" |
| B7 | Activity strip: flowing | Real ER traffic produces rows with real signatures, snake_case instruction names, ticking ages | ✅ PASS — real signatures, snake_case names, ticking ages |
| B8 | Activity strip cap | Never more than 6 rows in the DOM regardless of traffic volume | ✅ PASS — capped at 6 under load |
| B9 | Receipt drawer | Clicking `receipt` shows layer, slot, compute units, fee, full signature, instruction lines | ✅ PASS — layer, slot, 9,814 CU, fee, full signature, instruction line |
| B10 | Receipt "not reported" | A missing compute or fee figure renders as "not reported", never `0` | ⚠️ NOT OBSERVABLE — the local rollup always reports compute and fee, so the "not reported" branch cannot be produced on demand. Not marked PASS. |
| B11 | Receipt freezes the list | While a receipt is open the header says "paused while you read" and the top row does not change under new traffic | ✅ PASS — "paused while you read", top row unchanged over 9s of new traffic |
| B12 | Receipt closes | Closing resumes the feed and the row set advances | ✅ PASS |
| B13 | Pinned layer sequence | Scrolling advances the layer steps; step one is not stuck | ✅ PASS — geometry correct; a synthetic scroll event moved the step 0 → 2. The browser withholds scroll events in a hidden document, which is why a plain scroll showed nothing |
| B14 | Live market feed | Cards render from real on-chain markets, not placeholders | ✅ PASS |
| B15 | Counters | Instruction and error counts come from the IDL and read 35/35; test count 37; rooms 3 of 25 | ✅ PASS **after fix** — page claimed 32 tests against a real 37; now 35 instructions, 37 tests, 3 of 25 rooms, 35 error codes |
| B16 | Explorer link on a signature | Opens an explorer URL carrying the rollup endpoint as `customUrl` | ✅ PASS — explorer link carries the rollup endpoint |

## C. `/village`

| # | Item | Correct means | Result |
|---|---|---|---|
| C1 | Heading count | "N markets still open" where N equals the real count of `open` markets on the rollup | ✅ PASS — "77 markets still open" matches the merged count across both layers exactly |
| C2 | Market cards | Each card shows room, hash, countdown and pots from real state | ✅ PASS — 159 cards equals 159 unique markets merged |
| C3 | Countdown ticks | The clock decreases once per second without a reload | ✅ PASS — 01:03 → 00:58 |
| C4 | Final-20s urgency | Inside 20 seconds the clock goes crimson and breathes | ✅ PASS — observed `00:08 [countdown urgent]` |
| C5 | Card to market | Clicking a card navigates to that market's page | ✅ PASS |
| C6 | Pots reflect chain | SEAL/READ figures equal the on-chain pots | ✅ PASS — pot matched the scripted 0.33 exactly |
| C7 | Live update | A bid placed elsewhere updates a card without a reload | ✅ PASS — SEAL 0 → 0.33 with no reload |
| C8 | Empty state | With zero open markets, composed copy naming a next action, not a blank grid | ⏳ deferred to the wipe window |
| C9 | Cascade entrance | Cards rise in, capped stagger; all visible with motion disabled | ✅ PASS |
| C10 | 375px | No horizontal overflow; cards single column | ✅ PASS — overflow 0 at a true 375px |

## D. `/confess`

| # | Item | Correct means | Result |
|---|---|---|---|
| D1 | Form renders | Room select, body textarea, redaction field, duration, seal button | ✅ PASS |
| D2 | Byte counter | Counts UTF-8 **bytes**, not characters: `aé漢` reads 6 | ✅ PASS — `aé漢` reads 6/180, bytes not characters |
| D3 | Counter updates live | Typing changes the counter immediately | ✅ PASS |
| D4 | Over-limit refused | A body over 180 bytes is refused with a specific message naming the limit | ✅ PASS — 100 multibyte chars (300 bytes) slipped past `maxLength`, and the byte check refused it: "the body has to be 1..180 bytes" |
| D5 | Empty body refused | An empty body is refused, no transaction is sent | ✅ PASS — whitespace-only refused, same specific message |
| D6 | Redaction limit | Over-length redaction refused with its own message | ✅ PASS — "the redacted sentence has to be at most 96 bytes" |
| D7 | What-Solana-sees pane | Two panes plus the `sha256(body ‖ salt)` label between them | ✅ PASS — two panes, arrow reads `sha256(body ‖ salt)` |
| D8 | Live digest | The digest changes as the body changes, and is 64 hex characters | ✅ PASS — 64 hex, changes with the body |
| D9 | Digest is the commitment | The previewed digest **equals** the commitment written on chain, exactly | ✅ PASS — previewed digest identical to the commitment written on chain |
| D10 | Empty-body pane | With no body, the right pane says a hash appears as you write; no fake digest | ✅ PASS — no digest rendered for an empty body |
| D11 | Seal flow steps | The nine steps run in order, each marked as it completes, each naming its layer | ✅ PASS — all 9 steps in order, each marked and each naming its layer |
| D12 | Body never on L1 | The Secret account allocated on the base layer contains no plaintext | ✅ PASS — the Secret account on base is 385 bytes with **zero non-zero body bytes** and no confession text; the same account on the rollup contains it |
| D13 | Result panel | Shows market address, secret address, commitment; addresses are copyable | ✅ PASS **after fix** — the panel printed only a commitment and a link. Now carries the market and secret addresses, each a `Copyable` with an sr-only announcement, each linked to the right layer. (The clipboard write itself cannot execute in an unfocused tab; the control correctly refuses to claim a copy it did not make.) |
| D14 | Another sin | Resets the form for a second confession | ✅ PASS — form reseeds |
| D15 | Seal without a wallet | Refused with a clear message, no transaction attempted | ✅ PASS — "no key. Pick burner mode, or connect a wallet.", zero steps run |
| D16 | Room rule shown | The selected room's rule text matches `rooms.ts` for that room | ✅ PASS — matches rooms.ts line 50 exactly |

## E. `/rooms`

| # | Item | Correct means | Result |
|---|---|---|---|
| E1 | Twenty-five rooms | All 25 enumerated rooms render | ✅ PASS — 25 room cards |
| E2 | Three live | Exactly 3 marked live; the other 22 marked not enabled | ✅ PASS — exactly 3 `room-card live`, 22 `room-card off`, badged "Phase 2" |
| E3 | Rules | Each live room shows its real rule lines | ✅ PASS — matches rooms.ts line 50 verbatim |
| E4 | Live room links | A live room links somewhere useful; a disabled room does not pretend to | ✅ PASS **after fix** — live cards did link to /confess, but "open one" landed on Guilt Market whatever you clicked. Now carries `?room=`, validated against the live rooms, with an unknown variant falling back instead of breaking |
| E5 | 375px | No overflow | ✅ PASS |
| E6 | Console clean | No errors or failed requests | ✅ PASS — see K1/K2 sweep |

## F. `/graveyard`

| # | Item | Correct means | Result |
|---|---|---|---|
| F1 | Tombstone count | Header count equals the real number of tombstone accounts on the base layer | ✅ PASS — 56 shown, 56 on chain |
| F2 | Headstone renders | Every card shows an SVG headstone with a visible silhouette | ✅ PASS — 56 stones, all rendered |
| F3 | Headstones are distinct | N tombstones produce N distinct silhouettes and N distinct grain seeds | ✅ PASS — 56 distinct silhouettes, 56 distinct grain seeds |
| F4 | Headstones deterministic | After a reload every stone is byte-identical to before | ✅ PASS — 56 compared after reload, 56 identical, 0 drifted |
| F5 | Hash line | `sha256` prefix plus the real digest, full value in the title attribute | ✅ PASS — 56 hash lines, full digest in the title |
| F6 | Released body shown | A `publicLeak`/`randomReveal` tombstone shows its text | ✅ PASS — 14 released bodies, matching 14 on chain |
| F7 | Withheld redacted | A `buried`/`soleReader` tombstone shows the redaction bar and no text | ✅ PASS |
| F8 | Commitment verifier | For a released body with a salt, recomputes in-browser and reports a match | ✅ PASS — 13 verifiers, matching the 13 released-with-salt on chain |
| F9 | Verifier honest without salt | Without a published salt it says the commitment cannot be reproduced, not MISMATCH | ✅ PASS — the one released-without-salt tombstone (randomReveal) explains that the published line is the author's redaction and the commitment covers the sealed body, so there is nothing to check. Never prints MISMATCH |
| F10 | Read receipt epitaph | A `soleReader` tombstone reads "They came back for it on ..." only when `read_at` is non-zero, else "never came back" | ✅ PASS — 6 "came back for it on", matching the 6 with a non-zero `read_at` on chain |
| F11 | Empty state | With zero tombstones, composed copy, not a blank page | ⏳ deferred to the wipe window |
| F12 | 375px | No overflow, stones still render | ✅ PASS — overflow 0 at a true 375px, all 56 stones still render |

## G. `/challenge`

| # | Item | Correct means | Result |
|---|---|---|---|
| G1 | Probe intro | Explains what is about to be attempted | ✅ PASS |
| G2 | Run the probes | Produces 5 probes each with a verdict, against a real live secret | ✅ PASS — 5 probes, all decided |
| G3 | Probe: stranger refused | A generated key with a real TEE token is refused the secret (or states the localnet caveat explicitly) | ✅ PASS — a freshly minted, perfectly valid token is **refused** |
| G4 | Probe: market readable | The same stranger *can* read the market | ✅ PASS — the same stranger reads the market |
| G5 | Raw JSON-RPC shown | The actual RPC reply is displayed, not a paraphrase | ✅ PASS — raw JSON-RPC printed verbatim |
| G6 | Race idle state | Two lanes reading `0ms` and "not sent yet"; button disabled without a key | ✅ PASS — lanes read `0ms` / "not sent yet" |
| G7 | Race runs | Both lanes get real signatures and real times; rollup markedly faster | ✅ PASS — 12ms vs 360ms, 30x, real signatures both sides |
| G8 | Race never fakes a time | While in flight a lane shows `…ms`, never `0ms` | ✅ PASS — earliest in-flight state is `…ms`, never a bare `0ms` |
| G9 | Race failure honest | A lane that fails shows "failed" and the error, and no verdict is claimed | ⏳ deferred to the controlled outage window |
| G10 | Race repeatable | "race again" runs a second time with new signatures | ✅ PASS — reran to 9ms vs 383ms with new signatures |
| G11 | Race explorer links | Each signature links to its own layer's endpoint | ✅ PASS — rollup signature links to :7799, base to :8899 |
| G12 | Console clean | No errors across the whole page including a race | ✅ PASS — see K1 sweep |

## H. `/market/[address]`

| # | Item | Correct means | Result |
|---|---|---|---|
| H1 | Market header | Room, status pill, countdown, hash all from real state |
| H2 | Pots | SEAL/READ equal chain values |
| H3 | Pot odometer | A bid landing rolls the figure through intermediate values to the exact new total, with no reload |
| H4 | Rule box | The active rule branch is highlighted and matches the market's room |
| H5 | Permission: market | Reads **public** with the author as a member, flags decoded, raw byte shown |
| H6 | Permission: confession | Reads **private** for a sealed confession room |
| H7 | Permission explains public | On a non-confession room the pane says why it is open and calls it "the claim" |
| H8 | Permission live | `grant_reader` admitting a reader appears without a reload |
| H9 | Purse shown | Real purse balance for the connected key |
| H10 | Fund purse | Funding moves real lamports and the figure updates |
| H11 | Place bid | A bid signs, lands on the rollup, and the pot moves |
| H12 | Bid over purse refused | Refused with the program's own error, no silent failure |
| H13 | Bid on the wrong side | A side the room does not trade is refused |
| H14 | Session open | One approval opens a scoped session; the readout shows the key and its ceiling |
| H15 | Session bid | A bid with a live session shows no wallet popup and reports the session signature |
| H16 | Session revoke | Revoking stops that key; a later session bid fails and does not silently fall back to the wallet |
| H17 | VRF grace panel | In `vrfPending`, a live countdown from `expires_at + 120` |
| H18 | VRF retry | After the grace, the button appears and moves the market to `expired` **on chain** |
| H19 | Countdown to expiry | Reaches zero and the status changes without a reload |
| H20 | Copyable addresses | Market and secret addresses copy to clipboard and announce it |
| H21 | Unknown address | A well-formed but non-existent market address shows a real not-found state, not a crash |
| H22 | 375px | No overflow anywhere on the page |

## I. `/market/[address]/result`

| # | Item | Correct means | Result |
|---|---|---|---|
| I1 | Verdict | The outcome badge matches the on-chain outcome |
| I2 | Facts | seal pot, read pot, sole reader, bids settled all equal chain values |
| I3 | Sole reader "nobody" | An unset sole reader reads "nobody", not the system program address |
| I4 | Read receipt | "reader claimed it" shows the real timestamp, or "not claimed" when `read_at` is 0 |
| I5 | Released text | Shown only when the outcome authorises it |
| I6 | Lifecycle: rollup column | Real signatures oldest first with instruction names |
| I7 | Lifecycle: Solana column | Shows `create_market`, `delegate_market`, `process_undelegation`, `write_tombstone` |
| I8 | Lifecycle: pruned honesty | When the base layer has pruned the window it says so with the retained-from slot, never "0" |
| I9 | Trading claim | States rollup writes and that **Solana never saw a bid**, only when both layers answered |
| I10 | No ratio when unknown | With a pruned base layer it refuses to compute a ratio and says why |
| I11 | Failed rows marked | A genuinely failed transaction in the history is rendered as failed |
| I12 | Re-read | The re-read button refetches and the panel updates |

## J. Errors, empties, interruptions

| # | Item | Correct means | Result |
|---|---|---|---|
| J1 | 404 | An unknown route renders the styled not-found, not a framework default |
| J2 | Route error boundary | A thrown route error renders the styled boundary with the real message verbatim |
| J3 | Rollup down | With the ER unreachable, pages say so; no page renders zeros as if they were data |
| J4 | Base down | Same for the base layer |
| J5 | Mid-flow interruption | Navigating away mid-confession does not leave a stuck spinner on return |
| J6 | Reload mid-flight | Reloading during a bid leaves consistent state, no duplicate bid |
| J7 | No wallet | Every action requiring a key is disabled with a reason, never a silent no-op |
| J8 | Reduced motion | With `prefers-reduced-motion`, all content is present and no entrance strands anything |
| J9 | Storage blocked | With localStorage unavailable the app still renders |
| J10 | Aurora at rest | `--chain-energy` is 0 at rest and the blades read `brightness(1)` |

## K. Cross-cutting

| # | Item | Correct means | Result |
|---|---|---|---|
| K1 | Console, all routes | Zero errors on every route |
| K2 | Network, all routes | Zero failed requests on every route |
| K3 | Overflow at 375 | Zero horizontal overflow on every route, measured in a true 375px frame |
| K4 | Overflow at 1440 | Zero horizontal overflow on every route |
| K5 | Production build | `build:check` compiles and prerenders all routes |
| K6 | No mocks | Zero mock/stub/fake/TODO in shipped source |
| K7 | IDL in sync | The app's IDL matches the built program |
| K8 | Design detector | Only the three findings pinned in DESIGN.md |
| K9 | No dashes | Zero em/en dashes under `app/src` |
| K10 | Test suite | `npm test` 37 passing, 0 failing |
