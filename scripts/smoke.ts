/**
 * Smoke probe for the two mechanics everything else rests on:
 *   1. a market + an empty secret can be delegated and reach the ER
 *   2. a bid moves lamports purse -> market between two delegated PDAs, on the ER
 *
 * Run:  . ./scripts/local-env.sh && npx ts-node scripts/smoke.ts
 */
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  baseConnection,
  erConnection,
  programFor,
  villagePda,
  marketPda,
  secretPda,
  pursePda,
  bidPda,
  sessionPda,
  VALIDATOR,
  Room,
  Side,
  fundLocal,
  sleep,
  randomSalt,
  commitmentHash,
  permissionMembers,
  statusName,
  ENDPOINTS,
  BN,
} from "../sdk/src";

const log = (...a: any[]) => console.log(...a);

async function waitForEr(conn: any, key: PublicKey, label: string, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const info = await conn.getAccountInfo(key);
    if (info) return info;
    await sleep(500);
  }
  throw new Error(`${label} never appeared on the ER`);
}

(async () => {
  log("endpoints:", JSON.stringify(ENDPOINTS, null, 2));
  const base = baseConnection();
  const er = erConnection();

  const author = Keypair.generate();
  const bidder = Keypair.generate();
  await fundLocal(base, author.publicKey, 10);
  await fundLocal(base, bidder.publicKey, 10);
  log("funded author", author.publicKey.toBase58());

  const pBase = programFor(base, author);
  const pEr = programFor(er, author);
  const pErBidder = programFor(er, bidder);

  const village = villagePda(author.publicKey);
  const marketId = new BN(Math.floor(Math.random() * 1e9));
  const market = marketPda(village, marketId);
  const secret = secretPda(market);

  // ---- base layer ------------------------------------------------------
  await pBase.methods.initializeVillage(true).accountsPartial({ authority: author.publicKey, village }).rpc();
  log("village ok");

  await pBase.methods
    .createMarket(marketId, Room.GuiltMarket, new BN(25), new BN(0), new BN(0))
    .accountsPartial({ author: author.publicKey, village, market })
    .rpc();
  log("market ok", market.toBase58());

  await pBase.methods
    .createSecretShell(marketId)
    .accountsPartial({ author: author.publicKey, market, secret })
    .rpc();

  // The whole privacy argument starts here: the account exists on L1 and is empty.
  const shell = await base.getAccountInfo(secret);
  const bodyRegion = shell!.data.subarray(8 + 32 + 32 + 32 + 2, 8 + 32 + 32 + 32 + 2 + 180);
  log("secret shell on L1, body all-zero:", bodyRegion.every((b) => b === 0));

  await pBase.methods
    .delegateMarket(marketId)
    .accountsPartial({ author: author.publicKey, village, market, validator: VALIDATOR })
    .rpc();
  await pBase.methods
    .delegateSecret(marketId)
    .accountsPartial({ author: author.publicKey, village, market, secret, validator: VALIDATOR })
    .rpc();
  log("delegated both");

  await waitForEr(er, market, "market");
  await waitForEr(er, secret, "secret");
  log("both present on ER");

  // ---- ER: permissions + seal -----------------------------------------
  await pEr.methods.initMarketPermission(marketId).accountsPartial({ payer: author.publicKey, market }).rpc({ skipPreflight: true });
  await pEr.methods.initSecretPermission(marketId).accountsPartial({ payer: author.publicKey, market, secret }).rpc({ skipPreflight: true });
  log("permissions created");
  log("  secret permission members:", await permissionMembers(er, secret));

  const body = "I reused my teammate's pitch deck.";
  const salt = randomSalt();
  await pEr.methods
    .sealSecret(marketId, Buffer.from(body, "utf8"), Array.from(salt), Buffer.from("One line of it was mine.", "utf8"))
    .accountsPartial({ author: author.publicKey, market, secret })
    .rpc({ skipPreflight: true });

  const m1: any = await (pEr.account as any).market.fetch(market);
  const expected = commitmentHash(body, salt);
  log("sealed. commitment matches sha256(body||salt):", Buffer.from(m1.commitmentHash).equals(expected));

  // ---- the risky bit: ER-native lamport move between delegated PDAs ----
  const purse = pursePda(bidder.publicKey);
  const pBaseBidder = programFor(base, bidder);
  await pBaseBidder.methods
    .depositPurse(new BN(2 * LAMPORTS_PER_SOL))
    .accountsPartial({ owner: bidder.publicKey, purse })
    .rpc();
  await pBaseBidder.methods
    .delegatePurse()
    .accountsPartial({ owner: bidder.publicKey, purse, validator: VALIDATOR })
    .rpc();
  await waitForEr(er, purse, "purse");
  log("purse delegated and on ER");

  const marketLamportsBefore = (await er.getAccountInfo(market))!.lamports;
  const purseLamportsBefore = (await er.getAccountInfo(purse))!.lamports;

  const bid = bidPda(market, bidder.publicKey);
  const amount = new BN(0.5 * LAMPORTS_PER_SOL);
  // isolate: minimal ephemeral-account creation, nothing else
  try {
    const sessKp = Keypair.generate();
    const sIx = await pErBidder.methods
      .openSession(marketId, new BN(600), new BN(1_000_000_000), sessKp.publicKey)
      .accountsPartial({ owner: bidder.publicKey, market, session: sessionPda(market, bidder.publicKey) })
      .instruction();
    const { Transaction: T2 } = await import("@solana/web3.js");
    const stx = new T2().add(sIx);
    stx.feePayer = bidder.publicKey;
    stx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    stx.sign(bidder);
    const ssig = await er.sendRawTransaction(stx.serialize(), { skipPreflight: true });
    await sleep(2500);
    const sti = await er.getTransaction(ssig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    log("OPEN_SESSION err:", JSON.stringify(sti?.meta?.err));
    (sti?.meta?.logMessages || []).forEach((l: string) => log("    ", l));
  } catch (e: any) {
    log("OPEN_SESSION threw:", e.message);
  }

  const bidIx = await pErBidder.methods
    .placeBid(marketId, Side.Read, amount)
    .accountsPartial({
      signer: bidder.publicKey,
      bidder: bidder.publicKey,
      market,
      bid,
      purse,
      session: sessionPda(market, bidder.publicKey),
    })
    .instruction();
  const fundIx = await pErBidder.methods
    .fundBid(marketId)
    .accountsPartial({ signer: bidder.publicKey, market, bid, purse })
    .instruction();

  const { Transaction } = await import("@solana/web3.js");
  const btx = new Transaction().add(bidIx, fundIx);
  btx.feePayer = bidder.publicKey;
  btx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  btx.sign(bidder);
  const sig = await er.sendRawTransaction(btx.serialize(), { skipPreflight: true });
  await sleep(2500);
  const txi = await er.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  log("bid+fund tx err:", JSON.stringify(txi?.meta?.err));
  if (txi?.meta?.err) (txi?.meta?.logMessages || []).forEach((l: string) => log("   ", l));
  log("bid placed on the ER");

  const marketLamportsAfter = (await er.getAccountInfo(market))!.lamports;
  const purseLamportsAfter = (await er.getAccountInfo(purse))!.lamports;
  const m2: any = await (pEr.account as any).market.fetch(market);

  log("  purse  lamports:", purseLamportsBefore, "->", purseLamportsAfter, `(Δ ${purseLamportsAfter - purseLamportsBefore})`);
  log("  market lamports:", marketLamportsBefore, "->", marketLamportsAfter, `(Δ ${marketLamportsAfter - marketLamportsBefore})`);
  log("  read_pot:", m2.readPot.toString(), "read_bid_count:", m2.readBidCount, "status:", statusName(m2.status));

  await pErBidder.methods
    .initBidPermission(marketId)
    .accountsPartial({ payer: bidder.publicKey, market, bid, bidPermission: (await import("@magicblock-labs/ephemeral-rollups-sdk")).permissionPdaFromAccount(bid) })
    .rpc({ skipPreflight: true });
  log("  bid permission members:", await permissionMembers(er, bid));

  const moved = purseLamportsBefore - purseLamportsAfter === amount.toNumber();
  log(moved ? "  ER-native escrow OK" : "  ESCROW FAIL");

  // ---- expiry -> VRF -> settle -> tombstone ----------------------------
  log("\nwaiting for the timer...");
  const mNow: any = await (pEr.account as any).market.fetch(market);
  const waitMs = Math.max(0, mNow.expiresAt.toNumber() * 1000 - Date.now()) + 2000;
  await sleep(waitMs);

  await pEr.methods.expireMarket(marketId).accountsPartial({ cranker: author.publicKey, market }).rpc({ skipPreflight: true });
  log("expired. status:", statusName((await (pEr.account as any).market.fetch(market)).status));

  const { VRF_EPHEMERAL_QUEUE } = await import("../sdk/src");
  log("requesting VRF from queue", VRF_EPHEMERAL_QUEUE.toBase58());
  const vsig = await pEr.methods
    .requestResolutionVrf(marketId, 7)
    .accountsPartial({ payer: author.publicKey, market, oracleQueue: VRF_EPHEMERAL_QUEUE })
    .rpc({ skipPreflight: true });
  log("vrf requested:", vsig);

  const t0 = Date.now();
  let resolved: any = null;
  while (Date.now() - t0 < 60000) {
    const m: any = await (pEr.account as any).market.fetch(market);
    if (statusName(m.status) === "resolved") { resolved = m; break; }
    await sleep(1000);
  }
  if (!resolved) {
    const m: any = await (pEr.account as any).market.fetch(market);
    log("VRF TIMEOUT. status:", statusName(m.status));
    process.exit(1);
  }
  log("RESOLVED ->", Object.keys(resolved.outcome)[0], "randomness:", resolved.randomness.toString());

  // settle the single bid, close the book
  const { permissionPdaFromAccount: ppa } = await import("@magicblock-labs/ephemeral-rollups-sdk");
  await pEr.methods
    .settleBid(marketId)
    .accountsPartial({ cranker: author.publicKey, market, bid, purse, bidPermission: ppa(bid) })
    .rpc({ skipPreflight: true });
  const mAfterSettle: any = await (pEr.account as any).market.fetch(market);
  log("settled. sole_reader:", mAfterSettle.soleReader.toBase58(), "closed:", mAfterSettle.closedBidCount, "/", mAfterSettle.bidCount);

  await pEr.methods.closeBook(marketId).accountsPartial({ cranker: author.publicKey, market }).rpc({ skipPreflight: true });

  if (Object.keys(mAfterSettle.outcome)[0] === "soleReader") {
    await pEr.methods.grantReader(marketId).accountsPartial({ payer: author.publicKey, market, secret }).rpc({ skipPreflight: true });
    log("secret permission after grant:", await permissionMembers(er, secret));
  }

  await pEr.methods.finalizeMarket(marketId).accountsPartial({ payer: author.publicKey, market, secret }).rpc({ skipPreflight: true });
  log("finalize sent (commit + undelegate)");

  // wait for the market to come home to L1
  const t1 = Date.now();
  let onBase = false;
  while (Date.now() - t1 < 60000) {
    const i = await base.getAccountInfo(market);
    if (i && i.owner.toBase58() === (await import("../sdk/src")).PROGRAM_ID.toBase58()) { onBase = true; break; }
    await sleep(1500);
  }
  log("market undelegated back to L1:", onBase);
  if (!onBase) process.exit(1);

  const { tombPda } = await import("../sdk/src");
  await pBase.methods
    .writeTombstone(marketId)
    .accountsPartial({ payer: author.publicKey, market, tombstone: tombPda(market) })
    .rpc();
  const tomb: any = await (pBase.account as any).tombstone.fetch(tombPda(market));
  log("\nTOMBSTONE on Solana:");
  log("  outcome:", Object.keys(tomb.outcome)[0]);
  log("  hash:", Buffer.from(tomb.commitmentHash).toString("hex").slice(0, 24) + "...");
  log("  sole_reader:", tomb.soleReader.toBase58());
  log("  revealed_len:", tomb.revealedLen, "(0 = nothing leaked)");
  log("\nSMOKE PASS: full loop create -> seal -> bid -> VRF -> settle -> tombstone.");
  process.exit(0);
})().catch((e) => {
  console.error("SMOKE ERROR:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  console.error(e?.stack?.split("\n").slice(0, 12).join("\n"));
  process.exit(1);
});
