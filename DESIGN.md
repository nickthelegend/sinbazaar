# SINBAZAAR — design system

Written from the built world, not before it. Product truth lives in
[PRODUCT.md](PRODUCT.md); this file is only how it looks and why. The whole
implementation is one stylesheet: `app/src/app/globals.css`.

---

## The world: property & evidence

**A confession is evidence. The permission member list is a chain of custody. The
tombstone is the final property record.** So the interface is the paperwork an
institution uses when it takes something off you and promises to account for it
later: cool photocopy stock, heavy black rules, square fields, a case number on
everything, and colour spent only on the band that says what may be seen.

This replaced a candlelit-ledger world — near-black ground, warm ember accent,
glowing edges, serif display. That world was not chosen; it was defaulted into. It
is one of the two looks generated interfaces converge on regardless of subject, and
its display faces (Fraunces, then Newsreader) are both on the list of faces that
signal a model stopped looking. The current world was reached by ranking seven
grounded candidates from the audience's real cultural home — classified markings,
betting exchanges, evidence and custody, actuarial slips, numbers stations,
pharmaceutical print, tote boards — and building the one the roll assigned rather
than the one that ranked first.

### Disciplines borrowed, and from where

Each was taken from a direction that lost, and each is a system discipline, not a
motif:

- **From a monochrome op-art gallery — state rides rule weight, not colour.** A
  live market is drawn with a heavier bottom rule; a market inside its final minute
  thickens further and turns its rule to seal red. Nothing gets a brighter accent
  to mean "important".
- **From a coiled earthen tower — process stays visible.** Every instruction stamps
  a line into the custody log and none are removed, so the walk accumulates the way
  a custody sheet does rather than replacing itself with a spinner.
- **From paper automata — exactly one thing moves.** The countdown, and only inside
  the last minute. Stillness everywhere else is what makes a running clock
  frightening.

---

## Colour

Defined once on `:root`. Never hard-code a hex outside that block. Every value below
passes WCAG AA against the ground it is used on, measured in the live page.

| Token | Value | Role |
|---|---|---|
| `--paper` | `#e6e9e6` | Page ground. Cool, photocopied. **Never cream, never parchment.** |
| `--form` | `#fbfcfb` | The record itself — card and panel ground. |
| `--form-2` | `#eff1ee` | Header bands, alternating fields. |
| `--field` | `#ffffff` | An input, or a box holding evidence. |
| `--ink` | `#16181a` | Rules *and* text. One black for both, because a form has no elevation. |
| `--ink-2` | `#545a5c` | Secondary text. 6.8:1 on form. |
| `--ink-3` | `#6f7574` | Muted — a dead clock, an unrun step. 4.6:1 on form. |
| `--void` | `#c3c8c5` | Hairlines, hatching, out-of-service rules. |
| `--seal` | `#c8102e` | **Evidence tape.** The secret, a broken seal, a released body, an error. |
| `--custody` | `#17457f` | **Numbered seal.** Chain-of-custody entries, the rollup, links. |
| `--cleared` | `#1c6b41` | Released, settled, verified, in service. |
| `--marker` | `#ffe94d` | Highlighter. A running step, an active rule branch, a hover. |

Colour is **only** spent on classification. A card's room, author, pots and hash are
all black on white; the only coloured things on it are the band saying which layer
holds it and the band saying what the verdict was.

## Type

Two self-hosted variable faces, latin subset, 121 KB total. Nothing reaches a CDN —
a webfont that fails silently downgrades the whole page, and this has to work
against a validator on localhost with no internet.

- **Archivo**, one file carrying **both** a width axis (62–125) and a weight axis.
  Condensed caps at `wdth 68–80` stamp every header, label and band; normal width
  sets body copy. A grotesk, because forms are set in grotesks — a serif display
  here would be a book pretending to be a document.
- **JetBrains Mono** for case numbers, digests, pubkeys and lamports, with tabular
  figures and a slashed zero. Half this interface is a value that must be compared
  character by character.

**Digests are never case-transformed.** The stamped-caps treatment on headings would
otherwise print the same hash uppercase on one page and lowercase on another, which
reads as two different values.

Banned display faces, and the reason the ban exists: Fraunces, Playfair, Cormorant,
Lora, Crimson, Newsreader, Syne, Space Grotesk, Space Mono, IBM Plex, Inter-as-display,
DM Sans/Serif, Outfit, Plus Jakarta, Instrument Sans. Two of them were in this project
and the detector was right both times.

## Form

- **Square corners. No radius anywhere.** Forms are cut, not rounded.
- **Rules, never shadows.** There is no elevation model; there is ink on stock.
- **No side-tab accent borders.** A coloured stripe down one edge of a card is the
  single most recognisable tell of a generated interface, and this project had six
  of them. They were replaced with **classification bands** — a full-width strip
  across the head of the box, which is what evidence paperwork actually does:
  `RELEASED — AUTHORISED FOR PUBLICATION` in seal red over a leaked confession,
  `WITHHELD — THE VERDICT DID NOT AUTHORISE PUBLICATION` in black over a redaction.
- **The redaction bar is the signature graphic.** Where a confession exists but may
  not be shown, the page draws its withheld shape rather than a sentence explaining
  that it is withheld. The bar widths are fixed and arbitrary on purpose: the real
  length of the body is itself private.
- An empty book is drawn as **hatching**, not a false 50/50 split.

## Motion

One thing moves: the countdown, and only under a minute, ticking once a second at
`steps(1)`. No shimmer, no skeletons, no entrance animations, no pulsing dots. When
something is loading it says so in words. `prefers-reduced-motion` disables even the
tick.

## Accessibility

AA contrast on every text/ground pair, measured in the browser rather than eyeballed.
A 3px `--custody` focus ring on every interactive element, suppressed for pointer
clicks. Full keyboard operability, a skip link, and `role="img"` with a real label on
the redaction block so a screen reader is told the material is withheld rather than
finding three empty spans.

## How to check

```bash
node ~/.claude/skills/impeccable/scripts/detect.mjs --json app/src
```

Must return `[]`. It currently does. Anything it flags gets fixed, never suppressed —
it has caught a real defect in this project twice.
