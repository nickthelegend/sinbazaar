/**
 * Test harness: drives one SINBAZAAR market through the whole lifecycle so the
 * specs can assert on any stage of it without repeating twenty calls each time.
 */
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  BN,
  ENDPOINTS,
  VALIDATOR,
  VRF_EPHEMERAL_QUEUE,
  baseConnection,
  bidPda,
  commitmentHash,
  erConnection,
  fundLocal,
  marketPda,
  outcomeName,
  programFor,
  pursePda,
  randomSalt,
  readPermission,
  secretPda,
  sessionPda,
  sleep,
  statusName,
  tombPda,
  villagePda,
} from "../sdk/src";

export const LAMPORTS = 1_000_000_000;

export interface Villager {
  kp: Keypair;
  base: Program;
  er: Program;
  purse: PublicKey;
}

export class Bazaar {
  baseConn: Connection;
  erConn: Connection;
  authority!: Keypair;
  village!: PublicKey;
  authorProgramBase!: Program;
  authorProgramEr!: Program;
  private nextId = Math.floor(Math.random() * 1e9);

  constructor() {
    this.baseConn = baseConnection();
    this.erConn = erConnection();
  }

  async open(): Promise<void> {
    this.authority = Keypair.generate();
    await fundLocal(this.baseConn, this.authority.publicKey, 20);
    this.village = villagePda(this.authority.publicKey);
    this.authorProgramBase = programFor(this.baseConn, this.authority);
    this.authorProgramEr = programFor(this.erConn, this.authority);
    await this.authorProgramBase.methods
      .initializeVillage(true)
      .accountsPartial({ authority: this.authority.publicKey, village: this.village })
      .rpc();
  }

  /** A funded villager whose purse is already delegated to the rollup. */
  async villager(sol = 5): Promise<Villager> {
    const kp = Keypair.generate();
    await fundLocal(this.baseConn, kp.publicKey, sol + 2);
    const base = programFor(this.baseConn, kp);
    const purse = pursePda(kp.publicKey);
    await base.methods
      .depositPurse(new BN(sol * LAMPORTS))
      .accountsPartial({ owner: kp.publicKey, purse })
      .rpc();
    await base.methods
      .delegatePurse()
      .accountsPartial({ owner: kp.publicKey, purse, validator: VALIDATOR })
      .rpc();
    await this.waitOnEr(purse, "purse");
    return { kp, base, er: programFor(this.erConn, kp), purse };
  }

  /**
   * Villagers first, market second.
   *
   * Funding and delegating a purse takes several seconds each; if the market were
   * created first its timer would already be running (and short markets would
   * expire before anyone could bid).
   */
  async villagers(n: number, sol = 5): Promise<Villager[]> {
    const out: Villager[] = [];
    for (let i = 0; i < n; i++) out.push(await this.villager(sol));
    return out;
  }

  async waitOnEr(key: PublicKey, label: string, ms = 30_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.erConn.getAccountInfo(key)) return;
      await sleep(400);
    }
    throw new Error(`${label} never reached the ER`);
  }

  /** Wait for a committed+undelegated account to be owned by us again on L1. */
  async waitOnBase(key: PublicKey, owner: PublicKey, ms = 60_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = await this.baseConn.getAccountInfo(key);
      if (i && i.owner.equals(owner)) return;
      await sleep(1000);
    }
    throw new Error(`account ${key.toBase58()} never came back to L1`);
  }

  /**
   * Create a market, allocate its empty secret, delegate both, set up the
   * permissions and seal the confession inside the rollup.
   */
  async newMarket(opts: {
    room: any;
    durationSecs: number;
    body?: string;
    redacted?: string;
    ransomFloor?: number;
    ransomSlope?: number;
  }) {
    const marketId = new BN(this.nextId++);
    const market = marketPda(this.village, marketId);
    const secret = secretPda(market);
    const a = this.authority.publicKey;

    await this.authorProgramBase.methods
      .createMarket(
        marketId,
        opts.room,
        new BN(opts.durationSecs),
        new BN(opts.ransomFloor ?? 0),
        new BN(opts.ransomSlope ?? 0)
      )
      .accountsPartial({ author: a, village: this.village, market })
      .rpc();

    await this.authorProgramBase.methods
      .createSecretShell(marketId)
      .accountsPartial({ author: a, market, secret })
      .rpc();

    // Snapshot of the shell as L1 sees it, before anything is written into it.
    const shellOnL1 = await this.baseConn.getAccountInfo(secret);

    await this.authorProgramBase.methods
      .delegateMarket(marketId)
      .accountsPartial({ author: a, village: this.village, market, validator: VALIDATOR })
      .rpc();
    await this.authorProgramBase.methods
      .delegateSecret(marketId)
      .accountsPartial({ author: a, village: this.village, market, secret, validator: VALIDATOR })
      .rpc();
    await this.waitOnEr(market, "market");
    await this.waitOnEr(secret, "secret");

    await this.erCall(
      this.authorProgramEr.methods.initMarketPermission(marketId).accountsPartial({ payer: a, market }),
      this.authority
    );
    await this.erCall(
      this.authorProgramEr.methods
        .initSecretPermission(marketId)
        .accountsPartial({ payer: a, market, secret }),
      this.authority
    );

    const body = opts.body ?? "I reused my teammate's pitch deck.";
    const redacted = opts.redacted ?? "One line of it was mine.";
    const salt = randomSalt();
    await this.erCall(
      this.authorProgramEr.methods
        .sealSecret(
          marketId,
          Buffer.from(body, "utf8"),
          Array.from(salt),
          Buffer.from(redacted, "utf8")
        )
        .accountsPartial({ author: a, market, secret }),
      this.authority
    );

    return {
      marketId,
      market,
      secret,
      body,
      redacted,
      salt,
      shellOnL1,
      expectedHash: commitmentHash(body, salt),
    };
  }

  /**
   * One transaction: open the bid, then fund it.
   *
   * Passing `signer` routes through `place_bid_with_session`, which is a distinct
   * instruction because the session scope must be writable and the wallet-signed
   * path must not carry a writable account it never uses.
   */
  async bid(
    v: Villager,
    marketId: BN,
    market: PublicKey,
    side: any,
    lamports: number,
    signer?: Keypair
  ): Promise<string> {
    const bid = bidPda(market, v.kp.publicKey);
    const viaSession = signer !== undefined && !signer.publicKey.equals(v.kp.publicKey);
    const s = signer ?? v.kp;
    const prog = programFor(this.erConn, s);

    const open = viaSession
      ? await prog.methods
          .placeBidWithSession(marketId, side, new BN(lamports))
          .accountsPartial({
            signer: s.publicKey,
            bidder: v.kp.publicKey,
            market,
            bid,
            purse: v.purse,
            session: sessionPda(market, v.kp.publicKey),
          })
          .instruction()
      : await prog.methods
          .placeBid(marketId, side, new BN(lamports))
          .accountsPartial({
            signer: s.publicKey,
            bidder: v.kp.publicKey,
            market,
            bid,
            purse: v.purse,
          })
          .instruction();

    const fund = await prog.methods
      .fundBid(marketId)
      .accountsPartial({ signer: s.publicKey, market, bid, purse: v.purse })
      .instruction();

    const sig = await this.sendEr([open, fund], [s]);

    await this.erCall(
      prog.methods.initBidPermission(marketId).accountsPartial({
        payer: s.publicKey,
        market,
        bid,
        bidPermission: permissionPdaFromAccount(bid),
      }),
      s
    );
    return sig;
  }

  /**
   * Confirm on the ER by polling.
   *
   * Anchor's `.rpc()` confirms over a websocket subscription, which the ephemeral
   * validator does not always answer ("Unknown action 'undefined'"). Polling
   * `getTransaction` is slower but tells us the truth, including the program logs
   * when something failed.
   */
  async confirmEr(sig: string, ms = 45_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const tx = await this.erConn.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) {
        if (tx.meta?.err) {
          throw new Error(
            `ER tx failed: ${JSON.stringify(tx.meta.err)}\n${(tx.meta.logMessages ?? []).join("\n")}`
          );
        }
        return;
      }
      await sleep(400);
    }
    throw new Error(`ER tx ${sig} never confirmed`);
  }

  /** Submit instructions to the rollup and wait for them. */
  async sendEr(ixs: any[], signers: Keypair[]): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = (await this.erConn.getLatestBlockhash()).blockhash;
    tx.sign(...signers);
    const sig = await this.erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.confirmEr(sig);
    return sig;
  }

  /** `.rpc()` equivalent that goes through `sendEr`. */
  async erCall(builder: any, signer: Keypair): Promise<string> {
    return this.sendEr([await builder.instruction()], [signer]);
  }

  async marketState(market: PublicKey): Promise<any> {
    return (this.authorProgramEr.account as any).market.fetch(market);
  }

  async waitForExpiry(market: PublicKey): Promise<void> {
    const m = await this.marketState(market);
    const ms = m.expiresAt.toNumber() * 1000 - Date.now();
    if (ms > 0) await sleep(ms + 1500);
  }

  async expire(marketId: BN, market: PublicKey): Promise<void> {
    await this.erCall(
      this.authorProgramEr.methods
        .expireMarket(marketId)
        .accountsPartial({ cranker: this.authority.publicKey, market }),
      this.authority
    );
  }

  /** Request randomness and wait for the oracle's authenticated callback. */
  async resolveByVrf(marketId: BN, market: PublicKey, seed = 3, ms = 90_000): Promise<any> {
    await this.erCall(
      this.authorProgramEr.methods.requestResolutionVrf(marketId, seed).accountsPartial({
        payer: this.authority.publicKey,
        market,
        oracleQueue: VRF_EPHEMERAL_QUEUE,
      }),
      this.authority
    );

    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = await this.marketState(market);
      if (statusName(m.status) === "resolved") return m;
      await sleep(800);
    }
    const m = await this.marketState(market);
    throw new Error(`VRF never resolved; status=${statusName(m.status)}`);
  }

  async settleAll(marketId: BN, market: PublicKey, villagers: Villager[]): Promise<void> {
    for (const v of villagers) {
      const bid = bidPda(market, v.kp.publicKey);
      if (!(await this.erConn.getAccountInfo(bid))) continue;
      await this.erCall(
        this.authorProgramEr.methods.settleBid(marketId).accountsPartial({
          cranker: this.authority.publicKey,
          market,
          bid,
          purse: v.purse,
          bidPermission: permissionPdaFromAccount(bid),
        }),
        this.authority
      );
    }
    await this.erCall(
      this.authorProgramEr.methods
        .closeBook(marketId)
        .accountsPartial({ cranker: this.authority.publicKey, market }),
      this.authority
    );
  }

  async grantReader(marketId: BN, market: PublicKey, secret: PublicKey): Promise<void> {
    await this.erCall(
      this.authorProgramEr.methods
        .grantReader(marketId)
        .accountsPartial({ payer: this.authority.publicKey, market, secret }),
      this.authority
    );
  }

  /** Finalize on the ER, then write the tombstone once the market is home. */
  async tombstone(marketId: BN, market: PublicKey, secret: PublicKey): Promise<any> {
    await this.erCall(
      this.authorProgramEr.methods
        .finalizeMarket(marketId)
        .accountsPartial({ payer: this.authority.publicKey, market, secret }),
      this.authority
    );

    await this.waitOnBase(market, this.authorProgramBase.programId);

    await this.authorProgramBase.methods
      .writeTombstone(marketId)
      .accountsPartial({
        payer: this.authority.publicKey,
        market,
        tombstone: tombPda(market),
      })
      .rpc();
    return (this.authorProgramBase.account as any).tombstone.fetch(tombPda(market));
  }

  async permission(account: PublicKey) {
    return readPermission(this.erConn, account);
  }
}

/** Extract the body region of a raw Secret account, as L1 stores it. */
export function bodyBytesOf(data: Buffer): Buffer {
  // 8 disc + market(32) + author(32) + salt(32) + body_len(2)
  const off = 8 + 32 + 32 + 32 + 2;
  return data.subarray(off, off + 180);
}

export function tombText(tomb: any): string {
  return Buffer.from(tomb.revealed).subarray(0, tomb.revealedLen).toString("utf8");
}

export { outcomeName, statusName, ENDPOINTS, BN, PublicKey, Keypair };
