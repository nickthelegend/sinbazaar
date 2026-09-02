"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The route error boundary.
 *
 * Almost every failure in this app is an RPC that did not answer, so the copy
 * says that rather than apologising in the abstract. The real message is shown
 * verbatim: a villager debugging a local validator needs the actual error, not a
 * friendly paraphrase of it.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced rather than swallowed, so the browser console still carries the
    // stack for anyone with devtools open.
    console.error("[sinbazaar] route error", error);
  }, [error]);

  return (
    <section className="page-head" style={{ maxWidth: 620 }}>
      <p className="kicker">something broke</p>
      <h1>
        The village stopped <span className="flare">answering</span>.
      </h1>
      <p className="lede">
        This is nearly always a connection: the base validator, the rollup or the TEE endpoint
        did not reply. Check that the local stack is running, then try again.
      </p>

      <pre className="mono-block" style={{ marginTop: 20 }}>
        {error.message || "no message was attached to this error"}
        {error.digest ? `\ndigest ${error.digest}` : ""}
      </pre>

      <div className="actions" style={{ marginTop: 22 }}>
        <button type="button" className="keycap" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="ghost">
          Back to the village
          <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </section>
  );
}
