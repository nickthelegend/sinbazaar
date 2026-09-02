/**
 * SINBAZAAR specs.
 *
 * These run against a live local MagicBlock cluster (base + ER + QFS + VRF oracles).
 * Bring it up first:   bash scripts/local-stack.sh --detach
 * Then:                . ./scripts/local-env.sh && npm test
 */
import { expect } from "chai";
import { Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Bazaar,
  Villager,
  LAMPORTS,
  bodyBytesOf,
  tombText,
  outcomeName,
  statusName,
  BN,
  Keypair,
  PublicKey,
} from "./harness";
import {
  ENDPOINTS,
  Room,
  Side,
  bidPda,
  isRealTee,
  marketPda,
  programFor,
  sessionPda,
  teeConnection,
  sleep,
  tombPda,
} from "../sdk/src";

// Long enough that creating + delegating + sealing a market (~15s against the local
// stack) still leaves room to bid before the timer runs out.
const SHORT = 75;

describe("SINBAZAAR", function () {
  this.timeout(600_000);
  const z = new Bazaar();

  before(async () => {
    await z.open();
    console.log(`    village ${z.village.toBase58()}`);
    console.log(`    base=${ENDPOINTS.base}  er=${ENDPOINTS.er}  tee=${ENDPOINTS.tee}`);
  });

  // =====================================================================
  // privacy
  // =====================================================================

  describe("the confession never touches the base layer", () => {
    let m: any;

    before(async () => {
      m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
    });

    it("1. allocates the secret empty on L1, so plaintext is never in a base-layer transaction", async () => {
      // The shell as it existed on L1 the moment it was created.
      expect(bodyBytesOf(m.shellOnL1.data).every((b: number) => b === 0)).to.equal(true);

      // And L1 still shows nothing, because the body was only ever written on the ER
      // and the secret is never undelegated.
      const now = await z.baseConn.getAccountInfo(m.secret);
      const asText = Buffer.from(now!.data).toString("utf8");
      expect(asText).to.not.include("pitch deck");
    });

    it("1b. the body is not readable over the plain (unauthenticated) ER endpoint", async () => {
      const info = await z.erConn.getAccountInfo(m.secret);
      if (info === null) {
        // A real TEE refuses the read outright.
        expect(info).to.equal(null);
        return;
      }
      // A local QFS answers the read. What must hold everywhere is that the account
      // is marked private with the author as its only member — that flag is what the
      // TEE enforces. See README "Known limitations".
      const perm = await z.permission(m.secret);
      expect(perm.exists, "secret has an ephemeral permission").to.equal(true);
      expect(perm.isPrivate, "secret permission is private").to.equal(true);
      expect(perm.memberKeys).to.deep.equal([z.authority.publicKey.toBase58()]);
      if (isRealTee()) {
        expect(info, "a real TEE must not answer this read").to.equal(null);
      }
    });

    it("2. the author can read their own secret through an authenticated connection", async () => {
      const { connection } = await teeConnection(z.authority);
      const prog = programFor(connection, z.authority);
      const secret: any = await (prog.account as any).secret.fetch(m.secret);
      const body = Buffer.from(secret.body).subarray(0, secret.bodyLen).toString("utf8");
      expect(body).to.equal(m.body);
    });

    it("3. a random wallet is not on the member list", async () => {
      const stranger = Keypair.generate();
      const perm = await z.permission(m.secret);
      expect(perm.memberKeys).to.not.include(stranger.publicKey.toBase58());
      expect(perm.isPrivate).to.equal(true);

      if (isRealTee()) {
        const { connection } = await teeConnection(stranger);
        expect(await connection.getAccountInfo(m.secret)).to.equal(null);
      }
    });

    it("commits the hash publicly so any later reveal is verifiable", async () => {
      const state = await z.marketState(m.market);
      expect(Buffer.from(state.commitmentHash).equals(m.expectedHash)).to.equal(true);
    });

    it("keeps the market itself public — pots and timer are readable by anyone", async () => {
      const perm = await z.permission(m.market);
      expect(perm.exists).to.equal(true);
      expect(perm.isPrivate, "the market is deliberately NOT private").to.equal(false);
      expect(await z.erConn.getAccountInfo(m.market)).to.not.equal(null);
    });
  });

  // =====================================================================
  // bids
  // =====================================================================

  describe("bids are hidden and ER-native", () => {
    it("hides each bid behind a private permission listing only its bidder", async () => {
      const [a, b] = await z.villagers(2, 3);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
      await z.bid(a, m.marketId, m.market, Side.Read, 0.4 * LAMPORTS);
      await z.bid(b, m.marketId, m.market, Side.Read, 0.6 * LAMPORTS);

      const pa = await z.permission(bidPda(m.market, a.kp.publicKey));
      expect(pa.isPrivate).to.equal(true);
      expect(pa.memberKeys).to.deep.equal([a.kp.publicKey.toBase58()]);
      expect(pa.memberKeys, "the author must not see individual bids").to.not.include(
        z.authority.publicKey.toBase58()
      );

      // The aggregate is public; the split between individual bidders is not.
      const state = await z.marketState(m.market);
      expect(state.readPot.toNumber()).to.equal(LAMPORTS);
      expect(state.readBidCount).to.equal(2);
    });

    it("9. moves real lamports purse -> market and keeps escrow balanced", async () => {
      const [a] = await z.villagers(1, 3);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: SHORT });
      const stake = 0.75 * LAMPORTS;

      const purseBefore = (await z.erConn.getAccountInfo(a.purse))!.lamports;
      const marketBefore = (await z.erConn.getAccountInfo(m.market))!.lamports;
      await z.bid(a, m.marketId, m.market, Side.Seal, stake);
      const purseAfter = (await z.erConn.getAccountInfo(a.purse))!.lamports;
      const marketAfter = (await z.erConn.getAccountInfo(m.market))!.lamports;

      expect(purseBefore - purseAfter).to.equal(stake);
      // The market gains the stake, less the ER rent it sponsored for the bid
      // account and that bid's permission.
      expect(marketAfter - marketBefore).to.be.greaterThan(stake - 200_000);
      expect(marketAfter - marketBefore).to.be.at.most(stake);

      const state = await z.marketState(m.market);
      expect(state.escrowLamports.toNumber()).to.equal(stake);
      expect(state.sealPot.toNumber()).to.equal(stake);
    });
  });

  // =====================================================================
  // outcomes
  // =====================================================================

  describe("outcomes", () => {
    it("6. SEAL wins -> BURIED: the body stays private and the tombstone carries the hash alone", async () => {
      const [sealer, reader] = await z.villagers(2, 3);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: SHORT });
      await z.bid(sealer, m.marketId, m.market, Side.Seal, 0.5 * LAMPORTS);
      await z.bid(reader, m.marketId, m.market, Side.Read, 0.2 * LAMPORTS);

      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);
      const resolved = await z.resolveByVrf(m.marketId, m.market);
      expect(outcomeName(resolved.outcome)).to.equal("buried");

      const readerBefore = (await z.marketState(m.market)) && (await z.erConn.getAccountInfo(reader.purse))!.lamports;
      await z.settleAll(m.marketId, m.market, [sealer, reader]);
      const readerAfter = (await z.erConn.getAccountInfo(reader.purse))!.lamports;

      // Silence was bought: the reader is refunded in full, the sealer is not.
      expect(readerAfter - readerBefore).to.equal(0.2 * LAMPORTS);
      const settled = await z.marketState(m.market);
      expect(settled.authorPayout.toNumber()).to.equal(0.5 * LAMPORTS);
      expect(settled.escrowLamports.toNumber()).to.equal(0.5 * LAMPORTS);

      const tomb = await z.tombstone(m.marketId, m.market, m.secret);
      expect(outcomeName(tomb.outcome)).to.equal("buried");
      expect(tomb.revealedLen).to.equal(0);
      expect(tombText(tomb)).to.equal("");
      expect(Buffer.from(tomb.commitmentHash).equals(m.expectedHash)).to.equal(true);

      // The confession is still in the rollup, still private, still author-only.
      const perm = await z.permission(m.secret);
      expect(perm.isPrivate).to.equal(true);
      expect(perm.memberKeys).to.deep.equal([z.authority.publicKey.toBase58()]);
    });

    it("4. READ only -> SOLE_READER: exactly one new key joins the secret's member list", async () => {
      const [r1, r2] = await z.villagers(2, 3);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: SHORT });
      await z.bid(r1, m.marketId, m.market, Side.Read, 0.3 * LAMPORTS);
      await z.bid(r2, m.marketId, m.market, Side.Read, 0.3 * LAMPORTS);

      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);
      const resolved = await z.resolveByVrf(m.marketId, m.market);
      expect(outcomeName(resolved.outcome)).to.equal("soleReader");

      await z.settleAll(m.marketId, m.market, [r1, r2]);
      const settled = await z.marketState(m.market);
      const winner = settled.soleReader.toBase58();
      const candidates = [r1.kp.publicKey.toBase58(), r2.kp.publicKey.toBase58()];
      expect(candidates, "the winner is one of the READ bidders").to.include(winner);

      // The winner paid; the other reader got their money back.
      expect(settled.authorPayout.toNumber()).to.equal(0.3 * LAMPORTS);

      await z.grantReader(m.marketId, m.market, m.secret);
      const perm = await z.permission(m.secret);
      expect(perm.isPrivate).to.equal(true);
      expect(perm.memberKeys.sort()).to.deep.equal(
        [z.authority.publicKey.toBase58(), winner].sort()
      );
      const loser = candidates.find((c) => c !== winner)!;
      expect(perm.memberKeys, "the losing bidder gains nothing").to.not.include(loser);

      const tomb = await z.tombstone(m.marketId, m.market, m.secret);
      expect(outcomeName(tomb.outcome)).to.equal("soleReader");
      expect(tomb.revealedLen, "a sole reader is not a public leak").to.equal(0);
      expect(tomb.soleReader.toBase58()).to.equal(winner);
    });

    it("5. nobody pays -> PUBLIC_LEAK: the body is carved into the L1 tombstone", async () => {
      const body = "Our village demo is vaporware.";
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: SHORT, body });

      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);

      // An unpaid market needs no randomness — the rule of the bazaar decides it.
      const state = await z.marketState(m.market);
      expect(outcomeName(state.outcome)).to.equal("publicLeak");
      expect(statusName(state.status)).to.equal("resolved");

      await z.settleAll(m.marketId, m.market, []);
      const tomb = await z.tombstone(m.marketId, m.market, m.secret);
      expect(outcomeName(tomb.outcome)).to.equal("publicLeak");
      expect(tombText(tomb)).to.equal(body);
      expect(Buffer.from(tomb.commitmentHash).equals(m.expectedHash)).to.equal(true);
    });
  });

  // =====================================================================
  // blackmail escrow
  // =====================================================================

  describe("Blackmail Escrow", () => {
    it("buries the market when the village raises the ransom", async () => {
      const [payer] = await z.villagers(1, 4);
      const m = await z.newMarket({
        room: Room.BlackmailEscrow,
        durationSecs: SHORT,
        body: "I shorted my cofounder's token.",
        redacted: "There was a short.",
        ransomFloor: 0.5 * LAMPORTS,
        ransomSlope: 0,
      });
      await z.bid(payer, m.marketId, m.market, Side.Seal, 1 * LAMPORTS);

      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);
      const resolved = await z.resolveByVrf(m.marketId, m.market);
      expect(outcomeName(resolved.outcome), "ransom met -> buried").to.equal("buried");

      await z.settleAll(m.marketId, m.market, [payer]);
      const tomb = await z.tombstone(m.marketId, m.market, m.secret);
      expect(tomb.revealedLen).to.equal(0);
    });

    it("lets randomness decide when the ransom falls short", async () => {
      const [payer] = await z.villagers(1, 4);
      const m = await z.newMarket({
        room: Room.BlackmailEscrow,
        durationSecs: SHORT,
        body: "I voted no on this project in private.",
        redacted: "I voted no.",
        ransomFloor: 5 * LAMPORTS,
        ransomSlope: 0,
      });
      await z.bid(payer, m.marketId, m.market, Side.Seal, 0.2 * LAMPORTS);

      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);
      const resolved = await z.resolveByVrf(m.marketId, m.market);
      const out = outcomeName(resolved.outcome);
      expect(["randomReveal", "inherited"], "underfunded -> coin flip").to.include(out);

      // The ransom failed, so the seal money goes back.
      const before = (await z.erConn.getAccountInfo(payer.purse))!.lamports;
      await z.settleAll(m.marketId, m.market, [payer]);
      const after = (await z.erConn.getAccountInfo(payer.purse))!.lamports;
      expect(after - before).to.equal(0.2 * LAMPORTS);

      if (out === "inherited") {
        await z.grantReader(m.marketId, m.market, m.secret);
        const perm = await z.permission(m.secret);
        expect(perm.memberKeys.length).to.equal(2);
      }

      const tomb = await z.tombstone(m.marketId, m.market, m.secret);
      if (out === "randomReveal") {
        // Only the author's own redacted sentence, never the body.
        expect(tombText(tomb)).to.equal(m.redacted);
        expect(tombText(tomb)).to.not.equal(m.body);
      } else {
        expect(tomb.revealedLen, "an inherited secret is not published").to.equal(0);
      }
    });
  });

  // =====================================================================
  // whisper ipo
  // =====================================================================

  describe("Whisper IPO", () => {
    it("10. pays winners their stake plus a pro-rata slice of the losing book", async () => {
      const [yes1, yes2, no1] = await z.villagers(3, 6);
      const m = await z.newMarket({
        room: Room.WhisperIpo,
        durationSecs: 120,
        body: "This village ships before Friday.",
      });

      await z.bid(yes1, m.marketId, m.market, Side.Yes, 1 * LAMPORTS);
      await z.bid(yes2, m.marketId, m.market, Side.Yes, 2 * LAMPORTS);
      await z.bid(no1, m.marketId, m.market, Side.No, 3 * LAMPORTS);

      const pre = await z.marketState(m.market);
      expect(pre.yesPot.toNumber()).to.equal(3 * LAMPORTS);
      expect(pre.noPot.toNumber()).to.equal(3 * LAMPORTS);

      // The rumor's own account holds the headline with a PUBLIC permission —
      // a rumor is meant to be read; it is the positions that stay hidden.
      const secretPerm = await z.permission(m.secret);
      expect(secretPerm.isPrivate).to.equal(false);
      const posPerm = await z.permission(bidPda(m.market, yes1.kp.publicKey));
      expect(posPerm.isPrivate, "positions stay private").to.equal(true);

      await z.erCall(
        z.authorProgramEr.methods
          .resolveRumor(m.marketId, 1)
          .accountsPartial({ resolver: z.authority.publicKey, market: m.market }),
        z.authority
      );

      const resolved = await z.marketState(m.market);
      expect(outcomeName(resolved.outcome)).to.equal("forgiven");

      const before = {
        yes1: (await z.erConn.getAccountInfo(yes1.purse))!.lamports,
        yes2: (await z.erConn.getAccountInfo(yes2.purse))!.lamports,
        no1: (await z.erConn.getAccountInfo(no1.purse))!.lamports,
      };
      await z.settleAll(m.marketId, m.market, [yes1, yes2, no1]);
      const after = {
        yes1: (await z.erConn.getAccountInfo(yes1.purse))!.lamports,
        yes2: (await z.erConn.getAccountInfo(yes2.purse))!.lamports,
        no1: (await z.erConn.getAccountInfo(no1.purse))!.lamports,
      };

      // stake + stake * losing_pot / winning_pot
      expect(after.yes1 - before.yes1).to.equal(2 * LAMPORTS); // 1 + 1*3/3
      expect(after.yes2 - before.yes2).to.equal(4 * LAMPORTS); // 2 + 2*3/3
      expect(after.no1 - before.no1).to.equal(0);

      const settled = await z.marketState(m.market);
      expect(settled.escrowLamports.toNumber()).to.equal(0);
      expect(settled.authorPayout.toNumber()).to.equal(3 * LAMPORTS);
    });
  });

  // =====================================================================
  // authorization
  // =====================================================================

  describe("authorization", () => {
    it("7. a user cannot forge the VRF callback", async () => {
      const [attacker] = await z.villagers(1, 2);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: SHORT });
      await z.bid(attacker, m.marketId, m.market, Side.Read, 0.1 * LAMPORTS);
      await z.waitForExpiry(m.market);
      await z.expire(m.marketId, m.market);

      // Hand-roll callback_resolve with an attacker-controlled "identity" signer.
      const fakeIdentity = Keypair.generate();
      const prog = programFor(z.erConn, attacker.kp);
      let threw = false;
      try {
        const ix = await prog.methods
          .callbackResolve(Array(32).fill(7))
          .accountsPartial({
            vrfProgramIdentity: fakeIdentity.publicKey,
            market: m.market,
          })
          .instruction();
        const tx = new Transaction().add(ix);
        tx.feePayer = attacker.kp.publicKey;
        tx.recentBlockhash = (await z.erConn.getLatestBlockhash()).blockhash;
        tx.sign(attacker.kp, fakeIdentity);
        const sig = await z.erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        await z.confirmEr(sig);
      } catch {
        threw = true;
      }
      expect(threw, "a forged VRF callback must be rejected").to.equal(true);

      // And the market is still unresolved, so the real oracle still decides it.
      const state = await z.marketState(m.market);
      expect(outcomeName(state.outcome)).to.equal("pending");
    });

    it("8. a market cannot be undelegated before it is settled", async () => {
      const [a] = await z.villagers(1, 2);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
      await z.bid(a, m.marketId, m.market, Side.Read, 0.1 * LAMPORTS);

      let threw = false;
      try {
        await z.authorProgramEr.methods
          .finalizeMarket(m.marketId)
          .accountsPartial({ payer: z.authority.publicKey, market: m.market, secret: m.secret })
          .rpc();
      } catch (e: any) {
        threw = true;
        expect(String(e)).to.match(/NotSettled|not fully settled|0x/);
      }
      expect(threw, "finalize must refuse an unsettled market").to.equal(true);
      expect(await z.erConn.getAccountInfo(m.market)).to.not.equal(null);
    });

    it("a stranger cannot seal someone else's secret", async () => {
      const [stranger] = await z.villagers(1, 2);
      const m = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
      const prog = programFor(z.erConn, stranger.kp);
      let threw = false;
      try {
        await prog.methods
          .sealSecret(
            m.marketId,
            Buffer.from("overwritten", "utf8"),
            Array(32).fill(1),
            Buffer.from("", "utf8")
          )
          .accountsPartial({ author: stranger.kp.publicKey, market: m.market, secret: m.secret })
          .rpc();
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it("11. a session key is bound to one market and one spend ceiling", async () => {
      const [v] = await z.villagers(1, 5);
      const marketA = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
      const marketB = await z.newMarket({ room: Room.GuiltMarket, durationSecs: 600 });
      const sessionKey = Keypair.generate();
      await z.baseConn.requestAirdrop(sessionKey.publicKey, 2 * LAMPORTS);
      await sleep(1500);

      // Scope: market A only, at most 0.5 SOL.
      await z.erCall(
        v.er.methods
          .openSession(marketA.marketId, new BN(600), new BN(0.5 * LAMPORTS), sessionKey.publicKey)
          .accountsPartial({
            owner: v.kp.publicKey,
            market: marketA.market,
            session: sessionPda(marketA.market, v.kp.publicKey),
          }),
        v.kp
      );

      // In scope: the session key bids for the villager with no wallet signature.
      await z.bid(v, marketA.marketId, marketA.market, Side.Read, 0.2 * LAMPORTS, sessionKey);
      const stateA = await z.marketState(marketA.market);
      expect(stateA.readPot.toNumber()).to.equal(0.2 * LAMPORTS);

      // Out of scope: the same key on a different market.
      let crossMarketFailed = false;
      try {
        await z.bid(v, marketB.marketId, marketB.market, Side.Read, 0.1 * LAMPORTS, sessionKey);
      } catch {
        crossMarketFailed = true;
      }
      expect(crossMarketFailed, "a session key must not reach another market").to.equal(true);

      // Out of scope: over the ceiling. The purse holds 5 SOL, so only the session
      // limit can be what stops this.
      let overspendFailed = false;
      try {
        const v2 = { ...v };
        // A second bid from the same villager on market A would collide with the
        // existing bid PDA, so use a fresh villager under the same session owner is
        // not possible; instead re-open the session with a tiny ceiling and retry.
        await z.erCall(
          v.er.methods
            .openSession(marketB.marketId, new BN(600), new BN(0.05 * LAMPORTS), sessionKey.publicKey)
            .accountsPartial({
              owner: v.kp.publicKey,
              market: marketB.market,
              session: sessionPda(marketB.market, v.kp.publicKey),
            }),
          v.kp
        );
        await z.bid(v2, marketB.marketId, marketB.market, Side.Read, 0.4 * LAMPORTS, sessionKey);
      } catch {
        overspendFailed = true;
      }
      expect(overspendFailed, "a session key must not exceed its ceiling").to.equal(true);
    });

    it("rejects rooms that are enumerated but not enabled", async () => {
      let threw = false;
      try {
        await z.authorProgramBase.methods
          .createMarket(new BN(999_111), { mirrorConfession: {} }, new BN(60), new BN(0), new BN(0))
          .accountsPartial({
            author: z.authority.publicKey,
            village: z.village,
            market: marketPda(z.village, new BN(999_111)),
          })
          .rpc();
      } catch (e: any) {
        threw = true;
        expect(String(e)).to.match(/RoomNotLive|not enabled|0x/);
      }
      expect(threw).to.equal(true);
    });
  });
});
