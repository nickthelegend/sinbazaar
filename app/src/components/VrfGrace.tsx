"use client";

/**
 * A market waiting on randomness that has not arrived.
 *
 * `VrfPending` is the one state in this program where nothing can proceed and
 * nobody is at fault. `settle_bid` requires `Resolved`, so until the oracle
 * answers the escrow is locked, and the interface used to render this as a
 * status pill and nothing else, indistinguishable to a judge from a hung app.
 *
 * The program has always had the release valve. After `VRF_GRACE_SECS` past
 * expiry anyone may call `retry_vrf` and push the market back to `Expired` so
 * randomness can be requested again. This shows the window closing and then
 * offers the button, which turns a dead-looking screen into a rule the villager
 * can watch working.
 *
 * The countdown refuses to guess. `useNow` starts at 0 so that the server and
 * the first client render agree, and 0 means "not measured yet" rather than
 * "the deadline has passed". Otherwise the retry would appear enabled for one
 * frame on every single load, which is exactly the sort of momentary lie that
 * teaches people not to trust an interface.
 */
import { useCallback, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useNow } from "@/hooks/useNow";
import { useVillageWallet } from "@/components/Providers";
import { retryVrf } from "@/lib/flows";
import { VRF_GRACE_SECS } from "@/lib/config";
import { fmtCountdown } from "@/lib/format";

export function VrfGrace({
  market,
  marketId,
  expiresAt,
  onRetried,
}: {
  market: string;
  marketId: string;
  expiresAt: number;
  onRetried?: () => void;
}) {
  const now = useNow();
  const wallet = useVillageWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const deadline = expiresAt + VRF_GRACE_SECS;
  const measured = now > 0;
  const left = deadline - now;
  const elapsed = measured && left <= 0;

  const retry = useCallback(async () => {
    if (!wallet.signer) return;
    setBusy(true);
    setNote(null);
    try {
      const sig = await retryVrf(wallet.signer, new PublicKey(market), new BN(marketId));
      setNote(`reopened, ${sig.slice(0, 10)}..., randomness can be requested again`);
      onRetried?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [wallet.signer, market, marketId, onRetried]);

  return (
    <div className={`vrf${elapsed ? " elapsed" : ""}`}>
      <div className="vrf-head">
        <span className="vrf-title">waiting on MagicBlock VRF</span>
        {measured ? (
          <span className="vrf-clock">
            {elapsed ? "grace elapsed" : fmtCountdown(left)}
          </span>
        ) : (
          <span className="vrf-clock">…</span>
        )}
      </div>
      <p className="vrf-copy">
        {elapsed ? (
          <>
            The oracle has had {VRF_GRACE_SECS} seconds past expiry and has not
            answered. Anyone may now reopen this market so randomness can be asked
            for again. The escrow has been safe the whole time; it simply could not
            move.
          </>
        ) : (
          <>
            Randomness was requested and has not landed yet. The program gives the
            oracle {VRF_GRACE_SECS} seconds past expiry before anybody is allowed to
            reopen the market, so a slow answer is not mistaken for a dead one.
          </>
        )}
      </p>
      {elapsed ? (
        <div className="vrf-act">
          <button
            type="button"
            className="keycap"
            onClick={() => void retry()}
            disabled={!wallet.signer || busy}
          >
            {busy ? "reopening…" : "reopen this market"}
          </button>
          {!wallet.signer ? (
            <span className="muted small">connect a key to crank it</span>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="vrf-note">{note}</p> : null}
    </div>
  );
}
