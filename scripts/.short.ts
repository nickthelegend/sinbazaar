import { Bazaar, LAMPORTS } from "../tests/harness";
import { Room, Side, sleep } from "../sdk/src";
(async () => {
  const z = new Bazaar(); await z.open();
  const [a] = await z.villagers(1, 4);
  // Long enough to open the page, short enough to enter the final 20s window.
  const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 75, body: "Watch this clock go red." });
  console.log("MARKET", m.market.toBase58());
  console.log("EXPIRES_IN 75s from now");
  await sleep(30_000);
  await z.bid(a, m.marketId, m.market, Side.Seal, 0.33 * LAMPORTS);
  console.log("BID placed: seal 0.33");
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
