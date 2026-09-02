# SINBAZAAR — product truth

Written from the code, the README and the copy already in the app, not from an
interview. The user's instruction was explicit: work the direction out from the
product itself.

---

## What it is

A village of markets where the traded asset is a secret.

Someone writes one sentence. The village never sees it — only `sha256(body ‖ salt)`
and a countdown. For the next few minutes anyone can pay **SEAL** to keep it buried
or pay **READ** for the chance to be the one pair of eyes that ever sees it. When
the timer hits zero, MagicBlock VRF decides, and Solana receives a tombstone.

The confession lives inside a TEE-backed Private Ephemeral Rollup and is never
undelegated. The market on top of it runs on an Ephemeral Rollup so bidding costs
no wallet popup and no base-layer transaction. This is not a metaphor in the copy —
it is what the program does, and the UI's job is to make that legible.

Built for the MagicBlock Solana Blitz v8 hackathon.

## Who uses it

1. **A hackathon judge, for ninety seconds.** The primary audience. Arrives
   sceptical, has seen forty dashboards today, and is asking one question: *is the
   privacy claim real or is it a label?* They will click three things at most. The
   product has to answer that question without being asked.
2. **A villager playing the game.** Writes a confession, or bids on someone else's.
   Wants the timer, the pots, and the rule at zero. Cares about being fast.
3. **A sceptic.** Wants to check the commitment themselves, open the explorer, and
   try to read a secret they are not allowed to read. The product should *invite*
   this — the graveyard already recomputes the hash in their browser.

## Surfaces and their modes

| Surface | Mode | What success looks like |
|---|---|---|
| `/` village feed | **Persuade** | The judge understands the game from the cards alone: a hash, a timer, two pots, a verdict. |
| `/confess` | **Operate** | Nine chained transactions across three layers, and the villager never feels lost. The step list is the feature. |
| `/market/[address]` | **Operate** | Bid without hesitation. "What happens at zero" removes every ambiguity before money moves. |
| `/market/[address]/result` | **Read** | The verdict, stated plainly, plus the one button that proves the privacy boundary. |
| `/graveyard` | **Read** | What Solana was allowed to keep — and proof, computed locally, that it matches. |
| `/rooms` | **Read** | Twenty-five ways to lose a secret; three of them real, and honest about which. |

## Voice

Plain, declarative, slightly grim. Sentences that could be carved. Never cute about
the subject, never edgelord about it either.

Good, and already in the product: *"Somebody has something to lose tonight."*
*"What Solana was allowed to keep."* *"Write it once. It never touches Solana."*
*"Someone paid for the silence. The body never left the rollup."*

Bad: exclamation marks, "Oops!", "Let's get started", emoji, crypto-bro register,
anything that says "seamless" or "powerful" or "revolutionary". Never describe the
product as "leveraging" anything.

Technical identifiers stay literal in the UI — `Outcome::reveals_text()`,
`market.revealed`, `place_bid`. Naming the actual instruction is what makes a judge
believe the rest.

## Visual point of view

**A property and evidence form.** A confession is evidence; the permission member
list is a chain of custody; the tombstone is the final property record. See
[DESIGN.md](DESIGN.md) for the system.

The short version: cool photocopy stock, heavy black rules, square fields, and
colour spent only on the classification band that says what may be seen. Archivo
(one variable file, width + weight axes) and JetBrains Mono, both self-hosted.
The redaction bar is the signature graphic.

## Anti-references

What this product must never look like. The first two are here because the project
shipped them and had to be dug back out:

- **Near-black ground with one warm accent and glowing edges.** This was the
  original look. It is one of the two aesthetics generated interfaces converge on
  regardless of subject, and it arrived by default rather than by decision.
- **Candlelight, parchment, cream, ivory, lamplight, wax.** The literal reading of
  the product's name, which is the least interesting thing about it.
- Fraunces, Playfair, Cormorant, Newsreader, Inter-as-display, Space Grotesk, DM
  Sans, Instrument Sans, and the rest of the faces that signal a model stopped
  looking. Two of these were in the project and both were caught.
- **Side-tab accent borders** — a coloured stripe down one edge of a card. There
  were six; they are now classification bands across the head of the box.
- Glassmorphism, frosted panels, gradients on purple, rounded cards floating on
  drop shadows, pulsing status dots, nested cards, numbered section labels
  ("01 — Features"), emoji as iconography, skeleton shimmer.
- True-crime or basement staging. The register is institutional paperwork: the
  chill comes from a form being indifferent, not from the interface being lurid.

## Constraints

- Next.js 15 App Router, plain CSS in one `globals.css`. No Tailwind, no CSS-in-JS.
- Everything must work offline against a local validator. No CDN fonts, no remote
  assets — a webfont that fails silently downgrades every headline.
- Three live connections (base, ER, TEE) and their state is worth showing, not
  hiding: the footer prints all three endpoints on purpose.
- Burner-wallet-first, because the demo runs on a local validator where browser
  wallets cannot easily connect.
