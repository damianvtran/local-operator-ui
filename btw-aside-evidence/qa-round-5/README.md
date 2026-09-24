# QA round 5 frames: PR #482 at ba98e4fdc

Independent QA pass (`qa-482-r5`, model `anthropic/claude-opus-5-5`) on the delta since QA round 4 (`8ea341d36`):
Q33's fix `8d1170c4b`, R6-5 `572573f9c`, the fold `3eefafd8e` onto main `0dbc91aa9`, and R6-4 `15e3e46f7`.

- **App:** the renderer built at `ba98e4fdc` with `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`. It ran headless via a COPY of `scripts/renderer-driver.mjs`
  with the scenes of rounds 1–5 appended (`rig/patch-driver-r5.sh`). The app source is unmodified.
- **Backend:** the REAL daemon from local-operator `origin/main` `0954525af` (#1488 `c2529404e` is an ancestor), in its own worktree and uv venv.
- **Rig:** round 4's stub, proxy and capture (`qa-round-4/rig/`), plus `rig/scene-r5.js`. That file holds three new scenes:
  - `btw-r5-clip` (Q33 and D11);
  - `btw-r5-adopt` (the adopt end to end, plus R6-5);
  - `btw-r5-cap` (the R6-4 sweep).
- `logs/`: one driver log per pass. Each log carries the proxy's wire counters.
