# `/btw` aside — design review round 3 frames (PR #482 at `0bc4a97bb`)

This round converges on what `97ff24e1d..0bc4a97bb` changed on screen: D6's scroll on append, D7's clear on a new ask,
D8's quoted off-panel copy, D10's ceiling, U6's focus return, U9's `aria-describedby`, the placeholder order in
`composerPlaceholder` (gate, then aside, then #479's "Sending your message"), and #479's composer states under an attached aside.

## Rig
* **UI:** a detached worktree at `0bc4a97bb`, built with `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`. The four OAuth
  build variables were set to a non-credential placeholder. The app source was not modified.
* **Backend:** `local-operator` `origin/main` = `a510ca967`, which contains #1488 at `c2529404e`. It ran in its own detached
  worktree and uv venv (`local_operator.__file__` was asserted to be inside that tree) and bound an OS-chosen port.
* **Provider:** `rig/stub_provider.py` is round 2's stub with three new markers:
  * `NLINES<n>`: an answer of exactly *n* short lines, separated by hard breaks.
  * `LONGSLOW`: the long answer, paced at 350 ms per chunk.
  * `SLOWTURN`: a thread turn whose first chunk arrives at 6 s.
* **Proxy:** `rig/proxy.mjs` is round 2's proxy, plus a 4 s hold on `POST …/messages`. The hold keeps #479's
  "Sending your message" window open long enough to attach an aside on top of it. The proxy was the only listener on 8080.
  It ran under the shared `port8080.lock`, one pass at a time, and every pass logged
  "8080 released before this command returned" and "lock released".
* **Driver:** an uncommitted copy of `scripts/renderer-driver.mjs` with `rig/scene-r3.mjs` appended. It ran in
  `--window-mode=headless` and asserted `visible=false` at the start. Frames come from `capturePage()`. Input was real
  `Input.dispatchKeyEvent` / `insertText` / mouse presses, and every number was read from the app's own DOM.
* **Isolation:** `env -i` with a scratch `HOME` and `LOCAL_OPERATOR_CONFIG_DIR`, no `CMUX_*`/`LOP_*`, and
  `GIT_CONFIG_SYSTEM=/dev/null`. Every pid was reaped by exact pid.
* **Passes** (each scored 17 PASS / 0 FAIL, `logs/driver-*.log`):
  * `r3-wd-*`: wide, 1380x868 CSS @ dpr 2, `localOperatorDark`
  * `r3-nd-*`: narrow, 800x868 (clamped), dark
  * `r3-wl-*`: wide, `localOperatorLight`

  An earlier wide pass with the same scene minus two steps is not published. Its D10/D6 numbers were identical.

The rig markers in the questions (`NLINES9`, `LONGSLOW`, `SLOW TOOLCALL2`, `SLOWTURN`) are what the stub reads. They are not product copy.

## Hashes (sha256, first 16 hex)
| Frame | sha256[:16] |
| --- | --- |
| r3-nd-01-11-line-answer.png | `75aa811e188d7d95` |
| r3-nd-01-9-line-answer.png | `b13a8c6815580b87` |
| r3-nd-02a-long-answer-at-rest.png | `ebac93db248fb909` |
| r3-nd-02b-followup-just-asked.png | `87066dad512c3b4e` |
| r3-nd-02c-followup-midstream.png | `b3344ce2359fc43a` |
| r3-nd-02d-followup-settled.png | `f21405f2953d1390` |
| r3-nd-03a-u2-gate-composer-line.png | `066ef0891985d823` |
| r3-nd-03b-long-followup-settled.png | `c612eab2f7b58317` |
| r3-nd-03c-long-followup-midstream-untouched.png | `20f9e26d7108d0c6` |
| r3-nd-03d-long-followup-settled-untouched.png | `e7135be7e667ef14` |
| r3-nd-04a-thinking-u9.png | `d4721015b2b619c4` |
| r3-nd-04b-adopt-first-frame-without-panel.png | `c48713d9198d8bd8` |
| r3-nd-04c-adopted.png | `b10aa9ebf4858a87` |
| r3-nd-05a-composer-error-line-d8.png | `cd9912bd65e20dbb` |
| r3-nd-05b-d7-new-aside-retires-line.png | `e7094c3bec741b8c` |
| r3-nd-06-transcript-note-d8.png | `1013d3e7343e6d34` |
| r3-nd-07a-sending-no-aside.png | `16fea77b98db3f33` |
| r3-nd-07b-sending-plus-aside.png | `ae6983f67adb4b91` |
| r3-nd-07c-working-plus-aside.png | `fd1040702e02844c` |
| r3-nd-07d-new-chat-after-switch.png | `b24f6006007d1ef6` |
| r3-wd-01-11-line-answer.png | `d25c3139ff46a775` |
| r3-wd-01-9-line-answer.png | `e733739759c79f15` |
| r3-wd-02a-long-answer-at-rest.png | `8e2e39f08036d5e4` |
| r3-wd-02b-followup-just-asked.png | `542a8c779e0693c3` |
| r3-wd-02c-followup-midstream.png | `b318ec04a9910c03` |
| r3-wd-02d-followup-settled.png | `4229501039d4d77f` |
| r3-wd-03a-u2-gate-composer-line.png | `025c9f8e0f0d3d18` |
| r3-wd-03b-long-followup-settled.png | `c6789d7af4c35a87` |
| r3-wd-03c-long-followup-midstream-untouched.png | `66dcbd30afc6b90a` |
| r3-wd-03d-long-followup-settled-untouched.png | `bb69340496692208` |
| r3-wd-04a-thinking-u9.png | `de956e0d4d294e29` |
| r3-wd-04b-adopt-first-frame-without-panel.png | `1f8785805249d634` |
| r3-wd-04c-adopted.png | `1c5ae1b77ad98cae` |
| r3-wd-05a-composer-error-line-d8.png | `90be567fc335e448` |
| r3-wd-05b-d7-new-aside-retires-line.png | `71d07a01f2834d1e` |
| r3-wd-06-transcript-note-d8.png | `cc5ebe9093944981` |
| r3-wd-07a-sending-no-aside.png | `1abc486c28684819` |
| r3-wd-07b-sending-plus-aside.png | `896660af0985ac8a` |
| r3-wd-07c-working-plus-aside.png | `a91d81f4243783d8` |
| r3-wd-07d-new-chat-after-switch.png | `3af96b5a50438006` |
| r3-wl-01-11-line-answer.png | `e6655cf5db6b203e` |
| r3-wl-01-9-line-answer.png | `2f16a3dd9eedf8e9` |
| r3-wl-02a-long-answer-at-rest.png | `bee6c9aa1cc4c9b8` |
| r3-wl-02b-followup-just-asked.png | `76715a5db7f57893` |
| r3-wl-02c-followup-midstream.png | `13c713704efd8839` |
| r3-wl-02d-followup-settled.png | `da5a58fe35ac32a2` |
| r3-wl-03a-u2-gate-composer-line.png | `6fb12891077c3580` |
| r3-wl-03b-long-followup-settled.png | `bd99c2a2caab24e2` |
| r3-wl-03c-long-followup-midstream-untouched.png | `444d92147d60f0e9` |
| r3-wl-03d-long-followup-settled-untouched.png | `36cbfd4e3e542387` |
| r3-wl-04a-thinking-u9.png | `f9694af7808ffca0` |
| r3-wl-04b-adopt-first-frame-without-panel.png | `0c1ae73481a324dc` |
| r3-wl-04c-adopted.png | `0c1ae73481a324dc` |
| r3-wl-05a-composer-error-line-d8.png | `b8ff357d7e300c19` |
| r3-wl-05b-d7-new-aside-retires-line.png | `a74940d0c8c3503f` |
| r3-wl-06-transcript-note-d8.png | `d482dc6729638225` |
| r3-wl-07a-sending-no-aside.png | `719dbf6002c943e3` |
| r3-wl-07b-sending-plus-aside.png | `cf1f39a30e085314` |
| r3-wl-07c-working-plus-aside.png | `2047ee2aea81dd5f` |
| r3-wl-07d-new-chat-after-switch.png | `808021561d691e5a` |
