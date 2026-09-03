/**
 * Verify a market's whole claim from public data alone.
 *
 *   npm run verify:market <market address>
 *   npm run verify:market --all
 *
 * ## Why this exists
 *
 * Every other proof in this project runs inside the app: the challenge probes,
 * the in-browser commitment verifier, the layer race, the lifecycle strip. All
 * of them are our code reporting on our code, which is exactly the position a
 * sceptic should not accept.
 *
 * This runs outside the app, reads **only the base layer**, touches no rollup
 * and no TEE, needs no key, and is able to fail. It asks the questions a judge
 * would ask if they were trying to catch us:
 *
 *   1. Does the published sentence actually hash to the commitment that was
 *      sealed before any bid was placed?
 *   2. Did the outcome follow the room's rule, given the pots that are on chain?
 *   3. Did anything get published that the verdict did not authorise?
 *   4. Was the salt disclosed only where disclosing it is safe?
 *   5. Does the tombstone agree with the market account it came from?
 *
 * A failure here is a real failure. The exit code is non-zero and the assertion
 * that failed says which claim is broken, so this is worth running against a
 * build you distrust rather than one you already believe.
 *
 * ## What it deliberately cannot see
 *
 * The confession itself, unless the verdict published it. That is the point: a
 * verifier that needed the plaintext would be proving nothing about privacy.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { baseConnection, programFor, Keypair, ENDPOINTS } from "../sdk/src";

const ok = (s: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${s}`);
const bad = (s: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${s}`);
const skip = (s: string) => console.log(`  \x1b[2mn/a \x1b[0m  ${s}`);
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/** Outcomes the program allows to publish plaintext. `Outcome::reveals_text()`. */
const REVEALS_TEXT = new Set(["publicLeak", "randomReveal"]);
/**
 * Only a public leak may publish the salt.
 *
 * `finalize_market` sets `revealed_salt` for PublicLeak and explicitly zeroes it
 * for RandomReveal, because a RandomReveal publishes the author's redacted line
 * while the body stays sealed: handing over the salt as well would give anyone
 * an offline dictionary attack against a 180-byte secret.
 */
const PUBLISHES_SALT = new Set(["publicLeak"]);

const variant = (v: unknown): string =>
  v && typeof v === "object" ? Object.keys(v as object)[0] ?? "" : String(v);

interface Result {
  market: string;
  checks: number;
  failures: string[];
}

function sha256(parts: Uint8Array[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(Buffer.from(p));
  return h.digest();
}

async function verify(address: string): Promise<Result> {
  const base = baseConnection();
  const program = programFor(base, Keypair.generate());
  const accounts = (program.account as any);

  const market = new PublicKey(address);
  const res: Result = { market: address, checks: 0, failures: [] };
  const assert = (condition: boolean, label: string) => {
    res.checks += 1;
    if (condition) ok(label);
    else {
      bad(label);
      res.failures.push(label);
    }
  };

  // Tombstones are addressed by the market they belong to.
  const [tombPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tomb"), market.toBuffer()],
    program.programId
  );

  const tomb = await accounts.tombstone.fetchNullable(tombPda);
  if (!tomb) {
    head(`${address}`);
    skip("no tombstone on the base layer: this market has not been buried yet");
    return res;
  }

  // An allocated but uncarved headstone carries no verdict to check. It is
  // created ahead of time so a Magic Action has somewhere to land, and until it
  // is carved `buried_at` is 0. Asserting a rule against it would be this
  // verifier inventing a claim the chain never made.
  if (Number(tomb.buriedAt) === 0) {
    head(`${address}`);
    skip("a headstone is allocated but not yet carved (buried_at 0), so there is no verdict to verify");
    return res;
  }

  const outcome = variant(tomb.outcome);
  const room = variant(tomb.room);
  const revealedLen = Number(tomb.revealedLen);
  const revealed: number[] = Array.from(tomb.revealed as number[]).slice(0, revealedLen);
  const salt: number[] = Array.from(tomb.revealedSalt as number[]);
  const commitment: number[] = Array.from(tomb.commitmentHash as number[]);
  const saltIsZero = salt.every((b) => b === 0);
  const sealPot = Number(tomb.sealPot);
  const readPot = Number(tomb.readPot);

  head(`${address}   room ${room}   outcome ${outcome}`);

  // 1. The commitment. Only checkable when the verdict published both the body
  //    and the salt; anything else and there is nothing here to check against,
  //    which is a fact about the verdict rather than a gap in this verifier.
  if (revealedLen > 0 && !saltIsZero) {
    const digest = sha256([Uint8Array.from(revealed), Uint8Array.from(salt)]);
    const matches = digest.equals(Buffer.from(commitment));
    assert(
      matches,
      `sha256(published body ‖ published salt) equals the commitment sealed before any bid`
    );
    if (!matches) {
      console.log(`        computed ${digest.toString("hex")}`);
      console.log(`        sealed   ${Buffer.from(commitment).toString("hex")}`);
    }
  } else if (revealedLen > 0) {
    skip("a body was published without its salt, so the commitment cannot be reproduced");
  } else {
    skip("nothing was published, so there is no body to check against the commitment");
  }

  // 2. Nothing published that the verdict did not authorise. This is the
  //    privacy claim reduced to something a stranger can check.
  assert(
    REVEALS_TEXT.has(outcome) || revealedLen === 0,
    `outcome '${outcome}' does not authorise text, and none was published (revealed_len ${revealedLen})`
  );

  // 3. The salt is disclosed only where disclosure is safe.
  assert(
    PUBLISHES_SALT.has(outcome) || saltIsZero,
    `outcome '${outcome}' does not authorise the salt, and none was published`
  );

  // 4. The room's rule, re-derived from the pots on chain. Guilt Market is
  //    fully deterministic in `callback_resolve`, so this is exact.
  if (room === "guiltMarket") {
    const expected = sealPot > 0 ? "buried" : readPot > 0 ? "soleReader" : "publicLeak";
    assert(
      outcome === expected,
      `the room's rule maps seal ${sealPot} / read ${readPot} to '${expected}', and the chain says '${outcome}'`
    );
  } else {
    skip(`'${room}' resolves with randomness or an attestation; its pots alone do not fix the outcome`);
  }

  // 5. A reader was named exactly when one was chosen.
  const nobody = "11111111111111111111111111111111";
  const readerNamed = tomb.soleReader.toBase58() !== nobody;
  const shouldName = outcome === "soleReader" || outcome === "inherited";
  assert(
    shouldName === readerNamed,
    shouldName
      ? `outcome '${outcome}' chose a reader, and one is named`
      : `outcome '${outcome}' chose no reader, and none is named`
  );

  // 6. The read receipt is a claim the reader made, so it may only exist where
  //    a reader existed to make it.
  const readAt = Number(tomb.readAt);
  assert(
    readAt === 0 || readerNamed,
    readAt === 0
      ? "no read was claimed"
      : "a read was claimed, and a reader was named to claim it"
  );

  // 7. The tombstone must agree with the market account it was carved from.
  //    A settled market is undelegated, so this is a base-layer read too.
  const m = await accounts.market.fetchNullable(market);
  if (!m) {
    skip("the market account is not on the base layer, so the tombstone cannot be cross-checked");
  } else {
    const agree =
      Number(m.sealPot) === sealPot &&
      Number(m.readPot) === readPot &&
      variant(m.outcome) === outcome &&
      Buffer.from(m.commitmentHash as number[]).equals(Buffer.from(commitment));
    assert(
      agree,
      "the tombstone's pots, outcome and commitment match the market account itself"
    );
    assert(Boolean(m.tombstoned), "the market is marked tombstoned, so it cannot be carved twice");
  }

  return res;
}

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const all = process.argv.includes("--all");

  console.log(`\nSINBAZAAR market verifier`);
  console.log(`base layer: ${ENDPOINTS.base}`);
  console.log(`reads the base layer only. No rollup, no TEE, no key.`);

  let targets = args;
  if (all || targets.length === 0) {
    const program = programFor(baseConnection(), Keypair.generate());
    const rows = await (program.account as any).tombstone.all();
    targets = rows.map((r: any) => r.account.market.toBase58());
    console.log(`verifying every buried market on this cluster: ${targets.length}`);
  }

  let checks = 0;
  const failures: string[] = [];
  for (const t of targets) {
    const r = await verify(t);
    checks += r.checks;
    for (const f of r.failures) failures.push(`${r.market}: ${f}`);
  }

  console.log(`\n${"─".repeat(72)}`);
  if (failures.length === 0) {
    console.log(`  \x1b[32m${checks} assertions, all passed\x1b[0m across ${targets.length} market(s).`);
    console.log(`  Checked from public base-layer data alone.`);
    process.exit(0);
  }
  console.log(`  \x1b[31m${failures.length} of ${checks} assertions FAILED\x1b[0m:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
})().catch((e) => {
  console.error("\nVERIFIER ERROR:", e?.message || e);
  process.exit(2);
});
