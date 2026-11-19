# The passkey notice, headless, on the head that adds it

Frames from `node scripts/browser-challenge-proof.mjs --arm passkey --attempts 1 --out <dir>`
(committed, re-runnable) against this branch's built tree, `--window-mode=headless`,
scratch HOME and `--user-data-dir`, `--use-mock-keychain`, the opener stubbed. Each
frame is the APP'S OWN RENDERER over CDP (`Page.captureScreenshot`): the notice is
chrome, outside the page rectangle, so nothing is composited and the page area is
the native view's (blank in a renderer capture by construction).

**Naming.** Frames are `<set>/<theme>.webp`, and the evidence gate derives a frame's
expected ground from the FILE NAME, so the name is the palette the frame was
painted under (`localOperatorDark` or `localOperatorLight`). The frames are rig
output in the ignored `docs/evidence-frames/` and are not committed
(`scripts/check-evidence-structure.mjs` refuses a committed frame); regenerate them
with the command above. The set's manifest entry is in `docs/evidence/manifest.json`.

| frame | state |
| --- | --- |
| `passkey-notice-user-top/localOperatorDark` | a user tab, request from the page itself |
| `passkey-notice-user-top/localOperatorLight` | the same state under the light ramp |
| `passkey-notice-user-top-narrow/localOperatorLight` | 800 px wide, light: the sentence wraps and the button stays whole |
| `passkey-notice-agent-tab/localOperatorDark` | an agent-driven tab, shown after the user activates it |
| `passkey-notice-agent-tab-narrow/localOperatorDark` | 800 px wide, dark |
| `passkey-notice-embedded-frame/localOperatorDark` | a request from a cross-origin iframe, attributed to the frame |

Result on this head: **arm=passkey pass=1/1**, 29 checks, all PASS (design doc
section 4.4). The headline numbers are in the run's `proof.md`.

## What these frames do not show

- The native page view (the page the notice is about): the renderer capture cannot
  see it, which is also why the notice lives outside the page rectangle.
- A narrow frame in BOTH ramps for the same state: the arm captures the narrow
  frame under the ramp that was active at that point of the run (dark for the agent
  tab, light for the user tab). The overflow check (`scrollWidth <= clientWidth`)
  is asserted in both.
- The OS Touch ID sheet, which was not exercised in this gate-off build (design doc section 3.5).
