# The same two stories, rendered by unmodified `origin/main`

The before half of `docs/evidence/chat-sidebar-current-row/`, and nothing else.
Same story file (copied in uncommitted, so the file itself is identical), same
fixtures, same viewports, same harness:

```sh
git worktree add ../highlight-base 96502d5c   # this branch's base
cp <branch>/src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx \
   ../highlight-base/src/renderer/src/features/chat/components/
npx storybook dev -p 6017 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row http://127.0.0.1:6017
```

A sweep captures the CURRENT tree, so it cannot produce these frames: they need
`origin/main`'s components under this branch's story. Declared as its own set in
`docs/evidence/manifest.json` so `clearSweptFrames` preserves them and the
sweep's own count stays honest — the same arrangement
`chat-sidebar-status-feed-baseline/` uses, and for the same reason.

What the pair is FOR, in one line: on `origin/main` the current row is a
`sunken` well (a dark band, ΔE00 4.48 from the panel here) and the caps on it
are 14px- and 21.39px-tall boxes sharing the row's own fill; on this branch both
are the `highlight` step and no cap has a fill at all. The numbers are read out
of the live DOM in the sibling set's README.
