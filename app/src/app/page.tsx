"use client";

/**
 * The landing page.
 *
 * The organising idea is the product's own mechanic: a confession has a clock on
 * it, and scrolling this page is the clock running down. The scroll drives a
 * pinned sequence in which one confession physically moves from Solana to a
 * rollup to an enclave, and the page ends where a real market ends, at a verdict.
 *
 * Nothing here is a mockup. The village strip, the tombstones, the latency, the
 * slot height and the privacy probes are all live reads against whatever cluster
 * this build points at. The counters are the real instruction, room and test
 * counts. If the chain is empty, the sections say so rather than inventing rows.
 *
 * Motion is split by job, not sprinkled:
 *   GSAP ScrollTrigger  - the hero timeline, the pinned layer sequence, the
 *                         scrubbed drift and the counters. Anything tied to
 *                         scroll position or a multi-beat sequence.
 *   Framer Motion       - hover, tap, presence and layout. Anything tied to a
 *                         component's own state.
 */
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Connection, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { ActivityStrip } from "@/components/Activity";
import { MarketCard } from "@/components/MarketCard";
import { OutcomeBadge, Redaction } from "@/components/Bits";
import { CountUp, Drift, HeroIntro, PinnedSequence, StaggerIn } from "@/components/motion/Scroll";
import { useMarkets, useTombstones } from "@/hooks/useMarkets";
import { usePulse } from "@/hooks/usePulse";
import { getAuthToken } from "@/lib/magicblock";
import { secretPda } from "@/lib/pdas";
import { CLUSTER, ER_RPC, PROGRAM_ID, TEE_RPC } from "@/lib/config";
import { IDL } from "@/lib/anchor";
import { TEST_COUNT } from "@/lib/counts";
import { shortHash, shortKey } from "@/lib/format";
import { LIVE_ROOMS, ROOMS } from "@/lib/rooms";

/*
 * Real counts.
 *
 * Two of these are now read straight out of the IDL this app already loads to
 * talk to the program, so they cannot drift: add an instruction or an error
 * variant and the number on the page moves with it. They were hardcoded, and
 * within one commit of adding a test the page was already stating a figure that
 * was no longer true.
 *
 * The test count is the one that cannot be derived at runtime, because the
 * suite does not run in the browser. It is asserted against in CI-style by
 * `npm test` itself, and this file is the single place to update it.
 */
const INSTRUCTION_COUNT = (IDL as { instructions?: unknown[] }).instructions?.length ?? 0;
const ERROR_COUNT = (IDL as { errors?: unknown[] }).errors?.length ?? 0;


/** The three layers a confession actually crosses, with the real instructions. */
const LAYERS = [
  {
    tag: "Solana",
    title: "The shell is allocated empty.",
    body:
      "create_market writes the public half: an id, a room, a timer and two empty pots. create_secret_shell allocates the account that will hold the confession and writes nothing into it. No byte of the body has been in a base-layer transaction, because there is nothing in it yet.",
    ixs: ["create_market", "create_secret_shell", "delegate_market", "delegate_secret"],
    where: "base",
  },
  {
    tag: "Ephemeral Rollup",
    title: "The body is written inside the rollup.",
    body:
      "Only after delegation does seal_secret put the sentence into the account, on the rollup, under a permission whose member list is exactly one key. Solana learns sha256(body, salt) and never the body. The market runs here too, so a bid costs no wallet popup and no base-layer transaction.",
    ixs: ["seal_secret", "init_secret_permission", "place_bid", "fund_bid"],
    where: "er",
  },
  {
    tag: "Private Ephemeral Rollup",
    title: "It is never undelegated.",
    body:
      "When the timer dies, VRF picks the outcome and settle_bid moves the money. finalize_market commits the market back to Solana, but the secret stays delegated to the TEE forever. Solana receives a tombstone: a hash, an outcome, and text only when the verdict authorised it.",
    ixs: ["request_resolution_vrf", "callback_resolve", "settle_bid", "write_tombstone"],
    where: "tee",
  },
];

/** The real rule table, straight out of `expire_market` and `Outcome`. */
const VERDICTS = [
  {
    when: "seal pot > 0",
    then: "Buried",
    outcome: "buried",
    body: "Silence was bought. The seal bidders lose their stake to the author, every read bidder is refunded in full, and the body stays in the rollup for good.",
  },
  {
    when: "seal = 0, read > 0",
    then: "Sole reader",
    outcome: "soleReader",
    body: "VRF picks exactly one READ bidder. grant_reader adds that one key to the secret's private permission. Everyone else, the author included, learns nothing.",
  },
  {
    when: "both pots empty",
    then: "Public leak",
    outcome: "publicLeak",
    body: "Nobody paid to bury it and nobody paid to read it, so the full body is carved into the L1 tombstone. No randomness is needed for this one.",
  },
];

export default function Landing() {
  const { data: markets, error: marketsError } = useMarkets();
  const { data: tombs } = useTombstones();
  const pulse = usePulse();
  const reduce = useReducedMotion();

  const [layer, setLayer] = useState(0);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<null | {
    filtered: string;
    unfiltered: string;
    secret: string;
    refused: boolean;
  }>(null);

  const openCount = markets.filter((m) => m.status === "open").length;
  const live = useMemo(() => markets.slice(0, 3), [markets]);

  const leaked = useMemo(
    () => tombs.find((t) => t.outcome === "publicLeak" && t.revealed),
    [tombs]
  );
  const withheld = useMemo(() => tombs.find((t) => !t.revealed), [tombs]);

  /**
   * The privacy probe, run for real against this cluster.
   *
   * A fresh keypair signs the validator's challenge and holds a genuine JWT, and
   * is still refused, because the member list is what gates the read. The
   * control asks the unfiltered validator for the same account, so a refusal is
   * visibly a decision rather than an empty account.
   */
  const runProbe = useCallback(async () => {
    const target = markets.find(
      (m) => m.roomVariant !== "whisperIpo" && m.status !== "settled" && !m.tombstoned
    );
    if (!target) return;
    setProbing(true);
    setProbe(null);
    try {
      const secret = secretPda(new (await import("@solana/web3.js")).PublicKey(target.address));
      const stranger = Keypair.generate();
      const { token } = await getAuthToken(TEE_RPC, stranger.publicKey, async (msg) =>
        nacl.sign.detached(msg, stranger.secretKey)
      );
      const ask = async (url: string) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [secret.toBase58(), { encoding: "base64" }],
          }),
        });
        return res.text();
      };
      const filtered = await ask(`${TEE_RPC}?token=${token}`);
      const unfiltered = await ask(ER_RPC);
      const refused = !JSON.parse(filtered)?.result?.value?.data;
      setProbe({
        filtered: JSON.stringify(JSON.parse(filtered), null, 1),
        unfiltered: JSON.stringify(JSON.parse(unfiltered), null, 1).slice(0, 320),
        secret: secret.toBase58(),
        refused,
      });
    } catch (err) {
      setProbe({
        filtered: err instanceof Error ? err.message : String(err),
        unfiltered: "",
        secret: "",
        refused: false,
      });
    } finally {
      setProbing(false);
    }
  }, [markets]);

  const press = reduce ? {} : { whileHover: { y: -2 }, whileTap: { y: 1, scale: 0.99 } };

  return (
    <div className="landing">
      {/* ---------------------------------------------------------------- hero */}
      <HeroIntro>
        <section className="lp-hero">
          <p className="eyebrow" data-hero="eyebrow">
            {marketsError ? (
              <>
                <b>{CLUSTER} is not answering</b>
                the page below is live, the cluster is not
              </>
            ) : (
              <>
                <b>
                  {openCount} market{openCount === 1 ? "" : "s"} open
                </b>
                right now on {CLUSTER}
              </>
            )}
          </p>

          {/*
            Each word rides in from behind its own mask, which means the visual
            gaps between them are a CSS column-gap and not space characters.
            `textContent` therefore reads "Somebodyhassomething", and that is
            what a screen reader announces and what a copy-paste produces. The
            standard fix for split-text: the real sentence lives on aria-label
            and the decorative pieces are hidden from the accessibility tree.
          */}
          <h1 className="lp-h1" aria-label="Somebody has something to lose tonight.">
            {["Somebody", "has", "something"].map((w) => (
              <span className="word-mask" key={w} aria-hidden="true">
                <span data-hero="word">{w}</span>
              </span>
            ))}
            <span className="word-mask" aria-hidden="true">
              <span data-hero="word" className="flare">
                to lose
              </span>
            </span>
            <span className="word-mask" aria-hidden="true">
              <span data-hero="word">tonight.</span>
            </span>
          </h1>

          <p className="hero-sub" data-hero="sub">
            A market where the traded asset is a secret. One sentence, a countdown, and two ways
            to bet: pay to bury it, or pay for the chance to be the only person who ever reads it.
          </p>

          <div className="actions lp-cta">
            <motion.div data-hero="cta" {...press}>
              <Link href="/confess" className="keycap">
                Write a confession
              </Link>
            </motion.div>
            <motion.div data-hero="cta" {...press}>
              <Link href="/village" className="ghost">
                Watch the village
                <span aria-hidden="true">-&gt;</span>
              </Link>
            </motion.div>
          </div>

          <Drift distance={-46}>
            <div className="lp-pulse" data-hero="clock">
              <div>
                <span className="lbl">rollup</span>
                <span className="val">{pulse.er.ms === null ? "..." : `${pulse.er.ms} ms`}</span>
              </div>
              <div>
                <span className="lbl">base</span>
                <span className="val">
                  {pulse.base.ms === null ? "..." : `${pulse.base.ms} ms`}
                </span>
              </div>
              <div>
                <span className="lbl">slot</span>
                <span className="val">{pulse.slot?.toLocaleString() ?? "..."}</span>
              </div>
              <div>
                <span className="lbl">socket</span>
                <span className="val">{pulse.live ? "live" : "polling"}</span>
              </div>
            </div>
          </Drift>

          {/* The latencies above are numbers; these are signatures. A viewer
              who does not believe the milliseconds can open one and check. */}
          <Drift distance={-30}>
            <ActivityStrip live={pulse.live} />
          </Drift>
        </section>
      </HeroIntro>

      {/* ------------------------------------------------- pinned layer journey */}
      <PinnedSequence steps={LAYERS.length} onStep={setLayer} className="lp-pin">
        <section className="lp-layers">
          <div className="lp-layers-rail">
            {LAYERS.map((l, i) => (
              <button
                type="button"
                key={l.tag}
                className={i === layer ? "lp-rail-step on" : "lp-rail-step"}
                onClick={() => setLayer(i)}
              >
                <span className={`layer layer-${l.where}`}>{l.tag}</span>
              </button>
            ))}
          </div>

          <div className="lp-layers-stage">
            <AnimatePresence mode="wait">
              <motion.div
                key={layer}
                initial={reduce ? false : { y: 22 }}
                animate={{ y: 0 }}
                exit={reduce ? undefined : { y: -18 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              >
                <h2 className="lp-layer-title">{LAYERS[layer].title}</h2>
                <p className="lp-layer-body">{LAYERS[layer].body}</p>
                <div className="lp-ix">
                  {LAYERS[layer].ixs.map((ix) => (
                    <code key={ix}>{ix}</code>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* The confession itself, moving down the layers as you scroll. */}
            <div className="lp-track" aria-hidden="true">
              {LAYERS.map((l, i) => (
                <div className="lp-track-slot" key={l.tag}>
                  {i === layer ? (
                    <motion.div layoutId="secret" className="lp-token" transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                      {i === 0 ? "empty shell" : i === 1 ? "sealed body" : "never undelegated"}
                    </motion.div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </PinnedSequence>

      {/* ------------------------------------------------------- the live book */}
      <section className="lp-section">
        <StaggerIn>
          <p className="kicker">not a screenshot</p>
          <h2 className="lp-h2">
            These are live accounts, read off the rollup <span className="flare">right now</span>.
          </h2>
          <p className="lp-lead">
            Every card below is fetched from the cluster this page is pointed at. Open a second
            tab, place a bid, and these move without a refresh: the village holds a websocket
            subscription to every account the program owns.
          </p>
        </StaggerIn>

        {live.length > 0 ? (
          <motion.div layout className="grid lp-grid">
            <AnimatePresence>
              {live.map((m) => (
                <motion.div
                  key={m.address}
                  layout
                  // Scale only, never opacity. A card that fades in is a card
                  // that is invisible until something finishes, and if that
                  // something is prevented the reader gets an empty strip where
                  // the live market feed should be. Measured: with transitions
                  // disabled these wrappers sat at opacity 0 forever.
                  initial={reduce ? false : { scale: 0.97 }}
                  animate={{ scale: 1 }}
                  exit={reduce ? undefined : { scale: 0.97 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  <MarketCard market={m} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="empty">
            {marketsError
              ? `Neither layer answered, so there is nothing to show. This is a broken connection to ${CLUSTER}, not an empty village.`
              : `No markets are standing on ${CLUSTER} at the moment. Open one and it appears here, in this list, without a reload.`}
          </div>
        )}
      </section>

      {/* --------------------------------------------------- the verdict table */}
      <section className="lp-section">
        <StaggerIn>
          <p className="kicker">what happens at zero</p>
          <h2 className="lp-h2">Three ways it can end, decided by a chain.</h2>
        </StaggerIn>

        <StaggerIn className="lp-verdicts" stagger={0.1} y={34}>
          {VERDICTS.map((v) => (
            <motion.article
              key={v.then}
              className="lp-verdict"
              whileHover={reduce ? undefined : { y: -4 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <code className="lp-when">{v.when}</code>
              <OutcomeBadge outcome={v.outcome} />
              <p>{v.body}</p>
            </motion.article>
          ))}
        </StaggerIn>
      </section>

      {/* ------------------------------------------------ the graveyard, proven */}
      <section className="lp-section">
        <StaggerIn>
          <p className="kicker">the graveyard</p>
          <h2 className="lp-h2">
            One of these was <span className="flare">allowed</span> onto Solana. The other never
            will be.
          </h2>
          <p className="lp-lead">
            Both are base-layer accounts you can open in an explorer. The difference is not
            storage, it is the verdict: <code>Outcome::reveals_text()</code> decides whether
            finalize_market is permitted to copy the body out of the rollup at all.
          </p>
        </StaggerIn>

        {leaked || withheld ? (
          <div className="lp-proof">
            {leaked ? (
              <motion.div
                className="tomb"
                whileHover={reduce ? undefined : { y: -3 }}
                transition={{ duration: 0.25 }}
              >
                <div className="card-top">
                  <span className="room-tag">Released</span>
                  <OutcomeBadge outcome={leaked.outcome} />
                </div>
                <div className="hash-line">
                  <span className="hash-prefix">sha256</span>
                  <code className="hash">{shortHash(leaked.commitment)}</code>
                </div>
                <div className="confession">{leaked.revealed}</div>
              </motion.div>
            ) : null}

            {withheld ? (
              <motion.div
                className="tomb"
                whileHover={reduce ? undefined : { y: -3 }}
                transition={{ duration: 0.25 }}
              >
                <div className="card-top">
                  <span className="room-tag">Withheld</span>
                  <OutcomeBadge outcome={withheld.outcome} />
                </div>
                <div className="hash-line">
                  <span className="hash-prefix">sha256</span>
                  <code className="hash">{shortHash(withheld.commitment)}</code>
                </div>
                <Redaction />
              </motion.div>
            ) : null}
          </div>
        ) : (
          <div className="empty">
            No market has reached a verdict on {CLUSTER} yet. Take one to zero and both cases
            appear here, side by side.
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- the challenge */}
      <section className="lp-section">
        <StaggerIn>
          <p className="kicker">do not take it on trust</p>
          <h2 className="lp-h2">Try to read one you are not allowed to read.</h2>
          <p className="lp-lead">
            This generates a fresh keypair in your browser, signs the validator&rsquo;s challenge
            with it, and asks for a live sealed secret holding a genuine token. Then it asks the
            unfiltered validator for the same account, so you can see the refusal was a decision.
          </p>
        </StaggerIn>

        <div className="actions">
          <motion.button
            type="button"
            className="keycap"
            onClick={() => void runProbe()}
            disabled={probing || markets.length === 0}
            whileHover={reduce ? undefined : { y: -2 }}
            whileTap={reduce ? undefined : { y: 2, scale: 0.99 }}
          >
            {probing ? "asking the validator..." : "Run it against a live secret"}
          </motion.button>
          <Link href="/challenge" className="ghost">
            All five probes
            <span aria-hidden="true">-&gt;</span>
          </Link>
        </div>

        <AnimatePresence>
          {probe ? (
            <motion.div
              className="lp-probe"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="probe">
                <div className="probe-head">
                  <span className="probe-title">
                    A valid token, for a key that is not on the member list
                  </span>
                  <span className={probe.refused ? "pill probe-refused" : "pill probe-answered"}>
                    {probe.refused ? "refused" : "answered"}
                  </span>
                </div>
                <p className="probe-detail">
                  secret <code>{probe.secret ? shortKey(probe.secret) : "n/a"}</code>
                </p>
                <pre className="mono-block probe-body">{probe.filtered}</pre>
              </div>

              {probe.unfiltered ? (
                <div className="probe">
                  <div className="probe-head">
                    <span className="probe-title">
                      Control: the unfiltered validator, same account, same moment
                    </span>
                    <span className="pill probe-answered">answered</span>
                  </div>
                  <p className="probe-detail">
                    It holds the bytes, so the refusal above was access control and not an empty
                    account.
                  </p>
                  <pre className="mono-block probe-body">{probe.unfiltered}</pre>
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      {/* ------------------------------------------------------------- the numbers */}
      <section className="lp-section">
        <StaggerIn>
          <p className="kicker">what is actually built</p>
          <h2 className="lp-h2">No roadmap on this page.</h2>
        </StaggerIn>

        <div className="lp-figures">
          <div>
            <span className="lp-fig">
              <CountUp to={INSTRUCTION_COUNT} />
            </span>
            <span className="lbl">instructions in the deployed program</span>
          </div>
          <div>
            <span className="lp-fig">
              <CountUp to={TEST_COUNT} />
            </span>
            <span className="lbl">tests passing against a live cluster</span>
          </div>
          <div>
            <span className="lp-fig">
              <CountUp to={LIVE_ROOMS.length} />
            </span>
            <span className="lbl">
              rooms live, of {ROOMS.length} enumerated in the Room enum
            </span>
          </div>
          <div>
            <span className="lp-fig">
              <CountUp to={ERROR_COUNT} />
            </span>
            <span className="lbl">named error codes, every refusal explicit</span>
          </div>
        </div>

        <p className="lp-lead" style={{ marginTop: 26 }}>
          Program <code>{PROGRAM_ID.toBase58()}</code>
        </p>
      </section>

      {/* -------------------------------------------------------------- the close */}
      <StaggerIn className="lp-close">
        <h2 className="lp-h2">
          Write one sentence. <span className="flare">Lose it</span> on purpose.
        </h2>
        <div className="actions" style={{ justifyContent: "center" }}>
          <motion.div {...press}>
            <Link href="/confess" className="keycap">
              Write a confession
            </Link>
          </motion.div>
          <motion.div {...press}>
            <Link href="/rooms" className="ghost">
              Twenty-five ways to lose a secret
              <span aria-hidden="true">-&gt;</span>
            </Link>
          </motion.div>
        </div>
      </StaggerIn>
    </div>
  );
}
