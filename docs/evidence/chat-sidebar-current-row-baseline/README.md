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

## The two entity-row states (18 September 2026)

`team-row-current/` and `agent-row-current/` are the before half of the operator's
"two highlight bars instead of one" report: the same story file, the same fixtures
and the same viewports as the after half in `../chat-sidebar-current-row/`.

Provenance, stated precisely because the split is what makes these frames a
baseline: this branch's story states and their `STORIES` rows (`6463cb15c`) over
the components at `origin/main`'s `896b19134`. The static build was made from that
tree BEFORE the fix's two call-site edits were written, and the capture ran against
that build, so the pixels are the pre-fix component and nothing else:

```sh
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com pnpm build-storybook
python3 -m http.server 6031 --bind 127.0.0.1 --directory storybook-static
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row \
  --dirs=team-row-current,agent-row-current,selected-row \
  --allow-backend http://127.0.0.1:6031
```

`--allow-backend` because the operator's own backend answers on the configured port
and neither state talks to it — both stories stub the desktop transport, so nothing
in these frames is a reply from it. `--dirs` rather than a bare `--only` because the
set's other states are not re-shot by this pass; `selected-row` was in the run for a
pixel-neutrality comparison of the conversation row's own half of the fix, and those
frames are NOT committed here because they could not settle it: the encoder and the
text rasteriser vary more between two runs than the change does (the same
`localOperatorDark` frame differs from its before half by 430 pixels and from the
frame committed at `origin/main` by 12,670). The conversation row's half is argued
from geometry in the sibling set's README instead.

Twelve themes, the sweep's own list, which is also what `manifest.themes` names: the
claim these frames carry is GEOMETRIC — a `before:` pseudo-element landing on one
element or on two — and no palette can move it, so the twelve that span both modes
are the comparable set rather than a narrowed one.

What the pair shows, on `localOperatorDark` and read column by column with the
sibling set's tool: on `origin/main` the selected entity row carries TWO 2px
`accent` marks, at `x=12-13` and at `x=40-41` of the 280px panel, both 32px tall on
the row's own band; after the fix it carries one, at `x=12-13`. The same two numbers
hold on the agent list. `contact-sheet/entity-row-bars.png` in the sibling set is
the pair side by side.
