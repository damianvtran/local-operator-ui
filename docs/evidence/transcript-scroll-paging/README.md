# Scroll-driven history paging

Older conversation used to require a click on `Load earlier messages`. It now
loads when the reader scrolls toward the top, coalesced, debounced, latched, and
with the reader's place held.

These are the numbers this branch actually measured, the gaps it did not close,
and the recipe to reproduce both. Round 1 of this PR reported a measurement it
could not justify; the correction is documented here rather than quietly
replaced, because how the number went wrong is the useful part.

## What produced these frames

**The real renderer, in a real browser, over the real desktop transport, driven
by real wheel events.** This is the repository's documented browser-development
surface (`docs/desktop-controls.md` § "Browser development"): the shipped
renderer served by `electron-vite dev`, `desktopProxyPlugin` forwarding
same-origin `POST /__desktop`, and behind it a real `local-operator serve`
against an isolated config dir. Driven over raw CDP against a private headless
Chromium, the way `scripts/capture-evidence.mjs` drives Storybook.

Everything under test is the shipped code: the reducer, the paging policy, the
hook, and the transcript component, with the scroller receiving
`Input.dispatchMouseEvent` wheel events through the browser's own input
pipeline. Nothing is prop-driven and no state is faked.

### What these frames do NOT prove

- **The Electron main and preload processes.** The browser surface has no
  preload, so the harness shims `window.electron` and `window.api`. Nothing on
  the paging path reads either, but the IPC transport is genuinely untested
  here.
- **The packaged build.** Vite dev serves unminified modules; production
  bundling and bytecode are not exercised.
- **Palettes other than `localOperatorDark`.** Nothing under test is
  palette-dependent — the slot's own appearance is swept across all twelve by
  `docs/evidence/chat-older-history-slot/`.
- **A screen reader.** The live region is in the DOM and its text is in the
  measurements; that is not the same as hearing it.
- **A real trackpad's momentum phase.** Synthesized wheel events have no
  inertial tail, so `GESTURE_GAP_MS` is justified by argument rather than
  measured against real hardware.

## The correction to round 1

Round 1 reported that headless Chromium could not synthesize wheel events,
because the scroller did not move and no request was issued. **That conclusion
was wrong, and the zero had a cause.**

The harness left the first-run "Connect a provider" modal open. It is a Radix
dialog, and `react-remove-scroll` installs a document-level handler that calls
`preventDefault()` on every wheel event before it reaches the transcript. The
page was locked, not unresponsive. Two harness bugs put it there: the bypass
wrote the legacy `isComplete` key while the store persists `isModalComplete`,
and the app was reached by a hash-only navigation — a same-document navigation,
so zustand never re-hydrated from what had just been written.

Both are fixed, and `scroll-paging-evidence.mjs` now **refuses to run** against
a locked page rather than measuring through one: it asserts on
`data-scroll-locked` and on any open dialog after load. A run that would have
produced a plausible, meaningless zero now fails loudly.

The request counter was independently dead. It matched `url.includes("/history")`
on a surface where every op POSTs to `/__desktop` with the op name in the
**body**, so it could never fire — it would have reported `0` for a fling that
issued forty pages and read as proof of coalescing. It now parses the body, and
reports `desktopOpsTotal` as a positive control: if that is zero the harness saw
no traffic at all and every count beside it is meaningless rather than
reassuring.

## Before, on `origin/main` (2217ea59a)

Captured by the QA pass on a real build of `main`, not described.

| Frame | What it shows |
| --- | --- |
| `before-01-idle/` | The conversation on open, newest rows. |
| `before-02-top-with-button/` | Scrolled to the very top. `Load earlier messages` is present and **nothing has loaded**. |
| `before-03-after-click/` | After clicking it: rows 100 -> 200. |

```
scrolling to the top:   0 sessions.history ops    (rows stay at 100)
clicking the button:    1 sessions.history op     (rows 100 -> 200)
```

That is the defect this change removes: on `main` the scroll is not an input the
app answers.

## After, on this branch

Fixture: 260 rows / 3 backend pages, viewport 489px, `WINDOW` 60 rows,
`WINDOW_STEP` 60, durable page 100.

| Frame | What it shows |
| --- | --- |
| `after-01-at-top/` | After a 60-notch run: history has loaded **without a click**. |
| `after-02-after-fling/` | After the 40-notch fling under test. |
| `after-03-clamped/` | After 50 further notches clamped against the top. |
| `after-04-after-isolated-reveals/` | The end of the isolated-reveal trials. |

**`after-02` and `after-04` are byte-identical** (`13ebfe0f1d779ae8`), and an
earlier version of this file named the wrong pair. Both end at the hard top of a
fully-mounted transcript, which is the same scene by construction: the fling
step drives the transcript to the end of its history, and the isolated trials
reload and drive it there again. Nothing further is supposed to happen at that
point, so the pixels agree.

That is a weak thing to have to assert, because it is indistinguishable from
shipping one file twice — which is exactly what round 1's Q5 was. What
distinguishes them is the measurement JSON: the two steps record different row
counts, different request counts and different traces on the way to that scene.
If you want a frame that cannot be confused this way, capture the second
mid-sequence; this set does not, and says so rather than leaving a reader to
hash the files themselves.

All four `after` frames also carry the app's **"server is offline" banner**,
which no `before` frame has. It is an artefact of the harness reloading the page
while the backend connection re-establishes, not of the change: the same run
issued 6 real `sessions.history` ops and mounted 260 rows, so the transport was
demonstrably working. It is named here because it is a systematic difference
inside a pair offered as before/after evidence, and an unexplained difference is
one a reader has to discount on trust.

### Clause B — one gesture, one page

```
fling of 40 notches in ~400ms:   0 sessions.history ops, rows 100 -> 200
   (the reveal was local window widening; the network was not needed)
50 notches clamped at the top:   1 sessions.history op
whole run:                       6 sessions.history ops
                                87 desktop ops total   <- positive control
```

A fling produces one reveal, not one per event. The clamped run issues a single
page across fifty notches, and only because the gesture ended and a new one
began; the latch refuses the rest.

### Clause E — the reader's place is held

This is the measurement round 1 got wrong, so the method matters. A
displacement measured *while the reader is scrolling* conflates "the app moved
me" with "I scrolled" — and round 1's delta was measured across a pair of
observations in which **no rows were inserted at all**, which measures nothing.

Here the reveal is triggered by one notch delivered inside an already-open
per-frame watch, the harness stamps the moment it stops sending input, and the
reported numbers cover only the frames after that stamp. Every trial records the
extent growth, so a trace that spans no reveal cannot be counted as a pass.

```
5 trials, 4 real reveals, 724 frames sampled
  trial 1   rows  60 -> 100   extent +4076px   max frame delta after input: 392px
  trial 2   rows 100 -> 100   extent   +24px   max frame delta after input:  24px
  trial 3   rows 100 -> 160   extent +6608px   max frame delta after input:   0px
  trial 4   rows 160 -> 200   extent +4345px   max frame delta after input: 209px
  trial 5   rows 200 -> 200   extent    +0px   max frame delta after input: 344px

worst single-frame displacement across every reveal:  392px
displaced frames:                                     5 of 724
```

A 6608px reveal held the anchor at **0.00px**. For comparison, QA measured
**6564px peak displacement, 9 of 9 insertions displaced, 0 recovered** on the
previous head — so the worst case improved by roughly 17x and the typical case
by far more.

**On the nonzero numbers in that column.** Every trial in which rows were
actually inserted held the anchor at **0.00px**. The nonzero figures land on
trials whose extent grew by 24px or not at all — that is, trials in which
nothing was revealed and the movement is the reader's own wheel notch still
arriving. An earlier version of this file listed a "209-392px residual" under
open defects; two independent passes then reproduced the measurement and found
the same split, with no displacement attributable to the app on any real
insertion. There is no residual to inherit, and the paragraph that implied one
has been removed rather than softened: a phantom bug in an evidence file costs
the next reader a day.

### What the fix actually was

Three defects, all found by driving the app and none by the unit suite:

1. **The correction's sign was inverted.** `column-reverse` inverts the axis
   twice and the two do not cancel. Measured directly on the real scroller:

   ```
   scrollTop  0 -> -100   (more negative)
   row offset  -2604.45 -> -2504.45   (+100: content moved DOWN)
   ```

   So a row pushed down by insertions is restored by moving `scrollTop` *toward*
   zero. Written `-=`, every correction doubled the error it was meant to remove.
2. **The correction measured the wrong row.** It re-sampled whatever was topmost
   instead of the row it was holding; insertions change which row that is, so
   the id comparison failed and the correction stood down exactly when needed.
3. **The correction ran after paint.** The `ResizeObserver` is delivered
   post-layout, so the frame that mounted the rows was painted uncorrected — a
   6338px single-frame lurch with a **net drift of 0.00px**, which is the
   signature of a correction one frame late rather than absent. A net-zero jump
   is still a jump. It is a `useLayoutEffect` on the *mounted* row count now
   (the total does not change on a local widen, which is exactly the reveal that
   displaces the reader furthest).

### Clause L — a conversation that cannot scroll

A transcript shorter than its viewport has no gesture to ask with. Measured on a
130-row fixture in a 9000px-tall window, with **no input at all**:

```
t=0ms      rows 100   2 sessions.history ops   slot "Load earlier messages"
t=11000ms  rows 100   2 sessions.history ops   (stable; no further requests)
```

It chained two pages on its own until the content became scrollable, then
stopped and handed control back. On the previous head this case loaded nothing
and had no button, because the tail guard returned before the branch that owns
it — the transcript's history was unreachable by any means.

### Clauses D, K — the other routes to history

```
keyboard:   Tab reaches the transcript at press #43; Home then reveals
            rows 60 -> 100
scrollbar:  a press-drag-release into the prefetch zone issues 1 op,
            rows 100 -> 160
```

On the previous head both issued **0** ops: the scroller was not a tab stop, so
no key could reach its handler, and the drag attribution computed a gutter band
from `clientWidth`, which is empty wherever the platform draws overlay
scrollbars.

### Clause F — the slot never changes height

Measured from the rendered stories, at every width the app supports:

```
width   idle  loading  failed  windowed  exhausted
512px    28      28      28      28         28
252px    28      28      28      28         28      <- app minimum content box
220px     -      28      28       -          -      <- chat column floor
overflow: 0.00px in every state at every width
```

`docs/evidence/chat-older-history-slot/app-minimum-width/` is the frame; the
failure state measured 34.78px inside a 28px box before this round.

The height held from the first round of that fix, but the copy did not survive
it: truncation kept the box honest while eating the words, clipping 6px off the
fault line at 252px, 38px at 220px, and 44px off the windowed hint at 220px —
which cost that hint the gesture it exists to name. Each sentence now has a
short spelling chosen by a container query on the row itself, so the invariant
is kept by rewording rather than by clipping. Measured, no visible text node
clips at any supported width:

```
                       512px                         220px
failed (transport up)  "Could not load earlier..."   "Did not load" + Try again
failed (transport down) "Earlier messages did not..." "Not loaded"
windowed               "137 earlier messages above   "Scroll up for earlier"
                        — scroll up to load"
clipped: none, at 512 / 252 / 220px
```

`docs/evidence/chat-older-history-slot/transport-down/` is the frame for the
paired transport states.

## Reproducing it

Ports here are the ones this pass was assigned; any free pair works.

```bash
# 1. A seeded backend on an isolated config dir.
node scripts/seed-paging-session.mjs /tmp/lop-paging 260      # -> prints a session id
LOCAL_OPERATOR_CONFIG_DIR=/tmp/lop-paging \
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  local-operator serve --host 127.0.0.1 --port 1141

# 2. The renderer, pointed at it. The token must be in the VITE node process.
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:1141 \
  npx electron-vite dev            # renderer on :5173 unless pinned

# 3. The capture.
node scripts/scroll-paging-evidence.mjs http://localhost:5173 <session-id> \
  docs/evidence/transcript-scroll-paging after
```

`seed-paging-session.mjs` writes whole durable pages, so 260 rows is three
backend pages and needs at least two of them to reach the start. The script
fails loudly if the onboarding modal is up, if the transcript does not mount, or
if the aim point falls outside the scroller.

For the short-content case (clause L), seed ~130 rows and drive a window taller
than the resulting content — the transcript must have no overflow at all for the
chain to be the only route.

## Still open

- **`GESTURE_GAP_MS = 400` is unmeasured against real hardware.** It is reasoned
  from a trackpad's momentum tail, not observed on one.

- **Q7, the backend degrading under sustained paging** (rows mounting as 0 and a
  persistent "Reconnecting" after ~130 history requests across many browser
  sessions), reproduced once here. Restarting the backend clears it. Not on this
  diff and recorded rather than charged against it.
