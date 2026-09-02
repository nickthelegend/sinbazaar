# Design System: SINBAZAAR

Generated with `stitch-design-taste` from the built product. Single source of
truth for this interface: any later change inherits these rules rather than
drifting back to defaults. Product truth lives in [PRODUCT.md](PRODUCT.md), the
audit that produced this in [docs/UI-AUDIT.md](docs/UI-AUDIT.md), and the
implementation in `app/src/app/globals.css` plus `app/src/components/Aurora.tsx`.

**Design read:** an on-chain secrets market for crypto-native users and hackathon
judges, with a cinematic warm-aurora language, leaning toward native CSS and a
single pinned dark theme.

**Dials:** Variance 6 (Offset Asymmetric), Motion 6 (Fluid CSS), Density 5 (Daily
App Balanced). Sub-direction: `high-end-visual-design`, one register, not blended.

---

## 1. Visual Theme and Atmosphere

A cinematic, near-black product surface whose entire personality is a **living
warm aurora**. Three large soft-focus diagonal light-blades drift and breathe
behind everything, glowing crimson at their cores and blending through coral into
amber at the tips, under real film grain and a vignette. The mood is a night
market lit by a fire somewhere off-frame: warm, moving, and slightly ominous,
with every piece of chrome held to cold neutral so the light is the only colour
in the room.

Density sits mid-scale. The hero breathes; the market book below it is data and
is packed accordingly. Motion is constant but slow, on 15 to 22 second loops, so
the page feels alive without ever asking to be watched.

## 2. Colour Palette and Roles

- **Void Ground** (`#07080a`) - Primary background. Near-black, cool-tinted, never pure `#000000`.
- **Sunk Well** (`#050607`) - Inputs, code blocks, evidence containers. The one surface below the ground.
- **Raised Neutral** (`#0d0f12`) - Lifted flat surfaces.
- **Dark Glass** (`rgba(20,22,26,0.66)`) - Every panel, card and the floating nav. Backdrop-blurred 16px.
- **Pure White** (`#ffffff`) - Primary type only.
- **Muted Steel** (`#9b9ca1`) - Secondary type, descriptions, metadata. 6.9:1 on glass.
- **Dim Steel** (`#82838a`) - Tertiary labels. 5.0:1 on glass. Set by measurement, not by eye.
- **Whisper Border** (`rgba(255,255,255,0.09)`) - 1px structural lines, with `inset 0 1px 0 rgba(255,255,255,0.07)` as the top highlight.
- **Aurora Crimson** (`#ff2f3a`) - Blade core. Released, leaked, slashed, urgent, error.
- **Aurora Coral** (`#ff6b4a`) - Blade mid. Rollup, sole reader, focus ring.
- **Aurora Amber** (`#ffb347`) - Blade tip. Open, live, forgiven, the active step.
- **Keycap** (`#e6e6e6` fill, `#2f3031` ink) - The single raised surface.

The three aurora values are **one accent, not three**: they are stops on a single
gradient and are never used as independent semantic colours competing for
attention. There is no green success and no blue info anywhere in this system.
Open reads amber, released reads crimson, withheld reads neutral.

Shadows are tinted to the ground (`rgba(2,4,9,…)`), never pure black, because a
neutral shadow on a blue-black canvas reads as a smudge instead of depth.

## 3. Typography Rules

- **Display and Body:** **Inter** (`400-700`, self-hosted variable, 48KB). Hierarchy is driven by size and weight, not by family: 64px/600 headline over 18px/400 muted subtitle. `text-wrap: balance` on every heading, `pretty` on body, so no headline orphans a word.
- **Mono:** **Geist Mono** (`400-600`, self-hosted, 23KB). Digests, pubkeys, lamports, clocks, the install caption and shortcut chips. Tabular figures throughout.
- **Accent:** exactly one headline word per page in `.flare`, an amber to crimson gradient via `background-clip: text`, echoing the aurora behind it. Never a whole line.
- **Banned:** system-default stacks, serif in any data surface, all-caps stamping on every label.
- **Knowingly kept against the default ban:** Inter and Geist Mono are both flagged by the detector as overused. Both are pinned by the brief, and a user pin outranks the default. Recorded in section 7.

## 4. Component Stylings

* **Buttons (Keycap):** the one raised surface in a flat language. `#e6e6e6` fill, `#2f3031` ink, 8px radius, and a layered stack of a 2px black ring, a soft white outer glow, and inset top-white and bottom-dark highlights so it reads as a physical key. Presses down 1px on `:active` with the glow collapsing. Secondary is a ghost pill: transparent fill, thin ring, trailing arrow, exactly one per page.
* **Cards:** dark glass, 14px radius, 1px whisper border, top highlight, ground-tinted cast shadow. Hover lifts 2px and deepens the cast. No coloured stripe down any edge.
* **Inputs:** label above, hint below, 6px radius, sunk fill. Focus is a coral border plus a 3px coral halo, never a browser default outline.
* **Loaders:** `CardSkeleton`, shaped to the real card's room name, hash line, clock and book, with a single compositor-only background sweep. No circular spinners, and never a centred word of text: the layout must already be the right shape before the rollup answers.
* **Empty States:** composed and specific, each naming the next action. "No markets standing. Open one, the village is only interesting when somebody has something to lose."
* **Badges:** washed aurora tint plus matching ink, 999px. Semantic state only.
* **The redaction bar:** the signature graphic. Where a confession exists but may not be shown, the page draws its withheld shape under a neutral band. A released body carries a crimson band instead. This renders `Outcome::reveals_text()` and is not decoration.

## 5. Layout Principles

Grid-first. Content column caps at `1180px`; prose at 640px. The hero is centred
over the aurora rather than split left-text right-image. The market feed is
`repeat(auto-fill, minmax(310px, 1fr))`; detail pages are a `1.4fr / 1fr` split
collapsing to a single column at 900px. The nav is a floating translucent pill,
not a full-bleed bar, and drops to its own stacked rows below 1040px rather than
clipping a link. Viewport heights use `100dvh`, never `100vh`. No flexbox
percentage math anywhere.

## 6. Motion and Interaction

* **The aurora** is the signature: three blades drifting (translate plus a small rotate) and breathing (opacity plus scale) on staggered 15s, 18s and 22s loops. Every `0%` keyframe is full bloom, so any still frame is the richest frame.
* **Cascade:** cards rise 12px over 520ms on `cubic-bezier(0.16,1,0.3,1)`, staggered 50ms, capped at the fifth item so a long feed does not crawl in.
* **Countdown:** inside the final 20 seconds the clock goes crimson and breathes. This is the only sustained motion in the content, and the last seconds are the only moment in this product that earns one.
* **Keycap press:** 130ms, shadow stack collapsing under the finger.
* Transforms and opacity only. Nothing animates a box size, because that forces layout every frame.
* Everything above stops under `prefers-reduced-motion`, and the aurora holds its full-bloom frame rather than freezing mid-drift.

## 7. Anti-Patterns (Banned)

* No purple, indigo, violet, cyan or green. Anywhere. Ever.
* No second colour family for semantic state.
* No pure `#000000` and no pure `#ffffff` as a surface.
* No em-dashes or en-dashes anywhere a user can see. Currently zero.
* No neon outer glows, no glassmorphism outside the committed dark-glass token, no gradient text beyond one headline word.
* No side-tab accent borders on cards.
* No fake product UI built from divs. The lower half of the landing page is the real live market feed, not a mockup of one.
* No invented commercial claims. There is no "featured on" badge, because the product has not been featured anywhere.
* No scroll cues, no version labels in the hero, no section-number eyebrows.
* No emoji as iconography, no generic placeholder names, no AI copywriting clichés.
* No circular spinners, no unstyled framework defaults for 404 or errors.

**Deliberate deviations, kept knowingly rather than suppressed.** The detector
reports exactly three findings and all three are pinned by the brief: Inter,
Geist Mono, and the one-word gradient headline. Anything it flags that is *not*
in this list is a real defect and gets fixed.

## 8. Surfaces

Every route carries the system. No unstyled default anywhere.

| Route | Notes |
|---|---|
| `/` | Hero over the aurora, then the live market feed. |
| `/confess` | The nine-step walk as command-bar style result rows. |
| `/rooms` | Three live rooms, twenty-two enumerated and marked. |
| `/graveyard` | Released and withheld tombstones, side by side. |
| `/challenge` | Five probes with raw JSON-RPC replies. |
| `/market/[address]` | The book, the purse, the session, the rule at zero. |
| `/market/[address]/result` | The verdict as a full glass section. |
| `not-found.tsx` | 404. Replaces Next's unstyled default. |
| `error.tsx` | Route error boundary. Prints the real error verbatim. |

## 9. Verification

Measured, never assumed:

```bash
grep -ro "—\|–" app/src --include="*.tsx" --include="*.css" | wc -l   # must be 0
node ~/.claude/skills/impeccable/scripts/detect.mjs --json app/src     # only the 3 pinned
```

* WCAG AA on every text and ground pair, sampled from the live DOM with **alpha compositing**: a translucent wash must be flattened onto the ground before the ratio is taken, or every glass surface reports a false 1.00 and the check is worthless.
* No horizontal overflow at 375px or 1440px.
* Zero console errors on every one of the nine routes above, each opened rather than assumed.

## 10. Known gap

A locked visual reference could not be generated before implementation:
`generate-image.mjs` requires an `OPENAI_API_KEY` that is not set in this
environment, and no harness-native image tool is available. The brief served as
the reference instead and was specific to hex values and shadow stacks. If a key
is added later, generate the comp and check the built surface against it.
