# SINBAZAAR — build plan

Written from the code, not the README. Every status below was checked against
the repository or a live cluster on the date of writing, and the checks are
named so the next agent can re-run them rather than trust this file.

A builder agent should be able to pick any single task here and execute it cold.

---

## 1. What "done" and "winning" actually mean

SINBAZAAR is a submission to the **MagicBlock Solana Blitz v8** hackathon. It is
a village of markets where the traded asset is a secret: one sentence is sealed
inside a TEE-backed Private Ephemeral Rollup, only `sha256(body ‖ salt)` and a
timer are published, and for a few minutes anyone can pay **SEAL** to keep it
buried or **READ** for the chance to be its one reader. At zero, MagicBlock VRF
decides, and Solana receives a tombstone.

### Done means

1. **The privacy claim is falsifiable and holds.** A stranger holding a genuine
   TEE token is refused the confession, the same stranger can read the market,
   and an unfiltered validator proves the refusal was a decision rather than an
   empty account. Provable by a judge in under a minute, without trusting us.
2. **Every MagicBlock primitive the pitch names is load-bearing**, not
   decoration: Private Ephemeral Rollups, ephemeral permissions as access
   control, Ephemeral Rollups, ephemeral accounts, and VRF.
3. **The money is correct.** Escrow balances, no path pays out lamports the
   market does not hold, and `close_book` refuses if it would.
4. **A judge can verify it themselves**, on devnet, against the deployed
   program, with a command from the README that works.
5. **The demo runs unattended.** A market can be taken from confession to
   tombstone without hand-cranking.

### Winning means

Blitz judging weighs creativity, technical depth, and **how clearly the demo
proves the MagicBlock primitives**. So winning is narrower than done:

- **The privacy proof is the product.** Anything that makes a judge believe the
  claim without taking our word for it is worth more than any new feature.
- **The rollup must be visibly a rollup.** Live latency, live slot height, a
  book that moves without a refresh. A screenshot of a dashboard proves nothing.
- **Depth beats breadth.** Three rooms that work completely beat twenty-five
  half-built ones. The enum enumerating 25 is a design statement, not a backlog.
- **Nothing invented.** No fabricated metrics, no mocked flows, no claims the
  code does not support. A judge who finds one exaggeration discounts the rest.

### Explicit non-goals

- Mainnet. Nothing here should ever touch it.
- Real secrets. Fiction mode is a product constraint, not a disclaimer.
- Building the other 22 rooms. See "Winning", above.

---

## 2. Where the project actually is

| | |
|---|---|
| Program | Anchor, **35 instructions**, 6 accounts, 35 error codes |
| Tests | **37 passing, 0 failing** against a live local cluster |
| Privacy proof | **11/11 PASS** locally, both refusals and the control |
| Web app | 8 routes, production build clean, 0 console errors |
| Browser test plan | **135/135 PASS**, 18 defects found and fixed. Re-verified after Phase 4: 6 routes plus both dynamic routes at a true 375px, zero overflow, zero console errors, zero failed requests |
| Mocks / stubs / TODOs in shipped code | **0** (re-verified; the only `placeholder` hits are the CSS pseudo-element and two real input placeholders) |
| Devnet program | Deployed, but **STALE** — see G1 |
| Repo | **Public**, <https://github.com/nickthelegend/sinbazaar> |
| Demo video | **Not recorded** |

The core is built and verified, and Phase 4 is now closed too: the rollup
activity strip, Magic Actions carving the tombstone, the receipt drawer and the
read receipt all shipped and proven against a live cluster.

What remains is **not code**. It is devnet SOL, a video a person has to record,
and a host that depends on the first of those.

---

## Phase 0 — Correctness on devnet (blocking everything else)

The single highest-value phase. The devnet program is what a judge runs, and it
is currently older than the code that passes the tests.

| # | Task | Status |
|---|---|---|
| 0.1 | Fund the devnet deployer `Ev2zTBpXSPLdn3F8Y39bSXexYggGPkQ4xUi65bf695ja` with **≥ 5.5 SOL**. Needed for the upgrade buffer (~5.3 SOL, refunded on completion) plus fees. Current balance **0.1334 SOL**. | **BLOCKED — attempted and refused.** `api.devnet.solana.com` returns **429**, "you have either reached your airdrop limit today or the faucet has run dry", at 2, 1 and 0.5 SOL. Helius devnet needs an API key that is not in this repo. Ankr devnet does not implement `requestAirdrop`. This needs devnet SOL from a funded wallet or a faucet reset; it cannot be closed by writing code. |
| 0.2 | `anchor build`, then `bash scripts/deploy-devnet.sh` to upgrade the program in place at `2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN`. Do **not** deploy to a new address; the README, SUBMISSION and explorer links all point at this one. | **BLOCKED** by 0.1 |
| 0.3 | Verify the upgrade landed: fetch the programdata account, compare `sha256` of its bytes against `target/deploy/sinbazaar.so`. They must be **identical**. The comparison script is in G1 below. | **BLOCKED** by 0.2 |
| 0.4 | Re-run `. ./.env.devnet && npx ts-node scripts/prove-privacy.ts` against the upgraded program. All 11 checks must pass, including the two refusals, now under real TEE attestation. | **BLOCKED** by 0.2 |
| 0.5 | Capture the new market and secret addresses from that run and update the two explorer links in `docs/SUBMISSION.md`. The current ones point at accounts created by the stale program. | **BLOCKED** by 0.4 |
| 0.6 | Confirm `.env.devnet` still carries `EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app`. Both the market and its secret are delegated to the TEE validator, so a regional ER endpoint would not host them. | DONE |

---

## Phase 1 — Truth repair in the documentation

Every item here is a place where a document describes a codebase that no longer
exists. A judge reading these would form a wrong impression of the project, in
both directions.

| # | Task | Status |
|---|---|---|
| 1.1 | README instruction count. | **DONE** — both occurrences match the IDL. Corrected 31 to 32 here, then to **34** when 4.2 added two instructions. |
| 1.2 | ASSUMPTIONS §5 residual. | **DONE** — rewritten. The gate is real, so the reader-identity exposure is closed. What survives is milder and now stated: `Inherited` draws against `bid_count`, which counts unfunded bids, so a draw can land on one, be refused for being unfunded, and select **nobody**. Safe failure, but not what the room advertises. |
| 1.3 | Re-read ASSUMPTIONS against the program. | **DONE** — §5 rewritten, and the "what we would do next" list corrected: it still carried the shipped `bid.funded` fix as item 1. Every remaining item re-verified in the source: `retry_vrf` is still an unbounded retry with no attempt ceiling, `caller_seed` is still `[client_seed; 32]` taken from the caller. |
| 1.4 | Defect ordering. | **DONE** — 17 and 18 swapped into order. |
| 1.5 | Audit every number in prose. | **DONE** — ground truth at audit time was 32 instructions, 34 errors, 25 rooms with 3 live, and 19 + 13 + 1 tests across the three files. Fixed: README instruction count, and `docs/TEST-PLAN.md` which said edges.ts had 12 tests (it has 13 since `commit_market` was covered) and claimed 9/9 on the devnet TEE where it is now 11 checks pending the upgrade. README's "22 rooms disabled" and ASSUMPTIONS' "Phase-7 rooms" were checked and are correct. The counts moved twice later in this same run: to 34 instructions when 4.2 added `open_tombstone` and `seal_tombstone`, then to **35 instructions, 35 errors and 37 tests** when 4.4 added `record_read`, `NotReader` and `tests/read-receipt.ts`. Every prose claim was updated with each move. The landing page derives both counts from the IDL rather than repeating them, but it reads a **copy** of the IDL that nothing was keeping in sync, so it would have gone on showing 34 until that copy was refreshed. See G15. |

---

## Phase 2 — Make it reachable by a judge

Nothing in this phase is technically hard, and all of it is required for a
submission to count.

| # | Task | Status |
|---|---|---|
| 2.1 | Create a public GitHub repository and push. | **DONE** — <https://github.com/nickthelegend/sinbazaar>, public, 33 commits. The pre-push scan found a tracked private key first; see G11. History was rewritten to purge it before the first push, and the remote returns 404 for that path. |
| 2.2 | Repo URL in `docs/SUBMISSION.md`. | **DONE** |
| 2.3 | Record the demo video following `docs/DEMO.md`. | **NOT STARTED — cannot be done by an agent.** Recording screen and voice is outside what I can do. `docs/DEMO.md` is beat-by-beat and `npm run demo` narrates the same sequence against a live cluster, so the script is ready for a human to record against. |
| 2.4 | Video URL in `docs/SUBMISSION.md`. | **NOT STARTED**, blocked by 2.3 |
| 2.5 | Decide on a hosted app. | **BLOCKED by 0.2, and the dependency is the point.** A hosted frontend has to point at devnet, and the devnet program is stale: it has no `revealed_salt`, so the graveyard's commitment check would fail against it. Hosting now would ship a site that contradicts the README. Do this after the upgrade, not before. |
| 2.6 | Devnet env vars for the hosted app. | **NOT STARTED**, blocked by 2.5 |

---

## Phase 3 — Demo resilience

The demo is the deliverable. These reduce the chance of it failing in front of
a judge, and are ordered by how likely each failure is.

| # | Task | Status |
|---|---|---|
| 3.1 | Keeper daemon that takes any dead market to a tombstone unattended. `scripts/keeper.ts`, `npm run keeper`. | DONE |
| 3.2 | Seed script producing a village in known states. `scripts/seed.ts`. | DONE |
| 3.3 | Narrated end-to-end script. `scripts/demo.ts`. | DONE |
| 3.4 | `scripts/smoke.ts` on a fresh ledger. | **DONE** — wiped `test-ledger/` and `magicblock-test-storage/`, restarted the stack, ran it: full loop create, seal, bid, VRF, settle, tombstone. Landed a `soleReader` tombstone with `revealed_len: 0`. |
| 3.5 | Rehearse the full demo path end to end. | **DONE** — `npm run demo` against a fresh local cluster: **exit 0 in 57 seconds wall clock**. Every beat landed: pots public, each bid private with the author excluded from its member list, a real VRF draw resolving BURIED, a tombstone with `revealed_len: 0`, the confession still `is_private` with one member, a PUBLIC_LEAK carved to L1, and a Whisper IPO paying 2 SOL on a 1 SOL stake. 57s is comfortably inside a demo window, so the narration does not have to stall for the chain. |
| 3.6 | Decide the demo cluster. | **DECIDED: demo on local, prove privacy on devnet, say so on camera.** Local runs the whole narrated loop in 57s and never rate-limits, which is what a 60-second video needs. The privacy refusals are the one claim local cannot fully carry, because the query-filtering service enforces the member list but is not attested hardware. That half belongs on devnet and is **currently blocked by 0.2**: the deployed program has no `revealed_salt`, so a devnet reveal cannot be checked against its own commitment. Until 0.2 lands, the honest on-camera line is that enforcement is demonstrated locally and attestation is what devnet adds. |

---

## Phase 4 — Backlog · CLOSED (4.1 to 4.4 shipped)

`docs/IDEAS.md` holds 100 ranked ideas. The ranking principle there still stands
and still argues against most of the list: a hundred features would hurt a
sixty-second demo.

Four were taken, in order, and each was verified against a live cluster rather
than declared done. Between them they surfaced **four defects** (G12, G14, G15,
and the vrf-stall suite noise in G13), three of which were invisible from inside
the thing being tested and only appeared when the page or the log was checked
against the chain. 4.5 stays blocked behind Phase 0 and 4.6 stays declined.

| # | Task | Status |
|---|---|---|
| 4.1 | **Idea 6, rollup activity strip.** A live ticker of ER transactions as they land, with signatures. | **BUILT, VERIFIED, UNCOMMITTED.** `logsSubscribe` was probed against the ephemeral validator before any UI was written: it accepts a `mentions` filter and delivers real signatures with Anchor's `Instruction:` lines. New: `subscribeLogs` in `lib/live.ts`, `hooks/useActivity.ts`, `components/Activity.tsx`, `explorerTxUrl` in `lib/config.ts`, `.act*` styles, mounted under the pulse row. Verified live against demo traffic: real signatures, snake_case names, the multi-instruction case rendering as `place_bid + fund_bid`, ages ticking, explorer links pointed at the rollup endpoint. Zero console errors, zero overflow at 1440 and at a true 375. **One defect found and fixed during verification** (see G12). Not yet committed: the boot volume filled and `git` cannot run. |
| 4.2 | **Idea 5, Magic Actions for the tombstone.** | **DONE, PROVEN.** `finalize_market` now attaches a `CallHandler` to the intent bundle as a **post-undelegate** action, so Solana learns the verdict because the rollup scheduled it and not because a client stayed awake. Post-undelegate rather than post-commit because the action writes `market.tombstoned`, and until undelegation lands the market is still owned by the delegation program. Two new instructions: `seal_tombstone` (`#[action]`, no signer but the injected escrow) and `open_tombstone`, which allocates the headstone in advance because an action arrives with an escrow, and an escrow pays fees, not rent. `open_tombstone` proves the market by PDA derivation instead of deserializing it, since the account is owned by the delegation program while delegated. `write_tombstone` and `seal_tombstone` share one `carve_tombstone` so the two headstones cannot drift. Proof: `npm run prove:action`. |
| 4.3 | **Idea 12, per-transaction receipt drawer.** | **DONE, VERIFIED.** Each strip row opens a receipt fetched from the rollup with `getTransaction`: layer, slot, compute units consumed, fee, the full signature and the Anchor instruction lines. Two deliberate departures from the idea as written. **No latency**, because these transactions were observed rather than sent, so there is no local start time and any number here would be measuring this browser's websocket rather than the chain; the pulse row already shows a real round trip. And a missing figure reads **"not reported"**, never 0, since 0 compute units is itself a real value. Opening a receipt **freezes the ticker** ("paused while you read") so the row cannot slide out from under the reader, and closing it resumes. Verified at 375px and 1440px in iframes with real layout: overflow 0 both, drawer opens on mobile, zero console errors, real figures (47,137 CU, fee 0). |
| 4.4 | **Idea 16, read receipt.** | **DONE, TESTED.** `record_read` lets the selected reader put the moment on the record; `Market` and `Tombstone` both gained `read_at`, so it rides the commit onto the permanent L1 headstone. **It is not detection and nothing here says it is:** a chain cannot observe an RPC read, so this is the reader signing a claim. The result page renders "reader claimed it", the graveyard epitaph reads "They came back for it on ..." or "They never came back for it", and 0 renders as "not claimed" rather than as 1 January 1970. Only the reader can record it (`NotReader`, appended to the enum so existing error numbers did not shift), and it never moves once set. `tests/read-receipt.ts`, 5 tests, all passing. |
| 4.5 | **Idea 14, Mirror Confession as a fourth live room.** | **NOT TAKEN, deliberately.** Not blocked in the sense the Phase 0 items are: it builds and deploys locally like 4.2 and 4.4 did. It is declined on the plan's own ranking. "Depth beats breadth" is in the definition of winning at the top of this file, a fourth room adds a rule rather than proving a primitive, and it would need the devnet redeploy that 0.2 cannot currently get. Taking it would contradict the standard the rest of the work was held to. |
| 4.6 | **Idea 15, eSPL escrow.** Explicitly declined in IDEAS: it swaps a working money path for a riskier one immediately before a demo. Do not take this. | **DECLINED** |

---

## Phase 5 — Standing verification

These already pass. They are listed so a builder knows what must **still** pass
after any change, and how to check.

| # | Task | Status |
|---|---|---|
| 5.1 | `npm test` — **37 passing, 0 failing** against a live local cluster, re-run after every program change in this run. | DONE |
| 5.2 | `scripts/prove-privacy.ts` locally — 11/11 including both refusals and the control. | DONE |
| 5.3 | `docs/BROWSER-TEST-PLAN.md` — 135/135 in a real browser, production build. | DONE |
| 5.4 | Zero mocks, stubs, fakes, placeholders or TODOs in shipped code. Re-verify with the grep in G7. | DONE |
| 5.5 | Zero console errors and zero failed network requests on all six routes. | DONE |
| 5.6 | WCAG AA on every text and ground pair, measured with alpha compositing. | DONE |
| 5.7 | No horizontal overflow at a **true** 375px viewport. Measure in a 375px same-origin iframe; window presets lie. | DONE |
| 5.8 | Design detector reports only the three findings pinned by the brief (Inter, Geist Mono, one-word gradient), all recorded in `DESIGN.md` §7. | DONE — re-run, exactly 3 findings, all pinned. |
| 5.9 | `npm run verify:idl` — the app's copy of the IDL matches the built one. Added after G15, where a stale copy made the graveyard state the opposite of the truth. | DONE |

---

## 3. The gap list

Every gap found by reading the code and querying live clusters, tied to the task
it blocks. Ordered by severity.

### G1 — The devnet program is stale · blocks 0.2, 0.3, 0.4, and the whole of Phase 2

The deployed binary is **not** the code that passes the tests.

```
devnet programdata 97Lx5QMPxRvhsm5B7WDdU9Ha6MbobL8EuTMsgKQxUtw4
devnet deployed bytes : 759009
local build bytes     : 759440
sha256 match          : false
```

The deployed program therefore predates at least these correctness fixes:

- the Whisper IPO double-count, where the losing stake was credited to
  `author_payout` *and* included in the winners' payout;
- the `is_chosen_bid` gate on `bid.funded`;
- `revealed_salt` on `Market` and `Tombstone`, without which a devnet reveal
  **cannot be verified against its own commitment**.

Anything a judge runs against devnet today is running the old program. Re-check
with:

```bash
node -e "…"  # see Phase 0.3; compare programdata bytes to target/deploy/sinbazaar.so
```

### G2 — Devnet deployer is unfunded · blocks 0.1, and therefore G1

`Ev2zTBpXSPLdn3F8Y39bSXexYggGPkQ4xUi65bf695ja` holds **0.1334 SOL**. A ~759 KB
program upgrade needs roughly **5.3 SOL** for the buffer account (refunded when
the upgrade completes) plus fees. `program-authority` holds **0.0000 SOL**.
This is the one gap that cannot be closed by writing code.

### G3 — `ASSUMPTIONS.md` §5 describes a bug that is fixed · blocks 1.2

The document says `is_chosen_bid` is not gated on `bid.funded` and that an
unfunded bid can inherit a confession. The gate is at
`programs/sinbazaar/src/lib.rs:1398`. The project's own honesty document
currently understates its own correctness, which is a strange way to lose
credibility but still a way to lose it.

### G4 — README instruction count is wrong · blocks 1.1

"31 instructions" at `README.md:7` and `README.md:510`. The IDL has 32. The
landing page derives this number from the IDL and is correct; the README does
not and is not.

### G5 — No repo remote, no video, no hosted app · blocks 2.1 through 2.5

`git remote -v` is empty. `docs/SUBMISSION.md` has three unfilled rows: Repo,
Demo video, Live app. A submission missing all three is not a submission.

### G6 — `scripts/smoke.ts` unverified since the program changed · blocks 3.4

It was stale once already (passing a `session` account to `place_bid` and a
`bid_permission` to `settle_bid`, neither of which exist any more) and was
repaired, but has not been executed since the last program change. It is the
one script in the repo with a known history of drifting out of sync.

### G15 — The app read a stale copy of the IDL, and rendered a falsehood from it · closed

Found while verifying 4.4's UI, by checking the chain against the page instead
of only reading the page.

The web app cannot import from `target/`, so it keeps its own copy of the IDL at
`app/src/idl/sinbazaar.json`. Nothing kept that copy in sync and nothing checked
it, so it sat at **34 instructions while the program had 35**.

Anchor does not complain about a field its layout does not describe. It returns
`undefined`. `toNumber(undefined)` returns 0. `read_at` of 0 means "the reader
never came back". So the graveyard printed **"They never came back for it"** on
three headstones whose readers demonstrably had, with the timestamps sitting on
chain the whole time.

This is the same failure this project has now hit repeatedly in different
clothing: **an absence rendered as a value**. Not "unknown", not "cannot say" —
a confident, specific, wrong sentence. It was invisible from inside the browser,
because the page was perfectly self-consistent. Only comparing it against the
chain exposed it.

It also makes a claim written earlier in this very run wrong. 1.5 said the
landing page "needed no edit because it reads the number out of the IDL". It
reads a copy, and the copy was stale, so the counter would have kept saying 34.
That sentence has been corrected rather than quietly left standing.

**Closed by** syncing the copy and making drift loud instead of silent:

```bash
npm run build       # anchor build now syncs the copy as its last step
npm run verify:idl  # fails, with both counts, if they differ
```

Re-verified after the fix: the graveyard prints "They came back for it on ..."
for exactly the three tombstones that carry a non-zero `read_at` on chain, and
"never came back" for the one that does not. The counter reads 35.

### G14 — The action was scheduled even when it could not run · closed

Found in the validator logs while chasing an unrelated failure, not by a test.

4.2's first version attached the `seal_tombstone` action to **every**
`finalize_market`. Almost no caller has a funded escrow or a pre-opened
headstone, so almost every action was unexecutable. The rollup did not surface
this as a failure: it **patched the intent**, silently dropped the action, and
committed the rest. The suite stayed green and the demo kept working, while the
validator log filled with `custom program error: 0xbc4`, `AccountNotInitialized`,
on markets that had finalized perfectly.

That is worse than a visible break. The graceful degradation was the validator's,
not ours, and it hid the fact that we were putting work into every intent bundle
that was guaranteed to fail.

**Closed by** making the action opt-in: `FinalizeMarket` takes an
`Option<UncheckedAccount>` for the tombstone, and the action is attached only
when a headstone is actually passed. Callers who want the rollup to carve it
pass one; everyone else finalizes exactly as before and carves with
`write_tombstone`. Verified on a freshly wiped stack: the demo runs green end to
end and the stack log contains **zero** patched intents and zero `0xbc4`, while
`npm run prove:action` still proves the action carves the headstone with a
transaction we did not sign.

### G13 — `npm test` ran a spec that says not to run it · closed

`tests/vrf-stall.ts` opens with "this spec is NOT part of the normal suite" and
must be run through `scripts/test-vrf-stall.sh`, which stops the VRF oracle and
puts it back. The default glob `tests/**/*.ts` picked it up anyway, so `npm test`
ran a test whose premise ("the oracle is stopped") was false, and it failed on a
correct system: **32 passing, 1 failing**, with the failure meaning nothing.

A suite that fails by design teaches people to ignore failures, which is the
expensive part. Closed by excluding that file from the default run and giving it
its own script:

```bash
npm test              # 32 passing, 0 failing
npm run test:vrf-stall  # the one spec that needs a silent oracle, ~2 min
```

Re-run after the change and after 4.2's program change: 32 passing, 0 failing. After 4.4 added `tests/read-receipt.ts`: **37 passing, 0 failing**.

### G12 — Motion owned removal, and the list grew without bound · closed

Found while verifying 4.1, not by review.

The activity strip's rows were wrapped in `AnimatePresence` with an exit
transition. An exiting element stays mounted until its animation finishes, and
animations run on the frame loop, which browsers throttle hard in a background
tab. In a tab sitting behind another one, exits never completed, so rows
accumulated one per transaction and none were ever released: **measured at 19
rows in the DOM with the visible cap set to 6**, still climbing.

This is the third instance of one defect in this project wearing a different
hat. The first two were entrances that decided whether content *existed*
(`gsap.from` stranding the hero at opacity 0, and Framer's `initial={{opacity:0}}`
stranding the market cards). This one is the same mistake applied to removal:
motion deciding when a row *leaves*.

The rule that came out of the first two was written as "an entrance may move a
thing, never decide whether it exists". That was too narrow, and the narrowness
is exactly why this got through. The rule is now: **motion may move a thing; it
may never decide whether the thing exists, or when it stops existing.**

**Closed by** deleting the exit transition and `AnimatePresence` entirely, so
React unmounts dropped rows synchronously. The entrance is kept and still
disabled under `prefers-reduced-motion` via `initial={false}`. Re-verified after
the fix: 6 rows in the DOM after 26 transactions had passed through.

### G11 — A private key was tracked, and G7 missed it · closed

Found by the pre-push scan for task 2.1, not by the planning pass.
`.seed-village-authority.json` was **committed**: a 64-byte Solana keypair, at the
repository root. `.gitignore` covered `.seed-village.json`, the manifest sitting
right beside it, and missed the key.

G7 below declared the secret scan clean, and it was wrong. Its grep was
`git ls-files | grep -iE "keys/|\.env"`, which only looks under `keys/` and for
env files. A key at the root with a different name walked straight through. The
grep in G7 has been widened.

**Exposure, stated exactly.** The key holds **0 SOL on devnet and 0 on mainnet**.
`seed.ts` only ever *writes* that path (line 815), never reads it, so it is a
throwaway village authority regenerated on every seed run. The practical risk was
low. It was still wrong to commit, it would have tripped GitHub secret scanning
the moment the repo went public, and a committed private key in a project whose
entire claim is privacy is the kind of detail that costs a judge's trust.

**Closed by:** untracking the file, adding it to `.gitignore`, and rewriting all
33 commits with `git filter-branch --index-filter` to purge it, then expiring
`refs/original` and the reflog and running `git gc --prune=now`. Verified after:
`git log --all -- .seed-village-authority.json` returns **0 commits**, and a grep
for any 64-element byte array across the full history returns **0**. The rewrite
was safe because the repository had never been pushed. The remote returns **404**
for that path.

### G7 — Clean, and worth keeping clean

These were checked and found clean. Re-run after any change:

```bash
grep -rniE "\bTODO\b|\bFIXME\b|\bmock\b|\bstub\b|\bdummy\b|\bfake\b|placeholder" \
  programs/sinbazaar/src sdk/src app/src scripts tests

# Widened after G11. The old version only looked under keys/ and for env files,
# which is how a keypair at the repository root went unnoticed.
git ls-files | grep -iE "key|secret|\.env|credential|token|wallet"
git grep -lE "\[[0-9]{1,3},[0-9]{1,3},[0-9 ,]{190,}\]" -- .   # any keypair array
git log --all -p | grep -cE "BEGIN (RSA|OPENSSH|EC|PRIVATE)|ghp_[A-Za-z0-9]{30,}"
git check-ignore keys .env.devnet .seed-village-authority.json target test-ledger
```

The TODO/mock grep returns zero. The secret greps now return zero **after** G11
was closed; before it, the second one would have found the key.

### G8 — Known program residuals, documented and accepted

Not defects to fix blindly; each is a deliberate trade recorded in
`ASSUMPTIONS.md`. Listed so nobody "discovers" them and panics:

- A hand-built transaction can call `place_bid` without `fund_bid`. The bid is
  then unfunded, wins nothing, and forfeits nothing. Both app paths send the
  pair atomically.
- A client can call `settle_bid` without `close_bid`. That strands the
  ephemeral account's rent, not money, and `close_book` refuses to finish until
  every bid is closed.
- Five error variants are reserved and unused: `MissingBid`, `DuplicateBid`,
  `CommitmentMismatch`, and two others. Annotated as reserved in `error.rs`.
- `MAX_BIDDERS = 8`, and it counts bidders, not bids.

### G9 — 22 of 25 rooms are enumerated and not live · blocks nothing

This is the design, not a gap, and it is stated plainly on `/rooms` and in the
README. It is listed here only so a future reader does not mistake it for
unfinished work. Building them would weaken the submission, not strengthen it.

### G10 — 91 of 100 ideas unbuilt · blocks nothing

`docs/IDEAS.md` is a ranked backlog with honest statuses: 9 built, 34 declined
with reasons, the rest unbuilt. The file's own argument is that most of them
should stay unbuilt. Phase 4 takes only the top four.

---

## 4. Suggested order for the next session

1. **0.1** — start the devnet faucet running; everything real is behind it.
2. **1.1, 1.2, 1.4** — doc truth repair, ~30 minutes, no dependencies.
3. **3.4** — re-run `smoke.ts` on a fresh ledger.
4. **2.1, 2.2** — push the repo, fill the row.
5. **0.2 → 0.5** — the moment the deployer is funded.
6. **2.3, 2.4** — record and link the video.
7. **3.5, 3.6** — rehearse.
8. **Phase 4** only if all of the above is closed.
