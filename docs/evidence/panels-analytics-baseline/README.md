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

## Themes

`localOperatorDark` (the app's own), plus the two the hover role is judged on:
**`obsidian`** (accent near-white, `accent-hover` dimmer — the subtle end) and
**`iceberg`** (`accent-hover` darker than the accent). Three of twelve, because
this set exists to make a colour comparison readable rather than to be a swept
pass; the after half of both changes is in the swept set in all twelve.

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
