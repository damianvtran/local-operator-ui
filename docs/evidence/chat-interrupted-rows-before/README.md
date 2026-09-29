# Interrupted calls before the fix: the operator's report

The BEFORE half of [`../chat-interrupted-rows/`](../chat-interrupted-rows/), and
the half that shows WHAT was wrong. The operator reported (2026-09-28) that a
steering-skipped call expanded to `Error / Tool call skipped: interrupted by
steering.` and read `failed` on its row, and that live never-run rows painted
`never ran` in danger ink — the ledger's failure treatment, on calls no tool
ever met and on calls a person stopped.

## How this set was captured

`scripts/capture-evidence.mjs` run against a throwaway checkout of the base this
branch folds onto — `origin/main`, read whole at the first fold (`b897ebeb93`)
and re-read for one story at the second (`160faa5f9f`) — so every frame is the
BASE tree's own reducer, transcript and detail pane, i.e. the shipped pre-fix
classification a sweep of the current tree can no longer photograph. Review
round 2 re-read the `skip-durable` pair (its caption had kept the
pre-remediation wording); the two bases differ in no file under
`src/renderer/src/features/chat` (`git diff b897ebeb93..160faa5f9f --` there is
empty), so the eighteen frames are pictures of one story:

```sh
# in a throwaway checkout of the fold base (b897ebeb93; the skip-durable pair
# re-read at 160faa5f9f with --only=chat-interrupted-rows-before--skip-durable),
# with this branch's story file and
# fixture copied in, the story's title temporarily suffixed `before`, and the
# nine matching rows temporarily present in the STORIES table of
# capture-evidence.mjs (all restored to the committed head afterwards):
node_modules/.bin/storybook dev -p 6188 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6188 \
  --only=chat-interrupted-rows-before \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
```

The story (`src/renderer/src/features/chat/canonical/
interrupted-rows.stories.tsx`) and its fixture (`scripts/fixtures/
interrupted-rows.json`) are the branch's own and live in the shipped tree; they
only build states from the wire shapes, which is why the base tree reads them
correctly. `--allow-backend` is the rig's documented exemption for a `--only`
run (the operator's daemon answers on :1111); these stories are static fixtures
that contact no backend. Two themes, the two brand palettes: the claim spans
both ink ramps, and no other palette moves a classification.

## What each frame shows

| Story | What it shows |
| --- | --- |
| `skip-live` | The steering skip as a live turn settles it: `Ran · never sent · 2.0 KB composed`, with **`never ran` in danger ink** in the status column — the failure treatment, on a call that was never sent to a tool. |
| `skip-live-expanded` | The same live row, opened: the body reads **`Not run` in danger ink** with the reason in danger ink — a stop told a failure's story in the live expansion. |
| `skip-durable` | The same call AFTER A RELOAD, opened: the durable row keeps `isError` from the synthetic result, so it wears the danger wash, the **`failed`** word, and an **`Error`** label over `Tool call skipped: interrupted by steering.` — the operator's exact expansion. Its foot reads `1 failed`. |
| `stop-mid-flight` | A call killed by the user's stop, from the end event's own `aborted` marker with no client stop window standing: **`failed`** + danger wash + the measured `0.5s`, because the marker is invisible to this tree. |
| `stop-expanded` | The same wire-marked stop, opened: the body reads **`Error` in danger ink** over `aborted`, and the args above it stay in ordinary ink. |
| `genuine-failure` | The CONTROL: a call that really ran and failed (`execution` fault) — `failed` word, danger row, `Error` label. This is what the treatment above is FOR, and what a fix must not move. |
| `turn-counts` | One closed turn with three calls (the first is the skip), folded: the group chip reads **`1 failed`** and the foot reads `Worked for 12s · 3 actions · 1 failed` — both counters count the skip. |
| `skip-durable-narrow` | The durable skip at the pane's 720px narrow / small-view width, collapsed: the row's mark is the danger word `never ran`. |
| `skip-durable-narrow-expanded` | The same narrow state, opened: the row wears the danger wash and the `failed` word, and the body's label reads `Error` in danger ink over the skip's reason — the whole failure treatment at the small-view width. |

## Why a story and not the live app

The states are the reported ones plus the two the design round asked for — a
steering skip needs a redirect to land mid-batch and a user stop needs the
press at the right instant, and the classification is a pure function of the
wire frames the fixture carries. The live-app half is
`scripts/interrupt-esc-proof.mjs` (its frames live in `../interrupt-live/`),
which exercises the press itself; the CONTRACT the frames here verify is the
reducer's and the components' reading of `not_run_kind` and `details.__fault`,
which is the same code path live in the app.

No frame here is re-derivable by a sweep: a sweep photographs the current tree,
where the pre-fix classification no longer exists. This is the set's own
record, declared supplementary in `../manifest.json`.
