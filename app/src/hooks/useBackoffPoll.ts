"use client";

/**
 * Poll something, backing off while it keeps failing.
 *
 * Every poller in this app talks to a validator that may not be there. A fixed
 * interval against a dead endpoint retries forever at full rate, and the browser
 * records a failed request for each attempt, which buries anything useful in the
 * console and keeps a dead socket warm for no reason.
 *
 * `run` reports success or failure; the delay doubles on each consecutive
 * failure up to a minute, and snaps back the moment a call succeeds.
 */
import { useEffect, useRef } from "react";

export function useBackoffPoll(
  run: () => Promise<boolean>,
  intervalMs: number,
  maxMs = 60_000
) {
  const fn = useRef(run);
  fn.current = run;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const cycle = async () => {
      const started = Date.now();
      let ok = false;
      try {
        ok = await fn.current();
      } catch {
        ok = false;
      }
      if (!alive) return;
      failures = ok ? 0 : failures + 1;
      const wait = failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, maxMs);
      timer = setTimeout(() => void cycle(), Math.max(0, wait - (Date.now() - started)));
    };

    void cycle();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, maxMs]);
}
