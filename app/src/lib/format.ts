/** Display helpers. Nothing here touches the chain. */
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/** Anchor enums arrive as `{ variantName: {} }`. */
export const variantOf = (value: unknown): string =>
  value && typeof value === "object" ? Object.keys(value as object)[0] ?? "" : "";

export const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  expired: "EXPIRED",
  vrfPending: "VRF PENDING",
  resolved: "RESOLVED",
  settled: "SETTLED",
};

export const OUTCOME_LABEL: Record<string, string> = {
  pending: "Pending",
  buried: "Buried",
  soleReader: "Sole reader",
  randomReveal: "Random reveal",
  publicLeak: "Public leak",
  inherited: "Inherited",
  forgiven: "Forgiven",
  slashed: "Slashed",
  exportWinner: "Export winner",
  curseHit: "Curse hit",
  curseMiss: "Curse miss",
  cancelled: "Cancelled",
};

/**
 * `Outcome::reveals_text()`. The only two verdicts that authorise plaintext (or
 * a redaction) on the public L1 tombstone.
 */
export const revealsText = (outcome: string): boolean =>
  outcome === "publicLeak" || outcome === "randomReveal";

export function lamportsToSol(value: BN | number | string | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const n = BN.isBN(value) ? Number(value.toString()) : Number(value);
  return n / LAMPORTS_PER_SOL;
}

export function fmtSol(value: BN | number | string | undefined | null, digits = 3): string {
  const sol = lamportsToSol(value);
  if (sol === 0) return "0";
  if (sol < 0.001) return sol.toExponential(1);
  return sol.toFixed(digits).replace(/\.?0+$/, "");
}

export const solToLamports = (sol: number): BN =>
  new BN(Math.round(sol * LAMPORTS_PER_SOL));

/** `0x` + first bytes of the commitment. The market's public name. */
export function shortHash(bytes: number[] | Uint8Array | undefined, take = 6): string {
  if (!bytes || bytes.length === 0) return ", ";
  const arr = Array.from(bytes);
  if (arr.every((b) => b === 0)) return "unsealed";
  return arr
    .slice(0, take)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fullHash(bytes: number[] | Uint8Array | undefined): string {
  if (!bytes) return "";
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const shortKey = (key: string | undefined, take = 4): string =>
  key ? `${key.slice(0, take)}…${key.slice(-take)}` : ", ";

/** Decode the on-chain reveal buffer. Empty unless the verdict authorised it. */
export function decodeRevealed(
  bytes: number[] | Uint8Array | undefined,
  len: number | undefined
): string {
  if (!bytes || !len) return "";
  const slice = Uint8Array.from(Array.from(bytes).slice(0, len));
  return new TextDecoder().decode(slice);
}

/** mm:ss, or `h m s` past an hour. Negative reads as zero. */
export function fmtCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function toNumber(value: BN | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return BN.isBN(value) ? Number(value.toString()) : Number(value);
}

/**
 * An on-chain unix timestamp as a readable local moment.
 *
 * Returns null for 0. A zero timestamp means the event never happened, and
 * rendering it as 1 January 1970 would turn "never" into a date.
 */
export function fmtMoment(unix: BN | number | undefined | null): string | null {
  const n = typeof unix === "number" ? unix : Number(unix ?? 0);
  if (!n) return null;
  return new Date(n * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/**
 * Length in UTF-8 bytes, which is what the program's limits are measured in.
 *
 * Not `String.length`. "aé漢" is 3 characters and 6 bytes, and counting the
 * former against a byte limit is how a counter ends up telling somebody they
 * have room they do not have. Lived here as a local in the confession page
 * until a second caller needed exactly the same rule.
 */
export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}
