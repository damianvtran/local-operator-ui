# QA round 6 frames: PR #482 at f105c9953

Independent QA pass (`qa-482-r6`) on the delta since QA round 5 (`ba98e4fdc`): the
U17–U21 follow-up batch (`f26026fdd`, `5ee9c68f6`, `5952bd660`, `88c528137`,
`e0c22348a`), the R7 pins (`8e15d0dc0`, `24e2bce5a`), the docs re-stamps and the
fold onto main `deb1422f5` (`a6d3afb8b`, `f105c9953`).

- **App:** the renderer built at `f105c9953` with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8177`. It ran headless via a COPY of
  `scripts/renderer-driver.mjs` with rounds 1–6's helper layer and scenes appended
  (`rig/patch-driver-r6.sh`). The app source is unmodified.
- **Backend:** the REAL daemon from local-operator `origin/main` `1f3ee080c`
  (`AsideInput.subscription_id`, `aside_delta` targeting and the aside routes are on
  that ref), in its own worktree and uv venv.
- **Rig:** round 4's stub, proxy and capture, plus `rig/scene-r6.js`. Two changes are
  mine and are disclosed: the pass ran on **8177** (a peer held the shared 8080 lock
  for the whole round) with `connect-src` widened for it in the gitignored build
  output, and the stub is UX round 3's (which adds the `MERMAIDANS` answer U21 needs).
- `logs/`: one full pass log per pass, its driver log, and its proxy counters. The
  proxy's counters are the wire readings: every aside POST with its request id and the
  prefix it continued, every DELETE/adopt on one aside with its status, and every
  `aside_delta` frame keyed to its stream's subscription.
- `frames/`: the stills the checks below name, at both widths.
