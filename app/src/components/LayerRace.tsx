"use client";

/**
 * Two stopwatches, one transaction, started together.
 *
 * The clock is driven by an interval that reads `performance.now()`, not by
 * counting ticks and not by `requestAnimationFrame`. Both alternatives were
 * tried and both are wrong here:
 *
 *   - Counting ticks under-reports whenever the browser is busy, which would
 *     quietly flatter the slower layer and undermine the whole point.
 *   - rAF stops entirely in a background tab. Measured: a race run in an
 *     unfocused tab observed **zero** frames, so `elapsed` stayed at 0 and a
 *     lap still in flight rendered `0ms`, a running clock presenting itself
 *     as a finished result of zero milliseconds. Intervals are throttled in a
 *     background tab rather than stopped, so the clock goes coarse instead of
 *     going false.
 *
 * Every reading is recomputed from the start timestamp, so a delayed tick is
 * late but never wrong. A lap in flight that has no reading yet shows an
 * ellipsis, never a number: the one thing this component must never do is show
 * a time it did not measure.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useVillageWallet } from "@/components/Providers";
import { raceLayers, type Lap } from "@/lib/race";
import { explorerTxUrl } from "@/lib/config";

type State = "idle" | "running" | "done";

const BLANK: Record<"base" | "er", Lap | null> = { base: null, er: null };

export function LayerRace() {
  const wallet = useVillageWallet();
  const [state, setState] = useState<State>("idle");
  const [laps, setLaps] = useState(BLANK);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopClock = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopClock, [stopClock]);

  const run = useCallback(() => {
    if (!wallet.signer || state === "running") return;
    setLaps(BLANK);
    setElapsed(null);
    setState("running");
    startedAt.current = performance.now();

    stopClock();
    // Always recomputed from the start, so a throttled tick is late, not wrong.
    timer.current = setInterval(() => {
      setElapsed(performance.now() - startedAt.current);
    }, 30);

    const { finished } = raceLayers(wallet.signer, (lap) => {
      setLaps((prev) => ({ ...prev, [lap.layer]: lap }));
    });
    void finished.finally(() => {
      stopClock();
      setState("done");
    });
  }, [wallet.signer, state, stopClock]);

  /** True only when the clock is showing a number that `ms` belongs to. */
  const hasUnit = (lap: Lap | null) => !(lap?.done && lap.ms === null);

  const clock = (lap: Lap | null) => {
    if (lap?.done && lap.ms !== null) return lap.ms.toLocaleString();
    if (lap?.done) return "failed";
    if (state === "idle") return "0";
    // In flight. A reading we do not have yet is an ellipsis, never a zero:
    // "0 ms" beside a running lane reads as a result, and it would be a lie.
    return elapsed === null ? "…" : Math.round(elapsed).toLocaleString();
  };

  const winner =
    laps.base?.ms != null && laps.er?.ms != null
      ? laps.er.ms < laps.base.ms
        ? Math.round(laps.base.ms / Math.max(laps.er.ms, 1))
        : null
      : null;

  return (
    <div className="race">
      <div className="race-head">
        <h3>The same transaction, both layers, at once</h3>
        <p className="muted small">
          A zero-lamport transfer from your key to itself. It moves nothing, so run it
          as often as you like. Both are signed and sent in the same instant and each
          clock stops on its own confirmation.
        </p>
      </div>

      <div className="race-track">
        {(["er", "base"] as const).map((layer) => {
          const lap = laps[layer];
          const running = state === "running" && !lap?.done;
          return (
            <div
              key={layer}
              className={`race-lane${running ? " running" : ""}${
                lap?.done && lap.ms !== null ? " landed" : ""
              }${lap?.error ? " failed" : ""}`}
            >
              <span className="race-layer">
                {layer === "er" ? "ephemeral rollup" : "solana base layer"}
              </span>
              <span className="race-clock">
                {clock(lap)}
                {/* The unit belongs to a number. A failed lap reads "failed",
                    and appending ms to it produced "failedms". */}
                {hasUnit(lap) ? <i>ms</i> : null}
              </span>
              {lap?.error ? (
                <span className="race-err">{lap.error.slice(0, 90)}</span>
              ) : lap?.signature ? (
                <a
                  className="race-sig"
                  href={explorerTxUrl(lap.signature, layer)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {lap.signature.slice(0, 10)}...{lap.signature.slice(-6)}
                </a>
              ) : (
                <span className="race-sig placeholder">
                  {running ? "waiting for confirmation" : "not sent yet"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="race-foot">
        <button
          type="button"
          className="keycap"
          onClick={run}
          disabled={!wallet.signer || state === "running"}
        >
          {state === "running" ? "racing..." : state === "done" ? "race again" : "start the race"}
        </button>
        {!wallet.signer ? (
          <span className="muted small">connect or spin up a burner first</span>
        ) : winner ? (
          <span className="race-verdict">
            the rollup confirmed <strong>{winner}x</strong> faster, this run
          </span>
        ) : state === "done" ? (
          <span className="muted small">
            one side did not confirm; the times above are only the ones actually measured
          </span>
        ) : null}
      </div>
    </div>
  );
}
