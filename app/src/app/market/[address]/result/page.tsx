"use client";

/**
 * The verdict.
 *
 * Three things can be true here and the page never blurs them: the market's
 * public reveal buffer (empty unless the outcome authorised text), the
 * permission member list, and what the TEE endpoint will actually hand back to
 * the key currently held in the browser.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Empty, OutcomeBadge } from "@/components/Bits";
import { useVillageWallet } from "@/components/Providers";
import { useMarket } from "@/hooks/useMarkets";
import { explorerUrl, TEE_RPC } from "@/lib/config";
import { errorText, readSecret, type SecretRead } from "@/lib/flows";
import { fmtSol, fullHash, revealsText, shortKey } from "@/lib/format";
import { roomOf } from "@/lib/rooms";
import { tombPda } from "@/lib/pdas";

interface Verdict {
  headline: string;
  tone: "buried" | "reader" | "leak";
  blurb: string;
}

function verdictFor(outcome: string, youAreTheReader: boolean): Verdict {
  switch (outcome) {
    case "buried":
      return {
        headline: "Buried.",
        tone: "buried",
        blurb:
          "Somebody paid for silence. The seal bidders lose their stake to the author, every read bidder is made whole, and the body stays inside the rollup permanently. Solana receives the hash and nothing else.",
      };
    case "soleReader":
      return youAreTheReader
        ? {
            headline: "You are the sole reader.",
            tone: "reader",
            blurb:
              "The randomness landed on your bid. grant_reader added your key, and only your key, to the secret's private permission. The confession is readable to you over the authenticated endpoint and to no one else, the base layer included.",
          }
        : {
            headline: "One reader was chosen.",
            tone: "reader",
            blurb:
              "MagicBlock VRF picked exactly one READ bidder and grant_reader added them to the private permission. Your key is not on that list, so the endpoint will not answer you.",
          };
    case "randomReveal":
      return {
        headline: "One sentence escaped.",
        tone: "leak",
        blurb:
          "The ransom went unmet and the coin landed on a reveal. Exactly one redacted sentence, the line the author wrote for this eventuality, is carved into the tombstone. The rest never leaves.",
      };
    case "publicLeak":
      return {
        headline: "Leaked to the graveyard.",
        tone: "leak",
        blurb:
          "Nobody paid to bury it and nobody paid to read it. The full body was copied out of the private secret at finalize time and carved into the L1 tombstone, where it stays.",
      };
    case "inherited":
      return {
        headline: "The file was inherited.",
        tone: "reader",
        blurb:
          "The randomness handed the whole body to one villager by index. They join the permission; the tombstone still carries only the hash.",
      };
    case "forgiven":
      return {
        headline: "Forgiven.",
        tone: "buried",
        blurb: "The rumor resolved YES. The YES book eats the NO book, pro rata.",
      };
    case "slashed":
      return {
        headline: "Slashed.",
        tone: "leak",
        blurb: "The rumor resolved NO. The NO book eats the YES book, pro rata.",
      };
    case "cancelled":
      return {
        headline: "Cancelled.",
        tone: "buried",
        blurb: "The author closed it before a single bid landed. Nothing was traded.",
      };
    default:
      return {
        headline: "Still undecided.",
        tone: "buried",
        blurb: "The timer has not been cranked to a verdict yet.",
      };
  }
}

export default function ResultPage() {
  const params = useParams<{ address: string }>();
  const address = typeof params.address === "string" ? params.address : null;
  const { data: market } = useMarket(address, 4000);
  const wallet = useVillageWallet();
  const [read, setRead] = useState<SecretRead | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askTee = useCallback(async () => {
    if (!wallet.signer || !market) return;
    setReading(true);
    setError(null);
    try {
      setRead(await readSecret(wallet.signer, new PublicKey(market.address)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReading(false);
    }
  }, [wallet.signer, market]);

  if (!address) return <Empty>no market address</Empty>;
  if (!market) return <Empty>reading the verdict…</Empty>;

  const room = roomOf({ [market.roomVariant]: {} });
  const me = wallet.address;
  const youAreTheReader = !!me && me === market.soleReader;
  const verdict = verdictFor(market.outcome, youAreTheReader);
  const published = revealsText(market.outcome) ? market.revealed : "";

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href={`/market/${market.address}`} className="back">
          ← the stall
        </Link>
      </div>

      <section className={`verdict ${verdict.tone}`}>
        <div className="kicker">
          {room.label} · market {market.marketId}
        </div>
        <h1>{verdict.headline}</h1>
        <p>{verdict.blurb}</p>
        <div className="actions" style={{ justifyContent: "center", marginTop: 14 }}>
          <OutcomeBadge outcome={market.outcome} />
          {market.randomness !== "0" ? (
            <span className="pill">randomness {market.randomness}</span>
          ) : null}
        </div>
      </section>

      <div className="two-col" style={{ marginTop: 20 }}>
        <div className="panel">
          <h3>What the base layer got</h3>
          {published ? (
            <>
              <div className="confession">{published}</div>
              <p className="hint">
                This text is in <code>market.revealed</code> and is copied verbatim into the
                tombstone, because <code>Outcome::reveals_text()</code> is true for{" "}
                <code>{market.outcome}</code>.
              </p>
            </>
          ) : (
            <>
              <div className="confession sealed">
                sha256(body ‖ salt) = {fullHash(market.commitment)}
              </div>
              <p className="hint">
                <code>market.revealed</code> is all zero. The verdict did not authorise text, so
                the graveyard gets the commitment and nothing more.
              </p>
            </>
          )}

          <div className="facts" style={{ marginTop: 16 }}>
            <div className="fact">
              <div className="lbl">seal pot</div>
              <div className="val">{fmtSol(market.sealPot)} SOL</div>
            </div>
            <div className="fact">
              <div className="lbl">read pot</div>
              <div className="val">{fmtSol(market.readPot)} SOL</div>
            </div>
            <div className="fact">
              <div className="lbl">sole reader</div>
              <div className="val">
                {/* The system program address is the program's "nobody". Saying
                    so beats printing a placeholder that looks like a value. */}
                {market.soleReader === "11111111111111111111111111111111"
                  ? "nobody"
                  : shortKey(market.soleReader, 6)}
              </div>
            </div>
            <div className="fact">
              <div className="lbl">bids</div>
              <div className="val">
                {market.closedBidCount}/{market.bidCount} settled
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Ask the private rollup</h3>
          <p className="muted small">
            The confession itself is only reachable over the authenticated endpoint at{" "}
            <code>{TEE_RPC}</code>. Your key signs a challenge, the validator issues a JWT, and
            the JWT rides as <code>?token=</code> on both the http and the ws URL. What the token
            buys is an identity, the permission member list decides whether anything comes back.
          </p>
          <div className="actions">
            <button
              type="button"
              className="act"
              onClick={() => void askTee()}
              disabled={!wallet.signer || reading}
            >
              {reading ? "authenticating…" : "open the confession"}
            </button>
            {me ? <span className="muted small">as {shortKey(me, 5)}</span> : null}
          </div>

          {error ? <div className="err">{error}</div> : null}

          {read ? (
            read.authorised ? (
              <>
                <div className="confession" style={{ marginTop: 14 }}>
                  {read.body}
                </div>
                {read.redacted ? (
                  <p className="hint">redacted line on file: “{read.redacted}”</p>
                ) : null}
              </>
            ) : (
              <div className="confession sealed" style={{ marginTop: 14 }}>
                the validator did not answer. This key is not on the secret&apos;s permission
                member list, so there is nothing to return, not a ciphertext, not an empty
                account, nothing.
              </div>
            )
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h3>The graveyard entry</h3>
        <div className="actions">
          <a
            className="explorer"
            href={explorerUrl(tombPda(new PublicKey(market.address)).toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            tombstone on solana explorer
          </a>
          <Link href="/graveyard" className="chip">
            the graveyard
          </Link>
        </div>
      </div>
    </>
  );
}
