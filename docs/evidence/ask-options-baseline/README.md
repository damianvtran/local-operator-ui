# Baseline frames: the ask gate's options, before they were clickable

Ninety-six frames — eight stories across all twelve themes — of the story file
`Chat/Ask options`, captured with the same tooling
(`scripts/capture-evidence.mjs`), the same fixtures and the same viewports from
**unmodified `origin/main` at `54bf411e0`** (`chore(release): bump version to
0.19.0`), so the pair compares two cards rather than two trees.

**That commit is NOT this branch's base, and an earlier version of this
paragraph was wrong in a way worth recording.** `54bf411e0` is 64 commits behind
the commit this branch is rebased onto. It used to claim the branch sat on
`6950d0bf3` (`0.19.5`) and that the measurement below came back **empty**; both
were stale, and the second was the load-bearing one, because emptiness was the
whole proof. Measured against the base this branch actually has —
`git merge-base HEAD origin/main`, `73977340a` (v0.21.0) at the time of writing
— the command returns **ten** files, not five:

```sh
git diff --name-only 54bf411e0..73977340a -- \
  'src/renderer/src/features/chat/canonical/**' \
  'src/renderer/src/features/chat/components/trace/**' \
  'src/renderer/src/features/chat/components/message-item/**'
# src/renderer/src/features/chat/canonical/mentioned-files-scan.ts
# src/renderer/src/features/chat/canonical/mentioned-files.ts
# src/renderer/src/features/chat/canonical/tool-row.stories.tsx
# src/renderer/src/features/chat/canonical/transcript-reducer.ts
# src/renderer/src/features/chat/canonical/transcript-rows.ts
# src/renderer/src/features/chat/canonical/use-attachment-url.ts
# src/renderer/src/features/chat/canonical/use-mentioned-files.ts
# src/renderer/src/features/chat/components/message-item/index.tsx
# src/renderer/src/features/chat/components/trace/tool-row.tsx
# src/renderer/src/features/chat/components/trace/trace-group.tsx
```

All ten are inside the path set that sentence named as its proof. Five are the
trace tier (#127's 2px hairline, plus #118's one-frame submit seam in
`transcript-reducer.ts`); the other five are #128's mentioned-file rebuild
(`mentioned-files.ts`, `mentioned-files-scan.ts`, `use-mentioned-files.ts`,
`use-attachment-url.ts`, `message-item/index.tsx`), which the correction before
this one folded into the trace tier and should not have — the count moved from
five to ten with the same command against the same path set, because `main`
moved under it twice more (code review round 3, m2). **Why the frames still
hold anyway, stated as a reason rather than as a diff:** the story behind every
frame in this set
fixtures exactly one record, `{kind: "user"}`, and no trace tier at all — so the
code #127 moved is not exercised by any of the 96 frames here, nor by any frame
in the `chat-ask-options/` twin. The provenance is: baseline from `54bf411e0`,
branch frames from the branch's head, and validity from the fixture rather than
from a command that no longer returns empty. A reader should re-derive the base
rather than trust the literal, because every rebase moves it: read
`git merge-base HEAD origin/main` and run the command above against it. See
`why[3]` of this set in `manifest.json`, which carries the same correction; it is
the durable record.

RE-CAPTURED at `54bf411e0` after the rebase. The previous set was taken against
`a09f2e6f4`, and `main` had since landed scroll paging (#112) and the
run-details trigger (#115), both of which touch the transcript these frames are
drawn inside — so the old set could no longer be relied on to depict main's
current card. Measured rather than assumed: of the 96, **90 came back
byte-identical** and the 6 that changed (`options/synth`,
`answer-in-flight/synth`, `wrapping-labels/{dune,localOperatorLight,synth,tokyoNight}`)
differ by **0 pixels beyond a 5% tolerance** — webp re-encoding noise, not a
visual change. So main's transcript work did not in fact move this card; the
set is refreshed anyway, because a baseline whose provenance is a stale commit
is a claim the reader cannot check.

They exist because the fixed frames cannot show what was wrong. The defect is
an ABSENCE — nothing on the card was pressable — and an absence does not
photograph. Read the pair:

| | here (unmodified `main`) | `chat-ask-options/` |
| --- | --- | --- |
| the options | inert muted text, one line each | a bordered, focusable control each |
| label and consequence | run together on one line, joined by an em dash | label on its own line, consequence beneath it |
| the recommended option | not marked at all — `recommended` is not in main's TS type | marked `Recommended` beside the label, in `ink` rather than the accent, in sentence case |
| the hint below | "Type your answer below." | "Choose an option, type 1-9 and send, or type your own answer below." |
| answering | retype a label, or type `1` and have the agent receive the string `"1"` | press the option, or type `1` and have it resolve to that option's label |
| an answer in flight | no such state — there was nothing to press | every option disabled by colour, never opacity, under an eyebrow reading "Sending your answer…" |
| a secret ask | no options (unchanged) | no options (unchanged) |
| an approval gate | "Reply yes or no in the composer." (unchanged) | identical — this change is scoped to `ask` |

The two sets that should look the SAME are as important as the six that differ:
`secret-ask` and `approval-unchanged` are the non-goals, and the pair is what
proves they were not disturbed.

## Reproduction

```sh
git worktree add /tmp/ask-baseline --detach 54bf411e0   # the 0.19.0 release commit
cd /tmp/ask-baseline && pnpm install --frozen-lockfile
# Copy this branch's story file in and port its `chat-ask-options` block into
# main's own STORIES list (leaving main's run-details entries intact), then
# remove the three things main's tree does not have:
#   - the `onAnswer` and `answering` props, which its CanonicalTranscript
#     does not accept;
#   - the `recommended: 0` fixture key, which is NOT on main's
#     `PendingDesktopGate` — with it the story fails to typecheck and Storybook
#     serves a blank document, which the capturer reports as
#     `document carries theme "" after 10s` rather than as a compile error.
# The fixtures, the viewports and the component under them are otherwise
# untouched, which is what makes the pair a fair comparison. This set is
# captured at ONE width per story, so the comparable half of
# `chat-ask-options--wrapping-labels` is `wrapping-labels@1024/` — the branch
# takes that story at 1024 and 560 (where the label itself wraps), and 1024 is
# the same column and the frames the pair's pixel comparisons use.
pnpm storybook --port 6018 --no-open --quiet &
node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=chat-ask-options --allow-backend
```

Boot that Storybook with `reactDocgen: false` in your own checkout. The shipped
`.storybook/main.ts` sets `reactDocgen: "react-docgen-typescript"` while
`package.json` pins `typescript ^7.0.2` (both as `origin/main` has them, from
#140), and that pair cannot build the preview at all: it throws `Cannot read
properties of undefined (reading 'React')` inside the docgen parser before a
single frame is taken. Rewriting the option locally changes how the preview is
BUILT and nothing about what is photographed — measured, not argued: the whole
set re-captured under it comes back byte-identical to the committed frames
(design round 3, D12).

`--allow-backend` is correct here and is not a loosened guard: it is accepted
only on a NARROWED run, and these stories render from literal
`PendingDesktopGate` fixtures with a no-op `onAnswer`, so no frame in this set
can contain a backend's reply. The operator's own backend was live on :1111
throughout.

## Why these live outside `chat-ask-options/`

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these ninety-six, which need a different SOURCE TREE rather than a different
fixture — therefore has to be its own declared set at the top level, or the
next sweep deletes it and the manifest's arithmetic stops matching the disk.
This follows `tool-rows-baseline` exactly, for exactly that reason.
