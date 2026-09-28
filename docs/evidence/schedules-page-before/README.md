# Schedules — the regenerated `before` half

The Schedules page as the **merge-base** (`8320e52366`) renders it, captured for
the pair whose `after` half is `docs/evidence/schedules-page/`. Same twenty-five
stories, same 1280x900 viewports, same twelve themes as the after half.

## Why this set exists

Design round 1's D1 (with the review's MINOR-1 in the same item): the schedules
before/after pair was cross-revision. Main's committed `schedules-page/` frames
predate the 0.29.8 palette rework (#402), so the pair read as
`git show <merge-base>:docs/evidence/schedules-page/...` against this branch's
frames moved on the canvas by up to 6.32 (obsidian) / 4.50 (localOperatorDark)
— larger than the change's own steps (2.6–2.9) — and invited reading a global
lightening onto this PR that shipped in #402. This set is the before half
**regenerated at the merge-base** rather than annotated: `8320e52366` already
carries the current palette, so the pair now compares a single revision.

## What produced these frames

A detached worktree at `8320e52366` (the merge-base, tree clean), the
repository's own rig on its own Storybook:

```
node scripts/capture-evidence.mjs http://localhost:6191 \
  --only=schedules-page \
  --themes=localOperatorDark,localOperatorLight,dracula,dune,sage,monokai,tokyoNight,iceberg,radient,neon,obsidian,synth \
  --allow-backend --theme-settle-ms=60000
```

`--allow-backend` is passed because the operator's live daemon answers on :1111
and must not be stopped for a capture; every `schedules-page` story is a static
fixture that never contacts it. The story file and fixtures are byte-identical
between the two revisions — `git diff 8320e52366..2ace804bc0 --
src/renderer/src/features/schedules` names only `schedules-page.tsx`, the change
under test — so the pair differs by exactly the change.

## Reading the pair

`schedules-page-before/<story>/<theme>.webp` is the before of
`schedules-page/<story>/<theme>.webp` — one file per story and theme, no
renames, no states added or dropped. Measured after regeneration (CIEDE2000
over 64x45 mean blocks; 90 of the 300 pairs are byte-identical, the change
being localized):

| | stale half (committed at the merge-base) vs after | regenerated half vs after |
| --- | --- | --- |
| canvas corner, all twelve themes | up to 6.32 (`obsidian`); 4.50 on `localOperatorDark` | **0.00 on every theme** |
| whole set, 300 pairs | median block-mean 2.228, max 6.195 | median 0.072, max 0.353 |
| `picker-open/obsidian` (nothing the change touches) | 2879/2880 blocks above ΔE00 1 | **0/2880** |
| `list/localOperatorDark`, moving blocks | 3.5–6.3 (palette + change mixed) | 2.2–2.8, on the panel and rows |

What remains in the regenerated pair is the change itself, at its own scale; the
palette-scale shift the old pairing carried is gone.

## Why it is a declared set

A sweep photographs the current tree and cannot reproduce a capture of the
merge-base's source, so a full sweep must not delete this set: it is declared in
`docs/evidence/manifest.json`'s `supplementary` list (which is what
`clearSweptFrames` preserves), and the swept count stays honest because declared
frames are excluded from it by construction.
