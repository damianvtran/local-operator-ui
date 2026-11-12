# PR #1880: QA round 3 frames (qa-tester, lopdev, session 4c0fc6cbadb2)

These files are evidence only and are not part of any product tree. The branch is an orphan, following the repo's `evidence/<pr>-qa-r<N>` convention.

**Builds**
- **AFTER** is `a1bc2437a7ad448175554a37e476d0eb2768eb61`.
  - The worktree `src`/`i18n` was clean at build start (18:13:51Z) and at build end (18:14:34Z).
  - Command: `electron-vite build`, writing to `dist/rfp/after-r3/out`. Wall time 42.0 s, rc 0.
- **CONTROL** (`ctl79ae-*`) is round 2's existing `dist/rfp/after-r2/out` build of `79ae38539`, driven by the same rig and the same input. It was not rebuilt.

**Rig**
- Headless Electron 45.1.0 under Xvfb at 1380x872. Frames come from `capturePage()` through the dev-driver bridge.
- `*-zoom.png` frames are crops of a full frame, made with Electron `nativeImage`.
- The desktop fixture runs on loopback. It is round 2's QA copy plus:
  - a 40 MiB path-backed `big-song.wav` row;
  - an older-peer page with no `device_name`.

**File names:** `r3-<theme>-<surface>-<state>.png`. Surface letters:
- (a) transcript
- (b) Files panel
- (c) row menus
- (d) toasts
- (e) canvas
- (f) text pending/retry
- (g) sound pending/retry

**Known artefact:** the "99" and "77" user bubbles, and "This conversation no longer exists, so your message wasn't sent", in some later frames came from a CDP `Input.insertText` probe. That probe committed text into the composer, which is not where a real key event goes; real key events never reach the composer. The fixture answered 404, and no real session exists.
