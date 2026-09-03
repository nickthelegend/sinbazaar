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
| Program | Anchor, **32 instructions**, 6 accounts, 34 error codes |
| Tests | **32 passing, 0 failing** against a live local cluster |
| Privacy proof | **11/11 PASS** locally, both refusals and the control |
| Web app | 8 routes, production build clean, 0 console errors |
| Browser test plan | **135/135 PASS**, 18 defects found and fixed |
| Mocks / stubs / TODOs in shipped code | **0** (verified by grep) |
| Devnet program | Deployed, but **STALE** — see G1 |
| Repo | **Public**, <https://github.com/nickthelegend/sinbazaar> |
| Demo video | **Not recorded** |

The core is built and verified. What remains is almost entirely **shipping**:
getting the fixed program onto devnet, getting the repo and video in front of a
judge, and repairing places where the docs now describe an older codebase.

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
| 1.1 | README instruction count. | **DONE** — both occurrences now read 32, matching the IDL. |
| 1.2 | ASSUMPTIONS §5 residual. | **DONE** — rewritten. The gate is real, so the reader-identity exposure is closed. What survives is milder and now stated: `Inherited` draws against `bid_count`, which counts unfunded bids, so a draw can land on one, be refused for being unfunded, and select **nobody**. Safe failure, but not what the room advertises. |
| 1.3 | Re-read ASSUMPTIONS against the program. | **DONE** — §5 rewritten, and the "what we would do next" list corrected: it still carried the shipped `bid.funded` fix as item 1. Every remaining item re-verified in the source: `retry_vrf` is still an unbounded retry with no attempt ceiling, `caller_seed` is still `[client_seed; 32]` taken from the caller. |
| 1.4 | Defect ordering. | **DONE** — 17 and 18 swapped into order. |
| 1.5 | Audit every number in prose. | **DONE** — ground truth is 32 instructions, 34 errors, 25 rooms with 3 live, and 19 + 13 + 1 tests across the three files. Fixed: README instruction count, and `docs/TEST-PLAN.md` which said edges.ts had 12 tests (it has 13 since `commit_market` was covered) and claimed 9/9 on the devnet TEE where it is now 11 checks pending the upgrade. README's "22 rooms disabled" and ASSUMPTIONS' "Phase-7 rooms" were checked and are correct. |

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

## Phase 4 — Backlog, only if Phases 0 to 3 are closed

`docs/IDEAS.md` holds 100 ranked ideas: **9 built, 34 explicitly declined with a
reason, the rest unbuilt**. The ranking principle there still stands, and it
argues against most of this list: a hundred features would hurt a sixty-second
demo. Take these only in order, and only if there is genuinely time.

| # | Task | Status |
|---|---|---|
| 4.1 | **Idea 6, rollup activity strip.** A live ticker of ER transactions as they land, with signatures. Makes the rollup feel busy during the video. Highest remaining value per unit of risk. | **NOT STARTED** |
| 4.2 | **Idea 5, Magic Actions for the tombstone.** Schedule the L1 write from inside the ER commit instead of as a separate client transaction. This is a named MagicBlock primitive the project claims in spirit and does not use. | **NOT STARTED** |
| 4.3 | **Idea 12, per-transaction receipt drawer.** Signature, layer, slot, compute units, latency. Technical depth on demand without cluttering the page. | **NOT STARTED** |
| 4.4 | **Idea 16, read receipt.** Record when the sole reader first opened the secret. Cheap, and adds real drama to the result page. | **NOT STARTED** |
| 4.5 | **Idea 14, Mirror Confession as a fourth live room.** The only enumerated room whose rule is genuinely novel. Costs a program change and a redeploy, so it is blocked behind Phase 0 and probably not worth it. | **NOT STARTED** |
| 4.6 | **Idea 15, eSPL escrow.** Explicitly declined in IDEAS: it swaps a working money path for a riskier one immediately before a demo. Do not take this. | **DECLINED** |

---

## Phase 5 — Standing verification

These already pass. They are listed so a builder knows what must **still** pass
after any change, and how to check.

| # | Task | Status |
|---|---|---|
| 5.1 | `npm test` — 32 passing against a live local cluster. | DONE |
| 5.2 | `scripts/prove-privacy.ts` locally — 11/11 including both refusals and the control. | DONE |
| 5.3 | `docs/BROWSER-TEST-PLAN.md` — 135/135 in a real browser, production build. | DONE |
| 5.4 | Zero mocks, stubs, fakes, placeholders or TODOs in shipped code. Re-verify with the grep in G7. | DONE |
| 5.5 | Zero console errors and zero failed network requests on all six routes. | DONE |
| 5.6 | WCAG AA on every text and ground pair, measured with alpha compositing. | DONE |
| 5.7 | No horizontal overflow at a **true** 375px viewport. Measure in a 375px same-origin iframe; window presets lie. | DONE |
| 5.8 | Design detector reports only the three findings pinned by the brief (Inter, Geist Mono, one-word gradient), all recorded in `DESIGN.md` §7. | DONE |

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
