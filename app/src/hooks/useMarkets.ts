"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarket,
  fetchMarkets,
  fetchTombstones,
  type MarketView,
  type TombstoneView,
} from "@/lib/markets";

interface Feed<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function usePolled<T>(load: () => Promise<T>, initial: T, intervalMs: number): Feed<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    try {
      const next = await loader.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const id = setInterval(() => void reload(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [reload, intervalMs]);

  return { data, loading, error, reload };
}

/** The village feed. Polls the rollup, because that is where the book moves. */
export function useMarkets(intervalMs = 3000): Feed<MarketView[]> {
  return usePolled(fetchMarkets, [], intervalMs);
}

export function useMarket(address: string | null, intervalMs = 2000): Feed<MarketView | null> {
  const load = useCallback(
    () => (address ? fetchMarket(address) : Promise.resolve(null)),
    [address]
  );
  return usePolled(load, null, intervalMs);
}

/** The graveyard, read from the BASE layer. */
export function useTombstones(intervalMs = 8000): Feed<TombstoneView[]> {
  return usePolled(fetchTombstones, [], intervalMs);
}
