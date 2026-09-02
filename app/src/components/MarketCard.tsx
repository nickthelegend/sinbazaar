"use client";

import Link from "next/link";
import { BookBar, Countdown, OutcomeBadge, PotBar, StatusPill } from "./Bits";
import { shortHash, shortKey } from "@/lib/format";
import type { MarketView } from "@/lib/markets";
import { roomOf } from "@/lib/rooms";

export function MarketCard({ market }: { market: MarketView }) {
  const room = roomOf({ [market.roomVariant]: {} });
  const isIpo = room.variant === "whisperIpo";

  return (
    <Link href={`/market/${market.address}`} className="market-card">
      <div className="card-top">
        <span className="room-tag">{room.label}</span>
        <span className={`layer layer-${market.layer}`}>
          {market.layer === "er" ? "rollup" : "solana"}
        </span>
      </div>

      <div className="hash-line">
        <span className="hash-prefix">sha256</span>
        <code className="hash">{shortHash(market.commitment)}</code>
      </div>

      <div className="card-mid">
        <Countdown expiresAt={market.expiresAt} />
        <StatusPill status={market.status} />
        <OutcomeBadge outcome={market.outcome} />
      </div>

      {isIpo ? (
        <BookBar yes={market.yesPot} no={market.noPot} />
      ) : (
        <PotBar seal={market.sealPot} read={market.readPot} />
      )}

      <div className="card-foot">
        <span>
          {market.bidCount} {market.bidCount === 1 ? "bid" : "bids"}
        </span>
        <span className="muted">author {shortKey(market.author)}</span>
      </div>
    </Link>
  );
}
