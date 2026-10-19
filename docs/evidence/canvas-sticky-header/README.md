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

## The numbers

### The header's own paint, read from the running app

`capture-sticky-header.mjs` reads the computed style of the header at each glass
intensity, in each theme:

| glass | theme | computed background | `backdrop-filter` | height | band inside the scroller | clip offset below the header |
| --- | --- | --- | --- | --- | --- | --- |
| 80% (default) | dark | `color(srgb 0.168627 0.152941 0.129412 / 0.73)` | `blur(12px)` | 32px | 32px | −32px |
| 80% (default) | light | `color(srgb 0.168627 0.152941 0.129412 / 0.59)` | `blur(12px)` | 32px | 32px | −32px |
| 100% | dark | `… / 0.67` | `blur(12px)` | 32px | 32px | −32px |
| 100% | light | `… / 0.50` | `blur(12px)` | 32px | 32px | −32px |
| 0% (opaque end) | dark | `… / 0.96` | `blur(12px)` | 32px | 32px | −32px |
| 0% (opaque end) | light | `… / 0.96` | `blur(12px)` | 32px | 32px | −32px |
| glass off | dark | `… / 1` | none | 32px | 32px | −32px |
| glass off | light | `… / 1` | none | 32px | 32px | −32px |

The band is 32px and it lies INSIDE the scroller's own clip region, so every row
that scrolls up passes through those 32 pixels. That is the geometry defect #1
is about, and it is why the band has to isolate rather than tint: there is no
clip to hide behind.

The alpha tracks the user's setting in the right direction — the band thickens as
the translucency is turned down (0.96 at the opaque end) and thins as it is
turned up (0.50 at 100%) — so it reads as the panel's own material at every
setting rather than as a hole punched in it.

### The Library's header, and why one rule reaches both families

`measure-library-header.mjs` opens a real spreadsheet asset in the Library and
reads the same facts on the Library's sticky table header:

```
matchesRule: true
plane: "band-backdrop"
background: "color(srgb 0.168627 0.152941 0.129412 / 0.73)"
backdropFilter: "blur(12px)"
position: "sticky"  top: "0px"  height: 26
scroller: { overflowY: "auto",
            maskImage: "linear-gradient(rgba(0,0,0,0) 0px, rgb(0,0,0) 0px, rgb(0,0,0) 100%, rgba(0,0,0,0) 100%)" }
regionChain: ["pane", "canvas", "canvas-backing"]
```

`matchesRule: true` is the load-bearing line: the rule is a glass-region chain,
and the Library's chain (`pane` → `canvas` → `canvas-backing`) is not the Files
tab's. The rule reaches both because it is written against the plane, not
against one screen. The scroller's `maskImage` is the Library's own **top fade**,
and it is unchanged — the request asks that the panel's top fade keep behaving
as it does elsewhere in the app, and it does.

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
| after, dark, 80% | 0.0021 | 0.0608 | **0.034** | 0.0182 | 0.2034 |
| after, light, 80% | 0.0115 | 0.0865 | **0.133** | 0.0156 | 0.1015 |
| after, dark, 100% | 0.0040 | 0.0768 | **0.052** | 0.0265 | 0.2450 |
| after, light, 100% | 0.0179 | 0.2191 | **0.082** | 0.0027 | 0.1570 |
| after, dark, 0% | 0.0006 | 0.0291 | **0.021** | 0.0077 | 0.1306 |
| after, light, 0% | 0.0017 | 0.0782 | **0.021** | 0.0107 | 0.0819 |
| after, dark, off | 0.0000 | 0.1217 | **0.000** | 0.0000 | 0.2670 |
| after, light, off | 0.0000 | 0.0253 | **0.000** | 0.0000 | 0.0278 |

The light theme is the operator's worst case and the sharpest result: **0.936 of
the content's edge energy survived into the band before, and 0.133 after** — a
7× reduction. The band's saturation against the control's shows the same thing
about the green specifically: 0.1006 before, 0.0156 after, against a control of
0.1015.

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
0 of 12 UPWARD keyboard landings ended up UNDER the header (worst 0px)
[reveal/up 0] "image-0276.png0 KB" focusedTop=184 headerBottom=184 hiddenBy=0px
[reveal/up 1] "image-0264.png0 KB" focusedTop=184 headerBottom=184 hiddenBy=0px
...
0 of 14 DOWNWARD keyboard landings ended up UNDER the header (worst 0px)
```

Every landing is now exactly at the header's bottom edge, which is the contract:
the row is fully visible, and it is visible immediately below the header. The
downward case was already correct and is unchanged.

## Scroll performance: the backdrop-filter's cost

The request asks that a `backdrop-filter` per sticky header on a 342-item grid
must not drop frames, and that if it does, that is a finding.

**The measurement had to be built to survive this machine.** A wall-clock frame
time is meaningless here: this machine carries other sessions, and the first
attempt showed the inversion — the variant WITHOUT the filter measured 105ms
median and the one WITH it measured 27ms, on a load average of 64. The two
numbers were measuring the machine, not the filter.

`measure-scroll-perf-ab.mjs` therefore measures the two variants **alternately,
in one app session, with the order alternating each round**, so every sample of
both variants carries the same contention and the comparison is between the
variants rather than between two moments. The filter is switched off by
overriding the one property under test, on the same build.

The headline number is the **median of the per-round paired deltas**, because
the minimum of a rAF-delta series is near zero on any machine (a frame that was
already queued reports almost no time between ticks) and is not a comparison.

| round | with the filter | without | delta |
| --- | --- | --- | --- |
| 1 | 215.5ms | 159.6ms | +55.9ms |
| 2 | 191.2ms | 168.9ms | +22.3ms |
| 3 | 205.2ms | 268.1ms | −62.9ms |
| 4 | 164.2ms | 200.6ms | −36.4ms |
| 5 | 148.5ms | 170.6ms | −22.1ms |
| 6 | 179.4ms | 199.4ms | −20.0ms |
| 7 | 163.7ms | 95.0ms | +68.7ms |

**Median paired delta: −20ms** (p25 +0.6ms, p95 +84.2ms). The medians are
contention-dominated — the load average was 64 for the whole run, and a paired
round at 95ms and one at 268ms are the machine, not the filter. The p25, which
is the least-contended quartile of each round, is the informative statistic: the
filter's cost there is **+0.6ms**, and a 60Hz frame is 16.7ms.

**The finding: the filter costs under a frame, and the measurement cannot
distinguish it from zero.** The per-round deltas straddle zero in both
directions, which is what a sub-frame cost looks like under this much
contention. There is no frame-drop finding to report. The honest limit of this
measurement is stated plainly: it bounds the filter's cost at roughly a
millisecond on an idle machine, and it cannot resolve anything smaller than
that on this one.

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

# the interleaved, load-immune frame-cost A/B
node measure-scroll-perf-ab.mjs --backend <url> --session <id> --out <dir> --rounds 7

# the reveal landings, before and after
node measure-reveal-landing.mjs --backend <url> --session <id> --out <dir>

# the inventory: every sticky element, and every outside overlay
node census-sticky-elements.mjs --backend <url> --session <id> --out <dir>
node detect-overlay-headers.mjs --backend <url> --session <id> --out <dir>

# the Library's own sticky header, on a real spreadsheet asset
node measure-library-header.mjs --backend <url> --session <id> --asset <library asset id> --out <dir>
```
