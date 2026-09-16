# The resting conversation picture, rendered by unmodified `origin/main`

The before half of `docs/evidence/chat-image-expand/in-thread/`, and nothing
else. Same fixture, same column, same 1280x900 viewport, same rig — with
`origin/main`'s own `image-attachment.tsx` drawing the picture:

```sh
git worktree add /tmp/imgexp/before 3f1f4e5a3     # the merge this branch converged on
cp <branch>/src/renderer/src/features/chat/components/message-item/image-expand.stories.tsx \
   /tmp/imgexp/before/src/renderer/src/features/chat/components/message-item/…
ln -s <branch>/node_modules /tmp/imgexp/before/node_modules
npx storybook dev -p 6118 --no-open
node scripts/capture-evidence.mjs http://localhost:6118 \
  --only=chat-image-expand-before --allow-backend
```

A sweep captures the CURRENT tree, so it cannot produce these frames: they need
`origin/main`'s component under this branch's story and fixture. Declared as its
own set in `docs/evidence/manifest.json` so `clearSweptFrames` preserves them and
the sweep's own count stays honest — the arrangement
`chat-sidebar-current-row-baseline/` and `command-palette-commandpalette-baseline/`
already use.

Two differences from that recipe, both because the branch's own story cannot
compile here: the story copied into the base worktree is a TRIMMED copy — its
`Column` and the picture are byte-for-byte the branch's, and the overlay-only
parts are gone because `image-lightbox.tsx` does not exist at the base — and the
tuple was added to the base worktree's own `STORIES` list (uncommitted there),
which `--only` filters against. The frames were then copied into this checkout
and the directives above name what produced them.

What the pair is FOR, in one line: the `div` -> `button` swap this branch made is
exactly the change that moves a row silently (design round 1, D1-5), and the only
honest before-frame is the old component rendering the same fixture at the same
viewport. What it shows, measured at y=300 of the committed frames:

| frame | the card | the picture |
| --- | --- | --- |
| `in-thread/<theme>` (this branch) | 632px wide, at the column's left edge | 632x240, filling it |
| `chat-image-expand-before/in-thread/<theme>` | **900px** wide — the column's full measure — with the `sunken` ground visible on both sides (x 192-315 and 976-1087) | 632x240, centred inside it at x 324-955 |

So the swap did change the resting row: the legacy card used to span the column
and now hugs the picture. It also makes the legacy surface agree with the
canonical one, which has always hugged (`canonical-image.tsx` wraps it in
`inline-block`) — so it is a consistency gain rather than obviously a regression,
and the design round owns the call rather than this set. What this set exists to
do is put the pair in front of that round instead of an argument.

It also settles what the drift in the re-take is: the re-captured `in-thread`
frame is geometry-identical to the round-1 commit (the picture's edges measure the
same at y=300 in every theme re-checked), so the sub-percent pixel differences
that round-1 re-take reported are re-rasterisation and not a moved row.
