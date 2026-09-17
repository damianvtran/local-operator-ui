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
the same story in a worktree at `6da8665ee` — the branch's merge base at the time
that half was shot, which this branch's later folds have moved past — in the
twelve palettes this app shipped: the other half of the pair.

## Why this surface, and why fifty-nine rather than the sweep's twelve

The registry goes from twelve palettes to fifty-nine, and the picker is the one
surface where that has to be *looked at*: it is where a user meets the new set
all at once. It also had no story until this change, and a surface with no story
is a surface no frame can show — the capture rig takes one frame per story per
theme, so a missing story is a missing subject rather than a missing theme.

`scripts/capture-evidence.mjs`'s own `THEMES` list deliberately stays at the
twelve this app shipped, because every story in that file is captured once per
theme: sweeping all fifty-nine would take the committed set from **4,925**
frames / **196 MB** on disk (`find docs/evidence -name '*.webp' | wc -l` and
`git ls-files 'docs/evidence/**/*.webp' | wc -l`, both 4,925 at this head;
`du -sh docs/evidence`), of which **4,184** stand outside the 64 declared
supplementary sets — which is the figure `manifest.json`'s own `frames` carries,
re-derived here rather than carried — to roughly **24,000** frames / **~950 MB**
— the 59/12 ratio the list itself implies. (The files' own bytes sum to 133.9
MiB, the smaller number `du` is not reporting.) So the picker is captured in the
whole registry here, once, and everything else keeps its twelve — with
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
| 800 | 460 | 2 | 30 | 226.0 | 2415px | 40.9px |
| 1000 | 660 | 3 | 20 | 214.7 | 1621px | 27.5px |
| 1020 | 680 | 4 | 16 | 164.0 | 1304px | 22.1px |
| 1040 | 528 | 3 | 20 | 170.7 | 1621px | 27.5px |
| 1300 | 788 | 4 | 16 | 191.0 | 1304px | 22.1px |
| 1380 | 868 | 5 | 13 | 167.2 | 1066px | 18.1px |

The 800 row is the app's declared minimum window (`WINDOW_MIN_WIDTH = 800`), so
the table covers the whole range the app renders in rather than stopping at
1000px (round 2, U3). It is the most expensive band there is: at a 460px column
the grid is 2 across and 30 rows deep, 2415px of scroll for the set, measured in
the story at a 508px viewport.

So the honest figure is 40.9px per theme at the app's 800px minimum, 27.5px at
1000px and 18.1px at 1380px against 92.1px for the twelve, and the 1040 band is
SPARSER than the 1020 band below it
because crossing 1040 expands the settings rail from 48px to 220px inside the
same window. A full five columns needs a window of about 1344px, which the app's
own default of 1380 clears by 36px. The "14px shorter" line above therefore holds
only at this 896px column, where the card grid and the tile grid are both at
their widest count; at the narrower bands the two are not comparable on that
axis, because they change column count at different widths.

`theme-selector.tsx`'s tile docblock carries the same two tables beside the code
that renders the grid, including the 800px band and the 1040 band as documented
properties of the page's rails and of the app's minimum window rather than
defects to tune away.

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

## Re-shot twice, and which re-shoot these frames are

The frames in the tree are the ROUND-1 re-shoot: committed in `18f13afac`
("re-capture the picker at this head") and taken at the tree `89da5eed2`, which is
the commit `manifest.json`'s `head` and `partialCapture.refreshedAtHead` both
name and whose cause `themePortCapture.reCaptureAtTheRebasedHead` records.
**All 59 after frames changed bytes on purpose** — the picture was meant to
move — and that is what the recording commit says: `git show --stat 18f13afac --
docs/evidence/settings-appearance/gallery` reports 59 files changed, 0
insertions, 0 deletions. Every frame carries a different selected tile at this
head, because round 1 moved the tile's ground off the bare `accentWash` onto
`accentWash` carrying 8% of `accent` (D1), moved the check out of the name row
onto the preview's corner (D2), and re-drew two of the light group's marks
(`tokyoNightDay`'s `MountainSnow`, `alucard`'s `Ghost`, D7).

The before half did not move with it: `git diff 89da5eed2 HEAD --
docs/evidence/settings-appearance-before` is empty, and it could not have —
those twelve frames render the merge base's own twelve-card `ThemeSelector`,
which this change does not touch.

The FIRST re-shoot is a different pass, and the byte-identity claim below belongs
to it rather than to the frames shipping here. At the head that fold named —
`manifest.json`'s `themePortCapture.reCaptureAtTheRebasedHead` is where that
citation lives, and the spelling it names is a pre-fold one this branch no longer
contains — both halves were re-taken rather than re-stamped, after the `highlight`
role landed in the palettes, and **all 71 frames came back byte-identical to
their earlier captures** (`shasum -a 256`, 59 + 12, no exceptions): the palette
values did not move when the role was authored, the miniature paints
`canvas`/`surface`/`elevated`/`sunken`/`ink`/`accent` and never `highlight`, and
the one upstream `src/` change in this story's path is four *added* lines in
`styles/index.css`. The value of that pass was therefore the record — `head`,
`srcTree` and `scriptsTree` in `manifest.json` named the tree those frames ship
in — and that is why the re-shoot below, where the bytes were supposed to move,
is documented the same way.

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
