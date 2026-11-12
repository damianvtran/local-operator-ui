# PR #1880 — QA round 1 frames (qa-tester, lopdev)

Evidence only; not part of any product tree. Orphan branch per the repo's `evidence/<pr>-qa-r<N>` convention.

- AFTER = `a4462e72159d8fa9a45931c36b380221880ffb30` (worktree src clean at build start and end), `electron-vite build` → `dist/rfp/after/out`.
- BEFORE = `83a18c632` (`git archive 83a18c632 src i18n scripts/vite-plugins` + configs, built under the same node_modules) → `dist/rfp/before/out`.
- Rig: headless Electron 45.1.0 under Xvfb (1380×872, `capturePage()` via the dev-driver bridge), loopback desktop fixture (the coder's remote-files fixture, QA copy: media re-homed as tool results so the transcript renders them, a 3.2 s H.264 MP4 recorded in the app's own Chromium with MediaRecorder, and a `legacy` mode = today's core for BEFORE: peer attachments 409, peer files `unsupported`, Library local-only).
- Names: `<arm>-<theme>-<surface letter>-<state>.png`; surfaces (a) transcript, (b) Files panel, (c) row menus, (d) download, (e) canvas/Library, (f) retryable, (g) audio, (h) video.
