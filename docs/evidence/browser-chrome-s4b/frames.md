# Frames for the S4b probe run

**The frames are NOT in this repository, and they cannot be.** `.gitignore` ignores
`docs/evidence/**/*.png` (the split that untracked every captured frame), and
`scripts/check-evidence-structure.mjs` fails a commit that force-adds one under
`docs/evidence/**`. This file is the tracked record instead: where the frames
were written, which build produced them, and the SHA-256 of each so a reader can
tell two runs apart.

**Durable-evidence limit, stated plainly:** the frames lived in the run's
scratchpad and the JSON/markdown beside this file is what survives in the
repository. The markdown and JSON are regenerable from
`node scripts/browser-chrome-s4b-probe.mjs --out <dir>`; the pixels are not
reviewable from the repository alone.

## Run

- Rig: `node scripts/browser-chrome-s4b-probe.mjs --out <scratchpad>/s4b-r2b-evidence`
- Scratchpad: `$LOCAL_OPERATOR_SCRATCHPAD/s4b-r2b-evidence/frames` (the agent
  session's scratch directory; pruned with it)
- Build identity (`build-identity.json` in this directory): main
  `9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046`, renderer
  `39b404c1214a203dd105501e833bcf32ab258610ed1351c2324e3c6188730d27`, list
  document `9c8bf7a57794c54e528aebad72f3b1eba8e226bc76c1eb889531b4a2b096e57e`
- Head under test: product head `87b2eb12b5` (the round-2 remediation commit
  on `feat/browser-chrome-s4b`). The R2 evidence commit on top of it changes
  only the probe and this directory; `build-identity.json` is byte-identical to
  the design-round-2 run, so the measured app is the same build.
- Re-captured for design round 2: `owner-rest.png` and `trigger-hover.png`
  (D11's neutral globe is visible for `127.0.0.1:<port>`), `tabs-fill.png` and
  `narrow.png` (D10's separator no longer touches the overflow chip)

## Rest-band run (R2)

The R2 assertion was measured in a fresh scratchpad,
`$LOCAL_OPERATOR_SCRATCHPAD/s4b-r2-restband-evidence`. `facts.json` and
`matrix.md` beside this file are that run's; its `owner-rest.png` (sha256
`54d8d65d925fed694637066019800199d99733c889cd2e6bbbb81b5b904210b8`) shows the
page flush under the strip.

- `stripHeight`: 37 (strip 1120×37 at x=260, y=32)
- `stripBottom`: 69, `pageTop`: 69 → **`restBandPx`: 0**
- `restBandIntruders`: `[]` — every element with a non-zero height whose own
  box is bounded by both edges was enumerated. The set is empty because the
  band itself is 0px: there is no between-space for an element to occupy. An
  element that merely crosses the seam (the pane's full-height resize handle,
  or a layout frame enclosing both edges) is bounded by neither edge and is
  not an occupant; the #1263 104px dock was bounded by both, so this predicate
  is the one that reproduces its failure if it returns.
- `dockPresentAtRest`: `false` —
  `document.querySelector("[data-address-dock-height]") === null`. The #1263
  104px dock is absent from the DOM tree, not hidden with `display:none` and
  not collapsed to zero height.

The hash table below remains the design-round-2 capture (its frames were
written to that run's scratchpad); the R2 run's rest-frame hash is recorded
above so the two runs cannot be confused.

## Frames and hashes

| Frame | SHA-256 |
| --- | --- |
| child-list.png | d4627a558a979d2cba28d0c38ac80f1584fcfd00fef54edf7810827232363c6c |
| child-rows.png | 5762b7e59368b7ad51d7730940dfbb5c2169a1725eaef37f7488e8b92df0b6a2 |
| list-no-match.png | 8fb8b2c6627e0721b63ab2ee97915315326c90477ddf20fc6d940cc74209c25b |
| list-rows.png | 4996f3a4b9645a042b38b527ab5aded8120fd98c94d2be28a4bf414b00854409 |
| load-failure.png | 9e74cf047ba8f6651e664164ce2467597c17dee5eaa968bbec805fee0901a56c |
| loading.png | e7ef4c7abf48eac92fd8f733be42a8ee3752ac4aff55fc86d5de0c58102b3f70 |
| menu-address-item.png | 77d8ad803d56da610fe209646fb6a2e8372f1a032153a007238e51a5d67ca094 |
| menu-popout.png | fef618efac8afdbc9339fc19f2281d78b51fa7d5dc7e068c68cab380aff97f3a |
| menu-rest.png | 68ee607dc8a142632d18222d1c85f802682428930afc6396a2029408dd6c910f |
| narrow.png | 23a6f90b3468f10f0eab868d16379523d091490bfbb7930d1f26918f0f5169c4 |
| owner-popout.png | 802aeefa3bb2c345dbccb13e4bd9c0080b124d75d522f5fa59852999840961c7 |
| owner-rest.png | 991cc24997e4a62316b81e5b48835cb4d2132c39b9d38faac8bc88fa673c5099 |
| tabs-fill.png | 1c0ae0c6f4ff58c865d64cd53fa9b0e2627a4d0a251c45a239016cf8c22b7d6e |
| theme-light-popout.png | 9178d79dabc01969a60fdc8e7ef6ade581a6b9af0170e982dc082cf9372ef6a1 |
| theme-light-rest.png | cf0d28e6ecac81c5fd6e5433eb678f2ec37467c250360f3ef8e5566c9a49797b |
| trigger-focus.png | abf58364f5ffa402f7df561f226af17f441c93a22d84a31e2f656cc2535721c9 |
| trigger-hover.png | 27711e7f165335eae4df0ed6ebb22c07c6ebd3fbe259ee41b520edd20216a727 |


## What the re-captured frames show

- **D11**: `owner-rest.png` and `trigger-hover.png` draw the neutral globe for
  `127.0.0.1:<port>` — the at-rest trigger's glyph is no longer the open padlock.
  The field's own register still classifies `http:` as not secure; only the
  at-rest glyph changed, which is the D4 contract.
- **D10**: in `narrow.png` (1×, 560 px pane) the overflow chip's right border sits
  at x≈444 and the cluster's leading hairline at x≈460, so the rule no longer
  crosses the chip; `tabs-fill.png` (2×) shows the same gap at 9 tabs / 3 off
  screen.
- Page geometry in the same run is in `matrix.md` (R1/P1/P2): strip 1120×37 at
  x=260, content 1120×831 at y=69, unchanged across rest/raised.

## Not claimed

Native composite pixels, native hit routing, VoiceOver/AX, macOS IME, Windows
and Linux remain BLOCKED (`BL1`); a live pending approval (`V9`) and the
zero-tab state (`V10`) are BLOCKED for the reasons in `matrix.md`.
