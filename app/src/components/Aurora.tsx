/**
 * The aurora.
 *
 * Three large soft-focus light-blades, screen-blended over the near-black
 * ground, each drifting and breathing on its own staggered loop in pure CSS.
 * Over them sits a real feTurbulence film grain and a vignette, so the field
 * reads as crafted light rather than a flat gradient.
 *
 * Server-rendered and static: there is no state, no JavaScript on the client,
 * and nothing here reacts to scroll. It is fixed and pointer-transparent, so it
 * never intercepts a click meant for the page above it.
 *
 * Every keyframe's 0% is full bloom, which means a screenshot taken at any
 * moment after load still catches the richest frame.
 */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="blade blade-1" />
      <div className="blade blade-2" />
      <div className="blade blade-3" />

      <svg className="grain" width="100%" height="100%">
        <filter id="aurora-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.82"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#aurora-grain)" opacity="0.42" />
      </svg>

      <div className="vignette" />
    </div>
  );
}
