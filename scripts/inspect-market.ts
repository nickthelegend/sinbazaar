/**
 * Read one market, its author's purse, and its bid accounts straight off the
 * rollup. Useful when the UI and the chain disagree and you need to know which
 * one is lying.
 *
 *   . ./scripts/local-env.sh && npx ts-node scripts/inspect-market.ts <market> [owner]
 */
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  bidPda,
  erConnection,
  outcomeName,
  programFor,
  pursePda,
  statusName,
} from "../sdk/src";

(async () => {
  const [marketArg, ownerArg] = process.argv.slice(2);
  if (!marketArg) {
    console.error("usage: npx ts-node scripts/inspect-market.ts <market> [owner]");
    process.exit(1);
  }
  const er = erConnection();
  const market = new PublicKey(marketArg);
  const program: any = programFor(er, Keypair.generate());

  const m = await program.account.market.fetch(market);
  console.log(`market   ${market.toBase58()}`);
  console.log(`  status ${statusName(m.status)}  outcome ${outcomeName(m.outcome)}`);
  console.log(`  bids   ${m.bidCount} (${m.readBidCount} read, ${m.closedBidCount} closed)`);
  console.log(
    `  pots   seal ${m.sealPot.toNumber() / 1e9}  read ${m.readPot.toNumber() / 1e9}` +
      `  yes ${m.yesPot.toNumber() / 1e9}  no ${m.noPot.toNumber() / 1e9}`
  );
  console.log(
    `  escrow ${m.escrowLamports.toNumber() / 1e9}  owed to author ${m.authorPayout.toNumber() / 1e9}`
  );

  if (ownerArg) {
    const owner = new PublicKey(ownerArg);
    try {
      const p = await program.account.purse.fetch(pursePda(owner));
      console.log(
        `purse    available ${p.available.toNumber() / 1e9}  locked ${p.locked.toNumber() / 1e9}`
      );
    } catch {
      console.log("purse    none on the rollup");
    }
    const bid = bidPda(market, owner);
    const info = await er.getAccountInfo(bid);
    if (info) {
      const b = await program.account.bid.fetch(bid);
      console.log(
        `bid      ${Object.keys(b.side)[0]} ${b.amount.toNumber() / 1e9}` +
          `  funded=${b.funded} settled=${b.settled} index=${b.index} readRank=${b.readRank}`
      );
    } else {
      console.log("bid      none");
    }
  }
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
