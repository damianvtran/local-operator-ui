# Row-state refinement — the frames

The images beside the direction at `docs/design/row-states-refinement.md`. Two
instruments produced them, and **they are not the same kind of evidence**: read
the `sheet-app-*` files as the app's own component, and the `simulation-*` files as
a swatch map that is not the app.

## What each file is

| File | What it is | Frames |
| --- | --- | --- |
| `sheet-app-before-after.png` | the **app's own render** — Storybook story `chat-sidebar-current-row--selected-row` at its committed 780×560, cropped to the row list's own bounding box, at 2x | 10 palettes × 4 tiles: before rest / before neighbour-hovered / after rest / after neighbour-hovered |
| `sheet-detail-dark.png` | the same four columns, `localOperatorDark` and `tokyoNightStorm`, at full 2x | 8 tiles |
| `simulation-59-before.webp` | a **SIMULATION**, not the app: `~/scratchpad/row_sheet.py` drawing each palette's shipped role values as a mock sidebar row on its own panel | all 59, before |
| `simulation-59-after.webp` | the same instrument over the proposed values | all 59, after |
| `simulation-12-before.webp` / `simulation-12-after.webp` | the same, for the ten palettes of the app sheet | 10 each |

The simulation is a map for deciding where to point a camera. It cannot show a
hover, a toolbar or the component's own geometry, and it is not evidence about the
product. The committed evidence for this surface is
`docs/evidence/chat-sidebar-current-row/` and the readback standard it holds to is
`docs/evidence/chat-sidebar-selection/README.md`.

## Which tree each half came from

- **BEFORE** — this branch's tree, which is `origin/main` at **`3922738d3`** with
  no change under `src/` or `scripts/`. Verified, not assumed:
  `git diff --stat origin/main...HEAD -- src/ scripts/` is empty for the files
  this direction is about.
- **AFTER** — *the same tree, the same story, the same cascade*, with the
  direction's **two halves** applied at the DOM:
  - the two **role values**, overridden by an injected
    `:root, [data-theme="<id>"] { --lo-row-hover: …; --lo-row-selected: … }`
    stylesheet — exactly the swap
    `src/renderer/src/styles/index.css:30-31` maps
    (`--color-row-hover: var(--lo-row-hover)`), so the component really is reading
    the proposed roles;
  - the **leading bar**, removed by
    `[class~="before:bg-accent"]::before { content: none }` — because the bar's
    removal is a **class** change and a variable override cannot make one. Hiding
    the pseudo-element by its class *token* is immune to React re-rendering
    `className` back, which a `classList` strip is not: measured, the strip was
    undone before the shutter and the bar was still painted at `x=0-3` of the row.

  It is a **proposal render, not a shipped build**: the difference from the
  post-implementation frame is where the two hexes come from and whether the five
  `before:*` utilities are in the class string — nothing else. Verified at the
  pixel rather than asserted: on the selected row of `localOperatorDark`, `x=0-5`
  at the row's mid-line reads `srgb(55,47,36)` (= `#372F24`, the proposed
  selection) where the before frame reads `srgb(56,201,106)` (= the accent) for
  `x=0-3` and `srgb(31,54,36)` beyond it.

## How the app frames were captured

`~/scratchpad/row-capture.mjs` (a scratch rig, read-only with respect to the
repository):

- a **built Storybook** served over a loopback static server
  (`npx storybook build -o <dir>`, 60s on this box), driven by a **private
  headless Chrome** over raw CDP — scratch `--user-data-dir` under `$TMPDIR`,
  `--use-mock-keychain`, `--no-first-run`, `--remote-debugging-port=0`,
  `--headless=new`. The Chrome invocation follows the repo's own rig,
  `scripts/capture-evidence.mjs:4395-4440`.
- **no focus was taken**: the run is headless, no tab was raised, and the process
  group was killed by exact pid when the run ended. No `screencapture`, no
  downloaded browser engine, no `https://localhost` throwaway.
- the theme is driven the way the house rig drives it — `args=theme:<id>` on the
  iframe URL plus a seeded `ui-preferences-storage` before the document's scripts
  run — and **every frame asserts `documentElement.dataset.theme` equals the
  palette it is named for** before the shutter.
- the hover is **a real pointer**: an `Input.dispatchMouseEvent` `mouseMoved` onto
  the row above the current one (`div:has(+ div > [data-chat-row][aria-current="page"]) > [data-chat-row]`,
  the selector `scripts/capture-evidence.mjs:1726` uses for the same state), left
  there while the frame is taken.
- the frames are `Page.captureScreenshot` with a clip over the rows' bounding box
  at a device scale factor of 2, so each tile is 526×944 device pixels of a
  263×472 CSS-pixel region.
- the page's own `getComputedStyle` readback per frame — the selected row's and the
  neighbour's `backgroundColor`, the `--lo-row-selected` / `--lo-row-hover`
  variables, and every row's rect and label — is in
  `~/scratchpad/sb-frames/{before,after}/readings.json`. It is a run artefact and
  is deliberately not committed: it is reproducible from the rig, and it would be
  30 files of JSON beside 8 images.

## What the frames do not show

- The crop is the **row list only**, so the panel's header and the search field
  are outside every tile. That matters for exactly one question — whether a
  selected row can be confused with the `sunken` search well — and it is stated as
  an unbacked claim in § 9.2 of the document rather than implied by these images.
- No light-theme tile pairs a hovered neighbour with a **strong-cast light panel**
  other than `kanagawaLotus`; `everforestLight` and `gruvboxLight` are in the
  59-palette simulation only.
- The trailing `· lopdev` binder is legible in every tile, but these are not
  contrast instruments: the ratios in the document are computed from the palette
  values, not sampled from these pixels.
