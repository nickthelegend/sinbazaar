"use client";

/**
 * The rollup's pulse: slot height, round-trip latency to both layers, and
 * whether the websocket is actually connected.
 *
 * This exists to make a claim falsifiable. Every SINBAZAAR page says the market
 * runs on an Ephemeral Rollup; this hook puts the two latencies side by side so
 * a viewer can see the difference rather than read about it.
 */
import { useEffect, useRef, useState } from "react";
import { pingBoth, subscribeSlot, type Ping } from "@/lib/live";

export interface Pulse {
  slot: number | null;
  live: boolean;
  base: Ping;
  er: Ping;
}

const EMPTY: Ping = { ms: null, slot: null, error: false };

export function usePulse(intervalMs = 5000): Pulse {
  const [slot, setSlot] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [base, setBase] = useState<Ping>(EMPTY);
  const [er, setEr] = useState<Ping>(EMPTY);
  const alive = useRef(true);
  const failed = useRef(false);

  useEffect(() => {
    alive.current = true;
    let stop: (() => void) | null = null;

    /**
     * Subscribe only once a read has actually succeeded, and drop the socket
     * again the moment the rollup stops answering.
     *
     * `onSlotChange` against a dead validator reconnects forever and fills the
     * console with failures, on every route, because this hook lives in the
     * footer. Measured with the cluster down: a steady stream of
     * ERR_CONNECTION_REFUSED that says nothing the page has not already said in
     * words.
     */
    const measure = async () => {
      const r = await pingBoth();
      if (!alive.current) return;
      setBase(r.base);
      setEr(r.er);

      failed.current = r.er.error && r.base.error;
      if (r.er.error) {
        if (stop) {
          stop();
          stop = null;
        }
        setLive(false);
        setSlot(null);
        return;
      }

      setSlot((prev) => prev ?? r.er.slot);
      if (!stop) {
        stop = subscribeSlot((s) => {
          if (!alive.current) return;
          setSlot(s);
          setLive(true);
        });
      }
    };

    // Same backoff as the feed: an unreachable rollup is retried less and less
    // often rather than every few seconds forever.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const cycle = async () => {
      const started = Date.now();
      await measure();
      if (!alive.current) return;
      failures = failed.current ? failures + 1 : 0;
      const wait = failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, 60_000);
      timer = setTimeout(() => void cycle(), Math.max(0, wait - (Date.now() - started)));
    };

    void cycle();

    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      if (stop) stop();
    };
  }, [intervalMs]);

  return { slot, live, base, er };
}
