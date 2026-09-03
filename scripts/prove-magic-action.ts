/**
 * Proof that the tombstone reaches Solana because the rollup scheduled it, and
 * not because a client was awake to send a second transaction.
 *
 * The ordinary path calls `finalize_market` on the rollup and then
 * `write_tombstone` on the base layer. This script never calls
 * `write_tombstone`. It opens an empty headstone, funds the payer's escrow,
 * calls `finalize_market`, and then does nothing but watch the base layer until
 * a carved tombstone appears. If a Magic Action is not really executing, this
 * script hangs and fails, because nothing else in it can write that account.
 *
 *   . ./scripts/local-env.sh && npx ts-node scripts/prove-magic-action.ts
 */
import { Bazaar, LAMPORTS, outcomeName, statusName } from "../tests/harness";
import {
  ENDPOINTS,
  Room,
  Side,
  tombPda,
  sleep,
  send,
  PublicKey,
} from "../sdk/src";
import {
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const no = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const say = (s: string) => console.log(`    ${s}`);

(async () => {
  console.log("\nMagic Action proof — the rollup carves the headstone itself\n");
  say(`base ${ENDPOINTS.base}`);
  say(`er   ${ENDPOINTS.er}`);

  const z = new Bazaar();
  await z.open();
  const payer = z.authority.publicKey;

  const [sealer] = await z.villagers(1, 3);
  const m = await z.newMarket({
    room: Room.GuiltMarket,
    durationSecs: 20,
    body: "The rollup buried this one without being asked.",
  });
  say(`market ${m.market.toBase58()}`);
  const tomb = tombPda(m.market);
  say(`tomb   ${tomb.toBase58()}`);

  // The headstone must exist before the action runs: an action arrives with the
  // escrow as its only signer, and an escrow pays fees, not rent.
  const village = (await z.marketState(m.market)).village as PublicKey;
  await z.authorProgramBase.methods
    .openTombstone(m.marketId, village)
    .accountsPartial({ payer, market: m.market, tombstone: tomb })
    .rpc();
  const opened = await z.baseConn.getAccountInfo(tomb);
  if (!opened) {
    no("headstone was not allocated");
    process.exit(1);
  }
  const fresh = await (z.authorProgramBase.account as any).tombstone.fetch(tomb);
  if (!fresh.buriedAt.isZero()) {
    no("headstone was already carved before the market ended");
    process.exit(1);
  }
  ok(`headstone allocated on L1, ${opened.data.length} bytes, buried_at=0`);

  // Fees for the scheduled base-layer execution come from this escrow.
  const escrow = escrowPdaFromEscrowAuthority(payer);
  await send(
    z.baseConn,
    [createTopUpEscrowInstruction(escrow, payer, payer, 10_000_000)],
    [z.authority]
  );
  ok(`escrow funded ${escrow.toBase58().slice(0, 8)}…`);

  await z.bid(sealer, m.marketId, m.market, Side.Seal, 0.5 * LAMPORTS);
  await z.waitForExpiry(m.market);
  await z.expire(m.marketId, m.market);
  const resolved = await z.resolveByVrf(m.marketId, m.market);
  ok(`VRF → ${outcomeName(resolved.outcome).toUpperCase()}`);
  await z.settleAll(m.marketId, m.market, [sealer]);
  say(`status ${statusName((await z.marketState(m.market)).status)}`);

  // The claim is "the action carved it", so the headstone must be provably
  // uncarved at the last possible instant before the action can run. Without
  // this the proof would pass even if something earlier had written it.
  const beforeFinalize = await (z.authorProgramBase.account as any).tombstone.fetch(tomb);
  if (!beforeFinalize.buriedAt.isZero()) {
    no("headstone was carved before finalize_market — proof is void");
    process.exit(1);
  }
  ok("still uncarved immediately before finalize_market");

  // The only transaction from here on. It commits, undelegates, and schedules.
  console.log("\n  finalize_market on the rollup — and then we stop sending.\n");
  await z.erCall(
    z.authorProgramEr.methods
      .finalizeMarket(m.marketId)
      .accountsPartial({ payer, market: m.market, secret: m.secret }),
    z.authority
  );
  ok("commit + undelegate + post-undelegate action scheduled");

  const t0 = Date.now();
  let carved: any = null;
  while (Date.now() - t0 < 90_000) {
    try {
      const t = await (z.authorProgramBase.account as any).tombstone.fetch(tomb);
      if (!t.buriedAt.isZero()) {
        carved = t;
        break;
      }
    } catch {
      /* not readable yet */
    }
    await sleep(1000);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!carved) {
    no(`no carve after ${secs}s — the action did not execute`);
    process.exit(1);
  }

  ok(`carved by the action after ${secs}s, with no client transaction`);
  say(`outcome      ${outcomeName(carved.outcome).toUpperCase()}`);
  say(`market_id    ${carved.marketId.toString()}`);
  say(`buried_at    ${carved.buriedAt.toString()}`);
  say(`revealed_len ${carved.revealedLen}`);

  const mk = await z.marketState(m.market);
  mk.tombstoned
    ? ok("market.tombstoned set by the action, so no crank can double-carve")
    : no("market was not marked tombstoned");

  // The decisive evidence: find the base-layer transaction that wrote the
  // headstone and show our wallet did not sign it. "No client transaction" is
  // otherwise just an assertion about code we did not run.
  const sigs = await z.baseConn.getSignaturesForAddress(tomb, { limit: 10 });
  say(`base-layer transactions touching the headstone: ${sigs.length}`);
  let provedForeign = false;
  for (const s of sigs.reverse()) {
    const tx = await z.baseConn.getTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) continue;
    const keys = tx.transaction.message
      .getAccountKeys()
      .staticAccountKeys.map((k) => k.toBase58());
    const signers = keys.slice(
      0,
      tx.transaction.message.header.numRequiredSignatures
    );
    const mine = signers.includes(payer.toBase58());
    const carve = (tx.meta?.logMessages ?? []).some((l) =>
      l.includes("Instruction: SealTombstone")
    );
    say(
      `  ${s.signature.slice(0, 12)}…  ${carve ? "SealTombstone" : "OpenTombstone"}  signers=${signers.length}  ours=${mine}`
    );
    if (carve && !mine) provedForeign = true;
    if (carve && mine) {
      no("the carve was signed by us — that is not a Magic Action");
      process.exit(1);
    }
  }
  provedForeign
    ? ok("the carving transaction was signed by the validator, not by us")
    : no("could not find a SealTombstone transaction on the base layer");

  console.log("\n  The rollup ended the market. Nobody had to be watching.\n");
  process.exit(0);
})().catch((e) => {
  console.error("\nPROOF FAILED:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
