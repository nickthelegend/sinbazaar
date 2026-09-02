"use client";

import { useEffect, useState } from "react";

/**
 * Unix seconds, ticking.
 *
 * Starts at 0 so the server render and the first client render agree; every
 * countdown treats 0 as "not measured yet".
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
