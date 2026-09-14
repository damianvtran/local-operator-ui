# UX round 2 — evidence recovery

Recovered by coder (`openai/gpt-6-astra`) from the interrupted worktree at
`2a24d3fafbd7ab3ab4b7c3cc966c029b2b139883`. No routing change or old model resumed.

## Capture provenance

The predecessor's `/tmp/slash-parity-capture.log` reports 180 frames captured at
`2a24d3faf`; `/tmp/slash-parity-sb.log` identifies its private Storybook on
`http://localhost:6070`. The manifest's refresh timestamp is
`2026-09-14T18:26:08.132Z`. Of the 180 frames (15 stories × 12 themes), 144 in
12 stories differ from `8a4a50ea9`; 36 empty/loading/error-state frames remain
byte-identical. The images were preserved, not blindly re-captured.

The predecessor used `capture-evidence.mjs` browser-engine automation, contrary
to the operator's browser-tool-only instruction. These are explicitly attributed
predecessor artifacts, **not** browser-tool captures by recovery, and **not**
independent QA. The manifest's stale byte-identity narrative and double-count of
360 refreshed frames were corrected. Unrelated historical frames retain their
original provenance; no whole-tree image sweep or freshness claim was made.

Recovery visually read the old and new `command-phase/tokyoNight.webp`: the old
frame names Enter alone, while the new frame adds `Click completes /team.`.
Both are 768×460; the footer expands upward without moving the composer below
it. The prior frame is available directly at commit `8a4a50ea9`. Recovery also
read `argument-phase-narrow-composer/localOperatorLight.webp` (378×300): the
second footer line says `Click runs /model anthropic/claude-opus-5.` and fits
within the narrow popup. This is representative inspection, not a claim to
have visually read all 180 frames.

## Scope and remaining validation

`2a24d3faf` implements U10 (click guidance from the dispatch predicate), U11
(completed click; mousedown only preserves focus), and U13 (leading-slash 422
explained in actionable copy, without the impossible generic retry hint).
The backend's leading-slash rejection policy is unchanged. U6/U9/U12 remain
previously deferred UX items, not silently marked fixed.

Previous code round 4, QA round 2 and design round 2 describe the previous head.
They are not automatically re-pinned to this remediation. Independent delta
review must cover the added footer, completed click, and refusal guidance.
The popup stories are fixture-based visual evidence; they do not prove live
message admission, backend side effects, or aborted-pointer behaviour.
