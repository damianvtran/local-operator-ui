# The current row's ground, and the key caps beside it

Two changes the operator reported, photographed on the surfaces they are visible
on, in all twelve palettes:

1. **"The highlight style needs to be more subtle — it's currently a very dark
   colour but it should be a slight darkening on light themes and a slight
   brightening on dark themes."** The row a reader is ON was painted `sunken`,
   which is the *recessed* role — a well, not a mark — and 3.75–14.94 ΔE00 from
   the panel it sits on. It now paints `highlight`, a role authored for this
   ground at ΔE00 2.18–2.28 from `surface`.
2. **"The keycaps need to be consistent in size, and a bit more subtle; they
   shouldn't have a dark box around them."** A cap was a `bg-sunken` box, and it
   came in two geometries in one component, a third in the command palette, and
   a fourth spelling (plain monospace) on the app rail. One idiom now, with no
   fill and no border.

## What produced these frames

```sh
# the AFTER half: the branch's own tree
npx storybook dev -p 6017 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-sidebar-current-row http://127.0.0.1:6017
node scripts/capture-evidence.mjs --only=command-palette-commandpalette-- http://127.0.0.1:6017

# the BEFORE half: unmodified origin/main at 96502d5c, in its own worktree, with
# the same story file and the same viewports copied in and both sweeps re-run.
# `chat-sidebar-current-row-baseline/` and
# `command-palette-commandpalette-baseline/` are those frames.
```

**Re-shot for round 1's remediation at `355b2bd38`**, when the current row gained
`font-medium`, the chord's wrapper gap went to `gap-0`, the scope legend's glyph
was bound to its label, and the caps' ink moved back to `ink-dim`. The two
commands above reproduce every frame here — the hovered-neighbour entry is a
`STORIES` tuple with its own `dir`, so a sweep of this set takes it with the rest,
which is the point of committing it rather than leaving the pair in a review
thread. `--allow-backend` was passed for these runs because a backend was
answering on the configured port while they were taken; neither set's stories talk
to one (the sidebar story stubs the desktop bridge, the palette stories are
fixtures), and the flag is what states that rather than implying it.

`scripts/capture-evidence.mjs` drives a private headless Chrome over raw CDP;
nothing here is a hand-taken screenshot, and no frame in this set is the
operator's own data (there is no backend answering on the configured port, which
the harness refuses to sweep without). The two story surfaces are
`src/renderer/src/features/chat/components/chat-sidebar-current-row.stories.tsx`,
added by this change, and the palette stories that already existed.

The rail — the fourth place a cap is drawn — is a driver frame rather than a
story: `docs/evidence/renderer-driver/palette-rail-{dark,light}.png`, re-shot
with `node scripts/renderer-driver.mjs --scene palette`. Its before halves are
in `docs/evidence/renderer-driver-palette-baseline/`.

## The states, and what to look at

| State | After (this branch) | Before (`origin/main` @ 96502d5c) |
| --- | --- | --- |
| A conversation row is current | [`selected-row/`](selected-row/) — 12 themes | [`chat-sidebar-current-row-baseline/selected-row/`](../chat-sidebar-current-row-baseline/selected-row/) |
| The New chat row is current, with its chord | [`new-chat-row-current/`](new-chat-row-current/) — 12 themes | [`chat-sidebar-current-row-baseline/new-chat-row-current/`](../chat-sidebar-current-row-baseline/new-chat-row-current/) |
| A NEIGHBOUR row under the pointer while a conversation is current | [`selected-row-neighbour-hovered/`](selected-row-neighbour-hovered/) — 12 themes | *(no before frame: see below)* |

The third surface is the pair the selection's own hierarchy is judged on, and it
is the one no still at rest can hold: a pointer is browser state, so the rig
dispatches a real `Input.dispatchMouseEvent` at the row immediately above the
current one (`data-chat-row:has(+ [data-chat-row][aria-current="page"])`, which is
"Migrate the deploy script" because the story's roster is newest-first and its
third row is current) and shuts the shutter with the pointer still there. It has
no before half because `main` had no such frame and no cap pair to compare with;
the comparison it exists for is WITHIN the frame — the current row's `highlight`
beside the pointer's `elevated`.

Read `localOperatorDark` and `localOperatorLight` first (the two brand palettes),
then `tokyoNight` and `iceberg` — the dark extreme and the light one, and the
palette where the new role's step is tightest against `sunken`.

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

**The current row now carries TWO signals, and the second one is the round's fix.**
With the ground quietened, a hovered neighbour's `elevated` step outranked it on the
dark palettes: measured in these frames, the hovered row sits ΔE00 **2.20-4.58** from
the panel while the current row sits **2.18-2.35**, so the pointer read as the more
selected of the two (selection over hover: 0.93 / 0.97 / 1.89 before this branch,
0.48 / 0.52 / 0.49 on it). `font-medium` is the non-colour half of the answer, and
it is the step `settings-sidebar.tsx` already carried on its active row, so the two
rails now mark a current row the same way rather than inventing a second idiom. Its
side effects were measured rather than assumed: the title's natural width grows
**2.25-2.33%** at weight 500 ("Quarterly revenue model" 149.36 → 152.84px, the
measurement is theme-independent because it is font metrics), every row in the frame
keeps **54.9px** of headroom at the heavier weight, and the row's box (263 × 32), its
line-height and its alignment are unchanged — nothing reflows and no title truncates
a character earlier. In the hovered pair you can see both at once: the neighbour
carries `elevated` and weight 400, the current row carries `highlight` and weight
500.

The row's ground moves from the recessed `sunken` to `highlight`, which is
ΔE00 **2.20** from `surface` in this palette (2.18–2.28 across the twelve) —
above the ~2 perceptual threshold `docs/branding.md` § 3 names, and well under
`sunken`'s 3.75–14.94. Its distance from `elevated`, the same rows' hover step,
is 2.52 at worst (obsidian), which is the floor that stops the step running up
into the hover state.

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

- **The settings rail's current row.** It takes the same role at the same call
  site, and it is the one changed surface NO frame in this repository shows. Two
  pre-existing capture blockages stand in the way, both measured rather than
  assumed: `shell-app-shell--settings-appearance` sets
  `documentElement.dataset.capturePending` and clears it only once the settings
  page renders the Appearance switch — which the offline settings page never does
  — so the sweep waits out its 60s bound and reports
  `{"drawn":false,"counted":88,"pending":true}`; and the sweep aborts there,
  before reaching `shell-app-shell--settings` in the same list. Re-shooting those
  stories was also measured and REJECTED rather than skipped: on a tree with no
  backend they render the disconnected state (`Desktop controls need a compatible
  backend connection`, an empty agent list) in place of the populated frames
  committed today, so a re-sweep would have replaced better frames with worse
  ones. The rail's row is therefore covered by the contract's `highlight`
  assertions and by the palette's two driver frames; the settings rail itself is
  a gap this change states rather than hides.
- **Hover, on the OTHER states.** `selected-row-neighbour-hovered/` photographs the
  pointer beside the current row, which is the pair this round was filed about. The
  `hover:bg-highlight` half — hovering the row that is ALREADY current — is not a
  frame and is asserted instead in `scripts/chat-sidebar-selection.test.mjs` (which
  resolves the class expression through the shipped `cn`) and by the contract's
  `highlight`-vs-`elevated` assertion. QA measured that case live in the running app
  and reports the ground unchanged (ΔE00 0.00 from rest).
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
