# Ask options, nine wrapped descriptions, BEFORE the #762 fix

One state × twelve themes = **12 frames**: `wrapped-density/`, 1024×620, the same
story state `../chat-ask-options/wrapped-density/` carries — photographed on the
pre-fix `trace/ask-options.tsx` (its `origin/main` bytes, `9b4822d`), so the pair
reads directly.

## What the frames show

Every option's description wraps to a second line, and each row's box is
COMPRESSED short of its own label column: the next row's ordinal and label land on
the description above it, and the collisions cascade down the list until the first
option's label row is unreadable.

The mechanism is the band's own cap. `ask-options.tsx` renders the options as a
`max-h-[380px]` flex column, and its rows are flex items — so a tall list is
**shrunk to fit the cap instead of scrolling** (flex items default to
`flex-shrink: 1`). Nine wrapped rows measure 372px of content, the band's interior
is exactly that, and each row collapses to ~39.6px against its ~60.5px column:
the `overflow-y-auto` scroll was never reached. (The same arithmetic compresses
`many-options`' eight single-line rows to ~44.75px, which is why the defect shows
at any density once the content exceeds the cap.)

## How these were taken

`scripts/capture-evidence.mjs` in a scratch worktree checked out at `8240edf0b`
with `trace/ask-options.tsx`'s bytes taken from `origin/main`:

```sh
node scripts/capture-evidence.mjs http://localhost:6021 \
  --only=chat-ask-options--wrapped-density --allow-backend
```

then the twelve frames were copied under this set's name. It is declared as a
`supplementary` set in `../../evidence/manifest.json` because a sweep cannot
regenerate it — a sweep photographs the current tree, and this state needs the
pre-fix component.

## The claim is measured, not only seen

`scripts/ask-options-geometry.mjs` measures this state's rendered rows and exits
non-zero when a row's label column overprints the next row. On the pre-fix
component it reports **8 overprints + 9 containment + 9 line-box findings per
theme**; on the fixed one it passes. Both runs ride with the PR that fixes #762.
