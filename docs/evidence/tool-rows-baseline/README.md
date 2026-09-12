# Baseline frames: the tool-row join, before the fix

Two frames of the story `Chat/Tool rows / JoinedMidTurn`, captured with the same
tooling (`scripts/capture-evidence.mjs`) and the same fixture from **unmodified
`origin/main` at `2217ea59a`** — the state the operator reported.

They exist because the fixed frames cannot show what was wrong. Read the pair:

| row | here (unmodified `main`) | `chat-tool-rows/joined-mid-turn/` |
| --- | --- | --- |
| the join's recreated row | `exit code: 0` | `sed -n '1130,1230p' src/main/update-service.ts` |
| unknown arguments, `bash` | `exit code: 0` | `… === /Volumes ===` |
| unknown arguments, `read` | `1130\|  private setupUpdateEvents(): void {` | `… 1130\|  private setupUpdateEvents(): void {` |
| silent call (printed nothing) | *not in this set* | *empty object column* |
| control (arguments on the start) | `pnpm check-types && pnpm test:desktop` | *(unchanged)* |

## Why these live outside `chat-tool-rows/`

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these two, which need a different SOURCE TREE rather than a different fixture —
therefore has to be its own declared set at the top level, or the next sweep
deletes it and the manifest's arithmetic stops matching the disk. That is what
the `supplementary` entry for `tool-rows-baseline` in `manifest.json` is for, and
it is the same mechanism `sidebar-new-chat` uses.

## Reproducing them

```sh
git worktree add /tmp/ui-baseline origin/main
cd /tmp/ui-baseline && pnpm install --prefer-offline
# the story file and the capture script must come from the fixing branch: the
# story does not exist on main, and the capture list has to name its id. Every
# SOURCE file the story renders from stays main's.
cp <branch>/src/renderer/src/features/chat/canonical/tool-row.stories.tsx \
   src/renderer/src/features/chat/canonical/tool-row.stories.tsx
cp <branch>/scripts/capture-evidence.mjs scripts/capture-evidence.mjs
pnpm storybook -p 6022 &
node scripts/capture-evidence.mjs http://localhost:6022 --only=joined-mid-turn \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is required whenever the operator's own Local Operator app is
listening on `127.0.0.1:1111`: these stories render from fixtures and never call
it, but the guard cannot know that.
