# The child reader's tail follow, and its missing affordance

Two arms of one rig, both brand themes, seven states each — the run pane's child
reader while a child streams, measured and photographed from the shipped
component.

```
<arm>/<state>/<theme>.webp      e.g. after/scrolled-up/localOperatorDark.webp
```

Arms: `before` (the shipped head, no affordance) and `after` (the same head with
the scroll-to-bottom control).

States: `anchored` (rows arrived while at the tail), `scrolled-up` (a reading
position, with rows still arriving), `scrolled-up-after-batches` (the same
position two arrivals later), `at-tail` (back at the bottom), `drifted` (a reader
a few pixels off the tail), `drifted-then-batch` (an arrival for that reader),
`settled` (the child has stopped).

## What produced them

```sh
node scripts/child-reader-scroll-evidence.mjs --arm=after --frames \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/after-readings.json
# and, for the before arm, with the reader taken back to `HEAD`:
git stash push -- src/renderer/src/features/chat/components/run-details/run-child-reader.tsx
node scripts/child-reader-scroll-evidence.mjs --arm=before --frames \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/before-readings.json
git stash pop
```

Each run prints the readings it took AND writes them as JSON — `after-readings.json`
and `before-readings.json` are committed here, and the tables below are those
files. Both runs also print the MD5 of every module under test, which is how a
reader ties a frame to the bytes it is a picture of:

| module | before arm | after arm |
|---|---|---|
| `run-child-reader.tsx` | `8c68061ca3ab` | `d0df22798aef` |
| `canonical-transcript.tsx` | `8a590b414a9c` | `8a590b414a9c` |
| `use-scroll-paging.ts` | `042ae70a3c22` | `042ae70a3c22` |
| `scroll-paging.ts` | `4e32a82e085c` | `4e32a82e085c` |

Row one is the change; rows two to four are the scroll machinery, identical in
both arms, which is the branch's claim that it does not touch it.

The rig starts a private Vite server, a private `--headless=new` Chrome (routed
through `scripts/chrome-keychain.mjs`) and drives the page over raw CDP; both
processes are reaped on the way out and the frames are written by
`Page.captureScreenshot`. It prints a reading per step and writes the same
readings as JSON, which is what the tables below are.
## What is real, and what is not

**Real**: `RunChildReader` and everything under it — `useChildTranscript`'s tail
read and its pulse cadence, `applyHistoryPage`, `CanonicalTranscript`,
`useScrollPaging`, the app stylesheet, `desktopResult` → `desktopRequest` → its
same-origin `POST /__desktop` branch, and the browser's own `column-reverse`
overflow anchor.

**Scripted**: the BACKEND behind `/__desktop`
(`child-reader-scroll-evidence.vite.mjs` answers one op, `subagents.transcript`,
from a list of rows the driver grows a batch at a time), and the row the pane
would derive from the parent's roster — the roster is the parent's, and the
parent has no backend here. A batch is written to the scripted child and THEN the
`pulse` prop is bumped, which is the wire's own order, so rows reach the pane
through the shipped read path rather than through its state.

**Not covered here**: the wire itself — a real child process writing a real file
and relaying `subagent_progress`. That half is
`docs/evidence/chat-run-panel-live/`'s subject.

## The readings

Both arms, `localOperatorDark`, 900x900, one run of the rig per arm; the two
themes agree step for step. `top` is `scrollTop`, `fromTail` is `|scrollTop|`
this scroller's distance from its bottom edge (it is `column-reverse`, so the
origin is the tail), `cut` is how many pixels of the NEWEST row fall below the
viewport's bottom edge, and `btn` is the control's presence.

| step | arm | top | fromTail | cut | anchor | btn |
|---|---|---|---|---|---|---|
| A0 at the tail | before / after | 0 / 0 | 0 / 0 | 0.0 / 0.0 | `tool:call-018` | absent / off |
| A1 after a batch | before / after | 0 / 0 | 0 / 0 | 0.0 / 0.0 | `tool:call-019` | absent / off |
| A2 after a batch | before / after | 0 / 0 | 0 / 0 | 0.0 / 0.0 | `tool:call-020` | absent / off |
| A3 after a batch | before / after | 0 / 0 | 0 / 0 | 0.0 / 0.0 | `tool:call-021` | absent / off |
| B0 scrolled up | before / after | -600 / -600 | 600 / 600 | 558.6 / 558.6 | `entry-assistant-19` | absent / **on** |
| B1 after a batch | before / after | -868 / -868 | 868 / 868 | 826.6 / 826.6 | `entry-assistant-19` | absent / **on** |
| B2 after a batch | before / after | -1114 / -1114 | 1114 / 1114 | 1072.6 / 1072.6 | `entry-assistant-19` | absent / **on** |
| C1 back at the tail | before / after | 0 / 0 | 0 / 0 | 0.0 / 0.0 | `tool:call-023` | absent / off/inert |
| E0 3px off the tail | before / after | -3 / -3 | 3 / 3 | 0.0 / 0.0 | `tool:call-023` | absent / off |
| E1 after a batch | before / after | -3 / -3 | 3 / 3 | 0.0 / 0.0 | `entry-assistant-24` | absent / off |
| E2 after a second batch | before / after | -3 / -3 | 3 / 3 | 0.0 / 0.0 | `tool:call-025` | absent / off |
| D0 settled | before / after | -3 / -3 | 3 / 3 | 0.0 / 0.0 | `tool:call-025` | absent / off |
| D1 six seconds later | before / after | -3 / -3 | 3 / 3 | 0.0 / 0.0 | `tool:call-025` | absent / off |

Read three ways:

- **A reader at the tail stays at the tail.** `A0`–`A3` are the origin across
  three consecutive arrivals: `scrollTop` does not move and not one pixel of the
  newest row falls below the fold. **This is a property of the shipped head and
  it holds** — the change below does not touch it, and the before arm measures
  the same numbers.
- **A reader who scrolled up is not yanked.** `B0`–`B2`: the anchored row
  (`entry-assistant-19`) keeps its viewport offset to within 0.6px while the
  extent grows by 518px under it, and the newest row is 558.6–1072.6px below the
  fold — where it belongs, because that reader is reading earlier rows.
- **A reader a few pixels off the tail is not left behind either.** `E0`–`E2`
  place the offset 3px off the origin (inside `TAIL_EPS_PX` of 24, the product's
  own definition of following the tail) and deliver two arrivals: the offset
  stays at 3px and `cut` stays 0.0, so neither batch lands below the fold. The
  content shifts under a stationary offset — the `anchor` column shows the
  topmost visible row changing — but the arrival is on screen, which is the
  question.
- **A settled child is quiet.** `D0` → `D1`: the route's read count is unchanged
  across six seconds (50 → 50 before, 51 → 51 after), so no timer is left
  running on a child that has stopped.

### The affordance, which is what the arms differ by

`btn` is the whole of the delta: absent in every before state, `on` while the
reader is scrolled up, and `off/inert` at the tail — hidden AND not a hit target,
which is the trap `scroll-to-bottom-button.tsx` documents and which the rig
asserts (`hitTestable` is read from `computedStyle`, not from the prop). The
reader had no control here at all before this branch: `useScrollToBottom` was
instantiated by the chat page against the chat page's own scroller
(`chat-page.tsx`), and the button was mounted in the composer band
(`message-input.tsx`), so the reader — a pane with its own scroller and no
composer — registered nothing and offered nothing.

### Why the before arm still exists

The tail-follow readings are identical in both arms BY DESIGN: this branch fixes
the missing control, not the scroll behaviour, and the arms are committed as a
pair so a reader can see that the second claim is not being smuggled in with the
first. The `Reviewer`/`Scope` record on the pull request says the same.

### A failing shape this rig does NOT reproduce, and does not claim to

A bare scroller carrying this scroller's exact declarations — `column-reverse`,
`display: flex`, `overflow: auto`, `scrollbar-gutter: stable both-edges`,
`overflow-anchor: auto`, `padding: 1rem` — DOES lose the tail: at `scrollTop`
-3, appending three rows of 48px moved the offset to -147 (and -267 in a repeat
with 80px rows), leaving the newest row 144–268px below the fold, delay-independent
(the same at 0ms, 200ms and 1000ms between the placement and the append). That is
the shape the operator's report describes, and it is why the near-tail state `E`
is in this set. **On this tree it does not occur**: at the same offset the
arrivals land on screen (`cut` 0.0). Whatever differs between the two is in the
app's own DOM and is NOT isolated here, so nothing in this set should be read as
an explanation of a report that no longer reproduces after #478 — it is the
measurement of the behaviour as shipped, which is what the review asked for.

## Provenance

`manifest.json` declares both directories as `supplementary` with their own
`source`. They cannot be re-derived by `pnpm capture-evidence`: the subject is a
scroller's behaviour over time, which a story's static fixture cannot produce —
the reader's `previewPage` seam seeds its transcript once and makes no request
(`run-child-reader.tsx`), so an arrival cannot be delivered through it.

The scripted child's rows are the story fixtures' own shape
(`run-details.fixtures.ts`'s `entry()`), and its epoch is taken from the run
(`child-reader-scroll-evidence.vite.mjs`), so the rows' timestamps and the
reader's elapsed label describe the same moment.
