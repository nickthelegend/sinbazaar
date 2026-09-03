"use client";

/**
 * Create a confession.
 *
 * The form walks the real flow. Nothing is faked and nothing is batched away:
 * five base-layer transactions, then three on the rollup, and the body itself
 * only ever appears as an argument to the last one.
 */
import Link from "next/link";
import { byteLen } from "@/lib/format";
import { randomSalt } from "@/lib/anchor";
import { WhatSolanaSees } from "@/components/WhatSolanaSees";
import { useCallback, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { StepList } from "@/components/Bits";
import { useVillageWallet } from "@/components/Providers";
import {
  createConfession,
  CREATE_STEPS,
  errorText,
  type CreateConfessionResult,
  type StepState,
} from "@/lib/flows";
import { LIVE_ROOMS } from "@/lib/rooms";

const MAX_BODY = 180;
const MAX_REDACTED = 96;

/**
 * The program's limits are in BYTES, not characters.
 *
 * `seal_secret` refuses anything over 180 bytes with `InvalidBodyLength`, and a
 * UTF-8 confession is not one byte per character: an accented letter is two, a
 * CJK character is three, an emoji four. Counting `String.length` let a
 * confession in any non-ASCII language read as comfortably under the limit and
 * then be rejected on chain, after five transactions had already been signed.
 */

/** Fiction mode. Startup village sins only. */
const SEEDS: { body: string; redacted: string }[] = [
  {
    body: "I reused my teammate's pitch deck for the village demo and changed the font.",
    redacted: "One of the slides was never mine.",
  },
  {
    body: "Our village demo is vaporware. The dashboard is three screenshots and a timer.",
    redacted: "The dashboard does not connect to anything.",
  },
  {
    body: "I shorted my cofounder's token twelve hours before we announced the partnership.",
    redacted: "I was on the other side of that trade.",
  },
  {
    body: "I voted no on this project in private and then congratulated the team in public.",
    redacted: "My vote was not the one I said it was.",
  },
  {
    body: "I told the village our waitlist was four thousand. It is four hundred and eleven.",
    redacted: "There is a zero in that number I added myself.",
  },
];

const DURATIONS = [
  { secs: 45, label: "45 seconds" },
  { secs: 120, label: "2 minutes" },
  { secs: 300, label: "5 minutes" },
  { secs: 900, label: "15 minutes" },
];

export default function ConfessPage() {
  const wallet = useVillageWallet();
  const [room, setRoom] = useState(LIVE_ROOMS[0].variant);
  const [body, setBody] = useState(SEEDS[0].body);
  /**
   * Fixed once, before anything is typed, and handed to `createConfession`.
   *
   * This is what makes the live hash in the panel below the actual commitment
   * rather than a demonstration of one: the same salt is used to preview and to
   * seal, so the digest on screen is the digest that reaches Solana.
   */
  const [salt] = useState(() => randomSalt());
  const [redacted, setRedacted] = useState(SEEDS[0].redacted);
  const [duration, setDuration] = useState(120);
  const [ransomSol, setRansomSol] = useState(0.05);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateConfessionResult | null>(null);

  const roomMeta = useMemo(
    () => LIVE_ROOMS.find((r) => r.variant === room) ?? LIVE_ROOMS[0],
    [room]
  );

  const seedRandom = useCallback(() => {
    const pick = SEEDS[Math.floor(Math.random() * SEEDS.length)];
    setBody(pick.body);
    setRedacted(pick.redacted);
  }, []);

  const submit = useCallback(async () => {
    if (!wallet.signer) {
      setError("no key. Pick burner mode, or connect a wallet.");
      return;
    }
    // seal_secret checks the redacted line too, so catch it here rather than
    // after five transactions have already been signed.
    if (byteLen(redacted) > MAX_REDACTED) {
      setError(`the redacted sentence has to be at most ${MAX_REDACTED} bytes`);
      return;
    }
    if (body.trim().length === 0 || byteLen(body) > MAX_BODY) {
      setError(`the body has to be 1..${MAX_BODY} bytes`);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setStates({});
    setDetails({});
    try {
      const created = await createConfession(
        {
          signer: wallet.signer,
          roomVariant: room,
          body: body.trim(),
          salt,
          redacted: redacted.trim(),
          durationSecs: duration,
          ransomFloorLamports:
            roomMeta.variant === "blackmailEscrow"
              ? new BN(Math.round(ransomSol * LAMPORTS_PER_SOL))
              : new BN(0),
          ransomSlopeLamports: new BN(0),
        },
        (id, state, detail) => {
          setStates((prev) => ({ ...prev, [id]: state }));
          if (detail) setDetails((prev) => ({ ...prev, [id]: detail }));
        }
      );
      setResult(created);
      void wallet.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRunning(false);
    }
  }, [wallet, body, redacted, room, roomMeta, duration, ransomSol]);

  return (
    <>
      <section className="page-head">
        <div className="kicker">confess</div>
        <h1>Write it once. It never touches Solana.</h1>
        <p className="lede">
          The secret account is allocated <strong>empty</strong> on the base layer, delegated,
          and only then filled in, inside the rollup, under a private permission whose member
          list is just you. Solana learns sha256(body ‖ salt) and nothing else.
        </p>
      </section>

      <div className="two-col">
        <div className="panel">
          <h3>The confession</h3>

          <label className="field">
            <span className="lbl">room</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)} disabled={running}>
              {LIVE_ROOMS.map((r) => (
                <option key={r.variant} value={r.variant}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="hint">{roomMeta.rule[0]}</span>
          </label>

          <label className="field">
            <span className="lbl">
              body · {byteLen(body)}/{MAX_BODY}
            </span>
            <textarea
              value={body}
              maxLength={MAX_BODY}
              onChange={(e) => setBody(e.target.value)}
              disabled={running}
              placeholder="I reused my teammate's pitch deck…"
            />
            <span className="hint">
              Startup village sins only. This string is an argument to an ER transaction and
              never appears in a base-layer instruction.
            </span>
          </label>

          {/* The whole privacy model, taught in the seconds already being spent
              on the textarea above. The digest on the right is the commitment,
              not a demonstration: the salt beside it is the one that seals. */}
          <WhatSolanaSees body={body} salt={salt} />

          <label className="field">
            <span className="lbl">
              one redacted sentence · {byteLen(redacted)}/{MAX_REDACTED}
            </span>
            <input
              value={redacted}
              maxLength={MAX_REDACTED}
              onChange={(e) => setRedacted(e.target.value)}
              disabled={running}
              placeholder="One of the slides was never mine."
            />
            <span className="hint">
              The most a <code>RandomReveal</code> outcome is ever allowed to publish.
            </span>
          </label>

          <div className="row">
            <label className="field">
              <span className="lbl">timer</span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={running}
              >
                {DURATIONS.map((d) => (
                  <option key={d.secs} value={d.secs}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            {roomMeta.variant === "blackmailEscrow" ? (
              <label className="field">
                <span className="lbl">ransom floor (SOL)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={ransomSol}
                  onChange={(e) => setRansomSol(Number(e.target.value))}
                  disabled={running}
                />
              </label>
            ) : null}
          </div>

          <div className="actions">
            <button type="button" className="act" onClick={() => void submit()} disabled={running}>
              {running ? "sealing…" : "seal it"}
            </button>
            <button type="button" className="chip" onClick={seedRandom} disabled={running}>
              another sin
            </button>
            {wallet.address ? null : <span className="muted small">no key yet</span>}
          </div>

          {error ? <div className="err">{error}</div> : null}
        </div>

        <div className="panel">
          <h3>The walk</h3>
          <StepList steps={CREATE_STEPS} states={states} details={details} />

          {result ? (
            <div style={{ marginTop: 16 }}>
              <div className="lbl">commitment</div>
              <div className="mono-block">{result.commitment}</div>
              <div className="actions" style={{ marginTop: 12 }}>
                <Link href={`/market/${result.market}`} className="act">
                  open the market
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
