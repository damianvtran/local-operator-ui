# The restarting panel on a tree before the wait left its sentence — the before half of the pair

`docs/evidence/common-updatenotification/backend-update-restarting/` is the AFTER half:
the restarting sentence the operator's directive produced — "the turns running on this
machine kept running" where the appositive used to price the fleet wait. These frames are
the BEFORE half, taken on the merge-base commit this branch is cut from
(`a0cdaa759f5ae20293554a1ab16387c620d12613`): the same story, the same fixture and the
same digits, with the sentence that still said the app waited — "the app waited for the
turns running on this machine to finish first".

## What produced these frames

A scratch clone detached at `a0cdaa759f` (no docs checkout), its own storybook build
served on its own port, and the repo's own capturer run from that tree with the tree's own
plain `STORIES` entry (no claims on the base):

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
  --only=common-updatenotification--backend-update-restarting --allow-backend --theme-settle-ms=60000
```

The frames are a declared `supplementary` set in `docs/evidence/manifest.json` rather than
part of the sweep, because a sweep of the fixed tree cannot re-derive them: the sentence
they show is what the change removes. The after half is re-derived by the ordinary sweep,
so the pair is one script photographed on two trees — the only rendered difference is the
changed clause.
