# The session band's model-access statement

One directory per state, one `.webp` per palette, taken with the repository's
own rig (`scripts/capture-evidence.mjs`) against Storybook — the same shape the
picker set next door documents, and `localOperatorDark` plus `localOperatorLight`
for the same reason: the second palette is where a contrast defect hides.

Both stories render the PRODUCTION `SessionModelAccessBand` — the component the
composer's standing band mounts — with a fixed reading. The story file itself
states what to look for (the provider named rather than a selector, both actions
underlined at rest, the inset the composer column shares) and its own limits;
this README does not repeat them.

| Directory | What it shows |
|---|---|
| `signed-out` | The shipped composer column's width: `Not signed in to Anthropic (Claude Pro/Max)` over the sentence that says what the state means for the session, with `Switch model` and `Connect` as two underlined actions. |
| `signed-out-narrow` | The same state at the narrow view's inset, where the sentence wraps and the actions wrap below it. |

## What produced these frames

```sh
node scripts/capture-evidence.mjs http://localhost:6137 --allow-backend \
  --only=chat-session-model-access-band \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=120000
```

`--allow-backend` is the rig's refusal of a partial run while a Local Operator
backend answers on `localhost:1111`, which one does on this machine; nothing
here reads it — the band's reading is a prop. `--theme-settle-ms=120000` is the
documented knob for a boot on a loaded host (the picker README's note on the
same flag applies verbatim).

## What these frames do NOT prove

- **Nothing about when the band appears.** Its gate — the session summary
  publishing `model_access: signed_out`, and the band rendering nothing at all
  otherwise — lives in `modelAccessReading` and is asserted as source in
  `scripts/session-status.test.mjs`, not photographed. A still cannot show an
  absent element.
- **Nothing about a real provider.** The reading is a fixture built to the
  frozen `model_access` contract; no sign-in state of any account was read.
- **Nothing about the composer beneath the band.** These stories frame the band
  alone; how it sits in a composed column is what the band's own inset was
  chosen for, and the composer's frames are its own set.
