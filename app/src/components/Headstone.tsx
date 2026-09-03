"use client";

/**
 * A headstone cut from its own commitment hash.
 *
 * Every tombstone in the graveyard carries `sha256(body ‖ salt)`, thirty-two
 * bytes that are already unique to that confession and already on chain. This
 * turns those bytes into the stone: the grain seed, the crack that runs down it,
 * where the edges are chipped, how the slab is shouldered.
 *
 * The point is not decoration. Two headstones look different because the
 * confessions underneath them were different, and the same hash always cuts the
 * same stone, so the picture is a rendering of the data rather than a texture
 * that happens to sit near it. Reload the graveyard and every stone is exactly
 * as it was.
 *
 * Nothing here animates and nothing here is random. `Math.random` would produce
 * a prettier variety and would be a lie about what the image means.
 */
import { useMemo } from "react";

/** A tiny deterministic reader over the hash, so every field has its own bytes. */
class Bytes {
  private i = 0;
  constructor(private readonly b: number[]) {}
  /** Next byte, wrapping. Wrapping is fine: 32 bytes is more than this needs. */
  next(): number {
    const v = this.b[this.i % this.b.length] ?? 0;
    this.i += 1;
    return v;
  }
  /** Next byte mapped into [min, max]. */
  range(min: number, max: number): number {
    return min + (this.next() / 255) * (max - min);
  }
  pick<T>(options: T[]): T {
    return options[this.next() % options.length];
  }
}

export function Headstone({
  commitment,
  className,
  label,
}: {
  commitment: number[];
  className?: string;
  /** Short text cut into the stone, usually the digest's first characters. */
  label?: string;
}) {
  const stone = useMemo(() => {
    const b = new Bytes(commitment.length ? commitment : [0]);

    // The silhouette. A shouldered slab whose crown and shoulders vary.
    const crown = b.range(16, 34);
    const shoulderIn = b.range(4, 13);
    const lean = b.range(-1.4, 1.4);

    // One crack, sometimes two, always starting at an edge and running in.
    const crackCount = b.next() % 5 === 0 ? 2 : 1;
    const cracks: string[] = [];
    for (let c = 0; c < crackCount; c += 1) {
      const startX = b.range(14, 86);
      const startY = b.range(crown + 6, 40);
      let d = `M ${startX.toFixed(1)} ${startY.toFixed(1)}`;
      let x = startX;
      let y = startY;
      const segments = 3 + (b.next() % 3);
      for (let s = 0; s < segments; s += 1) {
        x += b.range(-9, 9);
        y += b.range(9, 22);
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      cracks.push(d);
    }

    // Chips out of the edges.
    const chips = Array.from({ length: 2 + (b.next() % 3) }, () => ({
      x: b.pick([0, 100]) + b.range(-3, 3),
      y: b.range(crown + 10, 132),
      r: b.range(1.2, 3.6),
    }));

    // The grain. feTurbulence takes an integer seed, so the hash can drive the
    // noise field directly rather than being approximated by a CSS filter.
    const seed = ((commitment[0] ?? 0) << 8) + (commitment[1] ?? 0);
    const freq = 0.5 + (commitment[2] ?? 0) / 255;

    return { crown, shoulderIn, lean, cracks, chips, seed, freq };
  }, [commitment]);

  const id = useMemo(
    () => `hs${(commitment[0] ?? 0)}_${(commitment[1] ?? 0)}_${(commitment[2] ?? 0)}`,
    [commitment]
  );

  const { crown, shoulderIn, lean, cracks, chips, seed, freq } = stone;
  const body = `M ${shoulderIn} 140
    L ${shoulderIn} ${crown + 8}
    Q ${shoulderIn} ${crown} ${50 + lean} ${crown - 6}
    Q ${100 - shoulderIn} ${crown} ${100 - shoulderIn} ${crown + 8}
    L ${100 - shoulderIn} 140 Z`;

  return (
    <svg
      className={className}
      viewBox="0 0 100 140"
      role="img"
      aria-label={
        label ? `headstone cut from commitment ${label}` : "headstone cut from its commitment hash"
      }
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <filter id={`${id}grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={freq.toFixed(3)}
            numOctaves="3"
            seed={seed}
            result="n"
          />
          <feColorMatrix in="n" type="saturate" values="0" result="g" />
          <feComposite in="g" in2="SourceAlpha" operator="in" result="clipped" />
          <feBlend in="SourceGraphic" in2="clipped" mode="multiply" />
        </filter>
        {/* Lifted well clear of the card behind it. The first cut used
            #1b1d21 to #0e1013, which is within a few points of the panel it
            sits on, so the silhouette barely existed and every detail cut into
            it was invisible by construction. */}
        <linearGradient id={`${id}face`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#33373d" />
          <stop offset="55%" stopColor="#24272c" />
          <stop offset="100%" stopColor="#181b1f" />
        </linearGradient>
      </defs>

      <path d={body} fill={`url(#${id}face)`} filter={`url(#${id}grain)`} />
      <path d={body} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="0.7" />

      {/* A crack is drawn twice: a dark fissure with a lit edge just beside it.
          Drawn only dark, on a stone this dark, it disappeared entirely. */}
      {cracks.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="none"
            stroke="rgba(0,0,0,0.7)"
            strokeWidth={1.1 - i * 0.3}
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={0.45}
            strokeLinecap="round"
            transform="translate(0.5 -0.4)"
          />
        </g>
      ))}

      {chips.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="var(--ground)" />
      ))}

      {label ? (
        <text
          x="50"
          y={crown + 30}
          textAnchor="middle"
          fontFamily="var(--mono)"
          fontSize="7"
          fill="rgba(255,255,255,0.5)"
          letterSpacing="0.5"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
