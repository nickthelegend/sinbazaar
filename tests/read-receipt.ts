/**
 * SINBAZAAR — the reader goes on the record.
 *
 * A chain cannot watch somebody read. `record_read` is therefore not detection:
 * it is the selected reader signing a statement that they claimed the secret,
 * and these tests pin the properties that make such a statement worth anything.
 * Only the reader can make it, it cannot be moved once made, and it travels onto
 * the permanent L1 headstone with the rest of the verdict.
 */
import { expect } from "chai";
import { Bazaar, LAMPORTS, outcomeName } from "./harness";
import { Room, Side, programFor, sleep } from "../sdk/src";

async function rejects(fn: () => Promise<unknown>, what: string): Promise<string> {
  try {
    await fn();
  } catch (e: any) {
    return String(e?.message ?? e);
  }
  throw new Error(`expected ${what} to be rejected, but it succeeded`);
}

describe("SINBAZAAR — the read receipt", function () {
  this.timeout(600_000);

  let z: Bazaar;
  let m: any;
  let reader: any;

  before(async () => {
    z = new Bazaar();
    await z.open();
    [reader] = await z.villagers(1, 3);

    // A guilt market with a READ bid and no SEAL bid resolves to SoleReader
    // deterministically, so this suite never depends on which way VRF fell.
    m = await z.newMarket({
      room: Room.GuiltMarket,
      durationSecs: 15,
      body: "I read it and I am not sorry.",
    });
    await z.bid(reader, m.marketId, m.market, Side.Read, 0.2 * LAMPORTS);
    await z.waitForExpiry(m.market);
    await z.expire(m.marketId, m.market);
    const r = await z.resolveByVrf(m.marketId, m.market);
    expect(outcomeName(r.outcome)).to.equal("soleReader");
    // `sole_reader` is only stamped onto the market as bids settle, so the grant
    // has to wait for settlement rather than for resolution.
    await z.settleAll(m.marketId, m.market, [reader]);
    await z.grantReader(m.marketId, m.market, m.secret);
  });

  it("starts with no claim on the record", async () => {
    const s = await z.marketState(m.market);
    expect(s.readAt.toNumber()).to.equal(0);
  });

  it("refuses anyone who is not the selected reader", async () => {
    // A villager, not a bare keypair, and sent through `erCall` like every other
    // rollup transaction in this suite. A raw `.rpc()` from a key with no
    // standing was refused by the validator before the program ever ran, which
    // would have proved nothing about who `record_read` accepts: the assertion
    // has to fail for the reason it claims.
    const [stranger] = await z.villagers(1, 3);
    const err = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .recordRead(m.marketId)
            .accountsPartial({ reader: stranger.kp.publicKey, market: m.market }),
          stranger.kp
        ),
      "record_read by a stranger"
    );
    expect(err).to.match(/NotReader|6034|0x1792/);
    const s = await z.marketState(m.market);
    expect(s.readAt.toNumber()).to.equal(0);
  });

  it("records the moment the reader claims it", async () => {
    const p = programFor(z.erConn, reader.kp);
    await p.methods
      .recordRead(m.marketId)
      .accountsPartial({ reader: reader.kp.publicKey, market: m.market })
      .rpc({ skipPreflight: true });
    const s = await z.marketState(m.market);
    expect(s.readAt.toNumber()).to.be.greaterThan(0);
  });

  it("never moves once recorded", async () => {
    const first = (await z.marketState(m.market)).readAt.toNumber();
    // A byte-identical transaction is rejected as already processed, which would
    // test the validator's dedupe rather than the instruction's idempotence.
    // Waiting rolls the blockhash so this is a genuinely new transaction.
    await sleep(2000);
    const p = programFor(z.erConn, reader.kp);
    await p.methods
      .recordRead(m.marketId)
      .accountsPartial({ reader: reader.kp.publicKey, market: m.market })
      .rpc({ skipPreflight: true });
    const again = (await z.marketState(m.market)).readAt.toNumber();
    expect(again).to.equal(first);
  });

  it("travels onto the L1 headstone with the verdict", async () => {
    const onEr = (await z.marketState(m.market)).readAt.toNumber();
    const tomb = await z.tombstone(m.marketId, m.market, m.secret);
    expect(tomb.readAt.toNumber()).to.equal(onEr);
    expect(tomb.readAt.toNumber()).to.be.greaterThan(0);
  });
});
