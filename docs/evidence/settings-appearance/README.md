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
theme: sweeping all fifty-nine would take the committed set from **4,851**
frames / **195 MB** on disk (`git ls-files 'docs/evidence/**/*.webp' | wc -l`;
`du -sh docs/evidence`), of which **4,110** stand outside the declared
supplementary sets, to roughly **24,000** frames / **~950 MB** — the 59/12 ratio
the list itself implies. So the picker is captured in the whole registry here,
once, and everything else keeps its twelve — with
`pnpm check-themes` asserting every contrast floor over all fifty-nine palettes
regardless, since it reads the palette directory rather than that list.

## The geometry the frames are evidence for

Read from the live DOM of these stories (`getBoundingClientRect`), at 1000px
viewport, which is the 896px column the story's own `max-w-4xl` frame gives it:

| | before (12 themes, card grid) | after (59 themes, tile grid) |
|---|---|---|
| columns | 3 | 5 |
| tile | 277.3 x 253.6 | 163.2 x 71.4 |
| row pitch | 262px | 80px |
| picker height | 1105.2px | 1090.9px |
| **height per theme** | **92.1px** | **18.5px** |
| section height | 1167.1px | 1152.8px |

This is the STORY's column and not the app's, and that matters more than it
looks (UX round 1, U1). The story renders the section alone, with no rails, and
`max-w-4xl` is a maximum, so at every window width it shows the 5-column band.
In the app the grid's column is set by the two rails around it, so the per-theme
cost is a band. Measured in the app at each window width (868px of viewport
height in every case):

| window | grid column | columns | rows | tile w | grid span | per theme |
|---|---|---|---|---|---|---|
| 1000 | 660 | 3 | 20 | 214.7 | 1621px | 27.5px |
| 1020 | 680 | 4 | 16 | 164.0 | 1304px | 22.1px |
| 1040 | 528 | 3 | 20 | 170.7 | 1621px | 27.5px |
| 1300 | 788 | 4 | 16 | 191.0 | 1304px | 22.1px |
| 1380 | 868 | 5 | 13 | 167.2 | 1066px | 18.1px |

So the honest figure is 27.5px per theme at 1000px and 18.1px at 1380px against
92.1px for the twelve, and the 1040 band is SPARSER than the 1020 band below it
because crossing 1040 expands the settings rail from 48px to 220px inside the
same window. A full five columns needs a window of about 1344px, which the app's
own default of 1380 clears by 36px. The "14px shorter" line above therefore holds
only at this 896px column, where the card grid and the tile grid are both at
their widest count; at the narrower bands the two are not comparable on that
axis, because they change column count at different widths.

`theme-selector.tsx`'s tile docblock carries the same two tables beside the code
that renders the grid, including the 1040 band as a documented property of the
page's rails rather than a defect to tune away.

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

The bundle this round shot from is **not** left in place: the box was short of
both disk and memory, and a stale `storybook-static` is what round 1's own
re-capture had to work around, so the directory and the static server that
matched it (`npx http-server storybook-static -p 6047 --silent`) were torn down
after the re-shoot. The committed frames above are the artifact; to re-shoot one,
rebuild and serve again:

```
pnpm build-storybook
npx http-server storybook-static -p 6047 --silent
node scripts/capture-evidence.mjs http://localhost:6047 \
  --only=settings-appearance--gallery --themes=<the ThemeName ids to re-shoot> --allow-backend
```
