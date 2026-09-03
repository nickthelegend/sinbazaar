"use client";

/**
 * The rollup activity strip.
 *
 * Every other liveness signal on this page is a number that could have been
 * typed in: a latency, a slot height, a count. This one cannot be. It shows
 * real transaction signatures arriving on the ephemeral rollup as they land,
 * each one linking out to an explorer pointed at the rollup endpoint, so a
 * viewer can leave the page and check that the transaction exists.
 *
 * The three states are kept genuinely distinct, because collapsing them is a
 * lie the viewer cannot detect:
 *
 *   unreachable  the rollup is not answering. Say so.
 *   waiting      connected, nothing has landed since this tab opened.
 *   flowing      transactions, newest first.
 *
 * An empty list under a "live" heading would read as "the rollup is idle",
 * which is a claim about the chain rather than about this socket.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import { explorerTxUrl } from "@/lib/config";
import type { RollupEvent } from "@/lib/live";

/** How many rows the strip shows. The hook retains more. */
const SHOWN = 6;

/*
 * There is deliberately no exit animation, and no `AnimatePresence`.
 *
 * An exiting row stays mounted until its animation finishes, and animations run
 * on the frame loop, which the browser throttles hard in a background tab. With
 * an exit transition here, a tab left open behind another one accumulated a row
 * per transaction and never released one: measured at 19 rows on screen with
 * `SHOWN` set to 6. Rows dropping off the end of a ticker is not a moment that
 * needs choreography, and it is certainly not worth an unbounded list. Motion
 * may move a row. It may not decide whether the row exists, or when it leaves.
 */

/**
 * Anchor logs instruction names in PascalCase; the program declares them in
 * snake_case and that is what the README and the IDL say. Show the name a
 * reader could actually grep for.
 */
function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function Row({ event, now }: { event: RollupEvent; now: number }) {
  const names = event.instructions.length
    ? event.instructions.map(snake).join(" + ")
    : // A transaction that touched the program without an Anchor instruction
      // log: a CPI, or the delegation program moving the account. Real, and
      // not worth inventing a name for.
      "program invoked";
  return (
    <>
      <span className={`act-ix${event.failed ? " failed" : ""}`}>{names}</span>
      <a
        className="act-sig"
        href={explorerTxUrl(event.signature)}
        target="_blank"
        rel="noreferrer"
        title={event.signature}
      >
        {event.signature.slice(0, 8)}...{event.signature.slice(-6)}
      </a>
      <span className="act-slot">slot {event.slot.toLocaleString()}</span>
      <span className="act-age">{age(now - event.at)}</span>
    </>
  );
}

export function ActivityStrip({ live }: { live: boolean }) {
  const { events, total } = useActivity();
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  /**
   * Re-tick the relative ages. Only while something is on screen, and the
   * browser stops the interval in a background tab anyway, so a stale age is
   * corrected on the first tick after the tab comes back.
   */
  useEffect(() => {
    if (events.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [events.length]);

  const shown = events.slice(0, SHOWN);

  return (
    <div className="act" aria-live="polite">
      <div className="act-head">
        <span className="act-title">rollup activity</span>
        {live ? (
          <span className="act-state on">
            <i className="act-dot" aria-hidden="true" />
            subscribed
          </span>
        ) : (
          <span className="act-state off">no socket</span>
        )}
        {total > 0 ? (
          <span className="act-total">
            {total} {total === 1 ? "transaction" : "transactions"} this session
          </span>
        ) : null}
      </div>

      {!live ? (
        <p className="act-empty">
          The rollup is not answering on this endpoint, so there is nothing to
          stream. The latency row above says the same thing in numbers.
        </p>
      ) : shown.length === 0 ? (
        <p className="act-empty">
          Subscribed and waiting. Nothing has landed on the rollup since this tab
          opened. Open a market or place a bid and it shows up here, signature
          first.
        </p>
      ) : (
        <ul className="act-list">
          {shown.map((event) => (
            <motion.li
              key={event.signature}
              // `initial={false}` when motion is off: the row is simply there.
              // An entrance may move a row, it may never be the thing that
              // decides whether the row exists.
              initial={reduce ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <Row event={event} now={now} />
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
