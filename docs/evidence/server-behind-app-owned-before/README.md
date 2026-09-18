# The same panel on a tree without the fix — a fact with nothing to press

The app-owned arm of the skew notice, which is the state one panel of this change
is about: this machine's install is the published release (`0.56.12` in the frame,
the reading the operator's machine reached) and the server SERVING the app is
still on `0.56.8`, so the two readings differ and no later check will ever re-offer
the update, because the install itself is current.

These are the BEFORE half of the pair. The panel states the fact and offers one
control, `Understood`; a reader who wants the new build has to work out for
themselves that quitting the app is the step (UX U2). The AFTER half —
`docs/evidence/common-updatenotification/server-behind-app-owned/` — is the same
panel, the same readings and the same digits, with the restart offered as an action
the app performs and the sentence written to match it.

## What produced these frames

A scratch worktree at the pre-change commit this branch is cut from, with the story
file and its `STORIES` entry copied in unchanged:

```sh
git worktree add --detach ~/local-operator-ui-worktrees/skew-before dde14e9dd
cp <branch>/src/renderer/src/shared/components/common/update-notification.stories.tsx \
   <scratch>/src/renderer/src/shared/components/common/
# the `common-updatenotification--server-behind-app-owned` entry in
# scripts/capture-evidence.mjs, unchanged
cd <scratch>
pnpm build-storybook
python3 -m http.server 6037 --directory storybook-static
node scripts/capture-evidence.mjs http://localhost:6037 \
  --only=server-behind-app-owned \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`dde14e9dd` is the base this branch is cut from, and the story contains NONE of the
fix: it scripts the producer's own payload (`backend-update-not-available` with both
readings and `restartable: true`) and mounts the shipped component. So the two
halves are one script photographed on two trees, and the ONLY rendered difference
between them is the change under review — the sentence and the control.

The frames are a declared `supplementary` set in `docs/evidence/manifest.json`
rather than part of the sweep, because a sweep of the fixed tree cannot re-derive
them: the ending they show is what the change removes. Declaring them keeps the
sweep's own `frames`, `surfaces`, `head` and stamps describing the frames it did
take.
