/**
 * The real flows, in the order the program demands them.
 *
 * Nothing here is a shortcut: creation walks base -> delegate -> ER exactly as
 * scripts/smoke.ts does, and the confession body is only ever an argument to an
 * ER transaction — it never appears in a base-layer instruction.
 */
import { Buffer } from "buffer";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  accountsOf,
  baseConnection,
  commitmentHash,
  erConnection,
  methodsOf,
  programFor,
  randomSalt,
  sendIxs,
  sleep,
  waitForAccount,
  type VillageSigner,
} from "./anchor";
import { PROGRAM_ID, VALIDATOR, VRF_QUEUE } from "./config";
import { fullHash, toNumber, variantOf } from "./format";
import { permissionPdaFromAccount, teeConnection } from "./magicblock";
import { bidPda, marketPda, pursePda, secretPda, tombPda, villagePda } from "./pdas";
import { rememberBidder, rememberMarket } from "./registry";
import { roomArg, sideArg, type SideName } from "./rooms";

// ---------------------------------------------------------------------------
// step reporting
// ---------------------------------------------------------------------------

export type StepState = "pending" | "running" | "done" | "failed";

export interface FlowStep {
  id: string;
  label: string;
  /** Which of the three connections the step speaks to. */
  layer: "base" | "er" | "tee";
  note: string;
}

export type StepReporter = (id: string, state: StepState, detail?: string) => void;

/** The create flow, spelled out. The UI renders this list and ticks it off. */
export const CREATE_STEPS: FlowStep[] = [
  {
    id: "village",
    label: "open the village",
    layer: "base",
    note: "initialize_village — idempotent, skipped when it already exists",
  },
  {
    id: "create_market",
    label: "create_market",
    layer: "base",
    note: "public half only: id, room, timer, pots. Pre-funded to sponsor ER rent",
  },
  {
    id: "create_secret_shell",
    label: "create_secret_shell",
    layer: "base",
    note: "allocated EMPTY. No confession byte is ever in a base-layer transaction",
  },
  {
    id: "delegate_market",
    label: "delegate_market",
    layer: "base",
    note: "to the Ephemeral Rollup, so the book is real-time",
  },
  {
    id: "delegate_secret",
    label: "delegate_secret",
    layer: "base",
    note: "to the TEE validator. It is never undelegated",
  },
  {
    id: "await_er",
    label: "wait for both on the rollup",
    layer: "er",
    note: "the market and the empty shell have to land before either can be used",
  },
  {
    id: "init_market_permission",
    label: "init_market_permission",
    layer: "er",
    note: "PUBLIC by design — hash, timer, pots and status are the market",
  },
  {
    id: "init_secret_permission",
    label: "init_secret_permission",
    layer: "er",
    note: "PRIVATE. Member list starts as [author] and nobody else",
  },
  {
    id: "seal_secret",
    label: "seal_secret",
    layer: "er",
    note: "the body is written inside the rollup; L1 only learns sha256(body || salt)",
  },
];

async function step<T>(
  report: StepReporter | undefined,
  id: string,
  run: () => Promise<T>
): Promise<T> {
  report?.(id, "running");
  try {
    const value = await run();
    report?.(id, "done");
    return value;
  } catch (err) {
    report?.(id, "failed", errorText(err));
    throw err;
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export interface CreateConfessionInput {
  signer: VillageSigner;
  roomVariant: string;
  body: string;
  redacted: string;
  durationSecs: number;
  ransomFloorLamports?: BN;
  ransomSlopeLamports?: BN;
}

export interface CreateConfessionResult {
  market: string;
  secret: string;
  village: string;
  marketId: string;
  commitment: string;
}

export async function createConfession(
  input: CreateConfessionInput,
  report?: StepReporter
): Promise<CreateConfessionResult> {
  const { signer } = input;
  const base = baseConnection();
  const er = erConnection();
  const pBase = programFor(base, signer.publicKey);
  const pEr = programFor(er, signer.publicKey);

  const village = villagePda(signer.publicKey);
  const marketId = new BN(Math.floor(Math.random() * 1e9));
  const market = marketPda(village, marketId);
  const secret = secretPda(market);

  await step(report, "village", async () => {
    // `initialize_village` is init_if_needed but resets the counter, so only
    // call it the first time this key opens a stall.
    if (await base.getAccountInfo(village)) return;
    const ix = await methodsOf(pBase)
      .initializeVillage(true)
      .accountsPartial({ authority: signer.publicKey, village })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "create_market", async () => {
    const ix = await methodsOf(pBase)
      .createMarket(
        marketId,
        roomArg(input.roomVariant),
        new BN(input.durationSecs),
        input.ransomFloorLamports ?? new BN(0),
        input.ransomSlopeLamports ?? new BN(0)
      )
      .accountsPartial({ author: signer.publicKey, village, market })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "create_secret_shell", async () => {
    const ix = await methodsOf(pBase)
      .createSecretShell(marketId)
      .accountsPartial({ author: signer.publicKey, market, secret })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "delegate_market", async () => {
    const ix = await methodsOf(pBase)
      .delegateMarket(marketId)
      .accountsPartial({ author: signer.publicKey, village, market, validator: VALIDATOR })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "delegate_secret", async () => {
    const ix = await methodsOf(pBase)
      .delegateSecret(marketId)
      .accountsPartial({
        author: signer.publicKey,
        village,
        market,
        secret,
        validator: VALIDATOR,
      })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "await_er", async () => {
    await waitForAccount(er, market, "market");
    await waitForAccount(er, secret, "secret");
  });

  await step(report, "init_market_permission", async () => {
    const ix = await methodsOf(pEr)
      .initMarketPermission(marketId)
      .accountsPartial({ payer: signer.publicKey, market })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "init_secret_permission", async () => {
    const ix = await methodsOf(pEr)
      .initSecretPermission(marketId)
      .accountsPartial({ payer: signer.publicKey, market, secret })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  const bodyBytes = new TextEncoder().encode(input.body);
  const redactedBytes = new TextEncoder().encode(input.redacted);
  const salt = randomSalt();

  await step(report, "seal_secret", async () => {
    const ix = await methodsOf(pEr)
      .sealSecret(
        marketId,
        Buffer.from(bodyBytes),
        Array.from(salt),
        Buffer.from(redactedBytes)
      )
      .accountsPartial({ author: signer.publicKey, market, secret })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  rememberMarket(market.toBase58());

  return {
    market: market.toBase58(),
    secret: secret.toBase58(),
    village: village.toBase58(),
    marketId: marketId.toString(),
    commitment: fullHash(await commitmentHash(bodyBytes, salt)),
  };
}

// ---------------------------------------------------------------------------
// purse
// ---------------------------------------------------------------------------

export interface PurseView {
  address: string;
  /** Present on the rollup means delegated: bids can move lamports at ER speed. */
  onRollup: boolean;
  available: number;
  locked: number;
}

export async function readPurse(owner: PublicKey): Promise<PurseView> {
  const purse = pursePda(owner);
  const er = erConnection();
  const base = baseConnection();
  const view: PurseView = { address: purse.toBase58(), onRollup: false, available: 0, locked: 0 };

  const erInfo = await er.getAccountInfo(purse);
  if (erInfo) {
    const acct = await accountsOf(programFor(er, owner)).purse.fetch(purse);
    return {
      ...view,
      onRollup: true,
      available: toNumber(acct.available),
      locked: toNumber(acct.locked),
    };
  }
  const baseInfo = await base.getAccountInfo(purse);
  if (baseInfo && baseInfo.owner.equals(PROGRAM_ID)) {
    const acct = await accountsOf(programFor(base, owner)).purse.fetch(purse);
    return { ...view, available: toNumber(acct.available), locked: toNumber(acct.locked) };
  }
  return view;
}

/**
 * Fund a purse on the base layer and delegate it, so that every later bid is an
 * ER-native lamport move with no wallet round trip.
 */
export async function fundPurse(
  signer: VillageSigner,
  lamports: BN,
  report?: StepReporter
): Promise<void> {
  const base = baseConnection();
  const er = erConnection();
  const purse = pursePda(signer.publicKey);
  const pBase = programFor(base, signer.publicKey);

  const alreadyDelegated = !!(await er.getAccountInfo(purse));
  if (alreadyDelegated) {
    throw new Error(
      "the purse is already on the rollup — undelegate it before topping up on L1"
    );
  }

  await step(report, "deposit_purse", async () => {
    const ix = await methodsOf(pBase)
      .depositPurse(lamports)
      .accountsPartial({ owner: signer.publicKey, purse })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
  });

  await step(report, "delegate_purse", async () => {
    const ix = await methodsOf(pBase)
      .delegatePurse()
      .accountsPartial({ owner: signer.publicKey, purse, validator: VALIDATOR })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
    await waitForAccount(er, purse, "purse");
  });
}

// ---------------------------------------------------------------------------
// bid
// ---------------------------------------------------------------------------

export const BID_STEPS: FlowStep[] = [
  {
    id: "place_bid",
    label: "place_bid + fund_bid",
    layer: "er",
    note: "two instructions, ONE transaction. Lamports move purse PDA -> market PDA",
  },
  {
    id: "init_bid_permission",
    label: "init_bid_permission",
    layer: "er",
    note: "PRIVATE. Side and amount are visible to the bidder and to nobody else",
  },
];

export async function placeBid(
  signer: VillageSigner,
  market: PublicKey,
  marketId: BN,
  side: SideName,
  amount: BN,
  report?: StepReporter
): Promise<string> {
  const er = erConnection();
  const pEr = programFor(er, signer.publicKey);
  const bidder = signer.publicKey;
  const bid = bidPda(market, bidder);
  const purse = pursePda(bidder);

  const signature = await step(report, "place_bid", async () => {
    const bidIx = await methodsOf(pEr)
      .placeBid(marketId, sideArg(side), amount)
      // The wallet-signed path. `place_bid_with_session` is the separate
      // instruction a scoped session key uses; it carries the writable session
      // scope that this one deliberately does not.
      .accountsPartial({ signer: bidder, bidder, market, bid, purse })
      .instruction();
    const fundIx = await methodsOf(pEr)
      .fundBid(marketId)
      .accountsPartial({ signer: bidder, market, bid, purse })
      .instruction();
    return sendIxs(er, [bidIx, fundIx], signer);
  });

  await step(report, "init_bid_permission", async () => {
    const ix = await methodsOf(pEr)
      .initBidPermission(marketId)
      .accountsPartial({
        payer: bidder,
        market,
        bid,
        bidPermission: permissionPdaFromAccount(bid),
      })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  rememberBidder(market.toBase58(), bidder.toBase58());
  return signature;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export const RESOLVE_STEPS: FlowStep[] = [
  {
    id: "expire_market",
    label: "expire_market",
    layer: "er",
    note: "permissionless crank. An unpaid market leaks here, with no randomness",
  },
  {
    id: "request_resolution_vrf",
    label: "request_resolution_vrf",
    layer: "er",
    note: "MagicBlock VRF, requested from inside the rollup",
  },
  {
    id: "callback_resolve",
    label: "callback_resolve",
    layer: "er",
    note: "the oracle answers. Only the VRF program can sign the identity PDA",
  },
  {
    id: "settle_bid",
    label: "settle_bid",
    layer: "er",
    note: "one per bid: pay, refund or forfeit, then close the ephemeral account",
  },
  { id: "close_book", label: "close_book", layer: "er", note: "every bid accounted for" },
  {
    id: "grant_reader",
    label: "grant_reader",
    layer: "er",
    note: "only for SoleReader / Inherited: the chosen key joins the permission",
  },
  {
    id: "finalize_market",
    label: "finalize_market",
    layer: "er",
    note: "copies text into market.revealed only if the verdict authorised it, then commit_and_undelegate",
  },
  {
    id: "await_base",
    label: "wait for the market to come home",
    layer: "base",
    note: "undelegation lands it back on Solana, owned by the program again",
  },
  {
    id: "write_tombstone",
    label: "write_tombstone",
    layer: "base",
    note: "the graveyard entry. Hash always; plaintext only when authorised",
  },
];

/**
 * Walk a market from a dead timer to a tombstone on Solana.
 *
 * Every step is permissionless, so anyone looking at the market can run it. The
 * only part the browser cannot do alone is enumerate the private book — it
 * settles the bids it knows it placed (see lib/registry.ts).
 */
export async function resolveMarket(
  signer: VillageSigner,
  market: PublicKey,
  marketId: BN,
  bidders: PublicKey[],
  report?: StepReporter
): Promise<string> {
  const base = baseConnection();
  const er = erConnection();
  const pEr = programFor(er, signer.publicKey);
  const pBase = programFor(base, signer.publicKey);
  const secret = secretPda(market);

  const fetchMarket = async () => accountsOf(pEr).market.fetch(market);

  await step(report, "expire_market", async () => {
    const current = await fetchMarket();
    if (variantOf(current.status) !== "open") return;
    const ix = await methodsOf(pEr)
      .expireMarket(marketId)
      .accountsPartial({ cranker: signer.publicKey, market })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "request_resolution_vrf", async () => {
    const current = await fetchMarket();
    // An unpaid confession market resolves at expiry with no randomness at all.
    if (variantOf(current.status) !== "expired") return;
    const ix = await methodsOf(pEr)
      .requestResolutionVrf(marketId, Math.floor(Math.random() * 256))
      .accountsPartial({ payer: signer.publicKey, market, oracleQueue: VRF_QUEUE })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "callback_resolve", async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const current = await fetchMarket();
      const status = variantOf(current.status);
      if (status === "resolved" || status === "settled") return;
      await sleep(1000);
    }
    throw new Error("the oracle never answered");
  });

  await step(report, "settle_bid", async () => {
    for (const bidder of bidders) {
      const bid = bidPda(market, bidder);
      if (!(await er.getAccountInfo(bid))) continue; // already settled and closed
      // settle_bid moves the money; close_bid CPIs the magic program to reclaim the
      // ephemeral account. One transaction, two instructions — the runtime refuses
      // to see a lamport transfer and that CPI in the same instruction.
      const settle = await methodsOf(pEr)
        .settleBid(marketId)
        .accountsPartial({ cranker: signer.publicKey, market, bid, purse: pursePda(bidder) })
        .instruction();
      const close = await methodsOf(pEr)
        .closeBid(marketId)
        .accountsPartial({
          cranker: signer.publicKey,
          market,
          bid,
          bidder,
          bidPermission: permissionPdaFromAccount(bid),
        })
        .instruction();
      await sendIxs(er, [settle, close], signer);
    }
  });

  await step(report, "close_book", async () => {
    const current = await fetchMarket();
    if (variantOf(current.status) === "settled") return;
    const ix = await methodsOf(pEr)
      .closeBook(marketId)
      .accountsPartial({ cranker: signer.publicKey, market })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "grant_reader", async () => {
    const current = await fetchMarket();
    const outcome = variantOf(current.outcome);
    if (outcome !== "soleReader" && outcome !== "inherited") return;
    const ix = await methodsOf(pEr)
      .grantReader(marketId)
      .accountsPartial({ payer: signer.publicKey, market, secret })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "finalize_market", async () => {
    const ix = await methodsOf(pEr)
      .finalizeMarket(marketId)
      .accountsPartial({ payer: signer.publicKey, market, secret })
      .instruction();
    await sendIxs(er, [ix], signer);
  });

  await step(report, "await_base", async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const info = await base.getAccountInfo(market);
      if (info && info.owner.equals(PROGRAM_ID)) return;
      await sleep(1500);
    }
    throw new Error("the market never came back to Solana");
  });

  return step(report, "write_tombstone", async () => {
    const tomb = tombPda(market);
    if (await base.getAccountInfo(tomb)) return tomb.toBase58();
    const ix = await methodsOf(pBase)
      .writeTombstone(marketId)
      .accountsPartial({ payer: signer.publicKey, market, tombstone: tomb })
      .instruction();
    await sendIxs(base, [ix], signer, { skipPreflight: false });
    return tomb.toBase58();
  });
}

// ---------------------------------------------------------------------------
// the authenticated read
// ---------------------------------------------------------------------------

export interface SecretRead {
  /** Whether the validator answered with the account at all. */
  authorised: boolean;
  body: string;
  redacted: string;
}

/**
 * Open the confession over the authenticated TEE path.
 *
 * The token identifies the key; the permission member list decides whether the
 * validator answers. A key that is not a member gets nothing back — not a
 * ciphertext, not an empty account, nothing.
 */
export async function readSecret(
  signer: VillageSigner,
  market: PublicKey
): Promise<SecretRead> {
  const { connection } = await teeConnection(signer.publicKey, (m) => signer.signMessage(m));
  const program = programFor(connection, signer.publicKey);
  try {
    const acct = await accountsOf(program).secret.fetch(secretPda(market));
    const decode = (bytes: number[], len: number) =>
      new TextDecoder().decode(Uint8Array.from(bytes.slice(0, len)));
    return {
      authorised: true,
      body: decode(acct.body, toNumber(acct.bodyLen)),
      redacted: decode(acct.redacted, toNumber(acct.redactedLen)),
    };
  } catch {
    return { authorised: false, body: "", redacted: "" };
  }
}
