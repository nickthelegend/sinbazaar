/**
 * SINBAZAAR — what happens when the oracle does not answer.
 *
 * `retry_vrf` is the release valve: a market that asked for randomness and never
 * got it would otherwise sit in `VrfPending` forever with its escrow locked, because
 * `settle_bid` requires `Resolved` and nothing else can move it.
 *
 * Proving that requires an oracle that stays silent, so this spec is NOT part of the
 * normal suite. Run it through its wrapper, which stops the rollup's VRF oracle,
 * runs this file, and starts it again:
 *
 *   bash scripts/test-vrf-stall.sh
 *
 * It takes just over two minutes, because VRF_GRACE_SECS is 120 and the whole point
 * is that the grace period is real.
 */
import { expect } from "chai";
import { Bazaar, LAMPORTS, statusName, outcomeName } from "./harness";
import { Room, Side, VRF_EPHEMERAL_QUEUE, sleep } from "../sdk/src";

const GRACE_SECS = 120; // programs/sinbazaar/src/lib.rs :: VRF_GRACE_SECS
const OPEN_SECS = 20;

describe("SINBAZAAR — a stalled oracle", function () {
  this.timeout(600_000);
  const z = new Bazaar();

  before(async () => {
    await z.open();
  });

  it("A33/A34. a market whose randomness never arrives can be re-opened, but not early", async () => {
    const [v] = await z.villagers(1, 2);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: OPEN_SECS });
    await z.bid(v, m.marketId, m.market, Side.Read, 0.2 * LAMPORTS);

    await z.waitForExpiry(m.market);
    await z.expire(m.marketId, m.market);

    await z.erCall(
      z.authorProgramEr.methods.requestResolutionVrf(m.marketId, 5).accountsPartial({
        payer: z.authority.publicKey,
        market: m.market,
        oracleQueue: VRF_EPHEMERAL_QUEUE,
      }),
      z.authority
    );

    // The oracle is down for this run, so nothing will move it off VrfPending.
    await sleep(6000);
    const pending = await z.marketState(m.market);
    expect(
      statusName(pending.status),
      "the oracle is stopped, so the market is stuck waiting"
    ).to.equal("vrfPending");
    expect(outcomeName(pending.outcome)).to.equal("pending");

    // A33: the valve does not open early. Otherwise anyone could re-roll a market
    // the instant they disliked where it was heading.
    let early = "";
    try {
      await z.erCall(
        z.authorProgramEr.methods
          .retryVrf(m.marketId)
          .accountsPartial({ cranker: z.authority.publicKey, market: m.market }),
        z.authority
      );
    } catch (e: any) {
      early = String(e?.message ?? e);
    }
    expect(early, "retry_vrf before the grace period must be refused").to.match(
      /MarketStillOpen|6005|0x1775/
    );

    // A34: once the grace period has elapsed, anyone may re-open it.
    const expiresAt = pending.expiresAt.toNumber();
    const readyAt = (expiresAt + GRACE_SECS) * 1000;
    const wait = readyAt - Date.now() + 3000;
    if (wait > 0) {
      // eslint-disable-next-line no-console
      console.log(`    waiting ${Math.ceil(wait / 1000)}s for the VRF grace period…`);
      await sleep(wait);
    }

    await z.erCall(
      z.authorProgramEr.methods
        .retryVrf(m.marketId)
        .accountsPartial({ cranker: z.authority.publicKey, market: m.market }),
      z.authority
    );

    const reopened = await z.marketState(m.market);
    expect(statusName(reopened.status), "back to Expired, re-requestable").to.equal("expired");
    expect(
      outcomeName(reopened.outcome),
      "retry_vrf never decides an outcome itself"
    ).to.equal("pending");
    expect(
      reopened.escrowLamports.toNumber(),
      "the escrow is intact and was never at risk"
    ).to.equal(0.2 * LAMPORTS);
  });
});
