# Send/wake delivery — the four card states, after frames

Rendered evidence for `damianvtran/local-operator-ui` PR (branch
`fix/send-wake-card-states`), head `d482dfac17`.

## What these frames are

The desktop `send` tool row, at the four delivery states the core reports in
`details.delivery.state`, driven through the PRODUCTION `CanonicalTranscript` ->
`ToolRow` from real `TranscriptRecord`s (the stories in
`src/renderer/src/features/chat/canonical/tool-row.stories.tsx`). Nothing here is
a hand-built row with the same class names.

| File | Story | What it shows |
|---|---|---|
| `after-collapsed-dark.png` | `SendDeliveries` | The four states in one column: `delivered` silent at 0.4s, `mailbox` amber `wake unconfirmed` at 5.1s, `unconfirmed` amber `unconfirmed` at 16s, `failed` `not delivered` on the danger wash at 0.1s |
| `after-expanded-dark.png` | `SendDeliveriesOpen` | The two amber states expanded: their sentences render as an ordinary `Output` block, NOT an `Error` block — the incident's own defect was that a message sitting in a peer's mailbox was painted as a failure |
| `after-failure-expanded-dark.png` | `SendDeliveriesFailureOpen` | The refusal expanded: the danger pathway is kept and only this state renders an `Error` block |
| `after-narrow-dark.png` | `SendDeliveriesNarrow` | 390px: the summary truncates first (`Sent wake · release-owner…`) and the state word and its mark are never cut |
| `after-collapsed-light.png` | `SendDeliveriesLight` | The same four rows under `localOperatorLight`, where `warning` is the closer call |

## Before

| File | Provenance |
|---|---|
| `before-collapsed-dark.png` | The DESIGN round's capture at `origin/main` `ee5611a2e4` (session `b3fb81a68d9f`), same surface and same fixture family |
| `before-incident-expanded-dark.png` | The same round: the incident's wake timeout expanded under an `Error` block |

The before pair was not captured by this rig, and the fixtures are not identical
row-for-row: the designer's frame carries a quiet (`wake=false`) mailbox send
where this one carries the retry-exhausted `unconfirmed` state, which has no
predecessor to photograph — the incident row IS its before. What the pair
establishes is the design question the change answers: at `origin/main` a
delivered-but-unanswered send and a refusal were the SAME row (danger wash, the
word `failed`, an `Error` block), distinguishable only by reading a truncated
sentence.

## How they were taken

```
cd <worktree at d482dfac17>
./node_modules/.bin/storybook dev -p 6139          # one rig, reaped by pid afterwards
# then, in the session's browser tool (the user's own browser, one reused tab):
http://localhost:6139/iframe.html?id=chat-tool-rows--send-deliveries&viewMode=story&args=theme:localOperatorDark
...&args=theme:localOperatorLight                  # the light frame
```

The tab was closed and the Storybook process group reaped by exact pid when the
capture finished; no browser was installed and no second rig was launched.
Frames are the tab's own viewport at 1024x576 logical (2560x1440 device pixels).

## What these frames do NOT prove

- They are **fixtures**, not a live incident. The result strings are the ones
  core builds for each state; the durations are the ones the design measured.
  The backend half (the retry, the disk probe, the classification) lives in
  `damianvtran/local-operator` and is not exercised here — no PR for it exists
  yet, and this branch renders the states it will report.
- They say nothing about the TUI's own frames; the TUI half of the vocabulary
  (`wake unconfirmed` / `unconfirmed` on the partial glyph) is a separate surface.
- They are not a contrast measurement. The floors are asserted by
  `scripts/contrast-contract.mjs` (`warning` as text on every ground, plus the
  new `warning`/`rowHover` row), and the light frame is here to be LOOKED at.
