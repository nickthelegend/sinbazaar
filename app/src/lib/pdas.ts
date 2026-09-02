/** PDA derivations. Mirrors sdk/src/index.ts, which mirrors the program's seeds. */
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./config";

export const SEEDS = {
  village: Buffer.from("village"),
  market: Buffer.from("market"),
  secret: Buffer.from("secret"),
  bid: Buffer.from("bid"),
  purse: Buffer.from("purse"),
  session: Buffer.from("session"),
  tomb: Buffer.from("tomb"),
};

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export function u64le(n: number | BN): Buffer {
  return new BN(n).toArrayLike(Buffer, "le", 8);
}

export const villagePda = (authority: PublicKey) => pda([SEEDS.village, authority.toBuffer()]);

export const marketPda = (village: PublicKey, marketId: number | BN) =>
  pda([SEEDS.market, village.toBuffer(), u64le(marketId)]);

export const secretPda = (market: PublicKey) => pda([SEEDS.secret, market.toBuffer()]);

export const bidPda = (market: PublicKey, bidder: PublicKey) =>
  pda([SEEDS.bid, market.toBuffer(), bidder.toBuffer()]);

export const pursePda = (owner: PublicKey) => pda([SEEDS.purse, owner.toBuffer()]);

export const sessionPda = (market: PublicKey, owner: PublicKey) =>
  pda([SEEDS.session, market.toBuffer(), owner.toBuffer()]);

export const tombPda = (market: PublicKey) => pda([SEEDS.tomb, market.toBuffer()]);
