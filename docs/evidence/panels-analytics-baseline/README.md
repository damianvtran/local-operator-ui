# `/analytics` before this branch, and the chart's own hover cursor

The BEFORE half of two changes on `feat/panels-cache-picker-hover`, taken from a
read-only worktree at `origin/main` (`f14a98d08`) at the same story, the same
state, the same entries and the same window size as the frames that stand in
`docs/evidence/panels-analytics/`. Read the two beside each other: the after half
is the swept set, this is the state it replaced.

| directory | story | what the pair shows |
| --- | --- | --- |
| `populated/` | `panels-analytics--populated` | Both tables WITHOUT the `Cache hit` column: `Provider / Calls / Tokens / Cost` is the whole header, and the cache rate exists only as the window-wide `Cache read` stat card above them. The after frame adds the column, read per row. |
| `populated-hover/` | `panels-analytics--populated-hover` | The pointer ON the first bar, under recharts' default cursor: a full-height rectangle over the category band, drawn over the marks, so what the pointer highlights is the COLUMN and the bar itself is greyed out under it. The after frame highlights the bar and leaves the band alone. |
| `populated-hover-shallow/` | `panels-analytics--populated-hover-shallow` | The same, with the first day carrying 60k against the same 1.9M peak — a bar a few pixels tall. Design review round 1 (D7) asked for it: a fill step has almost no area to read at that size, and `obsidian` and `monokai` are the two palettes where the answer is not obvious. |

## Themes

`localOperatorDark` (the app's own), plus the two the hover role is judged on:
**`obsidian`** (whose accent is its brightest value, so its whole ramp walks
downwards) and **`iceberg`** (light ground, so the hover step goes darker).
Three of twelve, because this set exists to make a colour comparison readable
rather than to be a swept pass; the after half of both changes is in the swept
set in all twelve.

What the after half uses is no longer `accent-hover` but `chart-bar-hover`, the
role added in design review round 1 (D1): `accent-hover` is the primary button's
own ramp step, and on obsidian's plot ground it moves TOWARD the ground, so the
bar the pointer was on receded (16.97:1 at rest, 13.96:1 hovered). Obsidian's
value is therefore not a lightness step at all — there is no headroom above
`#FAFAFA` — but a low-chroma step into the hue its own `warning` already owns,
which is why its frame in `panels-analytics/populated-hover/` is worth comparing
against this one.

## How these were taken

```sh
# A read-only worktree at origin/main, with only the two files the rig needs
# copied in - the story that adds the hover id, and the capture entry that names
# it (neither is a product change; both are this branch's own harness).
cd ../panels-cache-picker-before        # git worktree at f14a98d08
pnpm storybook --no-open --ci --port 6007
node scripts/capture-evidence.mjs http://localhost:6007 \
  --only=panels-analytics--populated \
  --themes=localOperatorDark,obsidian,iceberg --allow-backend
```

`--allow-backend` because the operator's own backend answers on `127.0.0.1:1111`
on this machine, and the rig refuses to capture over a live one by default. No
frame here draws anything from it: both stories pass their data as props, and the
sweep was run against a Storybook with no app shell attached.

## Why these are not simply `panels-analytics/`

They are a BEFORE, and `docs/evidence` holds one state per surface: committing
them under the swept name would make the directory ambiguous about which tree it
shows, and a later reader would have no way to tell the pre-change column from
the post-change one. They are declared in `manifest.json` as a supplementary set,
which is the same mechanism `ask-options-baseline` and `tool-rows-baseline` use,
and `check-evidence` counts them the same way.
