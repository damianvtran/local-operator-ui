# Scroll-driven history paging

Older conversation used to require a click on `Load earlier messages`. It now
loads when the reader scrolls to the top, coalesced, debounced, latched, and
with the reader's place held. These frames and numbers are what was measured on
the branch, and — as importantly — what was **not**.

## What produced these frames

**The real renderer, in a real browser, over the real desktop transport.** This
is the repository's documented browser-development surface
(`docs/desktop-controls.md`, "Browser development"): `electron-vite dev` serves
the shipped renderer bundle, and `desktopProxyPlugin` exposes the same typed
desktop vocabulary at same-origin `POST /__desktop`, with
`LOCAL_OPERATOR_DESKTOP_TOKEN` and `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` given to
the Vite **node** process. Behind it is a real `local-operator serve` backend
(v0.54.14) reading a real transcript file off disk with its own
`read_transcript_page`.

So the transcript component, `transcript-reducer`, `use-canonical-session`, the
desktop request/response contract and the backend's paging cursor are all the
production ones. Frames were captured over raw CDP against a private headless
Chromium (a fresh user-data-dir under `/tmp`, killed on exit), the same approach
`scripts/capture-evidence.mjs` uses — no browser-automation dependency is added
to the repo.

**What these frames do not prove**, stated plainly:

- **The Electron main and preload processes.** The browser surface has no
  preload, so `window.electron` / `window.api` were stubbed by the capture
  script (a no-op IPC subscription and the updater's listener API — see
  `ELECTRON_SHIM` in `scripts/scroll-paging-evidence.mjs`). Nothing on the path
  under test reads either: the transcript, its reducer and the desktop
  transport do not. But the Electron IPC transport itself is **not** exercised
  here, and neither is the packaged or notarised build.
- **Themes other than `localOperatorDark`**, and window sizes other than
  1380x872.
- **Screen-reader announcement.** The `output` live region is in the DOM, which
  is not the same as hearing it.

## The gap, named

**The wheel-driven measurements are missing.** The behaviour contract's fling
clauses — one page per fling (B), settle-before-spend (C), the clamp latch not
re-arming (D) — are proven **in memory** by `scripts/transcript-paging.test.mjs`
(17 tests, all green) and **not** by a rendered capture.

`Input.dispatchMouseEvent` with `type: "mouseWheel"` did not move the scroller
in headless Chromium in this harness: the listener was reached in an earlier
Electron-hosted run (6 events observed) but the headless browser's
`scrollTop` stayed at 0 across every parameter combination tried, including the
`modifiers`/`clickCount` fields whose absence the CDP bindings reject outright.
Rather than report a request count of 0 as if it were coalescing — it is
indistinguishable from no input arriving — the number is withheld.

`scripts/scroll-paging-evidence.mjs` is committed with the fling/clamp steps
intact, so a QA pass on a surface where wheel synthesis works (a headed browser,
or the Electron window) can produce those numbers without rebuilding anything.

## What was measured, in the running app

Session `eb257fff18c9`, 260 durable rows (three backend pages), 1380x872,
`localOperatorDark`.

| Claim | Measurement |
| --- | --- |
| **A — layout motion earns no page** | A programmatic scroll from the tail to the very top of the content (`scrollTop` 0 → -5992, the full extent) issued **0** `__desktop` requests in the 3s that followed. This is the motion the old `scroll` listener would have treated as demand. |
| **E — apparent position preserved** | Anchor row `6e7bdb140805e98232b130ab3c0384f9` at viewport offset **83.27px** before the reveal and **83.27px** after: delta **0.00px**. |
| **F — the status slot never changes height** | The slot measured **28px** in every state observed in the running app, and is fixed at `h-7` by construction. The four states are compared side by side against ruled edges in the `Chat/Older history slot` stories. |
| **J — local growth before network growth** | With 40 rows held by the render window and 200 more on the backend, the slot reads `40 earlier rows above` and no request is made: the window is widened first. Visible in `after-02-top-of-content.png`. |

Raw numbers: [`after-measurements.json`](after-measurements.json).

## Frames

| Frame | What it shows |
| --- | --- |
| [after-01-idle-affordance.png](after-01-idle-affordance.png) | The conversation as opened, pinned to the newest row. |
| [after-02-top-of-content.png](after-02-top-of-content.png) | The top of the rendered window. The fixed-height slot reads `40 earlier rows above` — rows are held locally, so no round trip is owed yet. |
| [after-03-page-loaded.png](after-03-page-loaded.png) | After the reveal, with the anchor row still at 83.27px. |

The `before` state on `origin/main` was **not** captured as a frame. It is not
in dispute and is visible in the diff: on `main` the slot renders a `Button`
whose `onClick` is the only caller of `onLoadOlder`, so scrolling to the top
loads nothing by construction. A frame of a button is weaker evidence than the
code, and the honest thing is to say so rather than photograph it for symmetry.

## Reproducing the fixture

The transcript is synthetic; the path that serves it is not. 260 rows of
varying height (every twentieth assistant row is long, so a mis-measured anchor
shows up as a number rather than hiding behind uniform rows), deterministic, so
two runs produce byte-identical files.

```sh
# 1. Seed an ISOLATED config dir. The script refuses to write to ~/.local-operator.
node scripts/seed-paging-session.mjs /tmp/lop-paging-evidence 260
# -> {"sessionId": "...", "rows": 260, "pages": 3}

# 2. A real backend over that store, on the port the renderer's CSP allows.
LOCAL_OPERATOR_CONFIG_DIR=/tmp/lop-paging-evidence \
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  local-operator serve --host 127.0.0.1 --port 1111

# 3. The renderer, with the desktop proxy pointed at that backend.
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:1111 \
  pnpm dev

# 4. Capture.
node scripts/scroll-paging-evidence.mjs http://localhost:5199 <sessionId> \
  docs/evidence/transcript-scroll-paging after
```

Two notes for whoever runs this next, both of which cost time here:

- **Pin the dev port.** Vite takes the first free port, so a second worktree of
  this repo silently serves the **first** one's tree — measurements were taken
  against another worktree's renderer before this was noticed. Check
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` and confirm the owning process's cwd.
- **Electron holds a single-instance lock.** A stale instance makes every new
  one quit immediately, which takes `electron-vite dev` (and the Vite server)
  down with it a few seconds after it reports being ready.
