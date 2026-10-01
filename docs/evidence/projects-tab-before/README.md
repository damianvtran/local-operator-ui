# The List band before the reshaped register (#703)

Ten frames, five states, the two brand themes: the SAME stories the
`../projects-tab/` after set carries, photographed against the files `origin/main`
(`69d088ec52`) ships for the LIST - `project-list.tsx`, whose band is `bg-canvas`,
and `projects.stories.tsx`. `team-section-header.tsx` does not exist on `main`,
and the Timeline's and the Board's own bands are not part of this set at all: the
division is LIST-ONLY by operator direction, and both of those views ship exactly
what `main` ships on both sides of this change.

BOTH HALVES NOW PRINT MAIN'S RESOLVED TEAM NAMES. Main's #716 resolves the
band's text through the roster (`platform` -> `Platform Delivery`, `atlas` -> `Atlas
Payments`), and the after half takes that same resolver through `teamLabelFor`, so
the pair isolates the ONE thing this branch changes about the band - its ground -
rather than mixing it with main's rename. Read the two `populated` frames side by
side and the labels are identical and the ground is what moves.

```
populated/           the List at rest - three sections, three rows
many/                the List under a scrollbar - twelve rows over three sections
list-teams-sticky/   the List mid-scroll - the second header pinned under its rows
team-header-hover/   the pointer ON the section band (`platform`'s, printed as its
                     catalogue label `Platform Delivery`)
project-row-hover/   the pointer ON the `payments-migration` row beside it
```

## Why this set exists

The change is a lightness step, and a step only reads as a difference between two
frames. On `main` the band's ground is `bg-canvas` - **the same role as the rows'
own ground** - so its measured separation from a row is dL\* 0.00 / dE00 0.00: a
bare text line with no division at all, which is what the report was about. The
after half is the same band one rung up the ladder, `bg-surface`, borderless.

| comparison | measurement |
| --- | --- |
| `team-header-hover` vs `populated`, **before** tree, both themes | **0 differing pixels** - the band has no hover on `main`, which is where the reporter's asymmetry came from. THE INSTRUMENT IS LIVE IN THE SAME RUN: `project-row-hover` vs `populated` differs by **59,374** dark / **59,512** light pixels, so the 0 is the band's non-reaction rather than a pointer that never landed |
| `team-header-hover` vs `populated`, **after** tree, both themes | **0 differing pixels** - and it still has none: the band is a label, not an action. The same positive control holds on the changed tree - the row pair moves **66,673** dark / **60,016** light pixels - so the 0 is measured, not assumed |
| `populated` before vs after | **187,484** dark / **183,094** light pixels differ |
| `many` before vs after | **351,354** dark / **299,457** light |
| `list-teams-sticky` before vs after | **222,308** dark / **195,076** light |

The counts are exact-RGB differences over the whole frame (`sharp`, no tolerance),
so any sub-pixel reflow of a row counts; they say how much moved, and the frames
say what. Most of the moved pixels are the rows the band's `h-8` box shifts - the
band itself is one role's fill across the rows' own inset (x=24..1256 at the
1280px frame), and the row hairlines and pitch below it are `main`'s.

## How it was taken

1. The change was committed first, so the rig, the stories and the harness are
   the tree under review; only the two files above differ between the two runs.
   RE-TAKEN after the fold onto `origin/main` = `69d088ec52`, which is the tree the
   before half now photographs: the band's TEXT moved on both sides with main's
   #716 (the labels above), so the older frames no longer described either half.
2. In that checkout those files were replaced with
   `git checkout origin/main -- src/renderer/src/features/projects/components/project-list.tsx
   src/renderer/src/features/projects/components/projects.stories.tsx` - a
   working-tree edit that was never committed and was restored
   (`git checkout HEAD -- <paths>`) before the commit that carries these frames.
   `team-section-header.tsx` is absent on that tree, exactly as on `main`.
3. Storybook from this worktree, on a port no other tree held, then narrowed runs:

   ```sh
   node_modules/.bin/storybook dev --port 6757 --ci --no-open
   node scripts/capture-evidence.mjs http://127.0.0.1:6757 \
     --only=projects-tab--<story> --themes=localOperatorDark,localOperatorLight \
     --allow-backend --theme-settle-ms=180000
   ```

   `--allow-backend` because this machine has a backend listening on the app's
   configured port and the rig refuses to run while one does; the frames come from
   fixtures and reach it for nothing. `--theme-settle-ms` because the host runs
   ~25 sessions and the shipped 10 s budget is 3-7x short of what the palette
   decorator needs under that load (the rig's own constant documents the
   measurement).
4. The frames the rig wrote into `../projects-tab/` were moved here, and the after
   frames were re-captured into that set - the List lanes only, twelve themes -
   from the reshaped tree.

**Two brand themes, not twelve.** The claim is a lightness step and its division,
and the twelve-theme sweep belongs to the after set a design round judges for
contrast; every before frame is the same theme as the after frame it is compared
against, so each comparison is like for like.

These are **supplementary** frames in `../manifest.json`'s sense: a sweep cannot
re-derive them, because a sweep captures the current tree and the current tree has
the new band. `clearSweptFrames` therefore preserves them, and the swept count
excludes them.
