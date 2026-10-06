# Sidebar: rest, intent, and the scrollbar's resting floor

Evidence for PR 1 of the sidebar workstream — issues **#840** (the row's acts wait
for pointer intent; the running-subagent mark stops reading as an action) and
**#845** (a resting floor for the thumb; the sidebar list's scroll-edge cues).

Two halves, one scene, the same bytes either way:

- **`after/`** — the tree this change ships (`ffe3f33dd3b` + the change).
- **`before/`** — `ffe3f33dd3b` itself, the fork point the branch was cut from.
  The scene is driven there by the same `scripts/renderer-driver.mjs` with
  `--row-space-expect before`, which is what lets one script photograph both
  states instead of two scripts describing them.

Both halves are the app photographing itself (`webContents.capturePage()`), in
the headless window mode, one launch per palette, driven by
`docs/agent-driver.md`'s dev-driver bridge. Nothing here is a browser
screenshot, and no window was raised.

## How these frames were taken

```
# 1. a build pointed at this set's stand-in backend (the repo's own .env
#    supplies the other keys). NO_BYTECODE because the bytecode step needs a
#    Babel plugin this tree's node_modules does not link.
set -a; . ~/local-operator-ui/.env; set +a
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build

# 2. a FRESH stub per launch, then ONE launch per palette, per half. THE STUB'S
#    REQUEST LOG IS ITS STDOUT - it knows no `--stub-log` flag - so the redirect IS
#    the file the driver below is told to read. Sending it to /dev/null starves
#    that file, and the scene's write-carrying checks then report "no pin written"
#    for presses that did write (agent review round 2's Q-2, UX's U2: the sibling
#    `sidebar-row-space` README has always had this wiring).
node docs/evidence/sidebar-rest-intent/harness/stub-daemon.mjs \
  --port 18234 --records <tmp>/records > <tmp>/stub.log 2>&1 &
node scripts/renderer-driver.mjs --scene row-space \
  --backend http://127.0.0.1:18234 --backend-records <tmp>/records \
  --seed-onboarding-complete --stub-log <tmp>/stub.log \
  --theme localOperatorDark --out <tmp>/after-dark --window-size 1380x900
# …then localOperatorLight, then the same two with --row-space-expect before,
# run from the base tree with this change's driver script copied in.

# 3. the frames land as <out>/<label>.png (the label IS the directory name
#    here), plus one geometry file per palette:
#    <out>/row-space-geometry-<theme>.json -> measurements/
```

**The scene asserts what it photographs**, so a run that lands these frames is a
run that read the same state: **60 passing checks per run (of 62) on the HEAD
half**, including the four the remediation rounds add —

- `the acts are absent for a pointer passing through and present once it has
  dwelt` (or, with `--row-space-expect before`, the base tree's claim that they
  are in the layout at both moments);
- `the list's edge cues appear only where content is clipped: none while nothing
  is clipped, none at the top, both mid-list, none at the end`.

  And the one the remediation round added, which is a different question from the
  two above - whether a press STRADDLING the reveal still reaches the row:

  - `a press inside the dwell, aimed at the band the acts will occupy, leaves the
  row's width alone and SELECTS the row` (agent review round 1's Q-1, UX's U1).
  The gesture is the reader's fastest one, at the point the acts will occupy, and
  the reading is taken with the button still held:

  | reading (dark, then light - identical) | head `bb5bec43e` | the same tree without the fix |
  | --- | --- | --- |
  | before the press | `buttonWidth 248`, `pairDrawn false`, route `#/chat/2d5ad5da0025` | same |
  | **at the press moment** | **`buttonWidth 248`**, **`pairDrawn false`**, `active true` | **`buttonWidth 192`**, **`pairDrawn true`**, `active true` |
  | after the mouseup | route `#/chat/b3f1a09c7d52`, `current b3f1a09c7d52` | route unchanged, `current 2d5ad5da0025` |

  The control column is the same scene, the same build tree, the fix reverted - and
  it reproduces the defect exactly: the mousedown focuses the button (`active
  true`), the bare `group-focus-within` raises the acts INSIDE the gesture
  (`pairDrawn true`), the button narrows by 56px — the pair's own 52px plus the
  row's 4px gap, so `248 -> 192` — the mouseup lands outside it, and the click is
  retargeted to the row's wrapper, so the press neither pressed a control nor
  selected the row.

And the half of that fix the press cannot show - that the door it was re-keyed to
still OPENS for a keyboard reader (agent review round 2's MINOR):

- `a keyboard walk onto an unpinned row draws its acts, on a `:focus-visible` the
browser agrees is the keyboard's`. The gesture is the panel's own arrow walk - a
real `ArrowDown` key event from the pinned row's button, which is how the app
moves the caret between rows - and the reading is
`{isRowButton true, focusVisible true, rowId 2d5ad5da0025, pairDisplay flex}` on
both palettes. A `Tab` would not do: this row is the list's first, so one Tab
leaves the list entirely, which is the property the walk above it documents. And
`button.focus()` would not do either: a scripted focus reads `:focus-visible:
false` in this repo, so it would answer a question about `:focus` while this door
asks how the focus ARRIVED.

**The before half runs the same 62 checks** with the clauses that describe this
change flipped to the base tree's own statements (`--row-space-expect before`),
including the press clause, which reads the press MOMENT rather than the parked
frame (agent review round 2's MINOR 1: the parked frame carries `pairDrawn false`
on every tree). Its frames and readings in this set are the committed ones; the
count quoted above is the head half's, which is the half this document ships.

### Two checks are red on BOTH halves, and they are not this change's

```
[FAIL] at rest the unpinned title starts at the leading slot …
[FAIL] with the pointer on the row both acts are painted and the title's clip is the spec's §3 AFTER number …
```

Measured identically on the base tree and on this one, in both palettes:

```
[{"width":240,"leadingSlot":42,"expectedSlot":24,…},{"width":280,…},{"width":320,…}]
```

`LEADING_SLOT_PX` is 24 and the row measures 42. The 18px is `chat-sidebar.tsx`'s
fixed `size-3.5` leading cell (14px) plus the row's own 4px gap, added by **#843**
(`feat(chat): remote sessions are first-class sidebar rows`, `ffe3f33dd3b` — the
fork point itself), whose own comment names the "ragged ~18 px leading edge". The
scene's expectation predates that commit; the geometry it feeds
(`docs/design/sidebar-row-space.md` § 3's title-width column) moves with it. It
is recorded here and in the PR rather than repaired in this change — it is
#843's evidence debt, and the before/after pair is what shows it is not ours.

## 1. The row's acts wait for pointer intent (#840)

| `after/pointer-pass-through-280` | `after/pointer-dwelled-280` |
| --- | --- |
| the pointer is on the row, the acts are NOT in the layout | the same row 320ms later: the archive and the pin are drawn |

The reading the two frames come from (`measurements/row-space-geometry-*.json`,
`pointer-pass-through-280` / `pointer-dwelled-280` for the row `7c1b0f2a4d31`):

| state | `data-session-hover-intent` | `pairWidth` | button | title |
| --- | --- | --- | --- | --- |
| pass-through | absent | `0` | 248 | 168.4 |
| dwelt | present | `52` | 192 | 146 |

And the base tree, the same two moments:

| `before/pointer-pass-through-280` | `before/pointer-dwelled-280` |
| --- | --- |
| the acts are ALREADY drawn on the first frame the pointer is on the row | identical - there is no dwell to cross |

The base half carries no `intent` reading at all (there is no attribute in that
tree), and its pass-through `pairWidth` is `52` — the defect the change removes,
recorded rather than described.

## 2. The running-subagent mark (#840)

The mark is a filled dot in the accent, drawn by `SubagentRunningMark` at both
call sites: the sidebar row's running mark and the `delegating` rung's primary
slot. `chat-sidebar.tsx`'s rows in these frames carry the queued `Hourglass` and
the dot; the glyph collision check (against `Circle`, `LoaderCircle`, `Check`,
`Clock`, `MessageSquare`, `Hourglass`, `Pause`, `EqualApproximately`) and the
sizing are in the component's own docstring, and the accent's 3:1 graphic floor
on the three grounds the mark can sit on is a row in
`scripts/contrast-contract.mjs` (`session row running-subagent mark`).

**THE DOT'S OWN FRAMES ARE IN THE SETS THAT CARRY THE MARK, AND THEY WERE
RE-TAKEN THIS ROUND (agent review round 1's M3, design's D1 / UX's O2).** The
`row-space` stub's rows are a responder with no status codes at all
(`harness/stub-daemon.mjs`), so no row in any frame HERE is running a subagent and
the mark is never drawn - that is a property of this scene and stays. The rendered
record lives in `docs/evidence/chat-sidebar-status-feed/`, whose capture path is
Storybook rather than this scene: its `subagent-rows-running/` and
`subagent-rows-running-minimum/` cells were re-captured at this head (24 frames,
twelve palettes each), so a reader tracing the component now lands on frames that
draw the dot rather than the removed glyph.

The BEFORE half of that pair, `docs/evidence/chat-sidebar-subagent-baseline/`, is
deliberately NOT re-taken, and the reason is its own provenance: the set is
defined as unmodified `origin/main`'s rendering, and main still draws `Share2` -
re-photographing it at this head would make the set describe a tree that is not
the one it names. The pair's own README records what that leaves: it no longer
differs by the indicator alone.

What this change puts behind the mark instead is the collision check, the
contrast row over all fifty-nine palettes, and
`scripts/chat-sidebar-hover-intent.test.mjs`'s pins - and the two cell families
above, which are a real look rather than a described one.

## 3. The thumb's resting floor (#845)

`global-scrollbar-styles.tsx`'s base rule now paints
`--lo-sb: SCROLLBAR_RESTING_FLOOR` (0.45) rather than 0, so an idle thumb is a
faint step rather than nothing. The derivation and the band it was chosen in are
beside the rule and in `docs/design/scrollbars-fade.md` § 10.1:

| α over `--color-control` | worst palette/ground | best |
| --- | --- | --- |
| 0.45 (chosen) | 1.55:1 (`rosePineDawn`/`sunken`) | 2.24:1 (`catppuccinMacchiato`/`sunken`) |

`rest-280` in each half is the same screen at rest after activity. Measured from
those two frames (the transcript's scrollbar band, the outermost 4 device px of
the 2760px-wide capture, against the pane ground 18 px to its left):

| half | palette | thumb band | ground | ratio |
| --- | --- | --- | --- | --- |
| `after` | localOperatorDark | `rgb(77, 72, 62)` | `rgb(34, 32, 28)` | **1.79:1** |
| `before` | localOperatorDark | `rgb(34, 32, 28)` | `rgb(34, 32, 28)` | **1.00:1** |
| `after` | localOperatorLight | `rgb(195, 190, 178)` | `rgb(242, 237, 227)` | **1.59:1** |
| `before` | localOperatorLight | `rgb(242, 237, 227)` | `rgb(242, 237, 227)` | **1.00:1** |

The base tree's thumb is not dark or light — it is exactly the ground, which is
what `--lo-sb: 0` means. The two measured ratios sit inside the band the value
was chosen in (1.55–2.24 across the fifty-nine palettes; the dark brand palette
1.73–1.86 predicted, 1.79 measured here).

## 4. The list's edge cues (#845)

`edges-none-280`, `edges-top-280`, `edges-both-280`, `edges-bottom-280` are the
sidebar list at the four states, with the two scroll-linked lengths read from the
same state (`measurements/*.json`'s `edges`):

| state | scrollTop / scrollHeight / clientHeight | `--lo-sidebar-top-fade` | `--lo-sidebar-bottom-fade` |
| --- | --- | --- | --- |
| `none` (at the launch size) | 0 / 515 / 515 | `0px` | `0px` |
| `top` | 0 / 428 / 235 | `0px` | `24px` |
| `middle` | 97 / 428 / 235 | `24px` | `24px` |
| `bottom` | 193 / 428 / 235 | `24px` | `0px` |

The base tree, the same four moments: the property does not exist, so every
reading is `""` — no cue at any scroll position, which is the defect.

**And the pixels agree with the readings, within the cue bands.** The claim this
table makes is deliberately narrower than "the two halves differ only where a cue
is present" (design round 1's D4 - that sentence was true of the cue bands and
false of the whole frame, which is what the numbers below show). Two instruments
over the same pair, the sidebar's regions of the two frames:

- **layout bands** — rows carrying 24 or more differing pixels at a threshold of
  8/255. This is the change the frame is evidence FOR: a cue, a thumb, a mask.
- **carried by bands** / **residue** — the complement split of the state's TOTAL
  differing pixels: what stands in rows inside a band, and every other differing
  pixel (glyph-edge antialiasing the two trees' separate renders leave behind,
  since the after and before halves are two different builds and text on the same
  ground lands on sub-pixel-different rasterisation). Counted, never claimed as
  zero. **The split is the table's own arithmetic, not a second measurement**
  (design round 2's D-r2-2: the round-1 table printed each state's TOTAL in a
  column headed "residue", which `edges-none`'s exact match hid).

| frame | layout bands (device px) | differing | carried by bands | residue |
| --- | --- | --- | --- | --- |
| `edges-none-280` | **none** — the control case | 22041 | 0 | 22041 |
| `edges-top-280` | `640-897` at `x528-543` and `x2744-2759` (the two scrollbars' **resting thumb**, § 3 — the one band here that is NOT a cue); `1065-1071` at `x42-127` (the **bottom cue** fading the list's last rows, the declared `bottomFade 24px`); `1105-1109` at `x486-505` (the pinned row's own pin glyph — `boxes.rest-280.rows[2].pin`, ink `rgb(241,238,230)` on the base — differing at the top of its own box) | 17587 | 8605 | 8982 |
| `edges-both-280` | `1065-1079` at `x69-367` + `x470-509` (the **bottom cue** fading content, peak 69); `1094-1100` (peak 9) | 18589 | 5435 | 13154 |
| `edges-bottom-280` | `670-684` at `x42-131` (the **top cue** fading content, peak 43) | 13659 | 811 | 12848 |

The bands are narrow and their magnitude is content-dependent (the mask can only
fade what is not already uniform ground), which is why the LENGTHS above are the
instrument and the pixel delta is the confirmation. The resting thumb is the one
band that is NOT a cue: it is present in every `after` frame and in no `before`
frame, because the floor is app-wide (§ 3).

**At `middle` the TOP cue paints nothing, and that is recorded rather than
smoothed over (design round 1's D2).** The state's own reading is `top 24px`,
and the declared length is right - but the list's first 24px at `scrollTop 97` is
a SECTION GAP, so the mask has nothing to fade there: differencing that state's
two halves finds no layout band at the list's top at all (the only one is the
bottom cue's, above). A reader whose clipped-off content is a section header
therefore sees no cue. It is a property of fade-only cues rather than a coding
error, and the alternative was refused deliberately: an opaque band or a painted
rule at the top edge would be CHROME - it would show even where no content is
clipped, which is the thing § 10.1's floor argument and the fade's own contract
(`docs/design/scrollbars-fade.md`) keep out of this surface. The limitation is
recorded in `docs/design/scrollbars-fade.md` § 10.2 with this measurement.

**The three clipped states needed a list taller than its pane**, and this
fixture's list is not (515 against a 515px pane at 1380x900). So the scene
shortens the VIEWPORT through `Emulation.setDeviceMetricsOverride` (1380x620,
cleared immediately after) for those three frames only — a reader's own gesture,
and the last thing the scene does before its checks. The frames are therefore
620px tall where the rest of the set is 900; the width is unchanged.

## The resting thumb, measured

The thumb's own numbers are in § 3 above (the band, the ground and the ratio,
read from `rest-280` in both halves with the app's own compositing).

## The sweep (issue #845's "all/anywhere" discipline)

Recorded in full in `docs/design/scrollbars-fade.md` § 10.3. In short: the
sidebar list is cued; the transcript already had it; the project surfaces solve
the same defect with an opaque sticky band (a different answer, not a missing
one); the palette/picker bodies already spend their `mask-image` on a
JS-conditional bottom fade, so replacing that mechanism is a separate change; the
two right-side panels have the same defect as the sidebar and the same
one-attribute fix, and are deferred with that reason because this set's rendered
evidence covers the sidebar.
