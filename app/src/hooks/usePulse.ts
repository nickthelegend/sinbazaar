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

  useEffect(() => {
    alive.current = true;

    const stop = subscribeSlot((s) => {
      if (!alive.current) return;
      setSlot(s);
      setLive(true);
    });

    const measure = async () => {
      const r = await pingBoth();
      if (!alive.current) return;
      setBase(r.base);
      setEr(r.er);
      // A slot from the RPC is still a slot; it just did not arrive by push.
      setSlot((prev) => (prev === null ? r.er.slot : prev));
    };
    void measure();
    const id = setInterval(() => void measure(), intervalMs);

    return () => {
      alive.current = false;
      clearInterval(id);
      stop();
    };
  }, [intervalMs]);

  return { slot, live, base, er };
}
