# The optimistic send — frames and measurements

Storybook, desktop width (2560×1440 capture, 1280×720 CSS), themes `oneLight`
and the default dark palette. Stories: `Team Bridge/Optimistic send` — a first
message to a teammate's chief of staff (`Aida (Bea Orti)`), the lane the operator
reported as slow. The transport is the only stub: `onSend` answers after 20 s so
one page can be photographed in flight and again once confirmed.

| file | state |
| --- | --- |
| `after-01-chief-before-press-light.png` | the draft, before Send: name, intro, composer holding the text |
| `after-02-pending-light.png` | **immediately after Send**: the row is in the thread, the composer is clear, the clock is at half ink |
| `after-03-reconciled-light.png` | the same page after the hub's answer: same row, same place, full ink |
| `after-04-failed-light.png` | the hub refused: the row stays, marked "Your message wasn't sent." with Retry and Edit |
| `after-02-pending-dark.png`, `after-03-reconciled-dark.png`, `after-04-failed-dark.png` | the same three states on the default dark palette |

Measured in the page (`--press-to-row-ms`, written by a capture-phase click
listener and a MutationObserver in the story decorator): **19.9 ms**, **6.8 ms**,
**5.8 ms** across three runs — the row exists in the DOM in the same frame as the
press, and it exists before `onSend` is even called to completion.

Measured with the harness's geometry read on the same page, before and after the
confirmation:

```
pending      li[data-row-key] rect 288,593.91 992x52.09
reconciled   li[data-row-key] rect 288,593.91 992x52.09
```

`getBoundingClientRect().top` is **593.91** on both sides of reconciliation: the
row is replaced in place, not remounted, so nothing moves, reflows or re-animates.

Not captured here: the **before** state on `main`. On `main` this story cannot
exist (it is the optimistic path), and a main-built copy of the fixture failed to
render in this session's Storybook run. The before state is evidenced instead by
the RED DOM probe in `scripts/team-bridge-optimistic-send.test.mjs` — run against
`origin/main` it fails with `AssertionError: one row, at the press` (zero rows),
and the operator's own screenshot shows the cleared composer over the empty
thread. Stated rather than papered over.
