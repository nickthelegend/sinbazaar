/**
 * The privacy challenge.
 *
 * Everything else in SINBAZAAR is a market. This is the claim the whole project
 * rests on, and the only one that needs a real TEE to test:
 *
 *   a confession sealed inside a Private Ephemeral Rollup cannot be read from the
 *   base layer, cannot be read over an unauthenticated rollup connection, and
 *   cannot be read by a stranger holding a perfectly valid TEE auth token.
 *
 * Run it against devnet, where the validator is an actual TEE:
 *   . ./.env.devnet && npx ts-node scripts/prove-privacy.ts
 *
 * Locally it still runs, and still checks the permission flags — but the local
 * query-filtering service is not a TEE and answers reads it should refuse, so the
 * refusal assertions are reported as NOT PROVEN rather than passed.
 */
import {
  BN,
  ENDPOINTS,
  Keypair,
  PublicKey,
  Room,
  VALIDATOR,
  baseConnection,
  commitmentHash,
  erConnection,
  isRealTee,
  marketPda,
  programFor,
  randomSalt,
  readPermission,
  secretPda,
  sleep,
  teeConnection,
  villagePda,
} from "../sdk/src";
import * as fs from "fs";

const BODY = "I reused my teammate's pitch deck.";
const pass = (s: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${s}`);
const fail = (s: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${s}`);
const skip = (s: string) => console.log(`  \x1b[33mN/A \x1b[0m  ${s}`);
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

let failures = 0;
const check = (cond: boolean, s: string) => (cond ? pass(s) : (failures++, fail(s)));

async function waitOn(conn: any, key: PublicKey, label: string, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await conn.getAccountInfo(key)) return;
    await sleep(1000);
  }
  throw new Error(`${label} never appeared at ${conn.rpcEndpoint}`);
}

(async () => {
  const real = isRealTee();
  console.log("SINBAZAAR — privacy challenge");
  console.log(`  base ${ENDPOINTS.base}`);
  console.log(`  tee  ${ENDPOINTS.tee}${real ? "  (real TEE)" : "  (local QFS — refusals cannot be proven here)"}`);

  const author = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET || "./keys/deployer.json", "utf8")))
  );
  const base = baseConnection();
  const er = erConnection();
  console.log(`  author ${author.publicKey.toBase58()}  (${(await base.getBalance(author.publicKey)) / 1e9} SOL)`);

  const pBase = programFor(base, author);
  const village = villagePda(author.publicKey);
  if (!(await base.getAccountInfo(village))) {
    await pBase.methods
      .initializeVillage(true)
      .accountsPartial({ authority: author.publicKey, village })
      .rpc();
  }

  const marketId = new BN(Date.now() % 1_000_000_000);
  const market = marketPda(village, marketId);
  const secret = secretPda(market);

  head("1. The confession is never submitted in a base-layer transaction");
  await pBase.methods
    .createMarket(marketId, Room.GuiltMarket, new BN(900), new BN(0), new BN(0))
    .accountsPartial({ author: author.publicKey, village, market })
    .rpc();
  await pBase.methods
    .createSecretShell(marketId)
    .accountsPartial({ author: author.publicKey, market, secret })
    .rpc();
  const shell = await base.getAccountInfo(secret);
  const shellBody = shell!.data.subarray(8 + 32 + 32 + 32 + 2, 8 + 32 + 32 + 32 + 2 + 180);
  check(shellBody.every((b) => b === 0), "the Secret account is allocated EMPTY on L1");
  console.log(`        secret ${secret.toBase58()}`);

  head("2. It is written only inside the rollup");
  await pBase.methods
    .delegateMarket(marketId)
    .accountsPartial({ author: author.publicKey, village, market, validator: VALIDATOR })
    .rpc();
  await pBase.methods
    .delegateSecret(marketId)
    .accountsPartial({ author: author.publicKey, village, market, secret, validator: VALIDATOR })
    .rpc();
  console.log(`        delegated to ${VALIDATOR.toBase58()}`);

  const { connection: authorTee } = await teeConnection(author);
  const pTee = programFor(authorTee, author);
  await waitOn(authorTee, market, "market");
  await waitOn(authorTee, secret, "secret");

  const send = async (b: any) => {
    const ix = await b.instruction();
    const { Transaction } = await import("@solana/web3.js");
    const tx = new Transaction().add(ix);
    tx.feePayer = author.publicKey;
    tx.recentBlockhash = (await authorTee.getLatestBlockhash()).blockhash;
    tx.sign(author);
    const sig = await authorTee.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    for (let i = 0; i < 60; i++) {
      const t = await authorTee.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (t) {
        if (t.meta?.err) throw new Error(`${JSON.stringify(t.meta.err)}\n${(t.meta.logMessages ?? []).join("\n")}`);
        return sig;
      }
      await sleep(1000);
    }
    throw new Error("tx never confirmed");
  };

  await send(pTee.methods.initMarketPermission(marketId).accountsPartial({ payer: author.publicKey, market }));
  await send(pTee.methods.initSecretPermission(marketId).accountsPartial({ payer: author.publicKey, market, secret }));

  const salt = randomSalt();
  await send(
    pTee.methods
      .sealSecret(marketId, Buffer.from(BODY, "utf8"), Array.from(salt), Buffer.from("One line of it was mine.", "utf8"))
      .accountsPartial({ author: author.publicKey, market, secret })
  );
  const perm = await readPermission(authorTee, secret);
  check(perm.isPrivate, "the secret's ephemeral permission is PRIVATE");
  check(
    perm.memberKeys.length === 1 && perm.memberKeys[0] === author.publicKey.toBase58(),
    `the member list is exactly [author] (${perm.memberKeys.join(", ")})`
  );

  head("3. The author — and only the author — can read it");
  const mine: any = await (pTee.account as any).secret.fetch(secret);
  const readBack = Buffer.from(mine.body).subarray(0, mine.bodyLen).toString("utf8");
  check(readBack === BODY, `the author reads it back through their own TEE token: "${readBack}"`);

  const marketState: any = await (pTee.account as any).market.fetch(market);
  check(
    Buffer.from(marketState.commitmentHash).equals(commitmentHash(BODY, salt)),
    "the public commitment is sha256(body || salt) — any later reveal is verifiable"
  );

  head("4. Nobody else can");
  const onBase = await base.getAccountInfo(secret);
  check(
    !Buffer.from(onBase!.data).toString("utf8").includes("pitch deck"),
    "the base layer still shows an empty body (the secret is never undelegated)"
  );

  const anon = await er.getAccountInfo(secret).catch(() => null);
  if (real) {
    check(anon === null, "an unauthenticated rollup connection is refused the account");
  } else {
    skip("unauthenticated rollup read — the local QFS answers it; only a TEE refuses");
  }

  const stranger = Keypair.generate();
  const { connection: strangerTee, token } = await teeConnection(stranger);
  console.log(`        stranger ${stranger.publicKey.toBase58()} holds a valid token (${token.slice(0, 24)}…)`);
  let strangerSaw: any = null;
  try {
    strangerSaw = await strangerTee.getAccountInfo(secret);
  } catch {
    strangerSaw = null;
  }
  if (real) {
    check(strangerSaw === null, "a stranger with a VALID TEE token is refused the confession");
  } else {
    skip("stranger read — the local QFS answers it; only a TEE refuses");
  }

  // The market, by contrast, is meant to be public.
  const marketPerm = await readPermission(authorTee, market);
  check(!marketPerm.isPrivate, "the market itself is public — hash, timer and pots are readable");
  const strangerMarket = await strangerTee.getAccountInfo(market).catch(() => null);
  check(strangerMarket !== null, "a stranger CAN read the market — the game is public, the secret is not");

  console.log("");
  console.log(`market  https://explorer.solana.com/address/${market.toBase58()}?cluster=devnet`);
  console.log(`secret  https://explorer.solana.com/address/${secret.toBase58()}?cluster=devnet`);
  console.log(
    `        try it yourself: the explorer shows an account owned by the delegation program with an empty body.`
  );

  console.log("");
  if (failures === 0 && real) {
    console.log("\x1b[32mPRIVACY PROVEN against the devnet TEE.\x1b[0m");
  } else if (failures === 0) {
    console.log("\x1b[33mAll local checks passed. Re-run with .env.devnet to prove the refusals.\x1b[0m");
  } else {
    console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m`);
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\nERROR:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
