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
predicate (`isInterruptedFault`) now binds that reading across the live seed,
the end events and the durable rows, and the row's outcome ladder takes it.

## What each frame shows

| Story | What it is evidence of |
| --- | --- |
| `skip-live` | The steering skip as a live turn settles it (`not_run_kind: "skipped"` on the verdict): the row is the interrupted class — the hueless slashed circle where the before frame read `never ran` in danger ink — and the summary keeps the harness's own record of how far the model got (`never sent · 2.0 KB composed`). |
| `skip-durable` | The SAME call after a reload, opened: the durable row is an interrupt (no danger wash, no `failed` word) and its reason reads under `Output` instead of `Error` — the operator's exact expansion, corrected. Its foot reads `1 action`, not `1 failed`. |
| `stop-mid-flight` | A call killed by the user's stop, from the end event's own `aborted` marker with NO client stop window standing — the reading a replay, a second window or a fresh attach gets. The wire fact alone classifies the row as interrupted and the measured `0.5s` is kept. |
| `genuine-failure` | The CONTROL: a call that really ran and failed (`execution` fault). It keeps its danger row, its `failed` word and its `Error` label — and its two frames are **byte-identical across the halves (AE 0, both themes)**. |
| `turn-counts` | One closed turn with three calls (the first is the skip), folded: the group chip reads `Explored 1 file, ran 2 commands` and the foot reads `Worked for 12s · 3 actions` — the `1 failed` both counted before is gone, and no counter predicate was re-implemented (both read `isError`, which the fix clears). |

## The measured pair

Plain `magick compare -metric AE` against
[`../chat-interrupted-rows-before/`](../chat-interrupted-rows-before/), same
story, same fixtures, each half's own tree:

| Story | AE dark | AE light |
| --- | --- | --- |
| `skip-live` | 2,372 of 1,024,000 | 1,728 |
| `skip-durable` | 47,383 | 39,427 |
| `stop-mid-flight` | 22,367 | 21,665 |
| `genuine-failure` | **0** | **0** |
| `turn-counts` | 23,953 | 22,130 |

**Two themes, not twelve.** The claim is a classification — which word, which
glyph, which ink — and the twelve-theme sweep is not re-run for it (both brand
palettes carry every channel the claim touches: the danger word and wash, the
hueless mark, the labels). The frames are lossy WebP (q88), so a pair whose
content differs anywhere can shift a few pixels of anti-aliasing on text the
change does not touch; the control pair at AE 0 is what shows the pipeline is
otherwise byte-reproducible, and the diff images concentrate on the rows, the
labels and the counters the change is about.

## The design note this PR carries

- With `isError` cleared, a durable skip reads `Output` — the mechanical
  consequence of the classification. Whether skipped rows should get their own
  label (rather than the plain output label) is the design round's call; this
  PR deliberately ships the plain treatment.
- The live verdict's expanded body keeps its existing `Not run` label; the row's
  own state word for `interrupted` remains the `sr-only` announcement beside the
  hueless mark (the visible word was, before this change, the danger `never ran`).
- The summary text (`never sent · N composed`, and the reason inside it) is
  unchanged — the row says WHY in the same words, it just stops labelling the
  call a failure.

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
contact no backend. The before half's recipe is in
[`../chat-interrupted-rows-before/README.md`](../chat-interrupted-rows-before/README.md):
the same five stories, the same fixtures, against the base tree's reducer.
