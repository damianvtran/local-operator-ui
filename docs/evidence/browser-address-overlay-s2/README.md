# S2 browser address overlay — native evidence

Probe-only slices: a visual mirror of the in-flow address list in a native child
this app owns. The parent keeps the input, DOM focus, IME, every key and the
accessible combobox; the child document is `aria-hidden` with no roles, no focus
targets and no preload. This set is evidence for the probe, not a product claim:
native-composite pixels (V2) and native hit routing/focus (V3) are **BLOCKED**
and are not claimed anywhere in `matrix.md`.

- `matrix.md` — the built app's own rows, each with the command's actual output.
  Status vocabulary: PASS (observed), asserted-only (pure/unit only),
  BLOCKED (not provable here). Round-1 counts: **31 PASS, 3 asserted-only,
  3 BLOCKED, 0 FAIL**; probe exit 0, teardown `code: 0`, `survivors: []`.
- `facts.json` — every probe receipt in order, derived from the run's
  append-only `events.jsonl`.
- `build-identity.json` — the exact built artifacts (SHA-256) and the emitted S2
  document's CSP, which is compared with the pinned policy before any boot. It
  also records `gitHead`, `gitDirty`, `worktreeDiffSha256` and `hostLoad`: the
  build ran from the working tree at `e99863a401` plus the round-1 remediation
  diff, and says so instead of naming the parent commit as if it were clean.
- `plan.json` — the planned rows and their final assignment.
- `teardown.json` — SIGTERM result and survivor list for the S2 matrix boot.
- `s1-control-matrix.md` — the **same build** with the S2 opt-in unset, run as
  the same-code control: 24 PASS and 5 asserted-only, exit 0, `leftovers: 0`,
  `survivors: []`.

## Commands

```sh
python ~/local-operator/scripts/run_bounded.py --timeout 400 --memory-mb 2600 -- \
  env LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm exec electron-vite build
python ~/local-operator/scripts/run_bounded.py --timeout 600 --memory-mb 2600 -- \
  node scripts/browser-address-overlay-probe.mjs --s2 --out "$LOCAL_OPERATOR_SCRATCHPAD/address-overlay-s2/native"
node scripts/browser-address-overlay-probe.mjs --out "$LOCAL_OPERATOR_SCRATCHPAD/address-overlay-s2/s1-control"
```

## Frames

`child-rows3.png`, `child-rows5-active.png`, `child-notice.png`,
`child-hostile.png`, `child-ru.png`, `child-ur.png`, `child-ur-rows.png` (RTL
rows with an active row) and `child-notice-narrow.png` (real catalogue copy at a
480-DIP field) were captured with CDP `Page.captureScreenshot` **on the child
target** (not `capturePage`) and viewed. They are not committed:
`scripts/check-evidence-structure.mjs` forbids frame containers under
`docs/evidence/**`. Their byte sizes and paths are in the V1/R5/R5b rows of
`matrix.md`; the run's scratch directory is the regenerable source.

## Round-1 remediation

- **M1 (paint box).** `addressListMeasurementProblem` now compares the child's
  reported viewport (`visualViewport.height`, else `innerHeight`) with the
  requested height and treats a mismatch as retryable `measure_viewport`; the
  active row's document bottom is checked against that paint box. The retry is
  8 attempts at 150 ms (1.2 s) and the view is made visible *before* measuring:
  Chromium does not deliver a resize to a hidden `WebContentsView` (measured:
  native bounds 211, renderer viewport stuck at 140). A visible window lands on
  the first or second attempt. The negative control is in
  `scripts/browser-address-overlay.test.mjs` ("one DIP of rounding is
  tolerated", 69-vs-140 → `measure_viewport`).
- **Q-1 (S2-off retry storm).** The port latches on the first "No handler
  registered" answer, checks the latch inside the returned method, and keeps one
  invoke in flight renderer-wide (state on the renderer global, because a
  code-split bundle can hold two copies of the module). The mirror hook stops
  its animation-frame loop on that latch and on permanent refusals
  (`overlay_failed`, `disposed`, `owner_unavailable`). G1b drives real typing
  with S2 off: **1** unregistered-channel invoke over 3 s (round 1: 381), and
  the list is open (`dockOpen: true`, 2 candidates) the whole time.
- **m1.** The S2 key/context-menu/mouse listeners are registered only on the
  scripted child (`this.javascript`), so the S1 child's listener set is
  unchanged; the S1 control matrix is unchanged.
- **m2.** The `executeJavaScript` comment no longer claims `JSON.stringify`
  escapes U+2028/2029 or `</script>`; a test asserts it does **not** and that
  the projection sanitizer strips them.
- **m3 / Q-2.** Row ids are unique (`R3` real input, `R3-synthetic`,
  `R1-real`, `C3b`) and `record()` throws on a second record for one id.
  K1 now drives ArrowDown, Escape, **Enter** (commits the active candidate and
  hides) and **Tab** (hides, URL unchanged); C3 drives the stale-seq refusal and
  C3b drives an out-of-range click (refused, zero commits).
- **m4 / U1.** `before-mouse-event` prevents only `mouseDown`/`mouseUp`; moves
  are delivered and counted (`mouseMoves`), so the row's `:hover` can paint.
  Hover pixels are still not observable headless (no pointer capture).
- **D1/D2.** `.lo-row-title` is `flex: 1 1 0%` (dock parity) and the notice
  line-height is 1.5. `child-hostile.png` re-captured: no stranded title
  fragment; `child-notice.png` re-captured at the dock's line box.
- **D3.** `child-ur-rows.png` captures RTL rows with an active row: logical
  order, URL `dir=ltr`, title `dir=auto`, and the 2-DIP bar on the inline-start
  (right) edge. The dock's bar is physical-left; S4 owns the final parity
  decision — this frame records the mirror's current choice.
- **D4.** Every frame now uses the catalogues' own strings
  (`address_suggestions_label/empty/no_match/unavailable` from `en`, `ru`,
  `ur`), read at probe start. R5b captures the unavailable copy in a 480-DIP
  field: it stays inside the 104-DIP block. Multi-line wrapping of a longer
  product string is still unobserved (no such string exists at this width).
- **D5.** Frames still show the CSS fallback tokens, not the resolved app
  tokens; token parity with the dock remains BLOCKED for S4. No "matches the
  dock" claim is made from these pixels.
- **n1.** Built app only: the CSP forbids the Vite dev server's injected styles
  and HMR socket, so `pnpm dev` with S2 fails closed at the first measurement.
  Documented at the env constant and here; no dev-mode allowance.
- **Q-3 / Q-4.** `build-identity.json` records the dirty state and a worktree
  diff hash (above), plus `hostLoad`. A child `load_timeout` under a loaded host
  is BLOCKED evidence, not a pass; the probe does not retry a latched failure.

## Known deviations recorded in the brief

- System mono (`ui-monospace, Menlo`) instead of the app's Geist Mono webfont,
  because the child's CSP forbids font loads. S4 owns final type.
- The probe rig launches with `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding` and `--disable-background-timer-throttling`
  so the hidden window's frame behaviour is closer to the visible product path.
  Nothing becomes visible; V2/V3/V4 stay BLOCKED.
- `--window-mode=inactive`/`normal` are refused by the gate by design; every
  pixel here is child-only, as the brief requires.
