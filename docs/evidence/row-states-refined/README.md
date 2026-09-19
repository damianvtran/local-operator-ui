# The refined row states, before and after

The operator's ask this set is evidence for:

> "The hover colours in the themes and selection colors all look quite ugly and
> need to be refined with design. Generally I think hovers and selection
> highlights should be colored and more should be a brightening against the
> backdrop of whatever the item is on dark themes and darkening against the
> backdrop on light mode. When making it colored, you run this risk of looking
> really off-color and ugly. Also remove the left accent bars, they don't look
> really good in the chat sidebar, and restore the left rounding."

The direction is `docs/design/row-states-refinement.md`; the values run through
`scripts/contrast-contract.mjs`; and these are the **post-implementation** frames
the direction asked for, taken from three real trees rather than from a proposal
render.

## The three halves, and which tree each came from

| Half | Tree | How |
| --- | --- | --- |
| `before/` | `origin/main` at **`a17a6b3ba`**, checked out as a worktree at `/tmp/rs-before-tree` | `pnpm exec storybook build` on that tree, then the harness below against it |
| `defect/` | this branch's own **pre-remediation head** at **`f249a6604`** (the rebased `ffd05dec1`), worktree `/tmp/rs-defect-tree` | the same build, the same harness |
| `after/` | this branch at the remediation head | the same build, the same harness, the same stories, the same viewports |

Both `before/` and `after/` are the **real component through the real cascade**.
Nothing is injected at the DOM in either: the difference between them is the
`rowHover`/`rowSelected` values in the fifty-nine palettes, whether `rowCurrent`
carries its `before:*` bar group, and which ground the two rails wear.

**Why a third half exists.** The rail's defect is not visible in a
`origin/main`-vs-branch pair, because main's rails carry the *old* fills as well
as the old grounds: the 0.44 the review round measured is the **refined** fill on
the **old** ground, which is a state that existed only on this branch. `defect/`
is the previous head — the refined fills with `sidebar-navigation.tsx`'s `<nav>`
still `sunken` and the categories column still on `canvas` — and it is the half
that makes the pair a remediation pair rather than a restatement. It is 8 frames
(the two rails, three themes each; the categories rail, two themes); the chat
sidebar's own 26 frames do not change between `defect/` and `after/`, because
nothing in that surface moved in this round.

The harness **asserts** the ground on every `after` frame rather than asserting
it in prose: it walks up from the current row to the first ancestor that paints a
non-transparent background and requires that colour to equal
`var(--lo-surface)` (`SCENE.assertGround`), failing the frame otherwise. On the
`chat-sidebar` scene it instead asserts the page's `--lo-row-hover` /
`--lo-row-selected` against the values `scripts/palette-source.mjs` parses out of
the palette files. Neither the `before/` nor the `defect/` half is asked either
question — their values and grounds are the states being photographed.

## The frames

`<state>/<theme>.webp`. The first two arrangements are the row list's own bounding
box at a device scale factor of 2 (**526×944 device pixels**); the rail and
categories frames are those elements' own boxes, and the categories ones are the
rows' union plus 10px of the ground on every side (the column is `h-full` of a
~5900px page, so a frame of the column itself would be 99% empty ground).

| State | Surface | What is in the frame |
| --- | --- | --- |
| `rest/` | chat sidebar | the sidebar at rest: three plain rows, the current row, the `· lopdev` binder |
| `neighbour-hovered/` | chat sidebar | the same, with a **real pointer** left on the row above the current one — the four states the brief asks for (plain row, hovered neighbour, selected row, the selected row's text) in one frame |
| `rail-expanded/` | app rail | the shell's own rail, expanded, with the destination you are on |
| `rail-collapsed/` | app rail | the same rail at 48px, where the fill is the **entire** mark (there is no label in the row at all) |
| `categories-rail/` | agent-hub categories | the filter rail's rows over the ground they are painted on |

**Thirteen chat-sidebar palettes**: the eleven `docs/design/row-states-refinement.md`
§ 6 works through (the two brand ramps, the near-neutral class member, the two
worst hue rotations and the highest panel cast, the fill that was louder than its
own panel, the loudest light selection, the palette the light-family band floor
bites, a cast-less light panel and the palette the operator's original report
named), plus the two the remediation round added — **`rosePineDawn`** (the
fleet's minimum band, § 11.5) and **`ayuLight`** (the second of the three the
field floor used to refuse, and one of the two the round lifted).

**Four rail palettes**: `alucard` (the fleet's tightest chrome/content pair on the
app rail, and the 0.44), `localOperatorLight` (the 1.19, and the second-tightest),
`localOperatorDark` (the control — the change there is a step between two
near-black grounds and reads as almost nothing), and `kanagawaLotus` (0.83 on the
categories rail).

## The DOM readback, which is how these grounds are asserted

Every frame carries a `getComputedStyle` readback of the current row's own
background, the element that actually **paints the ground** under it (the nearest
ancestor with a non-transparent background), that element's colour, and the page's
`--lo-surface` / `--lo-sunken` / `--lo-canvas`. The numbers below are the run's
own output, and the ΔE00 column is computed from those live colours rather than
from the palette files.

| half | surface | theme | the row | the painted ground | ΔE00 |
| --- | --- | --- | --- | --- | --- |
| `defect` | app rail | `alucard` | `#ece7d4` | `nav` `#eae5d2` (its `sunken`) | **0.44** |
| `defect` | app rail | `localOperatorLight` | `#ebe7d8` | `nav` `#ece6d8` (its `sunken`) | **1.19** |
| `defect` | app rail | `localOperatorDark` | `#372f24` | `nav` `#1d1b19` (its `sunken`) | 8.61 |
| `after` | app rail | `alucard` | `#ece7d4` | `nav` `#f8f5ea` (`surface`) | 4.35 |
| `after` | app rail | `localOperatorLight` | `#ebe7d8` | `nav` `#f7f5ee` (`surface`) | 4.52 |
| `after` | app rail | `localOperatorDark` | `#372f24` | `nav` `#2b2721` (`surface`) | 4.16 |
| `defect` | categories rail | `kanagawaLotus` | `#dbd4a6` | `div` `#dfd7a8` (the page's `canvas`) | **0.83** |
| `defect` | categories rail | `localOperatorLight` | `#ebe7d8` | `div` `#f2ede3` (`canvas`) | 2.76 |
| `after` | categories rail | `kanagawaLotus` | `#dbd4a6` | `div` `#e9e2b6` (`surface`) | 3.29 |
| `after` | categories rail | `localOperatorLight` | `#ebe7d8` | `div` `#f7f5ee` (`surface`) | 4.52 |
| `before` | app rail | `alucard` | `#ece3fb` (the accent tint) | `nav` `#eae5d2` (its `sunken`) | 20.78 |

The two light rows are the defect exactly as the design round measured it: **the
row you are ON was quieter than the row you are merely POINTING AT**, which is the
sentence `sidebar-navigation.tsx`'s own comment records fixing once already. The
collapsed rail tells the same story without a label in the row: the tile is the
whole mark, and at 0.44 there is no tile.

### The rail's seam, read rather than assumed

The rail takes `border-r border-hairline` for the boundary its `sunken` step used
to carry, so the readback also reports the rail's own right border and the
neighbour's left one. Measured on the `after` half at all three themes: the rail
carries **1px** (`alucard` `rgb(216, 211, 194)`, `localOperatorLight`
`rgb(218, 213, 203)`, `localOperatorDark` `rgb(64, 59, 44)`) and the `main` beside
it carries **0px** — so the seam is one rule, not two, which is the case the
design round asked to have checked. The `defect` half reads 0px on both sides,
which is the same seam before the rule was drawn.

The rail's chrome/content pairs are the fleet's two tightest — `surface` against
the `canvas` beside it is ΔE00 **2.32** on `localOperatorLight` and **2.60** on
`alucard` — which is why the hairline is doing real work on those two and is the
reason the boundary was drawn rather than left to the tonal step.

### The key cap is fill-less

The rail's ⌘K cap is drawn with no fill and no border on either ground: the
component's own `CAP` constant carries no `bg-*` and no `border-*`
(`shared/components/common/keyboard-shortcut.tsx`), which is visible in
`after/rail-expanded/*.webp` beside the Search row. The rail's re-grounding
therefore cannot collapse a key into its own backdrop — which was the whole of the
argument the old comment made for it — and the fact is confirmed rather than
assumed here because the comment that argued from it has been rewritten.

## Which prediction each frame bears on

| § 11 | Prediction | The frames that bear on it |
| --- | --- | --- |
| 1 | `localOperatorDark`'s selected row is no longer greener than its panel | `before/neighbour-hovered/localOperatorDark` vs `after/neighbour-hovered/localOperatorDark`; the selection's paint is `rgb(31,54,36)` → `rgb(55,47,36)` |
| 2 | `tokyoNightStorm`'s hover stops being the loudest fill in the fleet | the same pair on `tokyoNightStorm` |
| 3 | `obsidian`'s pair can still be told apart with no colour | `after/neighbour-hovered/obsidian` — the closest pair in the set, legible but the least pronounced |
| 4 | `catppuccinMacchiato`'s rank is 0.94 `L*` | **not in this set** — its ledger row carries the reading. The design round captured it through this same harness; its frames belong to the round that argues the floor |
| 5 | the band off `surface` is smaller everywhere and it does not matter | every `rest/` pair. The three palettes that sat under the field floor are down to one (`rosePineDawn` 1.67); `dune` and `ayuLight` were lifted and their frames are here |
| 6 | the bar's removal restores the left rounding on five surfaces at once | every `after/` frame: all four corners of the current row are rounded where every `before/` frame is square on the left |
| 7 | `outrun`'s selection is the loudest in the after fleet (C\* 24.47) | `after/neighbour-hovered/outrun` — a deeper, more saturated plane in the panel's own family; the palette to look at if the ceiling needs re-arguing |
| 8 | nothing in the light fleet gets lighter | the light pairs (`localOperatorLight`, `kanagawaLotus`, `iceberg`, `rosePineDawn`, `ayuLight`): every after selection is *darker* than its panel |
| D1 | the two `rowCurrent` rails wear the row ground | `rail-expanded/`, `rail-collapsed/` and `categories-rail/`, all three halves, with the readback table above |

## The sweep, which has still not run on these frames

`pnpm check-evidence` admits **one sweep per machine**, and it has deferred at
**75** on every attempt this branch has made — this round's included, where the
holder is identified rather than assumed: a peer session's own sweep
(`scripts/check-evidence.mjs`, pid 46106, worktree
`~/local-operator-ui/.worktrees/wedged-status`) was in flight when the attempt was
made. **No frame in this set has been content-checked by the sweep.** The
manifest's `rowStatesRefinedPass.checkEvidence` records the same deferral with the
same holder, so it is stated in both places rather than left silent. What HAS run
against these frames is `scripts/evidence-manifest.test.mjs` (the stamps, the
citation ancestry and the `countsMean` arithmetic, all green) and
`scripts/chrome-keychain.test.mjs`, which scans this set's harness for the
mock-keychain call it requires.

## What produced these frames

```sh
# the AFTER half, from this tree
pnpm exec storybook build -o /tmp/rs-sb-after --quiet
node docs/evidence/row-states-refined/harness/row-states-capture.mjs \
  --serve /tmp/rs-sb-after --out docs/evidence/row-states-refined/after \
  --half after --scene chat-sidebar --states rest,neighbour-hovered \
  --themes=localOperatorDark,localOperatorLight,obsidian,synth,outrun,tokyoNightStorm,cyberpunk,kanagawaLotus,dune,iceberg,tokyoNight,rosePineDawn,ayuLight
node ... --scene rail-expanded  --states rail-expanded  --themes=alucard,localOperatorLight,localOperatorDark
node ... --scene rail-collapsed --states rail-collapsed --themes=alucard,localOperatorLight,localOperatorDark
node ... --scene categories-rail --states categories-rail --themes=localOperatorLight,kanagawaLotus

# the BEFORE half, from origin/main at a17a6b3ba
git worktree add --detach /tmp/rs-before-tree a17a6b3ba
cp -Rc <this worktree>/node_modules /tmp/rs-before-tree/node_modules   # APFS clone, not a second install
(cd /tmp/rs-before-tree && pnpm exec storybook build -o /tmp/rs-sb-before --quiet)
node ... --serve /tmp/rs-sb-before --out .../before --half before <the same four scene groups>

# the DEFECT half, from this branch's pre-remediation head
git worktree add --detach /tmp/rs-defect-tree f249a6604
cp -Rc <this worktree>/node_modules /tmp/rs-defect-tree/node_modules
(cd /tmp/rs-defect-tree && pnpm exec storybook build -o /tmp/rs-sb-defect --quiet)
node ... --serve /tmp/rs-sb-defect --out .../defect --half defect \
  --scene rail-expanded/rail-collapsed/categories-rail <the same themes>
```

**Why a harness beside the frames rather than `scripts/capture-evidence.mjs`.**
A before/after pair has to come from two trees, and the committed rig captures
from the tree it lives in, so the before half would have to be a worktree swap
between two sweeps of the same command — and the rig's own `dir` model nests a
surface under its story prefix, which would have put these frames inside
`chat-sidebar-current-row/` rather than in a set that names what it is about. The
harness reproduces what the committed rig does that matters, and each of those
points is stated in its header: the private headless Chrome through
`scripts/chrome-keychain.mjs` (`--use-mock-keychain` is what keeps a scratch
profile from raising a Keychain prompt on the operator's screen), the theme
driven by `args=theme:<id>` plus a seeded `ui-preferences-storage`, the
`dataset.theme` assertion before every shutter, a real `Input.dispatchMouseEvent`
pointer on the neighbour selector the rig uses for the same state
(`scripts/capture-evidence.mjs`'s `chat-sidebar-current-row--selected-row`
neighbour entry), the crop at device scale factor 2, and WebP at the
repository's own quality. `scripts/chrome-keychain.test.mjs` scans this
directory — `.mjs` files under `docs/evidence/<surface>/harness/` — and the call
it requires is here.

Nothing took the operator's focus: every run is `--headless=new`, no window is
raised, no `screencapture` is used, no browser engine was installed or scripted,
and the Chrome process is killed by exact pid when the run ends.

## What these frames do not show

- The `rest/` and `neighbour-hovered/` crops are the **row list only**, so the
  panel's header and the search field are outside them. The search field is NOT
  the `sunken` surface this bullet used to point at — the chat sidebar's field is
  `bg-surface` + `border-control` (`chat-sidebar.tsx`) — and the rung the
  withdrawal actually had to answer for is the **app rail's own `<nav>` and the
  categories rail's column**, both of which are re-grounded and carry frames and a
  readback above. What is still unframed is the `elevated` face of the exemption: a
  selected row can be the same colour as a dialog's ground or an input well, and no
  row is painted on one.
- **`kanagawaLotus` is the only strong-cast light panel with a hovered neighbour**
  in the chat-sidebar arrangements; `everforestLight` and `gruvboxLight` are in the
  direction's 59-palette simulation only, and `gruvboxLight` is one of the two wash
  shortfalls.
- **`catppuccinMacchiato`** — § 11.4 — is not in this set, so the pair that sits
  under the rank floor has no frame in any half.
- **No focus state, no `⋮` control hover, no nested or bound row.** Those
  arrangements are the sibling set's (`docs/evidence/chat-sidebar-current-row/`)
  and they take the same constant.
- The **agents sidebar and the agents page roster** are `rowCurrent` surfaces with
  no frame here: no story renders `AgentsSidebar`, and the roster row only wears
  the role for the agent that is open, which a backend-less run does not have.
  Their ground is asserted by `scripts/chat-sidebar-selection.test.mjs` instead.
- These are **not contrast instruments**: the ratios and ΔE00 values quoted in the
  direction and in `scripts/contrast-contract.mjs` are computed from the palette
  values, not sampled from these pixels. The one table above that IS computed from
  pixels-adjacent live values is the DOM readback, and it says so.
