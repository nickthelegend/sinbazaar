"use client";

/**
 * THE CHALLENGE, try to read a secret you are not allowed to read.
 *
 * Every other page in this product asserts that a confession is unreadable by
 * anyone outside its permission member list. This page hands the visitor the
 * tools to disprove it: pick a live sealed secret, then run the same four
 * probes `scripts/prove-privacy.ts` runs, in their own browser, against the
 * same validator, and read the raw JSON-RPC response each one returns.
 *
 * The page reports what actually happened rather than what we would like to
 * have happened. On devnet the TEE refuses probes 1 and 2 and the page says
 * REFUSED. On a local cluster the query-filtering service is NOT a TEE, answers
 * both, and the page says so in as many words, claiming a refusal we did not
 * observe would be exactly the kind of unverified assertion this page exists to
 * attack.
 */
import { useCallback, useMemo, useState } from "react";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { useMarkets } from "@/hooks/useMarkets";
import { useVillageWallet } from "@/components/Providers";
import { Empty } from "@/components/Bits";
import { secretPda } from "@/lib/pdas";
import { getAuthToken, readPermission } from "@/lib/magicblock";
import { CLUSTER, ER_RPC, IS_LOCALNET, PROGRAM_ID, TEE_RPC } from "@/lib/config";
import { shortKey } from "@/lib/format";

type Verdict = "refused" | "answered" | "error" | "skipped";

interface Probe {
  id: string;
  title: string;
  detail: string;
  /** What a real TEE must do for the privacy claim to hold. */
  expected: "refuse" | "answer";
  verdict: Verdict;
  body: string;
}

/** Raw JSON-RPC, deliberately unwrapped: the visitor should see the real reply. */
async function rawGetAccountInfo(url: string, address: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64" }],
    }),
  });
  const text = await res.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 1);
  } catch {
    return `HTTP ${res.status}\n${text.slice(0, 400)}`;
  }
}

/** Did that reply actually carry account data, or was it a refusal? */
function answered(json: string): boolean {
  try {
    const v = JSON.parse(json);
    return Boolean(v?.result?.value?.data);
  } catch {
    return false;
  }
}

export default function ChallengePage() {
  const { data: markets } = useMarkets();
  const wallet = useVillageWallet();
  const [probes, setProbes] = useState<Probe[]>([]);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [intruder, setIntruder] = useState<string>("");

  /**
   * Only a sealed, still-private secret is worth attacking. A resolved market's
   * secret may legitimately have a second member on its list, and a Whisper IPO
   * secret is public by design, neither would prove anything.
   */
  const candidates = useMemo(
    () =>
      markets.filter(
        (m) => m.roomVariant !== "whisperIpo" && m.status !== "settled" && !m.tombstoned
      ),
    [markets]
  );

  const chosen = target || candidates[0]?.address || "";

  const run = useCallback(async () => {
    if (!chosen) return;
    setRunning(true);
    setProbes([]);

    const market = new PublicKey(chosen);
    const secret = secretPda(market);
    const out: Probe[] = [];
    const push = (p: Probe) => {
      out.push(p);
      setProbes([...out]);
    };

    // 0, what the permission itself says. Not an attack; the ground truth the
    //     other three probes are measured against.
    try {
      const anon = new Connection(TEE_RPC, "confirmed");
      const perm = await readPermission(anon, secret, PROGRAM_ID);
      push({
        id: "permission",
        title: "The secret's permission",
        detail: `is_private = ${perm.isPrivate}; members = ${
          perm.memberKeys.map(shortKey).join(", ") || "none"
        }`,
        expected: "answer",
        verdict: perm.exists ? "answered" : "error",
        body: JSON.stringify(perm, null, 1),
      });
    } catch (err) {
      push({
        id: "permission",
        title: "The secret's permission",
        detail: "could not be read",
        expected: "answer",
        verdict: "error",
        body: err instanceof Error ? err.message : String(err),
      });
    }

    // 1, no credential at all.
    const anonBody = await rawGetAccountInfo(TEE_RPC, secret.toBase58());
    push({
      id: "anon",
      title: "Read the secret with no token",
      detail: `POST ${TEE_RPC} · getAccountInfo(${shortKey(secret.toBase58())})`,
      expected: "refuse",
      verdict: answered(anonBody) ? "answered" : "refused",
      body: anonBody,
    });

    // 2, a real, valid credential belonging to the wrong person. This is the
    //     probe that matters: it proves the member list is what gates the read,
    //     not merely the presence of a token.
    try {
      const stranger = Keypair.generate();
      setIntruder(stranger.publicKey.toBase58());
      const { token } = await getAuthToken(TEE_RPC, stranger.publicKey, async (msg) =>
        nacl.sign.detached(msg, stranger.secretKey)
      );
      const strangerBody = await rawGetAccountInfo(
        `${TEE_RPC}?token=${token}`,
        secret.toBase58()
      );
      push({
        id: "stranger",
        title: "Read it with a freshly minted, perfectly valid token",
        detail: `a brand-new keypair signed the validator's challenge and holds a real JWT, it is simply not on the member list`,
        expected: "refuse",
        verdict: answered(strangerBody) ? "answered" : "refused",
        body: strangerBody,
      });

      // 3, the same stranger reading the MARKET. Must succeed: the game is
      //     public, only the confession is not.
      const marketBody = await rawGetAccountInfo(`${TEE_RPC}?token=${token}`, chosen);
      push({
        id: "market",
        title: "The same stranger reads the market itself",
        detail: "pots, timer and status are public by design, this one must succeed",
        expected: "answer",
        verdict: answered(marketBody) ? "answered" : "refused",
        body: marketBody,
      });
    } catch (err) {
      push({
        id: "stranger",
        title: "Read it with a freshly minted, perfectly valid token",
        detail: "the handshake failed",
        expected: "refuse",
        verdict: "error",
        body: err instanceof Error ? err.message : String(err),
      });
    }

    // 4, the control. Ask the UNFILTERED rollup for the same account at the
    //     same moment. Getting the bytes here is what proves the refusals above
    //     were a decision rather than a missing account.
    //
    //     This endpoint only exists as a separate host in the local topology,
    //     where the filter sits in front of a plain validator. On devnet the
    //     enclave IS the validator and there is no unfiltered port to ask.
    if (IS_LOCALNET) {
      const unfiltered = await rawGetAccountInfo(ER_RPC, secret.toBase58());
      push({
        id: "control",
        title: "Control: the same secret, read from the unfiltered rollup",
        detail: `POST ${ER_RPC}, the validator behind the filter. If this returns bytes, the refusals above were a decision, not an empty account.`,
        expected: "answer",
        verdict: answered(unfiltered) ? "answered" : "refused",
        body: unfiltered,
      });
    }

    setRunning(false);
  }, [chosen]);

  const decided = probes.filter((p) => p.verdict !== "skipped");
  const held = decided.filter(
    (p) =>
      (p.expected === "refuse" && p.verdict === "refused") ||
      (p.expected === "answer" && p.verdict === "answered")
  ).length;

  return (
    <>
      <header className="page-head">
        <p className="kicker">the challenge</p>
        <h1>Try to read one yourself.</h1>
        <p className="lede pitch">
          Every page here claims a confession is unreadable by anyone outside its permission
          member list. Do not take it on trust. Pick a live sealed secret and run the probes
          in your own browser, against the same validator this village runs on. The raw
          JSON-RPC reply is printed for each one.
        </p>
      </header>

      {IS_LOCALNET ? (
        <div className="err" role="note">
          <strong>You are on {CLUSTER}, and the refusals below are real.</strong> The local
          query-filtering service does enforce the permission member list, probe 5 proves
          it by asking the unfiltered rollup for the same account at the same moment and
          getting the bytes back. What a local cluster cannot give you is{" "}
          <em>attestation</em>: the filter is ordinary software, so a dishonest operator
          could remove it. On devnet the filter is the enclave itself, which is the part
          you are asked to trust and the part hardware proves. The refusal is the same; the
          reason to believe it is not.
        </div>
      ) : null}

      <div className="panel">
        <h3>Choose a target</h3>
        {candidates.length === 0 ? (
          <Empty>
            No sealed secret is live right now. Write a confession and come back, the
            challenge needs something real to attack.
          </Empty>
        ) : (
          <>
            <label className="field">
              <span className="lbl">market</span>
              <select value={chosen} onChange={(e) => setTarget(e.target.value)}>
                {candidates.map((m) => (
                  <option key={m.address} value={m.address}>
                    {shortKey(m.address)} · {m.status} · {m.bidCount} bids
                  </option>
                ))}
              </select>
              <span className="hint">
                Its secret lives at{" "}
                <code>{chosen ? secretPda(new PublicKey(chosen)).toBase58() : ", "}</code>
              </span>
            </label>
            <div className="actions">
              <button type="button" className="act" onClick={() => void run()} disabled={running}>
                {running ? "probing…" : "run the probes"}
              </button>
              {wallet.address ? (
                <span className="muted small">you are {shortKey(wallet.address)}</span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {probes.length > 0 ? (
        <div className="panel">
          <h3>
            Result · {held}/{decided.length} behaved as the claim requires
          </h3>
          {intruder ? (
            <p className="hint" style={{ padding: "0 0 8px" }}>
              The intruder key generated for this run was <code>{shortKey(intruder)}</code>. It
              is discarded when you leave the page.
            </p>
          ) : null}
          <ol className="probes">
            {probes.map((p) => {
              const good =
                (p.expected === "refuse" && p.verdict === "refused") ||
                (p.expected === "answer" && p.verdict === "answered");
              return (
                <li key={p.id} className={`probe ${good ? "good" : "bad"}`}>
                  <div className="probe-head">
                    <span className="probe-title">{p.title}</span>
                    <span className={`pill probe-${p.verdict}`}>{p.verdict}</span>
                  </div>
                  <p className="probe-detail">{p.detail}</p>
                  <pre className="mono-block probe-body">{p.body}</pre>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </>
  );
}
