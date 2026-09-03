"use client";

/**
 * The layer race.
 *
 * The pulse row states two latencies. A judge has no reason to believe either.
 * This fires the **same transaction** at both layers in the same instant and
 * lets them finish at their own speed, so the gap is something watched rather
 * than something asserted.
 *
 * The transaction is a zero-lamport transfer from the payer to itself. That
 * choice is deliberate and was arrived at by measurement, not by taste:
 *
 *   - It is a genuine, signed, confirmed transaction on both chains, so this is
 *     a real write path and not a dressed-up `getSlot`.
 *   - It moves nothing and can corrupt nothing, so a judge can run it as many
 *     times as they like against a live village.
 *   - `ComputeBudgetProgram` alone was tried first and **never confirms on the
 *     rollup**: 30 seconds and still pending, against 523ms on the base layer.
 *     A race that hangs on one side proves the opposite of the point.
 *
 * Both sides are started before either is awaited, and each is timed and
 * reported on its own. Awaiting one before starting the other would measure the
 * sum and call it a race.
 */
import { Connection, SystemProgram, Transaction } from "@solana/web3.js";
import { baseConnection, erConnection, type VillageSigner } from "./anchor";

export interface Lap {
  layer: "base" | "er";
  /** Milliseconds from send to confirmed. Null while running or on failure. */
  ms: number | null;
  signature: string | null;
  error: string | null;
  done: boolean;
}

export interface RaceHandle {
  /** Resolves when both laps have finished, however they finished. */
  finished: Promise<[Lap, Lap]>;
}

async function lap(
  connection: Connection,
  layer: "base" | "er",
  signer: VillageSigner,
  onDone: (lap: Lap) => void
): Promise<Lap> {
  const started = performance.now();
  const finish = (patch: Partial<Lap>): Lap => {
    const value: Lap = {
      layer,
      ms: null,
      signature: null,
      error: null,
      done: true,
      ...patch,
    };
    onDone(value);
    return value;
  };

  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: signer.publicKey,
        lamports: 0,
      })
    );
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signed = await signer.signTransaction(tx);

    // The clock starts at the send, not at the blockhash fetch or the wallet
    // prompt. Those are this browser's costs, not the chain's, and folding them
    // in would flatter the slower layer.
    const sendAt = performance.now();
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });
    const bh = await connection.getLatestBlockhash();
    const res = await connection.confirmTransaction({ signature, ...bh }, "confirmed");
    if (res.value.err) {
      return finish({ signature, error: JSON.stringify(res.value.err) });
    }
    return finish({ ms: Math.round(performance.now() - sendAt), signature });
  } catch (err) {
    return finish({
      error: err instanceof Error ? err.message : String(err),
      ms: null,
    });
  } finally {
    void started;
  }
}

/**
 * Start both laps now. Returns immediately so the caller can run its clocks.
 *
 * Each lap calls `onLap` the moment it finishes, which is what lets the rollup
 * stop its stopwatch while the base layer is still counting.
 */
export function raceLayers(
  signer: VillageSigner,
  onLap: (lap: Lap) => void
): RaceHandle {
  const base = lap(baseConnection(), "base", signer, onLap);
  const er = lap(erConnection(), "er", signer, onLap);
  return { finished: Promise.all([base, er]) };
}
