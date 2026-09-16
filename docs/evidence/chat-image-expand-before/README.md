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

## Which surface this pair is about (corrected in round 2)

**This is the CANONICAL surface's before/after, not the legacy one** — design round
2's D2-1 caught the attribution and it matters, because it is the canonical row the
operator reported. The base rendered
`onClick ? <button className="block max-w-full cursor-pointer"> : <div
className="block max-w-full">`, and the head's button carries the identical class
string. Both legacy callers (`message-item/index.tsx`, `streaming-message.tsx`)
passed `onClick={handleFileClick}`, so production's legacy attachment was ALREADY
the shrink-wrapping button: already hugging, already flush left. The `<div>` branch
this set photographs is the one `canonical-image.tsx` reached, because that caller
passes no `onClick` — and the story here mounts `ImageAttachment` with no handler,
which is that branch. So the pair answers the question about the surface whose
production rendering changed.

What it shows, measured at y=300 of the committed frames, on the first-and-last-
pixel convention:

| frame | the card | the picture |
| --- | --- | --- |
| `in-thread/<theme>` (this branch) | ~642px wide, at the column's left edge | ~640x240, filling it |
| `chat-image-expand-before/in-thread/<theme>` | **~900px** wide — the column's full measure — with the `sunken` ground visible on both sides (x 189..319 and x 960..1089) | ~640x240, centred inside it at x 320..959 |

**The design round accepted the hugging shape on these facts** (D2-1): a wide
picture now shares the message column's left edge instead of floating centred in a
panel wider than itself, which is a gain where the picture is the row's content,
and a narrow picture — which used to get that whole panel of dead ground around
it — is unchanged. The accepted shape is recorded in `image-attachment.tsx`'s own
doc comment (D2-5), beside the affordance decision, because the wrapper's display
is what decides it and that is where the next author meets the constraint.

The widths above are quoted to the first and last painted pixel; the earlier
figures (632/900) were 8-10px narrower because they measured to a nominal box
rather than to the pixels (D2-1's own note).

It also settles what the drift in the re-take is: the re-captured `in-thread`
frame is geometry-identical to the round-1 commit (the picture's edges measure the
same at y=300 in every theme re-checked), so the sub-percent pixel differences
that round-1 re-take reported are re-rasterisation and not a moved row.

**This set was not re-captured for round 2, and that is a measurement rather than
an omission**: `git diff --name-only <the base it was taken from>..origin/main` over
everything it photographs — `image-attachment.tsx`, `attachment-frame.tsx` and
`src/renderer/src/styles/` — is EMPTY, so the component and the tokens under these
frames have not moved and the twelve frames are still what `origin/main` renders.
(A fold that moved any of those would have required re-shooting it, as folds 1, 2
and 4 required for the branch's own set.)
