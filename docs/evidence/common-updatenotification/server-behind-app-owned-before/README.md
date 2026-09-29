# The skew panel's cost sentence on a tree before the drain bound left it — the before half of the pair

`docs/evidence/common-updatenotification/server-behind-app-owned/` is the AFTER half: the
cost sentence recomposed without the drain bound — "Nothing in flight is cut off, and
sessions that are still working move onto the new build when they next stop or go idle."
These frames are the BEFORE half, taken on the merge-base commit this branch is cut from
(`a0cdaa759f5ae20293554a1ab16387c620d12613`): the same panel, the same readings and the
same digits, with the sentence that still priced the wait — "The app waits up to ten
minutes for the turns running on this machine to finish, then stops rather than cutting a
turn short, so nothing in flight is cut off."

**Not the older pair.** `docs/evidence/server-behind-app-owned-before/` (top level) is a
different, earlier pair: the pre-#402 panel that stated the skew as a fact with only
`Understood` to press. This set photographs the same panel AFTER that change — the restart
offered, the cost sentence still carrying the drain bound — one copy generation before
this branch's sentence.

## What produced these frames

A scratch clone detached at `a0cdaa759f` (no docs checkout), its own storybook build
served on its own port, and the repo's own capturer run from that tree with the tree's own
plain `STORIES` entry:

```sh
git clone --no-checkout --local <worktree> <scratch>/shoot-base
cd <scratch>/shoot-base
git sparse-checkout set --no-cone '/*' '!/docs/'
git checkout a0cdaa759f
# deps by APFS clone of the worktree's node_modules — pnpm refuses a symlinked hoist dir
cp -Rc <worktree>/node_modules ./node_modules
./node_modules/.bin/storybook build          # the same build `pnpm build-storybook` runs
node <scratch>/serve-static.mjs ./storybook-static 6099 &
node scripts/capture-evidence.mjs http://127.0.0.1:6099 \
  --only=common-updatenotification--server-behind-app-owned --dirs=server-behind-app-owned \
  --allow-backend --theme-settle-ms=60000
```

The frames are a declared `supplementary` set in `docs/evidence/manifest.json` rather than
part of the sweep, because a sweep of the fixed tree cannot re-derive them: the sentence
they show is what the change removes.
