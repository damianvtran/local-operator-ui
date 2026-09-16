# The appearance picker, in all fifty-nine themes

Fifty-nine frames of `settings-appearance--gallery` — the settings page's
Appearance section, rendering the shipped `ThemeSelector` — one per theme in the
registry. 1000 x 1420 each, from `scripts/capture-evidence.mjs`.

Source, exactly:

```
pnpm build-storybook
npx http-server storybook-static -p 6047 --silent
node scripts/capture-evidence.mjs http://localhost:6047 \
  --only=settings-appearance--gallery --themes=<all 59 ThemeName ids> --allow-backend
```

Those two commands reproduce this set exactly, and a full sweep is neither
needed nor was one run: `--only` limits the run to this one story, and under
`--only`, `--themes=` accepts any id in the registry, so one theme re-shoots in
about four seconds and all fifty-nine in about four minutes. (Port 6031 is
another worktree's server, which is why this one uses 6047.)

`--only` puts the run in append mode, so this set was added beside the committed
one instead of sweeping it; `manifest.json`'s `partialCapture` and
`themePortCapture` record that, and `themes`/`surfaces`/`frames` in the same file
are the full-set values. The companion set `../settings-appearance-before/` is
the same story on this branch's merge base (`6da8665ee`), in the twelve palettes
this app shipped — the other half of the pair.

## Why this surface, and why fifty-nine rather than the sweep's twelve

The registry goes from twelve palettes to fifty-nine, and the picker is the one
surface where that has to be *looked at*: it is where a user meets the new set
all at once. It also had no story until this change, and a surface with no story
is a surface no frame can show — the capture rig takes one frame per story per
theme, so a missing story is a missing subject rather than a missing theme.

`scripts/capture-evidence.mjs`'s own `THEMES` list deliberately stays at the
twelve this app shipped, because every story in that file is captured once per
theme: sweeping all fifty-nine would take the committed set from 4,703 frames /
192 MB to roughly 23,000 frames / ~950 MB. So the picker is captured in the whole
registry here, once, and everything else keeps its twelve — with
`pnpm check-themes` asserting every contrast floor over all fifty-nine palettes
regardless, since it reads the palette directory rather than that list.

## The geometry the frames are evidence for

Read from the live DOM of these stories (`getBoundingClientRect`), at the
settings page's own 896px column, 1000px viewport:

| | before (12 themes, card grid) | after (59 themes, tile grid) |
|---|---|---|
| columns | 3 | 5 |
| tile | 277.3 x 253.6 | 163.2 x 71.4 |
| row pitch | 262px | 80px |
| picker height | 1105.2px | 1090.9px |
| **height per theme** | **92.1px** | **18.5px** |
| section height | 1167.1px | 1152.8px |

So the fifty-nine-theme picker is 14px **shorter** than the twelve-theme one it
replaces, and the marginal cost of a palette falls 92.1px -> 18.5px. A
fifty-nine-card picker at the old treatment would have been a 5,400px scroll.

## What these frames ARE, and what they are NOT

They are the real subtrees: the shipped `SettingsSection` + `ThemeSelector`, the
real registry, and the real `useUiPreferencesStore` — the theme frame in
`.storybook/preview.tsx` drives the same store from the story's `theme` arg, so
each frame shows that theme's tile selected, with its own wash, accent frame and
check. There is no fixture in this story to drift from the product.

They are NOT a contrast measurement. Every floor the palette set has to clear is
asserted by `pnpm check-themes` over all fifty-nine palettes, and a frame cannot
measure a ratio. What a frame answers here is the reading question — whether
fifty-nine palettes read as a set you can take in at a glance, with the light
group and the dark group each contiguous, and whether a tile is still legible
as a picture of a window at 40px tall.

They are also not the sweep. Only the picker's twelve themes are painted on every
other surface in this directory; the other forty-seven appear in this set alone.

## Re-shot at the rebased head, and what changed

These frames were taken again at `d84d71f7d` (the rebased head, after the
`highlight` role landed in the palettes) rather than re-stamped, and the before
half was taken again at the merge base. **All 71 frames came back byte-identical
to their earlier captures** (`shasum -a 256`, 59 + 12, no exceptions): the
palette values did not move when the role was authored, the miniature paints
`canvas`/`surface`/`elevated`/`sunken`/`ink`/`accent` and never `highlight`, and
the one upstream `src/` change in this story's path is four *added* lines in
`styles/index.css`. The re-shoot's value is therefore the record — `head`,
`srcTree` and `scriptsTree` in `manifest.json` now name the tree these frames
ship in — and the "did the picture move" question is answered by comparing bytes
rather than by asserting it.

The built bundle is left in place for the review rounds:
`<worktree>/storybook-static`, served on `http://localhost:6047` by a detached
`npx http-server storybook-static -p 6047 --silent` run from that worktree.
