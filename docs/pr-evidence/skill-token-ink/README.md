# `$skill` token ink in a sent turn

Operator ask (2026-11-03): a skill invoked with `$<skill-name>` reads differently
from the prose around it in the transcript - another colour AND bold, from a theme
role. These frames are the before/after for that change. They are PR evidence, not
part of the evidence manifest (`docs/evidence/manifest.json` is untouched).

## Fixture

Story `Chat/Canonical skill token ink`
(`src/renderer/src/features/chat/canonical/skill-token-ink.stories.tsx`), the real
`CanonicalTranscript` over a hand-built transcript at 760 x 960 CSS px, captured at
2x (1520 x 1920). Time labels are pinned to `America/New_York`, as the main rig does.
Every user row carries the wire shape of an invocation: the typed line, a blank line,
then the `<operator-skills>` block written by `renderSkillBlock`.

| Row | Typed line | Expected |
| --- | --- | --- |
| user 1 (skills attached: `research`, `code-review`) | ``use $research then $code-review to check $5 and \$escaped, and run `$research` in code`` | `$research` and `$code-review` inked; `$5`, `\$escaped` and the code span plain |
| assistant | the agent's own `$research` / `$code-review` | plain, never inked |
| user 2 (skill attached: `research`) | `ask $research about this:` + a fenced block holding `$research --help` + `and then summarise.` | the prose token inked; the fenced one plain |
| user 3 (no skill attached) | ``the plan costs $5 a month, or $1,200.50 a year, plus $PATH`` | nothing inked |

## Frames

Pairs share the same story, viewport, crop and timezone; BEFORE is a checkout of
`origin/main` (`e6a9b59b8d`) with only the story file copied in, AFTER is this branch.

| File | What it shows |
| --- | --- |
| `before-localOperatorLight.png` / `after-localOperatorLight.png` | Light brand palette. Before: every `$token` is body colour. After: `$research` and `$code-review` in the first bubble and the prose `$research` in the second bubble (three tokens, per `measurements.json`) are blue `tokenCommand` at weight 600. |
| `before-localOperatorDark.png` / `after-localOperatorDark.png` | Dark brand palette, same story. After: the same tokens in the dark palette's light blue, bold. |
| `before-obsidian.png` / `after-obsidian.png` | The monochrome palette, where `tokenCommand` IS `ink`: colour cannot separate, so the 600 weight alone marks the token (the recorded case in `docs/branding.md`). |
| `after-by-turn-localOperatorLight.png`, `after-by-response-localOperatorLight.png` | The transcript view setting (`transcriptDisplayMode`) set to each value before render. Byte-identical to each other and to the default after-frame: the ink does not depend on the view. |

`measurements.json` holds the computed style read from the live DOM at capture time
(token colour/weight vs prose colour/weight, and the list of inked token texts).
`capture-driver.mjs.txt` is the one-browser capture driver used (a private
`--headless=new` Chrome over raw CDP, as `scripts/capture-evidence.mjs` does; it writes
only into this directory and never touches the manifest). It carries a `.txt` suffix so
it is not picked up as a repo script.

## Capture command

```sh
# BEFORE: a worktree at origin/main with the story file copied in; AFTER: this branch.
# Storybook is booted and reaped by scripts/with-storybook.mjs; Chrome is headless.
cp docs/pr-evidence/skill-token-ink/capture-driver.mjs.txt "$SCRATCH/capture-driver.mjs"
OUT=docs/pr-evidence/skill-token-ink BEFORE_ORIGIN=<before storybook> AFTER_ORIGIN=<after storybook> \
  node "$SCRATCH/capture-driver.mjs"
```
