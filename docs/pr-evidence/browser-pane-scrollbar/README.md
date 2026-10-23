# The splitter's grab band sat on the transcript's scrollbar

The operator's report (2026-10-23): with the browser panel open, the scrollbar of
the pane beside it could not be grabbed — dragging where the bar is painted
resized the browser panel instead. The screenshot that came with the report shows
the bar flush against the divider.

Both frames here are the same scene — the same isolated daemon, the same
40-turn conversation, the same window (1380x900), the browser panel opened by a
press on the header's trigger — on two source trees: `origin/main` (before) and
`fix/browser-pane-scrollbar` (after). The pointer is resting on the **middle of
the painted scrollbar thumb** in both.

| frame | reading |
| --- | --- |
| `before.png` | the thumb (light rounded bar) is flush against the seam and the divider's state line is **lit** down the full height — the splitter owns the pixel the pointer is on |
| `after.png` | the thumb sits 8px clear of the seam and the line is **dark** — the pointer is the scroller's |
| `before-full.png`, `after-full.png` | the same two frames whole, so the seam can be seen in the window rather than alone |

## The repro, as steps

1. Open a conversation with more content than the pane can show (here: 40 turns,
   `scripts/transcript-rail-fixture.mjs`, served by a run-owned daemon).
2. Open the browser panel — the chat header's Globe trigger.
3. Try to drag the left pane's scrollbar: press on the painted thumb and move.

**Where the grab switches, in pixels** (x measured from the window's left edge,
same window and same pane width in both runs; read with
`document.elementFromPoint` on one row, y=438, because both the band and the
scroller are full-height):

| x | `origin/main` | `fix/browser-pane-scrollbar` |
| --- | --- | --- |
| 716 – 723 | transcript (not sampled: the base scan began at 724) | transcript |
| 724 – 731 | transcript | **transcript** (the whole 8px bar) |
| 732 – 733 | transcript (all that was left of the bar) | the chat column's empty seam inset |
| 734 – 745 | **the splitter** | **the splitter** |
| 746 – 748 | the browser pane | the browser pane |

So on `origin/main` the switch happened at **734** — six pixels inside the bar's
own 8px band (732–739), leaving a two-pixel sliver. After the fix the bar is
724–731 and the splitter's band begins at 734, two pixels clear of it.

The seam is at 740. The splitter's band is 12px wide, centred on it
(`resizable-divider.tsx`: `w-3` at `-left-1.5`), so it reaches 6px into the
column — and the transcript's scrollbar is 8px wide
(`global-scrollbar-styles.tsx`) and sat flush against that seam.

## The gestures, driven by a real pointer

`document.elementFromPoint` says which element would receive a press; these rows
are the press itself, dispatched over CDP at the thumb's own y (the painted thumb
spans y 671–803 in this state):

| gesture | `origin/main` | `fix/browser-pane-scrollbar` |
| --- | --- | --- |
| press the thumb and drag it up 90px | transcript `scrollTop` 0 → 0 (**did not move**); the splitter consumed the press and wrote the shared slot width (0 → 596) | transcript `scrollTop` 0 → **−496.5** (it scrolled); the slot store untouched |
| press at x=736 — inside the old bar | panel 596 → 536 | panel 596 → 536 (736 is now squarely the splitter's own band) |
| press on the drawn line, x=741 | panel 596 → 536 | panel 596 → 536 |
| pointer resting on the thumb | divider line `opacity: 1` (lit) | divider line `opacity: 0` |

Both behaviours hold after the fix: **the scrollbar scrolls** when grabbed, and
**the splitter still resizes** from its band and from its line. The splitter's
live chat-side reach is unchanged at 6px — it simply sits on empty seam now
instead of on the bar.

## What changed

| file | change |
| --- | --- |
| `src/renderer/src/features/chat/components/chat-content.tsx` | `rightPaneDocked` — read from the same open-flags the row's dividers are drawn from (`isCanvasOpen && canvasDocked`, `sessionAsksOpen && canvasDocked`, and the four panes) — puts 8px (`pr-2`) on the chat column's inner surface; the column's own box, which the right pane's capacity arithmetic measures against, is untouched |
| `scripts/chat-pane-floors.test.mjs` | pins the relation (band reach 6 < inset 8, the band centred) and the gate's DEFINITION — the canvas families must carry their open flag, not `canvasDocked` alone — and fails on `origin/main` |

The band's other half could not carry the target instead: the pane beside the
column hosts a native `WebContentsView`, and a native view paints above all DOM
(`browser-view-policy.ts`), so the pane-side 6px is dead wherever a page is
showing. The live half has to be on the chat side, which is why the bar moves off
it rather than the band moving over.

## With no pane open, nothing moves

The inset is earned by a separator that is actually drawn, and review round 1
caught the first version of that gate being wrong: `canvasDocked` alone says the
ROW is wide enough to dock a canvas, which is true with every pane closed, so the
inset applied to every chat on a wide window. The gate now carries the two canvas
families' open flags (`isCanvasOpen`, `sessionAsksOpen`), and the undocked arm is
checked rather than assumed: with the browser panel closed, the computed
`padding-right` is 0px, the scrollbar's band is 1328–1335, and `[role=log]` spans
260–1336 on both trees. The two undocked frames differ in 130 pixels of 4.97 M —
a 12x17 glyph in the sidebar's own time label, not the seam.

## What these frames cannot show

- They are a still pair, not a recording: the drag rows above are the movement.
- The pane in these runs is on its start page (DOM). With a real page the
  `WebContentsView` covers the pane's full width — measured in this state, the
  view's rect is the slot's own rect (x 740, w 596), which is what makes the
  pane-side half of the band unavailable rather than a second target.
- The transcript is synthetic (`transcript-rail-fixture.mjs` rows served by a real
  daemon), so the frames are evidence about geometry and hit-testing, not about
  any particular conversation.

## Reproducing the pair

Two worktrees off the same `origin/main` (base and head), one run-owned daemon, a
fresh Electron profile per run (the pane width is a stored preference, so a reuse
would start the pair at different widths):

```bash
# the daemon: an isolated config root, its own token, a free port - never 1111
LOCAL_OPERATOR_CONFIG_DIR=<rig>/config LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  <local-operator checkout>/.venv/bin/local-operator serve \
  --host 127.0.0.1 --port <port> --hosting test --model mock-model

# the conversation, written into that config root before the daemon starts
node scripts/transcript-rail-fixture.mjs <rig>/config 40

# both trees built against the daemon's URL, then booted headless with the
# renderer dev driver armed; the probe navigates to /chat/<id>, presses
# [data-tour-tag="browser-pane-trigger"], and then reads the DOM and drives the
# pointer. The probe itself is a session rig, not committed: it is the same
# mechanisms `scripts/renderer-driver.mjs` uses (headless window mode, the
# `__loDevDriver` verbs, CDP input, `capturePage()` for pixels).
```
