/**
 * SINBAZAAR — the refusals.
 *
 * `sinbazaar.ts` proves the happy paths. This file proves the program says no:
 * every guard, every authority check, every "you cannot do that yet". A market
 * that only works when everyone behaves is not a market.
 *
 *   bash scripts/local-stack.sh --detach
 *   . ./scripts/local-env.sh && npx ts-mocha -p ./tsconfig.json -t 900000 tests/edges.ts
 */
import { expect } from "chai";
import { Transaction } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Bazaar, LAMPORTS, outcomeName, statusName, BN, Keypair } from "./harness";
import {
  Room,
  Side,
  VALIDATOR,
  VRF_EPHEMERAL_QUEUE,
  bidPda,
  marketPda,
  programFor,
  pursePda,
  secretPda,
  sessionPda,
  sleep,
  tombPda,
} from "../sdk/src";

/** Run `fn` and return the error it threw, failing the test if it succeeded. */
async function rejects(fn: () => Promise<unknown>, what: string): Promise<string> {
  try {
    await fn();
  } catch (e: any) {
    return String(e?.message ?? e);
  }
  throw new Error(`expected ${what} to be rejected, but it succeeded`);
}

describe("SINBAZAAR — refusals", function () {
  this.timeout(900_000);
  const z = new Bazaar();

  before(async () => {
    await z.open();
  });

  // =====================================================================
  // authority
  // =====================================================================

  it("A7. a stranger cannot delegate someone else's secret", async () => {
    const marketId = new BN(Math.floor(Math.random() * 1e9));
    const market = marketPda(z.village, marketId);
    const secret = secretPda(market);
    const a = z.authority.publicKey;

    await z.authorProgramBase.methods
      .createMarket(marketId, Room.GuiltMarket, new BN(600), new BN(0), new BN(0))
      .accountsPartial({ author: a, village: z.village, market })
      .rpc();
    await z.authorProgramBase.methods
      .createSecretShell(marketId)
      .accountsPartial({ author: a, market, secret })
      .rpc();

    const [stranger] = await z.villagers(1, 1);
    const err = await rejects(
      () =>
        stranger.base.methods
          .delegateSecret(marketId)
          .accountsPartial({
            author: stranger.kp.publicKey,
            village: z.village,
            market,
            secret,
            validator: VALIDATOR,
          })
          .rpc(),
      "delegate_secret by a non-author"
    );
    expect(err).to.match(/NotAuthor|6022|0x1786/);
  });

  it("A36/A37. only the author resolves a rumor, and only to YES or NO", async () => {
    const m = await z.newMarket({
      room: Room.WhisperIpo,
      durationSecs: 600,
      body: "The oracle is a man with a spreadsheet.",
    });
    const [stranger] = await z.villagers(1, 1);

    const notAuthor = await rejects(
      () =>
        z.erCall(
          programFor(z.erConn, stranger.kp)
            .methods.resolveRumor(m.marketId, 1)
            .accountsPartial({ resolver: stranger.kp.publicKey, market: m.market }),
          stranger.kp
        ),
      "resolve_rumor by a stranger"
    );
    expect(notAuthor).to.match(/NotAuthor|6022|0x1786/);

    const badResult = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .resolveRumor(m.marketId, 3)
            .accountsPartial({ resolver: z.authority.publicKey, market: m.market }),
          z.authority
        ),
      "resolve_rumor with result 3"
    );
    expect(badResult).to.match(/InvalidRumorResult|6029|0x178d/);

    // Still untouched.
    expect(outcomeName((await z.marketState(m.market)).outcome)).to.equal("pending");
  });

  // =====================================================================
  // bidding guards
  // =====================================================================

  it("A19. a bid larger than the purse is refused", async () => {
    const [poor] = await z.villagers(1, 1);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
    const err = await rejects(
      () => z.bid(poor, m.marketId, m.market, Side.Read, 5 * LAMPORTS),
      "a 5 SOL bid from a 1 SOL purse"
    );
    expect(err).to.match(/InsufficientFunds|6017|0x1781/);
    expect((await z.marketState(m.market)).bidCount, "no bid was recorded").to.equal(0);
  });

  it("A18. a side the room does not trade is refused", async () => {
    const [v] = await z.villagers(1, 2);
    const guilt = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
    const yesOnGuilt = await rejects(
      () => z.bid(v, guilt.marketId, guilt.market, Side.Yes, 0.1 * LAMPORTS),
      "a YES bid on a Guilt Market"
    );
    expect(yesOnGuilt).to.match(/InvalidBidSide|6016|0x1780/);

    const [w] = await z.villagers(1, 2);
    const rumor = await z.newMarket({
      room: Room.WhisperIpo,
      durationSecs: 600,
      body: "Nobody reads the changelog.",
    });
    const sealOnRumor = await rejects(
      () => z.bid(w, rumor.marketId, rumor.market, Side.Seal, 0.1 * LAMPORTS),
      "a SEAL bid on a Whisper IPO"
    );
    expect(sealOnRumor).to.match(/InvalidBidSide|6016|0x1780/);
  });

  it("A16. a bid after the timer is refused", async () => {
    const [v] = await z.villagers(1, 2);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 20 });
    await z.waitForExpiry(m.market);
    const err = await rejects(
      () => z.bid(v, m.marketId, m.market, Side.Read, 0.1 * LAMPORTS),
      "a bid past expires_at"
    );
    expect(err).to.match(/MarketNotOpen|6004|0x1774/);
  });

  it("A25. a revoked session key stops working immediately", async () => {
    const [v] = await z.villagers(1, 3);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
    const key = Keypair.generate();
    await z.baseConn.requestAirdrop(key.publicKey, 2 * LAMPORTS);
    await sleep(1200);

    await z.erCall(
      v.er.methods
        .openSession(m.marketId, new BN(600), new BN(1 * LAMPORTS), key.publicKey)
        .accountsPartial({
          owner: v.kp.publicKey,
          market: m.market,
          session: sessionPda(m.market, v.kp.publicKey),
        }),
      v.kp
    );
    await z.erCall(
      v.er.methods.revokeSession(m.marketId).accountsPartial({
        owner: v.kp.publicKey,
        market: m.market,
        session: sessionPda(m.market, v.kp.publicKey),
      }),
      v.kp
    );

    const err = await rejects(
      () => z.bid(v, m.marketId, m.market, Side.Read, 0.1 * LAMPORTS, key),
      "a bid signed by a revoked session key"
    );
    expect(err).to.match(/InvalidSession|6023|0x1787/);
  });

  // =====================================================================
  // lifecycle guards
  // =====================================================================

  it("A26. a market cannot be expired before its timer", async () => {
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
    const err = await rejects(
      () => z.expire(m.marketId, m.market),
      "expire_market before expires_at"
    );
    expect(err).to.match(/MarketStillOpen|6005|0x1775/);
    expect(statusName((await z.marketState(m.market)).status)).to.equal("open");
  });

  it("A30/A33. a rumor market cannot be pushed into VRF, and retry has a grace period", async () => {
    const [v] = await z.villagers(1, 2);
    const m = await z.newMarket({
      room: Room.WhisperIpo,
      durationSecs: 20,
      body: "We will definitely refactor this later.",
    });
    await z.bid(v, m.marketId, m.market, Side.Yes, 0.1 * LAMPORTS);
    await z.waitForExpiry(m.market);
    await z.expire(m.marketId, m.market);

    // Without the room guard this would strand the market in VrfPending forever:
    // callback_resolve rejects a rumor as WrongRoom, and resolve_rumor only accepts
    // Open or Expired.
    const err = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods.requestResolutionVrf(m.marketId, 1).accountsPartial({
            payer: z.authority.publicKey,
            market: m.market,
            oracleQueue: VRF_EPHEMERAL_QUEUE,
          }),
          z.authority
        ),
      "request_resolution_vrf on a Whisper IPO"
    );
    expect(err).to.match(/WrongRoom|6003|0x1773/);

    // And the market is still resolvable the way it is supposed to be.
    await z.erCall(
      z.authorProgramEr.methods
        .resolveRumor(m.marketId, 2)
        .accountsPartial({ resolver: z.authority.publicKey, market: m.market }),
      z.authority
    );
    expect(outcomeName((await z.marketState(m.market)).outcome)).to.equal("slashed");

    // retry_vrf refuses a market that is not waiting on randomness at all.
    const notPending = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .retryVrf(m.marketId)
            .accountsPartial({ cranker: z.authority.publicKey, market: m.market }),
          z.authority
        ),
      "retry_vrf on a resolved market"
    );
    expect(notPending).to.match(/NotResolved|6007|0x1777/);
  });

  it("A41/A46/A52/A53. settle once, grant only to a reader, tombstone once, then the author is paid", async () => {
    const [sealer] = await z.villagers(1, 3);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 20 });
    await z.bid(sealer, m.marketId, m.market, Side.Seal, 0.4 * LAMPORTS);

    await z.waitForExpiry(m.market);
    await z.expire(m.marketId, m.market);
    const resolved = await z.resolveByVrf(m.marketId, m.market);
    expect(outcomeName(resolved.outcome)).to.equal("buried");

    // A46: buried authorises nobody to read.
    const notReader = await rejects(
      () => z.grantReader(m.marketId, m.market, m.secret),
      "grant_reader on a buried market"
    );
    expect(notReader).to.match(/RevealNotAuthorised|6027|0x178b/);

    await z.settleAll(m.marketId, m.market, [sealer]);

    // A41: the bid is gone, so a second settle cannot find it.
    const twice = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods.settleBid(m.marketId).accountsPartial({
            cranker: z.authority.publicKey,
            market: m.market,
            bid: bidPda(m.market, sealer.kp.publicKey),
            purse: sealer.purse,
          }),
          z.authority
        ),
      "settling the same bid twice"
    );
    expect(twice.length).to.be.greaterThan(0);

    const tomb = await z.tombstone(m.marketId, m.market, m.secret);
    expect(outcomeName(tomb.outcome)).to.equal("buried");

    // A52: the graveyard is append-only.
    const tombTwice = await rejects(
      () =>
        z.authorProgramBase.methods
          .writeTombstone(m.marketId)
          .accountsPartial({
            payer: z.authority.publicKey,
            market: m.market,
            tombstone: tombPda(m.market),
          })
          .rpc(),
      "a second tombstone"
    );
    expect(tombTwice.length).to.be.greaterThan(0);

    // A53: the author collects what the seal bidder forfeited.
    const owed = (await (z.authorProgramBase.account as any).market.fetch(m.market)).authorPayout;
    expect(owed.toNumber()).to.equal(0.4 * LAMPORTS);
    const before = await z.baseConn.getBalance(z.authority.publicKey);
    await z.authorProgramBase.methods
      .claimAuthor(m.marketId)
      .accountsPartial({ author: z.authority.publicKey, market: m.market })
      .rpc();
    const after = await z.baseConn.getBalance(z.authority.publicKey);
    expect(after).to.be.greaterThan(before);
    const cleared = await (z.authorProgramBase.account as any).market.fetch(m.market);
    expect(cleared.authorPayout.toNumber(), "the debt is cleared").to.equal(0);

    const nothingLeft = await rejects(
      () =>
        z.authorProgramBase.methods
          .claimAuthor(m.marketId)
          .accountsPartial({ author: z.authority.publicKey, market: m.market })
          .rpc(),
      "claiming twice"
    );
    expect(nothingLeft).to.match(/NothingToClaim|6032|0x1790/);
  });

  // =====================================================================
  // the purse round trip
  // =====================================================================

  it("A54/A55. a purse with an open bid is locked, and otherwise comes home with real SOL", async () => {
    const [v] = await z.villagers(1, 2);
    const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 25 });
    await z.bid(v, m.marketId, m.market, Side.Read, 0.3 * LAMPORTS);

    // A54: locked lamports cannot leave, and the purse cannot go home either.
    const locked = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .undelegatePurse()
            .accountsPartial({ payer: z.authority.publicKey, purse: v.purse }),
          z.authority
        ),
      "undelegating a purse with an open bid"
    );
    expect(locked).to.match(/PurseLocked|6018|0x1782/);

    await z.waitForExpiry(m.market);
    await z.expire(m.marketId, m.market);
    await z.resolveByVrf(m.marketId, m.market);
    await z.settleAll(m.marketId, m.market, [v]);

    // A55: nothing locked now, so it can be undelegated and withdrawn for real SOL.
    await z.erCall(
      z.authorProgramEr.methods
        .undelegatePurse()
        .accountsPartial({ payer: z.authority.publicKey, purse: v.purse }),
      z.authority
    );
    await z.waitOnBase(v.purse, z.authorProgramBase.programId);

    const purse: any = await (v.base.account as any).purse.fetch(v.purse);
    expect(purse.locked.toNumber()).to.equal(0);
    const walletBefore = await z.baseConn.getBalance(v.kp.publicKey);
    await v.base.methods
      .withdrawPurse(new BN(purse.available.toNumber()))
      .accountsPartial({ owner: v.kp.publicKey, purse: v.purse })
      .rpc();
    const walletAfter = await z.baseConn.getBalance(v.kp.publicKey);
    expect(walletAfter, "real SOL is back in the wallet").to.be.greaterThan(walletBefore);
  });

  // =====================================================================
  // input validation
  // =====================================================================

  it("A14. the confession has to fit", async () => {
    const marketId = new BN(Math.floor(Math.random() * 1e9));
    const market = marketPda(z.village, marketId);
    const secret = secretPda(market);
    const a = z.authority.publicKey;

    await z.authorProgramBase.methods
      .createMarket(marketId, Room.GuiltMarket, new BN(600), new BN(0), new BN(0))
      .accountsPartial({ author: a, village: z.village, market })
      .rpc();
    await z.authorProgramBase.methods
      .createSecretShell(marketId)
      .accountsPartial({ author: a, market, secret })
      .rpc();
    await z.authorProgramBase.methods
      .delegateMarket(marketId)
      .accountsPartial({ author: a, village: z.village, market, validator: VALIDATOR })
      .rpc();
    await z.authorProgramBase.methods
      .delegateSecret(marketId)
      .accountsPartial({ author: a, village: z.village, market, secret, validator: VALIDATOR })
      .rpc();
    await z.waitOnEr(market, "market");
    await z.waitOnEr(secret, "secret");
    await z.erCall(
      z.authorProgramEr.methods.initMarketPermission(marketId).accountsPartial({ payer: a, market }),
      z.authority
    );
    await z.erCall(
      z.authorProgramEr.methods
        .initSecretPermission(marketId)
        .accountsPartial({ payer: a, market, secret }),
      z.authority
    );

    const empty = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .sealSecret(marketId, Buffer.alloc(0), Array(32).fill(1), Buffer.from("x"))
            .accountsPartial({ author: a, market, secret }),
          z.authority
        ),
      "sealing an empty body"
    );
    expect(empty).to.match(/InvalidBodyLength|6019|0x1783/);

    const tooBig = await rejects(
      () =>
        z.erCall(
          z.authorProgramEr.methods
            .sealSecret(marketId, Buffer.alloc(181, 120), Array(32).fill(1), Buffer.from("x"))
            .accountsPartial({ author: a, market, secret }),
          z.authority
        ),
      "sealing 181 bytes"
    );
    expect(tooBig).to.match(/InvalidBodyLength|6019|0x1783/);

    // The market never got a commitment, so nothing was half-sealed.
    const state = await z.marketState(market);
    expect(Buffer.from(state.commitmentHash).every((b: number) => b === 0)).to.equal(true);
  });
});
