# Chat link affordances: the transcript's detected links, in twelve themes

Twenty-three states × twelve themes = **276 frames**, of the canonical transcript's
link affordances: a path the agent wrote, rendered as a link you can press, the
toolbar a hover raises on it, the pointer paths that reach its buttons, and what
happens to a highlight that starts inside it. The set's own entry in
`docs/evidence/manifest.json` carries the same arithmetic (`frames`,
`surfaces`, `themes`), and that file is the number a reader should trust
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
| `hover-file/` | `--detected-targets` | CDP `mouseMoved` | The file matrix, five actions since this branch's pass: `Copy path · Open in canvas · Open in default app · Open folder · Quote` (`[175,334,330,363]`, 156px wide, 30px tall — § 5 of the design doc), 8px above the link's own box. The link is on the row's FIRST line, which is why the strip is above it (see `hover-directory/` for the other side of that rule). |
| `hover-url/` | `--detected-targets` | `mouseMoved` | The URL matrix: `Copy link · Open in browser · Quote`, no `Open folder`. |
| `hover-directory/` | `--detected-targets` | `mouseMoved` | The matrix's deliberate omission: `Copy path · Open · Quote`, no `Open folder` (a Finder reveal of a directory selects its parent). Mid-paragraph, so the strip sits BELOW its anchor — the D2 rule in pixels. |
| `hover-missing/` | `--detected-targets` | `mouseMoved` | The state that replaced a press which silently did nothing: `Copy path · Quote` plus the reason, naming the FILE (`No file at report-2026-09-17.pdf`). |
| `hover-prose/` | `--detected-targets` | `mouseMoved` at a text run | The pointer on the turn's own prose, in a paragraph that also holds links: **nothing is raised** — the turn's Quote control comes from a highlight and nothing else. |
| `hover-same-turn-second-link/` | `--detected-targets` | two `mouseMoved` steps | Design D1's regression: the strip is raised on the missing path and then the pointer moves onto the directory link in the SAME turn. The frame shows the strip attached to the SECOND link, and the entry's `expectAnchored` claim fails if it is not. |
| `hover-toolbar-button/` | `--detected-targets` | two-step pointer (one move per selector) | The strip's own button under the pointer: one colour step, no transform, no shadow. The pointer arrives by the rig's single-move form, which is a teleport; the entries that prove the button is reachable along a path a mouse makes are the `hover-gap-*` rows below, and those are assertions. |
| `copy-pressed/` | `--detected-targets` | two-step pointer + a real press | The press that follows: the button swaps to the tick and its accessible name to `Copied`, which the entry asserts. |
| `hover-gap-crossing/` | `--detected-targets` | pointer path, 2 samples @16ms, in AND back out | Design D1's BLOCKER: the pointer crosses from the anchor onto its `Copy path` button and back, and the strip must still be up and still about that link at both ends (`expectKept`). This is the path that was lost at step 1 before the corridor existed. |
| `hover-gap-long/` | `--detected-targets` | pointer path, 4 samples @16ms | The same arrival at a slower hand's spacing — the case lost at step 2. |
| `hover-gap-fine/` | `--detected-targets` | pointer path, 1 sample per PIXEL @8ms | A mid-paragraph link, whose strip is placed BELOW it: the other placement, sampled every pixel, which is the path lost on the first pixel off the anchor's own box. |
| `hover-gap-leave/` | `--detected-targets` | pointer path onto the button, then out to the prose | The dismissal half of the same claim: the strip survives the arrival and is GONE once the pointer moves onto the words beside the link (`expectKept: false`). Without this frame "keep the subject" could be satisfied by never dismissing. |
| `hover-cell/` | `--detected-targets` | `mouseMoved` | A TABLE-CELL anchor (round 2, design D4). The cell's link box is `[255,544,612,561]` and the table's last painted rule is at y=568, so the strip (`[256,565,411,594]`, the live five-button width — see § 5) hangs 26px out of the table over the paragraph below, covering 587 ink px of it at this head's five-button width (483 at the same registration's 126 px width) — the cost § 5 records beside the rule. |
| `escape-dismisses/` | `--detected-targets` | `mouseMoved` + a real `Escape` | The strip raised by the POINTER, then one Escape with focus wherever the reader left it: the strip is gone, which the entry asserts (`expectGone`). |
| `selection-in-link/` | `--selection-in-link` | story `Selection` (NOT a drag — see the limits) | A highlight inside a link: the LINK's toolbar, with `Quote` leading. |
| `selection-in-link-staged/` | `--selection-in-link-staged` | story `Selection` + a press | The same highlight and then the toolbar's own `Quote` pressed, with the composer in frame: the chip carries the link's own text. |
| `selection-link-and-prose/` | `--selection-spanning` | story `Selection` | A highlight over a link AND the prose beside it: the TURN's Quote control is the only thing raised, and the entry asserts that no link toolbar mounts. |
| `selection-two-links/` | `--selection-across-links` | story `Selection` | A highlight across two links in one turn: the same answer, and the same assertion. |
| `detected-targets-narrow/` | `--detected-targets-narrow` | none (resting) | The same shapes in a 420px column, where the long path wraps. |
| `hover-narrow/` | `--detected-targets-narrow` | `mouseMoved` | The strip for a WRAPPED link: 8px BELOW its last line, inside the pane, clear of the timestamp. (Round 2, design D3: this row described the pre-remediation placement.) |
| `no-viewer-targets/` | `--no-viewer-targets` | none (resting) | This branch's second story: `bundle.zip` and `local-operator-0.28.4.dmg` are local, existing files with NO viewer, and the same paragraph ends on the `.xlsx` that does open here — so the paragraph itself is the routing rule. Resting, because the matrix is what the row below hovers. |
| `hover-no-viewer/` | `--no-viewer-targets` | `mouseMoved` | The other half of the claim in one frame: the `.zip` link's FOUR-action strip (`Copy path · Open · Open folder · Quote`, 126px, `Open` still the OS) above the sentence whose `.xlsx` carries five. Read beside `hover-file/`, the pair is the rule — the new default is about files this app can SHOW, not about every path an agent writes. |

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
- `hoverPath`'s `expectKept` (`hover-gap-crossing`, `hover-gap-long`,
  `hover-gap-fine`, `hover-gap-leave`) — a real pointer path, sampled at 16ms and
  at every pixel, must keep the subject while it crosses the clearance between a
  link and its toolbar and onto a button, and must lose it once the pointer moves
  onto the prose. Every one of these fails on the pre-remediation tree at the step
  named in the row above, which is design D1's BLOCKER as a regression test rather
  than a description.

## Honest limits of this set

- **The whole set describes THIS branch's tree: the pass re-took every frame in
  one run.** The frames commit's own diff over this directory is **252 modified +
  24 added** (`git diff --name-status <frames-commit>^ <frames-commit> --
  docs/evidence/chat-canonical-links`), the 24 being the two new states × 12
  themes — so all 23 states × 12 themes = **276 frames** were painted on this
  branch's tree by one run of the rig, not carried from an earlier head. What an
  earlier head still supplies is NUMBERS, not pixels: § 5's ink column keeps the
  previous capture's figures for the three matrices whose registration differs by
  the 4 px offset § 5 records, because an ink pair only compares inside one
  registration. `docs/evidence/manifest.json`'s `countsMean`/`partialCapture`
  carry the arithmetic.

  Frames are still frames, though: rasterisation is not a hash match, and an
  earlier draft of this bullet claimed byte-identity where two independent
  re-takes found sub-perceptual jitter instead (34/36 and 11/12 per state, at
  antialiasing deltas of at most 17/255, with no element appearing, disappearing
  or moving). A reader comparing a frame here against a fresh capture should
  expect that, not an equality.

- **The two `selection-in-link*` states, and the two spanning ones, are built by a
  scripted `Selection`, not by a drag — and round 2 settled WHICH side of that
  limit they are on.** A windowed build (`--window-mode=inactive`, pinned Electron,
  `Emulation.setFocusEmulationEnabled(true)`) was driven through a gesture matrix
  with `buttons: 1` on every move and the proper `clickCount` for double and triple
  clicks: a drag in either direction, a double-click, a triple-click and a
  click+Shift+click that all begin and end inside one anchor leave
  `getSelection()` empty, with zero `selectstart`, zero `dragstart` and
  `mousedown.defaultPrevented === false` — while the same instrument selects in the
  prose beside it, and selects THROUGH the link from the prose. A control page
  carrying a plain `<a href>` and one with `draggable="false"` behaves the same way,
  so this is browser behaviour rather than this code: Chromium starts no text
  selection from a `mousedown` on an anchor, and `draggable={false}` only removes
  the browser's own link DRAG. The stories therefore build a real `Selection`
  through the DOM's own API — the same instrument the shipped component reads back
  through `window.getSelection()` — which photographs the states the COMPONENT must
  handle, and is not evidence that a reader can produce them. The consequence is
  designed for rather than hidden: `Quote` is on the toolbar's HOVER state too, so
  the affordance does not depend on a selection the browser will not make.
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

- **No frame here shows a URL being denied the canvas mark, and none can.** The
  fixture's upstream link is `https://example.com/reports/adverse-media-2026-09`,
  whose last segment names no viewer, so `viewerFor` answers `null` and a guarded
  and an unguarded strip look identical in every frame. The case review round 2
  asked for - a URL whose last segment DOES name a viewer
  (`https://example.com/reports/paper.pdf`) wearing the browser's mark rather than
  the canvas panel's - is therefore asserted, not photographed:
  `scripts/chat-link-affordances.test.mjs`'s "a URL's browser press wears the
  browser mark, never the canvas one" mounts the transcript, focuses that URL's
  anchor, reads the button's own SVG class, and then does the same for a file link
  as the positive control. Giving this fixture's URL an extension would move the
  strip's own column position in ~20 states, so the fixture stays as it is and the
  limit is stated rather than paid for.

- **No frame shows the above-ceiling strip, and none can.** The story's probe stub
  answers one size for the fixture's paths, so the state round 3 fixed - a
  canvas-openable FILE whose press would refuse it for `MAX_EAGER_READ_BYTES`, which
  drops `Open in canvas` and shows the note `Too large for the canvas preview` - is
  not reachable from this story without a second fixture and a >1 MiB file behind
  it. It is covered where it can be driven instead:
  `scripts/link-actions.test.mjs`'s "a file above the read ceiling keeps the OS shape
  and says why" (the matrix, beside the two neighbours that must NOT change: a 40 MB
  PDF keeps its canvas action and a small CSV is untouched) and
  `scripts/chat-link-affordances.test.mjs`'s "above the read ceiling the strip loses
  the canvas and says why" (the mounted strip). Adding the state to the story and
  re-shooting the set is a real change of the set's own scope and is not part of this
  round.
