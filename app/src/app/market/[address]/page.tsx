"use client";

/**
 * One stall.
 *
 * Everything on this page except the tombstone link is read from, or written
 * to, the Ephemeral Rollup: the timer, the pots, the bids. The base layer is
 * not involved again until the market is finalised.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useBackoffPoll } from "@/hooks/useBackoffPoll";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BookBar, Countdown, Empty, OutcomeBadge, PotBar, StatusPill, StepList } from "@/components/Bits";
import { useVillageWallet } from "@/components/Providers";
import { RuleBox } from "@/components/RuleBox";
import { useMarket } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { explorerUrlFor } from "@/lib/config";
import { Copyable } from "@/components/Copyable";
import { secretPda } from "@/lib/pdas";
import {
  BID_STEPS,
  errorText,
  fundPurse,
  placeBid,
  readPurse,
  RESOLVE_STEPS,
  resolveMarket,
  type PurseView,
  type StepState,
} from "@/lib/flows";
import { fmtSol, fullHash, shortKey } from "@/lib/format";
import {
  bidWithSession,
  forgetSession,
  loadSession,
  openSession,
  revokeSession,
  SESSION_FUEL,
  type SessionView,
} from "@/lib/session";
import { knownBidders } from "@/lib/registry";
import { roomOf, SIDE_LABEL, type SideName } from "@/lib/rooms";

const PURSE_STEPS = [
  {
    id: "deposit_purse",
    label: "deposit_purse",
    layer: "base" as const,
    note: "real SOL into a purse PDA on Solana",
  },
  {
    id: "delegate_purse",
    label: "delegate_purse",
    layer: "base" as const,
    note: "delegated, so every later bid is an ER-native lamport move",
  },
];

export default function MarketPage() {
  const params = useParams<{ address: string }>();
  const address = typeof params.address === "string" ? params.address : null;
  const { data: market, error } = useMarket(address);
  const wallet = useVillageWallet();
  const now = useNow();

  const [purse, setPurse] = useState<PurseView | null>(null);
  const [amountSol, setAmountSol] = useState(0.1);
  const [topUpSol, setTopUpSol] = useState(1);
  const [ceilingSol, setCeilingSol] = useState(0.5);
  const [busy, setBusy] = useState<string | null>(null);
  const [flowStates, setFlowStates] = useState<Record<string, StepState>>({});
  const [flowDetails, setFlowDetails] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const room = market ? roomOf({ [market.roomVariant]: {} }) : null;
  const isIpo = market?.roomVariant === "whisperIpo";
  const dead = market ? now > 0 && now >= market.expiresAt : false;
  const decided = market ? market.status === "resolved" || market.status === "settled" : false;

  const refreshPurse = useCallback(async () => {
    if (!wallet.signer) {
      setPurse(null);
      return;
    }
    try {
      setPurse(await readPurse(wallet.signer.publicKey));
    } catch {
      setPurse(null);
    }
  }, [wallet.signer]);

  useBackoffPoll(
    useCallback(async () => {
      if (!wallet.signer) return true;
      try {
        setPurse(await readPurse(wallet.signer.publicKey));
        return true;
      } catch {
        setPurse(null);
        return false;
      }
    }, [wallet.signer]),
    5000
  );

  const report = useCallback((id: string, state: StepState, detail?: string) => {
    setFlowStates((prev) => ({ ...prev, [id]: state }));
    if (detail) setFlowDetails((prev) => ({ ...prev, [id]: detail }));
  }, []);

  const startFlow = useCallback(
    async (label: string, run: () => Promise<void>) => {
      setBusy(label);
      setFailure(null);
      setNotice(null);
      setFlowStates({});
      setFlowDetails({});
      try {
        await run();
      } catch (err) {
        setFailure(errorText(err));
      } finally {
        setBusy(null);
        void refreshPurse();
        void wallet.refresh();
      }
    },
    [refreshPurse, wallet]
  );

  const onFundPurse = useCallback(() => {
    if (!wallet.signer) return;
    void startFlow("purse", async () => {
      await fundPurse(wallet.signer!, new BN(Math.round(topUpSol * LAMPORTS_PER_SOL)), report);
      setNotice(`purse funded with ${topUpSol} SOL and delegated to the rollup`);
    });
  }, [wallet.signer, topUpSol, startFlow, report]);

  // A session, if this browser already holds one for this market.
  const [session, setSession] = useState<SessionView | null>(null);
  useEffect(() => {
    setSession(market ? loadSession(market.address) : null);
  }, [market?.address]);

  const onOpenSession = useCallback(() => {
    if (!wallet.signer || !market) return;
    void startFlow("session", async () => {
      const view = await openSession(
        wallet.signer!,
        new PublicKey(market.address),
        new BN(market.marketId),
        Math.max(60, market.expiresAt - Math.floor(Date.now() / 1000)),
        Math.round(ceilingSol * LAMPORTS_PER_SOL)
      );
      setSession(view);
      setNotice(
        `session open, ${shortKey(view.publicKey)} may spend up to ${ceilingSol} SOL on this market and nothing else`
      );
    });
  }, [wallet.signer, market, ceilingSol, startFlow]);

  const onRevokeSession = useCallback(() => {
    if (!wallet.signer || !market) return;
    void startFlow("session", async () => {
      await revokeSession(wallet.signer!, new PublicKey(market.address), new BN(market.marketId));
      setSession(null);
      setNotice("session revoked on the rollup, that key can no longer bid");
    });
  }, [wallet.signer, market, startFlow]);

  const onBid = useCallback(
    (side: SideName) => {
      if (!wallet.signer || !market) return;
      void startFlow("bid", async () => {
        const amount = new BN(Math.round(amountSol * LAMPORTS_PER_SOL));
        // With a live session the wallet is not involved at all: the scoped key
        // signs, and `place_bid_with_session` checks the scope on chain.
        if (session) {
          try {
            const signature = await bidWithSession(
              session,
              wallet.signer!.publicKey,
              new PublicKey(market.address),
              new BN(market.marketId),
              side,
              amount
            );
            setNotice(
              `${SIDE_LABEL[side]} bid signed by the session key, no wallet popup, ${shortKey(signature, 8)}`
            );
            return;
          } catch (err) {
            // A revoked or expired session must not silently fall back to the
            // wallet: the villager asked for a scoped key and is entitled to
            // know it stopped working.
            forgetSession(market.address);
            setSession(null);
            throw err;
          }
        }
        const signature = await placeBid(
          wallet.signer!,
          new PublicKey(market.address),
          new BN(market.marketId),
          side,
          amount,
          report
        );
        setNotice(`${SIDE_LABEL[side]} bid landed on the rollup, ${shortKey(signature, 8)}`);
      });
    },
    [wallet.signer, market, amountSol, session, startFlow, report]
  );

  const onResolve = useCallback(() => {
    if (!wallet.signer || !market) return;
    const bidders = new Set(knownBidders(market.address));
    bidders.add(wallet.signer.publicKey.toBase58());
    void startFlow("resolve", async () => {
      await resolveMarket(
        wallet.signer!,
        new PublicKey(market.address),
        new BN(market.marketId),
        [...bidders].map((b) => new PublicKey(b)),
        report
      );
      setNotice("tombstone carved on Solana");
    });
  }, [wallet.signer, market, startFlow, report]);

  const activeSteps = useMemo(() => {
    if (busy === "purse") return PURSE_STEPS;
    if (busy === "resolve" || flowStates.expire_market) return RESOLVE_STEPS;
    if (busy === "bid" || flowStates.place_bid) return BID_STEPS;
    return null;
  }, [busy, flowStates]);

  if (!address) return <Empty>no market address</Empty>;
  if (error && !market) return <div className="err">{error}</div>;
  if (!market || !room) return <Empty>reading the stall…</Empty>;

  const purseReady = !!purse?.onRollup;
  const canBid =
    !!wallet.signer && market.status === "open" && !dead && purseReady && busy === null;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/" className="back">
          ← the village
        </Link>
      </div>

      <section className="page-head market-head">
        <div className="kicker">{room.label}</div>
        {/* The headline is the stake, not the digest. A commitment set in 76px
            display type is unreadable as a value and, on an unsealed market,
            fills the viewport with two dozen zeros. The hash belongs in mono,
            at a size where it can actually be compared. */}
        <h1>{room.rule[0]}</h1>
        <div className="hash-line" style={{ marginTop: 18, maxWidth: "34rem" }}>
          <span className="hash-prefix">sha256</span>
          <code className="hash">
            {/* An unsealed market's commitment is 32 zero bytes. Printing 64
                zeros is noise, so say what it means instead. */}
            {market.commitment.every((b) => b === 0)
              ? "not sealed yet"
              : fullHash(market.commitment)}
          </code>
        </div>
        <div className="card-mid" style={{ marginTop: 12 }}>
          <Countdown expiresAt={market.expiresAt} />
          <StatusPill status={market.status} />
          <OutcomeBadge outcome={market.outcome} />
          <span className={`layer layer-${market.layer}`}>
            {market.layer === "er" ? "on the rollup" : "on solana"}
          </span>
        </div>
      </section>

      <div className="two-col">
        <div>
          <div className="panel">
            <h3>The book</h3>
            {isIpo ? (
              <BookBar yes={market.yesPot} no={market.noPot} />
            ) : (
              <PotBar seal={market.sealPot} read={market.readPot} />
            )}

            <div className="facts" style={{ marginTop: 16 }}>
              <div className="fact">
                <div className="lbl">bids</div>
                <div className="val">{market.bidCount}</div>
              </div>
              <div className="fact">
                <div className="lbl">read bids</div>
                <div className="val">{market.readBidCount}</div>
              </div>
              <div className="fact">
                <div className="lbl">escrow</div>
                <div className="val">{fmtSol(market.escrowLamports)} SOL</div>
              </div>
              <div className="fact">
                <div className="lbl">author</div>
                <div className="val">{shortKey(market.author, 6)}</div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="row">
                <label className="field" style={{ marginBottom: 0 }}>
                  <span className="lbl">bid size (SOL)</span>
                  <input
                    type="number"
                    min={0.001}
                    step={0.01}
                    value={amountSol}
                    onChange={(e) => setAmountSol(Number(e.target.value))}
                    disabled={!canBid}
                  />
                </label>
              </div>

              <div className="session-box">
                {session ? (
                  <>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="lbl">session key · live</span>
                      <button type="button" className="chip" onClick={onRevokeSession} disabled={!!busy}>
                        revoke
                      </button>
                    </div>
                    <p className="hint">
                      <code>{shortKey(session.publicKey)}</code> may spend up to{" "}
                      <strong>{(session.maxSpend / LAMPORTS_PER_SOL).toFixed(2)} SOL</strong> on
                      this market and nothing else. Bids below are signed by it, no wallet
                      popup, no base-layer transaction.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="row">
                      <label className="field" style={{ margin: 0, flex: "1 1 140px" }}>
                        <span className="lbl">session ceiling (SOL)</span>
                        <input
                          type="number"
                          min={0.01}
                          step={0.05}
                          value={ceilingSol}
                          onChange={(e) => setCeilingSol(Number(e.target.value))}
                          disabled={!canBid}
                        />
                      </label>
                      <button
                        type="button"
                        className="chip"
                        onClick={onOpenSession}
                        disabled={!canBid || !!busy}
                      >
                        {busy === "session" ? "opening…" : "open a session"}
                      </button>
                    </div>
                    <p className="hint">
                      Approve once and a scoped key takes over. <code>open_session</code> binds it
                      to this market, this ceiling and this timer;{" "}
                      <code>place_bid_with_session</code> checks all three on chain. It is funded
                      with {(SESSION_FUEL / LAMPORTS_PER_SOL).toFixed(2)} SOL for rollup fees and
                      can do nothing else with your purse.
                    </p>
                  </>
                )}
              </div>

              <div className="actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="act seal"
                  onClick={() => onBid(room.sides[0])}
                  disabled={!canBid}
                >
                  bid {SIDE_LABEL[room.sides[0]]}
                </button>
                <button
                  type="button"
                  className="act"
                  onClick={() => onBid(room.sides[1])}
                  disabled={!canBid}
                >
                  bid {SIDE_LABEL[room.sides[1]]}
                </button>
                {busy === "bid" ? <span className="spinner">signing…</span> : null}
              </div>

              <p className="hint" style={{ marginTop: 10 }}>
                <code>place_bid</code> and <code>fund_bid</code> go out as two instructions in one
                transaction. Lamports move purse PDA → market PDA inside the rollup; the side and
                the amount sit behind a private permission listing only you.
              </p>
            </div>
          </div>

          {dead && !market.tombstoned ? (
            <div className="panel">
              <h3>The timer is dead</h3>
              <p className="muted small">
                Every step below is permissionless, expiry, the VRF request, settlement and the
                tombstone. The one thing this browser cannot do is enumerate the book: bids are
                private, so it settles the ones it placed itself.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="act danger"
                  onClick={onResolve}
                  disabled={!wallet.signer || busy !== null}
                >
                  {busy === "resolve" ? "resolving…" : "resolve the market"}
                </button>
                {decided ? (
                  <Link href={`/market/${market.address}/result`} className="chip">
                    see the verdict
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {decided ? (
            <div className="panel">
              <h3>Verdict</h3>
              <div className="actions">
                <OutcomeBadge outcome={market.outcome} />
                <Link href={`/market/${market.address}/result`} className="act">
                  open the verdict
                </Link>
              </div>
            </div>
          ) : null}

          {activeSteps ? (
            <div className="panel">
              <h3>{busy ?? "last run"}</h3>
              <StepList steps={activeSteps} states={flowStates} details={flowDetails} />
            </div>
          ) : null}

          {notice ? <div className="panel small muted">{notice}</div> : null}
          {failure ? <div className="err">{failure}</div> : null}
        </div>

        <div>
          <div className="panel">
            <h3>Your purse</h3>
            {!wallet.signer ? (
              <p className="muted small">No key. Pick burner mode, or connect a wallet.</p>
            ) : purseReady ? (
              <>
                <div className="facts">
                  <div className="fact">
                    <div className="lbl">available</div>
                    <div className="val">{fmtSol(purse?.available)} SOL</div>
                  </div>
                  <div className="fact">
                    <div className="lbl">locked in bids</div>
                    <div className="val">{fmtSol(purse?.locked)} SOL</div>
                  </div>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  Delegated to the rollup, so a bid costs no wallet round trip.
                </p>
              </>
            ) : (
              <>
                <p className="muted small">
                  A purse is real SOL held on Solana and then delegated, so bidding never leaves
                  the rollup. Fund it once.
                </p>
                <div className="row">
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span className="lbl">amount (SOL)</span>
                    <input
                      type="number"
                      min={0.05}
                      step={0.1}
                      value={topUpSol}
                      onChange={(e) => setTopUpSol(Number(e.target.value))}
                      disabled={busy !== null}
                    />
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="act"
                    onClick={onFundPurse}
                    disabled={busy !== null}
                  >
                    {busy === "purse" ? "funding…" : "fund the purse"}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <RuleBox market={market} />
          </div>

          <div className="panel">
            <h3>Addresses</h3>
            <div className="lbl">market</div>
            <div className="mono-block">
              <Copyable value={market.address} label="market address" />
            </div>
            <div className="lbl" style={{ marginTop: 10 }}>
              secret
            </div>
            <div className="mono-block">
              <Copyable
                value={secretPda(new PublicKey(market.address)).toBase58()}
                label="secret address"
              />
            </div>
            <div className="lbl" style={{ marginTop: 10 }}>
              commitment
            </div>
            <div className="mono-block">
              <Copyable value={fullHash(market.commitment)} label="commitment" />
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              {/* A delegated market does not exist at this address on the base
                  explorer in the shape you are looking at, so the link follows
                  the layer the account is actually on. */}
              <a
                className="explorer"
                href={explorerUrlFor(market.address, market.layer)}
                target="_blank"
                rel="noreferrer"
              >
                {market.layer === "er" ? "view on the rollup" : "view on solana"}
              </a>
              {market.layer === "er" ? (
                <a
                  className="explorer"
                  href={explorerUrlFor(market.address, "base")}
                  target="_blank"
                  rel="noreferrer"
                >
                  and its base-layer record
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
