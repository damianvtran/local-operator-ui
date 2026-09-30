# The same turn before the action row existed

The BEFORE half of the pair whose AFTER half is
[`../chat-canonical-message-actions/`](../chat-canonical-message-actions/). The
same eight resting states, on the tree before any line of the change existed: the
answer is there, the caption is there, and **the closing line carries no
control at all**.

**Why a supplementary set rather than eight rows in the sweep.** These eight
stories cannot be re-taken from a later head: `AssistantRow` has changed, so the
only tree that paints them is the pre-change one. A declaration is what keeps
`capture-evidence.mjs`'s sweep from deleting frames it cannot produce (they are
excluded from `manifest.frames` for the same reason).

**Why only the resting states have a half here.** `hover-copy`, `focus-copy`,
`copied` and `hover-answer-no-corner-control` are this row's own states; the
pre-change tree has no button for them to be a picture of. The discoverability
comparison is therefore the `rest/` pair plus the after set's
`hover-answer-no-corner-control/`, and the superseded top-right hover pattern is
named in prose there rather than photographed from the dead component (the memo
rules that out).

**How they were taken.** `scripts/capture-evidence.mjs` against Storybook on
:6077, with the change reverted in the working tree — `git checkout --
src/renderer/src/features/chat/canonical/canonical-transcript.tsx`, and the row's
own module and component moved out of `src/` entirely. The story file's title was
suffixed `before` for that one run (with matching temporary `STORIES` rows, both
removed before the change's own frames were taken), so the ids land in this
directory rather than beside the after frames:

```sh
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-before \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000
```

48 frames: eight states in six themes. `--allow-backend` for the same reason the
after run takes it (the operator's live daemon must not be stopped, and these
fixtures never contact it).

## The measured rail, on the same terms as the after set

`node scripts/chat-alignment-geometry.mjs <origin> --json` against this tree
reports the same edges the after set does — `prose.left` 107, `content.left` 107
with `gutterPx` 0 — because nothing this change touches moves the rail; what it
adds is the 28px control line at that rail and, where the run folds, the 17.4px
meta line the reader used to see alone. The numbers live in the after set's
README, in one table, rather than being restated here and drifting.

## What this set is NOT

Component-level frames from Storybook, not the whole app. These frames contain no
data from any machine.
