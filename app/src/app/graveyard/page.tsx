"use client";

/**
 * The graveyard.
 *
 * Read from the BASE layer only. A tombstone is the entire footprint SINBAZAAR
 * leaves on Solana: hash, room, verdict, pots, and plaintext exactly when
 * `Outcome::reveals_text()` was true and never otherwise.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, OutcomeBadge, Redaction } from "@/components/Bits";
import { useTombstones } from "@/hooks/useMarkets";
import { explorerUrl } from "@/lib/config";
import { fmtSol, fullHash, OUTCOME_LABEL, revealsText, shortHash, shortKey } from "@/lib/format";
import { roomOf } from "@/lib/rooms";

/**
 * Recompute the commitment in the reader's own browser.
 *
 * This is the point of publishing the salt alongside an authorised reveal: the
 * claim "this is the sentence that was sealed" stops being something you take on
 * trust from us and becomes something the base layer proves on its own. Nothing
 * here touches the rollup.
 */
function CommitmentCheck({
  text,
  salt,
  commitment,
  outcome,
}: {
  text: string;
  salt: number[];
  commitment: number[];
  outcome: string;
}) {
  const [state, setState] = useState<"checking" | "ok" | "mismatch" | "nosalt">("checking");

  // Only a PublicLeak publishes the body itself, so only a PublicLeak can be
  // checked against the commitment. A RandomReveal publishes the author's
  // redacted sentence, which was never what the hash covered, and the salt is
  // deliberately withheld there so the still-secret body cannot be guessed
  // offline. Running the check on that outcome would print MISMATCH for a
  // market that behaved perfectly.
  const verifiable = outcome === "publicLeak";

  useEffect(() => {
    if (!verifiable) return;
    let live = true;
    if (salt.every((b) => b === 0)) {
      setState("nosalt");
      return;
    }
    const body = new TextEncoder().encode(text);
    const bytes = new Uint8Array(body.length + salt.length);
    bytes.set(body, 0);
    bytes.set(Uint8Array.from(salt), body.length);
    crypto.subtle
      .digest("SHA-256", bytes)
      .then((buf) => {
        if (!live) return;
        const got = [...new Uint8Array(buf)];
        setState(got.every((b, i) => b === commitment[i]) ? "ok" : "mismatch");
      })
      .catch(() => live && setState("mismatch"));
    return () => {
      live = false;
    };
  }, [text, salt, commitment, verifiable]);

  if (!verifiable) {
    return (
      <p className="epitaph small">
        This is the author&rsquo;s redacted line, not the sealed body. The commitment still
        covers the confession itself, which stayed in the rollup, so there is nothing here to
        check it against.
      </p>
    );
  }

  if (state === "nosalt") {
    return (
      <p className="epitaph small">
        The salt was not published with this entry, so the commitment cannot be reproduced
        from the base layer alone.
      </p>
    );
  }

  return (
    <p className={state === "mismatch" ? "err small" : "epitaph small"}>
      {state === "checking"
        ? "checking the commitment"
        : state === "ok"
          ? "sha256(sentence \u2016 salt) matches the commitment sealed before any bid was placed, verified in your browser, from the base layer alone."
          : "commitment MISMATCH, this text is not what was sealed."}
    </p>
  );
}

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
          the private rollup, the program copied it in at finalize time, under the rule.
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
                  <>
                    <div className="confession">{tomb.revealed}</div>
                    <CommitmentCheck
                      text={tomb.revealed}
                      salt={tomb.salt}
                      commitment={tomb.commitment}
                      outcome={tomb.outcome}
                    />
                  </>
                ) : (
                  <>
                    <Redaction />
                    <p className="epitaph">
                    {tomb.outcome === "buried"
                      ? "Someone paid for the silence. The body never left the rollup."
                      : tomb.outcome === "soleReader"
                        ? `One key was admitted: ${shortKey(tomb.soleReader, 5)}. The village got the hash.`
                        : `${OUTCOME_LABEL[tomb.outcome] ?? tomb.outcome}, no text was authorised.`}
                    </p>
                  </>
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
                    <div className="val">{tomb.randomness === "0" ? ", " : tomb.randomness}</div>
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
