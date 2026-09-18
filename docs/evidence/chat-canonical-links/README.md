# Chat link affordances: the transcript's detected links, in twelve themes

Twenty-two states × twelve themes = **264 frames**, of the canonical transcript's
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
cd ~/local-operator-ui-worktrees/linkify-slash
env -u CMUX_* -u LOP_* HOME=/tmp/lo357ev/home TMPDIR=/tmp/lo357ev/tmp \
    node_modules/.bin/storybook dev -p 6033 --no-open --quiet
env -u CMUX_* -u LOP_* HOME=/tmp/lo357ev/home TMPDIR=/tmp/lo357ev/tmp \
    node scripts/capture-evidence.mjs http://localhost:6033 \
        --only=chat-canonical-links --allow-backend
```

The rows below are the states this run writes, so a reader can bisect one of them
without re-taking the set: `--dirs=<state>` narrows the same command to the
directories named in the left-hand column.

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
| `detected-targets/` | `--detected-targets` | none (resting) | The nine admission shapes at rest: the operator's own report path, a backticked path, a `file://` URL, a bare `https://` URL (already a link, not doubled), a path in a table cell, a directory, a path that is not there, one long enough to wrap, and the ninth, the shape this change is about — a slash command in prose and a second one in backticks, neither a file, beside an extensionless directory that IS one. |
| `hover-file/` | `--detected-targets` | CDP `mouseMoved` | The file matrix: `Copy path · Open · Open folder · Quote`, 8px above the link's own box. The link is on the row's FIRST line, which is why the strip is above it (see `hover-directory/` for the other side of that rule). |
| `hover-url/` | `--detected-targets` | `mouseMoved` | The URL matrix: `Copy link · Open in browser · Quote`, no `Open folder`. |
| `hover-directory/` | `--detected-targets` | `mouseMoved` | The matrix's deliberate omission: `Copy path · Open · Quote`, no `Open folder` (a Finder reveal of a directory selects its parent). Mid-paragraph, so the strip sits BELOW its anchor — the D2 rule in pixels. |
| `hover-missing/` | `--detected-targets` | `mouseMoved` | The state that replaced a press which silently did nothing: `Copy path · Quote` plus the reason, naming the FILE (`No file at report-2026-09-17.pdf`). |
| `hover-prose/` | `--detected-targets` | `mouseMoved` at a text run | The pointer on the turn's own prose, in a paragraph that also holds links: **nothing is raised** — the turn's Quote control comes from a highlight and nothing else. |
| `hover-command-prose/` | `--detected-targets` | `mouseMoved` at a text run, with `expectGone` | This change's own claim, and the one the design round could not photograph (D2): the pointer on the PROSE `/new` — a slash command the paragraph names, not a path — and after 500ms **no `[data-lo-link-toolbar]` exists at all**, where the same point on the before head raised `No file at /new`. The entry is falsifiable (an absent strip cannot be told from a resting frame otherwise) and self-asserting across the two heads: see *The before half*. |
| `hover-same-turn-second-link/` | `--detected-targets` | two `mouseMoved` steps | Design D1's regression: the strip is raised on the missing path and then the pointer moves onto the directory link in the SAME turn. The frame shows the strip attached to the SECOND link, and the entry's `expectAnchored` claim fails if it is not. |
| `hover-toolbar-button/` | `--detected-targets` | two-step pointer (one move per selector) | The strip's own button under the pointer: one colour step, no transform, no shadow. The pointer arrives by the rig's single-move form, which is a teleport; the entries that prove the button is reachable along a path a mouse makes are the `hover-gap-*` rows below, and those are assertions. |
| `copy-pressed/` | `--detected-targets` | two-step pointer + a real press | The press that follows: the button swaps to the tick and its accessible name to `Copied`, which the entry asserts. |
| `hover-gap-crossing/` | `--detected-targets` | pointer path, 2 samples @16ms, in AND back out | Design D1's BLOCKER: the pointer crosses from the anchor onto its `Copy path` button and back, and the strip must still be up and still about that link at both ends (`expectKept`). This is the path that was lost at step 1 before the corridor existed. |
| `hover-gap-long/` | `--detected-targets` | pointer path, 4 samples @16ms | The same arrival at a slower hand's spacing — the case lost at step 2. |
| `hover-gap-fine/` | `--detected-targets` | pointer path, 1 sample per PIXEL @8ms | A mid-paragraph link, whose strip is placed BELOW it: the other placement, sampled every pixel, which is the path lost on the first pixel off the anchor's own box. |
| `hover-gap-leave/` | `--detected-targets` | pointer path onto the button, then out to the prose | The dismissal half of the same claim: the strip survives the arrival and is GONE once the pointer moves onto the words beside the link (`expectKept: false`). Without this frame "keep the subject" could be satisfied by never dismissing. |
| `hover-cell/` | `--detected-targets` | `mouseMoved` | A TABLE-CELL anchor (round 2, design D4). The cell's link box is `[255,544,612,561]` and the table ends at 573, so the strip (`[255,569,383,601]`, the live four-button width — see § 5) hangs 28px out of the table over the paragraph below, covering 671 ink px of it — the cost § 5 records beside the rule, re-measured in round 3. |
| `escape-dismisses/` | `--detected-targets` | `mouseMoved` + a real `Escape` | The strip raised by the POINTER, then one Escape with focus wherever the reader left it: the strip is gone, which the entry asserts (`expectGone`). |
| `selection-in-link/` | `--selection-in-link` | story `Selection` (NOT a drag — see the limits) | A highlight inside a link: the LINK's toolbar, with `Quote` leading. |
| `selection-in-link-staged/` | `--selection-in-link-staged` | story `Selection` + a press | The same highlight and then the toolbar's own `Quote` pressed, with the composer in frame: the chip carries the link's own text. |
| `selection-link-and-prose/` | `--selection-spanning` | story `Selection` | A highlight over a link AND the prose beside it: the TURN's Quote control is the only thing raised, and the entry asserts that no link toolbar mounts. |
| `selection-two-links/` | `--selection-across-links` | story `Selection` | A highlight across two links in one turn: the same answer, and the same assertion. |
| `detected-targets-narrow/` | `--detected-targets-narrow` | none (resting) | The same shapes in a 420px column, where the long path wraps. |
| `hover-narrow/` | `--detected-targets-narrow` | `mouseMoved` | The strip for a WRAPPED link: 8px BELOW its last line, inside the pane, clear of the timestamp. (Round 2, design D3: this row described the pre-remediation placement.) |

## The before half

`docs/evidence/chat-canonical-links-before/` is the same story, the same fixtures,
the same twelve themes and the same rig entries on the head that adds the ninth
shape and NOTHING of the fix (`9c58e7bb7`, rebased as `b4d12e7a8`; the story-fixture-only commit, the
manifest declares it as a supplementary set with that `capturedAtHead`). In it the
operator's own sentence still underlines `/new`, and every state sits at the same
paragraph position, so a reader can put the two halves side by side without
hunting for the row.

It has FIVE states and not twenty-two, for two measured reasons rather than a
gap. SIXTEEN of the twenty-one directories the design round handed over are
byte-identical to the AFTER frames as committed at `74f6ea96c` (rebased as `2b3ac8a2b`), the head this
pass then replaced (`magick compare -metric AE` = 0, 12 of 12 themes each): a
"before" frame that is its after frame photographs the fix, so those sixteen are
not landed, and `chat-canonical-links-before/`'s own README carries the same count
and the same measurement. The twenty-first state, `hover-command-prose`, cannot
exist on that head at all: it aims at a `/new` text run OUTSIDE an anchor, and on
the before head every `/new` run in that paragraph IS an anchor, so the aim throws
(`no text run matching "/new" outside a link or a button`) and there is no frame
to take. That throw is what makes "a slash command raises no strip" falsifiable
across the two heads instead of a claim about one still.

The strip the defect itself raised, `No file at /new`, is therefore in NEITHER
landed half: a hover is a gesture no resting frame carries, and the state that
would show it is the one that cannot be taken here. It is photographed in the
design round's own instrument PNG `hover-command-before-9c58e7bb7.png` (the prose
token green and underlined with the strip reading `No file at /new` at
`[532,638,688,670]`), which is not in the repository, and QA round 1's anchor
inventory in the PR thread names the same two `/new` anchors independently -
`{"text":"/new","url":"/new"}` for the prose token and for the backticked one.

## Claims the rig asserts

Several entries are falsifiable rather than photographic, which is the difference
between evidence and a picture:

- `expectAnchored` (`hover-same-turn-second-link`) — the raised strip must sit 8px
  from THAT selector's own box, and its accessible name must name that target.
  This is design D1's regression, and it fails on the pre-remediation tree.
- `expectGone` / `expectPresent` (`escape-dismisses`, `hover-command-prose`,
  `selection-link-and-prose`, `selection-two-links`) — one Escape takes the strip
  away; the prose `/new` raises none in the first place; a spanning highlight
  leaves the turn's control as the only one up.
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

- **THE FRAMES COME FROM ONE HEAD, AND THE BEFORE HALF FROM ANOTHER.** Every frame
  of the twenty-two states above was taken in this pass at this branch's
  review-remediation head - `6f74c0aca` for the batches by state, with
  `detected-targets` re-taken at `edbf5bca0`, where all 12 of its frames came back
  byte-identical to the first take - and the tree those frames depict is the one the
  shipped head still has: `git diff edbf5bca0..fcd3f159a` moves nothing under `src/`
  or `scripts/`, and the only code commit above the capture head is round 2's
  scoping of the predecessor refusal to the ambiguous class (`311e68666`), which
  round 3 measured render-neutral for this story (the story's text holds no token of
  the class that commit restored). The manifest's `head` is `edbf5bca0`, the rebased
  spelling of the capture commit, and its `srcTree`/`scriptsTree` are re-derived at
  the shipped tip because that code commit moves both trees - the distinction the
  manifest's `headNote` states. So the set no longer carries the multi-head caveat an
  earlier round's fold left here (a narrowed fold once re-took two states and kept
  nineteen from the head before it). The `before/` half is a DIFFERENT head by
  construction — it is the tree before the fix — and the manifest's
  `supplementary` entry for it names which. Two independent re-takes of one state
  still differ under **sub-perceptual rasterisation jitter** (34/36 and 11/12
  measured, antialiasing deltas of at most 17/255, with no element appearing,
  disappearing or moving), so a reader comparing a frame here against a fresh
  capture should expect that, not a hash match.

- **The `path:line` register is UNPHOTOGRAPHED** (design round 1, D1), and that is
  stated rather than papered over: no state in this set contains an editor line
  reference, so the half of this change that stops `…/run.mjs:59` being underlined
  as part of the name cannot be falsified from these frames. It is pinned where a
  still cannot reach it — `scripts/link-targets.test.mjs` asserts the span and the
  anchor's visible text on both tiers, and `scripts/mentioned-files.test.mjs`
  asserts both of the panel's — and the design round judged its mechanics on a
  scratch tenth shape rather than filing frames for a fixture it would have had to
  change first.

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
