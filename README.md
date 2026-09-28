# The settings rail's right edge, and its ground

Evidence for `fix/settings-rail-edge`. The frames are the app's own
`webContents.capturePage()`; the logs are `--scene route-tops`'s own records.

The operator's report (2026-09-27): *"On the settings panel the right border
doesn't go all the way up in the settings page, either make it extend all the way
up or remove the right border"* and *"It should also probably be a slightly
different background shade to differentiate from the main sidebar"*. #588's
design round had already recorded the first as a NIT (*"the rail/pane's 1px
hairline stops at the lane's lower edge - pre-existing, out of the lane's
'mirror of grounds' contract"*); this change is that NIT promoted to work.

## The rig

Built app, `headless`, macOS integrated window, `devicePixelRatio` 2, against an
isolated `local-operator serve` this lane started on `127.0.0.1:8123` (scratch
HOME and config root, bearer in a 0600 file, reaped by exact pid) — so no frame
touches the operator's own backend on 1111, and the renderer was built with
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8123` for the same reason.

```sh
node_modules/.bin/electron-vite build      # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8123
node scripts/renderer-driver.mjs --scene route-tops \
  --backend http://127.0.0.1:8123 --backend-records <config>/run/serve \
  --seed-onboarding-complete --theme <palette> --window-size <size> --out <frames> [--run-label "-after"]
```

`--scene route-tops` had no `--theme` block before this change; it now applies
the palette through the app's own preference and fails if the app is not in it
(the block every theme-parameterised scene carries), so the light set is the same
scene rather than a second rig.

`before-*` is the tree at `0f23c76de5` (this branch's base, before any source was
touched); `after-*` is the branch head. Both at all three sizes/palettes, and
both trees ran with the same driver — the branch's, whose checks for this change
(the rung hand-over, the rule, the lane's stop list) *fail on the before tree by
design*, which is what the failing logs show.

## Job 1 — the edge: removed, not extended

The hairline was the settings rail's wrapper (`settings-page.tsx`:
`border-r border-hairline`), and the same class on the two agents rosters
(`agents-page.tsx`, `agents-sidebar.tsx`). The rail stands inside the clipped
content column, so the rule could only ever begin at the lane's lower edge
(y 32) — extending it to y0 from in there is impossible without the lane
painting a second fence beside a tone step that already carries the boundary.
It is therefore removed on all three columns — the same removal #564 made to the
canvas dock's leading rule — and the ground step is the boundary now.

Measured on the dark 1380x900 frames (device pixels; the hairline role is
`rgb(64, 59, 44)`):

| edge | before | after |
| --- | --- | --- |
| settings rail, CSS x 479-479.5 | hairline pixels y64..y1799 (CSS y32 to the bottom) | none in device cols 956..961 |
| `/agents` roster, CSS x 515-515.5 | hairline pixels y64..y1799 | none in device cols 1029..1034 |
| `/agents/:id` roster, CSS x 539-539.5 | same shape (rule on `AgentsSidebar`'s root) | none |

The scene now reads `border-right-width` on both the derived column and the
element the shell was handed, and asserts both are `0px`; on the before tree it
reports `registered border-right-width 1px` for the rail and `column
border-right-width 1px` for each roster.

**Where the fix belongs: in the routes and the shell's hand-over, not in the
lane.** The lane (`chat-layout.tsx`) still paints no rules (its stop list is
asserted free of the hairline role on every route); what changed there is only
the rung it paints (`laneGroundOf`) and the marker's value. The routes own their
borders, so removing them is the routes' change; the shell's contract — grounds
meet y0, every route's first content row keeps its y — is asserted below and
unchanged.

## Job 2 — the ground: the rail moves to `elevated`

The two panels, before: the app sidebar is `surface`, the settings rail was
`surface` too (the same `bg-surface`), so the two read as one 480px slab; the
content beside them is `canvas`.

The rail (`settings-sidebar.tsx`'s `nav`) now stands on `elevated` — an
*existing* rung, one step toward the viewer — and the lane carries it to y0
through the hand-over marker, whose value now names the ground the shell must
paint across the column's width (`useLaneLeadingColumn("elevated")`). The rows
keep the plane they were authored against: `surface` is split onto each group's
list (the same split the canvas Files list made in #564), and
`chat-sidebar-selection.test.mjs`'s `ROW_STATE_GROUNDS` entry for the rail was
updated to say so — its guard that every row state is painted on `surface` still
passes across the tree. `contrast-contract.mjs`'s
29,293 assertions across the 59 themes (0 exceptions consulted), including every
row-state number, are unchanged and green.

The lane's resolved stop list, read off the running app (`laneStops` in the
logs):

| route | before | after |
| --- | --- | --- |
| `/settings` | `surface@480, canvas@480` | `surface@260, elevated@260, elevated@480, canvas@480` |
| `/settings?section=integrations` | `surface@480, canvas@480` | `surface@260, elevated@260, elevated@480, canvas@480` |
| `/agents` | `surface@516, canvas@516` | `surface@516, canvas@516` (roster already `surface`) |
| `/agents/local-operator` | `surface@540, canvas@540` | `surface@540, canvas@540` |

And on the frames (dark theme, CSS tones): the lane at y5 went
`#2a2721` (surface) across 0..960 → `#2a2721` 0..260, `#312d23` (elevated)
260..960; the rail at y150 went `#2a2722` → `#312d23` while the sidebar stayed
`#2a2722` and the content `#22201c`. In the light theme the rail's lane and body
read `#fefdfa` (`elevated`) against the sidebar's `#f7f5ee` (`surface`) and the
content's `#f2ede3` (`canvas`).

### The separation across all 59 palettes

ΔE00 between the rail (`elevated`) and each neighbour, computed over every
palette in `themes.generated.css` (the monochrome ladder is monotone across all
of them):

| pair | min | median | max |
| --- | --- | --- | --- |
| app sidebar (`surface`) vs rail (`elevated`) | **2.02** (arcade) | **2.58** | 6.62 (gruvboxLight) |
| content (`canvas`) vs rail (`elevated`) | 4.17 (catppuccinMacchiato) | 5.46 | 11.64 (radient) |
| sidebar (`surface`) vs content (`canvas`) — the app's existing ground boundary | 2.05 (sage) | 2.94 | 6.76 (radient) |

So the rail/sidebar step is perceptible on every palette (it clears the field
floor of 2.0 everywhere, and only just — `arcade` at 2.02), quiet (median 2.58,
comparable to the app's own sidebar/content step at 2.94), and never a hard
boundary; the rail/content step, which now carries the boundary the removed rule
used to draw, is *stronger* than that existing step on every palette. Brand
palettes: `localOperatorDark` 3.29 sidebar / 5.74 content, `localOperatorLight`
2.50 / 4.65.

## The control: nothing moved but the two things asked for

- **Content tops, before and after, every route:** the route's own first box,
  the app sidebar, the rail and the content are all at **y 32** (the lane's
  bottom edge) in every reading, and the scene asserts it per route in both
  trees. The fix moved a border and a tone; no y moved.
- **Untouched routes are byte-identical:** the before/after PNGs for `/chat`,
  `/schedules`, `/agent-hub`, `/browser` and `/projects` are the same bytes
  (e.g. chat `1df396171860aef22cfccff2d6639270`), so the lane's change cannot
  have altered a pixel anywhere it was not asked to.
- **The controls' band:** with no leading column the lane still stops exactly at
  the app sidebar's own edge (260px), asserted on those five routes.

## The scene's verdicts

| run | before | after |
| --- | --- | --- |
| 1380x900 dark | 8 FAIL / 67 PASS | **0 FAIL / 75 PASS** |
| 1380x900 light | 8 FAIL / 67 PASS | **0 FAIL / 75 PASS** |
| 800x600 dark | 8 FAIL / 49 PASS | **0 FAIL / 57 PASS** |

Every FAIL on the before tree is one of the four column routes
(`/settings`, `/settings?section=integrations`, `/agents`,
`/agents/local-operator`), twice each: *the shell is handed the rung the column
is painted in* (the before tree's marker is empty — the defect) and *neither the
column nor its hand-over draws a right rule* (1px, against 0px after).

## What the frames are, and what they are not

They are the built app's own captures of a state the driver held still for, at
three sizes and two palettes, before and after. They are not a claim about
Windows or Linux: this host renders the macOS integrated window, where the lane
is the band; the off-mac behaviour is `display: none` for the lane and reasoned
about in the source comments, not photographed here. The 800x600 runs are the
collapsed-dock state (56px strip + 48px settings rail), where the rail shows its
icon-only form.
