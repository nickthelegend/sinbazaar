"use client";

/**
 * The rooms.
 *
 * Three have a full create -> bid -> VRF -> settle -> tombstone loop. The rest
 * are in the `Room` enum on purpose and rejected by `create_market`, so they are
 * shown here as what they are: named, ruled, and switched off.
 */
import Link from "next/link";
import { LIVE_ROOMS, PHASE_TWO_ROOMS } from "@/lib/rooms";

export default function RoomsPage() {
  return (
    <>
      <section className="page-head">
        <div className="kicker">the rooms</div>
        <h1>Twenty-five ways to lose a secret.</h1>
        <p className="lede">
          Every room below is a variant of the <code>Room</code> enum in the deployed program.{" "}
          <code>Room::is_live()</code> admits three of them; <code>create_market</code> rejects
          the rest outright. They are enumerated rather than half-built.
        </p>
      </section>

      <h3 style={{ marginBottom: 12 }}>Live · {LIVE_ROOMS.length}</h3>
      <div className="grid" style={{ marginBottom: 32 }}>
        {LIVE_ROOMS.map((room) => (
          <article key={room.variant} className="room-card live">
            <h2>{room.label}</h2>
            <p className="rule">{room.rule[0]}</p>
            <p className="rule">{room.rule[1]}</p>
            <div className="room-foot">
              <span className="tag-live">live</span>
              <Link href="/confess" className="explorer">
                open one →
              </Link>
            </div>
          </article>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Enumerated, disabled · {PHASE_TWO_ROOMS.length}</h3>
      <div className="grid">
        {PHASE_TWO_ROOMS.map((room) => (
          <article key={room.variant} className="room-card off">
            <h2>{room.label}</h2>
            <p className="rule">{room.rule[0]}</p>
            <p className="rule">{room.rule[1]}</p>
            <div className="room-foot">
              <span className="tag-phase">Phase 2</span>
              <span className="muted small">
                <code>Room::{room.name}</code>
              </span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
