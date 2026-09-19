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
the direction asked for, taken from two real trees rather than from a proposal
render.

## What each half is, and which tree it came from

| Half | Tree | How |
| --- | --- | --- |
| `before/` | `origin/main` at **`a7e08b082`**, checked out as a worktree at `/tmp/rs-before-tree` | `pnpm exec storybook build` on that tree, then the harness below against it |
| `after/` | this branch at **`fd1f7c899`** | the same `storybook build`, the same harness, the same story, the same viewport |

Both halves are the **real component through the real cascade**. Nothing is
injected at the DOM in either: the difference between the two halves is the
`rowHover`/`rowSelected` values in the fifty-nine palettes and whether
`rowCurrent` carries its `before:*` bar group.

The harness **asserts that** on every `after` frame rather than asserting it in
prose: it reads the page's own `--lo-row-hover` / `--lo-row-selected` and
compares them to the values `scripts/palette-source.mjs` parses out of the
palette files, failing the frame if they differ. The before half cannot be asked
that question (its values are the ones this change replaces), so its provenance
is the tree it was built from and its own readback below.

## The frames

`<state>/<theme>.webp`, 263×472 CSS pixels of the row list's own bounding box at
a device scale factor of 2 — **526×944 device pixels** per frame.

| State | What is in the frame |
| --- | --- |
| `rest/` | the sidebar at rest: three plain rows, the current row, the `· lopdev` binder |
| `neighbour-hovered/` | the same, with a **real pointer** left on the row above the current one — the four states the brief asks for (plain row, hovered neighbour, selected row, the selected row's text) in one frame |

Eleven palettes, chosen because they are the ones `docs/design/row-states-refinement.md`
§ 6 works through: the two brand ramps (`localOperatorDark`, `localOperatorLight`),
the near-neutral class member (`obsidian`), the two worst hue rotations and the
highest panel cast (`synth`, `outrun`, `cyberpunk`), the fill that was louder than
its own panel (`tokyoNightStorm`), the loudest light selection (`kanagawaLotus`),
the palette the light-family band floor bites (`dune`), a cast-less light panel
(`iceberg`) and the palette the operator's original report named (`tokyoNight`).

## Which prediction each frame bears on

| § 11 | Prediction | The frames that bear on it |
| --- | --- | --- |
| 1 | `localOperatorDark`'s selected row is no longer greener than its panel | `before/neighbour-hovered/localOperatorDark` vs `after/neighbour-hovered/localOperatorDark` — a green plane with a green bar becomes a brown lift; the selection's paint is `rgb(31,54,36)` → `rgb(55,47,36)` |
| 2 | `tokyoNightStorm`'s hover stops being the loudest fill in the fleet | the same pair on `tokyoNightStorm`: the hovered neighbour is a saturated blue slab (C* 22.4) and is a blue-grey lift (C* 9.8) after |
| 3 | `obsidian`'s pair can still be told apart with no colour | `after/neighbour-hovered/obsidian` — the closest pair in the set (rank 1.56 `L*` / 3.3 `C*`), legible but the least pronounced |
| 4 | `catppuccinMacchiato`'s rank is 0.94 `L*`, below the floor | **not in this set** — it is the one palette whose pair is ranked by cast, and its ledger row carries the reading. Its frames belong to the design round that argues the floor |
| 5 | the band off `surface` is smaller everywhere and it does not matter | every `rest/` pair: no frame in the set reads as an unmarked row, and the tightest bands are `dune` (1.91), `ayuLight` (1.95) and `rosePineDawn` (1.67) — the last two are not in this set and are the ones to look at first |
| 6 | the bar's removal restores the left rounding on five surfaces at once | every `after/` frame: all four corners of the current row are rounded where every `before/` frame is square on the left |
| 7 | `kanagawaLotus`'s selection is the loudest in the after fleet (C* 24.0) | `after/neighbour-hovered/kanagawaLotus` — a deeper, more saturated sand in the panel's own family; the palette to look at if the ceiling needs re-arguing |
| 8 | nothing in the light fleet gets lighter | the light pairs (`localOperatorLight`, `kanagawaLotus`, `iceberg`): every after selection is *darker* than its panel |

## The readback, per frame

The harness reads the page's own `getComputedStyle` before the shutter: the
selected row's and the neighbour's `backgroundColor`, and the two role variables.
The run's readings are reproducible from the harness (they are a run artefact and
are deliberately not committed, the practice the sibling set's README states) and
the four that matter most:

| Palette / state | before | after |
| --- | --- | --- |
| `localOperatorDark` selected, hovered neighbour | `rgb(31,54,36)` / `rgb(39,44,40)`, vars `#272c28`/`#1f3624` | `rgb(55,47,36)` / `rgb(48,45,41)`, vars `#302d29`/`#372f24` |
| `tokyoNightStorm` selected, hovered neighbour | `rgb(55,58,70)` / `rgb(37,52,85)`, vars `#253455`/`#373a46` | `rgb(50,57,88)` / `rgb(53,55,69)`, vars `#353745`/`#323958` |
| `obsidian` selected, hovered neighbour | `rgb(55,54,59)` / `rgb(53,53,53)`, vars `#353535`/`#37363b` | `rgb(52,52,61)` / `rgb(49,49,53)`, vars `#313135`/`#34343d` |
| `kanagawaLotus` selected, hovered neighbour | `rgb(203,211,233)` / `rgb(218,220,228)`, vars `#dadce4`/`#cbd3e9` | `rgb(219,212,166)` / `rgb(221,216,190)`, vars `#ddd8be`/`#dbd4a6` |

## What produced these frames

```sh
# the AFTER half, from this tree
pnpm exec storybook build -o /tmp/rs-sb-after --quiet
node docs/evidence/row-states-refined/harness/row-states-capture.mjs \
  --serve /tmp/rs-sb-after --out docs/evidence/row-states-refined/after \
  --half after --themes=localOperatorDark,localOperatorLight,obsidian,synth,outrun,tokyoNightStorm,cyberpunk,kanagawaLotus,dune,iceberg,tokyoNight

# the BEFORE half, from origin/main at a7e08b082
git worktree add --detach /tmp/rs-before-tree a7e08b082
cp -Rc <this worktree>/node_modules /tmp/rs-before-tree/node_modules   # APFS clone, not a second install
(cd /tmp/rs-before-tree && pnpm exec storybook build -o /tmp/rs-sb-before --quiet)
node docs/evidence/row-states-refined/harness/row-states-capture.mjs \
  --serve /tmp/rs-sb-before --out docs/evidence/row-states-refined/before \
  --half before --themes=<the same eleven>
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

- **The crop is the row list only.** The panel's header and the search field are
  outside every frame, which is the one place § 9.2's withdrawn collision floor
  could bite (a selected row against the `sunken` search well). § 7.3 of the
  direction states the same limit about its own sheet; it is still unbacked here.
- **No hover on a light palette with a strong cast other than `kanagawaLotus`**:
  `everforestLight` and `gruvboxLight` are in the direction's 59-palette
  simulation only, and `gruvboxLight` is one of the two wash shortfalls.
- **`catppuccinMacchiato`** — § 11.4 — is not in this set, so the pair that sits
  under the rank floor has no frame in either half.
- **No focus state, no `⋮` control hover, no nested or bound row.** Those
  arrangements are the sibling set's (`docs/evidence/chat-sidebar-current-row/`)
  and they take the same constant.
- These are **not contrast instruments**: the ratios and ΔE00 values quoted in
  the direction and in `scripts/contrast-contract.mjs` are computed from the
  palette values, not sampled from these pixels.
