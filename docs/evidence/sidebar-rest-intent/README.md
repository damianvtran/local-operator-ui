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

# 2. a FRESH stub per launch, then ONE launch per palette, per half.
node docs/evidence/sidebar-rest-intent/harness/stub-daemon.mjs \
  --port 18234 --records <tmp>/records --stub-log <tmp>/stub.log > /dev/null 2>&1 &
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
run that read the same state: 57 passing checks per run, including the two this
change adds —

- `the acts are absent for a pointer passing through and present once it has
  dwelt` (or, with `--row-space-expect before`, the base tree's claim that they
  are in the layout at both moments);
- `the list's edge cues appear only where content is clipped: none while nothing
  is clipped, none at the top, both mid-list, none at the end`.

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

**THERE IS NO FRAME OF THE DOT IN THIS SET, AND THAT IS A GAP RATHER THAN A
CLAIM.** The `row-space` stub's rows are a responder with no status codes at all
(`harness/stub-daemon.mjs`), so no row in any frame here is running a subagent
and the mark is never drawn. Its rendered evidence belongs to the surfaces that
DO carry the marks - `docs/evidence/chat-sidebar-subagent-baseline/` and
`docs/evidence/chat-sidebar-status-feed/`, whose capture path is Storybook rather
than this scene - and re-capturing them is left to whoever owns those sets this
window. What this change puts behind the mark instead is the collision check, the
contrast row over all fifty-nine palettes, and
`scripts/chat-sidebar-hover-intent.test.mjs`'s pins; that is stated here so no
reader takes the absence of a frame for a verified look.

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

**And the pixels agree with the readings.** Differencing the two halves'
sidebar-region pixels (head minus base) reports a difference ONLY where a cue is
present, and none where the readings say there is none:

| frame | differing band (device px, of 1240) |
| --- | --- |
| `edges-none-280` | **none at all** — the control case |
| `edges-both-280` | `1065–1100` (the list's bottom edge, where the 24px bottom cue is) |
| `edges-bottom-280` | `670–681` (the list's top edge, where the top cue is 24px) |

The bands are narrow and their magnitude is content-dependent (the mask can only
fade what is not already uniform ground), which is why the LENGTHS above are the
instrument and the pixel delta is the confirmation.

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
