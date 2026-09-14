# The same check on a tree without the fix — the reported contradiction

Both sentences the operator reported, in one frame: the "Server update available
/ Server version 0.54.44 is available. You are currently using version 0.54.43."
panel, and the success snackbar "You are up to date" underneath it, from one
press of Check for updates.

These are the BEFORE half of the pair. The story that produces them
(`src/renderer/src/features/settings/components/app-updates-section.stories.tsx`)
contains no part of the fix — it scripts the two channels' own events and the
verdict a whole check returns, then presses the section's real button — so the
two halves are one script photographed on two trees, not two scripts.

## What produced these frames

A scratch worktree at the pre-fix commit this branch is cut from, with the story
file and its `STORIES` entry copied in unchanged:

```sh
git worktree add --detach <scratch> ef40c81e2
cp src/renderer/src/features/settings/components/app-updates-section.stories.tsx <scratch>/src/renderer/src/features/settings/components/
# the `settings-app-updates-section--server-update-offered` entry in scripts/capture-evidence.mjs, unchanged
cd <scratch>
pnpm build-storybook
python3 -m http.server 6036 --directory storybook-static
node scripts/capture-evidence.mjs http://localhost:6036 \
  --only=settings-app-updates-section \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`ef40c81e2` is the commit these frames were taken on: the base this branch was
cut from (the merge of release #168), which `main` has since moved past. The
branch was later rebased onto `142e86904` - the merge of release #171,
twenty-one commits further on - so `ef40c81e2` is now an ancestor of the base
rather than the base itself. That moves the AFTER tree and not these pixels: the
story scripts the two channels' own events and the verdict a whole check returns
and contains no part of the fix, so the state these frames show is still the
pre-fix behaviour, and the fix remains the only rendered difference between them
and the AFTER pair.

The frames are a declared `supplementary` set in `docs/evidence/manifest.json`
rather than part of the sweep, because the sweep of the fixed tree cannot
re-derive them: the sentence they show is what the branch removes. The matching
AFTER pair is `docs/evidence/settings-app-updates-section/server-update-offered/`.
