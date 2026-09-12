# Baseline frames: the ask gate's options, before they were clickable

Ninety-six frames — eight stories across all twelve themes — of the story file
`Chat/Ask options`, captured with the same tooling
(`scripts/capture-evidence.mjs`), the same fixtures and the same viewports from
**unmodified `origin/main` at `a09f2e6f4`**, which is byte-identical to this
branch's base `1771b0053` apart from a version bump in `package.json`.

They exist because the fixed frames cannot show what was wrong. The defect is
an ABSENCE — nothing on the card was pressable — and an absence does not
photograph. Read the pair:

| | here (unmodified `main`) | `chat-ask-options/` |
| --- | --- | --- |
| the options | inert muted text, one line each | a bordered, focusable control each |
| label and consequence | run together on one line, joined by an em dash | label on its own line, consequence beneath it |
| the recommended option | not marked at all — `recommended` was not in the TS type | marked `RECOMMENDED` in accent beside the label |
| the hint below | "Type your answer below." | "Choose an option, or type your own answer below." |
| answering | retype a label, or type `1` and have the agent receive the string `"1"` | press the option, or type `1` and have it resolve to that option's label |
| an answer in flight | no such state — there was nothing to press | every option disabled by colour, never opacity |
| a secret ask | no options (unchanged) | no options (unchanged) |
| an approval gate | "Reply yes or no in the composer." (unchanged) | identical — this change is scoped to `ask` |

The two sets that should look the SAME are as important as the six that differ:
`secret-ask` and `approval-unchanged` are the non-goals, and the pair is what
proves they were not disturbed.

## Reproduction

```sh
git worktree add /tmp/ask-baseline --detach origin/main   # a09f2e6f4
cd /tmp/ask-baseline && pnpm install --frozen-lockfile
# Copy this branch's story file in, then delete the two props main's
# CanonicalTranscript does not have (`onAnswer`, `answering`) — the fixtures,
# the viewports and the component under them are otherwise untouched.
pnpm storybook --port 6018 --no-open --quiet &
node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=chat-ask-options --allow-backend
```

`--allow-backend` is correct here and is not a loosened guard: it is accepted
only on a NARROWED run, and these stories render from literal
`PendingDesktopGate` fixtures with a no-op `onAnswer`, so no frame in this set
can contain a backend's reply. The operator's own backend was live on :1111
throughout.

## Why these live outside `chat-ask-options/`

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these ninety-six, which need a different SOURCE TREE rather than a different
fixture — therefore has to be its own declared set at the top level, or the
next sweep deletes it and the manifest's arithmetic stops matching the disk.
This follows `tool-rows-baseline` exactly, for exactly that reason.
