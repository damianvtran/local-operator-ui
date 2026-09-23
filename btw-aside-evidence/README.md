# `/btw` aside — before/after frames (PR #482, `feat/btw-aside-panel`)

Driver-taken PNGs for the change that replaces the `/btw` Radix **modal** with a
composer-attached, streaming **panel**. Evidence-only branch: nothing here is
part of the PR's diff, and nothing here lives under `docs/evidence/`.

## Refs, from the two worktrees the frames were taken in

| Tree | Ref | What it is |
| --- | --- | --- |
| after | `415b38242` | `feat/btw-aside-panel` head at capture time |
| before | `ff064112f` | the PR's base commit (PR #480 release bump) |

Both trees were built for the rig's own backend URL —
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build` — because the
renderer's copy of that address is inlined at build time, and the run asserts
the renderer really was built with the URL `--backend` named.

## The rig

The panel's content arrives over the backend's SSE stream, so the frames are
against a live daemon — the companion backend from `local-operator` #1488
(worktree `~/local-operator-worktrees/aside-guard`, branch
`fix/btw-aside-tool-call-guard`, at `e59fe8f8`), driven through a scripted
OpenAI-compatible provider stub:

* the stub and the daemon each bind an **OS-chosen port** (`--port 0`); no fixed
  port is used anywhere, and 1111 (the operator's own desktop backend) is never
  bound;
* a small Node proxy listens on **8080** — the only port left that
  `src/renderer/index.html`'s `connect-src` allows besides 1111 — and forwards to
  the daemon's ephemeral port with both directions piped, so SSE frames arrive
  one at a time rather than after the response completes;
* the proxy also **mirrors the daemon's serve record** with `port`/`host`
  rewritten to 8080 and every other field (pid, `instance_id`, heartbeat) copied
  verbatim, because `discovery.ts` dials the address a record names and compares
  `/health`'s identity to it. Without the mirror the renderer would dial the
  ephemeral port and be refused by the page's own CSP;
* 8080 is checked free immediately before the bind and the whole rig is released
  **by exact pid** when the capture command returns (the rig, the daemon and the
  stub are all started and reaped inside one command; the run prints
  `8080 released before this command returned`).

Per capture, in one command:

```sh
# rig up (stub port 0, daemon port 0, proxy 8080, record mirror), then:
node scripts/renderer-driver.mjs \
  --scene btw-aside \
  --backend http://127.0.0.1:8080 \
  --backend-records <rig>/records \
  --seed-onboarding-complete \
  --out <frames-dir> \
  --clean
# then: every pid above signalled; 8080 verified free
```

and the same command with `--window-size 700x900 --run-label narrow` for the
narrow pass. The scene is the repo's own harness (`scripts/renderer-driver.mjs`,
documented in `docs/agent-driver.md`): the BUILT app, launched by its own
Electron in `--window-mode=headless` (never shown, never focused), driven
through the dev-driver bridge and CDP, with every frame written by
`webContents.capturePage()`. **No browser engine was installed or scripted, no
`browser` tool, no `screencapture`.**

* window mode: `headless` (the only mode used) — the run asserts
  `visible=false focused=false` from main before capturing;
* viewport: **1380x868 CSS px at dpr 2** (2760x1736 px) for `after-*`/`before-*`;
  the narrow pass asks for 700x900 and the app clamps its window to a
  **800x868** content viewport (1600x1736 px), which puts the chat column under
  the composer's own 550px small-view threshold;
* theme: `localOperatorDark` (the scenes call the app's own `setTheme`). The
  light theme was not photographed;
* provider: a scripted stub, not a real model. Its answer is 8 SSE chunks, the
  first delayed 1.8s and the rest 300ms apart, so the `thinking` and
  `mid-stream` states are real states rather than races.

## What each frame shows

Frames are from the SAME scene text in both trees (`--scene btw-aside`); the
scene detects which surface the first Enter produced and asserts what that tree
did, so a run cannot pass on a tree where its claims are untrue. Both runs
finished `ALL CHECKS PASSED` (after: 39 checks; before: 27).

**After — the panel (`415b38242`)**

| Frame | What it shows |
| --- | --- |
| `after-01-panel-thinking.png` | ONE Enter: the panel is attached above the composer with the question on it and `thinking…`; adopt disabled with its reason; the composer keeps the caret |
| `after-02-panel-midstream.png` | the answer mid-stream — partial prose, adopt still disabled, no second liveness element |
| `after-03-panel-settled.png` | the settled exchange: answer at reading weight, adopt enabled, chord advertised |
| `after-04-composer-typed-while-panel-up.png` | **the reported bug, fixed** — `composer probe line` typed and held in the composer while the answer is on the panel, caret in the box |
| `after-05-escape-restored.png` | Escape closed the panel, the composer kept its text and its caret, routing back to the thread |
| `after-06-empty-panel-bare-btw.png` | a bare `/btw`: an empty panel that says where the question goes, adopt disabled with its reason |
| `after-07-panel-error.png` | a refused ask: the error is stated ON the panel (`role="alert"`), adopt disabled, nothing in a toast |
| `after-narrow-01…07…` | the same seven states at the narrow column (small-view branch: the exchange region scrolls) |

**Before — the modal (`ff064112f`)**

| Frame | What it shows |
| --- | --- |
| `before-01-modal-open.png` | ONE Enter opens a Radix **modal** with the question parked in its own field and an unanswered `Ask` button — the second press the report is about |
| `before-02-composer-blocked.png` | a probe typed while the modal is up does not reach the composer (read as the composer's own `elementFromPoint` hit test plus its painted value) |
| `before-03-modal-answered.png` | after the modal's OWN control is pressed: the finished answer, all at once, unrendered as text (`**5xx**` painted literally); composer still unreachable |
| `before-04-followup-erased.png` | typing into the modal's follow-up field: the field stays empty and the typed text is repainted into the **previous question's label** above it (`Q: composer probe line`) |
| `before-05-escape-restored.png` | Escape closed the modal; the composer is restored |

## What these frames do NOT prove

* **Focus rings and carets do not render in `headless`.** A `headless` window is
  never shown and cannot be focused, so `:focus-visible` outlines, text carets
  and anything gated on `document.hasFocus()` are outside what these stills can
  show (the harness documents this). Keyboard operability here is asserted by
  driving keys and reading `document.activeElement`, not by pixels.
* **One theme, one platform.** `localOperatorDark` only; no light-theme frames,
  and no Windows/Linux rendering.
* **A scripted provider.** The answer's shape, length and pacing are the stub's.
  Nothing here is a claim about a real model's output or latency.
* **The 220px column floor (canvas panel open) was not captured.** The narrow
  pass reaches the small-view branch via a clamped window; the collapsed column
  with the canvas pane open is a different, narrower case.
* **Adopt was never executed.** The frames show the control's enabled/blocked
  states and its advertised chord; the actual adopt (splice into the transcript)
  was not driven.
* **No toasts are photographed.** The harness waits for the app's own toasts to
  clear before a settled frame; a frame here is not evidence about toast
  styling, placement or timing.
* The marker text `TOOLCALL2: keep calling tools` in `after-07` is the rig's own
  question: that string is what makes the scripted provider answer with a bare
  tool call so the backend's typed refusal can be photographed.

## Frame hashes (sha256, first 16 hex)

| Frame | sha256[:16] |
| --- | --- |
| after-01-panel-thinking.png | `41d1f6c006467ba6` |
| after-02-panel-midstream.png | `3b361bf151100c97` |
| after-03-panel-settled.png | `7732b65224308c4a` |
| after-04-composer-typed-while-panel-up.png | `1d3ea222deb87041` |
| after-05-escape-restored.png | `b1e3b36ef27e69d5` |
| after-06-empty-panel-bare-btw.png | `3afd78cc2bf36fec` |
| after-07-panel-error.png | `8828b584a7857180` |
| after-narrow-01-panel-thinking.png | `f859d7a4f58f5602` |
| after-narrow-02-panel-midstream.png | `d277766d33d5ee9c` |
| after-narrow-03-panel-settled.png | `c8cfcf0aaa41d6f3` |
| after-narrow-04-composer-typed-while-panel-up.png | `52c4b69f9f163671` |
| after-narrow-05-escape-restored.png | `b10e5f837aee5579` |
| after-narrow-06-empty-panel-bare-btw.png | `bd638adcf8f45df2` |
| after-narrow-07-panel-error.png | `e9d25a9ad300e537` |
| before-01-modal-open.png | `f9153142907ea2e4` |
| before-02-composer-blocked.png | `4b8fb94d7262b5a9` |
| before-03-modal-answered.png | `e9580ed74ec0da83` |
| before-04-followup-erased.png | `2f5cc1b6afc6f28e` |
| before-05-escape-restored.png | `5de2333bc9f4f228` |
