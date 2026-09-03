/**
 * Is the program running on the cluster the one in this repository?
 *
 *   npm run verify:program
 *
 * Every other claim this project makes is a claim about what the program does.
 * All of them are worthless if the bytes on the cluster are not the bytes that
 * were built from the source a judge is reading. This checks that, and it is the
 * cheapest possible way to foreclose the obvious question.
 *
 * It fetches the on-chain programdata, strips the upgradeable loader's header,
 * and compares the sha256 of what remains against the sha256 of
 * `target/deploy/sinbazaar.so`. Deployed bytes are zero-padded to the allocated
 * length, so the comparison is made against the artifact's own length and the
 * padding is checked separately: a mismatch inside the padding would mean
 * something is there that the build did not put there.
 *
 * Exit codes: 0 identical, 1 different, 2 could not be checked.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { baseConnection, ENDPOINTS, PROGRAM_ID } from "../sdk/src";

/** `UpgradeableLoaderState::ProgramData` is 45 bytes before the ELF begins. */
const PROGRAMDATA_HEADER = 45;

const sha = (b: Uint8Array) => createHash("sha256").update(Buffer.from(b)).digest("hex");

(async () => {
  // `__dirname` rather than `import.meta`: this repo's ts-node runs CommonJS.
  const root = join(__dirname, "..");
  const artifactPath = join(root, "target", "deploy", "sinbazaar.so");

  console.log(`\nSINBAZAAR program attestation`);
  console.log(`cluster : ${ENDPOINTS.base}`);
  console.log(`program : ${PROGRAM_ID.toBase58()}`);

  if (!existsSync(artifactPath)) {
    console.error(`\nCANNOT CHECK: ${artifactPath} does not exist. Run 'anchor build' first.`);
    process.exit(2);
  }
  const artifact = readFileSync(artifactPath);

  const connection = baseConnection();
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    console.error(`\nCANNOT CHECK: no program account at that address on this cluster.`);
    process.exit(2);
  }

  // An upgradeable program's account holds the address of its programdata.
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  );
  const dataInfo = await connection.getAccountInfo(programDataAddress);
  if (!dataInfo) {
    console.error(`\nCANNOT CHECK: no programdata account. Is this program non-upgradeable?`);
    process.exit(2);
  }

  const deployed = dataInfo.data.subarray(PROGRAMDATA_HEADER);
  const comparable = deployed.subarray(0, artifact.length);
  const padding = deployed.subarray(artifact.length);
  const paddingIsEmpty = padding.every((b) => b === 0);

  const localHash = sha(artifact);
  const chainHash = sha(comparable);

  console.log(`\nbuilt artifact : ${artifact.length.toLocaleString()} bytes`);
  console.log(`  sha256       : ${localHash}`);
  console.log(`deployed bytes : ${deployed.length.toLocaleString()} bytes (${padding.length.toLocaleString()} of trailing padding)`);
  console.log(`  sha256       : ${chainHash}`);

  const identical = localHash === chainHash;
  console.log("");
  if (identical && paddingIsEmpty) {
    console.log(`  \x1b[32mIDENTICAL\x1b[0m  the cluster is running exactly these bytes.`);
    process.exit(0);
  }
  if (identical && !paddingIsEmpty) {
    console.log(`  \x1b[31mDIFFERENT\x1b[0m  the program body matches, but the trailing`);
    console.log(`             padding is not all zero, so something is deployed that`);
    console.log(`             this build did not put there.`);
    process.exit(1);
  }
  console.log(`  \x1b[31mDIFFERENT\x1b[0m  the cluster is NOT running this build.`);
  console.log(`             Rebuild and redeploy, or you are reading source that`);
  console.log(`             does not describe the program under test.`);
  process.exit(1);
})().catch((e) => {
  console.error("\nATTESTATION ERROR:", e?.message || e);
  process.exit(2);
});
