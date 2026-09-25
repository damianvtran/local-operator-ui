# Design review round 1 — frames for PR #508 (cwd chip: 16ch column → 16ch cap)

Evidence-only branch. No product code. The reviewer's own re-captures for the
design round on `feat/cwd-chip-compact-width` (head `02e3967e6420a0b5617e0227f4c4c2eafbcd41b4`).

## Method

Storybook, one story at a time, served from each of the PR's two worktrees and
driven through the local `browser` tool — the convention this feature's own
evidence set (`docs/evidence/chat-cwd-move-live/README.md`) uses:

* `after` — `/Users/damian/local-operator-ui/.worktrees/cwd-chip-compact`
  (`pnpm exec storybook dev -p 6123 --no-open --quiet`);
* `before` — `/Users/damian/local-operator-ui/.worktrees/cwd-chip-compact-base`
  (detached at `origin/main`, `a7df70995`), same story files, same command on
  port 6124.

Tab viewport 1280 x 720 CSS at 2x (2560 x 1440 device pixels). Every story's chat
column is an inline width the story sets, so the tab size decides no number here.
Theme is the preview default (`localOperatorDark`).

**The captures reproduce the PR's committed frames exactly.** Three of them were
re-taken independently on this branch's own trees and are byte-identical to the
frames on `evidence/cwd-chip-compact-frames`:

| frame | sha256 |
| --- | --- |
| `chip-after-tilde-1000.png` | `8982fd334d6b6edcc0ec6c10a45ba49802ce9b6ebb6510340fe22c2a94cf00f5` (mine = theirs) |
| `cap-after-past-cap.png` | `057c6d19048533b8e1f2dfeee4fa4f0fb712657c53708319411c2b60e0ac0515` (mine = theirs) |
| `chip-before-tilde-1000.png` | `6c3a7ac0951713e1009d7e1e74743057ee276bdd95289beb3ee60f78a9e96971` (mine = theirs) |
| `row-before-1024.png` | `e3c2e6cc06d3281589c2f16197e97d8c8ce4a64f20fe324565630bb8d30e12aa` (mine = theirs) |

So the pixels the review's findings rest on are not the author's alone.

## Frames

| file | what it is |
| --- | --- |
| `frames/pair-tilde-1000-r1.png` | The operator's own case, BEFORE (**top**) and AFTER (**bottom**): the chip at `~` on a 1000px chat column, cropped to the chip row. BEFORE: the `~` sits in a fixed 115.2px column, so ~108px of empty box separates it from its own chevron. AFTER: the pair is tight (ink gap 11 CSS px). Crops of the two full frames; both full frames are on `evidence/cwd-chip-compact-frames`. |
| `frames/pair-composed-row-1024-r1.png` | The composed row (`chat-message-input--cwd-chip-editable-with-readings`, 1024px column), BEFORE (**top**) and AFTER (**bottom**), cropped to the row. Shows what moves: the readings cluster travels with the chip. |
| `frames/pair-880-editable-vs-shortpath-r1.png` | `chat-cwd-move--editable` (**top**, `~/src/project`, 13 characters) against `chat-cwd-move--editable-short-path` (**bottom**, `~/Downloads`, 11 characters), both at the column they actually render at (`column` defaults to 880). The two boxes are the SAME width and both paths are ellipsised — neither story can show the two-character difference because the 260px box ceiling binds for both at this column. This is the frame behind finding D3. |

## Honest limits

* **No composed-row frame at `~`.** The only composed-row story that carries
  both the editable chip and the readings cluster
  (`CwdChipEditableWithReadings`) fixes its cwd at `/Users/you` (10 characters),
  which frees 43.2px; the operator's own `~` frees 108px. The composed-row pair
  here therefore under-shows the freed width by 2.5x, and the rest is arithmetic
  (chip 195.9px instead of 303.9px at a ≥900px column, per the PR's own numbers).
* **One theme.** `localOperatorDark` only, as the PR's own set.
* **No live move.** The path-change translation is measured across two rendered
  states, not photographed through the interaction; the chip's commit path paints
  the receipt's cwd, which in a story is a fixed stub.
