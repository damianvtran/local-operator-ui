# Baseline frames: the sessions tool's trace rows, before the glyph/label mapping

Two frames of one story, captured with the same tooling
(`scripts/capture-evidence.mjs`) and the same story files from **unmodified
`origin/main` at `34ac02d33c`** — the head the fixing branch was cut from, and
the state the desk's trace rows were in before the sessions lane
(sibling `damianvtran/local-operator` #1825).

They exist because the fixed frames cannot show what was wrong. Read the pair:

| surface | here (unmodified `main`) | on the branch |
| --- | --- | --- |
| rows (`Chat/Tool rows / SessionsOps`) | `Called sessions list`, `Called sessions release`, `Called sessions release-crew`, `Called sessions night-audit`, `Called sessions spawn ephemeral`, `Called sessions resume 5d3f2a9c`, `Called sessions stop 48213`, `Called sessions night-audit flaky`, `Calling sessions queue-watch` — the generic wrench on every row, the selector leaking into the object, and no op, visibility or window drawn | `Listed sessions`, `Listed sessions stored · release`, `Viewed session release-crew`, `Spawned session workstream · night-audit`, `Spawned session ephemeral · try the shard twice and report`, `Resumed session 5d3f2a9c`, `Stopped session pid 48213`, `Peeked at session night-audit · last 12`, `Peeked at session night-audit · search flaky · 6 around`, `Peeked at session night-audit · digest`, `Spawning session workstream · queue-watch` — the second-window glyph, the op's verb, and the discriminator first in the object |
| the fold header | `11 sessions` | `11 sessions` — the noun's own before/after is the SINGULAR case (`1 sessions` before, `1 session` after), which this story's eleven calls cannot show; it is pinned in `scripts/trace-fold-model.test.mjs` instead. |

## Why these live outside their swept sets

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these two, which need a different SOURCE TREE rather than a different fixture —
therefore has to be its own declared set at the top level, or the next sweep
deletes it and the manifest's arithmetic stops matching the disk. That is what
the `supplementary` entry for `sessions-ops-baseline` in `manifest.json` is for,
and it is the same mechanism `tool-ops-baseline` and `tool-rows-baseline` use.

## Reproducing them

```sh
git worktree add <scratch>/ui-sessions-baseline 34ac02d33c
cd <scratch>/ui-sessions-baseline
# the worktree needs deps; on this machine an APFS clone of the primary
# checkout's node_modules is the cheap path (never a fresh install):
cp -Rc ~/local-operator-ui/node_modules node_modules
# the story file and the capture script must come from the fixing branch: the
# story does not exist on main, and the capture list has to name its id.
# Every SOURCE file the story renders from stays main's.
cp <branch>/src/renderer/src/features/chat/canonical/tool-row.stories.tsx \
   src/renderer/src/features/chat/canonical/tool-row.stories.tsx
cp <branch>/scripts/capture-evidence.mjs scripts/capture-evidence.mjs
node_modules/.bin/storybook dev -p 6054 --no-open &
node scripts/capture-evidence.mjs http://localhost:6054 --only=sessions-ops \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is required whenever the operator's own Local Operator app is
listening on `127.0.0.1:1111`: this story renders from fixtures and never calls
it, but the guard cannot know that.

The base tree writes its frames to the same paths the branch uses
(`docs/evidence/chat-tool-rows/sessions-ops/<theme>.webp`); they were copied
into this set's `rows/` leaf as found, two palettes each. The capture's own
manifest write lands in the BASE tree and is not shipped anywhere.
