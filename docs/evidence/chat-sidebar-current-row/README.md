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
| A palette legend cap (`esc`) | **15.2** × 21.39 px, fill `sunken`, ink `ink-dim` `rgb(145,139,125)` | 20 × 20 px floor, `esc` 29.61 × 20, no fill, ink `ink-muted` `rgb(181,175,162)` |
| The current row's ground | `rgb(15,12,8)` = `sunken` | `rgb(37,33,27)` = `highlight` `#25211b` |
| The panel behind it | `rgb(30,26,20)` = `surface` | unchanged |

So the two claims are each two numbers: **one bar carried caps 14px and 21.39px
tall under the same 20px minimum width**, and the third spelling in the palette
was 15.2px wide where the sidebar's was 20. After the change every cap is 20 × 20
with the same ink and no ground at all, and a word grows out of that floor
(`esc` 29.61px) rather than changing size class.

The row's ground moves from the recessed `sunken` to `highlight`, which is
ΔE00 **2.20** from `surface` in this palette (2.18–2.28 across the twelve) —
above the ~2 perceptual threshold `docs/branding.md` § 3 names, and well under
`sunken`'s 3.75–14.94. Its distance from `elevated`, the same rows' hover step,
is 2.52 at worst (obsidian), which is the floor that stops the step running up
into the hover state.

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
- **Hover.** A still capture cannot hold a pointer, so the `hover:bg-highlight`
  half of the row's ground is asserted in
  `scripts/chat-sidebar-selection.test.mjs` (which resolves the class expression
  through the shipped `cn`) and by the contract's `highlight`-vs-`elevated`
  assertion, not photographed.
- **The caps inside a current row on the FIRST paint after the row becomes
  current** — the story sets the state before the frame, so the transition is not
  in any frame. It is a colour step with no layout change:
  `scripts/chat-sidebar-selection.test.mjs` pins that the row's box is the same
  in both states (`rowStyle` is untouched, and the retired `capEdge` outline was
  an outline for exactly that reason).
