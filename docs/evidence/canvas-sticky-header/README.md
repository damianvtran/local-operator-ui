# The canvas's sticky headers: an isolating band, and a scroll that clips below it

**The defect.** With desktop translucency on, the Canvas → Files section headers
(`Images 86`) did not isolate themselves from the rows scrolling beneath them. The
operator's frame shows a thumbnail's green filling the header band and a file name
colliding with the section label. The header was translucent in the worst possible
way: it let its own content and the content behind it occupy the same pixels.

**Two defects, one fix each.**

1. **The band was a low-alpha fill over moving content.** Measured on the running
   app, the Files section header's computed background was
   `color(srgb 0.168627 0.152941 0.129412 / 0.05)` with `backdrop-filter: none`.
   A fill at 5% alpha cannot hide anything that moves behind it, so every row that
   scrolled up was readable through the band.
2. **The scroll did not clear the sticky header.** The section header is
   `position: sticky` INSIDE the Files scroller, and the reveal that follows
   keyboard navigation assigned `scrollTop = band.top` — landing the focused row
   at the scroller's top edge, which is the header's own 32 pixels. Measured
   before the change: **12 of 12** upward keyboard landings put the focused row
   exactly 32px under the header, so the user navigated to a row they could not
   see.

**The fix, as a system.** One mechanism, applied to every header that scrolls
under its own content:

- `data-glass-plane="band-backdrop"` — a new glass-plane kind in
  `src/renderer/src/styles/index.css`. The element gets its own compositing
  layer, the backdrop behind it is BLURRED, and a tint derived from the panel's
  own **surface role** (not ink) knocks the rest back. The alpha is the published
  surface alpha, so the band thickens and thins with the pane around it.
- The reveal now clears the header: the focused band is revealed **below** the
  header's bottom edge, not under it.

**One rule, two families.** The census (`census-sticky-elements.mjs`) measured
every sticky element on the running app across the chat, Files, asks, console,
browser, code-review, Library and projects surfaces. The result is that the
Files tab's three `h3` section headers are the only scroll-under family in the
canvas, and the Library's spreadsheet table header is the same shape in a
different pane. A separate probe (`detect-overlay-headers.mjs`) asked the
complementary question — does any header overlay a scroller from OUTSIDE it,
which the scroller's own overflow could not clip? — across the same surfaces,
and found **none**: every other canvas pane's bar is a sibling above its
scroller, so its own clip already does the work.

## The frames

`before/` and `after/` are the Files tab mid-scroll, captured from the running
app over CDP with a real scroll position that puts a thumbnail boundary across
the header. The "thumb boundary crossing the header" is the point: the green
thumbnail in the band is the content that used to be readable through it.

| frame | glass | theme | what it shows |
| --- | --- | --- | --- |
| `before/files-before-dark-i80.png` | 80% (default) | dark | a thumbnail's green filling the band, the `Images 86` label sitting on it |
| `before/files-before-light-i80.png` | 80% (default) | light | the same, on the light palette |
| `before/files-before-dark-i0.png` | 0% (opaque end) | dark | the same |
| `before/files-before-light-i0.png` | 0% (opaque end) | light | the same |
| `after/files-after-dark-i80.png` | 80% (default) | dark | the band is dimmed and blurred; the label is clean |
| `after/files-after-light-i80.png` | 80% (default) | light | the same |
| `after/files-after-dark-i0.png` | 0% (opaque end) | dark | the same |
| `after/files-after-light-i0.png` | 0% (opaque end) | light | the same |
| `after/files-after-dark-i100.png` | 100% | dark | the band still isolates at the most transparent end |
| `after/files-after-light-i100.png` | 100% | light | the same |
| `after/files-after-dark-ioff.png` | glass off | dark | no backdrop, and nothing to hide — the band's own fill is opaque |
| `after/files-after-light-ioff.png` | glass off | light | the same |

The frames were taken on a machine carrying other sessions, so the wall-clock
frame times in the capture log are NOT a measurement of this change; the
interleaved A/B below is.

`states/` covers the states a band has to survive, which the design round asked
for explicitly: a row HOVERED under the band, a row SELECTED (current) under the
band, and the Library's own header. Pointer states were produced through
Chromium's real input pipeline, and the rig asserts `:hover` before the shutter.

| frame | what it shows |
| --- | --- |
| `states/states-states-dark-hover.png` | a row hovered on its visible part below the band, the band's lower edge meeting the hover ground |
| `states/states-states-light-hover.png` | the same, light theme |
| `states/states-states-dark-selected.png` | the CURRENT row crossing the band (`bg-row-selected`), the band painting over its top |
| `states/states-states-light-selected.png` | the same, light theme |
| `states/states-states-library-dark.png` | the Library's spreadsheet header — opaque, no blur, the rows hidden behind it |
| `states/states-states-library-light.png` | the same, light theme |

**An evidence correction, recorded rather than quietly re-shot.** The first
`states/` capture wrote a DARK frame under the light filenames: the rig called
`setTheme("light")` (the scheme word) where the app takes a palette id
(`localOperatorLight`), so the palette never moved and the Library pair came
back byte-identical. The design round caught it by comparing the PNGs rather
than trusting the filenames. The rig now maps the scheme to the palette id,
records the resolved `--lo-surface` per theme in `states.json` under
`themeGrounds`, and **exits 1** if dark and light resolve to the same ground
instead of writing a mislabeled frame. The committed frames are the re-capture:
`themeGrounds` is `{dark: "#2b2721", light: "#f7f5ee"}`, all six frames are
distinct, and the light pair is genuinely light.

## The numbers

### The header's own paint, read from the running app

`capture-sticky-header.mjs` reads the computed style of the header at each glass
intensity, in each theme:

| glass | theme | computed background | `backdrop-filter` | height | band inside the scroller | clip offset below the header |
| --- | --- | --- | --- | --- | --- | --- |
| 80% (default) | dark | `color(srgb 0.196078 0.176471 0.133333 / 0.91)` | `blur(12px)` | 32px | 32px | −32px |
| 80% (default) | light | `color(srgb 0.996078 0.992157 0.972549 / 0.78)` | `blur(12px)` | 32px | 32px | −32px |
| 100% | dark | `… / 0.91` | `blur(12px)` | 32px | 32px | −32px |
| 100% | light | `… / 0.78` | `blur(12px)` | 32px | 32px | −32px |
| 0% (opaque end) | dark | `… / 0.96` | `blur(12px)` | 32px | 32px | −32px |
| 0% (opaque end) | light | `… / 0.96` | `blur(12px)` | 32px | 32px | −32px |
| glass off | dark | `… / 1` | none | 32px | 32px | −32px |
| glass off | light | `… / 1` | none | 32px | 32px | −32px |

The band is 32px and it lies INSIDE the scroller's own clip region, so every row
that scrolls up passes through those 32 pixels. That is the geometry defect #1
is about, and it is why the band has to isolate rather than tint: there is no
clip to hide behind.

The alpha is the pane's own **`elevated`** role, floored at
`--lo-glass-a-band-floor` — the one alpha in the model derived for a band over
MOVING content. It thickens as the translucency is turned down (0.96 at the
opaque end) and thins as it is turned up, but never below the floor (0.91 dark,
0.78 light). The floor is the point: above it the band tracks the pane, and at
it the band still holds its ink against whatever scrolls underneath.

### The count's ink: the design round's D1, and its remediation

The section count (`86` beside `Images`) is text on the band, and the band's
ground is the content passing under it. At the first paint this change shipped,
the count's `text-ink-dim` measured **3.57:1** at the default 80% in the light
theme and **2.50:1** at the most transparent end — below the app's 4.5 text
floor (`scripts/contrast-contract.mjs`). The design round measured the same
numbers independently off the captured PNGs' glyph interiors (D1, MAJOR).

Two things fixed it, and both are structural rather than a nudge:

1. **The band's alpha got its own floor**, derived per scheme from every palette
   (`deriveBandFloor()` in `scripts/derive-glass-floors.mjs`): 0.91 dark, 0.78
   light. It is asserted by `scripts/contrast-contract.mjs`, so a hand-lowered
   floor fails the contract.
2. **The count moved to `text-ink-muted`**, the register the app's own section
   headers already use beside a label
   (`features/projects/components/team-section-header.tsx`).

Measured off the new frames, in the count's own 167–195 column run:

| frame | count ink | band ground | contrast |
| --- | --- | --- | --- |
| dark, 80% | `(193,188,177)` | `(50,49,34)` | **6.94:1** |
| dark, 100% | `(193,188,177)` | `(57,49,35)` | **6.78:1** |
| dark, 0% | `(193,188,177)` | `(49,46,35)` | **7.18:1** |
| dark, off | `(193,188,177)` | `(42,39,34)` | **7.86:1** |
| light, 80% | `(77,73,65)` | `(230,230,218)` | **7.12:1** |
| light, 100% | `(77,73,65)` | `(215,218,200)` | **6.29:1** |
| light, 0% | `(77,73,65)` | `(246,246,241)` | **8.26:1** |
| light, off | `(77,73,65)` | `(247,245,239)` | **8.21:1** |

Every frame clears 4.5:1. The light theme at 100% — the worst case the design
round found — went from 2.50:1 to 6.29:1.

(The `light, off` row read 15.23:1 in an earlier version of this table. That
was a sampling error: on the fully opaque ground the window picked the label's
`ink` rather than the count's `ink-muted`. The design round and QA both
measured 8.21:1 for that frame independently, and the row above is their
number. The count is the same ink in every row; only the ground moves.)

### The Library's header: measured, and deliberately NOT a band

`measure-library-header.mjs` opens a real spreadsheet asset in the Library and
reads its sticky table header:

```
plane: null
background: "rgb(29, 27, 25)"
backdropFilter: "none"
position: "sticky"  top: "0px"  height: 26
scroller: { overflowY: "auto",
            maskImage: "linear-gradient(rgba(0,0,0,0) 0px, rgb(0,0,0) 0px, rgb(0,0,0) 100%, rgba(0,0,0,0) 100%)" }
regionChain: ["pane", "canvas", "canvas-backing"]
```

**This is the corrected answer, and the correction is the point.** An earlier
revision of this change put the shared `band-backdrop` plane on this header too,
reasoning that both families were "sticky headers that rows scroll under". They
are not the same case. The Files section header was a 5% ink wash with no
isolation at all; the Library's column strip carries `bg-sunken`, an **opaque**
role fill with no glass opt-in, so the sheet's rows are hidden behind it
outright. Turning it translucent made it strictly worse: QA measured
`row-008` legible under the `A` column label, where the pre-change paint hid it
completely (Q1, MAJOR).

The revert is what the numbers above show: `plane: null`, the opaque sunken
value, no blur. The shared plane is for the bands that actually need isolating,
and the Library keeps the answer it already had. The scroller's `maskImage` is
the Library's own **top fade**, and it is unchanged — the request asks that the
panel's top fade keep behaving as it does elsewhere in the app, and it does.

### The pixels: is anything still readable through the band?

`analyse-band-pixels.sh` measures the band and a control strip immediately
below it. The strip is deliberately **label-free** (it starts at device x=2100,
past the end of the `Images 86` label at ~1955), because the label is sharp text
of its own and a strip containing it would measure the label rather than the
content behind the band.

The number that answers "is it still readable" is `band_detail` — the strip's
standard deviation after a 3px blur, which isolates high-frequency content. Text
and thumbnail edges are high-frequency; a blur removes them. `survives_into_band`
is that against the control strip's own value, so it is the fraction of the
content's edge energy that survives into the band.

| frame | `band_detail` | `control_detail` | survives into the band | `band_sat` | `control_sat` |
| --- | --- | --- | --- | --- | --- |
| before, dark, 80% | 0.0249 | 0.0608 | **0.409** | 0.0957 | 0.2034 |
| before, light, 80% | 0.0948 | 0.1012 | **0.936** | 0.1006 | 0.0757 |
| before, dark, 0% | 0.0231 | 0.0514 | **0.450** | 0.1071 | 0.2581 |
| before, light, 0% | 0.0646 | 0.0730 | **0.885** | 0.1143 | 0.1221 |
| after, dark, 80% | 0.0008 | 0.0935 | **0.013** | 0.0000 | 0.2034 |
| after, light, 80% | 0.0147 | 0.1012 | **0.145** | 0.0431 | 0.0757 |
| after, dark, 100% | 0.0011 | 0.0969 | **0.014** | 0.0080 | 0.2450 |
| after, light, 100% | 0.0081 | 0.2191 | **0.037** | 0.0067 | 0.1570 |
| after, dark, 0% | 0.0006 | 0.0291 | **0.021** | 0.0071 | 0.1306 |
| after, light, 0% | 0.0017 | 0.0782 | **0.021** | 0.0271 | 0.0819 |
| after, dark, off | 0.0000 | 0.1217 | **0.000** | 0.0000 | 0.2670 |
| after, light, off | 0.0000 | 0.0253 | **0.000** | 0.0000 | 0.0278 |

The light theme is the operator's worst case and the sharpest result: **0.936 of
the content's edge energy survived into the band before, and 0.145 after** — a
6.5× reduction. The dark theme is sharper still at 80%: 0.409 before, **0.013**
after. The band's saturation against the control's shows the same thing about
the green specifically: 0.1006 before, 0.0431 after, against a control of 0.0757.

### The reveal: the scroll clips below the header

`measure-reveal-landing.mjs` drives the list's OWN keyboard navigation and asks
where each focused row landed relative to the pinned header's bottom edge. A row
whose top is above that edge is a row the header paints over.

Before (`reveal-before.json`):

```
12 of 12 UPWARD keyboard landings ended up UNDER the header (worst -32px)
```

After (`reveal-after.json`):

```
0 of 12 UPWARD keyboard landings ended up UNDER the header (worst 4px)
[reveal/up 0] "image-0276.png0 KB" focusedTop=188 headerBottom=184 hiddenBy=4px
[reveal/up 1] "image-0264.png0 KB" focusedTop=188 headerBottom=184 hiddenBy=4px
...
0 of 14 DOWNWARD keyboard landings ended up UNDER the header (worst 0px)
```

Every landing is now 4px BELOW the header's bottom edge. The 4px is the focus
ring: it is drawn 2px outside the row with a 2px offset, so a landing flush at
184 would paint the ring's top 4px under the header — the user would be told
they are on a row whose ring they cannot see. The gap is `FOCUS_RING_GAP`, and
the arithmetic is asserted by `scripts/finder-reveal-scroll.test.mjs`.

The downward case was already correct and is unchanged.

## Scroll performance: the backdrop-filter's cost

The request asks that a `backdrop-filter` per sticky header on a 342-item grid
must not drop frames, and that if it does, that is a finding.

**The measurement had to be built to survive this machine.** A wall-clock frame
time is meaningless here: this machine carries other sessions, and the first
attempt showed the inversion — the variant WITHOUT the filter measured 105ms
median and the one WITH it measured 27ms, on a load average of 64. The two
numbers were measuring the machine, not the filter.

`measure-scroll-perf-ab.mjs` measures the two variants on the same build, in one
app session, switching the filter off by overriding the one property under test.

**Round mode was not good enough, and the data says so.** A round measures one
variant, then the other, seconds apart. Across seven rounds this host went from
a 229ms median to a 21ms median — a tenfold drift — and the median of the
per-round deltas followed the drift rather than the filter: two runs of the same
rig gave **−20ms** and **+19.1ms**, with the sign of every late round flipped.
Reporting either number as "the filter's cost" would have been reporting the
machine.

So the headline measurement is **fine mode**: the variant alternates EVERY
segment, and each paired delta is between two measurements a fraction of a
second apart. Whatever the host is doing, it is doing it to both halves of the
pair.

23 adjacent pairs, on-minus-off:

```
−1.6, −16, 3.4, 15.5, 15.5, 61.4, −54.5, −127.1, −123.3, −64.6, 40.1,
−3.9, 12.2, 1.6, 1.9, 9.7, −13.3, 33.1, −82.4, −105.3, −46.1, −6, 51.1
```

**Median paired delta: −1.6ms. Median p25 delta: +1.3ms.** A 60Hz frame is
16.7ms, so both central estimates are an order of magnitude under one frame, and
the median is slightly in the filter's favour — i.e. indistinguishable from
zero.

**The finding: no frame-drop attributable to the filter.** The spread of the
individual deltas (−127ms to +61ms) is the host, not the filter, and it is why
the round-mode median moved between runs. The honest limit is stated plainly:
this measurement resolves the filter's cost to within about ±2ms on this
machine; it cannot prove the cost is exactly zero, and it does not need to — the
constraint is that the band must not drop frames, and nothing here shows it
doing so.

(One structural note, since the numbers cannot speak to it: the filter is on a
32px-tall band, not on the 342-item grid. It samples a strip of the composited
layer beneath it once per frame; the grid's own painting is unchanged.)

## What was NOT changed, and why

- **The scrollbar.** The Files scroller's own `overflow-auto` and its
  `scrollbar-gutter` are untouched, so the scrollbar keeps the width and the
  behaviour it has everywhere else in the app.
- **The panel's top fade.** The Library pane's `maskImage` top fade is
  unchanged and is read back in the measurement above, still
  `linear-gradient(rgba(0,0,0,0) 0px, rgb(0,0,0) 0px, rgb(0,0,0) 100%, rgba(0,0,0,0) 100%)`.
- **The other canvas panes' bars.** They are siblings above their scrollers, so
  the scroller's own overflow already clips content at the bar's bottom edge.
  `detect-overlay-headers.mjs` measured this on all six surfaces and found no
  header that overlays a scroller from outside it. Giving them the isolating
  band would have been a change to a case that does not exist.
- **The Library's sticky table header**, after the first revision got it wrong.
  It was opaque before; a translucent band made it strictly worse. See the
  measurement above. This is the one place a first attempt was reverted.
- **Off glass.** `bg-surface` is opaque with the glass off, so the scroller's
  content never reached the header in the first place; the band rule is scoped
  to `html[data-glass~="pane"]` and does nothing there. The captured
  `*-ioff.png` frames confirm it.

## Reproducing this

The rigs are in this directory and take the app's own backend and a desktop
token:

```
# the before/after frames and the computed-style table
node capture-sticky-header.mjs --backend <url> --session <id> --out <dir> --label after --intensities 80,0,100,off

# the pixel measurement over the captured frames
bash analyse-band-pixels.sh <rig-dir>

# the frame-cost A/B: fine mode, the one that survives this host's drift
node measure-scroll-perf-ab.mjs --backend <url> --session <id> --out <dir> --fine --segments 24 --seg-samples 24
# the round mode, kept for a quiet machine
node measure-scroll-perf-ab.mjs --backend <url> --session <id> --out <dir> --rounds 7

# the reveal landings, before and after
node measure-reveal-landing.mjs --backend <url> --session <id> --out <dir>

# the inventory: every sticky element, and every outside overlay
node census-sticky-elements.mjs --backend <url> --session <id> --out <dir>
node detect-overlay-headers.mjs --backend <url> --session <id> --out <dir>

# the states a band has to survive: hover, selected, and the Library's header
node capture-band-states.mjs --backend <url> --session <id> --asset <library asset id> --out <dir> --label states

# the Library's own sticky header, on a real spreadsheet asset
node measure-library-header.mjs --backend <url> --session <id> --asset <library asset id> --out <dir>
```

The band floor this change relies on is derived, not chosen:

```
node scripts/derive-glass-floors.mjs --check      # fails if the floor is hand-lowered
node scripts/contrast-contract.mjs                # asserts the band's inks on it, per palette
node --test scripts/finder-reveal-scroll.test.mjs # the reveal's arithmetic
```
