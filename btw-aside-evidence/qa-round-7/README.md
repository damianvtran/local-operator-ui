# QA round 7 frames: PR #482 at 5b82e0d43

Independent QA pass (`qa-482-r7`) on the delta since QA round 6 (`f105c9953`): the
narrow-follow-up fix `39c8d8015`, the docs re-stamp `284ae00d0`, and the fold onto
main `a7df70995` with its semantic merge in
`src/renderer/src/shared/hooks/use-canonical-session.ts`.

- **App:** the renderer built at `5b82e0d43` with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`. It ran headless via a COPY of
  `scripts/renderer-driver.mjs` with rounds 1-6's helper layer and scenes appended,
  plus this round's `btw-r7-fold` scene (`rig/patch-driver-r7.sh`). The app source is
  unmodified. No `connect-src` widening was needed: this round ran on the port the
  page already allows, under the shared lock, taken and released per pass.
- **Backend:** the REAL daemon from local-operator `origin/main` `8fd404248` (the
  companion PR is merged there: `AsideInput.subscription_id`, the aside routes,
  `aside_delta` targeting) in its own worktree and `uv` venv.
- **Provider:** round 4's scripted stub plus UX round 3's `MERMAIDANS`/`SLOWTURN`
  arms, unchanged from round 6.
- `logs/`: one full pass log per pass, its driver log, and its proxy counters; the
  four chain logs; and the two `session-switch-latency.mjs` verdicts for the fold's
  send-into-a-left-conversation neighbour.
- `rig/`: `scene-r7.js` (this round's scene only) and the runners.
- `frames/`: the stills the round's checks name, at both widths.

The proxy's counters are the wire readings: every aside POST with its request id,
the subscription it carried and the prefix it continued; every DELETE/adopt on one
aside with its status; and every `aside_delta` frame keyed to its stream's
subscription.
