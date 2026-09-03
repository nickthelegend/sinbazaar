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
import { useCallback, useEffect, useRef, useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import { explorerTxUrl } from "@/lib/config";
import { fetchReceipt, type Receipt, type RollupEvent } from "@/lib/live";

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

/**
 * What the rollup charged for one transaction.
 *
 * Only ever renders numbers the node returned. A missing compute figure says
 * "not reported" rather than 0, because 0 compute units is a real value that
 * would be a lie here.
 */
function Drawer({ signature }: { signature: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    void fetchReceipt(signature).then((r) => {
      if (!alive) return;
      setReceipt(r);
      setState(r ? "ready" : "missing");
    });
    return () => {
      alive = false;
    };
  }, [signature]);

  if (state === "loading") {
    return <div className="act-drawer"><span className="act-dim">reading the receipt off the rollup...</span></div>;
  }
  if (state === "missing" || !receipt) {
    return (
      <div className="act-drawer">
        <span className="act-dim">
          The rollup no longer has this transaction. Ephemeral validators prune
          history aggressively, which is the trade that makes them fast.
        </span>
      </div>
    );
  }

  const ixLogs = receipt.logs.filter((l) => l.includes("Instruction:"));
  return (
    <div className="act-drawer">
      <dl className="act-facts">
        <div><dt>layer</dt><dd>ephemeral rollup</dd></div>
        <div><dt>slot</dt><dd>{receipt.slot.toLocaleString()}</dd></div>
        <div>
          <dt>compute</dt>
          <dd>{receipt.computeUnits === null ? "not reported" : `${receipt.computeUnits.toLocaleString()} CU`}</dd>
        </div>
        <div>
          <dt>fee</dt>
          <dd>{receipt.fee === null ? "not reported" : `${receipt.fee.toLocaleString()} lamports`}</dd>
        </div>
      </dl>
      {receipt.err ? <p className="act-err">rejected: {receipt.err}</p> : null}
      <p className="act-sigfull">{receipt.signature}</p>
      {ixLogs.length ? (
        <ul className="act-logs">
          {ixLogs.map((l, i) => (
            <li key={i}>{l.replace("Program log: ", "")}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ActivityStrip({ live }: { live: boolean }) {
  const { events, total } = useActivity();
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);

  /**
   * Freeze the list while a receipt is open.
   *
   * Without this, the row being read slides off the bottom the moment two more
   * transactions land, taking its own drawer with it. A ticker that moves under
   * the reader is not a feature.
   */
  const frozen = useRef<RollupEvent[] | null>(null);
  if (open === null) frozen.current = null;
  else if (frozen.current === null) frozen.current = events;

  const toggle = useCallback((sig: string) => {
    setOpen((cur) => (cur === sig ? null : sig));
  }, []);

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

  const source = frozen.current ?? events;
  const shown = source.slice(0, SHOWN);

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
        {open !== null ? (
          <span className="act-total">paused while you read</span>
        ) : total > 0 ? (
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
              <div className="act-rowline">
                <Row event={event} now={now} />
                <button
                  type="button"
                  className="act-more"
                  aria-expanded={open === event.signature}
                  onClick={() => toggle(event.signature)}
                >
                  {open === event.signature ? "close" : "receipt"}
                </button>
              </div>
              {open === event.signature ? <Drawer signature={event.signature} /> : null}
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
