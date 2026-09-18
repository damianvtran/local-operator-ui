# The agent answer's caption — the BEFORE half of the pair

Four frames: `prose-tool-alignment` at both of its widths, in the two `localOperator*` themes,
taken from the tree this branch stood on **before** the agent-side caption was added. Each one is the
same story as its after half under `docs/evidence/chat-tool-rows/`, so a pair differs by the change
and not by its fixture.

The operator's second report of 2026-09-17 is what they answer:

> "The agent responses (just the final responses, not the in-progress tool intent/response) don't
> have a time displayed on them — that would be helpful to show too. It should probably be on the
> left under the agent message instead of on the right."

| Frame | What the BEFORE half shows | The after half |
| --- | --- | --- |
| [`prose-tool-alignment@1024`](prose-tool-alignment@1024/), [`@1440`](prose-tool-alignment@1440/) | A transcript ending on the agent's answer. The prose shares one left rail with the ledger and carries **no time of its own** — the timestamp under the call belongs to a CLOSED row, so it is not painted at all. | [`../chat-tool-rows/prose-tool-alignment@1024/`](../chat-tool-rows/prose-tool-alignment@1024/), [`@1440`](../chat-tool-rows/prose-tool-alignment@1440/) — the same transcript with `Oct 9, 2025, 4:53 AM` under the answer, left-aligned on the rail. |

## Where these came from

`node scripts/capture-evidence.mjs http://127.0.0.1:6121 --only=chat-tool-rows--prose-tool-alignment
--themes=localOperatorDark,localOperatorLight --allow-backend`, run in a **second git worktree
checked out at this branch's own pre-caption head** (`4cf34e95b`, the footer-removal commit on the
rebased base) with its own Storybook build. It is a capture of that tree by the same harness, not a
hand-picked copy of the committed frames, and the after halves are the same story and the same
fixture at the same viewport.

**The head is the point, and it is worth one sentence:** a before half taken against `main` would
have differed by every other lane's merged work as well as by this change, and a before half taken
from this branch's own tip would have contained the caption. `4cf34e95b` is the commit where this
branch's tree still had the footer removed and no answer caption.

## The change the pair measures

`magick compare -metric AE` reports **88,996** changed pixels between the halves at 1024 in
`localOperatorDark` (0.124 of the frame), and the thresholded difference localises them to the
answer's own block rather than to the frame: `842x134+103+262` at a 15% threshold, which is the
ledger rows the caption sits under plus the caption itself. Read as pictures, the two halves differ
by the caption: the user turn, the call the answer narrates and the prose above it are in the same
place in both, and the extra ink is `Oct 9, 2025, 4:53 AM` at x 102..224, y 388..394.

What the residual is made of is worth stating rather than hiding: the two halves are separate
lossy-WebP encodes of the same glyphs, and the box the threshold returns covers the ledger rows
whose thin strokes re-encode differently at any threshold that still keeps a 12px caption legible.
The claim this pair supports is the one a reader can check by eye and by the ink rows — the caption
is the difference at the foot of the answer — not a claim that every other pixel is bit-identical.

## What this pair does NOT carry

- **The in-progress half and the repeated-caption question have no before half, and cannot have one.**
  Those are the two stories this branch ADDS: `answer-in-progress` (a settled answer beside one that
  is still arriving) and `prose-between-calls` (three intermediate paragraphs plus a closing answer)
  did not exist on the tree being compared against, so there is no frame of them without the caption.
  Their claims are self-contained in their after frames — an absence on a streaming row is visible
  against a settled row that has one — and the README of the surface they land in says what each is
  for.
- **The narrow view.** The operator asked for the caption at 1024 and in the narrow column, and the
  narrow column is `prose-between-calls@420` in the after set. It has no before half for the reason
  above; the second width this pair carries is `@1440`, where the caption's left edge and the prose's
  are measured together.

## Declared, not swept

A sweep captures the CURRENT tree, so it can never regenerate these. The set is declared in
`docs/evidence/manifest.json`'s `supplementary` list for that reason, which is what stops
`clearSweptFrames` deleting it and keeps the swept frame count honest.
