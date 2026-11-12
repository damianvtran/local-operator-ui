# PR #1880 — QA round 2 frames (qa-tester, lopdev)

Evidence only; not part of any product tree. Orphan branch per the repo's `evidence/<pr>-qa-r<N>` convention.

- AFTER = `79ae38539282a0c4496aaa6f63481f967f83e207` (worktree `src`/`i18n` clean at build start 16:48:15Z and end 16:49:03Z), `electron-vite build` -> `dist/rfp/after-r2/out` (47.3 s, rc 0).
- Rig: headless Electron 45.1.0 under Xvfb (1380x872, `capturePage()` via the dev-driver bridge; `*-zoom.png` are CDP clip captures at 2x), loopback desktop fixture (round-1 QA copy plus: a path-backed remote `song.wav`, a real `budget.xlsx`, a 40 MiB `big-notes.md` row, per-key 504 codes, and a LOCAL session's path-backed `local-song.wav` used as a same-head control).
- Names: `after-<theme>-<surface letter>-<state>.png`; surfaces (a) transcript, (b) Files panel, (c) row menus, (d) download toasts, (e) canvas/Library, (f) pending/retryable, (g) audio.
