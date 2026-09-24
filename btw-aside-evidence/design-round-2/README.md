# `/btw` aside — design review round 2 frames (PR #482 at `97ff24e1d`)

Convergence round on the surfaces that changed after design round 1 (`415b38242`):
D1's derived exchange ceiling, D2/D3's amended copy, the adopted exchange repainting
in the transcript, the composer error line for a refused aside, and F9's transcript note.

## Rig

* UI: a detached worktree at `97ff24e1d`, built with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` (OAuth client ids set to
  placeholders; no sign-in flow is in these frames).
* Backend: a detached worktree of `local-operator` `origin/main` = `56e91b78b`
  (contains #1488 at `c2529404e`), its own uv venv, bound to an OS-chosen port.
* Provider: `rig/stub_provider.py` — the round-1 stub plus: the 8-chunk answer the
  shipped scene expects (1.8 s to the first chunk, 300 ms apart); `LONGANSWER` (a
  two-paragraph answer that overflows the exchange cap); `SLOW` (a 2.5 s delay
  so the panel can be closed before a `TOOLCALL2` refusal lands).
* `rig/proxy.mjs`: an unbuffered proxy on 8080 plus a serve-record mirror. 8080 was
  taken under the shared lock, checked free before the bind, and released when each
  capture command returned (`8080 released before this command returned`).
* Driver: `scripts/renderer-driver.mjs` in `--window-mode=headless` (never shown),
  frames via `capturePage()`. The shipped `btw-aside` scene runs first, then the
  round-2 extension in `rig/scene-r2.mjs`. That extension was an uncommitted
  driver-only patch in the reviewer's worktree; the app source was unmodified. It
  also passes `--theme` through to the scene's `setTheme`.
* Passes: wide 1380x868 CSS @ dpr 2 dark (`after-*`, `r2-*`), narrow 800x868 dark
  (`*-narrow-*`), wide light `localOperatorLight` (`*-light-*`). 43 PASS, 1 FAIL each.
  The one FAIL is the follow-up-visibility check (D6).
* Storybook: `storybook build` of this head, served from an OS-chosen port and captured
  with the harness `browser` tool (`sb-*.png`).

## Hashes (sha256, first 16 hex)

| Frame | sha256[:16] |
| --- | --- |
| after-01-panel-thinking.png | `78d68f3dee244892` |
| after-02-panel-midstream.png | `d59bd668c8c5f3a6` |
| after-03-panel-settled.png | `6bbb909523c3b34c` |
| after-04-composer-typed-while-panel-up.png | `8c40a906b835aea6` |
| after-05-escape-restored.png | `34f844f8b318f996` |
| after-06-empty-panel-bare-btw.png | `e7f4143af882c63e` |
| after-07-panel-error.png | `556375040a5a844f` |
| after-light-03-panel-settled.png | `141dd8e2b76a9821` |
| after-light-06-empty-panel-bare-btw.png | `afa08ca1ba8fcc99` |
| after-light-07-panel-error.png | `cc4862aa11f95b8e` |
| after-narrow-03-panel-settled.png | `2d3023227d73535d` |
| after-narrow-06-empty-panel-bare-btw.png | `fb628ca389fbbc10` |
| after-narrow-07-panel-error.png | `3ffcc904531f7572` |
| r2-01-long-answer-at-rest.png | `8a204719b8774b84` |
| r2-02-long-answer-scrolled-end.png | `f3e5aa6bdd51639e` |
| r2-02b-followup-asked-while-overflowing.png | `94d8c933cd347a78` |
| r2-02c-followup-settled.png | `59a2194fb90f9355` |
| r2-03-adopted-in-transcript.png | `9b174b05e0259c6a` |
| r2-03a-adopt-first-frame-without-panel.png | `945d35ee4b395ea7` |
| r2-04-composer-error-line.png | `8d51012eb8b694fb` |
| r2-05-command-door-transcript-note.png | `3d7a364597af1472` |
| r2-05a-command-door-asked-before-escape.png | `165f2a68976ed9ef` |
| r2-light-01-long-answer-at-rest.png | `af5689d9ed37b4eb` |
| r2-light-02-long-answer-scrolled-end.png | `0ab714e80253b239` |
| r2-light-02b-followup-asked-while-overflowing.png | `167526339cf5e68a` |
| r2-light-02c-followup-settled.png | `c04e06ae72da3de1` |
| r2-light-03-adopted-in-transcript.png | `b570effaaf69d57c` |
| r2-light-03a-adopt-first-frame-without-panel.png | `b570effaaf69d57c` |
| r2-light-04-composer-error-line.png | `06c57055bcee2d5e` |
| r2-light-05-command-door-transcript-note.png | `7d2b258c3e585a86` |
| r2-light-05a-command-door-asked-before-escape.png | `63e7b8542fc8a0e3` |
| r2-narrow-01-long-answer-at-rest.png | `8d9886b2ab3f7824` |
| r2-narrow-02-long-answer-scrolled-end.png | `29b35ac9b5deae20` |
| r2-narrow-02b-followup-asked-while-overflowing.png | `9165747dc7c6f76f` |
| r2-narrow-02c-followup-settled.png | `5dd37ec8699b5af8` |
| r2-narrow-03-adopted-in-transcript.png | `5a56cfcdde011979` |
| r2-narrow-03a-adopt-first-frame-without-panel.png | `c5cca54616eadd89` |
| r2-narrow-04-composer-error-line.png | `02e28f25b653e5bb` |
| r2-narrow-05-command-door-transcript-note.png | `36ccf0272379f2dc` |
| r2-narrow-05a-command-door-asked-before-escape.png | `3b4d774067cf89eb` |
| r2-pass1-01-long-answer-1px-overflow.png | `67b79a8f909f4e53` |
| sb-ask-failed.png | `e1368f6e04140663` |
| sb-empty-panel.png | `9bcfb065012fa866` |
| sb-follow-up.png | `76d2955c425406a3` |
| sb-refused.png | `a346aa611783c685` |
