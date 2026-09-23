# Model picker — matching a model's human name

Before/after frames for the desktop model picker's search fix: the operator
typed `grok 4.7` and got `Nothing matches.` while `openrouter/x-ai/grok-4.7` and
`openrouter/openai/gpt-6-luna` sat in the catalogue.

These are PNG frames from the `browser` tool driving the real picker in
Storybook (the production `ModelPicker`, its real `options` mapping, its real
`PickerHost` rows and footer), with the desktop transport stubbed — the same
surface `src/renderer/src/features/chat/pickers/model-picker.stories.tsx`
documents. They are NOT sweepable by `scripts/capture-evidence.mjs`: that sweep
renders fixed stories and walks `.webp`, while these are the same story driven
through a typed query, so they are declared as a supplementary set with
`frames: 0` (the walker's count against it).

## The pair, and why it is causal

Each `before-*` frame is `origin/main` (base `5d000b49d`) and each `after-*` is
this branch, with the SAME catalogue fixture and the SAME story in both — the
one thing that differs is the filter code. The fixture's two new rows carry only
`listing_name` (`SpaceXAI: Grok 4.7`, `OpenAI: GPT-6 Luna`); their `label`
degrades to the selector, exactly as the backend's naming-honesty rule serves an
aggregator row, which is what makes `grok 4.7` a real case rather than one a
pretty label would already have answered.

| Query | Before (`origin/main`) | After (this branch) |
| --- | --- | --- |
| `grok 4.7` | `before-grok-4.7.png` — **Nothing matches.** | `after-grok-4.7.png` — `x-ai/grok-4.7` resolves |
| `gpt 6 luna` | `before-gpt-6-luna.png` — **Nothing matches.** | `after-gpt-6-luna.png` — `openai/gpt-6-luna` resolves |
| `gemini` (genuinely no match) | `before-empty.png` — **Nothing matches.** | `after-empty.png` — **Nothing matches.** (unchanged) |
| `spacexai` (name-only) | — | `after-spacexai.png` — `x-ai/grok-4.7` resolves |
| `...` (punctuation only) | — | `after-punctuation-only.png` — **Nothing matches.**, not the whole catalogue |

The empty pair is the control: a query that matches nothing must still match
nothing, so the fix is a widening of the haystack and not a "return everything"
fallback. The `spacexai` frame is the name-only case (`spacexai` appears in no
id) and the `...` frame is the punctuation-only case, which must NOT fall into
the list-everything branch.

## The rule, in one line

Lowercase, then every run of non-alphanumerics collapses to a single space —
applied to the query and the haystack alike, mirroring
`local_operator/model/ranking.py`'s `_match_key`. Membership only: adding the
name as a match target can only keep a row, so the resting order (the
`Populated` frame) is byte-identical between the two trees.
