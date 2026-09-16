# Agent hub — the `before` half

The populated grid as **unmodified `origin/main`** renders it, captured for the
pair whose `after` half is `docs/evidence/agent-hub-page/`. Same story id, same
fixtures, same viewport, same twelve themes.

## What produced these frames

A second worktree at `origin/main` (`da9e75a61`, the 0.25.16 merge; `4cdd06a0a`
before it, and the hub files are identical on both),
`pnpm install`, its own Storybook, and the same rig:

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
  `da9e75a61`; the `after` set is the branch, rebased onto that same commit. The
  hub files are identical between the two trees (`git diff --stat origin/main --
  src/renderer/src/features/agent-hub` is empty of the branch's own work), so the
  pair isolates the change rather than a move of `main`.
- **Not the sidebar.** `chat-sidebar.tsx` has moved twice across this branch's
  rebases
  (main's current-row work), which is the reason this baseline set carries the
  hub only: the sidebar's new states have no `before` to compare against, and the
  `after` frames for them are from this branch's own tree.
