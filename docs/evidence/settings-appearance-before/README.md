# The appearance picker before the TUI theme port

Twelve frames of `settings-appearance--gallery` taken on this branch's merge base
`6da8665ee` (`origin/main` when the pair was last re-shot), in the twelve palettes
this app shipped — the *before* half of the pair whose *after* half is
`../settings-appearance/gallery/` (fifty-nine themes). 1000 x 1420 each, the same
viewport as the after frames, so the two are a like-for-like comparison rather
than two sets of measurements.

**Why the merge base and not the commit the port started from.** The base has
moved twice (`0c04cbb09` → `3f1f4e5a3` → `6da8665ee`), and a before half belongs
to the tree this branch would merge into: taken at `0c04cbb09` it would differ
from the after half by main's own work as well as by this change. Checked rather
than assumed — `settings-page.tsx`, `settings-section.tsx`, `theme-selector.tsx`,
`tooltip.tsx` and `ui-preferences-store.ts` are untouched upstream, so the 896px
column, the section markup and the tooltip this story renders have not moved.

Source, exactly:

```
git worktree add --detach /tmp/theme-before origin/main
ln -s <this worktree>/node_modules /tmp/theme-before/node_modules
cp src/renderer/src/features/settings/components/theme-selector.stories.tsx \
   /tmp/theme-before/src/renderer/src/features/settings/components/
# + the same STORIES tuple, locally, so the id was capturable; never committed
cd /tmp/theme-before && pnpm build-storybook
npx http-server storybook-static -p 6048 --silent
node scripts/capture-evidence.mjs http://localhost:6048 \
  --only=settings-appearance--gallery --allow-backend \
  --themes=localOperatorDark,localOperatorLight,dracula,dune,sage,monokai,tokyoNight,iceberg,radient,neon,obsidian,synth
```

**Re-shot at `6da8665ee`, and the result is the comparison:** all twelve frames
are byte-identical to the capture taken at `0c04cbb09` (`shasum -a 256`, 12 of
12), so the pair is the same pair — the earlier base was not distorting it — and
the record now names the tree these frames would be judged against.

The story file is additive and contains no part of the change, which is what
lets it be photographed on the base tree at all; the worktree was removed after
the run and the frames were copied in unchanged. `manifest.json` declares this
set under `supplementary` with that provenance, because a sweep cannot
regenerate it — a sweep captures the current tree, and these need the base
tree's own `ThemeSelector`.

## What the pair is for

The change is a density change, and a density change is exactly what a single
frame cannot show: fifty-nine small tiles look plausible on their own, and
nothing in one of them says the twelve were 277.3 x 253.6 cards on a 262px row
pitch. The measurements behind both halves, and what the after frames are and
are not evidence for, are in `../settings-appearance/README.md`.

The two sets are meant to differ in exactly one respect — the picker's
treatment — and to agree in the section around it: same title, same icon, same
description, same column, same viewport.
