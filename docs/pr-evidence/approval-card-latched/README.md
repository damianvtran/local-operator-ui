# Approval card on a bridge-latched conversation: before/after

Storybook frames of `chat-ask-options--approval-bridge-latched` (new story in
`src/renderer/src/features/chat/canonical/ask-options.stories.tsx`), theme
`localOperatorLight`, 1024px wide, captured with
`node scripts/with-storybook.mjs -- sh -c 'node scripts/capture-evidence.mjs "$STORYBOOK_ORIGIN" --only=<story> --themes=localOperatorLight --theme-settle-ms=60000'`
(with a temporary, uncommitted `STORIES` row for the new story: a committed row moves the evidence manifest's `surfaces` count, which the post-merge `pnpm evidence:fold` re-stamps; own Chrome, headless; backend URL pointed at an unused port through an ignored
`.env` so the capture's offline-backend guard passes, then deleted).

- `before-latched-light.png`: the SAME story and gate fixture rendered with
  `question-dock.tsx` as on origin/main `5033f64235` (the fix reverted in the
  working tree for this one capture). Both "Set auto" links are offered.
- `after-latched-light.png`: this branch. No links; one inline line with the
  backend's own sentence. Approve and Deny are unchanged.
- `unchanged-unlatched-light.png`: the existing `chat-ask-options--approval`
  story on this branch (gate without the bridge flags): both links still render.

The gate fixture is the backend's own published `pending_gate` for a latched
`bash` approval (core `2ba8127d9`): `bridge_latched: true`, `taint_raised: false`.
Fixture data is synthetic. One theme only: the change adds a plain muted line in
the slot the links occupied, no new colour.
