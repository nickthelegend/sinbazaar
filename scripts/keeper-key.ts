/**
 * The keeper's own key.
 *
 * Kept out of the daemon so the daemon has one job. The key is generated on
 * first run, cached under `keys/`, and funded from the local faucet when there
 * is one. It signs nothing that matters: every instruction the keeper sends is
 * permissionless, so the worst a stolen keeper key can do is crank a market
 * that any stranger was already allowed to crank.
 */
import fs from "fs";
import path from "path";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { baseConnection, ENDPOINTS, sleep } from "../sdk/src";

const DIR = path.resolve(__dirname, "..", "keys");
const FILE = path.join(DIR, "keeper.json");
/** Enough for thousands of cranks, and meaningless if lost. */
const TOPUP = 5 * LAMPORTS_PER_SOL;
const FLOOR = 0.5 * LAMPORTS_PER_SOL;

export async function loadKeeper(): Promise<Keypair> {
  fs.mkdirSync(DIR, { recursive: true });
  let kp: Keypair;
  if (fs.existsSync(FILE)) {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(FILE, "utf8"))));
  } else {
    kp = Keypair.generate();
    fs.writeFileSync(FILE, JSON.stringify(Array.from(kp.secretKey)));
    console.log("generated a keeper key at keys/keeper.json");
  }

  const base = baseConnection();
  const balance = await base.getBalance(kp.publicKey).catch(() => 0);
  if (balance < FLOOR && /localhost|127\.0\.0\.1/.test(ENDPOINTS.base)) {
    try {
      await base.requestAirdrop(kp.publicKey, TOPUP);
      await sleep(1500);
      console.log("funded the keeper from the local faucet");
    } catch {
      console.log("could not fund the keeper; it will fail on fees");
    }
  }
  return kp;
}
