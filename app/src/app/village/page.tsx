"use client";

/** The village feed. Live markets, polled off the rollup. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { CardSkeleton, Empty } from "@/components/Bits";
import { MarketCard } from "@/components/MarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { LIVE_ROOMS } from "@/lib/rooms";


type Filter = "all" | "open" | "settled" | string;

export default function VillageFeed() {
  const { data: markets, loading, error, reload } = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    if (filter === "all") return markets;
    if (filter === "open") return markets.filter((m) => m.status === "open");
    if (filter === "settled")
      return markets.filter((m) => m.status === "settled" || m.status === "resolved");
    return markets.filter((m) => m.roomVariant === filter);
  }, [markets, filter]);

  const openCount = markets.filter((m) => m.status === "open").length;

  return (
    <>
      <section className="page-head">
        <p className="kicker">the village</p>
        {error ? (
          <>
            <h1>
              The cluster is <span className="flare">not answering</span>.
            </h1>
            <p className="lede">
              Neither the base layer nor the rollup returned anything, so this page has no idea
              how many markets are standing. It is not showing you an empty village, it is
              showing you a broken connection.
            </p>
            <p className="mono-block" style={{ marginTop: 16, maxWidth: "44rem" }}>
              {error}
            </p>
          </>
        ) : (
          <>
            <h1>
              {openCount} market{openCount === 1 ? "" : "s"} still{" "}
              <span className="flare">open</span>.
            </h1>
            <p className="lede">
              Every card is a live account read off the rollup. The book moves here the moment a
              bid lands anywhere, over a websocket, with no refresh.
            </p>
          </>
        )}
      </section>

      <div className="actions" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={filter === "all" ? "chip on" : "chip"}
          onClick={() => setFilter("all")}
        >
          all {markets.length}
        </button>
        <button
          type="button"
          className={filter === "open" ? "chip on" : "chip"}
          onClick={() => setFilter("open")}
        >
          open {openCount}
        </button>
        <button
          type="button"
          className={filter === "settled" ? "chip on" : "chip"}
          onClick={() => setFilter("settled")}
        >
          decided
        </button>
        {LIVE_ROOMS.map((room) => (
          <button
            key={room.variant}
            type="button"
            className={filter === room.variant ? "chip on" : "chip"}
            onClick={() => setFilter(room.variant)}
          >
            {room.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="chip" onClick={() => void reload()}>
          refresh
        </button>
        <Link href="/confess" className="chip">
          confess
        </Link>
      </div>

      {error ? <div className="err">feed: {error}</div> : null}

      {shown.length === 0 ? (
        loading ? (
          <CardSkeleton />
        ) : (
          <Empty>
            No markets standing. <Link href="/confess" className="explorer">Open one</Link>, the
            village is only interesting when somebody has something to lose.
          </Empty>
        )
      ) : (
        <div className="grid">
          {shown.map((market) => (
            <MarketCard key={market.address} market={market} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 34 }}>
        <Link href="/rooms" className="ghost">
          Twenty-five ways to lose a secret
          <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </>
  );
}


