# Peer reconnecting — rendered evidence

Captured 2026-10-21 through the harness `browser` tool, desktop UI browser host,
against Storybook dev at `http://localhost:6006` from PR #1302 worktree.
Production source at `5e6f15a5d1`; the story additions in this evidence commit do
not change production code. No screenshot substitution or alternate browser.

Four `chat-sidebar-status-feed` stories stage the same synthetic peer row through
`settlePeerCatalogue`: `remote-presence-before`, `remote-presence-reconnecting`,
`remote-presence-down`, `remote-presence-recovered`. These are presentational
snapshots, not proof of live network transition (the core two-relay tests cover
that). "Before" reproduces the legacy null-last-seen symptom using the unchanged
legacy branch on this head; it is not a separate old binary capture.

Observed frames:
- before: amber WifiOff and `Link down · unknown`;
- reconnecting: dim WifiOff and `Reconnecting`;
- down: amber WifiOff and `Link down · 2m ago`;
- recovered: resting ring and age, no link-down or reconnecting label.

The fixture sets last-seen to three minutes before its play function; the list
clock predates that play by a fraction of a second, so the captured age floors to
`2m ago`. No inference of a more precise last-contact time is made.

Browser `styles` measurements at the reconnecting state (CSS pixels):
- viewport/body: 1280 × 720;
- remote row: x=12, y=267.5, width=335, height=32;
- trailing text: x=265.34, y=274.8, width=77.66, height=17.4, font=12px;
- trailing text color: rgb(166,160,145), class `text-ink-dim`.

The screenshots are 2560 × 1440 device pixels. Two consecutive reconnecting
captures are byte-identical (no layout/reflow delta observed). Each state was
viewed through the image reader, not only captured. Independent design review
is handled by the manager's designer and remains a separate gate.

| File | SHA-256 |
|---|---|
| `before.png` | `907213a6b74a228e059bfa95835d230e9e49e0bfb99f8a5cadf3b8317091ac59` |
| `down.png` | `60bce900a9f89a6eca829e25504531893e5241aa06c8b3bd1294ff576d7f6bc1` |
| `reconnecting-settled.png` | `1d598ece8a78f0cdc793cfbb4b09cb04abd44316a8d6a38341c30969c46692ff` |
| `reconnecting.png` | `1d598ece8a78f0cdc793cfbb4b09cb04abd44316a8d6a38341c30969c46692ff` |
| `recovered.png` | `dad5a883ed160dba2dd20d373d2af597c86ed4d79ffea19b3180dc1e6b0f4af0` |
