# Baseline frames: the trace labels, before the fix

Four frames of two stories, captured with the same tooling
(`scripts/capture-evidence.mjs`) and the same story files from **unmodified
`origin/main` at `786fbbd056`** — the base the fixing branch was folded onto,
and the state the operator's report of 2026-09-27 describes.

They exist because the fixed frames cannot show what was wrong. Read the pairs:

| surface | here (unmodified `main`) | on the branch |
| --- | --- | --- |
| rows (`Chat/Tool rows / ToolOps`) | `Delegated list`, `Delegated designer`, `Delegated docs-writer`, `Messaged peek 3`, `Called lsp …`, `Called project ui-update-account-robustness` | `Listed agents …`, `Viewed agent designer`, `Created agent docs-writer`, `Peeked at 3`, `Found definition …`, `Viewed project ui-update-account-robustness` |
| the project family's glyphs | a wrench on every `project` row (the operator's follow-up screenshot: `Called project ui-update-account-robustness` under the generic wrench) | the board mark on `project`; `project_delete` keeps the wrench, as the TUI's `*_delete` tools do |
| fold (`Chat/Trace fold / AgentOps`, the operator's own shape) | `Explored 4 files, delegated 3 tasks` | `4 files · 3 agents` |
| the rows frame's fold header (a mixed ops run) | `3 tasks · 3 project · 2 hub · 1 console · 1 lsp · 1 network · 1 project_delete · 1 secret · 1 wait` | `3 agents · 1 team · 2 subagents · 3 projects · 1 code lookup · 1 console · 1 network call · 1 project deletion · 1 secret · 1 wait` |

## Why these live outside their swept sets

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these four, which need a different SOURCE TREE rather than a different fixture —
therefore has to be its own declared set at the top level, or the next sweep
deletes it and the manifest's arithmetic stops matching the disk. That is what
the `supplementary` entry for `tool-ops-baseline` in `manifest.json` is for, and
it is the same mechanism `tool-rows-baseline` uses.

## Reproducing them

```sh
git worktree add <scratch>/ui-trace-ops-baseline 786fbbd056
cd <scratch>/ui-trace-ops-baseline && pnpm install --prefer-offline
# the story files and the capture script must come from the fixing branch: the
# stories do not exist on main, and the capture list has to name their ids.
# Every SOURCE file the stories render from stays main's.
cp <branch>/src/renderer/src/features/chat/canonical/tool-row.stories.tsx \
   src/renderer/src/features/chat/canonical/tool-row.stories.tsx
cp <branch>/src/renderer/src/features/chat/components/trace/trace-fold.stories.tsx \
   src/renderer/src/features/chat/components/trace/trace-fold.stories.tsx
cp <branch>/scripts/capture-evidence.mjs scripts/capture-evidence.mjs
pnpm storybook -p 6022 &
node scripts/capture-evidence.mjs http://localhost:6022 --only=ops \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is required whenever the operator's own Local Operator app is
listening on `127.0.0.1:1111`: these stories render from fixtures and never call
it, but the guard cannot know that.

The base tree writes its frames to the same paths the branch uses
(`docs/evidence/chat-tool-rows/tool-ops/<theme>.webp` and
`docs/evidence/chat-trace-fold/agent-ops/<theme>.webp`); they were copied into
this set's `rows/` and `fold/` leaves as found, two themes each.

## The rows frames were re-taken for the project family

On 2026-09-27 the operator's follow-up (a project VIEW rendering `Called project
ui-update-account-robustness` under the generic wrench) added three rows to the
rows fixture, so the rig above was re-run at the same base commit and the four
`--only=ops` frames were re-taken: the rows frames now carry the project family,
and the fold frames came back byte-identical (nothing on main draws them
differently). Everything else about the recipe - the base commit, the carried
story files, the capture script - is unchanged, which is why this set is still
two states photographed from unmodified `origin/main`.
