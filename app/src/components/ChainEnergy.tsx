"use client";

/**
 * The aurora, wired to the rollup.
 *
 * A transaction landing on the ephemeral rollup pushes a flare of light through
 * the blades. The signature strip already proves the rollup is busy in numbers;
 * this makes the room itself respond, so the page feels connected to a chain
 * rather than decorated near one.
 *
 * Deliberately built as a variable, not as a component that owns the aurora.
 * `Aurora` stays server-rendered with no state and no client JavaScript, exactly
 * as it was; all this does is write `--chain-energy` onto the root element, and
 * the blades read it. That matters for the rule this project keeps relearning:
 * **at rest the value is 0 and the aurora is precisely what it always was.** If
 * this component never mounts, never connects, or throws, nothing is lost and
 * nothing disappears. The flare is additive or it is absent.
 *
 * Decay runs on a timeout rather than an animation frame. rAF stops dead in a
 * background tab, which would strand the aurora at full flare until the tab was
 * looked at again: bright, wrong, and pointing at a rollup event that finished
 * minutes ago.
 */
import { useEffect } from "react";
import { subscribeLogs } from "@/lib/live";

/** How long one flare takes to fall back to rest. Matches the CSS transition. */
const DECAY_MS = 1100;

export function ChainEnergy() {
  useEffect(() => {
    // Honour the setting at mount. A viewer who has asked for less motion is
    // not asking for a light show tied to somebody else's transactions.
    const quiet =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quiet) return;

    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flare = () => {
      root.style.setProperty("--chain-energy", "1");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        root.style.setProperty("--chain-energy", "0");
      }, DECAY_MS);
    };

    const stop = subscribeLogs(() => flare());

    return () => {
      stop();
      if (timer) clearTimeout(timer);
      // Leave the room exactly as it was found.
      root.style.removeProperty("--chain-energy");
    };
  }, []);

  return null;
}
