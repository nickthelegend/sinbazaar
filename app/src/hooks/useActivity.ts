"use client";

/**
 * The rollup's transaction feed.
 *
 * `usePulse` proves the rollup is answering; this proves it is *working*. It
 * holds the most recent program transactions in arrival order so the page can
 * show signatures appearing in real time.
 *
 * Deliberately says nothing about connectivity. An empty list here means "no
 * transaction has landed since this tab opened", which is not the same claim as
 * "the rollup is idle" and nothing like "the rollup is down". The caller pairs
 * this with the pulse and renders the difference, because a strip that shows an
 * empty list during an outage is telling the viewer something false.
 */
import { useEffect, useRef, useState } from "react";
import { subscribeLogs, type RollupEvent } from "@/lib/live";

/** Retained in memory. More than the strip shows, so a drawer could page back. */
const KEEP = 24;

export function useActivity(): { events: RollupEvent[]; total: number } {
  const [events, setEvents] = useState<RollupEvent[]>([]);
  const total = useRef(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const stop = subscribeLogs((event) => {
      if (!alive) return;
      total.current += 1;
      setCount(total.current);
      setEvents((prev) => {
        // The validator can redeliver a signature across a reconnect. Showing
        // the same transaction twice would inflate a number a viewer is being
        // invited to trust.
        if (prev.some((e) => e.signature === event.signature)) return prev;
        return [event, ...prev].slice(0, KEEP);
      });
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { events, total: count };
}
