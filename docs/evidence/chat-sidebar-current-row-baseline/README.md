# The same seven states, rendered by unmodified `origin/main`

The before half of `docs/evidence/chat-sidebar-current-row/`, and nothing else.
Same story file (copied in uncommitted, so the file itself is identical), same
fixtures, same viewports, same row read back out of the pixels:

```sh
git worktree add --detach ../highlight-baseline da9e75a6   # the head this branch is cut from
cd ../highlight-baseline && pnpm install
cp <branch>/src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx \
   src/renderer/src/features/chat/components/
cp <branch>/scripts/capture-evidence.mjs scripts/   # see below: four STORIES rows
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
  npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
  node scripts/capture-evidence.mjs --only=chat-sidebar-current-row --allow-backend http://127.0.0.1:6018
# then  cp ../highlight-baseline/docs/evidence/chat-sidebar-current-row/* \
#            docs/evidence/chat-sidebar-current-row-baseline/
```

The `VITE_PUBLIC_POSTHOG_HOST` override is not decoration: the preview validates
its environment through `load-config.ts`, and a checkout whose `.env` leaves that
value empty or malformed throws `Configuration validation failed` at import time —
the story then never mounts and the rig times out waiting for `data-theme` on the
document. It is a URL the captured frames never contact.

A sweep captures the CURRENT tree, so it cannot produce these frames: they need
`origin/main`'s components and palette values under this branch's story. Declared
as its own set in `docs/evidence/manifest.json` so `clearSweptFrames` preserves
them and the sweep's own count stays honest — the same arrangement
`chat-sidebar-status-feed-baseline/` uses, and for the same reason.

**The rig's `STORIES` rows are copied in as well, and that is a deliberate
exception to "one tree".** Without them the baseline can reach only the chat
panel's three original states, because the settings-rail rows
(`chat-sidebar-current-row--settings-rail` and its `dir`-overridden hover twin)
and the two round-2 rows (`--bound-row-current` and `--nested-row-current`) exist
only on this branch — and a before half for the rail is the whole point of adding
that surface. The copied file differs from `origin/main`'s in those four rows and
nothing else, which `git diff` between the two worktrees shows; the rig is the
instrument, not the subject, so this changes what can be reached and not what is
rendered.

**Every frame here was re-taken for round 2's remediation.** The previous baseline
was shot on a base whose current row was still `sunken`, and the round before that
on a base whose rail row was the `accent-wash`; both halves now come from one
round, one story file and one set of viewports, which is the only way a pair is a
comparison between this change and its own base rather than between two retired
grounds.

What the pair is FOR, in one line: on `origin/main` the current row is a barely
perceptible step — measured in these frames at ΔE00 **2.19–2.47** from its panel
across the twelve palettes — with a hovered neighbour still louder than it on
eight of them; on this branch the same row sits at **4.01–4.15** in the same band,
stepped **3.81–6.62 `L*`** in the direction the mode runs, and marked by its ground
plus `font-medium` rather than by a boundary. The per-palette readings, and the
harness that takes them, are in the sibling set's README.
