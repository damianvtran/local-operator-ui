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
| `after/` | this branch at its **fix commit** `326383d10` — the commit whose `src`/`scripts` trees `docs/evidence/manifest.json`'s stamps carry, and the tree that ships (the commit after it moves `docs/` only) | the same build, the same harness, the same stories, the same viewports, **re-shot at that tree** |

Each half is a picture of ONE tree, and the manifest names the `after/` one in
its `capturedAtHead` because that is the field that pairs with the pass's own
tree stamps: `before/` is `origin/main` at `a17a6b3ba`, `defect/` is this branch's
pre-remediation head `f249a6604` (now the head of neither half's record), and
`after/` is the branch's fix commit `326383d10`, whose trees are the ones the
stamps carry and the ones that ship. The frames were taken from the working
tree that became that commit, before it existed, which is why the SHA is a name
for the tree and not a claim about capture order.

**The `after/` half was re-shot at the tree that ships, because it pictured one
that no longer does.** Its 34 frames were first taken at `76e880af7`, which
predates the two commits that gave the avatar plates their `border-control` edge
(`user-profile-sidebar.tsx`'s account plate and `agents-sidebar.tsx`'s avatar).
The six rail frames contain the account row, so they were a picture of a plate
WITHOUT its ring on a branch that ships one — the ring being the whole pixel of
the change they would otherwise be evidence for. All 34 were re-taken through the
same harness at that tree rather than only the six: a half is a picture
of ONE tree, and six frames of one tree beside 28 of another is the shape the
defect above produced. Measured against the retired capture: the six rail frames'
bytes changed and the other 28 are byte-identical, so the re-shoot moved exactly
what the ring moved and nothing else. What the six now carry is READ BACK rather
than eyeballed (below): a 1px `border-control` hairline on the plate, at that
palette's own variable. Neither `before/` nor `defect/` is a control for the ring
— both differ from `after/` in the rail's ground as well, so a frame from either
would show two changes at once — and the four palettes the ring is load-bearing
on (`arcade`, `gruvbox`, `obsidian`, `everforest`, where the plate's fill alone
vanishes under the pointer) are photographed by no half of this set; the design
round shot those itself and cites them on the pull request rather than committing
them here.

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

**Four rail palettes**, and they are ordered by the DEFECT's own quantity — the
ΔE00 between the current row's fill and the ground it is painted on, which is
what the `defect/` half exists to show: `alucard` (the **0.44**, the tightest of
the four by that measure; the fleet's own tightest `surface`|`canvas` pair is
`sage` 2.05, a different quantity, and this set does not render it),
`localOperatorLight` (the **1.19**, second-tightest of the four by the same
measure), `localOperatorDark` (the control — the change there is a step between
two near-black grounds and reads as almost nothing), and `kanagawaLotus` (0.83 on
the categories rail).

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

### The plate's edge, read from the same run

The six rail frames contain the account row, and the avatar plate inside it is the
pixel the closing rounds are about: the row paints `hover:bg-row-hover`, a row
state is a step of the panel it sits on, and the plate's fill is `elevated` — the
same role, byte-identical on `arcade`. Its carrier is therefore a 1px
`border-control` edge, and the run READS it rather than leaving it to the eye. The
harness resolves the plate by that edge's own class and fails unless exactly one
element in the rail matches it, then reports the element's box, border and fill:
all six frames (three themes, expanded and collapsed) report a **28x28** disc, a
**1px** border, and the border's colour equal to that palette's own
`--lo-border-control` while the fill resolves to its `elevated`:

| theme | plate box | border (`--lo-border-control`) | fill (`elevated`) |
| --- | --- | --- | --- |
| `alucard` | 28x28 | 1px `rgb(108, 102, 75)` = `#6c664b` | `rgb(254, 253, 248)` |
| `localOperatorLight` | 28x28 | 1px `rgb(133, 127, 112)` = `#857f70` | `rgb(254, 253, 250)` |
| `localOperatorDark` | 28x28 | 1px `rgb(131, 124, 109)` = `#837c6d` | `rgb(50, 45, 34)` |

That is what makes a re-shot frame a picture of the state under review rather than
of the tree before it, and it is the same discipline the ground assertion above
uses: a frame whose ring had not rendered, or had rendered in another palette's
colour, fails the run instead of being committed.

### The rail's seam, read rather than assumed

The rail takes `border-r border-hairline` for the boundary its `sunken` step used
to carry, so the readback also reports the rail's own right border and the
neighbour's left one. Measured on the `after` half at all three themes: the rail
carries **1px** (`alucard` `rgb(216, 211, 194)`, `localOperatorLight`
`rgb(218, 213, 203)`, `localOperatorDark` `rgb(64, 59, 44)`) and the `main` beside
it carries **0px** — so the seam is one rule, not two, which is the case the
design round asked to have checked. The `defect` half reads 0px on both sides,
which is the same seam before the rule was drawn.

The rail's chrome/content pairs — a **different quantity** from the four
palettes' row-vs-ground collisions above, and the reason the two order
`localOperatorLight` first and `alucard` second where the collisions do the
reverse: this one is the ΔE00 between the rail's `surface` and the `canvas`
beside it — are the two tightest of the four rail palettes this set renders:
**2.32** on `localOperatorLight` and **2.60** on `alucard` — which is why the
hairline is doing real work on those two and is the reason the boundary was drawn
rather than left to the tonal step. They are not the fleet's tightest pairs, and
an earlier revision of this sentence said they were: `surface` against `canvas`
measures
**2.05** on `sage`, 2.08 on `catppuccinMacchiato` and 2.10 on `oneLight`
(`localOperatorLight` is ninth, `alucard` twenty-third), and none of the three is
in this set. The design round's own `sage` frame is the check the sentence was
reaching for, and it passes; the fleet-wide discipline is
`scripts/contrast-contract.mjs`'s.

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
| D14 | an object inside a row state keeps its own edge | `after/rail-expanded/*` and `after/rail-collapsed/*`: the account plate's 1px `border-control` ring, on a 28x28 disc, read back in the section above and re-shot for it |

## The sweep, which has still not run on these frames

`pnpm check-evidence` admits **one sweep per machine**, and it has deferred at
**75** on every attempt this branch has made, **the closing round's included** —
the latest at 2026-09-19T06:22Z, with the holder identified rather than assumed
again: a peer session's own sweep of the toast-close-corner worktree
(`scripts/check-evidence.mjs`, pid **57942**, started 02:08 local, its image child
pid **8132**, running `magick … toast-close-corner/docs/evidence/canvas-workspace/spreadsheet/dune.webp`).
The holder the round before this one found was a different peer's sweep (pid
26555, a QA rig against PR #384, its image child 26565), and the one before that
(pid 46106, worktree `~/local-operator-ui/.worktrees/wedged-status`) is gone:
each attempt names the holder the lock file records, and no earlier holder is left
standing in place of the live one.
**No frame in this set has been content-checked by the sweep** — and the re-shot
frames do not change that half of the story: the sweep checks a frame's dominant
colour against the palette its filename names, which is not what a 1px ring is.
The ring is what the harness's own plate assertion reads (above), on the same run
that wrote the frames. The manifest's
`rowStatesRefinedPass.checkEvidence` records the same deferral with the same
holder, so it is stated in both places rather than left silent. What HAS run
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

**The `after/` half's four commands were run twice** — once at `76e880af7` and
again at the shipping head, each group's readback written to its own file with
`--readings` — and the second run is the one these frames come from. The plate
table above is the second run's own output, and the retired capture is what the
"six frames' bytes changed, 28 did not" measurement is against.

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
neighbour entry), the crop at device scale factor 2, WebP at the repository's own
quality, and — on the two rail scenes — **the plate's own edge, resolved by its
`border-control` class and asserted to be that palette's 1px `--lo-border-control`
on a 28x28 disc**, so the frames the plate's ring is evidence for cannot be
committed without it. `scripts/chrome-keychain.test.mjs` scans this
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
  row is painted on one. The OTHER face of that withdrawal — an object with a
  ground of its own INSIDE a row state — is no longer an accepted risk: it is
  answered with an edge (`docs/design/row-states-refinement.md` § 9.2), and the
  six rail frames both carry that edge and read it back above.
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
  Their ground is asserted by `scripts/chat-sidebar-selection.test.mjs` instead —
  **and so is the avatar plate inside the agents sidebar's row**, the second object
  the closing round gave a `border-control` edge: it has no frame in any half for
  the same reason, and its pair is asserted per palette in
  `scripts/contrast-contract.mjs` and by class (with the whole set of objects a row
  state can paint over) in `scripts/chat-sidebar-selection.test.mjs`.
- These are **not contrast instruments**: the ratios and ΔE00 values quoted in the
  direction and in `scripts/contrast-contract.mjs` are computed from the palette
  values, not sampled from these pixels. The one table above that IS computed from
  pixels-adjacent live values is the DOM readback, and it says so.
