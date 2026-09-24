# Design round 4 frames: PR #482 at ba98e4fdc

Independent design pass (`design-482-r4`, model **`deepseek/deepseek-flash`** — this session
began as `anthropic/claude-opus-5-5` and the provider failed **before any reading was
taken**, so every number and frame here is one model's) on the delta since design round 3
(`0bc4a97bb..ba98e4fdc`), plus the subjects round 3 handed over: **Q46** (a wrapping
question) and the **per-quote height step**, with round 7's unmeasured set (lists,
headings, code) alongside.

- **App:** the renderer built at `ba98e4fdc` in a session-unique detached worktree, with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8177`. The app source is unmodified.
  It ran `--window-mode=headless` through a COPY of `scripts/renderer-driver.mjs`
  (`rig/patch-driver-d4.sh`) with rounds 1–5's scenes, design round 3's scene and round
  4's own scene (`rig/scene-d4.js`) appended.
- **Backend:** the REAL daemon from local-operator `origin/main` `c7af37c57` (#1488
  `c2529404e` is an ancestor), in its own worktree and `uv` venv.
- **Rig:** round 4's stub, proxy and capture script (`rig/`) plus five new stub markers
  (`LISTEDGE`, `HEADEDGE`, `CODEEDGE`, `QUOTEEDGE`, `SENTENCE`) that place a block so the
  ceiling's edge lands inside it, and round 3's `NLINES`/`LONGSLOW`.
- **Storybook:** `sb-*-story.png` are the story states, captured with the harness
  `browser` tool against `storybook dev -p 6006` on the same tree.
- **Isolation:** `env -i`, scratch `HOME`/`TMPDIR`/`LOCAL_OPERATOR_CONFIG_DIR`,
  `GIT_CONFIG_SYSTEM=/dev/null`, no `CMUX_*`/`LOP_*`. Every pid reaped by exact pid.

## PORT: this round did not use the shared 8080

The host rules ask for the shared `port8080.lock`. On this run **8080 was held from
17:45:49 by another session's service** (`lop serve --port 8080`, cwd
`~/lop-wt-catpage-f7318cc06bdd`) which does not take the shared lock, so the shared port
was not obtainable without signalling another session's process — not this round's to do.
The rig therefore bound a **private port (8177, verified free)**. The page can only reach
origins its CSP allowlists, so the rig widened `connect-src` in
`out/renderer/index.html` — build output, gitignored, `src/` untouched — which is the same
accommodation `scripts/renderer-driver.mjs` documents for `frame-src`/`media-src`
(`widenCspForBackend`). The run's own assertions passed on it:
`the app holds a connection to this run's backend (http://127.0.0.1:8177)` and
`the app holds NO connection to the operator's own backend (http://localhost:1111)`.
`1111` was never bound.

## Logs

`logs/<pass>-driver.log.txt`, one per pass, plus `build-8177.log.txt`. Passes:

| pass | width | theme | scene |
| --- | --- | --- | --- |
| `wide-d4` | 1380x900 | dark | paragraph/quote cap cases, blocks, follow-up, step |
| `narrow-d4` | 800x900 | dark | the same |
| `wide-d4b` | 1380x900 | dark | wrapping cases, 9-offset block sweep, follow-up, step |
| `narrow-d4b` | 800x900 | dark | the same |
| `wide-r4` / `narrow-r4` | both | dark | QA round 4's scene, unchanged (41/41 each) |
| `narrow-r3design` | 800x900 | dark | design round 3's own scene |
| `wide-d4-light` | 1380x900 | light | the paragraph/quote cap cases |
