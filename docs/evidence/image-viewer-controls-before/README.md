# The viewer's chrome before the change — rendered by unmodified `origin/main`

The before half of `docs/evidence/image-viewer-controls/`, and the reading every
after-frame's claim is against: the overlay as the operator found it — no
controls but its close button — and a condensed strip whose tile press opened
one picture with no walk.

Two states, twelve themes, twenty-four frames:

| state | what it is | the question it answers |
| --- | --- | --- |
| `fit` | the overlay after a real press on the picture | the chrome the operator reported missing: picture, scrim and close button, and NOTHING else |
| `group-press` | a press on a condensed group strip's first tile | what a tile opened at the base: that one picture over the scrim, no filmstrip and no arrows, because the carousel does not exist |

The zoomed, panned and reset after states have no before frames OF THEIR OWN,
and this set does not pretend otherwise: zoom does not exist at the base, so
`fit` IS the before of all three. What the pair does prove, pixel for pixel at
the same viewport and theme set, is the absent chrome — the after README
measures the diff: 1,100 subpixels, all inside the cluster's own 86x20 box, and
no other pixel in the frame moved.

## The capture

```
# In a detached worktree of origin/main at 7a392ecf943 — this branch's base —
# with this branch's src/ changes absent:
#   ~/workspace/imgview-before-wt-1a215   (throwaway; node_modules symlinked
#   to the branch checkout's, no install run)
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm storybook --port 6191 --no-open

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6191 \
  --only=image-viewer-controls-before \
  --allow-backend
```

Two differences from the after set's recipe, both because the branch's own
story cannot compile here: the story copied into the base worktree is a TRIMMED
copy — the `Column`, the fixtures and the shutter latch kept, the group
descriptor and the controls parts gone because the components do not exist at
the base, and the latch waiting on `[role="dialog"] img` because the branch's
`data-image-viewport` frame marker does not — and the two tuples were added to
that worktree's own STORIES list (uncommitted there), which `--only` filters
against. The frames were then copied into this checkout unchanged, and the
manifest declares this set as supplementary so `clearSweptFrames` preserves
them and the sweep's own count stays honest — the arrangement
`chat-image-expand-before/` and the `*-baseline` sets already use.

A sweep captures the CURRENT tree, so it cannot produce these frames: they need
`origin/main`'s components under a story shaped for them.

## What the pair shows, and what a reader should take from it

- `fit` against the after `fit`: the same picture, the same 64px margins, the
  same scrim, the same close button — and the after frame's only additions are
  the three cluster glyphs measured in the after README. The controls were
  ADDED to this surface; nothing about the picture's fit moved.
- `group-press` against the after `carousel-open`: the same press, one state
  later — at the base the overlay holds ONE picture (the pressed tile's) with
  no filmstrip, no arrows and no position; after the change the same press
  opens the group with the strip at the bottom and the walk at both sides.
- The receipt is not staged here: the base strip's own third tile (the picture
  with no bytes) draws the base's receipt in the strip exactly as the after
  set's does — what differs between the halves is the chrome around the
  overlay, not the tile vocabulary, which the branch reuses rather than
  changes.

## What is NOT covered

- No base frame shows a zoomed or panned state, for the reason above: the
  controls do not exist, so there is no gesture to drive them with.
- No base frame shows the filmstrip, the arrows or the position announcement,
  for the same reason.
- The base story's column and fixtures differ from the after set's in the one
  way the portrait fixture was re-drawn (see the after README's capture note);
  the `group-press` frame's strip therefore shows the 2x6 portrait tile the
  after set's first attempt carried, and the pair's claim does not rest on tile
  2's content — it rests on the WALK's absence.
