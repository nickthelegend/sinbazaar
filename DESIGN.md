# Design System: SINBAZAAR

Single source of truth for this interface. Written from the built product. Any
later change inherits these rules rather than drifting back to defaults. Product
truth lives in [PRODUCT.md](PRODUCT.md); the implementation is one stylesheet,
`app/src/app/globals.css`, plus `app/src/components/Aurora.tsx`.

**Design read:** an on-chain secrets market for crypto-native users and hackathon
judges, rendered as a cinematic dark product surface whose entire personality is
a living warm aurora. Native CSS, no component library.

**Dials:** Variance 6, Motion 6, Density 5.

---

## 1. Visual theme and atmosphere

Near-black ground. Behind everything, several large soft-focus diagonal
light-blades glow crimson at their cores and blend through coral into amber at
the tips, drifting and breathing on staggered pure-CSS loops, under real
`feTurbulence` film grain and a vignette.

Two rules carry the whole look and are absolute:

1. **Strictly warm.** Crimson, coral, amber. No purple, indigo, violet, cyan or
   green anywhere. The aurora is the only chroma in the composition.
2. **Everything else is neutral.** `#ffffff`, `#9c9c9d`, `#07080a`.

**Page theme lock.** This is a single-theme dark product. The brief pins the
near-black canvas as the personality, so no light rendition is served and
`color-scheme` is forced rather than following the OS.

Two things are load-bearing rather than decorative and must survive any future
change:

* **The redaction bar.** Where a confession exists but may not be shown, the page
  draws its withheld shape. It renders `Outcome::reveals_text()`.
* **The classification band.** A released body carries a crimson band saying it
  was authorised; a withheld one carries a neutral band that refuses it.

## 2. Colour palette and roles

| Token | Value | Role |
|---|---|---|
| `--ground` | `#07080a` | Page ground. |
| `--raise` | `#0d0f12` | Lifted neutral. |
| `--glass` | `rgba(20,22,26,.66)` | Every panel, card and the nav. Backdrop-blurred. |
| `--sunk` | `#050607` | Inputs, code blocks, evidence containers. |
| `--white` | `#ffffff` | Primary type. |
| `--muted` | `#9c9c9d` | Secondary type. |
| `--dim` | `#838487` | Tertiary. Set by measurement: `#6d6e70` failed AA at 3.7:1. |
| `--crimson` | `#ff2f3a` | Aurora core. Released, leaked, failed, urgent. |
| `--coral` | `#ff6b4a` | Aurora mid. Rollup, sole reader, focus ring. |
| `--amber` | `#ffb347` | Aurora tip. Open, live, forgiven, active step. |
| `--key` / `--key-ink` | `#e6e6e6` / `#2f3031` | The keycap. |

State is tinted **from the aurora**, never from a second colour family. There is
no green "success" and no blue "info" in this system; open reads amber, released
reads crimson, and withheld reads neutral.

## 3. Typography

Two self-hosted variable faces, latin subset, 71KB. Nothing loads from a CDN:
this runs against a validator on localhost with no internet.

* **Inter** for all UI. Hierarchy comes from size and weight: a 64px/600 headline
  over an 18px/400 muted subtitle.
* **Geist Mono** for digests, pubkeys, lamports, clocks, the install caption and
  shortcut chips. Half this interface is a value compared character by character.

**One word of the headline** is set in a warm amber to crimson gradient via
`background-clip: text` (`.flare`), so the type ties to the light behind it.
Exactly one word, never a whole line.

## 4. Component stylings

* **Radius:** `6px` small, `10px` default, `14px` panels, `8px` keycaps, `999px`
  pills. One system.
* **Glass:** `--glass` fill, 1px hairline, `inset 0 1px 0` top highlight, and a
  deep soft drop shadow. Used for the nav, every card and every panel.
* **The keycap** is the one raised surface in an otherwise flat language:
  `#e6e6e6` fill, `#2f3031` text, and a layered shadow stack of a 2px black ring,
  a soft white outer glow, and inset top-white and bottom-dark highlights, so it
  reads as a physical key. It presses down on `:active`.
* **The nav floats.** A translucent pill near the top, not a full-bleed bar.
* **Ghost pill:** transparent fill, thin ring, trailing arrow. Exactly one per
  page, and it closes the page rather than floating in a void.
* **Badges** are washed aurora tints with matching ink.

## 5. Motion

* **The aurora** is the signature: three blades drifting (translate plus a small
  rotate) and breathing (opacity plus scale) on staggered 15s, 18s and 22s loops.
  Every `0%` keyframe is full bloom, so any still frame is the richest frame.
* **Card entry:** 520ms rise, staggered 50ms, capped at the fifth item.
* **Countdown:** inside the final 20 seconds the clock goes crimson and breathes.
* **Keycap press:** 130ms, and the shadow stack collapses under the finger.

Under `prefers-reduced-motion` everything stops, and the aurora holds its
full-bloom frame rather than freezing mid-drift.

## 6. Deliberate deviations from the detector

The design detector reports three findings. All three are pinned by the brief
and are kept knowingly rather than silently:

| Finding | Why it stands |
|---|---|
| `overused-font: Inter` | The brief pins "ONE Inter typeface for all UI". |
| `overused-font: Geist Mono` | The brief pins GeistMono for the caption and shortcut chips. |
| `gradient-text` | The brief pins one headline word in a warm gradient. It is one word, not a whole header, which is the permitted form. |

Nothing else is suppressed. Anything the detector flags that is **not** in this
table is a real defect and gets fixed.

## 7. What this system does not do

* No purple, indigo, violet, cyan or green. Ever.
* No second colour family for state.
* No fake product UI built from divs. The lower half of the landing page is the
  real live market feed, not a mockup of one.
* No invented commercial claims. There is no "featured on" badge, because the
  product has not been featured anywhere.
* No em-dashes or en-dashes anywhere a user can see. Currently zero.
* No scroll cues, no version labels in the hero, no section-number eyebrows.

## 8. Surfaces

Every route carries the system. There is no unstyled default anywhere:

| Route | Notes |
|---|---|
| `/` | Hero over the aurora, then the live market feed. |
| `/confess` | The nine-step walk, as command-bar style result rows. |
| `/rooms` | Three live rooms, twenty-two enumerated and marked. |
| `/graveyard` | Released and withheld tombstones, side by side. |
| `/challenge` | Five probes with raw JSON-RPC replies. |
| `/market/[address]` | The book, the purse, the session, the rule at zero. |
| `/market/[address]/result` | The verdict as a full glass section. |
| `not-found.tsx` | 404. Next ships an unstyled default; this replaces it. |
| `error.tsx` | Route error boundary. Prints the real error verbatim. |

## 9. Verification

Measured, not assumed:

```bash
grep -ro "—\|–" app/src --include="*.tsx" --include="*.css" | wc -l   # must be 0
node ~/.claude/skills/impeccable/scripts/detect.mjs --json app/src     # only the 3 above
```

* WCAG AA on every text and ground pair, sampled from the live DOM with **alpha
  compositing**: a translucent wash must be flattened onto the ground before the
  ratio is taken, or every glass surface reports a false 1.00.
* No horizontal overflow at 375px or 1440px.
* Zero console errors on every route.
* Every route above opened and checked, not assumed.

## 10. What was blocked

A locked visual reference could not be generated first: `generate-image.mjs`
needs an `OPENAI_API_KEY` that is not set in this environment, and no
harness-native image tool is available. The brief itself served as the reference
instead, and it was specific enough to build against directly. If a key is added
later, generate the comp and check the built surface against it.
