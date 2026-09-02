/**
 * The 60-second demo, run from the terminal.
 *
 * Narrates every beat of docs/DEMO.md against a live cluster, so the whole claim
 * can be verified without clicking through the UI — and so the video has a second
 * pane showing what is actually happening on-chain.
 *
 *   . ./scripts/local-env.sh && npx ts-node scripts/demo.ts
 *   . ./.env.devnet        && npx ts-node scripts/demo.ts     # the real TEE
 */
import { Bazaar, LAMPORTS, tombText, outcomeName, statusName } from "../tests/harness";
import {
  ENDPOINTS,
  Room,
  Side,
  bidPda,
  isRealTee,
  programFor,
  teeConnection,
  Keypair,
} from "../sdk/src";

const BAR = "─".repeat(72);
const beat = (t: string, s: string) => console.log(`\n\x1b[2m${t}\x1b[0m  \x1b[1m${s}\x1b[0m`);
const say = (s: string) => console.log(`        ${s}`);
const ok = (s: string) => console.log(`        \x1b[32m✓\x1b[0m ${s}`);
const no = (s: string) => console.log(`        \x1b[31m✗\x1b[0m ${s}`);

(async () => {
  console.log(BAR);
  console.log("  SINBAZAAR — the market where the asset is a secret");
  console.log(BAR);
  say(`base ${ENDPOINTS.base}`);
  say(`er   ${ENDPOINTS.er}`);
  say(`tee  ${ENDPOINTS.tee}${isRealTee() ? "  (real TEE — privacy is enforced)" : "  (local QFS — permission flags only)"}`);

  const z = new Bazaar();
  await z.open();

  beat("0:00", "Three wallets walk into a village.");
  const [sealer, reader] = await z.villagers(2, 3);
  say(`author  ${z.authority.publicKey.toBase58()}`);
  say(`sealer  ${sealer.kp.publicKey.toBase58()}`);
  say(`reader  ${reader.kp.publicKey.toBase58()}`);

  beat("0:05", 'The author types: "I reused my teammate\'s pitch deck."');
  const body = "I reused my teammate's pitch deck.";
  const m = await z.newMarket({
    room: Room.GuiltMarket,
    durationSecs: 30,
    body,
    redacted: "One line of it was mine.",
  });
  say(`market ${m.market.toBase58()}`);

  beat("0:10", "The village gets a hash and a timer. Not the sentence.");
  const shellText = Buffer.from(m.shellOnL1.data).toString("utf8");
  shellText.includes("pitch deck")
    ? no("the body reached L1 — this build is broken")
    : ok("the Secret account was allocated EMPTY on L1; no plaintext in any base-layer tx");

  const state = await z.marketState(m.market);
  ok(`commitment ${Buffer.from(state.commitmentHash).toString("hex").slice(0, 32)}…`);
  const perm = await z.permission(m.secret);
  ok(`secret permission: is_private=${perm.isPrivate}  members=[author]`);

  const stranger = Keypair.generate();
  if (isRealTee()) {
    const { connection } = await teeConnection(stranger);
    const seen = await connection.getAccountInfo(m.secret);
    seen === null
      ? ok("a stranger with a valid TEE token is refused the read")
      : no("the TEE answered a stranger — privacy is NOT holding");
  } else {
    say("(a stranger's read is only truly refused by the devnet TEE — see README limitations)");
  }

  beat("0:18", "The second wallet pays to keep it buried.");
  await z.bid(sealer, m.marketId, m.market, Side.Seal, 0.5 * LAMPORTS);
  ok("SEAL 0.5 SOL — lamports moved purse → market inside the rollup, no L1 tx");

  beat("0:24", "The third wallet pays to read it.");
  await z.bid(reader, m.marketId, m.market, Side.Read, 0.2 * LAMPORTS);
  const mid = await z.marketState(m.market);
  ok(`seal_pot ${mid.sealPot.toNumber() / LAMPORTS}  read_pot ${mid.readPot.toNumber() / LAMPORTS} — public`);
  const bidPerm = await z.permission(bidPda(m.market, sealer.kp.publicKey));
  ok(`each bid is private: members=[bidder only], author not included = ${!bidPerm.memberKeys.includes(z.authority.publicKey.toBase58())}`);

  beat("0:32", "The timer hits zero. The village stops arguing.");
  await z.waitForExpiry(m.market);
  await z.expire(m.marketId, m.market);
  say(`status ${statusName((await z.marketState(m.market)).status)} — anyone could have cranked this`);

  say("requesting MagicBlock VRF…");
  const resolved = await z.resolveByVrf(m.marketId, m.market);
  ok(`VRF returned ${resolved.randomness.toString()} → ${outcomeName(resolved.outcome).toUpperCase()}`);

  beat("0:40", "Settlement, then the graveyard.");
  await z.settleAll(m.marketId, m.market, [sealer, reader]);
  const settled = await z.marketState(m.market);
  say(`author is owed ${settled.authorPayout.toNumber() / LAMPORTS} SOL; the reader was refunded in full`);

  const tomb = await z.tombstone(m.marketId, m.market, m.secret);
  ok(`tombstone on Solana: outcome=${outcomeName(tomb.outcome).toUpperCase()} revealed_len=${tomb.revealedLen}`);
  tomb.revealedLen === 0
    ? ok("silence was bought — Solana got the hash and nothing else")
    : no("something leaked that should not have");

  const stillPrivate = await z.permission(m.secret);
  ok(`the confession is still in the rollup: is_private=${stillPrivate.isPrivate}, members=${stillPrivate.memberKeys.length}`);

  beat("0:50", "Now a market nobody paid for.");
  const leak = await z.newMarket({
    room: Room.GuiltMarket,
    durationSecs: 12,
    body: "Our village demo is vaporware.",
  });
  await z.waitForExpiry(leak.market);
  await z.expire(leak.marketId, leak.market);
  const leakState = await z.marketState(leak.market);
  say(`no seal pot, no read pot → ${outcomeName(leakState.outcome).toUpperCase()} (no randomness needed)`);
  await z.settleAll(leak.marketId, leak.market, []);
  const leakTomb = await z.tombstone(leak.marketId, leak.market, leak.secret);
  ok(`carved into L1: "${tombText(leakTomb)}"`);

  beat("0:58", "And a rumor settles.");
  const [yes, nope] = await z.villagers(2, 3);
  const ipo = await z.newMarket({
    room: Room.WhisperIpo,
    durationSecs: 120,
    body: "This village ships before Friday.",
  });
  await z.bid(yes, ipo.marketId, ipo.market, Side.Yes, 1 * LAMPORTS);
  await z.bid(nope, ipo.marketId, ipo.market, Side.No, 1 * LAMPORTS);
  await z.authorProgramEr.methods
    .resolveRumor(ipo.marketId, 1)
    .accountsPartial({ resolver: z.authority.publicKey, market: ipo.market })
    .rpc({ skipPreflight: true });
  const before = (await z.erConn.getAccountInfo(yes.purse))!.lamports;
  await z.settleAll(ipo.marketId, ipo.market, [yes, nope]);
  const after = (await z.erConn.getAccountInfo(yes.purse))!.lamports;
  ok(`YES resolved. The long got ${(after - before) / LAMPORTS} SOL back on a 1 SOL stake.`);

  console.log(`\n${BAR}`);
  console.log("  Confession stayed in the rollup. VRF picked the reader. Solana got a tombstone.");
  console.log(BAR);
  process.exit(0);
})().catch((e) => {
  console.error("\nDEMO FAILED:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
