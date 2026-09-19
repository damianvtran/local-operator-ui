# The parity pair — the panel at rest, before and after the split

The claim this pair carries is the design's S12/A1: **with no stored values, the
panel is today's panel.** The split adds a boundary, two collapse controls and an
order control to the panel's column, and the measure of success the operator set
was "I like the current layout and don't want to make it feel more cluttered" —
so the check is not that nothing was added but that nothing MOVED.

## What produced these frames

The same already-committed story on both sides, one run each, in one window:

```
# before — a detached worktree of unmodified `origin/main` at `db615bd46`,
# with the shared dependency tree linked in and its own Storybook build
cd <worktree>/.worktrees/sidebar-sections-base
pnpm build-storybook && npx http-server storybook-static -p 6018 --silent
node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=chat-sidebar-status-feed --dirs=completion-in-place \
  --themes=localOperatorDark,localOperatorLight --allow-backend
# its frames are `before/` below, moved here under their theme names

# after — the same command against this branch, frames copied to `after/`
```

`chat-sidebar-status-feed--completion-in-place` (780x660) is the story, and it
was chosen because it is the one the design names that exists on BOTH trees:
it draws both regions with real content at rest, and neither this change nor any
other in flight rewrites it. The new `chat-sidebar-sections` story cannot supply
its own "before" — it does not exist at the merge base.

## The result, as a measurement

**The two halves are byte-identical, in both palettes.** `cmp` reports no
difference for `before/localOperatorDark.webp` against `after/localOperatorDark.webp`
(39,170 bytes each) or for the light pair (39,570 bytes each), and ImageMagick's
`compare -metric AE` reports **0** differing pixels for both. That is the
strongest form the claim can take: not "the frames look the same" but "the two
trees paint the same bytes", which is what "no committed sidebar frame goes
stale" means.

`pnpm check-evidence` is what re-derives that these are pictures of the trees the
manifest names; the numbers are in its `countsMean` and this directory's
`supplementary` entry.

## Why the pair was taken FRESH rather than against the committed frames

The after half of this pair is NOT the committed
`docs/evidence/chat-sidebar-status-feed/completion-in-place/` frame, and the
reason is a measurement rather than a preference. A fresh capture of that story
on UNMODIFIED `main` — the `before/` half here — does not reproduce the committed
file: 26,646 of 514,800 pixels differ (5.2% of the frame, RMSE 2.6%), and the
difference is spread across the whole frame rather than sitting on one element.

It is RASTERIZATION, not layout, and that is checked rather than assumed: the two
frames' rows, columns, rules and glyph positions are identical, and the
difference is the weight of the text — a crop of the same region from both shows
the same rows in the same places with heavier antialiasing on the newer capture.
So the committed frames of that story are stale against today's rig by an
environment difference that has nothing to do with this change, and diffing a
fresh after-frame against them would report 5.2% of pixels as "this change" when
this change is exactly zero of them. Both halves were therefore taken in the same
pass, on the same machine, with the same rig version — which is the only way the
number 0 means anything.

This is recorded because a later reader WILL re-capture that story while chasing
a red `pnpm check-evidence` and find the same drift; it pre-dates this branch.

**Nothing in `docs/evidence/chat-sidebar-status-feed/` was changed by this
branch.** The two frames this pass re-took there were restored to their committed
bytes (`git checkout`), because a re-capture that moves 5.2% of a surface's
pixels for an environment reason is a change nobody asked for and every later
diff would have to explain.

## What this pair does NOT prove

- **Not the drag, the reveal or the restart** — those are the driver's claims
  (`--scene sidebar-split`) and the live-app set's.
- **Not the collapsed states.** A collapsed column is a different layout by
  definition; its evidence is the `chat-sidebar-sections/` set.
- **Not the eleven palettes it does not carry.** Two, as the brief requires as a
  minimum; both halves use the same two, which is what makes the comparison
  valid.
