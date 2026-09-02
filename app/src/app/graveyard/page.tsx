"use client";

/**
 * The graveyard.
 *
 * Read from the BASE layer only. A tombstone is the entire footprint SINBAZAAR
 * leaves on Solana: hash, room, verdict, pots — and plaintext exactly when
 * `Outcome::reveals_text()` was true and never otherwise.
 */
import Link from "next/link";
import { Empty, OutcomeBadge } from "@/components/Bits";
import { useTombstones } from "@/hooks/useMarkets";
import { explorerUrl } from "@/lib/config";
import { fmtSol, fullHash, OUTCOME_LABEL, revealsText, shortHash, shortKey } from "@/lib/format";
import { roomOf } from "@/lib/rooms";

export default function GraveyardPage() {
  const { data: tombs, loading, error, reload } = useTombstones();

  return (
    <>
      <section className="page-head">
        <div className="kicker">the graveyard</div>
        <h1>What Solana was allowed to keep.</h1>
        <p className="lede">
          Every entry here is a base-layer account. The hash is always present; the sentence is
          present only when the verdict authorised it. Nothing on this page was ever read out of
          the private rollup — the program copied it in at finalize time, under the rule.
        </p>
      </section>

      <div className="actions" style={{ marginBottom: 18 }}>
        <span className="muted small">
          {tombs.length} {tombs.length === 1 ? "tombstone" : "tombstones"}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="chip" onClick={() => void reload()}>
          refresh
        </button>
      </div>

      {error ? <div className="err">{error}</div> : null}

      {tombs.length === 0 ? (
        loading ? (
          <Empty>walking the rows…</Empty>
        ) : (
          <Empty>
            Nothing is buried yet. Take a market to zero and it will end up here.{" "}
            <Link href="/" className="explorer">
              the village
            </Link>
          </Empty>
        )
      ) : (
        <div className="grid">
          {tombs.map((tomb) => {
            const room = roomOf({ [tomb.roomVariant]: {} });
            const leaked = revealsText(tomb.outcome) && tomb.revealed.length > 0;
            return (
              <article key={tomb.address} className="tomb">
                <div className="tomb-head">
                  <span className="room-tag">{room.label}</span>
                  <OutcomeBadge outcome={tomb.outcome} />
                </div>

                <div className="hash-line">
                  <span className="hash-prefix">sha256</span>
                  <code className="hash" title={fullHash(tomb.commitment)}>
                    {shortHash(tomb.commitment, 10)}
                  </code>
                </div>

                {leaked ? (
                  <div className="confession">{tomb.revealed}</div>
                ) : (
                  <p className="epitaph">
                    {tomb.outcome === "buried"
                      ? "Someone paid for the silence. The body never left the rollup."
                      : tomb.outcome === "soleReader"
                        ? `One key was admitted: ${shortKey(tomb.soleReader, 5)}. The village got the hash.`
                        : `${OUTCOME_LABEL[tomb.outcome] ?? tomb.outcome} — no text was authorised.`}
                  </p>
                )}

                <div className="facts" style={{ marginTop: 12 }}>
                  <div className="fact">
                    <div className="lbl">seal</div>
                    <div className="val">{fmtSol(tomb.sealPot)}</div>
                  </div>
                  <div className="fact">
                    <div className="lbl">read</div>
                    <div className="val">{fmtSol(tomb.readPot)}</div>
                  </div>
                  <div className="fact">
                    <div className="lbl">randomness</div>
                    <div className="val">{tomb.randomness === "0" ? "—" : tomb.randomness}</div>
                  </div>
                </div>

                <div className="card-foot">
                  <a
                    className="explorer"
                    href={explorerUrl(tomb.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    explorer
                  </a>
                  <Link href={`/market/${tomb.market}/result`} className="muted small">
                    the verdict →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
