# The by-session table, before paging

The BEFORE half of the change that made every session in `/analytics` reachable:
the by-session table stopped being a bounded summary of the top twelve sessions
and became a paged table with sort, search and one filter. Read these beside
`docs/evidence/panels-analytics/` — the after half is the swept set, and each
directory here is the same story, the same fixture, the same viewport and the
same scroll position.

| directory | story | what the pair shows |
| --- | --- | --- |
| `populated/` | `panels-analytics--populated` | The section at rest on the five-session fixture: the table, its legend, and nothing above the table but the section's own heading. The after frame adds the control strip (search field, `Top-level only`, the match line) between the heading and the header row. |
| `populated-end/` | `panels-analytics--populated` | The same state, scrolled to the body's end. The before frame ends at the legend; the after frame ends at the legend plus the pager (`1–5 of 5 sessions`, `First`/`Prev`/`1 / 1`/`Next`/`Last`). Taken as a pair because the panel body is capped at `min(76vh, 760px)`, so no single frame holds both the strip and the pager. |
| `dense/` | `panels-analytics--dense` | The seventeen-session ledger at rest: the first twelve rows and no indication that more exist. |
| `dense-end/` | `panels-analytics--dense` | **The dead end this change removes.** The body's end on the same ledger reads `+5 more not shown` — twelve of seventeen rows with no way to reach the rest. The after frame reads `1–17 of 17 sessions` beside a working pager, which is the same fact stated as something the reader can act on. |

## Themes

All twelve, because the after half is a swept set and a pair is only readable
when both halves are the same palette.

## How these were taken

```sh
# A read-only worktree at this branch's base commit (647396910), whose
# node_modules is a symlink to the capturing worktree's.
cd ../analytics-before
pnpm storybook --no-open --ci --port 6027
node scripts/capture-evidence.mjs http://localhost:6027 \
  --only=panels-analytics--populated --allow-backend
node scripts/capture-evidence.mjs http://localhost:6027 \
  --only=panels-analytics--dense --allow-backend
```

`--allow-backend` because the operator's own backend answers on
`127.0.0.1:1111` on this machine and the rig refuses to capture over a live one
by default. No frame here draws anything from it: both stories pass their data
as props and the sweep ran against a Storybook with no app shell attached.

Two files in that worktree are NOT `main`'s: the rig's own `STORIES` entries for
the two `-end` surfaces, copied in so the before half is taken at the same
viewport and the same scroll position as the after half. Neither is product
code, and no product file was modified — the same shape
`settings-app-updates-and-info-baseline/` and `panels-analytics-baseline/` use.

A third frame set was taken the same way before any edit was made in the
capturing worktree, and came back byte-identical to the frames `main` ships for
`populated/`, which is the check that these pixels are still the base tree's.

## Why these are not simply `panels-analytics/`

They are a BEFORE, and `docs/evidence` holds one state per surface: committing
them under the swept name would make the directory ambiguous about which tree it
shows, and a later reader could not tell the `+5 more not shown` line from the
pager that replaced it. They are declared in `manifest.json` as a supplementary
set — the mechanism `panels-analytics-baseline/` and `tool-rows-baseline/`
already use — and `check-evidence` counts them the same way.

The nine NEW story surfaces (`session-paginated`, `session-page-two`,
`session-sorted-by-*`, `session-search-*`, `session-top-level-only`,
`session-scale-30-d`, `session-narrow-720`) deliberately have no directory here:
they are states this change creates, so a before frame of them would be a frame
of a story that did not exist.
