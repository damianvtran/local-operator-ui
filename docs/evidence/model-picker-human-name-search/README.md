# Model picker — matching a model's human name

Before/after frames for the desktop model picker's search fix: the operator
typed `grok 4.7` and got `Nothing matches.` while `openrouter/x-ai/grok-4.7` and
`openrouter/openai/gpt-6-luna` sat in the catalogue.

These are PNG frames from the `browser` tool driving the real picker in
Storybook (the production `ModelPicker`, its real `options` mapping, its real
`PickerHost` rows and footer), with the desktop transport stubbed — the same
surface `src/renderer/src/features/chat/pickers/model-picker.stories.tsx`
documents. They are NOT sweepable by `scripts/capture-evidence.mjs`: that sweep
renders fixed stories and walks `.webp`, while these are a story driven through
a typed query, so they are declared as a supplementary set with `frames: 0`
(the walker's count against it).

## The pair, and why it is causal

Each `before-*` frame is `origin/main` (base `5d000b49d`) and each `after-*` is
this branch, with the SAME catalogue fixture and the SAME story file in both —
the one thing that differs is the filter code. The fixture carries the words the
operator's OWN listings publish (`Grok 4.7`, `GPT-6 Luna`, `Claude Opus 5.5`,
`Nano Banana`, read out of `~/.local-operator/cache/models-dev.listing.json`),
so a frame answers a query a user can actually type.

| Query | Before (`origin/main`) | After (this branch) |
| --- | --- | --- |
| `grok 4.7` | `before-grok-4.7.png` — **Nothing matches.** | `after-grok-4.7.png` — `x-ai/grok-4.7` resolves |
| `gpt 6 luna` | `before-gpt-6-luna.png` — **Nothing matches.** | `after-gpt-6-luna.png` — `openai/gpt-6-luna` resolves |
| `nano banana` (name-only) | `before-nano-banana.png` — **Nothing matches.** | `after-nano-banana.png` — `google/gemini-2.5-flash-image` resolves |
| `5.4` (the field-boundary case) | `before-5.4.png` — `GPT-5.4`, one row | `after-5.4.png` — `GPT-5.4`, one row (the fix keeps base's answer; the superseded revision returned `gpt-6-luna` as well) |
| `opus 5.5` | `before-opus-5-5.png` — one row (the direct 5.5) | `after-opus-5-5.png` — two rows: the direct 5.5 and its `openrouter` route, whose listing name `Claude Opus 5.5` carries the query |
| `opus 5` | `before-opus-5.png` — two rows | `after-opus-5.png` — three rows, the third being `openrouter/anthropic/claude-opus-5.5` |
| `zzz` (genuinely no match) | `before-empty.png` — **Nothing matches.** | `after-empty.png` — **Nothing matches.** (unchanged) |
| `...` (punctuation only) | — | `after-punctuation-only.png` — **Nothing matches.**, not the whole catalogue |

The IMMOVABLE controls are `5.4` and `zzz`: measured on the shipped pairs, each
is byte-equal between the trees to within the caret blink (AE 0.0017% of a
3.69 M-px frame, ±0 rows). A query that matches nothing must still match
nothing, so the fix is a widening of the haystack and not a "return everything"
fallback; and `5.4` shows the widening is BOUNDED at a field boundary — it is
the one the superseded revision broke (that revision's joined haystack fused the
Luna row's `… · $3/15` with its `400k` into `3 15 400k`, in which `5 4` is a
substring of `1[5 4]00k`, so it resolved `gpt-6-luna` too).

The `opus 5.5` and `opus 5` pairs are NOT controls: each gains exactly one row
in the head frame (AE 14.36% and 14.58%, +1 row — the dialog grows 325.5 → 375
and 375 → 424 CSS px). The row is the aggregated `openrouter/anthropic/claude-opus-5.5`,
whose listing name `Claude Opus 5.5` carries the query — the fix working, on a
row the user asked for. They ship as a third demonstration of the widening, not
as evidence that it is bounded. `...` is likewise a fixed after-only case, not
an immovable one: it has no `before` half because a lone `.` matched five rows
on base rather than nothing.

The `nano banana` frame is the name-only case: an aggregator's row is labelled
with its selector, so those two words appear in no id the row carries and only
the listing name can answer them.

## The rule, in one line

Lowercase, then every run of non-alphanumerics collapses to a single space —
applied to the query and to EACH FIELD SEPARATELY, never to a joined haystack,
mirroring `local_operator/model/ranking.py`'s `_match_key` and its per-target
scoring. A row matches when one of its own strings does; no field is ever
concatenated with another before normalising, which is what a field boundary
would otherwise be able to match across. Membership only: the caller's order is
preserved and no row is promoted, so the resting order (the `Populated` frame)
is unchanged between the two trees.

## How to reproduce

```
npx storybook dev -p <private-port> --ci --no-open      # in each tree
```

Then drive the picker in a browser: for `grok 4.7` load
`chat-model-picker--human-name-search`, for `nano banana`
`chat-model-picker--listing-name-only-search`, for `opus 5.5`
`chat-model-picker--opus-minor-search`, and for the rest load
`chat-model-picker--populated` and type the query into the search box. The
`before-*` tree is a worktree at `5d000b49d` carrying THIS branch's
`model-picker.stories.tsx` (the fixture and the story are the same on both
sides; only the filter differs). Both dev servers were reaped by pid.
