"use client";

/**
 * Where this market has actually lived.
 *
 * Every step is a real signature on a real layer, oldest first, so the shape of
 * a delegated account's life is visible instead of implied: created and
 * delegated on Solana, worked on the rollup, committed back.
 *
 * The component is as careful about what it cannot show as about what it can. A
 * layer that pruned its history says so in a sentence; it never renders an empty
 * list under a heading that would let a reader conclude nothing happened.
 */
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  compressionOf,
  fetchLifecycle,
  type LayerHistory,
  type Lifecycle,
} from "@/lib/lifecycle";
import { explorerTxUrl } from "@/lib/config";

/** Anchor logs PascalCase; the program and the IDL say snake_case. */
const snake = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

function LayerBlock({ title, history }: { title: string; history: LayerHistory }) {
  if (history.kind === "error") {
    return (
      <div className="life-layer">
        <h4>{title}</h4>
        <p className="life-note">could not be read: {history.message.slice(0, 120)}</p>
      </div>
    );
  }
  if (history.kind === "pruned") {
    return (
      <div className="life-layer">
        <h4>{title}</h4>
        <p className="life-note">
          {history.note}. That is a statement about this validator&apos;s retention
          window, not about whether anything happened here.
        </p>
      </div>
    );
  }
  if (history.steps.length === 0) {
    return (
      <div className="life-layer">
        <h4>{title}</h4>
        <p className="life-note">nothing recorded for this account on this layer</p>
      </div>
    );
  }
  return (
    <div className="life-layer">
      <h4>
        {title} <span className="life-count">{history.steps.length}</span>
      </h4>
      <ol className="life-steps">
        {history.steps.map((s) => (
          <li key={s.signature} className={s.failed ? "failed" : undefined}>
            <span className="life-ix">
              {s.instructions.length
                ? s.instructions.map(snake).join(" + ")
                : "program invoked"}
            </span>
            <a
              className="life-sig"
              href={explorerTxUrl(s.signature, s.layer)}
              target="_blank"
              rel="noreferrer"
            >
              {s.signature.slice(0, 8)}...
            </a>
            <span className="life-slot">slot {s.slot.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LifecycleStrip({ market }: { market: string }) {
  const [life, setLife] = useState<Lifecycle | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const l = await fetchLifecycle(new PublicKey(market));
      setLife(l);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [market]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setState("loading");
      try {
        const l = await fetchLifecycle(new PublicKey(market));
        if (alive) {
          setLife(l);
          setState("ready");
        }
      } catch {
        if (alive) setState("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [market]);

  const comp = life ? compressionOf(life) : null;

  return (
    <div className="life">
      <div className="life-head">
        <h3>Where this market has lived</h3>
        <button type="button" className="chip" onClick={() => void load()}>
          {state === "loading" ? "reading…" : "re-read"}
        </button>
      </div>

      {comp ? (
        <p className="life-ratio">
          {/* The counts are stated plainly and not spun. A market with two bids
              will not show an impressive ratio, and pretending otherwise would
              be caught by anyone who counted the rows underneath. The claim
              worth making is the one that holds for every market: the base
              layer sees this account created, delegated, returned and buried,
              and never once sees anybody trade on it. */}
          <strong>{comp.rollupWrites}</strong> rollup{" "}
          {comp.rollupWrites === 1 ? "write" : "writes"}
          {comp.ratio !== null ? (
            <>
              {" "}against <strong>{comp.baseWrites}</strong> on Solana
            </>
          ) : null}
          {comp.tradingNeverTouchedL1 ? (
            <>
              , of which <strong>{comp.rollupTrades}</strong>{" "}
              {comp.rollupTrades === 1 ? "was a stake" : "were stakes"} moving between
              purses. Solana saw this account created, delegated, handed back and
              buried. It never saw a single bid.
            </>
          ) : comp.unavailable ? (
            <>. No comparison: {comp.unavailable}.</>
          ) : (
            <>.</>
          )}
        </p>
      ) : null}

      {state === "loading" && !life ? (
        <p className="life-note">reading the signature history off both chains…</p>
      ) : state === "failed" ? (
        <p className="life-note">could not read the history for this market</p>
      ) : life ? (
        <div className="life-cols">
          <LayerBlock title="on the ephemeral rollup" history={life.er} />
          <LayerBlock title="on solana" history={life.base} />
        </div>
      ) : null}
    </div>
  );
}
