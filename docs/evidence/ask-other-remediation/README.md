# The round-1 remediation, one commit later: `r0` -> `r1`

The four round-1 reports on #892 (design, QA, UX, agent review) are terminal on
`8f189b3f40e` with a batch of minors to fix in one remediation. This set is the DELTA
evidence for that remediation: the same three steps driven on the same rig against two
trees, the way `ask-other` pairs `before`/`after`.

- `r0/` - `8f189b3f40e`, the head the round-1 reports read (this branch one commit
  before the remediation).
- `r1/` - `de1b93e0acf` (`fix(asks): round-1 remediation for the Other row and the
  answer field`), the tree this set's `capturedAtHead` names.

Both arms carry the `Other` row (this is not the base set's with/without pair): the
delta is BEHAVIOUR and COPY, so every state has a counterpart on the other arm. 68
frames: 17 state directories per arm, each in Dark and Light. There is no harness of
its own to re-derive from - it reuses `docs/evidence/ask-other/harness/` (rig-up,
rig-down, `serve-other.py`) and the steps `i`/`j`/`k` added to that set's driver in the
same commit as these frames.

## What the frames carry

| step | what is driven | `r0` (`8f189b3f40e`) | `r1` (`de1b93e0acf`) |
| --- | --- | --- | --- |
| i | single-select (`region`): `Other` pressed, `eu-central` typed, an option pressed over it (`us-east`), `Other` pressed again, ` (canary)` inserted, `Send answer` | the field comes back with the caret at offset **0** (`selectionStart=0`), so the insert lands IN FRONT: the field reads `(canary)eu-central` and that is what the daemon logs (`answered {region: ["(canary)eu-central"]}`). The row's hint reads `Type your own answer` | caret at the **end** (`selectionStart=10`): `eu-central (canary)`, logged as `answered {region: ["eu-central (canary)"]}`. Hint: `Type your answer` |
| j | multi-select (`checks`): `Unit tests` ticked, then `Other` pressed EMPTY | `Send answer` is **ENABLED** - the empty row contributes nothing and would be silently dropped from the answer that goes out. Unticking `Other` returns to the tick alone | `Send answer` is **DISABLED** until the field has text or `Other` is unticked (`disabled=true`, probe-read); unticking still sends the tick alone (`answered {checks: ["Unit tests"]}`, both arms) |
| k | change-before-delivery through `Other` (`change-other`): answer `Staging`, `Change answer`, `Other` -> `Canary (5% of traffic)`, `Update answer` | the answered readout reads `Canary (5% of traffic) Other` - the tag runs into the value | `Canary (5% of traffic) · Other` - the app's ` · ` separator, so the tag reads as a label and not as the last words of the answer |

Which finding each pair answers: i is UX round 1's U1 (the caret) and D4's one prompt;
j is design round 1's D1 (the silently-dropped empty `Other`); k is design round 1's D2
(the tag's separator). The revision itself is unchanged in k on both arms
(`revised [Canary (5% of traffic)]` in both logs) - only the readout's grouping moves.

## The numbers behind the frames

Read from the runs' own DOM probe (`run-r0.json`, `run-r1.json`), and identical in both
arms - the remediation moved no geometry:

- The `Other` row is **510 x 29.7px** (`minTarget` 29.6875), the option rows' own
  height, in the card states of every step.
- The field is **478 x 56px** at x=829; opening it grows the question box
  **144.8 -> 208.8px (+64.0)** and moves NOTHING above it: the prompt (y 114.4), the
  three option rows (y 140.4 / 170.1 / 199.8) and the `Other` row (y 229.5) read the
  same in `i1` and `i3` on both arms.
- The drawer's own scroller stays **860/860** (`scrolls: false`) in every state of both
  arms; the field adds its own 54/54 scroller only while it is open.
- `Send answer` is 108.9 x 34px; `j1` differs between the arms in its `disabled` flag
  only, not in its box.
- The only pixels this remediation adds are the two separator glyphs, inside the tag's
  own `text-ink-muted text-xs` span (the token the design round sampled at 7.85:1 Dark /
  8.19:1 Light) and a shorter hint in classes the base set's `dom_audit` states already
  cover. No in-page audit is recorded for these states; one can be taken with the
  `--audit` spelling the base set documents.

## What this does not cover

- **Attachments in `Other`** are a later change (an answer is `Record<string,
  string[]>` on the wire today). Nothing here accepts a paste or drop it would then
  silently discard; the field refuses files in words.
- **The desktop surface only.** The composer-routing rule this branch reverses is core
  design 5.0's R7; the TUI, phone and app surfaces still route their composers while
  their answer surfaces are expanded, and nothing in these frames speaks for them.
- The same recording stub as the base set (it never calls a tool), no Electron
  window/IPC, and the Light frames' Settled list accumulates from both passes (the
  Light run goes second on the same daemon), so later states show more settled rows;
  the ask under test is always the one the step names.

## Re-deriving the frames

```
# r0: a worktree of 8f189b3f40e; r1: this branch's worktree. One rig each.
RIG_REPO=<r0 worktree>   ASKS_RIG_PORT=5331 bash docs/evidence/ask-other/harness/rig-up.sh
RIG_REPO=<this worktree> ASKS_RIG_PORT=5332 bash docs/evidence/ask-other/harness/rig-up.sh
# One private Chrome drives both arms; --theme=localOperatorLight is the Light pass.
node docs/evidence/ask-other/harness/drive-other.mjs docs/evidence/ask-other-remediation \
  "r0,http://localhost:5331,<r0 scratch>" "r1,http://localhost:5332,<r1 scratch>" --only=i,j,k
RIG_SCRATCH=<scratch root> bash docs/evidence/ask-other/harness/rig-down.sh
```

The driver's `r0`/`r1` labels both expect the `Other` row (its header says why), the
Chrome is launched through `scripts/chrome-keychain.mjs` (`--use-mock-keychain`), closed
through `Browser.close` and killed by exact pid only if that fails; the rig is stopped
by exact pid from its own pid files, never by name.
