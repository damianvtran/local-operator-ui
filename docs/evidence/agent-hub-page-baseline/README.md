# Agent hub — the `before` half

The populated grid as **unmodified `origin/main`** renders it, captured for the
pair whose `after` half is `docs/evidence/agent-hub-page/`. Same story id, same
fixtures, same viewport, same twelve themes.

## What produced these frames

A second worktree at `origin/main` (`da9e75a61`, the 0.25.16 merge; `4cdd06a0a`
before it), `pnpm install`, its own Storybook, and the same rig:

**Both bases, so the pair can be re-checked rather than trusted.** The `after`
half has been folded onto `origin/main` five times; its current merge-base is
`2f85777b0` (the 0.28.2 window), not the `da9e75a61` this set was captured from.
Of the five files under `src/renderer/src/features/agent-hub` that changed
between those two commits, four changed COMMENTS only — checked rather than
asserted, by taking the diff's `+`/`-` lines that are not comment lines and
finding none:

```
git diff da9e75a61 2f85777b0 -- \
  src/renderer/src/features/agent-hub/agent-card.tsx \
  src/renderer/src/features/agent-hub/agent-details-page.tsx
git diff --name-only da9e75a61 2f85777b0 -- \
  src/renderer/src/features/agent-hub/agent-hub.stories.tsx    # empty
```

so the story these frames photograph renders identically at both bases and the
pair still isolates this branch's change. The fifth file,
`use-download-agent-mutation.ts`, DID change on `main`: its pull refusals grew a
`pullRefusalMessage` toast. That is the one semantic merge of this branch's fold
— this branch renders that failure inline beside the control that produced it,
and two channels cannot announce one failure, so the toast went and the hook
carries the backend's sentence on `mutation.error`. Nothing in these frames is of
it, because the change renders on a pull and this set photographs a settled grid;
which is also why the pair says nothing about that surface either way.

**When these frames were taken, and how the manifest's entry says so.** The entry
for this set carries a `capturedAt` DERIVED rather than invented (design round 2,
D4). `git log -1 --format=%cI -- docs/evidence/agent-hub-page-baseline` at
`5b14b58aa` returns the commit date of `6504cdaa9`, this directory's last write
before the round-2 pass; the frames themselves were added to the branch by
`01d6a12e2`. Those two differ because `6504cdaa9` rewrote this README after the
frames had landed. Neither is a wall clock: the capture ran in a second worktree,
and the repository does not record when.

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
- **Not a `main` that includes the change**, and not a `main` that is this
  branch's own base either: this set is `origin/main` at `da9e75a61`, while the
  `after` half is the branch, now folded onto `2f85777b0`. The hub components
  differ between the two commits in comment text only and the story file not at
  all — the commands above are the check, rather than this sentence's word — so
  the pair isolates the change rather than a move of `main`. What it does NOT
  cover is the pull's failure channel: `main` changed it in between and this
  branch resolved that semantic merge differently (above).
- **Not the sidebar.** `chat-sidebar.tsx` has moved twice across this branch's
  rebases
  (main's current-row work), which is the reason this baseline set carries the
  hub only: the sidebar's new states have no `before` to compare against, and the
  `after` frames for them are from this branch's own tree.
