# The rail's chord, in the built app, on unmodified `origin/main`

The before halves of `renderer-driver/palette-rail-{dark,light}.png`, which this
change re-shot because the app rail is the fourth place a key cap is drawn — and
the one the Storybook sweep could not reach.

```sh
git worktree add ../highlight-base 96502d5c   # this branch's base
pnpm build                                     # the driver drives the BUILT app
node scripts/renderer-driver.mjs --scene palette --out /tmp/driver-before
```

The frames are PNG rather than WebP because that is what the driver writes
(`webContents.capturePage()` through the app's own dev-driver bridge, in the
documented `headless` window mode — the run reports `visible=false focused=false`
and leaves the operator's window alone). This directory holds the five
`palette-*.png` from that base-tree run; the two `chat-*.png` frames the scene
does not touch were not copied.

The change in them, in one line: the rail printed `⌘+K` as plain monospace at
`ink-muted` — because a cap was filled `bg-sunken` and the rail IS `sunken`, so a
cap there would have had no ground of its own — and it now prints the same cap
every other surface prints, which has no ground to lose. `docs/command-palette.md`
records the decision that changed, and `docs/evidence/renderer-driver/README.md`
is where the after frames live.
