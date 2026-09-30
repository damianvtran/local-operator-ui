# The projects tab before the team header register (#703)

Sixteen frames, eight states, the two brand themes: the SAME stories the
`../projects-tab/` after set carries, photographed against the four files
`origin/main` (`20ccfd4512`) ships under
`src/renderer/src/features/projects/components/` (`project-list.tsx`,
`project-timeline.tsx`, `project-board.tsx`, `projects.stories.tsx`).

```
populated/           the List at rest - three sections, three rows
many/                the List under a scrollbar - twelve rows over three sections
list-teams-sticky/   the List mid-scroll - the second header pinned under its rows
team-header-hover/   the pointer ON the "platform" section header
project-row-hover/   the pointer ON the "payments-migration" row beside it
timeline/            the Timeline at rest
timeline-overdue/    the Timeline with a passed target
board-sticky/        the Board with its second band header pinned under the column row
```

(`timeline-no-dates` has no team header on either side - it draws the honest
empty axis - so it is not re-shot and has no lane here.)

## Why this set exists

The report is a register problem, and a register only reads as a difference
between two frames: on `main` the header is `text-meta`, name in `ink`, count in
`ink-muted`, on `canvas` - one type step under a row's `text-body-sm ink` name,
flush with it, with no rule and no heading. A row beside it steps to `elevated`
under the pointer and the header does not, which is the asymmetry the reporter
read as broken. `team-header-hover` and `project-row-hover` are that pair.

| comparison | measurement |
| --- | --- |
| `team-header-hover` vs `populated`, same tree | **0 differing pixels, both themes** on both halves - the header has no hover on `main` either; the reporter's asymmetry was never a bug in the hover, it was a header that looked like a row |
| `populated` before vs after | **71,164** dark / **50,900** light pixels differ - the section labels, the rules under them, and the rows they push down by the header's new 32px height |
| `many` before vs after | **243,149** dark / **170,159** light |
| `list-teams-sticky` before vs after | **141,016** dark / **109,902** light |
| `timeline` before vs after | **66,873** dark / **47,218** light |
| `timeline-overdue` before vs after | **28,492** dark / **22,199** light |
| `board-sticky` before vs after | **46,323** dark / **20,066** light - the band header only: the column row (44px) and the pinned offset are unchanged, and the story's own play asserts both |

The counts are exact-RGB differences over the whole 1280-wide frame
(`sharp`, no tolerance), so any sub-pixel reflow of a row counts; they say how
much moved, and the frames say what.

## How it was taken

1. The change was committed first, so the rig, the stories and the harness are the
   tree under review; only the four files above differ between the two runs.
2. In that checkout the four files were replaced with
   `git checkout 20ccfd4512 -- <the four paths>` - a working-tree edit that was
   never committed and was restored (`git checkout HEAD -- <paths>`) before the
   commit that carries these frames. `origin/main` at that commit has no
   `assertTeamHeaderRegister` in the stories and no `team-section-header.tsx`.
3. Storybook from this worktree, on a port no other tree held, then narrowed runs:

   ```sh
   node_modules/.bin/storybook dev --port 6732 --ci --no-open
   node scripts/capture-evidence.mjs http://127.0.0.1:6732 \
     --only=projects-tab--<story> --themes=localOperatorDark,localOperatorLight --allow-backend
   ```

   `--allow-backend` because this machine has a backend listening on the app's
   configured port and the rig refuses to sweep while one does; the frames come
   from fixtures and reach it for nothing. The rig ran from the changed tree, so
   the two hover entries exist on this side too.
4. The frames the rig wrote into `../projects-tab/` were moved here, and the
   after frames were re-captured into that set from the fixed tree in the full
   twelve-theme sweep.

**Two brand themes, not twelve.** The claim is a register - size, case, ink and a
rule - and the twelve-theme sweep belongs to the after set a design round judges
for contrast; every before frame is the same theme as the after frame it is
compared against, so each comparison is like for like.

These are **supplementary** frames in `../manifest.json`'s sense: a sweep cannot
re-derive them, because a sweep captures the current tree and the current tree
has the new register. `clearSweptFrames` therefore preserves them, and the swept
count excludes them.
