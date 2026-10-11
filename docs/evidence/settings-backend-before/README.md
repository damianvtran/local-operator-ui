# The language row's before half

Two frames of `settings-backend--all-expanded` taken on `origin/main` =
`9124745a64e` — the base this branch merges into — with **no language row in
the Appearance section: the *before* half of the pair whose *after* half is
`../settings-backend/all-expanded/` (where the row renders as
`Interface language`, after `Desktop notifications`, its picker on `auto` and
`In effect: en-US` under it). `localOperatorDark` and `localOperatorLight`, same
viewport, same story, same args as the after frames, so the two are a
like-for-like comparison rather than two sets of measurements.

## Source, exactly

The before half needs the base tree's own registry fixture — the row does not
exist there — so it was built from a tree with this branch's three commits'
files reverted, **in place**: a second full checkout does not fit this host's
free disk (a detached worktree was the first attempt and hit ENOSPC mid
checkout). That reverting is the equivalence of a detached worktree at the
base, and it was verifiable: the reverted set was exactly this branch's own
delta (`src/**`, `scripts/fixtures/**`).

```
git checkout 9124745a64e -- src scripts/fixtures
./node_modules/.bin/storybook build
# served by a plain static server on :6051 (any server works; the tool connects
# to an origin, not a dev server - the storybook-static dir is a built artifact)
node scripts/capture-evidence.mjs http://127.0.0.1:6051 \
  --only=settings-backend--all-expanded --allow-backend \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=30000
# frames landed in docs/evidence/settings-backend/all-expanded/, were copied
# here unchanged, and the tree was restored:
git checkout HEAD -- src scripts/fixtures
```

The after half was then re-shot the same way from the restored tree (twice: the
round-1 remediation's copy change re-took it once more), so
`../settings-backend/all-expanded/localOperatorDark.webp` and
`...LocalOperatorLight.webp` are the current tree's own frames.

`manifest.json` declares this set under `supplementary` with that provenance,
because a sweep cannot regenerate it — a sweep captures the current tree, and
these need the base tree's own fixture.

## What the pair is for

The change is ONE new row and its note, which a single frame cannot show as a
delta: the after frame's Appearance section carries `Interface language`
immediately after `Desktop notifications` (in both palettes), its picker on
`auto`, and `In effect: en-US` under the picker - en-US because the story
renders without a backend answer, so the note reads the store's device
fallback, which on the capture host is en-US. The before frame is the same
section without that row, and with nothing else moved. The measurements and
the design notes belong in the PR, not here.
