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

- Rig: `node scripts/browser-chrome-s4b-probe.mjs --out <scratchpad>/s4b-r3-fix`
- Scratchpad: `$LOCAL_OPERATOR_SCRATCHPAD/s4b-r3-fix/frames` (the agent
  session's scratch directory; pruned with it)
- Build identity (`build-identity.json` in this directory): main
  `9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046`, renderer
  `ba906a7e42fd8805f611c310be5219f1dfa39c9c55033e5e89f0872c88f9ee1f`, list
  document `9c8bf7a57794c54e528aebad72f3b1eba8e226bc76c1eb889531b4a2b096e57e`
- Head under test: `374fb90b27` plus the QA round-3 `ml-4` rule-gap fix in this
  commit; the built renderer identity above pins the bundle that was measured.
- Every frame below was re-captured by this run. `narrow.png` and
  `tabs-fill.png` are the D10/Q5 pair after the gap fix.

## Rest band (R2)

`owner-rest.png` (sha256
`1951372cae1f193113a3c9b4db28260619008147d015be0f596e0f10b241f593`) shows the
page flush under the strip; the same run measured:

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

## Frames and hashes

| Frame | SHA-256 |
| --- | --- |
| child-list.png | 4f5bc90f10ad544fa4ff35d7ed8ae23f7825f6460b0738f03d595ddfaaca73ab |
| child-rows.png | b27a4f0135c1bb1ea0896bcc89498344ba607da7df19f9de42657f00043b8273 |
| list-no-match.png | 9cfab775f27639062e32f083b1363fcaa62b579a74eb67a166dd33ff35b14e78 |
| list-rows.png | d04eacb71f55b690c6ef1a2ee7305018b19953dac1bec8b160061b816ecae3ac |
| load-failure.png | 3bd76b8b06a7630b9ffae6e708b37b78c6963bad6d36aa0fb282a82e04a1177e |
| loading.png | afc5c2b50376e9bc78495292c201f6a5377b658e193cf6a694180cccbed11c8e |
| menu-address-item.png | 6a18daa1ead7560c582c9ea74a39272b6745f7b1dc09d198941422fb79cc5349 |
| menu-popout.png | 52ffc8107b72a7f64219e07ebb80704299b77bf9f93fd48ac551f10350a38d15 |
| menu-rest.png | b3e851abc7e6b106aeb3cc9ad107058456ced4aff091bc8095190ff36d9908f7 |
| narrow.png | c04d33021e6d2f06273117791a8f335af931842b2ff809d463497714d50a12d6 |
| owner-popout.png | 6a18daa1ead7560c582c9ea74a39272b6745f7b1dc09d198941422fb79cc5349 |
| owner-rest.png | 1951372cae1f193113a3c9b4db28260619008147d015be0f596e0f10b241f593 |
| tabs-fill.png | ba4cc2913b562751203a6ab18ca828285c3623b511d89e29349e37932e6d8572 |
| theme-light-popout.png | a696d4b737655385418aaa665d52d57517a018515aeda7bf952d41a28873ccfc |
| theme-light-rest.png | 552606529918e42ba0536dabc6e4a07a90f01be1bb76096cccc94ed6f79666e7 |
| trigger-focus.png | da84140fc02bf1584bee7f0bdc36ef3d1585c75c22c1b286ecba1cd0730a7111 |
| trigger-hover.png | 1cc417c2015af19ebf6fc015a68155044faa3d5a2eaa17f66f9d1bc5c8570ef1 |


## What the re-captured frames show

- **D11**: `owner-rest.png` and `trigger-hover.png` draw the neutral globe for
  `127.0.0.1:<port>` — the at-rest trigger's glyph is no longer the open padlock.
  The field's own register still classifies `http:` as not secure; only the
  at-rest glyph changed, which is the D4 contract.
- **D10 / Q5**: the gap between the overflow count chip and the trailing rule is
  measured in `matrix.md` V15, not read off a frame. In `narrow.png` (1×, 560 px
  pane) the chip's right edge is x=438 and the rule's left edge x=447 — a 9 px
  gap; in `tabs-fill.png` (2×, 1380 px window, 9 tabs / 3 off screen) the same
  reading is 1258 vs 1267, also 9 px. The chip protrudes 7 px past its 28 px
  icon button (button right 431 / 1251), which is why the rule's `ml-4` (16 px)
  margin leaves 9 px rather than the 1 px `ml-2` left. The earlier note's "right
  border x≈444, hairline x≈460" was wrong: 444 was the chip's edge but 460 was
  the address trigger's button edge, not the rule — the measured rule sat 1 px
  from the chip. QA round 3 (Q5) is the round that caught it.
- Page geometry is in `matrix.md` (R1/P1/P2): strip 1120×37 at x=260, content
  1120×831 at y=69, unchanged across rest/raised; the rest band between them is
  0 px (R2).

## Not claimed

Native composite pixels, native hit routing, VoiceOver/AX, macOS IME, Windows
and Linux remain BLOCKED (`BL1`); a live pending approval (`V9`) and the
zero-tab state (`V10`) are BLOCKED for the reasons in `matrix.md`.
