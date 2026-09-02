import Link from "next/link";

/**
 * 404.
 *
 * Next ships an unstyled default here, which in the middle of a designed
 * product reads as a page nobody finished. This is the same aurora surface as
 * everything else, and it says the one useful thing: a market address that does
 * not resolve is usually a market that was never on this cluster.
 */
export default function NotFound() {
  return (
    <section className="page-head" style={{ maxWidth: 620 }}>
      <p className="kicker">404</p>
      <h1>
        Nothing is buried <span className="flare">here</span>.
      </h1>
      <p className="lede">
        This address does not resolve to a market, a tombstone or a room. If you followed a link
        from another cluster, the account exists there and not on this one: the village is per
        cluster, and a market minted on devnet has no twin on a local validator.
      </p>
      <div className="actions" style={{ marginTop: 26 }}>
        <Link href="/" className="keycap">
          Back to the village
        </Link>
        <Link href="/graveyard" className="ghost">
          The graveyard
          <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </section>
  );
}
