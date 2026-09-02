/**
 * The keeper.
 *
 * A permissionless crank. It watches the rollup for markets whose timer has
 * died and walks each one the whole way to a tombstone on Solana, so a demo can
 * be left running and the village resolves itself.
 *
 * Nothing here needs authority. `expire_market`, `retry_vrf`, `settle_bid`,
 * `close_bid` and `close_book` all take a `cranker` that any signer can fill,
 * which is the point: a market must not depend on its author staying online to
 * pay out. The two instructions that are not permissionless are skipped rather
 * than faked. `resolve_rumor` belongs to the author, so a Whisper IPO is left
 * for them; `grant_reader` is attempted because it is permissionless, and only
 * has an effect on a SoleReader verdict.
 *
 * Every step is wrapped: a market that cannot advance is logged and left where
 * it stands, and the loop moves on to the next one. One stuck market must never
 * stop the village.
 *
 *   npx ts-node scripts/keeper.ts            run until interrupted
 *   npx ts-node scripts/keeper.ts --once     one pass, then exit
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ENDPOINTS,
  VRF_EPHEMERAL_QUEUE,
  baseConnection,
  erConnection,
  outcomeName,
  permissionPdaFromAccount,
  programFor,
  pursePda,
  sleep,
  statusName,
  tombPda,
} from "../sdk/src";
import { loadKeeper } from "./keeper-key";

const ONCE = process.argv.includes("--once");
const EVERY_MS = 4000;
/** `retry_vrf` refuses before the program's own grace window, so do not spam it. */
const VRF_GRACE_MS = 70_000;

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${stamp()}]`, ...a);

/** Run a step, and never let one market's failure stop the pass. */
async function step<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    // Anchor buries the useful part in `logs`; the top-level message is often
    // just "Unknown action 'undefined'", which says nothing about the refusal.
    const logs: string[] = err?.logs ?? err?.transactionLogs ?? [];
    const named = logs.find((l) => /Error Message:/.test(l));
    const code = String(err?.message ?? err).match(/custom program error: 0x([0-9a-f]+)/i);
    const detail =
      named?.replace(/^.*Error Message:\s*/, "") ??
      (code ? `program error 0x${code[1]}` : String(err?.message ?? err).slice(0, 120));
    log(`   ${what} skipped: ${detail}`);
    if (process.env.KEEPER_VERBOSE && logs.length) logs.slice(-6).forEach((l) => log("     |", l));
    return null;
  }
}

async function tick(keeper: Keypair) {
  const base = baseConnection();
  const er = erConnection();
  const pEr = programFor(er, keeper);
  const pBase = programFor(base, keeper);

  let markets: any[];
  try {
    markets = await (pEr.account as any).market.all();
  } catch (err: any) {
    log("rollup did not answer:", String(err?.message ?? err).slice(0, 90));
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const row of markets) {
    const market: PublicKey = row.publicKey;
    const m = row.account;
    const marketId: BN = m.marketId;
    const status = statusName(m.status);
    const outcome = outcomeName(m.outcome);
    const dead = m.expiresAt.toNumber() <= now;
    const short = market.toBase58().slice(0, 8);

    if (status === "open" && dead) {
      log(`${short} timer dead, expiring`);
      await step("expire_market", () =>
        pEr.methods
          .expireMarket(marketId)
          .accountsPartial({ cranker: keeper.publicKey, market })
          .rpc({ skipPreflight: true })
      );
      continue;
    }

    // Expired and still Pending means it needs randomness. A Whisper IPO is the
    // exception: its verdict is the author's to give, and asking VRF for one
    // would lock the market, so the program refuses and so do we.
    if (status === "expired" && outcome === "pending") {
      if (Object.keys(m.room)[0] === "whisperIpo") continue;
      log(`${short} expired, requesting VRF`);
      await step("request_resolution_vrf", () =>
        pEr.methods
          .requestResolutionVrf(marketId, 7)
          .accountsPartial({
            payer: keeper.publicKey,
            market,
            oracleQueue: VRF_EPHEMERAL_QUEUE,
          })
          .rpc({ skipPreflight: true })
      );
      continue;
    }

    if (status === "vrfPending") {
      const since = now - m.expiresAt.toNumber();
      if (since * 1000 > VRF_GRACE_MS) {
        log(`${short} VRF has not answered in ${since}s, retrying`);
        await step("retry_vrf", () =>
          pEr.methods
            .retryVrf(marketId)
            .accountsPartial({ cranker: keeper.publicKey, market })
            .rpc({ skipPreflight: true })
        );
      }
      continue;
    }

    if (status === "resolved") {
      // Settle and close every bid, then the book. settle_bid moves lamports and
      // close_bid makes a magic-program CPI, which the runtime refuses to see in
      // one instruction, so they go out as two.
      const bids = await step<any[]>("bid.all", () =>
        (pEr.account as any).bid.all([
          { memcmp: { offset: 8, bytes: market.toBase58() } },
        ])
      );
      for (const b of bids ?? []) {
        const bidder: PublicKey = b.account.bidder;
        // A settled bid still has to be closed, so this is not a `continue`:
        // settle_bid is skipped and close_bid still runs.
        if (!b.account.settled) {
          log(`${short} settling bid ${bidder.toBase58().slice(0, 8)}`);
          await step("settle_bid", () =>
          pEr.methods
            .settleBid(marketId)
              .accountsPartial({
                cranker: keeper.publicKey,
                market,
                bid: b.publicKey,
                purse: pursePda(bidder),
              })
              .rpc({ skipPreflight: true })
          );
        }
        // The bid's permission PDA lives under the permission program, not this
        // one, so Anchor cannot derive it from the IDL and it has to be passed.
        // Leaving it out fails client-side before anything is sent, which then
        // leaves close_book refusing on UnsettledBids forever.
        await step("close_bid", () =>
          pEr.methods
            .closeBid(marketId)
            .accountsPartial({
              cranker: keeper.publicKey,
              market,
              bid: b.publicKey,
              bidder,
              bidPermission: permissionPdaFromAccount(b.publicKey),
            })
            .rpc({ skipPreflight: true })
        );
      }
      log(`${short} closing the book`);
      await step("close_book", () =>
        pEr.methods
          .closeBook(marketId)
          .accountsPartial({ cranker: keeper.publicKey, market })
          .rpc({ skipPreflight: true })
      );
      continue;
    }

    if (status === "settled" && !m.tombstoned) {
      const secret = PublicKey.findProgramAddressSync(
        [Buffer.from("secret"), market.toBuffer()],
        pEr.programId
      )[0];

      // Permissionless, and only does anything on a SoleReader verdict. Letting
      // it fail on every other outcome is cheaper than reimplementing the
      // program's own rule about which verdicts admit a reader.
      await step("grant_reader", () =>
        pEr.methods
          .grantReader(marketId)
          .accountsPartial({ payer: keeper.publicKey, market, secret })
          .rpc({ skipPreflight: true })
      );

      log(`${short} finalizing (${outcome})`);
      const ok = await step("finalize_market", () =>
        pEr.methods
          .finalizeMarket(marketId)
          .accountsPartial({ payer: keeper.publicKey, market, secret })
          .rpc({ skipPreflight: true })
      );
      if (!ok) continue;

      // Wait for the commit to land on Solana before carving the tombstone.
      for (let i = 0; i < 30; i++) {
        const info = await base.getAccountInfo(market);
        if (info && info.owner.equals(pBase.programId)) break;
        await sleep(1000);
      }
      await step("write_tombstone", () =>
        pBase.methods
          .writeTombstone(marketId)
          .accountsPartial({
            payer: keeper.publicKey,
            market,
            tombstone: tombPda(market),
          })
          .rpc()
      );
      log(`${short} TOMBSTONE on Solana (${outcome})`);
    }
  }
}

async function main() {
  const keeper = await loadKeeper();
  log("keeper", keeper.publicKey.toBase58());
  log("base  ", ENDPOINTS.base);
  log("rollup", ENDPOINTS.er);
  log(ONCE ? "single pass" : `polling every ${EVERY_MS / 1000}s, ctrl-c to stop`);

  for (;;) {
    await tick(keeper);
    if (ONCE) return;
    await sleep(EVERY_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
