# The command palette's legend keys, on unmodified `origin/main`

The before half of the palette's re-shot frames (`command-palette-commandpalette/`),
and nothing else. Same stories, same fixtures, same viewports, same harness, run
in a worktree of this branch's base (`96502d5c`) with the branch's `src/` and
`scripts/` changes absent:

```sh
node scripts/capture-evidence.mjs --only=command-palette-commandpalette-- http://127.0.0.1:6017
```

A sweep captures the CURRENT tree, so it cannot produce these frames — they are
`origin/main`'s palette under this branch's own story list. Declared as its own
set in `docs/evidence/manifest.json` so `clearSweptFrames` preserves them and the
sweep's own count stays honest.

What the pair is for: every key in the palette's footer and on its active row
(`↑` `↓` `↵` `esc`, and the scope glyphs `>` `#` `@` `,`) was a filled
`bg-sunken` box 15.2 × 21.39px inked `ink-dim`, drawn by a third cap
implementation local to `command-palette.tsx`. On this branch every one of them
is the app's single cap: 20 × 20px minimum, no fill, no border, inked
`ink-muted`. The measurements are in the sibling set's README.
