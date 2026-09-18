# The current row's ground, and the key caps

Two changes the operator reported, photographed on the surfaces they are visible
on, in all TWENTY-THREE themes this set covers: the twelve the band was authored on,
plus the forty-seven the theme port (PR #272) added, which are the palettes whose
`highlight` this branch re-authored to the same rule. Frames added in a pass are
named in the section for the state they belong to, and every frame's reading is in
the tables below rather than asserted in prose:

1. **"The highlight style needs to be more subtle — it's currently a very dark
   colour but it should be a slight darkening on light themes and a slight
   brightening on dark themes."** The row a reader is ON was painted `sunken`,
   which is the *recessed* role — a well, not a mark — and 3.75–14.94 ΔE00 from
   the panel it sits on. It was then moved to `highlight`, authored at ΔE00
   2.18–2.28 from `surface`.
2. **"The highlight on selected sidebar items (the currently viewed chat) is way
   too subtle, can you make it brighter/more contrasted? On dark mode it should be
   a bit lighter and on light mode it should be dark enough to contrast."** The
   operator has now SEEN (1) rendered, so the band it asked for is reversed:
   `highlight` lands at **ΔE00 4.01–4.15** from `surface` across the twelve
   palettes, and it is a **lightness** step — **3.81–6.62 `L*`** away from the
   panel in the direction the mode runs, chroma paying only the remainder. The
   current row's mark is that ground plus `font-medium`; an earlier round's 1px
   `outline-control` edge is RETIRED (design round 1, D3 — that role is
   `docs/branding.md` § 2's *sole boundary of a control*, and the ring rendered
   as the search field one line above the list).
3. **"The keycaps need to be consistent in size, and a bit more subtle; they
   shouldn't have a dark box around them."** A cap was a `bg-sunken` box, and it
   came in two geometries in one component, a third in the command palette, and
   a fourth spelling (plain monospace) on the app rail. One idiom now, with no
   fill and no border.

## What produced these frames

```sh
# the AFTER half: the branch's own tree
npx storybook dev -p 6017 --host 127.0.0.1 --no-open --disable-telemetry
# the sweep is narrowed per state because two states are shot on a theme SUBSET:
# the focused row on the ten the design named, the wash frame on the four the
# port's collision was measured on. `--themes` takes the 23 ids this set covers.
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row--selected-row --themes=<23 ids> --allow-backend http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row--settings-rail --themes=<23 ids> --allow-backend http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row--focused-row-current --themes=<the 10> --allow-backend http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row--wash-swatches --themes=oneLight,rosePineDawn,rosePine,tokyoNightDay --allow-backend http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=command-palette-commandpalette-- http://127.0.0.1:6017

# the BEFORE half: a worktree of unmodified origin/main at da9e75a6, with the same
# story file AND this branch's two new `STORIES` rows copied in, so the rig can
# reach the settings rail at all. `chat-sidebar-current-row-baseline/` is those
# frames; its own README carries the exact commands.
```

**Re-shot for round 2's remediation at `8412e9e8a`**, when the mark became a
lightness step (three palettes re-authored: tokyoNight, `localOperatorDark`,
`localOperatorLight`) and the current row's 1px `outline-control` edge was
retired. Every frame in both halves is from this round's passes. **Two states are
new to the set**: a row carrying a `· lopdev` BINDING inside a current row, and a
NESTED row under its agent — the two arrangements where the mark is drawn on an
ink and at an inset no other state here reaches, and neither of which any frame
covered when the round-1 streams looked (design D5, QA's N3 and N6).

`--allow-backend` was passed for these runs because a backend was answering on
the configured port while they were taken; none of the stories in this set talk
to one (the sidebar story stubs the desktop bridge, the rail story is a pure
component, the palette stories are fixtures), and the flag is what states that
rather than implying it.

`scripts/capture-evidence.mjs` drives a private headless Chrome over raw CDP;
nothing here is a hand-taken screenshot, and no frame in this set is the
operator's own data. The story surface is
`src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx`,
which carries the chat panel's four states and the hover twin of `selected-row`
(five of this set's seven frame directories) AND the settings rail's two.

The rail — the fourth place a cap is drawn — is a driver frame rather than a
story: `docs/evidence/renderer-driver/palette-rail-{dark,light}.png`, re-shot
with `node scripts/renderer-driver.mjs --scene palette`. Its before halves are
in `docs/evidence/renderer-driver-palette-baseline/`.

## The states, and what to look at

| State | After (this branch) | Before (`origin/main` @ da9e75a6) |
| --- | --- | --- |
| A conversation row is current | [`selected-row/`](selected-row/) — 12 themes | [`chat-sidebar-current-row-baseline/selected-row/`](../chat-sidebar-current-row-baseline/selected-row/) |
| The New chat row is current, with its chord | [`new-chat-row-current/`](new-chat-row-current/) — 12 themes | [`chat-sidebar-current-row-baseline/new-chat-row-current/`](../chat-sidebar-current-row-baseline/new-chat-row-current/) |
| A row BOUND to an agent is current (the `· lopdev` binding inside the mark) | [`bound-row-current/`](bound-row-current/) — 12 themes | [`chat-sidebar-current-row-baseline/bound-row-current/`](../chat-sidebar-current-row-baseline/bound-row-current/) |
| A NESTED row under its agent is current | [`nested-row-current/`](nested-row-current/) — 12 themes | [`chat-sidebar-current-row-baseline/nested-row-current/`](../chat-sidebar-current-row-baseline/nested-row-current/) |
| A NEIGHBOUR row under the pointer while a conversation is current | [`selected-row-neighbour-hovered/`](selected-row-neighbour-hovered/) — 12 themes | [`chat-sidebar-current-row-baseline/selected-row-neighbour-hovered/`](../chat-sidebar-current-row-baseline/selected-row-neighbour-hovered/) |
| The **settings rail's** current section (`1280x760`) | [`settings-rail/`](settings-rail/) — 12 themes | [`chat-sidebar-current-row-baseline/settings-rail/`](../chat-sidebar-current-row-baseline/settings-rail/) |
| …with the row ABOVE it under the pointer | [`settings-rail-neighbour-hovered/`](settings-rail-neighbour-hovered/) — 12 themes | [`chat-sidebar-current-row-baseline/settings-rail-neighbour-hovered/`](../chat-sidebar-current-row-baseline/settings-rail-neighbour-hovered/) |

The two BINDING states are reached by fixture, and the fixture's shape is the
claim: the roster's third row carries `binding: { agent: "lopdev", team: null }`,
so the row's trailing statement is the binding rather than a search match — which
is the `ink-muted` ink the floors on `highlight` are measured for, drawn inside
the mark. In the nested state that row is also INACTIVE, so the flat Active chats
partition does not draw it and the frame holds exactly one marked row; the agent's
own disclosure is clicked open in the story's `play`, because it starts collapsed
and a query would be a different surface.

The two pointer pairs are the states no still at rest can hold — a pointer is
browser state — so the rig dispatches a real `Input.dispatchMouseEvent` at the row
immediately BEFORE the current one and shuts the shutter with the pointer still
there. In the chat panel that is `data-chat-row:has(+ [data-chat-row][aria-current="page"])`
("Migrate the deploy script", because the story's roster is newest-first and its
third row is current); on the rail it is
`li:has(+ li > button[aria-current="page"]) > button`, because the rail's rows are
`li`s wrapping their own button. They exist for the comparison WITHIN the frame —
the current row's `highlight` and its weight beside the pointer's `elevated` —
which is the pair the operator's report is about.

The rail's frames are at **1280x760** rather than the chat panel's 780x560:
`SettingsSidebar` switches between its labelled and its 48px icon-only layouts at
`(min-width: 1040px)`, and the labelled one is the surface whose current row has to
carry text on the ground. Read `localOperatorDark` and `localOperatorLight` first
(the two brand palettes), then `tokyoNight` (the theme in the operator's own
screenshot) and `iceberg` (the tightest step against `sunken`).

## The numbers, measured in the rendered page rather than argued

Read out of the live DOM over CDP, in `localOperatorDark`, on this set's own two
stories (the same instrument the frames come from):

| | before | after |
| --- | --- | --- |
| The `⌘` cap beside New chat | 20 × **14** px, fill `sunken` `rgb(15,12,8)`, icon 10px | 20 × **20** px, fill `rgba(0,0,0,0)`, icon 12px |
| The `N` cap beside it | 20 × **21.39** px, fill `sunken`, plus a 1px `outline-control` while the row is current | 20 × **20** px, no fill, no edge |
| The chord's own ink gaps | **10** and **11** px between the ink of `⌘`, `+` and `N` at `gap-1` | **6** and **7** px at `gap-0` |
| A palette legend GLYPH cap (`>` `#` `@` `,`) | **15.2** × 21.39 px, fill `sunken`, ink `ink-dim` | 20 × 20 px floor, no fill, ink `ink-dim` |
| The palette's WORD cap (`esc`, the same legend bar) | **29** × 21.39 px (29.61 × 20 after), fill `sunken` | **29.61** × 20 px, no fill |
| The current row's ground | `rgb(15,12,8)` = `sunken` | `rgb(37,33,27)` = `highlight` `#25211b` |
| The current row's weight | **500** (`font-medium`) — inherited from #255, so it is in BOTH halves | **500**, unchanged: this pair isolates the GROUND change, not the weight, and the title's ink ends at the same x in both halves |
| The panel behind it | `rgb(30,26,20)` = `surface` | unchanged |

So the claims are each a pair of numbers. **One bar carried caps 14px and 21.39px
tall under the same 20px minimum width**, and the palette's third spelling was
15.2px wide where the sidebar's was 20 — the 15.2 is a SINGLE-GLYPH cap (7.2px of
glyph plus 8px of padding), and the `esc` cap in that same bar measured **29px**
both before and after, which is the `min-w-5` floor being grown out of rather than
a second size class. (An earlier revision of this table attributed the 15.2 to
`esc`; the box coordinates say otherwise — `>` at x337-351 and `#` at x500-514 in
the before frame, `esc` at x863-891 — so the row above now names both shapes.)
After the change every cap is 20 × 20 with the same ink and no ground at all, and a
word grows out of that floor rather than changing size class.

**The mark is the ground plus the WEIGHT, and the ordering is now ASSERTED — the windows
where it cannot hold are the ones recorded.** *(THIS PARAGRAPH RECORDS THE RETIRED
ORDERING RULE: it was written when the current row was `highlight` and the rows around it
hovered on the `elevated` GROUND. Both roles are gone — the row states are `rowHover` and
`rowSelected` and the ordering is asserted in the row-state loop, not by the two
`HIGHLIGHT_HOVER_ORDER_*` tables this paragraph used to name. The shipped rule, its
measurements and this set's re-shot frames are in "The colour-application pass" at the
end of this file; what follows is kept because the seven windows it records are the
reason the roles were replaced.)* The ink floors cap how far the ground can
climb — `ink-dim` is drawn inside a current row (the caps and the `· lopdev` binding) —
and the hover step the rows around it carry is `elevated`, which is also every menu,
popover and tooltip ground in the app. What this change does with those two levers is
bring that rung DOWN to its floor off `surface` (ΔE00 2.0, now asserted as
`ELEVATED_PANEL_DELTA_E`) across the dark family, and raise two palettes' rows
(`nightfox`, `tokyoNight`) to their own ink caps to meet it, rather than leaving the
ordering to prose. The ordering itself was asserted at a **0.5 `L*`** step — the current
row lighter than the hovered neighbour on a dark palette,
darker on a light one — and the twelve dark palettes the two levers starve were
recorded palette by palette, each with the margin
it actually measures: eleven whose window between the ink cap and that floor is
narrower than the step, or closed outright, and one — `neonNoir` — whose window is wide
enough but whose pair the ΔE00 floors (the 2.0 field floor and the 4.0 band) refused at
the row that would clear the step. Measured over all **59** themes by the narrower ΔE00
metric — which of the two grounds is the **LARGER** step off `surface` — `elevated` is
still the larger on **3 of
them** (`gruvboxLight`, `neon`, `radient`; this paragraph said 11 when it was written,
and the count was 10 at this branch's pre-pass head), so the mark leads the pointer on
the other **56 of 59** — and it leads on none of those three. Five of the twelve recorded
windows measure a negative order and were recorded as negative; three of those five carry
a committed frame in this set that rendered the inversion — `catppuccinMacchiato`
(−1.06 `L*` in the frame, −0.85 in the palette), `palenight` (−0.80) and `nord` (−0.19) —
shot before round 2's list markup, so their PAIR is that head's and their panel ground is
not — and THE THREE NAMES ARE HISTORY: `nord`'s order is correct on the current frames and
`palenight`'s is not, so the list that the next pass should read is the one in the
colour-application section below, re-derived from the palette values. What would have fixed
those five is a hover ground of its own rather than the rung above
the mark, which is the role decision the two row states ARE; the windows above are why
they exist. The
`4.63 > 4.48` this set quoted in round 1 was a q88 reading of the frame set against a
`magick`-sampled value, so the two numbers were never the same measurement — the lossless
pair is `4.58 > 4.09` on `tokyoNight`. The
second step is `font-medium`, which `settings-sidebar.tsx` already carried and which
the app rail's active item carries — and it is the ONLY second step: round 2's
remediation retired the 1px `outline-control` edge this set was first shot with,
because that role is `docs/branding.md` § 2's *sole boundary of an input, select,
checkbox or outlined button* and both rails drew it with the search field's own ink,
height and radius, so the current row read as a filled field (design round 1, D3).
Its side effects were measured rather than assumed: the title's natural width grows
**2.25-2.33%** at weight 500 ("Quarterly revenue model" 149.36 → 152.84px, the
measurement is theme-independent because it is font metrics), every row in the frame
keeps **54.9px** of headroom at the heavier weight, and the row's box (263 × 32), its
line-height and its alignment are unchanged — nothing reflows and no title
truncates a character earlier. In the hovered pairs you can see both at once: the
neighbour carries `elevated` and weight 400, the current row carries `highlight` and
weight 500.

## The wash pair, and the six pins that make this change deviate

**The wash readings (design round 4, D3).** The committed `wash-swatches/` files are WebP at
`quality: 88` like every other frame here, and the pair this frame shows is a LOW-contrast
one — which is exactly where the encoder's quantisation costs the most, so the committed
reading is not the palette's:

| palette | contract (`highlight` vs `accentWash`) | committed q88 | \|q88 − contract\| |
| --- | --- | --- | --- |
| oneLight | 2.92 | **1.92** | 1.00 |
| rosePine | 2.75 | 2.01 | 0.74 |
| tokyoNightDay | 2.13 | 2.12 | 0.01 |
| rosePineDawn | **0.93** (the pin) | 0.42 | 0.51 |

Read the band off the contract and the swatch off the frame, as the section below says for
every other reading in this set: `oneLight`'s committed file reads **below the 2.0 floor the
palette itself clears** (2.92) for the encoder's reason, not the palette's. Three of the four
were re-authored to clear the floor when the theme port landed; **`rosePineDawn` could not
clear it and is the one pin** — its ink caps the route, and 0.93 is the band-point optimum,
pinned at that measured separation with a **1.75 ceiling** on the field (`ceiling: 1.75,` in
`scripts/contrast-contract.mjs`, which re-derives the number rather than trusting it).

**The six pinned palettes.** A pin is a palette the contract holds at a NAMED value instead
of asserting a floor, and each one is pinned because its own ink — the ink drawn ON the
current row — caps the ground's route before the band or the field floor is reached:

| palette | what binds | the ink number that caps it |
| --- | --- | --- |
| catppuccinFrappe | the `L*` route stops short of the band | `inkDim` 4.68:1 on the ground |
| catppuccinMacchiato | same wall, one step lower | `inkDim` 4.78:1 |
| nord | same wall | `inkDim` 4.83:1 |
| palenight | same wall | `inkDim` 4.71:1 |
| solarizedDark | same wall | `inkDim` 4.78:1 |
| rosePineDawn | the field floor (wash pair) — 0.93, ceiling 1.75 | `inkDim` 4.75:1 |

Every other one of the 59 variants clears the 4.0 band on the `L*` axis, with chroma paying
only the remainder.

## Two rows that still share a mark, recorded rather than rediscovered (QA's Q5)

With `All chats` pressed, the filter row and the current conversation row wear the same
GROUND and the same WEIGHT, differing in the role they carry (`aria-pressed="true"` on one,
`aria-current="page"` on the other). That collision is pre-existing and this branch does not
change it — it is recorded here so the next reader does not meet it as a defect of this
change. The retired 1px ring had amplified it, which is how it was found.

## The numbers, read back out of the frames — and what the encoder costs

`pnpm check-themes` measures the PALETTE: it proves `highlight` is ΔE00 4.01–4.15
from `surface` on each of the twelve, that it steps 3.81–6.62 `L*` in the direction
the mode runs, and that every ink clears its floor on it. It cannot prove the row is
painted with that role, or that the browser composited what the class string asked
for. So the frames are read back, one column at a time, through
`harness/read-current-row.mjs`:

```sh
# The committed frames are WebP, so the decoder runs FIRST: `sips` on macOS,
# `dwebp` anywhere else. This is the two-step the harness's own docstring states,
# and it is why no `.png` ships in this set — the lossless captures the table's
# middle column is read from are taken, measured and thrown away.
sips -s format png docs/evidence/chat-sidebar-current-row/selected-row/tokyoNight.webp --out /tmp/tokyoNight.png
node docs/evidence/chat-sidebar-current-row/harness/read-current-row.mjs /tmp/tokyoNight.png 180 265 380 560
# {"frame":"/tmp/tokyoNight.png","size":"780x560","span":"x=180-265, y=380-560",
#  "panel":"#24283b","row":"#313343","runs":[32],
#  "extent":{"top":488,"bottom":519,"height":32},"deltaE00":3.9}
```

The reading above is the **committed q88 file's**: `row` `#313343`, ΔE00 **3.9**,
against the table's lossless `#313342` / **4.09** for the same palette — the same
pair the table's own columns separate, and the reason the two numbers differ is the
encoder rather than the harness. Point the harness at anything that is not a PNG
(a committed frame, say) and it names the file and formats, prints the decode step
and exits 2; a path that does not exist is named the same way, so a re-shoot gets a
one-line answer instead of a `zlib` stack trace.

The harness samples the row's ground as the MODE of a horizontal span (one pixel in
a row of text is a glyph's antialiased edge) and reports the longest run in the
window that differs from the panel's own ground.

**A conversation row is current (`selected-row/`), measured pixels — and TWO
readings, because the committed frames are lossy.** Every file beside this README is
WebP at `quality: 88` (`scripts/capture-evidence.mjs:3808`), which is this
repository's evidence format and is NOT what the browser painted: the encoder's
quantisation moves a ground by one or two 8-bit levels, and against a 4–5 ΔE00 total
that is a visible fraction of it. So each row carries the **lossless** reading (the
same story, same rig, same viewport, captured as PNG for the measurement and not
committed) beside the **committed** q88 file:

| palette | mode | before (base, q88) | contract | lossless capture | committed q88 | \|q88 − contract\| | `L*` step off the panel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tokyoNight | dark | `#2b2f42`, 2.23 | 4.09 | `#313342`, **4.09** | `#313343`, 3.90 | 0.19 | **+5.09** |
| localOperatorDark | dark | `#25211c`, 2.20 | 4.15 | `#292116`, **4.15** | `#282116`, 4.23 | 0.08 | **+3.81** |
| localOperatorLight | light | `#eeede6`, 2.47 | 4.02 | `#ecebde`, **4.02** | `#ececde`, 4.75 | 0.73 | **−4.75** |
| dracula | dark | `#37384e`, 2.26 | 4.11 | `#3a3c56`, **4.11** | `#3a3d57`, 4.15 | 0.04 | +5.17 |
| dune | dark | `#211d1a`, 2.20 | 4.08 | `#272421`, **4.08** | `#272320`, 4.08 | 0.00 | +6.44 |
| iceberg | light | `#e7e9eb`, 2.36 | 4.12 | `#e5e7f1`, **4.12** | `#e6e7f2`, 5.67 | 1.55 | −4.09 |
| monokai | dark | `#34362e`, 2.24 | 4.07 | `#37392d`, **4.07** | `#37392d`, 3.70 | 0.37 | +4.35 |
| neon | dark | `#171c2a`, 2.24 | 4.04 | `#1c2231`, **4.04** | `#1b2230`, 4.05 | 0.01 | +6.39 |
| obsidian | dark | `#1f1f21`, 2.20 | 4.01 | `#232329`, **4.01** | `#24232a`, 5.04 | 1.03 | +5.58 |
| radient | dark | `#222637`, 2.21 | 4.11 | `#272c3d`, **4.11** | `#272c3c`, 4.22 | 0.11 | +6.24 |
| sage | light | `#f0ede2`, 2.34 | 4.02 | `#e8e4da`, **4.02** | `#e7e5da`, 4.15 | 0.13 | −6.62 |
| synth | dark | `#231235`, 2.19 | 4.14 | `#281641`, **4.14** | `#291641`, 3.98 | 0.16 | +6.08 |

### The eleven themes the port added (frames taken in this pass)

Same story, same rig, same column; the `committed q88` column is read off the frames in
this directory with `harness/read-current-row.mjs`, and the `contract` column is the
palette's own `highlight`/`surface` distance from `pnpm check-themes`. The lossless
equivalence the twelve above were measured for (a lossless capture reads the palette
exactly) is unchanged by the encoder framing, so the contract column is the palette's
value rather than a second capture: what these rows add is the q88 drift on palettes no
earlier pass read.

| palette | mode | contract | committed q88 | \|q88 − contract\| | `L*` step off the panel |
| --- | --- | --- | --- | --- | --- |
| catppuccinFrappe | dark | 4.34 | `#413f57`, 5.16 | 0.82 | **+2.52** |
| catppuccinMacchiato | dark | 4.00 | `#322f4b`, 3.94 | 0.06 | **+1.74** |
| cyberpunk | dark | 4.14 | `#1d171e`, 4.07 | 0.07 | **+3.11** |
| nord | dark | 4.35 | `#30404f`, 3.88 | 0.47 | **+1.53** |
| oneLight | light | 4.03 | `#e5ebf0`, 3.97 | 0.06 | **−3.18** |
| palenight | dark | 4.87 | `#393750`, 3.77 | 1.10 | **+2.22** |
| rosePine | dark | 5.97 | `#302232`, 6.07 | 0.10 | **+3.29** |
| rosePineDawn | light | 4.09 | `#fdeeea`, 4.41 | 0.32 | **−2.11** |
| solarizedDark | dark | 4.04 | `#023a42`, 4.04 | 0.00 | **+2.65** |
| synthwave | dark | 4.02 | `#39304c`, 3.41 | 0.61 | **+3.27** |
| tokyoNightDay | light | 4.12 | `#dce3ec`, 4.45 | 0.33 | **−3.07** |

Every one of the eleven steps in the direction its mode runs (`L*` up on a dark theme,
down on a light one), which is the half of the operator's sentence ΔE00 cannot state; and
the six whose q88 reading lands under 4.0 (`catppuccinMacchiato` 3.94, `nord` 3.88,
`oneLight` 3.97, `palenight` 3.77, `synthwave` 3.41, and on the twelve above `monokai` and
`synth`) are the encoder's version of the paint rather than the authored value — the
contract column is what the band is held to, and the section below says why the two
differ.

The `L*` column is a PALETTE number and is here because ΔE00 cannot state it: the
band can be reached while the row lands DARKER than the panel it is supposed to be
brighter than, which is what the first version of this change did on the three
palettes the operator's report is measured on (`tokyoNight` 2.61 → **5.09**,
`localOperatorDark` 2.82 → **3.81**, `localOperatorLight` −2.52 → **−4.75**; those
are the three values re-authored in round 2's remediation). The contract now asserts
the direction and a 3 `L*` floor, and `scripts/contrast-contract.mjs`'s `highlight`
block carries the derivation.

**The lossless reading equals the palette's own value to two decimal places on all
twelve**, and the row's hex is the palette's `highlight` exactly — which is the
claim the frames exist to support: the row really is painted with that role.
**The committed q88 file does not, and the table above is what it actually does**:
0.00–0.19 on eight palettes, and higher on four — `monokai` 0.37 and `obsidian`
1.03, both DARK palettes, then `localOperatorLight` 0.73 and `iceberg` 1.55 on the
two light grounds. The deviation is the encoder's treatment of a low-contrast pair
rather than anything about a light or dark panel. **Two of those readings also fall
BELOW the 4.0 band this change introduces** — `monokai` 3.70 and `synth` 3.98 — and
that is the framing rather than a palette: the authored value is what the contract
holds (`monokai` 4.07, `synth` 4.14, both clearing the floor on the lossless
capture), and a reading taken off a committed frame can sit below the floor without
the palette being below it, because the file is the encoder's version of the paint.
Read the band off the contract and the row off the frame; where the two disagree,
the table says which is which.

**Two states were added in the frame pass that widened this set to 23 themes**, and one
of them is not a screen:

- **`focused-row-current/`** — the current row with the KEYBOARD on it (design round 2,
  N3; round 3, N4), shot on the ten themes the design named (the six pinned palettes plus
  the four re-authored by the port). It is the only frame in the set where two outline
  rules meet on one box: the `highlight` ground and the row's own `focus-visible` ring
  (2px `outline-accent`, 2px offset) drawn AROUND it. The ring is BROWSER state and cannot
  be faked by the story — a programmatic `.focus()` does not match `:focus-visible`, which
  the first cut of this state demonstrated by capturing the ground with no ring at all — so
  the rig presses the real Tab key until the row holds focus (`{ tabTo }` in
  `scripts/capture-evidence.mjs`) and throws rather than filing an unfocused frame under it.
  **Known omission, stated rather than implied (design round 4, D9):** the ring is shot on a
  MID-LIST row only — the first and last rows of the list and the New chat row under focus
  are not photographed, so whether the ring clips at the panel's edges is not settled by a
  frame.
- **`wash-swatches/`** — the current row's `highlight` beside the app's active-row
  `accentWash`, as a **colour-only** frame: the picture says so in its own caption, and the
  frame's own ground is `bg-canvas` (named here because the caption names roles and not
  grounds). What it settles is the ΔE00 between the two grounds, which is the contract's
  `HIGHLIGHT`/wash assertion; the readings are in the table below.
  **Can the two ever share a screen? Yes — and that is why the pair is measured.** The app
  rail is persistent and paints `accentWash` on its active item, so with the chat sidebar on
  screen a reader sees the current conversation row's `highlight` and the rail's wash in the
  same window, in panels that do not touch. A reader should expect the two marks to look like
  two grounds there, which is what the contract's floor is for. The rig cannot frame that
  pair because none of its seven states renders the app rail — which is the reason this frame
  is a swatch rather than a screen, and not a claim that the two cannot co-occur. Shot on the four palettes the port's
  collision was measured on (`oneLight`, `rosePineDawn`, `rosePine`, `tokyoNightDay`).

**The cause is the encoder, not the compositor**: re-encoding a lossless capture of
this same story at the same quality reproduces the committed readings digit for
digit, and the lossless reading of the same frame is the contract's own number. So
the committed frames are evidence about the ROW — which role it paints, that the
mark's box is 32 rows, that
nothing moves — while the band is the contract's own numbers, and a reader who wants
the band should read those rather than the q88 column.

**The row's BOX is 32 rows, losslessly, on every palette and in every state in this
set** — the same 32 the before half's run covers — so the mark (a ground and a
weight, neither of which is geometry) does not move the row. The q88 files read
32–34: that is the encoder's bleed at the run's edge, not the box.

**The settings rail's current section (`settings-rail/`), the same instrument, on
the rail's own frame and column (x 60–260, y 140–260):**

| palette | before (base, q88) | after (lossless) | after (committed q88) |
| --- | --- | --- | --- |
| tokyoNight | `#2b2f42`, ΔE00 **2.23** | `#313342`, **4.09** | `#313343`, 3.90 |
| localOperatorDark | `#25211c`, 2.20 | `#292116`, **4.15** | `#282116`, 4.23 |
| localOperatorLight | `#eeede6`, 2.47 | `#ecebde`, **4.02** | `#ececde`, 4.75 |
| iceberg | `#e7e9eb`, 2.36 | `#e5e7f1`, **4.12** | `#e6e7f2`, 5.67 |
| dracula | `#37384e`, 2.26 | `#3a3c56`, **4.11** | `#3a3d57`, 4.15 |
| sage | `#f0ede2`, 2.34 | `#e8e4da`, **4.02** | `#e7e5da`, 4.15 |

The rail takes the same role at the same mark. Six palettes are listed because the
pair is the SAME pair as the chat panel's — `highlight` on `surface`, one palette
value, one role — so the other six read exactly as they do in the table above; the
frames are in `settings-rail/` for all twelve.

- **The caps' ink rank, on the palette.** Measured rather than argued, because
the earlier round took a decision here and the pixels disagreed with it: at
`ink-muted` a legend cap sat at **6.76-6.83:1** against the bar while its own
labels read **4.55:1** and **3.87:1**, and on the active row the `Go` verb read
**4.54:1** against the `↵` cap beside it at **7.02:1** — the annotation outranking
the thing annotated, against an instruction to be *more subtle*. At `ink-dim`
the cap clears § 3's 4.5:1 floor on every ground it renders on (worst **4.51:1**,
dracula on `elevated`) and sits at or below its label. The monospace face and the
single box are what still say "this is a key".
- **One residue that is judged rather than fixed.** In the palette's legend bar a
`↑` is a Geist Mono glyph and a `↵` is a lucide icon at 12px, and the two media do
not carry the same weight. Measured on this head's `localOperatorDark`
`--filtered` frame, over each cap's own 20x20 box against the bar's `elevated`
ground: the glyph's brightest pixel is **135.3** against the ink role's own 136.3,
the icon's is **130.7** (a 1px stroke never quite reaches full ink), and the mean
over the ink above the ground is **92.7** for the glyph against **90.7** for the
icon — while the icon COVERS more of its box (**28** ink pixels against 22). So the
difference is a peak, not a weight: the two read at very nearly the same
darkness and the icon is the broader mark of the two. It stands because both
remedies are worse: § 4 forbids a `strokeWidth` override anywhere in the tree (the
checkbox's `strokeWidth={3}` was REPLACED by a size step for exactly this reason),
and the size step is what this change already took (10px → 12px, tying the icon to
the type it sits in) — one more step would break that tie and overflow the word
caps. Stated because it is measurable, not because it is wanted.
- **The scope legend's binding, and why it is spacing rather than a box.** Each of
the four typed prefixes now sits at `gap-0` from its label: measured in this head's
palette frame, the `,` glyph's ink is **10px** from "Settings" and **25px** from
the previous entry, where at the old `gap-1.5` the same two distances were **16px**
and **25px** — nearer its left neighbour than its own label, which is how a 2px
glyph centred in a 20px box reads as stray punctuation. A hairline box for
punctuation only would reintroduce the second idiom this whole change exists to
remove, so the spacing is the lever.

## What these frames cannot show

- **The settings rail's current row was a GAP for two rounds, and this round closes
  it.** It takes the same role at the same call site, and until now no frame in this
  repository showed it. The blockages were real and are recorded rather than
  dismissed: `shell-app-shell--settings-appearance` sets
  `documentElement.dataset.capturePending` and clears it only once the settings page
  renders the Appearance switch — which the offline settings page never does — so a
  sweep waits out its 60s bound and reports
  `{"drawn":false,"counted":88,"pending":true}`, aborting before reaching
  `shell-app-shell--settings` in the same list; and re-shooting those stories on a
  tree with no backend renders the disconnected state in place of the populated
  frames. The rail is therefore photographed the other way — by rendering
  `SettingsSidebar` directly, which takes `activeSection`, `sections` and a callback,
  reads no store and needs no desktop bridge, so nothing about it is stubbed or
  faked. `settings-rail/` and `settings-rail-neighbour-hovered/` are that surface at
  twelve themes each, with their own before halves.
- **Hover, on the OTHER states.** `selected-row-neighbour-hovered/` and
  `settings-rail-neighbour-hovered/` photograph the pointer beside the current row,
  which is the pair this round is filed about. The `hover:bg-highlight` half —
  hovering the row that is ALREADY current — is not a frame and is asserted instead
  in `scripts/chat-sidebar-selection.test.mjs` (which resolves the class expression
  through the shipped `cn`) and by the contract's `highlight`-vs-`elevated`
  assertion. QA measured that case live in the running app in an earlier round and
  reports the ground unchanged (ΔE00 0.00 from rest).
- **The row's box, to the pixel, only in the LOSSLESS reading.** The mark is a
  ground and a weight now — neither is geometry — and the row's box is 32 rows in
  the lossless capture of every palette and every state here, the same 32 the before
  half's run covers. The committed q88 files read 32–34 on the same frames, which is
  the encoder's bleed at the run's edge rather than the box; the number to trust for
  geometry is the lossless one, and `harness/read-current-row.mjs` reports both the
  run and its extent so a reader can tell which they are looking at.
- **The FOCUSED current row.** Design round 1's N3 recorded it as unphotographed
  because it was the one state where two outline rules met — the row's own 1px
  `outline-control` ring inside `rowStyle`'s `focus-visible:outline-2 outline-accent
  outline-offset-2`. Round 2's remediation retired the ring, so a focused current row
  now carries one outline (the focus one, drawn outside the box) over the ground and
  the weight, which is the same pairing as a focused row that is not current. It is
  still not a frame; what changed is that the state it was flagged for no longer
  exists.
- **Whether a hovered neighbour is still distinguishable, judged rather than
  measured.** The frames show it and the numbers bound it: on eight of the twelve
  palettes the hovered row's ground is the larger step off `surface` (radient 6.25,
  synth 5.44, obsidian 4.72 against marks of 4.01–4.15), and the current row is the
  only one of the two carrying weight 500 and a state that survives the pointer
  leaving. Which of those two facts a reader weights more is a design judgement, and
  it is the reason this set's pointer pairs exist: they are the evidence, not the
  verdict.
- **The New chat row's own frames from the earlier round.**
  `docs/evidence/new-chat-shortcut/`, `new-chat-row/` and `sidebar-new-chat/` are
  live-app captures of the same row from previous rounds, and they are NOT re-shot
  here: they come from per-set browser harnesses against an isolated backend, they
  already photograph a ground the app has since retired (the accent wash, and then
  `sunken`), and the surface they cover on this head is committed here — twelve
  themes of the row with its chord, plus the app rail's own `⌘+K` cap in
  `docs/evidence/renderer-driver/palette-{rail,browse,query,dismissed}-*.png`,
  re-shot at this head through `--scene palette`. The `new-chat-shortcut/` README
  carries a superseded note that now names the ink step and the chord gap as well as
  the retired fill.
- **The caps inside a current row on the FIRST paint after the row becomes
  current** — the story sets the state before the frame, so the transition is not
  in any frame. It is a colour step and a weight with no layout change:
  `scripts/chat-sidebar-selection.test.mjs` pins that the row's box is the same
  in both states (`rowStyle` is untouched, which is what the retired `capEdge`
  outline was there for).

## The colour-application pass (18 September 2026), at head `4755b126c`

EVERY FRAME IN THIS SET WAS RE-SHOT by the colour pass, and the note above about
`highlight` describes the frames that used to be here rather than these. The
role was retired: a row's pointer state is now `rowHover` and the row the reader
is ON is `rowSelected` — a quieter fill **plus a 2px `accent` bar and
`font-medium`**, because the two fills are one hue at two strengths and the last
increment of "which one am I on" is not a colour distance. The pair this is
judged on is `selected-row-neighbour-hovered/` and
`settings-rail-neighbour-hovered/`: a selected row and a hovered row in ONE
frame is the only arrangement that answers whether the persistent mark still
outranks the transient one.

- **Thirty-eight themes, not the twenty-three the port carried.** The set now
  also covers the eleven palettes `4755b126c` re-solved (autumn,
  catppuccinMocha, desert, forest, lavender, neonNoir, ocean, rosePine,
  rosewood, tokyoNight, vaporwave) plus `paper`, because a value move is only
  visible where the values land.
- **The before half is re-shot too**, from `origin/main` = `4b0ee7849`, at the
  same thirty-eight themes and the same viewports; the frames are in
  `../chat-sidebar-current-row-baseline/` and every pair is therefore a
  difference in the rendering and not in the capture.
- **Two contact sheets** in `contact-sheet/`, composed with `magick` from these
  frames (the rig has no montage facility): `sidebar-row-states.png` is three
  columns — `origin/main` current row, `4755b126c` current row, `4755b126c`
  current row with its neighbour under the pointer — over all eighteen themes the
  brief's spread and the re-solve share; `settings-rail-row-states.png` is the
  same three columns for the rail. Each cell is the same crop of the same story
  at the same viewport, so a column is a like-for-like.
- **The stories' captions were re-worded and the four sidebar directories re-shot**, in
  remediation round 1. The frames are the artifact a reader and the next reviewer
  read, and the two captions named the retired role — `SelectedRow`'s panel read
  "drawn on `highlight`" and `SettingsRail`'s "the same `highlight` ground" — which
  made every frame in `selected-row/`, `selected-row-neighbour-hovered/`,
  `settings-rail/` and `settings-rail-neighbour-hovered/` evidence arguing against
  the component it pictured. The captions now name `rowSelected`, `rowHover` and the
  bar, and those four directories were re-shot at the same themes and viewports.
  `bound-row-current/`, `nested-row-current/` and `new-chat-row-current/` still carry
  the old caption in their frames, and `obsidian`'s frames outside the four were shot
  before its own fills were re-derived (see the palette's `rowHover` note); both are
  recorded as owed rather than left to be discovered.
- **The hover/selected INVERSION list, re-derived from the palette values** (design
  round 1, D5 — the list this file carried named `catppuccinMacchiato`, `palenight`
  and `nord`, and it no longer matched the frames: `nord`'s order is CORRECT). On 7 of
  the 29 dark themes this set frames, the hovered fill is the LARGER ΔE00 step off
  `surface`; by `L*` all 29 rank correctly, so this is a chroma effect and the 2px bar
  plus `font-medium` carry the ranking in every one:

  | theme | hover off `surface` (ΔE00 / `L*`) | selection off `surface` (ΔE00 / `L*`) |
  |---|---|---|
  | `synth` | 15.48 / +1.53 | 14.36 / +4.98 |
  | `vaporwave` | 12.43 / +1.58 | 9.57 / +4.88 |
  | `solarizedDark` | 9.72 / +1.70 | 8.67 / +4.07 |
  | `catppuccinMacchiato` | 8.23 / +1.63 | 5.96 / +2.77 |
  | `dracula` | 8.14 / +1.54 | 6.40 / +4.82 |
  | `tokyoNight` | 7.05 / +1.72 | 5.98 / +4.76 |
  | `catppuccinMocha` | 5.85 / +1.58 | 5.63 / +4.69 |

  The `L*` column is why this is a constraint and not a defect: every one of the seven
  ranks correctly on lightness, and the inversion is entirely the chroma term ΔE00
  carries. These are PALETTE values (`scripts/color.mjs`) rather than frame readings —
  the two lists disagreed because the earlier one was read off WebP q88 pixels, which
  is the instrument the design round itself warned about. It is a constraint
  rather than a defect — the ranking holds — and what it forbids is a later change
  that softens the bar, drops the weight, or moves the selection back onto the fill,
  which would reopen the original bug on these seven.
- **Still owed**: the four remaining baseline directories
  (`bound-row-current/`, `nested-row-current/`, `new-chat-row-current/`,
  `focused-row-current/`) are NOT re-shot at this head, so their frames picture
  the retired role.
