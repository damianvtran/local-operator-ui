# UX round 3 — PR #482 `feat(chat): answer /btw in a streaming aside panel`

Independent UX walk of head **`ba98e4fdc11edf7f593e8a874fe888c8d32e7fd9`**, scoped to the delta since
UX round 2 (`0bc4a97bb..ba98e4fdc`): the U11 refusal shape, U16's two-press confirm, and Q33's fix —
plus in-flow re-checks of U3/U7 (whose scrolling moved under them), U12, U13, U14, U15 and the adopt
end to end.

## What ran

| Pass | Width | Scene | Result |
| --- | --- | --- | --- |
| `ux3wide` | 1380×900 CSS, dpr 2 | `btw-ux3` — U11's two arms, the dropped exchange, a fresh refusal, U16 (two-press, placement, survival, keyboard-only), U12/U13/U14/U15, U3/U7, the adopt end to end | 47 PASS / 0 FAIL |
| `ux3narrow` | 800×900 CSS | `btw-ux3b` — the U11 arms with the clip measured (Q33 at the width round 4 lost 4 of 5 lines at), U16's confirm in 234 px, a quote that wraps at the region's edge (Q46) | 14 PASS / 0 FAIL |
| `ux3c` | 1380×900 | `btw-ux3c` — the ⌘+F hazard's own edges: a double-tap, a chord with the caret outside the box, an unfit chord | 11 PASS / 0 FAIL |
| `ux3d` | 1380×900 | `btw-ux3d` — R7-3 in the flow: a mermaid diagram that renders after the settle | 11 PASS / 0 FAIL |

Every step is a real `Input.dispatchKeyEvent`, `Input.insertText` or mouse event, and every reading
is the app's own DOM: `document.activeElement`, the panel's text and its two `role="alert"` surfaces
kept apart, the composer band's lines, the region's own scroll geometry, the live region's
announcement, and the probe's own transcript. The backend is the REAL daemon from `local-operator`
`origin/main` in its own worktree + uv venv; the model is the paced OpenAI-compatible stub, extended
this round with `SLOWANS` (1.0 s a chunk, inside the app's 20 s request timeout) and `MERMAIDANS`.

## Layout

- `frames/` — the stills named in the review comment (`ux3-ux3wide-*`, `ux3b-ux3narrow-*`,
  `ux3c-ux3c-*`, `ux3d-ux3d-*`).
- `logs/` — the driver logs for each pass, including the proxy's own counters (`asidePosts` with the
  `continues` field, `asideOps` with the close/adopt statuses) printed by the rig's `reap`.
- `rig/` — `capture-ux3.sh` (boot, ports, lock, reap), `patch-driver-ux3.sh` (builds the untracked
  driver copy), `run-ux3.sh`, `scene-ux3.js` (this round's scenes, appended to rounds 1–5's helpers),
  the stub and the proxy, unchanged from QA round 5 except the two markers above.

The app source was not modified: `shasum -a 256 src`-equivalents are in the logs' boot assertions, and
the driver is a COPY (`scripts/renderer-driver-ux3.mjs`, untracked).
