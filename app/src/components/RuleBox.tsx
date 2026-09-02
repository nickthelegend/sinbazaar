"use client";

/**
 * What happens at zero.
 *
 * The branches are the ones the program actually takes — `expire_market` for the
 * unpaid case, `callback_resolve` for everything else. The live branch is the
 * one the current pots would select if the timer died this second.
 */
import { useNow } from "@/hooks/useNow";
import { fmtSol } from "@/lib/format";
import { ransomDue, type MarketView } from "@/lib/markets";

interface Branch {
  when: string;
  then: string;
  detail: string;
  active: boolean;
}

function branchesFor(market: MarketView, now: number): Branch[] {
  switch (market.roomVariant) {
    case "guiltMarket":
      return [
        {
          when: "seal pot > 0",
          then: "BURIED",
          detail:
            "silence was bought. The seal bidders lose their stake to the author; every read bidder is refunded. The body stays in the rollup for good.",
          active: market.sealPot > 0,
        },
        {
          when: "seal pot = 0, read pot > 0",
          then: "SOLE READER",
          detail:
            "MagicBlock VRF picks exactly one READ bidder. They alone are added to the secret's private permission. Solana still gets only the hash.",
          active: market.sealPot === 0 && market.readPot > 0,
        },
        {
          when: "both pots empty",
          then: "PUBLIC LEAK",
          detail:
            "nobody paid to bury it and nobody paid to read it, so the full body is carved into the L1 tombstone. No randomness is needed for this one.",
          active: market.sealPot === 0 && market.readPot === 0,
        },
      ];
    case "blackmailEscrow": {
      const due = ransomDue(market, now || market.createdAt);
      return [
        {
          when: `seal pot ≥ ransom (${fmtSol(due)} SOL and climbing)`,
          then: "BURIED",
          detail: "the village met the price. The confession never leaves the rollup.",
          active: market.sealPot >= due && due > 0,
        },
        {
          when: "ransom unmet, the coin lands heads",
          then: "RANDOM REVEAL",
          detail:
            "one redacted sentence — the single line the author wrote for exactly this — reaches the tombstone. Nothing else does.",
          active: market.sealPot < due,
        },
        {
          when: "ransom unmet, the coin lands tails",
          then: "INHERITED",
          detail:
            "the randomness hands the whole body to one bidder, chosen by index. Everyone else learns nothing.",
          active: market.sealPot < due && market.bidCount > 0,
        },
        {
          when: "ransom unmet and nobody bid at all",
          then: "PUBLIC LEAK",
          detail: "the body is carved into the tombstone.",
          active: market.sealPot < due && market.bidCount === 0,
        },
      ];
    }
    case "whisperIpo":
      return [
        {
          when: "the author attests YES",
          then: "FORGIVEN",
          detail:
            "the YES book takes its stake back plus a pro-rata slice of the NO book. Positions stay private throughout.",
          active: market.yesPot >= market.noPot,
        },
        {
          when: "the author attests NO",
          then: "SLASHED",
          detail: "the NO book eats the YES book on the same pro-rata terms.",
          active: market.noPot > market.yesPot,
        },
      ];
    default:
      return [];
  }
}

export function RuleBox({ market }: { market: MarketView }) {
  const now = useNow(5000);
  const branches = branchesFor(market, now);
  if (branches.length === 0) return null;

  return (
    <section className="rulebox">
      <h3>What happens at zero</h3>
      <ul>
        {branches.map((b) => (
          <li key={b.then + b.when} className={b.active ? "branch live" : "branch"}>
            <div className="branch-head">
              <span className="branch-when">{b.when}</span>
              <span className="branch-arrow" aria-hidden="true">
                →
              </span>
              <span className="branch-then">{b.then}</span>
            </div>
            <p className="branch-detail">{b.detail}</p>
          </li>
        ))}
      </ul>
      <p className="rulebox-foot">
        The confession itself never moves. Only the verdict decides whether a copy of it is
        allowed onto the base layer.
      </p>
    </section>
  );
}
