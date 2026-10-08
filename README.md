# Design review round 3 - frames for PR #879 (turn lifecycle honesty)

Evidence-only branch, no product code. Captures of `fix/turn-lifecycle-honesty` @ `8510200808e` (app build
`out/` of 00:35, byte-identical in behaviour to `cea5f85b974` per the remediation). Method as rounds 1-2: one headless
Electron (`--window-mode=headless`, never shown), isolated real daemon, loopback fault proxy, CDP screenshots, reaped by
process group. `rig.mjs` = round 2's rig plus `sqhold`, `strand`, `u10`, `idleclock` and the proxy's `holdresp` mode.
`r3-report-*.json` are the sampled DOM reads, including the computed style of the Stop square (`sq.*` steps).
