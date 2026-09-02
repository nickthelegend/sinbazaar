# Design System: SINBAZAAR

Single source of truth for this interface. Written from the built product, not
ahead of it. Any later change inherits these rules rather than drifting back to
defaults. Product truth lives in [PRODUCT.md](PRODUCT.md); implementation is one
stylesheet, `app/src/app/globals.css`.

**Design read:** a redesign-overhaul of a live on-chain privacy product, for
hackathon judges and crypto-native operators, in a restrained editorial document
language, built on native CSS with dual-mode tokens.

**Dials:** Variance 4 (Predictable-to-Offset), Motion 3 (Static Restrained),
Density 5 (Daily App Balanced). This is an operational product with real money
and running clocks. Restraint beats variance, motion is state feedback rather
than choreography, and density sits above a gallery and well below a cockpit.

---

## 1. Visual theme and atmosphere

Quiet, warm-neutral, document-like. The interface behaves like a well-set
records page: generous air around a small amount of type, one accent spent only
where it carries meaning, and surfaces that sit flat rather than floating.

The tension in this product comes from its content, a confession with a clock on
it, so the chrome stays out of the way. Nothing shouts. The only thing that ever
moves on its own is a countdown inside its final minute, and that motion is the
page telling the truth about state.

Two things are load-bearing rather than decorative and must survive any future
change:

* **The redaction bar.** Where a confession exists but may not be shown, the page
  draws its withheld shape. It is a direct rendering of `Outcome::reveals_text()`.
* **The classification band.** A released body carries a band saying it was
  authorised; a withheld one carries the band that refuses it. Side by side in the
  graveyard, the two explain the whole product with no caption.

## 2. Color palette and roles

Semantic names only. Never hard-code a hex outside the token block. Dark is a
full re-declaration of the same names, so hierarchy parity is structural.
Every pair below was measured in the live page, not estimated.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#fbfbf9` | `#121211` | Page ground. Warm bone, warm off-black. |
| `--surface` | `#fdfdfc` | `#191918` | Cards, panels. |
| `--surface-2` | `#f4f3f0` | `#201f1d` | Sunk fields, active rows, badges. |
| `--surface-sunk` | `#efeeea` | `#0e0e0d` | Evidence containers, code blocks. |
| `--text` | `#1b1b19` | `#eceae5` | Primary. |
| `--text-2` | `#6d6c66` | `#a2a099` | Secondary prose. |
| `--text-3` | `#6f6d66` | `#8a887f` | Muted labels. Set by measurement, not by eye. |
| `--line` | `rgba(24,23,20,.09)` | `rgba(255,253,247,.10)` | Hairlines. |
| `--accent` | `#b0392f` | `#e0776b` | The one accent. Lifted in dark so it pops equally. |

Semantic classification colors, each with its own wash so every badge clears AA
in both modes: `--held` (withheld, settled), `--custody` (rollup, sole reader),
`--cleared` (open, released, verified), `--pending` (expired, awaiting VRF).

**Constraints.** No pure `#ffffff` and no pure `#000000` in either mode; pure
values kill depth. One accent, used identically everywhere. Color is spent only
on classification and state, never on decoration: a market card's room, author,
pots and hash are all neutral, and the only colored things on it are the badge
saying which layer holds it and the badge saying what the verdict was.

## 3. Typography rules

Two self-hosted variable faces, latin subset, 78KB total. Nothing loads from a
CDN, because a webfont that fails silently downgrades every headline and this
runs against a validator on localhost with no internet.

* **Schibsted Grotesk** for everything structural. A newspaper commission, so it
  is built to set real sentences at small sizes and still has a voice at display.
  Geist was tried first and rejected: a detector flagged it as one of the faces
  every wave of generated interfaces converges on, and that is exactly the thing
  this system exists to avoid.
* **JetBrains Mono** for digests, pubkeys, lamports and clocks, with tabular
  figures and a slashed zero. Half this interface is a value compared character
  by character.

Hierarchy comes from **weight and color, not raw scale.** Headings are 500
weight with tight tracking (`-0.026em`); body is 400 at 15px/1.6. `h1` tops out
at 42px. No all-caps stamping on every label, which was the previous system's
mistake and read as shouting.

Digests are never case-transformed. Uppercasing a hash under a heading rule makes
the same value look like two different values.

## 4. Component stylings

* **Radius system:** `4px` small, `8px` containers, `999px` badges. Three values,
  one system, no strays.
* **Cards:** 1px hairline, 8px radius, no drop shadow at rest. Hover lifts by
  `translateY(-1px)` with a 4%-opacity shadow. Never a colored stripe down one
  edge; that is the most recognisable generated-UI tell and this project had six
  of them before they became classification bands.
* **Buttons:** solid `--text` on `--canvas` for primary, hairline chip for
  secondary, `scale(0.98)` on `:active`. No shadows, no pill-shaped primaries.
* **Badges:** wash background plus matching ink, 999px, 11.5px. Semantic only.
* **Inputs:** hairline, 4px radius, focus ring is a 3px `--surface-2` halo plus a
  `--text-3` border, never a browser default outline.
* **Lists:** no `border-top` plus `border-bottom` on every row. The step list and
  the probe list use spacing and a state fill instead.

## 5. Layout principles

Content column caps at `1120px`, prose at `60ch`. Section rhythm is set by
`.shell` padding (56px top, 96px bottom) and a 40px page-head margin. The market
feed is `auto-fill minmax(300px, 1fr)`; detail pages are a `1.4fr / 1fr` split
that collapses to one column at 900px.

**Eyebrows are rationed.** One `.kicker` per page, on the page head only. Never a
section-number eyebrow, never `01 / INDEX`.

## 6. Responsive rules

* Header stays on one line at desktop, 62px tall. Below 1040px the wallet stall
  drops to its own row rather than crushing the nav; a nav item clipped to a
  single letter is worse than a wrapped header.
* Two-column layouts collapse at 900px; `.shell` padding tightens at the same
  breakpoint.
* No horizontal overflow at any width. Verified at 375px and 1280px.

## 7. Motion philosophy

Motion intensity 3. Every animation must be justifiable in one sentence.

* **Grid entry:** `rise` keyframe, 520ms, `cubic-bezier(0.16,1,0.3,1)`, staggered
  45ms per item up to the fourth, then flat. Cards arrive, they do not perform.
* **Countdown urgency:** inside the final 20 seconds the clock takes the accent
  color and pulses at 1s. The card border takes the accent too. This is the only
  sustained motion on the page, and the last seconds are the only moment in this
  product that deserves one.
* **Pot bar:** the fill grows into its new size over 420ms with a compositor-only
  transform, so a bid landing reads as movement. Never animate the box size:
  that forces layout on every frame.
* **Hover:** 160-200ms on color, border and a 1px lift. Nothing else.

Everything above is disabled under `prefers-reduced-motion: reduce`.

## 8. Anti-patterns (hard bans)

* **Em-dashes and en-dashes, anywhere visible.** Zero. The audit that opened this
  redesign found 121 of them. Use a period, a comma, a colon, or parentheses.
* **Middle-dot as a general separator.** Maximum one per line.
* **Decorative status dots.** Only for real semantic state.
* **Side-tab accent borders** on cards.
* **Pure white or pure black** in either mode.
* **Inter, Roboto, Open Sans, Geist** as the interface face.
* **All-caps condensed stamping** on every label.
* **Scroll cues, version labels in the hero, section-number eyebrows.**
* **Gradients, glassmorphism, neon glows, heavy drop shadows.**
* **Fake product UI built from divs**, hand-rolled decorative SVG, emoji as icons.
* **Hairline borders on every row** of a long list.

## 9. Verification

Before shipping any change to this interface, all of these must hold, measured
rather than assumed:

```bash
# zero em-dashes and en-dashes in anything the user can see
grep -ro "—\|–" app/src --include="*.tsx" --include="*.css" | wc -l   # must be 0
```

* WCAG AA on every text and ground pair, **in both light and dark**, sampled from
  the live DOM. Currently 0 failures in each.
* No horizontal overflow at 375px or 1280px.
* Header on one line at desktop, height 62px.
* One radius system, one accent, one theme per page.
* Zero console errors on every route.
