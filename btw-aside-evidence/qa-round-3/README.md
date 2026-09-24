# QA round 3 frames: PR #482 at 0bc4a97bb

Independent QA pass (`qa-482-r3`, model `deepseek/deepseek-flash` after a provider
failover mid-run) on the delta since QA round 2 (`97ff24e1d`): the round-4/UX-1/
design-2 remediation plus the fold onto main `65c325afe`.

## Stack

- **App**: the built renderer at the PR head `0bc4a97bb`, built with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`. Headless through
  `scripts/renderer-driver.mjs` (`--window-mode=headless`, `visible=false`), theme
  `localOperatorDark`, dpr 2. Wide is 1380x900 (1380x868 content); narrow is
  700x900, which the app clamps to 800x868 content.
- **Backend**: the REAL daemon from local-operator `origin/main`, resolved at
  `a510ca967`, in its own detached worktree with its own `uv` venv; #1488
  (`c2529404e`) is an ancestor. Not the proxy's emulation: the 409s, the
  `aside_delta` routing to the asking subscription and the 200s below are the
  daemon's own.
- **Provider**: the scripted OpenAI-compatible stub from earlier rounds, with one
  addition this round — `LONGANSWER`, a ~3000-character answer in 300-character
  chunks, so the D6 exchange overflows the panel's cap at every width.
- **Ports**: the stub and the daemon bound OS-chosen ports; the only thing on 8080
  was this round's instrumented proxy, under the shared lock. 1111 was never bound.

`rig/` holds the scene source (`scene-r3.js`, `scene-r3-479.js`), the helper layer
(`helpers-r1.js`), round 2's scene (re-run as the regression neighbour), the proxy
and stub, and the capture/patch scripts. The app's source at the head is unmodified;
the driver is a COPY of the shipped one with the scenes appended.

`one-moment-head-30runs.txt` and `one-moment-main-30runs.txt` are the A/B of the
per-frame composer probe: the same scene driven against the PR head and against
main `65c325afe` (a rebuilt renderer at that ref, same rig), 30 presses each.
