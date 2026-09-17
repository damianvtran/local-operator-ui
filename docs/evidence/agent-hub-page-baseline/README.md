# Agent hub — the `before` half

The populated grid as **unmodified `origin/main`** renders it, captured for the
pair whose `after` half is `docs/evidence/agent-hub-page/`. Same story id, same
fixtures, same viewport, same twelve themes.

## What produced these frames

A second worktree at `origin/main` (`da9e75a61`, the 0.25.16 merge; `4cdd06a0a`
before it), `pnpm install`, its own Storybook, and the same rig:

**Both bases, so the pair can be re-checked rather than trusted.** The `after`
half was rebased three times and its current merge-base with `origin/main` is
`740796091`, not the `da9e75a61` this set was captured from. The pair still
isolates the change, and that is checkable rather than argued:
`git diff da9e75a61 740796091 -- src/renderer/src/features/agent-hub` is empty, so
the hub files are byte-identical at both, and the sidebar-relevant difference
between the two commits is one unrelated file (`run-panel.tsx`) — which the
`chat-sidebar-agents` set's own README covers by capturing no `before` half at
all.

```
node scripts/capture-evidence.mjs http://localhost:<port> --only=agent-hub-page --allow-backend
```

**One thing in that worktree was patched, and it is the transport.** Main's
story stubs `window.fetch`, which the hub stopped using when every Radient call
moved onto `window.api.desktop.request`; the committed story therefore answered
nothing and renders the page's load error. The baseline tree's story file swaps
that stub for a desktop bridge that answers `capabilities`, `account`,
`agents.list`, the three per-card count reads, and the two per-card status reads
(`agents.liked`, `agents.favourited`) — every request the pre-change page issues,
so the fan-out is visible rather than hidden behind a broken stub. Main's
fixtures are carried over, extended from eight records to twelve so the page
really is the twelve cards the reading is about. Nothing else was touched:
`git -C <baseline> diff --name-only` names that one story file.

The same bridge publishes its request ledger, so the `before` column of
`agent-hub-page/README.md`'s table is read off this tree rather than reconstructed
from the diff.

## What these frames do NOT prove

- **Not that main's hub always looked like this.** With its committed `fetch`
  stub in place, this story photographed a load error; the frames here are of the
  hub with its transport answered by hand, which is the state a user saw.
- **Not what a real backend sends.** The payloads are fixtures, as in the `after`
  set — the same ones, so the pair differs in the hub's own code and nothing else.
- **Not a `main` that includes the change.** This set is `origin/main` at
  `da9e75a61`; the `after` set is the branch, rebased onto a base that has since
  moved to `740796091`. The hub files are byte-identical across those two commits
  (`git diff da9e75a61 740796091 -- src/renderer/src/features/agent-hub` is
  empty), so the pair isolates the change rather than a move of `main` — re-check
  it with that command rather than taking this sentence's word for it.
- **Not the sidebar.** `chat-sidebar.tsx` has moved twice across this branch's
  rebases
  (main's current-row work), which is the reason this baseline set carries the
  hub only: the sidebar's new states have no `before` to compare against, and the
  `after` frames for them are from this branch's own tree.
