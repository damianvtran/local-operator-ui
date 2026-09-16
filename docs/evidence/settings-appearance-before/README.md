# The appearance picker before the TUI theme port

Twelve frames of `settings-appearance--gallery` taken on this branch's base
commit `0c04cbb09`, in the twelve palettes this app shipped — the *before* half
of the pair whose *after* half is `../settings-appearance/gallery/` (fifty-nine
themes). 1000 x 1420 each, the same viewport as the after frames, so the two are
a like-for-like comparison rather than two sets of measurements.

Source, exactly:

```
git worktree add /tmp/theme-before 0c04cbb09
ln -s <this worktree>/node_modules /tmp/theme-before/node_modules
cp src/renderer/src/features/settings/components/theme-selector.stories.tsx \
   /tmp/theme-before/src/renderer/src/features/settings/components/
# + the same STORIES tuple, locally, so the id was capturable; never committed
cd /tmp/theme-before && pnpm build-storybook
npx http-server storybook-static -p 6032 --silent
node scripts/capture-evidence.mjs http://localhost:6032 \
  --only=settings-appearance--gallery \
  --themes=localOperatorDark,localOperatorLight,dracula,dune,sage,monokai,tokyoNight,iceberg,radient,neon,obsidian,synth \
  --allow-backend
```

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
