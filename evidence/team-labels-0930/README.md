# Team display labels — before/after frames

Frames for the pull request that reads a team's optional `label` (a free-text
display name) wherever a person reads its name, taken **for the pull request**
rather than committed into the swept evidence set: the change is a reading of
two frames side by side, the swept set's own rig cannot re-derive the before
half from this branch, and both halves come from a DISPOSABLE fixture tree
(see below). They live on this branch so the PR body can inline them; they are
**not** in the PR's diff and not on `main`.

| file | tree | state |
| --- | --- | --- |
| `before-sections.webp` / `after-sections.webp` | `origin/main` `ee5611a2e4` / the PR branch `a28e9abe0b` | the sidebar's Teams section: one team with a label (`release-crew` / `Release Engineering`) beside one without (`docs-pod`, the slug fallback) |
| `before-header.webp` / `after-header.webp` | same | the chat header's identity chip, at rest, on a team-bound session |
| `before-header-menu.webp` / `after-header-menu.webp` | same | the chip's team menu open (the `commands.entities` rows and the menu's current mark) |
| `before-slash-teams.webp` / `after-slash-teams.webp` | same | the `/team` slash popup with `/team` typed: the first row is the labelled team, highlighted; the rest are slug fallbacks |

## The fixture trick, and what each pair is allowed to claim

The **same story files** are on both trees: `chat-sidebar-sections.stories.tsx`,
`chat-header-identity.stories.tsx` and `slash-commands.stories.tsx` carry one
labelled team and one unlabelled team in their fixtures (copied verbatim onto a
worktree of `origin/main`; storybook does not typecheck, and `label` is an
ignored extra property on the old code). One variable changes between the two
columns: the renderer. A pair therefore shows exactly what the label split
changed, and nothing else.

WHAT A PAIR DOES NOT SHOW: the team PICKER dialog, the agents page's Teams
roster and the projects start-session dialog also carry the change (they read
the same `teamDisplayName` rule), but no capture-rig entry or story exists for
any of them, so the PR's own unit cases are that claim's evidence and no frame
here is a picture of those three surfaces. One theme (`localOperatorDark`),
one size per story; a theme this branch does not photograph is a theme this
pair says nothing about.

## How they were taken

Both trees served Storybook through the repo's own capture rig, from a direct
binary invocation (never `pnpm run`, whose dependency verification would have
tried to reinstall the shared tree):

```sh
# on the PR branch (worktree teams-label-0930-2d33, head a28e9abe0b)
./node_modules/.bin/storybook dev -p 6037 --ci --disable-telemetry --no-version-updates
# and, in a worktree of origin/main (ee5611a2e4) holding the same three
# story files, the same command on -p 6038

node scripts/capture-evidence.mjs http://localhost:6037 \
  --only=<story id> --themes=localOperatorDark --allow-backend
```

one run per story (`chat-sidebar-sections--resting-default`,
`chat-header-identity--team-bound`, `chat-slash-completion--argument-phase-teams`),
then the same three runs against `:6038`. `--allow-backend` because another
session's `local-operator serve` was answering on 1111 for the whole pass and
every story here stubs `window.api.desktop.request`; the rig's default refusal
does not apply to surfaces that talk to nothing. The rig writes into
`docs/evidence/`; each frame was moved here and that tree restored
(`git checkout -- docs/evidence`), so the swept set is untouched by this
branch and this directory is the only committed home of these frames.

The sizes are the rig's own per-story frames (`741x760`, `560x84`, `560x220`,
`768x340`); the two files of each pair have distinct bytes (their sha256s
differ), and every frame was eyeballed before the branch was pushed.

## What the pairs show, in one line each

- **sections**: `Release Engineering` against `release-crew`; the unlabelled
  `docs-pod` draws as its slug in both columns, which is the fallback claim as
  a picture.
- **header chip**: `Local Operator Dev` against `lopdev`. A consequence the
  design round may want to weigh: the chip is wider, so the title beside it
  ellipsises one word earlier (`… uv on Windows` against `… uv on …`) — the
  same header budget, differently spent, which is what a longer readable name
  costs.
- **header menu**: the menu row shows the label while the switch's value stays
  the slug (the check mark sits on the same row in both columns).
- **slash popup**: `Platform Delivery` (highlighted first row) against
  `delivery`; typing the slug still finds the row (that alias rule is pinned in
  `scripts/slash-row-format.test.mjs` and `scripts/slash-rank.test.mjs`), and a
  pick still inserts the slug — the composer below both frames reads `/team`.
