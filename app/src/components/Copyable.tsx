"use client";

/**
 * An address you can take with you.
 *
 * Half of this interface is a base58 key that somebody will want to paste into
 * an explorer or a CLI. Selecting one by hand out of a mono run is fiddly and
 * easy to get wrong by a character, which for a pubkey means silence rather
 * than an error.
 *
 * The copied state is local to the button, lasts a moment, and is announced,
 * so a screen reader hears that the copy happened rather than only seeing a
 * label change.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function Copyable({
  value,
  label,
  className,
  children,
}: {
  value: string;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // No clipboard permission, or an insecure origin. Say nothing rather than
      // claiming a copy that did not happen.
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      className={className ? `copyable ${className}` : "copyable"}
      onClick={() => void copy()}
      title={`Copy ${label ?? "to clipboard"}`}
    >
      {children ?? value}
      <span className="copy-mark" aria-hidden="true">
        {copied ? "copied" : "copy"}
      </span>
      <span className="sr-only" role="status">
        {copied ? `${label ?? "Value"} copied to clipboard` : ""}
      </span>
    </button>
  );
}
