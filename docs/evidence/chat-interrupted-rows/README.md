# Interrupted calls, told apart from failures

The pair to [`../chat-interrupted-rows-before/`](../chat-interrupted-rows-before/),
and the half that claims the fix. The operator reported (2026-09-28) that a
steering-skipped call expanded to `Error / Tool call skipped: interrupted by
steering.` and read `failed` on its row, and that live never-run rows painted
`never ran` in danger ink — the failure treatment, on calls no tool ever met and
on calls a person stopped.

The wire already says which is which; the renderer never read it: a terminal
compose frame's `not_run_kind` and a result's `details.__fault` come from one
FAULT_* vocabulary, and `skipped` (steering redirected before the call ran) and
`aborted` (the user stopped the turn) are interrupts, not failures. One
predicate (`isInterruptedFault`) binds that reading across the live seed, the
end events, the durable rows AND the expanded bodies, and the row's outcome
ladder takes it.

## What each frame shows

| Story | What it is evidence of |
| --- | --- |
| `skip-live` | The steering skip as a live turn settles it (`not_run_kind: "skipped"` on the verdict): the row is the interrupted class — the hueless slashed circle where the before frame read `never ran` in danger ink — and the summary keeps the harness's own record of how far the model got (`never sent · 2.0 KB composed`). |
| `skip-live-expanded` | The same live row, opened: the body is labelled `Interrupted` in the neutral label ink with the harness's reason in ordinary ink — the word the row's sr-only announcement and the TUI use (design round 1, D1; the before half read `Not run` in danger ink). |
| `skip-durable` | The SAME call after a reload, opened: the durable row is an interrupt (no danger wash, no `failed` word) and its reason reads under `Interrupted` — the operator's exact expansion, corrected (before: `failed` + `Error`; an interim state of this pass said `Output`, which the design round refused as dishonest and this frame now shows fixed). Its foot reads `1 action`, not `1 failed`. |
| `stop-mid-flight` | A call killed by the user's stop, from the end event's own `aborted` marker with NO client stop window standing — the reading a replay, a second window or a fresh attach gets. The wire fact alone classifies the row as interrupted and the measured `0.5s` is kept. |
| `stop-expanded` | The same stop, opened: the body is labelled `Interrupted` with `aborted` in ordinary ink (before: `Error` in danger ink). |
| `genuine-failure` | The CONTROL: a call that really ran and failed (`execution` fault). It keeps its danger row, its `failed` word and its `Error` label — and its two frames are the closest pair in the set (light: **0** differing pixels; dark: 141 of 1,024,000, the `>` command icon's anti-aliasing — see the measured pair below). |
| `turn-counts` | One closed turn with three calls (the first is the skip), folded: the group chip reads `Explored 1 file, ran 2 commands` and the foot reads `Worked for 12s · 3 actions` — the `1 failed` both counted before is gone, and no counter predicate was re-implemented (both read `isError`, which the fix clears). |
| `skip-durable-narrow` | The durable skip at the pane's 720px narrow / small-view width, collapsed (design round 1, D3): the interrupted mark and the summary survive the small-view layout. |
| `skip-durable-narrow-expanded` | The same narrow state, opened: the `Interrupted` body label at the small-view width. |

## The measured pair

Plain `magick compare -metric AE` against
[`../chat-interrupted-rows-before/`](../chat-interrupted-rows-before/), same
story, same fixtures, each half's own tree (1,024,000 px = 1280×800; the narrow
pair is 576,000 px = 720×800):

| Story | AE dark | AE light |
| --- | --- | --- |
| `skip-live` | 2,993 | 2,285 |
| `skip-live-expanded` | 15,211 | 11,955 |
| `skip-durable` | 42,097 | 38,958 |
| `stop-mid-flight` | 21,342 | 21,940 |
| `stop-expanded` | 35,389 | 31,736 |
| `genuine-failure` | 141 | **0** |
| `turn-counts` | 23,953 | 22,130 |
| `skip-durable-narrow` | 48,492 | 25,531 |
| `skip-durable-narrow-expanded` | 52,898 | 57,523 |

**The control.** The genuine-failure light pair is byte-identical (AE 0). Its
dark pair differs in 141 of 1,024,000 pixels, confined to a 27×12 box at
+240+212 — the `>` command icon's anti-aliasing, with both frames carrying the
same state, text and labels (checked at 600%); the before half of this round
was rendered in a separate checkout, so two independent lossy-WebP encodes of
that icon's edges can drift by a few levels. It is not a content difference,
and it is the whole of the control's delta.

**Two themes, not twelve.** The claim is a classification — which word, which
glyph, which ink — and the twelve-theme sweep is not re-run for it (both brand
palettes carry every channel the claim touches: the danger word and wash, the
hueless mark, the labels). The frames are lossy WebP (q88), so a pair whose
content differs anywhere can shift a few pixels of anti-aliasing on text the
change does not touch; the control pair is what shows the bound, and the diff
images concentrate on the rows, the labels and the counters the change is
about.

## The design round's findings, as shipped

- **D1 (the body label), fixed in `4035660bb4`.** For the interrupted kinds the
  expanded body is labelled `Interrupted` in the neutral label ink with its
  reason in ordinary ink, on BOTH paths — the durable pane (`ToolDetail`'s
  `interrupted` prop) and the live never-run body (which reads `notRunKind`
  through `isInterruptedFault`). The planning faults keep the danger `Not run`,
  a plain result keeps `Output`, a real failure keeps `Error`, and a legacy
  record with no kind keeps today's behaviour.
- **D2 (glyph-only state word), recorded deliberately.** The interrupted row
  carries its state as the hueless slashed circle plus the `sr-only`
  announcement; that is the pre-existing treatment of user-stopped calls, and
  the vocabulary matches the TUI's own `interrupted ⊘`. No hover word or legend
  is added here; both remain the design round's call to make.
- **D3 (narrow / small-view states), closed.** The two narrow stories above
  capture the collapsed and expanded durable skip at 720px.

## How to re-run it

```sh
node_modules/.bin/storybook dev -p 6188 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6188 \
  --only=chat-interrupted-rows \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
```

`--allow-backend` is the rig's documented exemption for a `--only` run (the
operator's daemon answers on :1111); these stories are static fixtures that
contact no backend. On a cold Storybook, warm the story modules once (fetch
each story's `iframe.html` until it answers) before the run: the first take of
this set aborted because Vite's dependency optimisation outran the rig's 60 s
story deadline, and the failure message names the probe's own counters.
