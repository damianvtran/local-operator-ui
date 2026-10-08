# Turn-lifecycle honesty — the before/after frames (PR #879)

Frames for PR #879 (the chat pane's turn-lifecycle honesty fixes, operator
reports 2026-10-07: a sent message's in-flight indicator blanking on a flapping
link, and a Stop press that stopped nothing and said nothing).

**What these are.** The design rounds' own rigs, committed under `harness/`.
One headless Electron (`--window-mode=headless`, window created and never shown,
no Dock tile, page throttling off), against an isolated real `local-operator
serve` daemon, fronted by a loopback fault-injecting proxy (SSE cut/freeze,
`/interrupt` drop/swallow/delay/hold-response); CDP screenshots and sampled-DOM
reports; every process reaped by process group. No run took the operator's
focus.

**Provenance.** `after/` was captured by design round 3 on
`fix/turn-lifecycle-honesty` @ `8510200808e` (app build `out/` byte-identical in
behaviour to `cea5f85b974`), branch `evidence/turn-lifecycle-honesty-design-r3`
(head `6549b2a7190`). `before/` is from the same rig family's round-2 capture on
the remediation head `57d567c92f1`, branch
`evidence/turn-lifecycle-honesty-design-r2` (head `db7a3c5bd9f`) — the frames
shot before the round-2 fixes landed, kept for the defects that have a before
frame. `harness/rig.mjs` is round 3's rig (round 2's plus `sqhold`, `strand`,
`u10`, `idleclock` and the proxy's `holdresp` mode); `harness/r3-report-*.json`
are the sampled-DOM reports the frames were taken beside. Same method in both
rounds; 1380x900 dark except where a frame's name says otherwise.

## The set

| after (head `8510200808e`) | shows |
| --- | --- |
| `after/r3-01-D10-dblesc-first-escape.png` | D10: first Escape — rung `stopping the turn`, composer `Stopping the turn`, square pressed (`data-stopping`), no sentence |
| `after/r3-02-D10-dblesc-second-escape-nothing-changes.png` | D10: the double-tap — second Escape +0.9 s changes NOTHING (same rung, same sentence-space empty, square still held) |
| `after/r3-03-D10-dblesc-frozen-3.4s.png` | D10: still frozen — the rung holds |
| `after/r3-04-D10-dblesc-unfrozen-band-restored.png` | D10: on unfreeze — band `Stopped · Retry`, placeholder back to `Ask anything…` (the band the defect lost) |
| `after/r3-05-D10-gapesc-x3-held.png` | D10: Esc x3 in a gap — wire count 1 (the first press sends; the rest are coalesced), rung held, no idle bounce |
| `after/r3-06-D10-gapesc-restored-band.png` | D10: restored — band stands (was: no band) |
| `after/r3-07-recvgap-gap-5.2s.png` | acceptance: receipt delivered inside a gap — rung held through the gap |
| `after/r3-08-recvgap-restored-band.png` | acceptance: restored — band |
| `after/r3-09-D6-square-rest-hover-pending.png` | D6: the square rest-vs-pending step (`data-stopping` composite) |
| `after/r3-10-D6-pending-keyboard-path-full.png` | D6: the pending hold on the keyboard path, full window |
| `after/r3-11-D6-square-pending-light.png` | D6: the pressed composite, LIGHT palette (345x345 crop of the square) |
| `after/r3-12-U9-disputed-idle-no-clock.png` | U9: the disputed idle — line label without its number (`running bash`, no `Ns`) beside the sentence; both retire on unfreeze |
| `after/r3-13-U10-placeholder-flips-back.png` | U10: receipt withheld, feed shows the end — band `Stopped · Retry`, placeholder already `Ask anything…` |
| `after/r3-14-R2-1-strand-clean.png` | R2-1: the receipt lands AFTER the end (held 900 ms) — placeholder clean, band standing, no strand |
| `after/r3-15-lostlate-band.png` | bound alert lifecycle: the late-but-real stop — band restored, alert gone |
| `after/r3-16-narrow-760-stopping.png` | the narrow (760 px) read of the stopping state |

| before (head `57d567c92f1`) | shows | pairs with |
| --- | --- | --- |
| `before/r2-14-D10-double-escape-rung-bounces.png` | D10's defect: after the second Escape the rung falls back to `running bash 2s` | `r3-02`/`r3-03` |
| `before/r2-15-D10-double-escape-no-band.png` | D10's defect: on unfreeze — no band, the idle sentence over a confirmed press | `r3-04` |
| `before/r2-06-gapesc-x3-idle-sentence.png` | D10's defect: Esc x3 in a gap — `running bash 6s` with the idle sentence | `r3-05` |
| `before/r2-16-D10-gapesc-restored-no-band.png` | D10's defect: restored — no band | `r3-06` |
| `before/r2-09-idle-sentence.png` | U9's defect: the ticking clock (`running bash 6s`) beside the disputed sentence | `r3-12` |

The sampled-DOM reads that go with each frame are in
`harness/r3-report-main.json` / `r3-report-extras.json` (round 3) — e.g.
`r2b`-side reads for the before half are cited in the PR's remediation comments
and the round-2 evidence branch.

## What this set does NOT show

- `u10` and `lostlate` have no before frame in these branches: their defect
  states were measured by UX round 2's own rig (the `P-withhold` walk) and by the
  round-2 sampled reads, neither committed as a frame. The `r3-13`/`r3-15`
  frames are the after side.
- Other themes than `localOperatorDark` (plus the one light crop, `r3-11`); a
  pending approval gate during Stop; real packet loss (faults are HTTP-level at
  the proxy); wake/monitor-started turns. Round 3's design report carries the
  same bounds.
- The frames are composites of one window at 1380x900 (760 px for `r3-16`), not
  an animation: `r3-02` vs `r3-03` and the round-2/3 reads are how the "nothing
  changed" claim is read as motion.
