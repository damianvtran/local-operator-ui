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

## Where these came from, and why they are a capture rather than a copy

`node scripts/capture-evidence.mjs http://127.0.0.1:6119 --only=chat-tool-rows--prose-tool-alignment
--themes=localOperatorDark,localOperatorLight --allow-backend`, run in a **second git worktree
checked out at this branch's own pre-caption head** (`ebaa85c83`, the footer-removal commit) with its
own Storybook build. It is a capture of that tree by the same harness, not a hand-picked copy of the
committed frames.

**And all four came back byte-identical to the committed frames of the same paths** — `magick compare
-metric AE` = 0 for both widths in both themes. That is the measurement worth reporting rather than
the procedure: this branch's committed frames at that head ARE the state before the caption, so the
pair's before half is reproducible from the tree it names, and the two halves differ by the caption
and by nothing else on this story.

## The change the pair measures, on the width that isolates it

At 1024 the two trees differ inside one box, and that box is the caption: `magick compare -metric AE`
reports **2,721** changed pixels in `138x26+838+358` — the removed transcript footer's own box from
the previous round, which is where this caption now lands, at the opposite alignment. At 1440 the
same box is `138x26+1046+358`, AE 2,673 (dark) / 2,431 (light). Nothing else in those four frames
moved.

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
