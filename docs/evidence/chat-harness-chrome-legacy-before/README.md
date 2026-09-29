# Legacy goal-continuation rows before the fix: the operator's report

The BEFORE half of [`../chat-harness-chrome-legacy/`](../chat-harness-chrome-legacy/),
and the half that shows WHAT was wrong: a stored transcript carries a
goal-continuation row with no `provider_payload.harness_injected` marker (it
predates the stamp), and the desktop hid only stamped rows - so the harness's
own words sat in the conversation as the person's, visible the moment the turn
is opened; on the live wire the same unstamped row paints as a user bubble
outright.

## How this set was captured

`scripts/capture-evidence.mjs` run against a Storybook of a throwaway checkout
of the base this branch cuts from - `origin/main` = `0738fa7eb3` - so every
frame is the base tree's own reducer and transcript, i.e. the shipped pre-fix
rendering a sweep of the current tree can no longer photograph. The branch's
story (`harness-chrome-legacy.stories.tsx`) and fixture
(`scripts/fixtures/harness-chrome-legacy.json`) were copied in for the run; the
title was temporarily suffixed `before` and the matching rows were added to
THAT checkout's copy of `capture-evidence.mjs` only (never committed; the
checkout was discarded afterwards).

```sh
# in the throwaway checkout (~/local-operator-ui-worktrees/goal-chrome-before-0929),
# story + fixture copied in, title suffixed `before`, the four `-before` rows in
# the checkout's capture-evidence.mjs
node_modules/.bin/storybook dev -p 6215 --host 127.0.0.1 --ci --no-open
node scripts/capture-evidence.mjs http://127.0.0.1:6215 \
  --only=chat-harness-chrome-legacy-before \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
```

Eight frames across the two brand palettes (the round-1 re-take shot the stored
pair and the live pair again and added `multi-cycle/`); `docs/evidence/manifest.json`
declares the set (its `supplementary[].source` carries the same recipe).

## What the frames show

- `stored-transcript/` - the opened turn, where the pre-marker continuation
  row sits among the person's own words; the fix's frame on the same fixtures
  has no such row (the pair differs by 106,473 of 1,024,000 pixels at
  `localOperatorDark`, 103,720 light).
- `live-arrival/` - the same unstamped row arriving as a live `message_start`
  from an older owner: a full user bubble under the page (93,717 / 92,647).
- `multi-cycle/` - the operator's real length: one row paints per cycle, three
  times over one ask and one answer (316,222 / 304,115).
- `typed-near-miss/` - the control: a message the PERSON typed that opens with
  the continuation's head but never closes with its tail; byte-identical
  across the halves (AE 0 in both palettes), as it must be.

## One capture hazard, recorded

The first shutter of a capture run can catch the older-history slot in its
transient loading state ("Loading earlier messages" with the spinner, the fold
chip not yet painted); every later frame of the same run shows it settled
("Load earlier messages"). The stored dark frames here are of the settled
state, re-taken where the first capture caught the transient - see the fix
set's README for the full note and the re-take recipes.
