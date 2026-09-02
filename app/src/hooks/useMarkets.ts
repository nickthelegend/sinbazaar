"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarket,
  fetchMarkets,
  fetchTombstones,
  type MarketView,
  type TombstoneView,
} from "@/lib/markets";
import { subscribeAccount, subscribeVillage } from "@/lib/live";
import { PublicKey } from "@solana/web3.js";

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

/**
 * Subscribe to the rollup and reload on every change, coalescing bursts.
 *
 * One bid touches three accounts, the market, the purse and the new bid, and
 * would otherwise fire three reloads for one user action. A short trailing
 * window collapses that into a single fetch while still landing well inside the
 * time it takes a person to look up.
 */
function useLive(
  reload: () => Promise<void>,
  subscribe: (cb: () => void) => () => void,
  enabled: boolean
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current(), 120);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
    // `subscribe` is recreated per render by callers; depending on it would
    // resubscribe every render. The subscription target is fixed per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/**
 * The village feed.
 *
 * Live: a websocket subscription to every account this program owns on the
 * rollup, so a bid placed in another tab appears here without a refresh. The
 * poll stays as a slow safety net for endpoints that refuse subscriptions.
 */
export function useMarkets(intervalMs = 15000): Feed<MarketView[]> {
  const feed = usePolled(fetchMarkets, [], intervalMs);
  // A dead validator must not be handed a websocket to retry against forever.
  useLive(feed.reload, subscribeVillage, feed.error === null && !feed.loading);
  return feed;
}

export function useMarket(address: string | null, intervalMs = 15000): Feed<MarketView | null> {
  const load = useCallback(
    () => (address ? fetchMarket(address) : Promise.resolve(null)),
    [address]
  );
  const feed = usePolled(load, null, intervalMs);
  useLive(
    feed.reload,
    useCallback(
      (cb: () => void) => (address ? subscribeAccount(new PublicKey(address), cb) : () => {}),
      [address]
    ),
    feed.error === null && !feed.loading
  );
  return feed;
}

/** The graveyard, read from the BASE layer. */
export function useTombstones(intervalMs = 8000): Feed<TombstoneView[]> {
  return usePolled(fetchTombstones, [], intervalMs);
}
