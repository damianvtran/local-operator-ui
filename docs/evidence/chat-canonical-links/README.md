# Chat link affordances: the transcript's detected links, in twelve themes

Sixteen states × twelve themes = **192 frames**, of the canonical transcript's link
affordances: a path the agent wrote, rendered as a link you can press, the toolbar
a hover raises on it, and what happens to a highlight that starts inside it. The
set's own entry in `docs/evidence/manifest.json` carries the same arithmetic
(`frames`, `surfaces`, `themes`), and that file is the number a reader should trust
over any sentence here.

## Why this set exists

The change's claim is visual: a path that used to be dead text is now an anchor
with an underline register, a hover strip 8px above it, and a per-kind matrix of
actions. A screenshot cannot settle WHICH tokens become links (that is
`scripts/link-targets.test.mjs`), whether a press routes to the OS (that is QA's,
in the PR thread) or where the strip lands when its subject changes under it (that
is a claim about a gesture, and the rig asserts it — see *Claims* below). What the
frames ARE for is the part only pixels carry: the twelve palettes, the two
registers of link, the strip's own hover and pressed states, and the two spanning
highlights, one frame each.

## Method

```sh
cd ~/local-operator-ui-worktrees/chat-link-affordances
env -u CMUX_* -u LOP_* HOME=/tmp/lo311-ev/home \
    node_modules/.bin/storybook dev -p 6017 --no-open --quiet
node scripts/capture-evidence.mjs --only=chat-canonical-links --allow-backend
```

The rig is the repository's own (`scripts/capture-evidence.mjs`): a private
headless Chromium over raw CDP, a fresh `--user-data-dir` under `/tmp`, real
`Input.dispatchMouseEvent`/`dispatchKeyEvent` for every pointer and key state, and
`Page.captureScreenshot` per frame per theme. Nothing here was hand-copied: no PNG
was converted into a WebP by hand, and the manifest was written by the same run
that wrote the frames.

`--allow-backend` is stated rather than silently omitted, the convention
`docs/evidence/chat-canonical-quote/README.md` and
`docs/evidence/browser-pane/README.md` follow: the operator's own daemon answers
on this machine's `localhost:1111`, and `assertBackendDown` refuses a capture while
it does — correctly, because a frame that shows a live backend's replies is not a
function of the tree. Every story in this set renders FIXTURES: `window.api` is
stubbed by `link-targets.stories.tsx` (the probe answers for the fixture's own
paths) and no path in the set reaches a service or the disk. The flag says a
backend was answering, not that one was used.

## Story ids and what each directory shows

| Directory | Story | Gesture | What the picture shows |
| --- | --- | --- | --- |
| `detected-targets/` | `--detected-targets` | none (resting) | The eight admission shapes at rest: the operator's own report path, a backticked path, a `file://` URL, a bare `https://` URL (already a link, not doubled), a path in a table cell, a directory, a path that is not there, and one long enough to wrap. |
| `hover-file/` | `--detected-targets` | CDP `mouseMoved` | The file matrix: `Copy path · Open · Open folder`, 8px above the link's own box. The link is on the row's FIRST line, which is why the strip is above it (see `hover-directory/` for the other side of that rule). |
| `hover-url/` | `--detected-targets` | `mouseMoved` | The URL matrix: `Copy link · Open in browser`, no `Open folder`. |
| `hover-directory/` | `--detected-targets` | `mouseMoved` | The matrix's deliberate omission: `Copy path · Open`, no `Open folder` (a Finder reveal of a directory selects its parent). Mid-paragraph, so the strip sits BELOW its anchor — the D2 rule in pixels. |
| `hover-missing/` | `--detected-targets` | `mouseMoved` | The state that replaced a press which silently did nothing: `Copy path` plus the reason, naming the FILE (`No file at report-2026-09-17.pdf`). |
| `hover-prose/` | `--detected-targets` | `mouseMoved` at a text run | The pointer on the turn's own prose, in a paragraph that also holds links: **nothing is raised** — the turn's Quote control comes from a highlight and nothing else. |
| `hover-same-turn-second-link/` | `--detected-targets` | two `mouseMoved` steps | Design D1's regression: the strip is raised on the missing path and then the pointer moves onto the directory link in the SAME turn. The frame shows the strip attached to the SECOND link, and the entry's `expectAnchored` claim fails if it is not. |
| `hover-toolbar-button/` | `--detected-targets` | two-step pointer | The strip's own button under the pointer: one colour step, no transform, no shadow. |
| `copy-pressed/` | `--detected-targets` | two-step pointer + a real press | The press that follows: the button swaps to the tick and its accessible name to `Copied`, which the entry asserts. |
| `escape-dismisses/` | `--detected-targets` | `mouseMoved` + a real `Escape` | The strip raised by the POINTER, then one Escape with focus wherever the reader left it: the strip is gone, which the entry asserts (`expectGone`). |
| `selection-in-link/` | `--selection-in-link` | story `Selection` | A highlight inside a link: the LINK's toolbar, with `Quote` leading. |
| `selection-in-link-staged/` | `--selection-in-link-staged` | story `Selection` + a press | The same highlight and then the toolbar's own `Quote` pressed, with the composer in frame: the chip carries the link's own text. |
| `selection-link-and-prose/` | `--selection-spanning` | story `Selection` | A highlight over a link AND the prose beside it: the TURN's Quote control is the only thing raised, and the entry asserts that no link toolbar mounts. |
| `selection-two-links/` | `--selection-across-links` | story `Selection` | A highlight across two links in one turn: the same answer, and the same assertion. |
| `detected-targets-narrow/` | `--detected-targets-narrow` | none (resting) | The same shapes in a 420px column, where the long path wraps. |
| `hover-narrow/` | `--detected-targets-narrow` | `mouseMoved` | The strip for a WRAPPED link: 8px above its first line, inside the pane, clear of the timestamp. |

## Claims the rig asserts

Several entries are falsifiable rather than photographic, which is the difference
between evidence and a picture:

- `expectAnchored` (`hover-same-turn-second-link`) — the raised strip must sit 8px
  from THAT selector's own box, and its accessible name must name that target.
  This is design D1's regression, and it fails on the pre-remediation tree.
- `expectGone` / `expectPresent` (`escape-dismisses`,
  `selection-link-and-prose`, `selection-two-links`) — one Escape takes the strip
  away; a spanning highlight leaves the turn's control as the only one up.
- `expectAttribute` (`copy-pressed`) — the press produced the state the frame is
  named for.

## Honest limits of this set

- **Two states are built by a scripted `Selection`, not by a drag.** A headless
  Chromium drag whose endpoint lies inside an anchor produces no highlight at all,
  with or without `draggable={false}` (round 1, UX U4 — re-measured on this head).
  Both spanning states have an endpoint inside a link, so their stories build a
  real `Selection` through the DOM's own API — the same instrument the
  `selection-in-link` frames use, read back by the shipped component through
  `window.getSelection()`. The same limit reaches `selection-in-link*`. Whether a
  WINDOWED build selects there is unconfirmed and is round 2's to measure.
- **The OS hand-off is not photographed.** `openFile` / `showItemInFolder` leave
  through the main process, and a page cannot show what Preview or Finder does
  with them. The IPC contract is QA's, in the PR thread.
- **No `main`-side before half for the resting frames.** The story file is ADDED
  by this branch, so no `main` frame of it exists or can exist (round 1, review
  M5). What the set has instead is the story's own resting state; the change it is
  the "before" of is "the previous behaviour was no anchor at all".
- **Derived snapshots, and the probe is stubbed.** `window.api.probeFiles` answers
  for the fixture's paths, so "the file is there" is this set's premise rather
  than something it proves; the real stat is the live app's, and QA's.
- **Twelve themes of fifty-nine.** The gate covers the rest
  (`pnpm check-themes`), and any other palette can be captured on demand with
  `--themes=<id>`.
