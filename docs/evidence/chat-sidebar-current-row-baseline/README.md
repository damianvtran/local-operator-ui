# The same five states, rendered by unmodified `origin/main`

The before half of `docs/evidence/chat-sidebar-current-row/`, and nothing else.
Same story file (copied in uncommitted, so the file itself is identical), same
fixtures, same viewports, same row read back out of the pixels:

```sh
git worktree add --detach ../highlight-baseline da9e75a6   # the head this branch is cut from
cd ../highlight-baseline && pnpm install
cp <branch>/src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx \
   src/renderer/src/features/chat/components/
cp <branch>/scripts/capture-evidence.mjs scripts/   # see below: two STORIES rows
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row --allow-backend http://127.0.0.1:6018
# then  cp ../highlight-baseline/docs/evidence/chat-sidebar-current-row/* \
#            docs/evidence/chat-sidebar-current-row-baseline/
```

A sweep captures the CURRENT tree, so it cannot produce these frames: they need
`origin/main`'s components and palette values under this branch's story. Declared
as its own set in `docs/evidence/manifest.json` so `clearSweptFrames` preserves
them and the sweep's own count stays honest — the same arrangement
`chat-sidebar-status-feed-baseline/` uses, and for the same reason.

**The rig's `STORIES` rows are copied in as well, and that is a deliberate
exception to "one tree".** Without them the baseline can reach only the chat
panel's three states, because the two settings-rail rows
(`chat-sidebar-current-row--settings-rail` and its `dir`-overridden hover twin)
exist only on this branch — and a before half for the rail is the whole point of
adding that surface. The copied file differs from `origin/main`'s in exactly
those two rows and nothing else, which `git diff` between the two worktrees
shows; the rig is the instrument, not the subject, so this changes what can be
reached and not what is rendered.

**Every frame here was re-taken for this round.** The previous baseline was shot
on a base whose current row was still `sunken`, so pairing it with these after
frames would have compared two retired grounds. Both halves now come from one
round, one story file and one set of viewports.

What the pair is FOR, in one line: on `origin/main` the current row is a barely
perceptible step — measured in these frames at ΔE00 **2.19–2.47** from its panel
across the twelve palettes — with a hovered neighbour still louder than it on
eight of them; on this branch the same row sits at **4.08–5.67** and carries a 1px
`outline-control` edge. The per-palette readings, and the harness that takes
them, are in the sibling set's README.
