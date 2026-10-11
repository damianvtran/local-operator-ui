# The language door — before half

Two frames of `command-palette-commandpalette--language-action` taken on
`origin/main` = `4461a7a783d` — this branch's base — where a search for
`language` answers with the **Settings** section alone (`General settings`):
the *before* half of the pair whose *after* half is
`../command-palette-commandpalette/language-action/` (the same query, the same
story, with the new **Actions** section carrying `Change interface language…`).
`localOperatorDark` and `localOperatorLight`, same viewport, same story args,
so the two are a like-for-like comparison.

## Source, exactly

The before half needs the base tree's own registry of palette actions — the
action does not exist there — and the story is ADDITIVE (it seeds a query and
contains none of the change), which is what lets it be photographed on the
base at all. Built from this branch's worktree with the palette's four
plumbing files reverted to `4461a7a783d` in place (a second full checkout was
not taken; `../settings-backend-before/README.md` records the same choice for
the row's pair):

```
git checkout 4461a7a783d -- \
  src/renderer/src/features/command-palette/use-palette-sources.ts \
  src/renderer/src/features/command-palette/palette-search.ts \
  src/renderer/src/features/command-palette/components/palette-icons.tsx \
  src/renderer/src/features/command-palette/components/command-palette.tsx
./node_modules/.bin/storybook build
node scripts/capture-evidence.mjs http://127.0.0.1:6051 \
  --only=command-palette-commandpalette--language-action --allow-backend \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=30000
# frames copied here unchanged, then the tree restored.
```

`manifest.json` declares this set under `supplementary` with that provenance,
because a sweep captures the current tree and these need the base tree's own
action registry.

## What the pair is for

The door is DISCOVERY, not ownership: the settings row stays the canonical
editor, and the pair exists to show the one addition a search for `language`
gains — the Actions row and its `Change` verb — with the Settings section
beneath it unchanged. The dialog the action opens, its saved state, and the
external-change announcement are photographed in `../settings-language-door/`;
none of them has a before state, and that set says so.
