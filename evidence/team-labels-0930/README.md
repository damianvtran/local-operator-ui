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
| `before-header.webp` / `after-header.webp` | same / the PR branch `3f93b7941c` | the chat header's identity chip, at rest, on a team-bound session |
| `before-header-menu.webp` / `after-header-menu.webp` | same / `3f93b7941c` | the chip's team menu open (the `commands.entities` rows and the menu's current mark) |
| `before-slash-teams.webp` / `after-slash-teams.webp` | same / `3f93b7941c` | the `/team` slash popup with `/team` typed: the first row is the labelled team, highlighted; the rest are slug fallbacks |
| `after-long-label.webp` | `3f93b7941c` | the chip against an eighty-character label at the 560 band — the cap truncates, the title reads whole (after-only: see below) |
| `after-long-label-800.webp` | `3f93b7941c` | the same label at the app's own 800 minimum width |
| `after-projects-list.webp` | `3f93b7941c` | the projects list's team group headings, resolved through the label lookup (after-only) |
| `after-projects-detail.webp` | `204b3b5cb9` | a project detail's `Managed by atlas · Platform Delivery` line (after-only) |
| `after-projects-start-session.webp` | `3f93b7941c` | the start-session dialog over the same page: labelled team options, the page behind already resolved (after-only) |

## The fixture trick, and what each pair is allowed to claim

The **same story files** are on both trees: `chat-sidebar-sections.stories.tsx`,
`chat-header-identity.stories.tsx` and `slash-commands.stories.tsx` carry one
labelled team and one unlabelled team in their fixtures (copied verbatim onto a
worktree of `origin/main`; storybook does not typecheck, and `label` is an
ignored extra property on the old code). One variable changes between the two
columns: the renderer. A pair therefore shows exactly what the label split
changed, and nothing else.

WHAT A PAIR DOES NOT SHOW: the team PICKER dialog and the agents page's
Teams roster also carry the change (they read the same `teamDisplayName`
rule), but no capture-rig entry or story exists for either, so the PR's own
unit cases are that claim's evidence and no frame here is a picture of those
two surfaces. The projects surfaces (list headings, detail line,
start-session dialog) were in the same position in round 1 and gained frames
in round 1's remediation — after-only, for the reason the round-1 section
below records. One theme (`localOperatorDark`), one size per story except the
long-label pair; a theme this branch does not photograph is a theme this pair
says nothing about.

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

### Re-run at the folded head (byte-identical)

The branch folded `origin/main` twice after these frames were taken (`ee5611a2e4`,
then `961887cf7c`; the only conflict was `docs/evidence/manifest.json` in both
folds). Every AFTER frame was then re-captured at the folded head `ac68897fef`
and compared with `cmp`: `after-sections.webp` reproduced byte-for-byte on its
single re-run, and `after-header.webp`, `after-header-menu.webp` and
`after-slash-teams.webp` on two consecutive runs each. One earlier run of the
same commands produced a differing byte stream that did not recur in the two
runs after it, so the receipt is the consecutive byte-identical runs rather
than a claim of strict determinism.

## Round-1 remediation re-captures (head `3f93b7941c`)

The design/review/QA rounds asked for the chip to be bounded, the slug to be
shown beside the label, and the projects surfaces to resolve team names. The
three pairs' AFTER frames were re-captured at the remediation head through the
same rig and the same commands as above (one storybook on `:6037`; runs:
`--only=chat-header-identity--`, `--only=chat-slash-completion--argument-phase-teams`,
`--only=projects-tab--list-teams-sticky`, `--only=projects-tab--detail`,
`--only=projects-tab--start-session-dialog`, each `--themes=localOperatorDark`,
each frame viewed before it was copied here), and `docs/evidence` was restored
again (`git checkout -- docs/evidence && git clean -fd docs/evidence`).

- The three pairs' BEFORE halves are unchanged (they are `origin/main`'s
  renderer); only the AFTER column moved, and the moves are local: the header
  pair differs on the title/chip line only (the title re-truncates around the
  bounded chip's new width, the chip changes face), the menu pair across the
  chip and the labelled row (its description line now leads with the slug),
  the slash pair on its first row (label in the human face, slug token beside
  it) plus lossy-WebP block noise below.
- The long-label pair has NO before half, deliberately: on `origin/main`'s
  renderer the story's `label` is an ignored property, so a before frame would
  photograph the slug fallback rather than the overflow the cap removes. It is
  after-only, and the rig's `expectAttribute` pins the trigger's `title` to
  `Data Quality, Sanctions Screening and Regulatory Reporting (Global Markets
  Desk) (data-quality)` at shutter time — the whole label plus the slug.
- The projects frames are after-only for the same class of reason (the
  fixtures that make labels resolvable are this branch's), and the story
  fixtures gained the `platform` team the project rows actually name, so these
  frames differ from round 1's project captures in their fixtures as well as
  their code. They are pictures of the fixed surfaces, not a before/after
  pair. The board's band headers and the timeline's group headers resolve
  through the same prop and the same rule and are not photographed here.
- Not capturable, declared: the sidebar entity row's tooltip is a native
  `title` attribute, which never appears in a CDP screenshot. Its text is
  `Label (slug)` when the two differ, pinned by the row's own tests.

- Not capturable, declared: the sidebar entity row's tooltip is a native
  `title` attribute, which never appears in a CDP screenshot. Its text is
  `Label (slug)` when the two differ, pinned by the row's own tests.

### Re-run at the folded head (`204b3b5cb9`)

The branch folded `origin/main` again after round 1 (`dad1778e14`, #615's chat
move control over #712), so every frame was re-verified at the fold: the
header pair, menu pair, slash pair, both long-label frames, the projects list
and the start-session dialog reproduced **byte-for-byte**, and two frames were
re-taken and are what this branch now ships:

- `after-projects-detail.webp`: the fold's shared-style changes move the
  milestone input's hairline by at most 6/255 over a 540x4 band (measured; the
  crop is visually identical). Two consecutive folded-head runs reproduce each
  other byte-for-byte, and this file is one of them.
- `after-sections.webp` is NOT re-taken, and the reason is stated rather than
  smoothed over: at the folded head the story's own 200 ms instrumentation
  caption settles on a mid-remount reading (`(not mounted)` / `0 entity · 0
  chats`) while the sidebar rows are drawn - a probe race the fold's changed
  timing exposed in the STORY harness. The sidebar's own pixels reproduce
  across the fold (262 px differ above a delta of 6, at most 17 px above a
  delta of 10, all single-pixel glyph edges), so the frame kept is the round-0
  one, whose caption agrees with its pixels. A reviewer diffing this file at
  the folded head will see exactly the caption column, and nothing else.

## What the pairs show, in one line each

- **sections**: `Release Engineering` against `release-crew`; the unlabelled
  `docs-pod` draws as its slug in both columns, which is the fallback claim as
  a picture.
- **header chip**: `Local Operator Dev` against `lopdev`, and at this head the
  chip is BOUNDED (an 80-character label caps at `24ch` with the whole label
  and the slug in its `title` — the rig asserts that title at shutter time,
  and the long-label pair photographs the cap at 560 and at 800). The cap
  changed a consequence round 1 recorded: the bounded, human-faced chip is
  NARROWER than the uncapped mono one was, so at the 560 band the title keeps
  a word it lost in round 1 (`… uv on Win…` where round 1's after read
  `… uv on …`).
- **header menu**: the menu row shows the label while the switch's value stays
  the slug (the check mark sits on the same row in both columns).
- **slash popup**: `Platform Delivery` (highlighted first row) against
  `delivery`; typing the slug still finds the row (that alias rule is pinned in
  `scripts/slash-row-format.test.mjs` and `scripts/slash-rank.test.mjs`), and a
  pick still inserts the slug — the composer below both frames reads `/team`.
