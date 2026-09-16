# The current row's ground, the edge beside it, and the key caps

Three changes the operator reported, photographed on the surfaces they are visible
on, in all twelve palettes:

1. **"The highlight style needs to be more subtle — it's currently a very dark
   colour but it should be a slight darkening on light themes and a slight
   brightening on dark themes."** The row a reader is ON was painted `sunken`,
   which is the *recessed* role — a well, not a mark — and 3.75–14.94 ΔE00 from
   the panel it sits on. It was then moved to `highlight`, authored at ΔE00
   2.18–2.28 from `surface`.
2. **"The highlight on selected sidebar items (the currently viewed chat) is way
   too subtle, can you make it brighter/more contrasted?"** The operator has now
   SEEN (1) rendered, so the band it asked for is reversed: `highlight` lands at
   ΔE00 4.01–4.39 from `surface` across the twelve palettes, bought on the chroma
   axis at the surface's own hue, and the current row also carries a 1px
   `outline-control` edge — the half of the mark the ink floors cannot cap. Both
   rails take the same two-part mark.
3. **"The keycaps need to be consistent in size, and a bit more subtle; they
   shouldn't have a dark box around them."** A cap was a `bg-sunken` box, and it
   came in two geometries in one component, a third in the command palette, and
   a fourth spelling (plain monospace) on the app rail. One idiom now, with no
   fill and no border.

## What produced these frames

```sh
# the AFTER half: the branch's own tree
npx storybook dev -p 6017 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row --allow-backend http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=command-palette-commandpalette-- http://127.0.0.1:6017

# the BEFORE half: a worktree of unmodified origin/main at da9e75a6, with the same
# story file AND this branch's two new `STORIES` rows copied in, so the rig can
# reach the settings rail at all. `chat-sidebar-current-row-baseline/` is those
# frames; its own README carries the exact commands.
```

**Re-shot for this round at `e304a384d`**, when the ground rose from the
2.18–2.28 band to the 4.01–4.39 one and the current row gained its structural
edge. Every frame in both halves is from this round's two passes: the previous
baseline was taken on a base whose current row was still `sunken`, so a pair
against it would have been a comparison between two retired grounds rather than
between this change and its own base.

`--allow-backend` was passed for these runs because a backend was answering on
the configured port while they were taken; none of the stories in this set talk
to one (the sidebar story stubs the desktop bridge, the rail story is a pure
component, the palette stories are fixtures), and the flag is what states that
rather than implying it.

`scripts/capture-evidence.mjs` drives a private headless Chrome over raw CDP;
nothing here is a hand-taken screenshot, and no frame in this set is the
operator's own data. The story surface is
`src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx`,
which carries the chat panel's three states AND the settings rail's two.

The rail — the fourth place a cap is drawn — is a driver frame rather than a
story: `docs/evidence/renderer-driver/palette-rail-{dark,light}.png`, re-shot
with `node scripts/renderer-driver.mjs --scene palette`. Its before halves are
in `docs/evidence/renderer-driver-palette-baseline/`.

## The states, and what to look at

| State | After (this branch) | Before (`origin/main` @ da9e75a6) |
| --- | --- | --- |
| A conversation row is current | [`selected-row/`](selected-row/) — 12 themes | [`chat-sidebar-current-row-baseline/selected-row/`](../chat-sidebar-current-row-baseline/selected-row/) |
| The New chat row is current, with its chord | [`new-chat-row-current/`](new-chat-row-current/) — 12 themes | [`chat-sidebar-current-row-baseline/new-chat-row-current/`](../chat-sidebar-current-row-baseline/new-chat-row-current/) |
| A NEIGHBOUR row under the pointer while a conversation is current | [`selected-row-neighbour-hovered/`](selected-row-neighbour-hovered/) — 12 themes | [`chat-sidebar-current-row-baseline/selected-row-neighbour-hovered/`](../chat-sidebar-current-row-baseline/selected-row-neighbour-hovered/) |
| The **settings rail's** current section (`1280x760`) | [`settings-rail/`](settings-rail/) — 12 themes | [`chat-sidebar-current-row-baseline/settings-rail/`](../chat-sidebar-current-row-baseline/settings-rail/) |
| …with the row ABOVE it under the pointer | [`settings-rail-neighbour-hovered/`](settings-rail-neighbour-hovered/) — 12 themes | [`chat-sidebar-current-row-baseline/settings-rail-neighbour-hovered/`](../chat-sidebar-current-row-baseline/settings-rail-neighbour-hovered/) |

The two pointer pairs are the states no still at rest can hold — a pointer is
browser state — so the rig dispatches a real `Input.dispatchMouseEvent` at the row
immediately BEFORE the current one and shuts the shutter with the pointer still
there. In the chat panel that is `data-chat-row:has(+ [data-chat-row][aria-current="page"])`
("Migrate the deploy script", because the story's roster is newest-first and its
third row is current); on the rail it is
`li:has(+ li > button[aria-current="page"]) > button`, because the rail's rows are
`li`s wrapping their own button. They exist for the comparison WITHIN the frame —
the current row's `highlight` and its edge beside the pointer's `elevated` — which
is the pair the operator's report is about.

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
| The current row's weight | **400** (the same as every other row) | **500** (`font-medium`), the step the settings rail's active row carries |
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

**The current row now carries TWO marks, and the second one is this round's fix.**
The ink floors cap how far the ground can climb — `ink-dim` is drawn inside a
current row — while the hover step the rows around it carry is `elevated`, which is
also every menu, popover and tooltip ground in the app. On eight of the twelve
palettes `elevated` is therefore still the LARGER step off `surface`, so the
persistent mark needed a signal that is not capped by an ink floor at all: the 1px
`outline-control` edge, measured 3.17–4.59:1 against the row's own ground on all
twelve palettes and drawn outside the box model. `font-medium` is the third step
and the one `settings-sidebar.tsx` already carried. Its side effects were measured
rather than assumed: the title's natural width grows **2.25-2.33%** at weight 500
("Quarterly revenue model" 149.36 → 152.84px, the measurement is
theme-independent because it is font metrics), every row in the frame keeps
**54.9px** of headroom at the heavier weight, and the row's box (263 × 32), its
line-height and its alignment are unchanged — nothing reflows and no title
truncates a character earlier. In the hovered pairs you can see both at once: the
neighbour carries `elevated` and weight 400, the current row carries `highlight`,
its edge and weight 500.

## The numbers, read back out of the committed frames

`pnpm check-themes` measures the PALETTE: it proves `highlight` is ΔE00 4.01–4.39
from `surface` on each of the twelve and that every ink clears its floor on it. It
cannot prove the row is painted with that role, or that the browser composited what
the class string asked for. So the frames are read back, one column at a time,
through `harness/read-current-row.mjs`:

```sh
sips -s format png docs/evidence/chat-sidebar-current-row/selected-row/tokyoNight.webp --out /tmp/f.png
node docs/evidence/chat-sidebar-current-row/harness/read-current-row.mjs /tmp/f.png 180 265 380 560
# {"panel":"#24283b","row":"#272d4b","edge":"#24273f",
#  "extent":{"top":487,"bottom":520,"height":34},"deltaE00":4.63}
```

The harness samples the row's ground as the MODE of a horizontal span (one pixel in
a row of text is a glyph's antialiased edge) and reports the longest run in the
window that differs from the panel's own ground.

**A conversation row is current (`selected-row/`), measured pixels:**

| palette | before | | after | |
| --- | --- | --- | --- | --- |
| | ground | ΔE00 from panel | ground | ΔE00 from panel |
| tokyoNight | `#2b2f42` | **2.23** | `#272d4b` | **4.63** |
| localOperatorDark | `#25211c` | 2.20 | `#291f14` | 4.93 |
| localOperatorLight | `#eeede6` | 2.47 | `#f5f1e0` | 4.83 |
| dracula | `#37384e` | 2.26 | `#3a3d57` | 4.15 |
| dune | `#211d1a` | 2.20 | `#272320` | 4.08 |
| iceberg | `#e7e9eb` | 2.36 | `#e6e7f2` | 5.67 |
| monokai | `#34362e` | 2.24 | `#37392d` | 3.70 |
| neon | `#171c2a` | 2.24 | `#1b2230` | 4.05 |
| obsidian | `#1f1f21` | 2.20 | `#24232a` | 5.04 |
| radient | `#222637` | 2.21 | `#272c3c` | 4.22 |
| sage | `#f0ede2` | 2.34 | `#e7e5da` | 4.15 |
| synth | `#231235` | 2.19 | `#291641` | 3.98 |

**The settings rail's current section (`settings-rail/`), the same instrument,
on the rail's own frame and column (x 60–260, y 140–260):**

| palette | before | after |
| --- | --- | --- |
| tokyoNight | `#2b2f42`, ΔE00 **2.23** | `#272d4b`, ΔE00 **4.63** |
| localOperatorDark | `#25211c`, 2.20 | `#291f14`, 4.93 |
| localOperatorLight | `#eeede6`, 2.47 | `#f5f1e0`, 4.83 |
| iceberg | `#e7e9eb`, 2.36 | `#e6e7f2`, 5.67 |
| dracula | `#37384e`, 2.26 | `#3a3d57`, 4.15 |
| sage | `#f0ede2`, 2.34 | `#e7e5da`, 4.15 |

**The rendered reading tracks the palette's own within about 0.4, and where it does
not the frame is the honest number.** The compositor rounds each ground to 8 bits
against its own colour management, so monokai's panel reads `#2d2f27` where the
palette says `#2E2F28` — one level on each channel — and that alone moves the pair
by 0.37, which is the whole of the gap between the contract's 4.07 and the frame's
3.70. Both numbers are stated rather than the flattering one: the contract is what
holds the value, and the frame is what the reader sees.

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
- **The row's box, in the two halves, to the pixel.** The mark names only outline
  classes — asserted in `chat-sidebar-selection.test.mjs`, which refuses any token
  in `rowCurrentEdge` that is not in the outline group — and an outline
  participates in no box model. The frames agree but do not resolve it more finely
  than that: the run of pixels differing from the panel grows by one to three rows
  in the after halves, which is the 1px ring landing inside the row's own box at
  `-outline-offset-1`, not the box moving. A reader who wants the box itself should
  measure the live DOM; no frame in this set does.
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
  in both states (`rowStyle` is untouched, and the retired `capEdge` outline was
  an outline for exactly that reason).
