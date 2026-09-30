# The scrollbar fade — rendered evidence

Seventeen frames from `scripts/renderer-driver.mjs`'s `--scene scrollbar-fade`,
plus the design material this change was written against. The claim the set
exists for is the one a green unit test cannot make: **`--lo-sb: 1` puts the
thumb's own colour on the glass and `--lo-sb: 0` puts nothing there, in the app's
own Chromium, at the geometry the app ships** — read out of the frames' pixels, in
the bar's own strip, exactly the way `docs/design/scrollbars-fade.md` § 1.1
measured the defect this change removes.

## Head under test

**`d9f06c0349`** — the head this branch now carries, and the head the set
describes. Its history, all of which is in the tree these frames came from:

- `c8a0f6c834` — the implementation,
- five folds of `origin/main` while the review ran (`d6cdf9197d`, `07a6b0a6a6`,
  `961887cf7c` — the 0.31.25 version line — `0db7dcb416`/`eab6e32b2d`, the
  markdown-table widths, and `dad1778e14`/`ace2ffcb7f`, the chat move control),
- `853b1a207d` — review round 1's remediation (the keyboard cue, the structural
  undo-scope guard, the positive-only caches),
- `a3836c78a9` — the design note's own reconciliation, and
- `d9f06c0349` — the transition census extended to the cascading sheets.

**The frames were re-run after every fold and came back byte-identical**, so one
set describes all of them: none of the trains main carried in changes the two
surfaces this scene measures (the command palette's list and the browser page's
tab strip). The scene has been run five times across these heads and **all
seventeen frames are byte-identical in every run** (`sha256` per file), and it
passes **67 checks, 0 FAIL** with no process outliving its boot.

```bash
git rev-parse --short HEAD                          # a3836c78a9
git rev-parse HEAD:src HEAD:scripts                 # the manifest's own stamps
```

## The run

```bash
# 1. the app, built at this head. NOTE: `VITE_PUBLIC_POSTHOG_HOST` cannot be
#    empty in a build — a tree built from the stock .env.template throws
#    `Configuration validation failed: VITE_PUBLIC_POSTHOG_HOST: PostHog host
#    must be a valid URL` in the renderer BEFORE the first render, the window
#    stays blank and the driver waits out its 90s bridge timeout with no
#    console output to explain it (measured twice on 2026-09-30).
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:1111 \
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=common \
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  node ./node_modules/electron-vite/bin/electron-vite.js build

# 2. the scene. No backend: this run's transport is pointed at a port the script
#    verified dead, so every frame is publishable by construction.
node scripts/renderer-driver.mjs --scene scrollbar-fade \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/frames" --clean
```

`transcript/scrollbar-fade-run.log` is that run's complete output, verbatim:
every check with its own reading, the scroller census (with each scroller's
`tabIndex`), the arms' JSON, the listener inventory and the perf numbers quoted
below.

## What the scene proves, and how

It picks, per axis, the scroller with the most overflow that is fully inside the
viewport, records who that was (tag, class, box — below), and holds it as a page
reference so every later read is of the same element. Then, per axis, **three
acts** plus two single-surface arms:

- **the scroll act** — the resting state; a real wheel through Chromium's own
  input pipeline (`Input.dispatchMouseEvent`); the state and the pixels while
  awake; a burst of twelve more wheels inside the hold; and the state and pixels
  again once the hold has expired;
- **the hover act** — the pointer parked away and the hold waited out; a real
  `mouseMoved` onto the bar's own strip (4 CSS px inside the element's edge, at
  the middle of its length); the state and pixels while awake **with nothing
  scrolled**; then the pointer away and the fade read again;
- **the keyboard arm** (vertical) — the pointer parked and the hold waited out,
  then a `focus({ focusVisible: true })` on the scroller **cold**, before any
  pointer or wheel has touched it: the state and pixels while awake, the element's
  `animation-name` read before and after, and the state and pixels again at
  +2.6 s;
- **the thumb arm** (vertical) — the pointer moved onto the *thumb's own band*
  (its geometry computed from the element: track, content, viewport, offset) and
  parked there past the hold, read three times;
- and the media arms, whose readings are computed-style ones and are labelled as
  such below.

### The two surfaces

| Axis | Surface | Box (CSS px) | Overflow |
| --- | --- | --- | --- |
| vertical | the command palette's result list (`#command-palette-results`, `max-h-96 overflow-y-auto p-2`) | 638×384 at 371,266 | 324 px |
| horizontal | the browser page's tab strip, 13 tabs open (`overflow-x-auto overflow-y-hidden`) | 1039×41 at 268,36 | 924 px |

Neither is a stand-in. The vertical one is the surface § 1.1 read the defect out
of (its committed before frame is this palette's browse state), and the horizontal
one is the app's own tab strip with real tabs in it.

### The pixel readings

`near` counts pixels within ±20 per channel of `--color-control`, the thumb's own
role; the window is the bar's own strip — 4 CSS px wide, inset 1 px from the
element's edge — in the frame's device pixels.

| Axis | Arm | Frame | Pixels sampled | `near` | Strip mean RGB |
| --- | --- | --- | --- | --- | --- |
| vertical | scroll | `after/vertical-idle-dark.png` | 5888 | **0** | 50,45,34 |
| vertical | scroll | `after/vertical-active-dark.png` | 5888 | **3041** (52%) | 93,87,74 |
| vertical | scroll | `after/vertical-idle-after-dark.png` | 5888 | **0** | 50,45,34 |
| vertical | hover | `after/vertical-hover-idle-dark.png` | 5888 | **0** | 50,45,34 |
| vertical | hover | `after/vertical-hover-dark.png` | 5888 | **3041** (52%) | 93,87,74 |
| vertical | hover | `after/vertical-hover-after-dark.png` | 5888 | **0** | 50,45,34 |
| vertical | **keyboard** | `after/vertical-focus-dark.png` | 5888 | **3193** (54%) | — |
| vertical | keyboard | `after/vertical-focus-after-dark.png` | 5888 | **0** | — |
| vertical | **thumb band** | `after/vertical-thumbrest-dark.png` | 3216 | **0** | 50,45,34 |
| vertical | thumb band | `after/vertical-thumbhover-dark.png` | 3216 | **3041** (95%) | 129,122,107 |
| vertical | thumb band | `after/vertical-thumbheld-dark.png` | 3216 | **3041** (95%) | 129,122,107 |
| horizontal | scroll | `after/horizontal-idle-dark.png` | 16368 | **0** | 29,27,25 |
| horizontal | scroll | `after/horizontal-active-dark.png` | 16368 | **8790** (54%) | 84,79,70 |
| horizontal | scroll | `after/horizontal-idle-after-dark.png` | 16368 | **0** | 29,27,25 |
| horizontal | hover | `after/horizontal-hover-idle-dark.png` | 16368 | **0** | 29,27,25 |
| horizontal | hover | `after/horizontal-hover-dark.png` | 16368 | **8667** (53%) | 83,78,69 |
| horizontal | hover | `after/horizontal-hover-after-dark.png` | 16368 | **0** | 29,27,25 |

Three things this table is for, beyond the colours being there and then not:

- **the keyboard arm's reveal is a keyboard reveal.** It is run cold: the
  attribute is `null` before the focus and `scrollTop` is **0** in the awake
  frame, so the bar appears because the reader arrived, not because anything
  moved. That is the case review round 1 (M1 / Q1 / D1 / U1) measured the old
  CSS rule failing: `animationName: none`, `--lo-sb: 0` for the same cold focus.
- **the thumb band holds past the hold.** With the pointer parked on the thumb
  and the state at `idle` / `--lo-sb: 0`, 3041 of 3216 pixels in the thumb's own
  band are still the thumb's colour — the native `:hover` — which is the reading
  design round 1's D3 asked for and could not get from a fixture (their pointer
  was on the strip, not on the thumb). A reader reaching for the thumb does not
  lose it.
- **the `idle` and `idle-after` means are identical to the byte** on each axis,
  which is the fade being complete rather than merely faint.

### The frames, in one list

**Vertical** (the command palette's result list): [idle](after/vertical-idle-dark.png) ·
[scrolled](after/vertical-active-dark.png) · [idle after the hold](after/vertical-idle-after-dark.png) ·
[hover-idle](after/vertical-hover-idle-dark.png) · [hovered](after/vertical-hover-dark.png) ·
[hover-after](after/vertical-hover-after-dark.png) ·
[**keyboard**](after/vertical-focus-dark.png) · [keyboard-after](after/vertical-focus-after-dark.png) ·
[thumb at rest](after/vertical-thumbrest-dark.png) · [thumb under the pointer](after/vertical-thumbhover-dark.png) ·
[thumb past the hold, pointer still on it](after/vertical-thumbheld-dark.png)

**Horizontal** (the browser page's tab strip): [idle](after/horizontal-idle-dark.png) ·
[scrolled](after/horizontal-active-dark.png) · [idle after the hold](after/horizontal-idle-after-dark.png) ·
[hover-idle](after/horizontal-hover-idle-dark.png) · [hovered](after/horizontal-hover-dark.png) ·
[hover-after](after/horizontal-hover-after-dark.png)

Every one of those files is byte-identical across the three runs of this head.

### The state each frame was taken in

| Axis | Frame | `data-lo-scrollbar` | `--lo-sb` | Bar box | Scroll offset |
| --- | --- | --- | --- | --- | --- |
| vertical | idle | `idle` | 0 | 8 px wide | 0 |
| vertical | active | `active` | 1 | 8 px wide | 324 (end) |
| vertical | idle-after | `idle` | 0 | 8 px wide | 324 |
| vertical | hover-idle | `idle` | 0 | 8 px wide | 324 |
| vertical | hover | `active` | 1 | 8 px wide | 324 |
| vertical | hover-after | `idle` | 0 | 8 px wide | 324 |
| vertical | focus (keyboard) | `active` | 1 | 8 px wide | **0** |
| vertical | focus-after | `idle` | 0 | 8 px wide | 0 |
| vertical | thumb-hover / thumb-held | `active` / `idle` | 1 / **0** | 8 px wide | 324 |
| horizontal | idle | `idle` | 0 | 8 px tall | 924 (end) |
| horizontal | active | `active` | 1 | 8 px tall | 504 |
| horizontal | idle-after | `idle` | 0 | 8 px tall | 0 |
| horizontal | hover-idle | `idle` | 0 | 8 px tall | 0 |
| horizontal | hover | `active` | 1 | 8 px tall | 0 |
| horizontal | hover-after | `idle` | 0 | 8 px tall | 0 |

**The bar's geometry is identical in every state** (8 px on the axis it occupies,
`barWidth`/`barHeight` read from the element each time) — the gutter does not move
when the thumb appears or leaves, which is requirement "no layout shift" measured
rather than asserted.

### The no-flicker rule, and the write discipline

The twelve-wheel bursts inside the hold wrote the attribute **zero times** on both
axes, with the same `MutationObserver`-based watcher armed on the scroller: a
write per event would restart the transition, and that restart is the flicker the
operator reported. The attribute is written **once, at the first event of a
sequence** — that is the whole mechanism, so a streaming transcript that re-renders
under a mid-stream `scroll` cannot re-trigger it per frame: the burst's
zero-writes reading is the measurement of exactly that property.

### Performance

| Reading | Value |
| --- | --- |
| 300 wheel events, deltas from `Performance.getMetrics` | `ScriptDuration` **50 ms**, `TaskDuration` 347 ms, `RecalcStyleCount` 17, `LayoutCount` 2 |
| the fade's own window (one timer expiry + one fade-out, 2700 ms with **no input in it**) | `RecalcStyleCount` 23, `LayoutCount` **0**, `ScriptDuration` 3.2 ms |
| document listeners of the module's four types | `scroll` capture+passive ×1, `pointerover` capture+passive ×1, `pointerdown` capture+passive ×1, `focusin` capture+passive ×1 — plus one non-capture `pointerdown` that is **not** this change's (Radix's dismissable layer) |

The 300-wheel row is *not* asserted at zero layout: it moved 0, 0 and 2 across
three runs of the same head, which is the palette re-rendering rows as they
scroll. The asserted claim is the fade's own window — the module's timer, with
nobody touching anything — and the geometry table above.

The architect memo's probe numbers for the same mechanism (a synthetic page):
300 wheel events cost `ScriptDuration` 2.5–2.8 ms against 0.0 without the module,
`LayoutCount` 0 in both, ~49 recalcs / 4.5 ms per fade. This set's numbers are the
app's own, and the two agree on the shape: no layout, and scripting that is a
rounding error against the scroll it is measuring.

### What the media arms read (computed style, not pixels)

| Arm | Reading |
| --- | --- |
| `prefers-reduced-motion: reduce` | the capped `transition-duration` and a `--lo-sb` that steps `0 → 1` with no intermediate value sampled: "the reveal is a step" is the reading, not the promise |
| `forced-colors: active` | `--lo-sb` pinned at `1` **while the attribute says `idle`** — the fade is suppressed and the bar is solid. The memo's probe already measured that the platform overrides the thumb's colour in forced colours (red channel 0), so a pixel reading there would be about the system palette, not about this change |

### The seams this set knows about

- **A scroller with nothing to scroll is still marked.** The module tests computed
  `overflow`, so an `overflow: auto` element with no overflow gets
  `data-lo-scrollbar="active"` on a hover (design review round 1, Q7). It paints
  nothing — its bar has no length — and the alternative, `scrollHeight >
  clientHeight`, is a layout read inside a handler that fires for every element
  the pointer crosses. Recorded as the honest version of a claim that used to say
  the opposite.
- **Main's new markdown-table wrapper inherits the mechanism, and declares no
  transition of its own.** `div.lo-md-table-scroll` (`markdown-table.tsx:50`,
  `markdown.css:406`) arrived with #712 and is a scroller by CSS
  (`overflow-x: auto`) — the census that guards the "a scroller with its own
  transition list collapses the fade to a pop" risk now reads the cascading sheets
  as well as the class lists, and its answer at this head is empty. That wrapper
  is one of the surfaces the note lists as "not on main" (§ 9.10), so it inherits
  the shared mechanism with no per-surface work; it is not in this set's frames
  (they need a transcript, a table and a live backend).
- **A non-overflowing `overflow: auto` ancestor takes the hover for the scroller
  above it.** Every `<pre>` in the transcript is one, so hovering a code block
  does not reveal the transcript's own bar (a wheel still does — the `scroll`
  event lands on the log). Skipping it would need the same layout read Q7
  rejects; the note records it as deferred (U5).
- **The palette's own bottom scrim paints over the last ~24 CSS px of the revealed
  thumb.** It predates this change and the idle state hides nothing; recorded as
  pre-existing (D5), not as a fade defect.
- **The transcript itself is not photographed here, and the reason is the rig, not
  the claim.** A backend-less app has no session, so the transcript's scroller
  (`role="log"`, `tabIndex=0`) never mounts; its cold-Tab behaviour and its
  scroll-linked top fade are pinned by the unit suite's cold-focus and
  non-collision tests, and were walked live with an isolated `lop serve` by the UX
  and QA rounds. This set's residual risk is therefore stated plainly: the widest
  real scroller in the app is measured by other means, and this branch's frames do
  not contain it.

## The material this was written against (`before/`, `proposal/`)

- **`before/`** — the designer's before set, copied verbatim from her scratch
  tree (`palette/` is the app's own build at the base commit `a298bfb120`:
  `palette-browse-dark.png` is the frame § 1.1 reads the thumb out of — 8 CSS px
  wide, 208 CSS px tall, `--color-control`, on screen with no pointer in the page
  and nothing scrolled; `storybook/` are the Storybook frames recorded for what
  they are, with a DOM scan showing those screens do not overflow at 1280×900).
- **`proposal/`** — the note's standalone proposal renders (`a-transcript.html`,
  `b-sidebar-board.html`, `c-horizontal-and-optouts.html`, `proposal.css`) with
  the settled mechanism and frozen states, plus the stills taken from them. Their
  load-bearing caveat, as the note states it: the tiles' own engine-painted bar
  did not appear in the browser capture (the macOS host served overlay scrollbars
  where the app's Electron renderer serves the styled classic bar), so those
  stills carry layout and labels, **not** the bar's paint.

Nothing in `before/` or `proposal/` was edited. They are here so the pair lives in
one place.

## Seeing the bar yourself

The committed frames are full 2760×1800 stills; the bar is a 16-device-px band at
the scroller's edge. Two crops make it unmistakable:

```bash
# any image tool: extract LEFT TOP WIDTH HEIGHT
# vertical: the palette's right edge, x 1860–2060, y 500–1320
# horizontal: the tab strip's foot, x 520–1720, y 110–170
```

## What was NOT observed

**No Windows or Linux run of any kind.** No claim about their pixels is a
measurement here. The parity argument (`::-webkit-scrollbar` is painted by the
same Blink code path, and a styled width already replaces the platform's overlay
bar — which this app already did before this change) is an argument, not evidence;
`docs/design/scrollbars-fade.md` § 4 specifies the CI probe on `ubuntu-latest` and
the manual Windows checklist that would turn it into one.

**The mini-view window is not photographed here.** It mounts neither
`GlobalScrollbarStyles` nor the activity module (checked at this head), so its own
document is unchanged by this change.

**CodeMirror and the ag-grid internals are not photographed either.** Both need a
canvas document and therefore a live backend; the scene measures the app's own
surfaces without one, and says so rather than implying coverage.

**The transcript, as above** — the one surface whose absence is a stated residual
risk rather than a decision about scope.
