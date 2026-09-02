# UI audit

Run with `redesign-existing-projects` against the built app, every surface opened
in a browser rather than read in a diff.

**Honest note on ordering.** The first audit in this run was performed before the
first redesign, and it drove that pass: 121 em-dashes in visible copy, pure
`#ffffff` as a surface, no dark mode at all, all-caps stamping on every label, a
decorative status dot, and hairline borders on every row of every list. The
direction then changed twice on instruction, and the final direction arrived as a
pinned art brief rather than an inference. So this document is the audit of the
**current** build. Everything it found is fixed below, in this run.

---

## Phase 0, evidence

`npx skills add Leonxlnx/taste-skill` installed 14 skills into `.agents/skills/`:
brandkit, design-taste-frontend (v2), design-taste-frontend-v1,
full-output-enforcement, gpt-taste (unused, that variant targets GPT/Codex),
high-end-visual-design, image-to-code, imagegen-frontend-mobile,
imagegen-frontend-web, industrial-brutalist-ui, minimalist-ui,
redesign-existing-projects, stitch-design-taste.

## Phase 2, the design read and the dials

Per v2 section 0.B, stated before implementation:

> Reading this as: an on-chain secrets market for crypto-native users and
> hackathon judges, with a cinematic warm-aurora language, leaning toward native
> CSS and a single pinned dark theme.

**Mode (section 11.A):** Redesign, overhaul. Content and information architecture
preserved, visual language replaced.

**Dials (section 1):** `DESIGN_VARIANCE 6`, `MOTION_INTENSITY 6`,
`VISUAL_DENSITY 5`. Variance is above the middle because the aurora is
asymmetric and the hero is centred over it rather than gridded. Motion is 6
because the aurora is the personality and has to actually move. Density is 5
because a market book is data, but the landing surface is a hero.

**Sub-direction:** exactly one, `high-end-visual-design`. Not soft, not
minimalist, not brutalist. The brief pins cinematic depth, a keycap with a real
shadow stack, dark glass and a living background, which is the high-end register
rather than any of the three. Blending was avoided deliberately.

**Reference image:** blocked. `generate-image.mjs` requires an `OPENAI_API_KEY`
that is not set here, and no harness-native image tool is available. The user's
brief was itself a locked reference, specific to hex values and shadow stacks, so
the build was made against it directly.

---

## What was preserved, and why

Section 11.C says preservation before modernisation. These survived every
direction change in this run:

| Kept | Reason |
|---|---|
| The redaction bar | It renders `Outcome::reveals_text()`. It is the mechanism, not decoration. |
| The classification bands | Released against withheld, side by side, explains the product with no caption. |
| Every route and slug | `/`, `/confess`, `/rooms`, `/graveyard`, `/challenge`, `/market/[address]`, `/market/[address]/result`. |
| Every nav label | Muscle memory and any external link. |
| The copy voice | Plain, declarative, slightly grim. Visual change is not a rewrite. |
| Focus rings, reduced-motion, skip link | Accessibility wins are never regressed to make room for a look. |
| Tabular figures on every number | Half this interface is a value compared character by character. |

## What this audit found in the current build, and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | `100vh` twice in the vendored wallet stylesheet | `100dvh`, so iOS Safari does not jump the viewport |
| 2 | Ambient drop shadows were pure black on a blue-black ground | `--cast` tokens tinted to the ground hue. The keycap's black ring stays: that one is the brief's spec for a physical key, not an ambient shadow |
| 3 | No orphan control on headlines | `text-wrap: balance` on headings, `pretty` on body |
| 4 | Mid grays were pure neutral while the grounds were blue-tinted | One gray family, all cool-tinted. Re-measured: muted 6.9:1, dim 5.0:1 on glass |
| 5 | Loading state was a centred word of text | `CardSkeleton`, shaped like the real card, so nothing reflows when the rollup answers |

## Knowingly accepted, with reasons

| Item | Why it stands |
|---|---|
| Inter as the interface face | Pinned by the brief. The audit and the detector both flag it; a user pin outranks both. |
| Geist Mono | Same. |
| Gradient text on one headline word | Pinned by the brief. One word, never a whole line, which is the permitted form. |
| Saturated crimson accent | Pinned. The aurora is the entire personality and desaturating it would remove the design. |
| Uniform grid for the market feed | The audit bans three equal columns as a *feature row*. These are homogeneous live data items, not marketing cards, and a uniform grid is the correct form for them. |
| Single theme, no light mode | Pinned. The brief makes the near-black canvas the personality. |

## Surfaces checked

Village, confess, rooms, graveyard, challenge, market detail, result, 404, and
the route error boundary. Nine surfaces, each opened, screenshotted and measured.
The 404 and the error boundary did not exist before this run: Next was serving
its unstyled defaults, which is a placeholder by any definition.
