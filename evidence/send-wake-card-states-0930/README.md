# Send/wake delivery — the four card states, after frames (round-1 remediation)

Rendered evidence for `damianvtran/local-operator-ui` PR #719, branch
`fix/send-wake-card-states`.

## What these frames are

The desktop `send` tool row at the four delivery states the core reports in
`details.delivery.state`, driven through the PRODUCTION `CanonicalTranscript` ->
`ToolRow` from real `TranscriptRecord`s (the stories in
`src/renderer/src/features/chat/canonical/tool-row.stories.tsx`). Nothing here is
a hand-built row with the same class names.

| File | Story | What it shows |
|---|---|---|
| `after-collapsed-dark.png` | `SendDeliveries` | Four states in one column: `delivered` silent at 0.4s, `mailbox` amber `wake unconfirmed` + mailbox mark at 5.1s, `unconfirmed` amber `delivery unconfirmed` + question-mark message mark at 16s, `failed` `Attempted … not delivered` on the danger wash at 0.1s |
| `after-open-mailbox-dark.png` | `SendDeliveriesOpen` | The incident's own expansion: the WRAPPING reader-facing sentence above the machine result, which is where the actionable half now lives |
| `after-open-unconfirmed-dark.png` | `SendDeliveriesUnconfirmedOpen` | The retry-exhausted state's expansion: "Not confirmed: there was no answer and the message is not in their transcript. It may still arrive, so check before resending." |
| `after-failure-expanded-dark.png` | `SendDeliveriesFailureOpen` | The refusal expanded in its own prose: the danger pathway kept, and the frame now CONTAINS the `Error` block it is cited for (the label and the cause line, with the peer pid) — it was clipped until round 2's D1 |
| `after-narrow-dark.png` | `SendDeliveriesNarrow` (390px) | The word whole (`wake unconfirmed`, `delivery unconfirmed`) and the summary truncating first |
| `after-too-narrow-dark.png` | `SendDeliveriesTooNarrow` (320px) | BELOW the fit width: the amber pair sheds the WORD and keeps its mark, while the refusal keeps `not delivered` (it has no mark, so shedding it would leave the wash alone saying the call failed) |
| `after-collapsed-light.png` | `SendDeliveriesLight` | The same four rows under `localOperatorLight` |
| `after-folded-dark.png` | `SendDeliveriesFolded` | The recorded GAP: four consecutive sends fold into a neutral `4 messages` bar, with a `mailbox` inside it invisible. No tally is proposed; this frame is the caveat's picture |

## Before

| File | Provenance |
|---|---|
| `before-collapsed-dark.png` | The DESIGN round's capture at `origin/main` `ee5611a2e4` |
| `before-incident-expanded-dark.png` | The same round: the incident's wake timeout expanded under an `Error` block |

The before pair was not captured by this rig, and the fixtures are not identical
row-for-row: the designer's frame carries a quiet (`wake=false`) mailbox send
where this one carries the retry-exhausted `unconfirmed` state. What the pair
establishes is the question the change answers: at `origin/main` a
delivered-but-unanswered send and a refusal were the SAME row (danger wash, the
word `failed`, an `Error` block), distinguishable only by reading a truncated
sentence.

## How they were taken

```
cd <worktree at the PR head>
./node_modules/.bin/storybook dev -p 6139          # one rig, reaped by pid afterwards
# then, in the session's browser tool (the user's own browser, one reused tab):
http://localhost:6139/iframe.html?id=chat-tool-rows--send-deliveries&viewMode=story&args=theme:localOperatorDark
...&args=theme:localOperatorLight                  # the light frame
```

The tab was closed and the Storybook process group reaped by exact pid when the
capture finished; no browser was installed and no second rig was launched. Frames
are the tab's own layout viewport at 1280x720 CSS with DPR 2 (a 2560x1440
raster) — measured by QA round 2 (Q5): the same story rendered at 1024x576
lands 1.25x larger and offset, while 1280x720@2 matches the frame's ink bbox
to 1px.

## The width rule, measured rather than asserted

The suite can only pin the MECHANISM (jsdom has no layout engine, so a container
query resolves to nothing there — the limit `scripts/stopped-row-measure.test.mjs`
records for the chat measure). The behaviour was read off the rendered frames:

| Viewport | Row width | `delivery unconfirmed` drawn? | Mark drawn? | Spoken sentence |
|---|---|---|---|---|
| 390px | `SendDeliveriesNarrow` | yes, whole | yes | yes |
| 320px | `SendDeliveriesTooNarrow` | **no** | yes | yes (`delivery unconfirmed — it may still arrive, so check before resending`) |
| any | `failed` row | yes, always | n/a | the drawn word is the announcement |

## Which frames were re-shot for round 2

The convergence commit changes two things that are in the pixels: the refusal's
own sentence (now "Fix the cause named below") and the trailing duration, which
sheds below the container width the state word already sheds at. So
`after-failure-expanded-dark.png` and `after-too-narrow-dark.png` were re-shot at
that head; the other six are unchanged in fact as well as in the diff — the
duration is drawn at every width those frames use (their rows are 21.4rem and
wider), and no other frame renders a delivery note.

## What these frames do NOT prove

- They are **fixtures**, not a live incident. The result strings are the ones core
  builds for each state; the durations are the ones the design measured. The
  backend half (the retry, the disk probe, the classification) lives in
  `damianvtran/local-operator` **#1855** (open, head `d50bccfd53`) and is not
  exercised here; that PR also aligns the TUI's own state words to
  `delivery unconfirmed` / `not delivered` in its remediation.
- They say nothing about the TUI's own frames; the TUI half of the vocabulary is a
  separate surface.
- The 320px frame contains every row in its box (QA round 2, Q1), but the refusal
  is at its floor there: its summary truncates to a single character, because the
  frozen word and the verb are what the row will not give up. Below 320px the
  refusal's own fixed parts reach the box edge again.
- They are not a contrast measurement. The floors are asserted by
  `scripts/contrast-contract.mjs` (`warning` as text on every ground, plus the
  `warning`/`rowHover` row this PR adds).
- `after-folded-dark.png` shows a GAP, not a fix: a folded run hides a `mailbox`
  result. That is recorded, not solved.
