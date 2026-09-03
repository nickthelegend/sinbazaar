"use client";

/**
 * Who may read this account, and what they may see.
 *
 * The privacy claim in this project is not enforced by a rule in a document. It
 * is enforced by a member list on an ephemeral permission account, and until now
 * that list was something the app asserted rather than showed. This renders it:
 * the private flag, every member, and the flags byte each member was granted,
 * decoded into the four privileges it actually encodes.
 *
 * It re-reads on the rollup subscription, so a membership change (the VRF
 * picking a reader, and `grant_reader` admitting them) is visible as it lands
 * rather than on the next refresh.
 *
 * The empty and missing cases are kept apart, because they mean opposite things.
 * A permission that does not exist is an account nobody has restricted. A
 * permission that exists with `is_private` set and one member is the tightest
 * thing this program can build. Rendering both as "no members" would collapse
 * the whole distinction.
 */
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { erConnection } from "@/lib/anchor";
import { PROGRAM_ID } from "@/lib/config";
import { readPermission, type PermissionView } from "@/lib/magicblock";
import { subscribeAccount } from "@/lib/live";
import { permissionPdaFromAccount } from "@/lib/magicblock";
import { shortKey } from "@/lib/format";

type Load = "loading" | "ready" | "failed";

function Privileges({ m }: { m: PermissionView["members"][number] }) {
  const granted = [
    m.authority && "authority",
    m.txLogs && "logs",
    m.txBalances && "balances",
    m.txMessage && "message",
  ].filter(Boolean) as string[];
  return (
    <span className="perm-flags">
      {granted.length ? (
        granted.map((g) => (
          <em key={g} className="perm-flag">
            {g}
          </em>
        ))
      ) : (
        <em className="perm-flag none">read only</em>
      )}
      <code className="perm-raw">0x{m.flags.toString(16).padStart(2, "0")}</code>
    </span>
  );
}

export function PermissionInspector({
  account,
  label,
  you,
  explainPublic,
}: {
  account: string;
  label: string;
  you?: string | null;
  /**
   * Why this permission is open, when it is.
   *
   * Not every room hides anything. A Whisper IPO trades a rumour everybody can
   * already see, so its permission is public by design, and an inspector that
   * showed a bare "public" badge there would read as the privacy claim failing
   * rather than as a room behaving correctly.
   */
  explainPublic?: string;
}) {
  const [perm, setPerm] = useState<PermissionView | null>(null);
  const [state, setState] = useState<Load>("loading");

  const read = useCallback(async () => {
    try {
      const p = await readPermission(erConnection(), new PublicKey(account), PROGRAM_ID);
      setPerm(p);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [account]);

  useEffect(() => {
    void read();
    // Watch the permission account itself, not the account it guards: membership
    // changes write to the permission, and the guarded account may never move.
    const stop = subscribeAccount(permissionPdaFromAccount(new PublicKey(account)), () => {
      void read();
    });
    return stop;
  }, [account, read]);

  return (
    <div className="perm">
      <div className="perm-head">
        <span className="perm-label">{label}</span>
        {perm?.exists ? (
          <span className={`pill ${perm.isPrivate ? "perm-private" : "perm-public"}`}>
            {perm.isPrivate ? "private" : "public"}
          </span>
        ) : null}
      </div>

      {perm?.exists && !perm.isPrivate && explainPublic ? (
        <p className="perm-note">{explainPublic}</p>
      ) : null}

      {state === "loading" ? (
        <p className="perm-note">reading the permission off the rollup…</p>
      ) : state === "failed" ? (
        <p className="perm-note">the rollup did not answer for this permission</p>
      ) : !perm?.exists ? (
        <p className="perm-note">
          No ephemeral permission exists for this account, so nothing is gating it.
          That is not the same as an empty member list.
        </p>
      ) : perm.members.length === 0 ? (
        <p className="perm-note">
          The permission exists and is {perm.isPrivate ? "private" : "public"}, and it
          admits nobody but the owning program.
        </p>
      ) : (
        <ul className="perm-members">
          {perm.members.map((m) => (
            <li key={m.pubkey} className={you && m.pubkey === you ? "is-you" : undefined}>
              <code>{shortKey(m.pubkey, 6)}</code>
              {you && m.pubkey === you ? <span className="perm-you">you</span> : null}
              <Privileges m={m} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
