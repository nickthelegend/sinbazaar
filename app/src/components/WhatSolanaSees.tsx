"use client";

/**
 * The two halves of the claim, side by side, while you are still typing.
 *
 * Left: the sentence, which never leaves the rollup. Right: everything Solana
 * will ever learn about it — thirty-two bytes of `sha256(body ‖ salt)` and a
 * length. The lesson lands in the five seconds somebody is already spending on
 * the textarea, which is cheaper than any amount of explanation elsewhere.
 *
 * The hash shown here is **the commitment**, not an illustration of one. The
 * salt is fixed by the page before the first keystroke and handed to
 * `createConfession`, so the digest on the right is bit-for-bit what gets
 * published, and can be checked against the tombstone afterwards. Hashing the
 * body without the salt would have been easier and would have been a lie: it
 * would show a number that never appears anywhere.
 */
import { useEffect, useState } from "react";
import { commitmentHash } from "@/lib/anchor";
import { byteLen, fullHash } from "@/lib/format";

export function WhatSolanaSees({ body, salt }: { body: string; salt: Uint8Array }) {
  const [digest, setDigest] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const text = body.trim();
    if (!text) {
      setDigest(null);
      setFailed(null);
      return;
    }
    // Caught and shown, never swallowed. The first version used a bare `void`
    // on this promise, so when it rejected the panel simply went on saying
    // "a hash appears here as you write" forever — a component failing silently
    // while looking like it was merely waiting.
    commitmentHash(new TextEncoder().encode(text), salt)
      .then((h) => {
        if (!alive) return;
        setDigest(fullHash(h));
        setFailed(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setDigest(null);
        setFailed(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [body, salt]);

  return (
    <div className="wss">
      <div className="wss-side">
        <span className="wss-label">stays in the rollup</span>
        <p className="wss-body">
          {body.trim() ? body : <em className="wss-empty">nothing written yet</em>}
        </p>
        <span className="wss-meta">{byteLen(body)} bytes, sealed inside the TEE</span>
      </div>

      <div className="wss-arrow" aria-hidden="true">
        <span>sha256(body ‖ salt)</span>
      </div>

      <div className="wss-side wss-public">
        <span className="wss-label">all Solana ever learns</span>
        {failed ? (
          <p className="wss-body">
            <em className="wss-empty">could not compute the commitment: {failed}</em>
          </p>
        ) : digest ? (
          <code className="wss-hash">{digest}</code>
        ) : (
          <p className="wss-body">
            <em className="wss-empty">a hash appears here as you write</em>
          </p>
        )}
        <span className="wss-meta">
          32 bytes. Not the sentence, not its length in words, not who read it.
        </span>
      </div>
    </div>
  );
}
