# The composer band's suggestion row and tip line

The empty-chat band before and after: seven centred bordered chips of a generic
assistant's errands, and four borderless ones of this product's own requests with
one ambient tip line under the composer box.

These frames come from `scripts/capture-evidence.mjs` driving Storybook, which is
the committed and re-derivable route. The exact commands that wrote them:

```
pnpm storybook --port 6027 --no-open        # 6027 was free; 6017/6018 were not
node scripts/capture-evidence.mjs http://localhost:6027 \
  --only=chat-composer-band \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--themes` is the two brand palettes, which is `branding.md` § 9.9's minimum, and
the light pass is where contrast defects hide. The tree is `de520422c` (the
implementation commit); `manifest.json`'s `srcTree`/`scriptsTree` and
`partialCapture` carry it, as they do for every frame here.

## Which tip the frames show

**`the chat list search finds sessions from months ago`** — `COMPOSER_TIPS[0]`, the
pinned opening entry — in all six after frames and in none of the before frames
(there was no tip row before). The pin is the mechanism
(`composer-tips.ts`: the ring opens on `pool[0]` and only the frames behind it are
shuffled), and it is what makes a committed capture of a rotating row reproducible
at all: every frame here is a fresh page load, and the first tick is 12 s away.

The rig prints the rendered sentence beside the geometry
(`tip showing "…"`) for exactly this reason, so a reader checks the claim against
the run rather than against this paragraph.

## The before frames

The `before/` set is **the same stories at the same viewports through the same
instrument**, captured with the three production files restored to `origin/main`:

```
mkdir -p /tmp/after-band && cp -R docs/evidence/chat-composer-band/. /tmp/after-band/
git restore --source=origin/main --worktree -- \
  src/renderer/src/features/chat/components/chat-content.tsx \
  src/renderer/src/features/chat/components/message-input.tsx \
  src/renderer/src/features/chat/components/measured-suggestion-stack.tsx
# capture, then move the six leaf directories under before/
git restore --worktree -- src/renderer/src/features/chat/components/{chat-content,message-input,measured-suggestion-stack}.tsx
cp -R /tmp/after-band/* docs/evidence/chat-composer-band/
```

So the pair isolates the TREATMENT and holds the copy constant: the story passes
the same eight-label pool on both sides, and `origin/main`'s composer draws seven
of it (`MAX_SUGGESTIONS = 7`) where the branch draws four. Two consequences of
that are worth stating rather than leaving to be discovered on the frames:

- the before frames show a **random** seven of the eight, because the old sampler
  was `sort(() => Math.random() - 0.5)`; the `empty-chat` frame shows "Set up the
  mobile relay and tunnel", "Schedule a task that runs every morning", "Set up the
  Linear MCP server for me", "Review this repo and open a pull request", "Create a
  team of agents", "Wake me tomorrow morning with a summary" and "Create a new
  agent" (the missing one is "Show me what the agent did last turn");
- the before frames are not a picture of the pool that shipped before this branch
  (trending stocks, MNIST, space invaders). Those 25 labels are in the
  pre-change app, and the committed sets that photographed them are
  `docs/evidence/draft-splash-browser/` at `8f764cb83` and
  `docs/evidence/chat-shell-empty-centre/`. This set's before is about the
  PRESENTATION, which is the half a frame can judge.

These are declared in `manifest.json` as a supplementary set, because they are not
a sweep of this head's `src`: their provenance is the command above.

## What each frame is, and what it proves

| Frame (`<theme>.webp`) | What it shows |
| --- | --- |
| `empty-chat/` | The operator's ask: the pinned opening four borderless chips on one row, the tip row under the box, all left-aligned on the composer's own edge. `before/empty-chat/` is the same band with seven centred outlined chips in three rows and no tip row. |
| `column-floor/` | The band at **550px**, the narrowest column the prompt renders in at all (an 830px window with the canvas open). The four chips take two rows; the tip sentence still fits untruncated. This is the frame prediction 2 is about. |
| `small-view/` | One step below that column: greeting, tip row and chips are **all** gone, because the gate is the column and not the tip's own length. A frame showing the tip at a width the app drops it at would be a claim the product does not make. |
| `long-labels/` | The pool's longest four labels at a 620px column — the worst wrap a later sample can draw. `composer-suggestions.ts` returns a pool no larger than the sample whole and in order, so this is a draw the sampler really can produce rather than strings invented to overflow. |
| `draft-held/` | The same band with a draft in the box. The clock is suspended there and the ROW STAYS PAINTED — a still cannot show a clock, so what this frame proves is its own precondition: the row is on screen, at its usual place, with text in the composer beside it and the send control lit. |
| `reduced-motion/` | `empty-chat` with `prefers-reduced-motion: reduce` **emulated by the rig** (`{ reducedMotion: true }`), which is the only honest way to photograph this state: the app's own cap is a media block. Measured against `empty-chat`, the two frames differ by more than 5% in **9 px** (dark) and **3 px** (light) below the story label, and by 2004/2083 px **within** it — i.e. the whole difference is the label's own text, by design. The tip holds one entry instead of rotating. |

## The numbers the frames are measured at

Read from the live DOM of these stories by `scripts/composer-band-geometry.mjs`, in
the same viewports, so a number here and a frame there describe one layout:

```
node scripts/composer-band-geometry.mjs http://localhost:6027
```

| | `empty-chat` 1380x872 | `column-floor` 830x572 | design § 7 prediction |
| --- | --- | --- | --- |
| Composer box | 900px wide, 112px tall | 502px wide | 648px at 1024 (before) |
| Chip box height | **27.5px** | **27.5px** | 27.5 (29.5 − 2px of border) — **confirmed** |
| Chip row pitch | 1 row | **35.5px** (tops 376.7 / 412.2) | 35.5 — **confirmed** |
| Chips / rows | 4 / **1** | 4 / **2** | prediction 1: one row at the 900 measure — **confirmed** |
| Stack height | **27.5px** | **63px** | 27.5 (one row) and 63 (2 rows) — **confirmed** |
| Tip row | **20px** tall, `mt-3` above, `mt-6` below | 20px tall | +32px to the band — **confirmed** |
| Left edges | composer 240 = tip 240 = first chip 240 | 164 / 164 / 164 | one edge — **confirmed** |
| Cap | `binds=false` (`inline max-height: null`) | `binds=false`, allowance 263.6px for a 63px stack | prediction 2 — **confirmed** |
| Tip sentence | `pool[0]` 311.3px, `clipped=false` | 311.3px, `clipped=false` | — |

The band's whole prompt — greeting, box, tip and chips — measures **313px** at the
column floor (277.5px at 1380). The design's own arithmetic put the same band at
≈444px in the app's 468px pane, against the 528.5px the seven-chip version
occupied, so the cap has room it did not have; and the rig reports the applied
`max-height` is `null` on every story measured, which is the direct answer to
prediction 2 rather than an inference from the copy's length.

**The row is present for the whole pool or not at all, and the pool fits.** A still
shows one entry, so the rig measures every entry in the row's own element (a clone
of the real span, same classes and font, removed in the same tick): the longest is
`ask for the mobile relay to drive this session from your phone` at **369px**
against **484px** available at the narrowest column that renders the row — 115px of
slack, and `clipped=false` for all ten. That is the number § 8 asked to check, and
it is the reason the row can be a width threshold rather than a per-entry test.

**The chip has no boundary left to measure.** At rest it draws no fill and no
border, so its box has no edge to read from a frame; the 27.5px above is
`getBoundingClientRect` on the control itself. That is also why the contrast
contract pins it at the CALL SITE rather than in `CONTROLS` — see
`scripts/contrast-contract.mjs`, the `the empty-chat suggestion chip is borderless`
entry, whose `why` states it.

## What this set does NOT prove

- **Not the live app.** These are the production `MessageInput` in a column of a
  chosen width inside Storybook. The app's band sits below a header and beside the
  canvas and run panes; the geometry that depends on the real column is the live
  app's to show, and QA's pass is where it belongs.
- **No hover, focus or pressed state.** The chips' `hover:bg-elevated hover:text-ink`
  step and the focus ring appear in no frame here. The pair is the same pair the
  attach button uses and the contract's `ask option button (hover)` row already
  asserts; the `PERCEPTIBLE` row added with this change measures the ground step
  (worst ΔE00 4.21) rather than photographing it.
- **Not the rotation over time.** Every frame is a fresh mount, so all six show the
  opening entry. That the row turns at 12 s, that it does not repeat an entry
  across the wrap, and that a draft suspends it are unit claims in
  `scripts/composer-suggestions.test.mjs` plus the `draft-held` frame's
  precondition — not something a still can carry.
- **No interaction of any kind.** No chip was clicked and nothing was typed: the
  draft in `draft-held` is written to the composer's own store, the way the app
  writes it, because there is no `draft` prop to pass.
