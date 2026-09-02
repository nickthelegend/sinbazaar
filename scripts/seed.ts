/**
 * Seed the village.
 *
 * Five markets in five different states, so a judge who opens the app sees a
 * bazaar with a history instead of an empty grid:
 *
 *   1  GuiltMarket      live, ~5 min, one SEAL bid already down
 *   2  GuiltMarket      live, ~3 min, two READ bids competing for the one seat
 *   3  GuiltMarket      settled as PUBLIC_LEAK, tombstone carved on Solana
 *   4  BlackmailEscrow  live, ransom curve ticking upward, ransom half raised
 *   5  WhisperIpo       live, one YES and one NO position
 *
 * The pitch this seeds: the confession stays in a Private Ephemeral Rollup, the
 * market runs in real time on an Ephemeral Rollup, MagicBlock VRF picks the
 * reader, and Solana only receives a tombstone. Market 3 is the proof of the last
 * clause — it is the only one whose verdict authorised any text to reach L1.
 *
 * FICTION MODE. Every confession below is startup-village satire.
 *
 * Two phases, deliberately. Phase A creates all five markets — market 3 first, so
 * its 20-second timer burns down while the others are being built. Phase B runs
 * market 3's tail at the very end, which leaves the four live markets with almost
 * their whole clock still on them when the script exits.
 *
 * Idempotent enough to run twice back to back: the village authority is reused
 * from .seed-village.json when it is there, `initialize_village` is
 * `init_if_needed`, market ids come off the village counter and step forward past
 * any PDA that is already taken, and the bidders are fresh keypairs each run so no
 * purse is ever delegated twice.
 *
 * Run:  . ./scripts/local-env.sh && npx ts-node scripts/seed.ts
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { Transaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  baseConnection,
  erConnection,
  programFor,
  villagePda,
  marketPda,
  secretPda,
  pursePda,
  bidPda,
  sessionPda,
  tombPda,
  permissionPdaFromAccount,
  PROGRAM_ID,
  VALIDATOR,
  Room,
  Side,
  fundLocal,
  sleep,
  randomSalt,
  commitmentHash,
  permissionMembers,
  statusName,
  outcomeName,
  ENDPOINTS,
  loadIdl,
  BN,
} from "../sdk/src";

const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, ".seed-village.json");
const AUTHORITY_KEYFILE = join(ROOT, ".seed-village-authority.json");

const log = (...a: any[]) => console.log(...a);
const sol = (n: number) => Math.round(n * LAMPORTS_PER_SOL);
const fmtSol = (lamports: number | string | BN) =>
  (Number(lamports.toString()) / LAMPORTS_PER_SOL).toFixed(3) + " SOL";
/** `publicLeak` -> `PUBLIC_LEAK`, so the verdict reads the way the program spells it. */
const shout = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

const IDL: any = loadIdl();
const ixAccounts = (name: string): string[] =>
  (IDL.instructions.find((i: any) => i.name === name)?.accounts ?? []).map((a: any) => a.name);

/**
 * Whether `place_bid` still carries the session scope.
 *
 * The program has been through both shapes: one where `place_bid` took the session
 * as a writable account whichever path signed the bid, and one where the session
 * path lives in its own `place_bid_with_session`. The difference matters here for a
 * blunt reason — the rollup rejects a transaction that marks a not-yet-existing
 * account writable, so on the old shape the scope has to be minted before the first
 * bid. Read the answer out of the IDL instead of betting on it.
 */
const PLACE_BID_TAKES_SESSION = ixAccounts("place_bid").includes("session");

// ---------------------------------------------------------------------------
// the village, as written
// ---------------------------------------------------------------------------

type RoomName = keyof typeof Room;
type SideName = keyof typeof Side;

interface BidSpec {
  /** Index into VILLAGERS. */
  villager: number;
  side: SideName;
  sol: number;
}

interface MarketSpec {
  /** The number the deck and the demo script call this market by. */
  n: number;
  /** Stable slug the web app can key off. */
  slug: string;
  room: RoomName;
  /** The confession. Never leaves the private rollup unless the verdict says so. */
  body: string;
  /** The one sentence a RandomReveal is allowed to publish. */
  redacted: string;
  durationSecs: number;
  ransomFloor: number;
  ransomSlope: number;
  bids: BidSpec[];
  /** Run the whole expire -> close -> finalize -> tombstone tail during seeding. */
  settle?: boolean;
  /** One line of stall-keeper copy for the summary. */
  note: string;
}

/** Bidder handles. Fresh keypairs every run; the names are just for the summary. */
const VILLAGERS = ["ash", "juno", "wren", "corvus"];

const SPECS: MarketSpec[] = [
  {
    n: 1,
    slug: "pitch-deck",
    room: "GuiltMarket",
    body: "I reused my teammate's pitch deck.",
    redacted: "One slide of it was mine.",
    durationSecs: 300,
    ransomFloor: 0,
    ransomSlope: 0,
    bids: [{ villager: 0, side: "Seal", sol: 0.35 }],
    note: "the seal pot is already alive, so this one is heading for BURIED",
  },
  {
    n: 2,
    slug: "vaporware",
    room: "GuiltMarket",
    body: "Our village demo is vaporware.",
    redacted: "The demo runs on a video loop.",
    durationSecs: 180,
    ransomFloor: 0,
    ransomSlope: 0,
    bids: [
      { villager: 1, side: "Read", sol: 0.2 },
      { villager: 2, side: "Read", sol: 0.3 },
    ],
    note: "two readers, one seat — VRF decides which of them gets the key",
  },
  {
    n: 3,
    slug: "voted-no",
    room: "GuiltMarket",
    body: "I voted no on this project in private, then asked for a slot in the demo.",
    redacted: "I voted no in private.",
    durationSecs: 20,
    ransomFloor: 0,
    ransomSlope: 0,
    bids: [],
    settle: true,
    note: "nobody paid to seal it and nobody paid to read it — the bazaar leaks it",
  },
  {
    n: 4,
    slug: "cofounder-token",
    room: "BlackmailEscrow",
    body: "I shorted my cofounder's token.",
    redacted: "I was short the whole time.",
    durationSecs: 600,
    ransomFloor: sol(0.5),
    ransomSlope: 250_000, // lamports per second — the ransom climbs while you hesitate
    bids: [{ villager: 3, side: "Seal", sol: 0.25 }],
    note: "ransom curve = 0.5 SOL + 0.00025 SOL/s; the village has raised about half",
  },
  {
    n: 5,
    slug: "ships-by-friday",
    room: "WhisperIpo",
    body: "This village ships before Friday.",
    redacted: "Friday was always aspirational.",
    durationSecs: 900,
    ransomFloor: 0,
    ransomSlope: 0,
    bids: [
      { villager: 0, side: "Yes", sol: 0.15 },
      { villager: 1, side: "No", sol: 0.25 },
    ],
    note: "the rumor is public, the positions are not — every bid has its own private permission",
  },
];

/** Ceiling a seeded session key may spend, and how long it outlives the market. */
const SESSION_MAX_SPEND = sol(1);
const SESSION_GRACE_SECS = 900;

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

/** Poll until a delegated account shows up on the rollup. */
async function waitForEr(conn: any, key: PublicKey, label: string, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const info = await conn.getAccountInfo(key);
    if (info) return info;
    await sleep(400);
  }
  throw new Error(`${label} never appeared on the ER`);
}

/** Poll until a committed account comes home to L1 owned by us again. */
async function waitForBase(conn: any, key: PublicKey, label: string, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const info = await conn.getAccountInfo(key);
    if (info && info.owner.equals(PROGRAM_ID)) return info;
    await sleep(1000);
  }
  throw new Error(`${label} never undelegated back to L1`);
}

/**
 * Send raw on the ER with `skipPreflight`, then read the executed transaction back
 * to decide whether it landed. Preflight cannot simulate the ephemeral accounts a
 * transaction is about to create, so it is skipped and the receipt is the truth.
 */
async function sendEr(
  er: any,
  ixs: any[],
  signers: Keypair[],
  label: string
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });

  const t0 = Date.now();
  let info: any = null;
  while (Date.now() - t0 < 25_000) {
    info = await er.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (info) break;
    await sleep(300);
  }
  if (!info) throw new Error(`${label}: no receipt for ${sig}`);
  if (info.meta?.err) {
    (info.meta.logMessages || []).forEach((l: string) => log("      ", l));
    throw new Error(`${label} failed: ${JSON.stringify(info.meta.err)}`);
  }
  return sig;
}

/**
 * One ER instruction, sent the same way. Anchor's `.rpc()` reports a rollup failure
 * as an actionless `SendTransactionError` carrying no logs, which says nothing
 * useful; routing every ER call through `sendEr` means every failure arrives with
 * its program logs attached.
 */
async function erRpc(er: any, builder: any, signer: Keypair, label: string): Promise<string> {
  return sendEr(er, [await builder.instruction()], [signer], label);
}

const explorer = (key: PublicKey, layer: "base" | "er") =>
  `https://explorer.solana.com/address/${key.toBase58()}?cluster=custom&customUrl=` +
  encodeURIComponent(layer === "base" ? ENDPOINTS.base : ENDPOINTS.er);

/**
 * The one thing the deployed program cannot do yet.
 *
 * `finalize_market` mutates `market.revealed` and then commits + undelegates in the
 * same instruction. The rollup hands the account to the delegation program inside
 * that CPI, so Anchor's automatic serialization at instruction exit writes to an
 * account the program no longer owns -> `ExternalAccountDataModified`. It only bites
 * for the two verdicts that actually write bytes (PublicLeak, RandomReveal); every
 * other verdict writes zeros over zeros, the data is unchanged, and finalize sails
 * through — which is why scripts/smoke.ts gets its SoleReader tombstone.
 *
 * The fix is the single line every MagicBlock example carries before a commit (see
 * vendor/magicblock-engine-examples/session-keys/anchor/programs/anchor-counter-session/
 * src/lib.rs :: increment_and_undelegate): flush with
 * `ctx.accounts.market.exit(&crate::ID)?;` before building the intent bundle. This
 * script needs no edit once that ships — it will simply stop taking the fallback.
 */
const FINALIZE_REVEAL_BLOCKER =
  "finalize_market cannot publish text yet: it mutates market.revealed and then " +
  "commit_and_undelegate hands the account to the delegation program inside the same " +
  "instruction, so Anchor's exit write fails with ExternalAccountDataModified. Fix: " +
  "`ctx.accounts.market.exit(&crate::ID)?;` immediately before MagicIntentBundleBuilder " +
  "in programs/sinbazaar/src/lib.rs::finalize_market.";

const isFinalizeRevealBlocker = (e: any) =>
  String(e?.message || e).includes("ExternalAccountDataModified");

// ---------------------------------------------------------------------------
// the authority: reused across runs so the village keeps one address
// ---------------------------------------------------------------------------

function loadOrCreateAuthority(): { kp: Keypair; reused: boolean } {
  if (!process.env.SEED_FRESH_VILLAGE && existsSync(MANIFEST)) {
    try {
      const prev = JSON.parse(readFileSync(MANIFEST, "utf8"));
      if (Array.isArray(prev.authoritySecretKey)) {
        return {
          kp: Keypair.fromSecretKey(Uint8Array.from(prev.authoritySecretKey)),
          reused: true,
        };
      }
    } catch {
      /* an unreadable manifest is not worth failing a seed over */
    }
  }
  return { kp: Keypair.generate(), reused: false };
}

// ---------------------------------------------------------------------------
// phase A — build a market and put its bids on the board
// ---------------------------------------------------------------------------

interface SeedCtx {
  base: any;
  er: any;
  author: Keypair;
  pBase: Program;
  pEr: Program;
  village: PublicKey;
  villagers: Keypair[];
}

interface SeededBid {
  handle: string;
  pubkey: string;
  side: SideName;
  lamports: number;
  bid: string;
  /** Scoped session key minted for this villager on this market, when the
   *  wallet-signed bid path still needs one. */
  session: string | null;
  sessionKey: string | null;
  sessionKeySecret: number[] | null;
}

interface Built {
  spec: MarketSpec;
  marketId: BN;
  market: PublicKey;
  secret: PublicKey;
  bidders: SeededBid[];
}

interface Tail {
  tombstone: PublicKey | null;
  revealed: string | null;
  blocker: string | null;
}

async function buildMarket(ctx: SeedCtx, spec: MarketSpec, marketId: BN): Promise<Built> {
  const { base, er, author, pBase, pEr, village, villagers } = ctx;
  const market = marketPda(village, marketId);
  const secret = secretPda(market);

  log(`\n[${spec.n}] ${spec.room} — "${spec.body}"`);
  log(`     market_id=${marketId.toString()} market=${market.toBase58()}`);

  // ---- L1: the public shell and the empty secret -------------------------
  await pBase.methods
    .createMarket(
      marketId,
      Room[spec.room],
      new BN(spec.durationSecs),
      new BN(spec.ransomFloor),
      new BN(spec.ransomSlope)
    )
    .accountsPartial({ author: author.publicKey, village, market })
    .rpc();
  await pBase.methods
    .createSecretShell(marketId)
    .accountsPartial({ author: author.publicKey, market, secret })
    .rpc();

  // The privacy argument in one assertion: the account exists on L1 and its body
  // region is still all zeroes when the delegation program takes it.
  const shell = await base.getAccountInfo(secret);
  const bodyRegion = shell!.data.subarray(8 + 32 + 32 + 32 + 2, 8 + 32 + 32 + 32 + 2 + 180);
  log(`     secret shell allocated empty on L1: ${bodyRegion.every((b: number) => b === 0)}`);

  await pBase.methods
    .delegateMarket(marketId)
    .accountsPartial({ author: author.publicKey, village, market, validator: VALIDATOR })
    .rpc();
  await pBase.methods
    .delegateSecret(marketId)
    .accountsPartial({ author: author.publicKey, village, market, secret, validator: VALIDATOR })
    .rpc();
  await waitForEr(er, market, "market");
  await waitForEr(er, secret, "secret");
  log("     delegated; both accounts live on the ER");

  // ---- ER: permissions, then the confession itself -----------------------
  await erRpc(
    er,
    pEr.methods.initMarketPermission(marketId).accountsPartial({ payer: author.publicKey, market }),
    author,
    "init_market_permission"
  );
  await erRpc(
    er,
    pEr.methods
      .initSecretPermission(marketId)
      .accountsPartial({ payer: author.publicKey, market, secret }),
    author,
    "init_secret_permission"
  );

  const salt = randomSalt();
  await erRpc(
    er,
    pEr.methods
      .sealSecret(
        marketId,
        Buffer.from(spec.body, "utf8"),
        Array.from(salt),
        Buffer.from(spec.redacted, "utf8")
      )
      .accountsPartial({ author: author.publicKey, market, secret }),
    author,
    "seal_secret"
  );

  const sealed: any = await (pEr.account as any).market.fetch(market);
  const matches = Buffer.from(sealed.commitmentHash).equals(commitmentHash(spec.body, salt));
  const perm = await permissionMembers(er, secret);
  log(
    `     sealed. commitment matches: ${matches}; secret permission private=${perm.isPrivate}` +
      ` members=${perm.members.length}`
  );

  // ---- ER: the bids that are already on the board ------------------------
  const bidders: SeededBid[] = [];
  for (const b of spec.bids) {
    const bidder = villagers[b.villager];
    const handle = VILLAGERS[b.villager];
    const purse = pursePda(bidder.publicKey);
    const session = sessionPda(market, bidder.publicKey);
    const bid = bidPda(market, bidder.publicKey);
    const amount = new BN(sol(b.sol));
    const pErBidder = programFor(er, bidder);

    // On the shape where `place_bid` carries the scope, mint it first: the rollup
    // will not accept a writable account that does not exist yet. The seeded key is
    // also what a wallet-free client signs with, so it is a useful artifact either
    // way — it is just no longer this transaction's problem when the program keeps
    // the session path in `place_bid_with_session`.
    const sessionKp = Keypair.generate();
    if (PLACE_BID_TAKES_SESSION) {
      await erRpc(
        er,
        pErBidder.methods
          .openSession(
            marketId,
            new BN(spec.durationSecs + SESSION_GRACE_SECS),
            new BN(SESSION_MAX_SPEND),
            sessionKp.publicKey
          )
          .accountsPartial({ owner: bidder.publicKey, market, session }),
        bidder,
        `open_session (${handle})`
      );
    }

    // place_bid opens the ephemeral account, fund_bid moves the lamports purse ->
    // market. Two instructions, ONE transaction, so a bid is opened and funded
    // together or not at all.
    const bidAccounts: Record<string, PublicKey> = {
      signer: bidder.publicKey,
      bidder: bidder.publicKey,
      market,
      bid,
      purse,
    };
    if (PLACE_BID_TAKES_SESSION) bidAccounts.session = session;
    const bidIx = await pErBidder.methods
      .placeBid(marketId, Side[b.side], amount)
      .accountsPartial(bidAccounts)
      .instruction();
    const fundIx = await pErBidder.methods
      .fundBid(marketId)
      .accountsPartial({ signer: bidder.publicKey, market, bid, purse })
      .instruction();
    await sendEr(er, [bidIx, fundIx], [bidder], `bid+fund (${handle})`);

    // The side and the amount belong to the bidder alone.
    await erRpc(
      er,
      pErBidder.methods.initBidPermission(marketId).accountsPartial({
        payer: bidder.publicKey,
        market,
        bid,
        bidPermission: permissionPdaFromAccount(bid),
      }),
      bidder,
      `init_bid_permission (${handle})`
    );

    bidders.push({
      handle,
      pubkey: bidder.publicKey.toBase58(),
      side: b.side,
      lamports: amount.toNumber(),
      bid: bid.toBase58(),
      session: PLACE_BID_TAKES_SESSION ? session.toBase58() : null,
      sessionKey: PLACE_BID_TAKES_SESSION ? sessionKp.publicKey.toBase58() : null,
      sessionKeySecret: PLACE_BID_TAKES_SESSION ? Array.from(sessionKp.secretKey) : null,
    });
    log(`     ${handle} bid ${b.side.toUpperCase()} ${fmtSol(amount)} (private)`);
  }

  return { spec, marketId, market, secret, bidders };
}

// ---------------------------------------------------------------------------
// phase B — expire, settle, and carve the tombstone
// ---------------------------------------------------------------------------

async function settleMarket(ctx: SeedCtx, built: Built): Promise<Tail> {
  const { base, er, author, pBase, pEr } = ctx;
  const { spec, marketId, market, secret } = built;

  log(`\n[${spec.n}] closing the book`);
  const live: any = await (pEr.account as any).market.fetch(market);
  const waitMs = Math.max(0, live.expiresAt.toNumber() * 1000 - Date.now()) + 2000;
  if (waitMs > 2000) log(`     waiting ${Math.round(waitMs / 1000)}s for the timer...`);
  await sleep(waitMs);

  // A GuiltMarket nobody paid to seal and nobody paid to read resolves the instant
  // it expires: PUBLIC_LEAK, no randomness required.
  await erRpc(
    er,
    pEr.methods.expireMarket(marketId).accountsPartial({ cranker: author.publicKey, market }),
    author,
    "expire_market"
  );
  const expired: any = await (pEr.account as any).market.fetch(market);
  log(`     expired -> ${shout(statusName(expired.status))} / ${shout(outcomeName(expired.outcome))}`);

  await erRpc(
    er,
    pEr.methods.closeBook(marketId).accountsPartial({ cranker: author.publicKey, market }),
    author,
    "close_book"
  );

  // finalize copies the body out of the private secret into the market's reveal
  // buffer — only because the outcome authorised it — then commits and undelegates.
  try {
    await erRpc(
      er,
      pEr.methods
        .finalizeMarket(marketId)
        .accountsPartial({ payer: author.publicKey, market, secret }),
      author,
      "finalize_market"
    );
    log("     finalized (commit + undelegate)");

    await waitForBase(base, market, "market");
    await pBase.methods
      .writeTombstone(marketId)
      .accountsPartial({ payer: author.publicKey, market, tombstone: tombPda(market) })
      .rpc();
    const tombstone = tombPda(market);
    const tomb: any = await (pBase.account as any).tombstone.fetch(tombstone);
    const revealed = Buffer.from(tomb.revealed.slice(0, tomb.revealedLen)).toString("utf8");
    log(`     TOMBSTONE on Solana: ${shout(outcomeName(tomb.outcome))} — "${revealed}"`);
    return { tombstone, revealed, blocker: null };
  } catch (e: any) {
    // A verdict that publishes text is the one path the deployed program cannot
    // finish. Leave the market where it stands — settled, with the PUBLIC_LEAK
    // verdict recorded on the rollup — rather than pretending the seed failed.
    if (!isFinalizeRevealBlocker(e)) throw e;
    log("     !! finalize blocked by a program bug; market left settled on the ER");
    return { tombstone: null, revealed: null, blocker: FINALIZE_REVEAL_BLOCKER };
  }
}

// ---------------------------------------------------------------------------
// read back whichever layer now holds the truth
// ---------------------------------------------------------------------------

interface SeededMarket {
  n: number;
  slug: string;
  room: RoomName;
  marketId: string;
  market: string;
  secret: string;
  tombstone: string | null;
  status: string;
  outcome: string;
  state: string;
  commitmentHash: string;
  expiresAt: number;
  sealPot: string;
  readPot: string;
  yesPot: string;
  noPot: string;
  ransomFloor: string;
  ransomSlope: string;
  bidCount: number;
  revealed: string | null;
  bidders: SeededBid[];
  body: string;
  note: string;
  /** Set when the deployed program could not carry this market all the way. */
  blocker: string | null;
  urls: { marketBase: string; marketEr: string; secretEr: string; tombstone: string | null };
}

async function describeMarket(
  ctx: SeedCtx,
  built: Built,
  tail: Tail | null
): Promise<SeededMarket> {
  const { spec, marketId, market, secret, bidders } = built;
  // Once it is tombstoned the market lives on L1 again; until then the rollup is the
  // only place its current state exists.
  const source = tail && !tail.blocker ? ctx.pBase : ctx.pEr;
  const m: any = await (source.account as any).market.fetch(market);
  const status = statusName(m.status);
  const outcome = outcomeName(m.outcome);

  return {
    n: spec.n,
    slug: spec.slug,
    room: spec.room,
    marketId: marketId.toString(),
    market: market.toBase58(),
    secret: secret.toBase58(),
    tombstone: tail?.tombstone ? tail.tombstone.toBase58() : null,
    status,
    outcome,
    state: !tail
      ? `${shout(status)} on the ER`
      : tail.blocker
        ? `${shout(status)} · ${shout(outcome)} · awaiting finalize`
        : `${shout(status)} · ${shout(outcome)} · tombstoned on L1`,
    commitmentHash: Buffer.from(m.commitmentHash).toString("hex"),
    expiresAt: m.expiresAt.toNumber(),
    sealPot: m.sealPot.toString(),
    readPot: m.readPot.toString(),
    yesPot: m.yesPot.toString(),
    noPot: m.noPot.toString(),
    ransomFloor: m.ransomFloor.toString(),
    ransomSlope: m.ransomSlope.toString(),
    bidCount: m.bidCount,
    revealed: tail?.revealed ?? null,
    bidders,
    body: spec.body,
    note: spec.note,
    blocker: tail?.blocker ?? null,
    urls: {
      marketBase: explorer(market, "base"),
      marketEr: explorer(market, "er"),
      secretEr: explorer(secret, "er"),
      tombstone: tail?.tombstone ? explorer(tail.tombstone, "base") : null,
    },
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

(async () => {
  log("SINBAZAAR — seeding the village. FICTION MODE: startup-village satire only.\n");
  log("endpoints:", JSON.stringify(ENDPOINTS, null, 2));

  const base = baseConnection();
  const er = erConnection();

  const { kp: author, reused } = loadOrCreateAuthority();
  log(`\nvillage authority ${author.publicKey.toBase58()} (${reused ? "reused" : "new"})`);
  await fundLocal(base, author.publicKey, 10);

  const pBase = programFor(base, author);
  const pEr = programFor(er, author);
  const village = villagePda(author.publicKey);

  // `initialize_village` is init_if_needed, but its handler assigns
  // `market_count = 0` unconditionally — calling it on a standing village would
  // rewind the counter under markets that already exist. So only open a village
  // that is not there yet, and let a second run walk in through the front door.
  const standing = await base.getAccountInfo(village);
  if (!standing) {
    await pBase.methods
      .initializeVillage(true)
      .accountsPartial({ authority: author.publicKey, village })
      .rpc();
  }
  const v: any = await (pBase.account as any).village.fetch(village);
  log(
    `village ${village.toBase58()} ${standing ? "already open" : "opened"}.` +
      ` fiction_mode=${v.fictionMode} markets so far=${v.marketCount}`
  );

  // Fresh bidders every run: a purse can only be delegated once, and topping up a
  // delegated purse would mean writing on a layer that no longer owns it.
  const villagers: Keypair[] = VILLAGERS.map(() => Keypair.generate());
  log("\nvillagers:");
  for (let i = 0; i < villagers.length; i++) {
    const kp = villagers[i];
    const purse = pursePda(kp.publicKey);
    const pv = programFor(base, kp);
    await fundLocal(base, kp.publicKey, 3);
    await pv.methods
      .depositPurse(new BN(sol(2)))
      .accountsPartial({ owner: kp.publicKey, purse })
      .rpc();
    await pv.methods
      .delegatePurse()
      .accountsPartial({ owner: kp.publicKey, purse, validator: VALIDATOR })
      .rpc();
    await waitForEr(er, purse, `purse(${VILLAGERS[i]})`);
    log(`  ${VILLAGERS[i].padEnd(7)} ${kp.publicKey.toBase58()}  purse funded 2.000 SOL, delegated`);
  }

  const ctx: SeedCtx = { base, er, author, pBase, pEr, village, villagers };

  // Market ids come off the village counter, then step past anything already taken
  // so a re-run never collides with the markets the last run left standing.
  let nextId = new BN(v.marketCount.toString());
  const claimId = async (): Promise<BN> => {
    for (let tries = 0; tries < 64; tries++) {
      const candidate = nextId;
      nextId = nextId.add(new BN(1));
      if (!(await base.getAccountInfo(marketPda(village, candidate)))) return candidate;
    }
    throw new Error("could not find a free market id");
  };

  // Phase A. The market that has to sit through its own timer is built first, so
  // that timer burns down while the rest of the village goes up; the live ones
  // follow longest-clock-first, which leaves the shortest one created last.
  const order = [...SPECS].sort((a, b) =>
    !!a.settle === !!b.settle ? b.durationSecs - a.durationSecs : a.settle ? -1 : 1
  );
  const built: Built[] = [];
  for (const spec of order) built.push(await buildMarket(ctx, spec, await claimId()));

  // Phase B. Now, with every live market already on the board.
  const tails = new Map<number, Tail>();
  for (const b of built) if (b.spec.settle) tails.set(b.spec.n, await settleMarket(ctx, b));

  const seeded: SeededMarket[] = [];
  for (const b of built) seeded.push(await describeMarket(ctx, b, tails.get(b.spec.n) ?? null));
  seeded.sort((a, b) => a.n - b.n);

  // ---- manifest ----------------------------------------------------------
  const manifest = {
    seededAt: new Date().toISOString(),
    fictionMode: true,
    programId: PROGRAM_ID.toBase58(),
    validator: VALIDATOR.toBase58(),
    endpoints: ENDPOINTS,
    authority: author.publicKey.toBase58(),
    authoritySecretKey: Array.from(author.secretKey),
    village: village.toBase58(),
    villagers: villagers.map((kp, i) => ({
      handle: VILLAGERS[i],
      pubkey: kp.publicKey.toBase58(),
      purse: pursePda(kp.publicKey).toBase58(),
      secretKey: Array.from(kp.secretKey),
    })),
    markets: seeded,
    blockers: seeded.filter((m) => m.blocker).map((m) => ({ market: m.n, blocker: m.blocker })),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  // A plain 64-byte array too, so `solana --keypair` and any wallet loader can use it.
  writeFileSync(AUTHORITY_KEYFILE, JSON.stringify(Array.from(author.secretKey)));

  // ---- summary -----------------------------------------------------------
  const rule = "─".repeat(78);
  log(`\n${rule}`);
  log("THE VILLAGE IS OPEN");
  log(rule);
  log(`village    ${village.toBase58()}`);
  log(`authority  ${author.publicKey.toBase58()}`);
  log(`program    ${PROGRAM_ID.toBase58()}`);
  log(`manifest   ${MANIFEST}`);
  log(`keypair    ${AUTHORITY_KEYFILE}`);

  const now = Math.floor(Date.now() / 1000);
  for (const m of seeded) {
    log(`\n${rule}`);
    log(`[${m.n}] ${m.room}  ·  ${m.state}`);
    log(`    "${m.body}"`);
    log(`    ${m.note}`);
    log(`    market    ${m.market}   (market_id ${m.marketId})`);
    log(`    secret    ${m.secret}`);
    if (m.tombstone) log(`    tombstone ${m.tombstone}`);
    log(`    hash      ${m.commitmentHash.slice(0, 32)}...`);
    if (m.status === "open") log(`    closes in ${Math.max(0, m.expiresAt - now)}s`);
    if (m.room === "WhisperIpo") {
      log(`    book      YES ${fmtSol(m.yesPot)}  /  NO ${fmtSol(m.noPot)}`);
    } else {
      log(
        `    pots      SEAL ${fmtSol(m.sealPot)}  /  READ ${fmtSol(m.readPot)}   bids ${m.bidCount}`
      );
    }
    if (m.room === "BlackmailEscrow") {
      const due = Number(m.ransomFloor) + Number(m.ransomSlope) * Math.max(0, m.expiresAt - now);
      log(
        `    ransom    floor ${fmtSol(m.ransomFloor)} + ${m.ransomSlope} lamports/s` +
          `  (~${fmtSol(due)} at close)`
      );
    }
    for (const b of m.bidders) {
      log(
        `    bid       ${b.handle.padEnd(7)} ${b.side.toUpperCase().padEnd(5)} ${fmtSol(b.lamports)}` +
          `  private to ${b.handle}` +
          (b.sessionKey ? `; session key ${b.sessionKey.slice(0, 8)}...` : "")
      );
    }
    if (m.revealed) log(`    LEAKED    "${m.revealed}"`);
    log(`    solana    ${m.urls.marketBase}`);
    log(`    rollup    ${m.urls.marketEr}`);
    if (m.urls.tombstone) log(`    grave     ${m.urls.tombstone}`);
  }

  log(`\n${rule}`);
  log("Confession stays in a Private Ephemeral Rollup. The market runs in real time");
  log("on an Ephemeral Rollup. MagicBlock VRF picks the reader. Solana only receives");
  log("a tombstone — and market 3 is the one whose verdict authorised any text at all.");

  const blocked = seeded.filter((m) => m.blocker);
  if (blocked.length) {
    log(`\n${rule}`);
    log("BLOCKER — the graveyard is empty, and it is not this script's doing.");
    log(rule);
    log("`finalize_market` is the only instruction that mutates the market and then");
    log("commit_and_undelegates it in the same breath. The rollup hands the account to");
    log("the delegation program inside that CPI, so Anchor's automatic serialization at");
    log("instruction exit writes to an account the program no longer owns:");
    log("");
    log("    Error: ExternalAccountDataModified");
    log("    instruction modified data of an account it does not own");
    log("");
    log("It only bites for the two verdicts that actually write bytes — PUBLIC_LEAK and");
    log("RANDOM_REVEAL. Every other verdict writes zeros over zeros, the data is");
    log("unchanged, and finalize sails through, which is why scripts/smoke.ts gets its");
    log("SOLE_READER tombstone. One line fixes it — the same line every MagicBlock");
    log("example carries before a commit:");
    log("");
    log("    // programs/sinbazaar/src/lib.rs :: finalize_market");
    log("    ctx.accounts.market.exit(&crate::ID)?;   // flush before the intent bundle");
    log("    MagicIntentBundleBuilder::new(...)");
    log("");
    log("cf. vendor/magicblock-engine-examples/session-keys/anchor/programs/");
    log("    anchor-counter-session/src/lib.rs :: increment_and_undelegate");
    log("");
    log("Rebuild, redeploy, re-run this script; it needs no edit — market 3 will carve");
    log(`its own tombstone. Markets left waiting: ${blocked.map((m) => m.n).join(", ")}.`);
  }
  log(rule);
  process.exit(0);
})().catch((e) => {
  console.error("\nSEED ERROR:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  console.error(e?.stack?.split("\n").slice(0, 12).join("\n"));
  process.exit(1);
});
