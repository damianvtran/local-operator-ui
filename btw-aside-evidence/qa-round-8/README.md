# QA round 8 frames: PR #482 at 71f7d41c9

Independent QA pass (`qa-482-r8`) on the delta since QA round 7 (`5b82e0d43`): the
two folds onto main — `a2cc92b75f` (main `c44d29c34`, PR #508, the cwd chip's
16ch cap) and `0a32287863` (main `af828df4d`, PR #491) — with their two evidence
re-stamps.

- **App:** the renderer built at `71f7d41c9` with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` and
  `VITE_DISABLE_BACKEND_MANAGER=true`. It ran headless via a COPY of
  `scripts/renderer-driver.mjs` with rounds 1-7's helper layer and scenes plus this
  round's `btw-r8-band` (`rig/patch-driver-r8.sh`). The app source is unmodified and
  nothing was widened: every pass ran on 8080, the port the page already allows,
  under the shared lock, taken and released inside each pass.
- **Backend:** the REAL daemon from local-operator `origin/main` `4e6320dd4` (the
  companion PR is merged there: `AsideInput.subscription_id`, the aside routes,
  `aside_delta` targeting) in its own worktree and `uv` venv. Round 7 used
  `8fd404248`.
- **Provider:** round 4's scripted stub plus UX round 3's `MERMAIDANS`/`SLOWTURN`/
  `LONGANSWER` arms, unchanged from rounds 6-7.
- **Baseline:** `r8main479*` are the same scene, rig and daemon driven against a
  second renderer built at **`origin/main` `af828df4d`**, to attribute the #479
  chip-paint intermittency rather than inherit the attribution (R8-F1).
- `log/`: one full pass log per pass (`r8*.out`), its driver log, and its proxy
  counters; plus `queue8.log` and the baseline's `build.log`.
- `rig/`: `scene-r8.js` (this round's scene only) and the runners, plus the two
  inherited files the round depends on (the wire-counting proxy and the scripted
  provider) so the round is reproducible from its own directory.
- `frames/`: the stills the round's checks name, at every width driven.

The proxy's counters are the wire readings: every aside POST with its request id,
the subscription it carried and the prefix it continued; every DELETE/adopt on one
aside with its status; and every `aside_delta` frame keyed to its stream's
subscription.

**The band sweep's four widths** (`frames/r8band*`) are the same scene at
800×900, 1380×900, 1440×900 and 1600×900, which is where #508's 16ch cap changes
from inert to active: the engine's own `max-width` on the path span is `none` while
the `chatcol` container's content box is under 900 px (252 / 832 / 892 at those
windows) and `115.2px` at 1052 px.
