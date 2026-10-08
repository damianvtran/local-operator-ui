# Design review round 2 - frames for PR #879 (turn lifecycle honesty)

Evidence-only branch, no product code. Captures of `fix/turn-lifecycle-honesty` @ `57d567c92f1`
(delta `eaed6e0025..57d567c92f1`), same method as round 1 (`rig.mjs` here = round 1's rig plus two scenarios:
`rungflap` and `dblesc`): one headless Electron (`--window-mode=headless`, never shown), one isolated real daemon,
loopback fault proxy, CDP `Page.captureScreenshot`; everything reaped by process group. Build = the worktree's
existing `out/` (head, built 23:21 after the 23:20 commit). Default theme `localOperatorDark`; 12 is light; 13 is 760 px.

`r2-report-*.json` are the sampled DOM reads (line, band, placeholder, outputs, alerts, stop control, rects) per step.
