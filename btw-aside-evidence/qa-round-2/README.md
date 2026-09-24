# QA round 2 frames: PR #482 at 97ff24e1d

These frames were captured headless (`--window-mode=headless`) through `scripts/renderer-driver.mjs` using `capturePage()`, with theme `localOperatorDark` at dpr 2. The **wide** set is 1380x900 (1380x868 content). The **narrow** set is 700x900, which the app clamps to 800x868 content. The **compat** set is wide, against the proxy emulating a daemon that predates `subscription_id`.

Stack: the real daemon from local-operator `origin/main` (`56e91b78b`, which contains #1488), behind an instrumented proxy on 8080, with a scripted OpenAI-compatible provider. Every port was OS-chosen except 8080.

`rig/` contains the scene source (`scene-r2.js`), which is appended to a copy of the driver together with QA round 1's helper layer. It also contains the proxy, the stub (with added `EMPTYANS`/`TOOLSILENT` markers) and the capture script. The app source at the head is unmodified.
