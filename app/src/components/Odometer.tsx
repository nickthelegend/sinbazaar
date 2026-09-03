"use client";

/**
 * A number that rolls from its old value to its new one.
 *
 * Used on the pots, which change when a bid lands on the rollup and the
 * subscription fires. A figure that simply swaps is easy to miss; a figure that
 * travels tells the eye that something just happened and that the page did not
 * need reloading to know it.
 *
 * The rules this project has had to learn twice are both honoured here:
 *
 *   - **The resting state is the real number.** The value is rendered from the
 *     prop on the very first paint, and the roll only ever happens on a
 *     *change*. Motion never decides whether the figure exists, so a browser
 *     that never runs the animation still shows the truth.
 *   - **A throttled tab is never left mid-roll.** The tween is driven by an
 *     interval reading `performance.now()`, and every tick recomputes from the
 *     start rather than accumulating, so a late tick lands late but correct. On
 *     the last tick it snaps to the target exactly, so no rounding residue can
 *     leave 0.4999 on screen forever.
 */
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 620;

export function Odometer({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  // Starts at the real value: first paint is never a zero rolling upwards.
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;

    const quiet =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quiet) {
      from.current = value;
      setShown(value);
      return;
    }

    const t0 = performance.now();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / DURATION_MS);
      // Ease out: money arriving should decelerate into place.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(start + (value - start) * eased);
      if (t >= 1) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        from.current = value;
        setShown(value);
      }
    }, 30);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      // Whatever happened, the resting value is the true one.
      from.current = value;
    };
  }, [value]);

  return <span className={className}>{format(shown)}</span>;
}
