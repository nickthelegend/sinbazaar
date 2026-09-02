# SINBAZAAR — design system

The visual world this project committed to, written down so that any later change —
by a person or an agent — inherits it instead of drifting back to generic defaults.

Product truth lives in [PRODUCT.md](PRODUCT.md). This file is only about how it looks
and why. The implementation is one stylesheet: `app/src/app/globals.css`.

---

## The idea

**A ledger kept by candlelight in a market that trades other people's secrets.**

Two things follow from that and everything else is downstream:

1. **There is one light source.** The page is lit from above-left by a lamp over a
   stall, not by a uniform UI grey. Warmth falls off toward the edges.
2. **It is a record, not an app.** Ledgers have hairlines and cut corners, not
   rounded cards and drop shadows. Nothing decorative moves.

## Colour

Defined once as tokens on `:root`. Never hard-code a hex outside that block.

| Token | Value | What it is for |
|---|---|---|
| `--ink` | `#0b0806` | The ground. Near-black with a warm cast — never blue-black, never `#111`. |
| `--ink-2` `--ink-3` | `#12100c` `#1a1710` | Card and panel grounds, one and two steps up from the page. |
| `--edge` `--edge-hot` | `#2b2419` `#46381f` | Hairline borders. `-hot` marks a live or focused edge. |
| `--ember` | `#e0a33f` | **The light.** Brand, live state, the running countdown, links. |
| `--flame` | `#f2c874` | Ember at higher intensity — hover, the one thing being pointed at. |
| `--ember-dim` | `#8a6626` | Ember receded: inactive chips, rules, quiet borders. |
| `--oxblood` | `#b03d31` | **Consequence.** Leaks, errors, the fiction banner. Never decorative. |
| `--moss` | `#6f9a83` | The only cool note. Reserved for *settled* and *verified* — a thing that is finished and checkable. |
| `--parchment` | `#ece3d3` | Body text. |
| `--parchment-2` `--parchment-3` | `#b9ac97` `#7d7261` | Secondary and tertiary text. |

The background is two radial pools over `--ink` — one large warm one behind the
headline, one small oxblood one upper-right. That is the lamp. Do not replace it
with a linear gradient; a linear gradient reads as a SaaS hero, a radial pool reads
as light in a room.

## Type

Three self-hosted variable faces in `app/public/fonts/`, latin subset, ~198 KB total.
**Nothing loads from a CDN.** A webfont that fails silently downgrades every headline,
and this product has to work against a local validator with no internet.

| Role | Face | Why this one |
|---|---|---|
| `--display` | **Newsreader** | A newspaper serif with an `opsz` axis 6→72 — the face obituaries are set in. That is literally what the graveyard is. It also holds its strokes on a near-black ground, where a didone's hairlines would break up. |
| `--sans` | **Archivo** | A grotesk with tight apertures and a public-notice flatness. It reads as *posted*, not designed. |
| `--mono` | **JetBrains Mono** | Half this UI is a commitment digest or a pubkey. Tabular figures and a slashed zero are not a nicety here. |

Rules:

- Headlines drive `opsz` up (`72` on `h1`, `40` on `h2`/`h3`). Left at default,
  Newsreader is merely a competent body serif; the display character only appears
  when the optical size is pushed. This is the whole reason to ship the variable file.
- Body sets `"wght" 420` — a grotesk at 400 goes thin against a dark ground.
- Anything monospaced gets `font-variant-numeric: tabular-nums` and `"zero" 1`, so
  columns of digests line up and a changed character is obvious.
- **Banned:** Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, Space Grotesk,
  Playfair Display. Every one of them is an AI-default; Fraunces was in this project
  for an hour and the detector was right to flag it.

## Form

- **Radius `3px`.** Everywhere. A ledger's corners are cut, not rounded.
- **Hairline borders**, never shadows. There is no elevation model in this product;
  there is only ink on a page and one lamp.
- **No nested cards.** A card contains facts, not other cards.
- Pot bars are a 2px rule split by proportion — the only chart in the product, and
  it is a line, not a donut.

## Motion

Almost none, deliberately. The countdown is the only thing that moves, because it is
the only thing that is running out. No pulsing dots, no skeleton shimmer, no
entrance animations on cards. When something is loading, it says so in words.

## Voice in the interface

Sentences that could be carved. See PRODUCT.md for the register. Two interface-specific
rules:

- **Name the real instruction.** `place_bid`, `Outcome::reveals_text()`,
  `market.revealed`. A judge believes the privacy claim because the UI is willing to
  say exactly which line does it.
- **State the rule before money moves.** The market page's "what happens at zero"
  block is not help text; it is the product. Never hide it behind a tooltip.

## Anti-references

Never, under any instruction short of an explicit rebrand:

gradients on purple · glassmorphism · italic serif hero over a photo ·
Inter + Playfair · pulsing status dots · generic drop shadows · nested cards ·
numbered section labels · emoji as iconography · grey-on-grey dark mode with one
accent blue · true-crime or torture staging.

## How to check

```bash
node ~/.claude/skills/impeccable/scripts/detect.mjs --json app/src
```

Must return `[]`. It currently does. Anything it flags gets fixed, never suppressed.
