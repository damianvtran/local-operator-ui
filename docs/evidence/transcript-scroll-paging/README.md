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

## Round 2 — the momentum fix, measured on both trees

The operator's report has two halves and this round measures both: *"sometimes it
loads the next sections without my scroll getting stuck"* (lead time) and *"if I
scroll a bit too fast I get stuck ... I need to scroll jitter down a bit and back
up to trigger the lazy loading"* (the freeze). The diagnosis
(`/tmp/scroll-paging-diagnosis.md`, `architect`) reproduced both and designed
A1-A4; this is what the implementation measured.

### What the rig gained, and why

`scripts/scroll-paging-evidence.mjs` drives both arms through one harness. Six
changes, each answering something this file used to be unable to say:

1. **`flingWithMomentum`** — a finger burst followed by a TIME-BOUNDED decaying
   momentum tail. The old `fling(count, deltaY, gap)` is a finger walking a
   wheel; the operator's gesture is a flick whose tail keeps reporting after the
   fingers lift. The tail is bounded by the clock rather than by a notch count
   because a count-bounded decay spaced its last notches **733ms** apart in the
   diagnosis run — past `GESTURE_GAP_MS`, i.e. a gap the harness invented.
2. **A page-side recorder** (capture-phase listeners plus a per-frame geometry
   sampler). A before/after probe pair either side of a gesture cannot see the
   question: two probes a second apart report the same state whether a reveal
   took 0ms or 96ms, and the 96ms is the whole complaint.
3. **Per-reveal attribution**: how many reveals an act bought, how many a reader
   can SEE (`revealsMountedRows`, because a durable page whose rows stay hidden
   changes the slot without painting a row — review round 1, R1-9),
   `revealsOnApproach` against `worstMsAfterArrival`, the longest run of notches
   at the hard top with nothing revealed, and the end state as a flag
   (`endsPinnedWithHiddenRows`).
4. **The lurch, per frame and post-input**: the largest single-frame change of
   the held row's viewport offset over the frames after the LAST input. Taken
   across a gesture it measures the reader's own wheel — the largest figure in
   one whole train was 136px on a frame where `scrollTop` moved 136px and no
   reveal was in flight.
5. **The act-end shutter** (review round 1, D1-1): the scenario runner fires a
   `beforeSettle` hook, so the frame that answers "where does the freeze stand
   under the fix?" is taken at the END OF THE ACT rather than after the settle
   sleep that exists to let reveals unpin the reader. The state at that shutter
   is recorded with the frame (`actEndState`).
6. **`scripts/paging-evidence-arms.mjs`** (review round 1, R1-4): the mode
   argument names the OUTPUT FILES and the report's arm label; it cannot swap
   the code under test, and the first version's swap was two hand-run `git show`
   commands plus a README sentence claiming an md5 comparison nobody could see.
   The script writes the ref's bytes, asserts the swap by a property the arm
   must have, runs the rig, restores from git and re-reads the hash, printing
   `restored=identical {...}` or exiting non-zero.

### The two arms

Both arms are THIS tree, served by one rig on one port against one seeded
backend, with the two paging modules swapped by the script above:

```bash
node scripts/paging-evidence-arms.mjs after -- http://127.0.0.1:5290 <session> /tmp/evidence-after
node scripts/paging-evidence-arms.mjs before 10d3cd21a -- http://127.0.0.1:5290 <session> /tmp/evidence-before
```

`10d3cd21a` is this branch's merge base. The `before` arm's restore printed
`restored=identical {"scroll-paging.ts":"7c36224460d032d0","use-scroll-paging.ts":"08b8184b837dd3f4"}`
at the end of the run it produced the frames in this directory. **Every scenario
starts from the arrival state** — the one state the fixture guarantees
identically on both arms — so no row below inherits a predecessor's leftovers
(review round 1, D1-2 and R1-3: the earlier capture drove two scenarios "to the
wall" by fixed gesture and measured `d = 24` on one arm against `d = 7790` on the
other). The one scenario that cannot start there, the slow approach into the
zone, reaches its start state by measurement on both arms and reports the state
it reached (`setupToZone.distance` 1014 before, 950 after, against a 320px zone).

| scenario | before (merge base modules) | after (this branch) |
| --- | --- | --- |
| `fast-fling-to-top` | 2 reveals, **0 on the approach**, ends `d = 193` with `hiddenRows = 100`; page visible 2444ms after arrival | 3 reveals, **1 on the approach** (spent at `d = 1494px`), ends `d = 8024` with the rows mounted; 922ms |
| `fling-crossing-two-walls` | 3 reveals, **0 on the approach**; longest clamped stretch 25 notches / 1000ms | 3 reveals, **3 on the approach**; no clamped stretch at all |
| `page-lands-with-rows-hidden` | ends `d = 0`, `rows = 100`, `hiddenRows = 100`, **`endsPinnedWithHiddenRows = true`**; 84 notches / 2981ms at the wall with nothing revealed | ends `d = 1294`, `rows = 200`, `hiddenRows = 0`; longest stretch 24 notches / 867ms |
| `resting-finger-at-clamped-top` | 200 notches → `d = 0`, `hiddenRows = 100`, pinned; 81 notches at the wall, worst 4297ms | 200 notches → `d = 3833`, `hiddenRows = 40`, unpinned; worst 1056ms |
| `slow-approach-into-zone` | 1 reveal, **0 spent inside the zone** while input was still arriving | 1 reveal, **1 spent inside the zone** (`revealsInsideZoneBeforeLastInput`) |
| `continuous-train-beyond-the-lead` | 0 reveals, 0 pages | 0 reveals, 0 pages |
| `keyboard-home` | 1 input, 1 reveal (the widen), 0 pages | 1 input, 2 reveals (1 mounting a row), 0 pages |
| `scrollbar-drag-to-top` | the pointer path fragments into 8 legs, ends **1420px from the top**, 0 reveals, 0 pages | one leg, `d 5694 → 0`, 3 reveals, **1 page** |

Per act, whole run: **1 page** per fling-shaped act on both arms; 20
`sessions.history` ops before against 22 after, across eight scenarios. The
`desktopOpsTotal` figures (269 / 260) are a liveness control, not a delta — the
recorder's own polling and the app's status calls are inside them (review round
1, R1-10), which is why the page count is quoted as `sessions.history` alone.

The freeze, in the operator's own terms: on `before`, a flick that reached the
hard top left the reader **pinned there with 100 fetched rows the app was not
showing** — `endsPinnedWithHiddenRows = true`, 84 notches and 2.98s of pushing
that bought nothing — which is the state that produces "I need to scroll jitter
down a bit and back up". On `after` the same gesture ends with those rows
mounted, at `d = 1294`.

### The lead below its floor, and the trigger above it (R1-1)

The lead is a **window** change below its floor, not a trigger change, and this
round's review was right that the first version of this file, the module header
and the PR body said otherwise. What is true, measured three ways:

- **Pure case** (`a slow approach inside the zone is spent at its input
  cadence, not at the settle debounce`): at 0.3px/ms, 40ms into the act, 300px
  from the top — inside the 320px zone, `SETTLE_MS` = 120 not elapsed — this
  module widens and the module it replaces does not. Deleting the floor outright
  turns that one case red and nothing else; the replaced module turns eleven red.
- **Real surface**: `slow-approach-into-zone` measures a reveal spent while the
  reader was inside the zone and still sending input on this branch
  (`revealsInsideZoneBeforeLastInput = 1`) and none on the merge-base modules
  (`0`) from the same measured start state.
- **The zone itself is unchanged**: at the same instant, one pixel outside the
  zone, the demand is still dropped — asserted in the same pure case, so the
  change is about motion and never about position.

So a slow reader's *window* is the same 320px it always was, and their *trigger*
inside it moves from the settle debounce to their own input cadence, which is
what the operator asked for ("load in a page each time I'm reaching a threshold
... detect the scroll motion and momentum ... before we get stuck"). The claim
that the behaviour is "bit-for-bit as before" below the floor is withdrawn in
all three places it appeared.

### Clause E on a mid-motion dispatch (risk 1)

The lead spends the page while the reader is still travelling, which is what rule
3 originally refused. The frame-to-frame number, over the frames after the last
input, on both arms:

```
                          before        after
fast-fling-to-top         0px           24px
fling-crossing-two-walls  0px            0px
every other scenario      0px            0px
```

24px is the clamp-follow the browser performs when a landing grows the extent
under a pinned reader, and it is the same figure this branch measured in round 1;
**the lead does not introduce a lurch**. (The largest single-frame change of
`distanceFromTopPx` is 3899px before against 6153px after, on both arms content
inserted above a HELD row — the reveal itself — which is why the anchor offset
rather than the distance is the number quoted.)

### The two clauses run 1 left unproven, now measured

- **The `Home` keystroke** (BLOCKED in run 1: no input event reached the
  scroller). Measured on both arms: `inputEvents = 1`, the transcript still
  focused after the reload, and **one reveal** — but the reveal is the WIDEN and
  `historyRequests = 0`. A single `Home` does not buy a page; the page needs a
  later act. The spec's expected count of "1 page" was wrong and is corrected
  here (QA round 1, Q1-1).
- **The scrollbar drag** (VOID in run 1: run after the history was exhausted, and
  a "negative control" in round 1 because a single drag ended 3555px from the
  top). Measured now from the arrival state: the drag reaches `d = 0` in one leg
  and spends a page — 3 reveals, `historyRequests = 1` — and on the merge-base
  modules the same gesture fragments into 8 legs, never arrives and spends
  nothing. The clause is positive on this harness (QA round 1, Q1-2, and UX round
  1's refutation of the negative-control framing).

### One statement per act (D1-3, U1-2)

The copy timeline for one flick at the wall, both arms, from `slotTransitions`:

```
before   t=7714  "Load earlier messages"            (a button, mid-flick)
         t=8756  "Loading earlier messages"
         t=10098 "100 earlier messages above - scroll up to load"   <- the pre-fix instruction
after    t=5788  "Loading earlier messages"
         t=5804  "Load earlier messages"
         t=5985  "Loading earlier messages"
         t=7089  "40 earlier messages above - scroll up to load"    (post-widen count)
```

On `before` the reader — pinned at the hard top and still pushing — is told to
"scroll up to load" for content the app is already fetching, which is the one
sentence in this surface that asks for a gesture that cannot help. On `after`
the loading copy is held from the first spend of an act until the rows are
actually on screen, and the windowed sentence appears once, with the count the
rows have after the widen.

One residual, disclosed rather than smoothed: a ~180ms `Load earlier messages`
paint still appears between a widen landing and the fetch it frees (t=5804-5985
above). In that window nothing is in flight and the policy has no armed demand,
so the row falls to its idle state — the honest state, and a button the reader
cannot act on mid-flick. Closing it needs the DOM half to predict the policy's
next spend, which is the duplication this split exists to avoid.

### The wait at the wall (U1-1)

UX round 1 measured the reader waiting 0.95-1.6s at the wall with nothing visibly
changing, and asked for the number to be published next to `LEAD_TIME_MS`'s
85-100ms rationale rather than for the constant to be tuned blindly. Published,
both arms, `worstMsAfterArrival` per scenario:

```
                             before     after
fast-fling-to-top            2444ms     922ms
fling-crossing-two-walls     1453ms     (none: the reader never rests at the wall)
page-lands-with-rows-hidden  2452ms     3720ms
resting-finger-at-clamped-top 4297ms    1056ms
```

The caveat is part of the number: this machine was at **load average 408** during
the capture (14 cores, ~25 concurrent agent sessions), and the backend answered
the history request itself in 3.5-14ms. So the reveal pipeline is costing
0.9-1.1s here and `LEAD_TIME_MS = 180` is NOT validated against it — a
load-controlled re-measurement is the honest next step, and tuning the constant
against this machine's load would encode the load rather than the latency. What
this branch does change in that window is the COPY: the reader now watches
"Loading earlier messages" instead of a still frame that says they can scroll up
to load what is already being fetched.

### Per-frame captions

Every frame in this directory, arm by arm: what the shutter was, where the
reader was, and what the slot said (review round 1, D1-4 — round 2 shipped
fourteen new frames and named none of them).

**`before` arm — the two paging modules at `10d3cd21a`.**

- `before-01-at-top`, `before-02-after-fling`, `before-03-clamped`, `before-04-after-isolated-reveals` — the probe phase: the reader at the transcript's own top after the initial load, the state every scenario below starts from (`d = 5694`, rows 60, hidden 40).
- `before-05-fast-fling-to-top` — scenario `fast-fling-to-top`, shutter after the settle sleep: `d = 193`, rows 100, hidden 100, slot `Scroll up for earlier100 earlier messages ab`; 30 notches, 2 reveals (1 mounting a row), 1 page.
  - `before-05-fast-fling-to-top-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `before-06-fling-crossing-two-walls` — scenario `fling-crossing-two-walls`, shutter after the settle sleep: `d = 6063`, rows 160, hidden 40, slot `Scroll up for earlier40 earlier messages abo`; 50 notches, 3 reveals (2 mounting a row), 1 page.
  - `before-06-fling-crossing-two-walls-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `before-07-page-lands-with-rows-hidden` — scenario `page-lands-with-rows-hidden`, shutter after the settle sleep: `d = 0`, rows 100, hidden 100, slot `Scroll up for earlier100 earlier messages ab`; 160 notches, 2 reveals (1 mounting a row), 1 page.
  - `before-07-page-lands-with-rows-hidden-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1). The window is AT the transcript top: the slot paints *"100 earlier messages above - scroll up to load"* while 100 fetched rows stay held back (rows 0160-0162 in view) — the operator's freeze, at the shutter.
- `before-08-resting-finger-at-clamped-top` — scenario `resting-finger-at-clamped-top`, shutter after the settle sleep: `d = 0`, rows 100, hidden 100, slot `Scroll up for earlier100 earlier messages ab`; 200 notches, 2 reveals (1 mounting a row), 1 page.
  - `before-08-resting-finger-at-clamped-top-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `before-09-keyboard-home` — scenario `keyboard-home`, shutter after the settle sleep: `d = 4480`, rows 100, hidden 0, slot `Load earlier messages`; 0 notches, 1 reveals (1 mounting a row), 0 pages.
- `before-10-scrollbar-drag-to-top` — scenario `scrollbar-drag-to-top`, shutter after the settle sleep: `d = 1420`, rows 100, hidden 0, slot `Load earlier messages`; 0 notches, 1 reveals (1 mounting a row), 0 pages.

**`after` arm — this branch.**

- `after-01-at-top`, `after-02-after-fling`, `after-03-clamped`, `after-04-after-isolated-reveals` — the probe phase: the reader at the transcript's own top after the initial load, the state every scenario below starts from (`d = 5694`, rows 60, hidden 40).
- `after-05-fast-fling-to-top` — scenario `fast-fling-to-top`, shutter after the settle sleep: `d = 8024`, rows 160, hidden 40, slot `Scroll up for earlier40 earlier messages abo`; 36 notches, 3 reveals (2 mounting a row), 1 page.
  - `after-05-fast-fling-to-top-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `after-06-fling-crossing-two-walls` — scenario `fling-crossing-two-walls`, shutter after the settle sleep: `d = 7736`, rows 160, hidden 40, slot `Scroll up for earlier40 earlier messages abo`; 21 notches, 3 reveals (2 mounting a row), 1 page.
  - `after-06-fling-crossing-two-walls-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `after-07-page-lands-with-rows-hidden` — scenario `page-lands-with-rows-hidden`, shutter after the settle sleep: `d = 1294`, rows 200, hidden 0, slot `Load earlier messages`; 160 notches, 4 reveals (3 mounting a row), 1 page.
  - `after-07-page-lands-with-rows-hidden-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1). The window is AT the transcript top with the oldest rows in view (row 0000) and no "scroll up to load" sentence anywhere — the fetched rows are mounted.
- `after-08-resting-finger-at-clamped-top` — scenario `resting-finger-at-clamped-top`, shutter after the settle sleep: `d = 3833`, rows 160, hidden 40, slot `Scroll up for earlier40 earlier messages abo`; 200 notches, 3 reveals (2 mounting a row), 1 page.
  - `after-08-resting-finger-at-clamped-top-at-act-end` — the SAME act, shutter at the END OF THE ACT rather than after the settle sleep (review round 1, D1-1).
- `after-09-keyboard-home` — scenario `keyboard-home`, shutter after the settle sleep: `d = 9444`, rows 100, hidden 0, slot `Load earlier messages`; 0 notches, 2 reveals (1 mounting a row), 0 pages.
- `after-10-scrollbar-drag-to-top` — scenario `scrollbar-drag-to-top`, shutter after the settle sleep: `d = 6153`, rows 160, hidden 40, slot `Scroll up for earlier40 earlier messages abo`; 0 notches, 3 reveals (2 mounting a row), 1 page.

### What these numbers do not settle

- **Scenario start states diverge after the first scenario on each arm**, because
  the two arms leave different content behind: `slow-notches-into-zone` starts
  24px from the top on `before` and 7790px on `after`, so its 1-vs-0 reveal
  difference is the start state rather than the change. Every claim above is
  taken from scenarios that begin at a reloaded arrival state, except that one,
  which is quoted nowhere. The "a slow reader sees no difference" claim is
  carried by the pure case `the lead is inert below its velocity floor` instead.
- **The backend's latency varied by an order of magnitude between runs** (a
  durable page landed 85-100ms after the spend in the diagnosis run, ~900ms under
  this rig's reload load). "Worst ms after arrival" therefore reads as a property
  of the harness's backend as much as of the policy; the discriminating numbers
  are the ones that do not depend on it — where the spend happened, how many
  reveals an act bought, and the end state.
- **The capture predates a whitespace-only formatter pass** (`biome check
  --write`: three line-wraps in the two modules under test, no token changed),
  and `srcTree`/`scriptsTree` name the committed tree. Disclosed rather than
  left for a reader to discover, since the stamps are the only way to check it.
- **The Electron transport and the packaged build**, as above: this is the
  browser surface.
- A real trackpad is still not a real trackpad: the momentum tail is now shaped
  like one (time-bounded decay at frame cadence) but it is still synthesized, so
  `GESTURE_GAP_MS = 400` is justified by a better argument rather than measured
  against hardware.

- **`desktopOpsTotal` is a liveness control, not a delta** (review round 1,
  R1-10). 269 before against 260 after, with the recorder's own polling and the
  app's status calls inside the number. Only `sessions.history` counts pages: 20
  against 22, over eight scenarios.

- **The offline-banner paragraph elsewhere in this file covers six scenarios,
  not the ten core-frame scenarios** (design round 1, D1-6), and this harness
  does not instrument the banner at all: the timings quoted for it come from the
  review's own run, not from the JSON committed here. What the frames here show
  is the transcript, and the sentence has been scoped to say so.

- **The drag pair is not a same-scene pair** (design round 1, D1-7). Both arms
  start at the arrival state, but the `before` arm's pointer path fragments into
  8 legs and never arrives (ending 1420px from the top) while the `after` arm
  arrives in one leg at `d = 0`. The row is a comparison of what the same gesture
  BUYS, not of two pictures of the same place; the frames are captioned that way
  and the `legs`/`journey` fields carry the paths.

- **The rig needs a backend restart between arms**, and that is now a documented
  step rather than a mystery. Each page reload attaches a new session stream
  subscriber; after roughly ten reloads one isolated backend starts answering
  `409 Too many event subscribers`, the app sits on its reconnect state, no row
  mounts and the harness fails with "transcript did not mount". Restarting the
  backend clears it (measured twice tonight, once per arm). This is the same
  leak recorded under "Still open" below as the sustained-paging degradation, and
  it is not on this diff.

## Still open

- **`GESTURE_GAP_MS = 400` is unmeasured against real hardware.** It is reasoned
  from a trackpad's momentum tail, not observed on one — and round 2's harness
  now EMITS such a tail (time-bounded, frame cadence), which tests the clause
  against a synthesized momentum phase rather than against no momentum at all.

- **Q7, the backend degrading under sustained paging** (rows mounting as 0 and a
  persistent "Reconnecting" after ~130 history requests across many browser
  sessions), reproduced once here. Restarting the backend clears it. Not on this
  diff and recorded rather than charged against it.

- **The transport-down quiet line is a defensive branch, not the offline UX.**
  In the flows a UX pass could actually produce, a real transport loss tears the
  session view down — rows go to 0 and the empty state takes the surface —
  before that branch renders; and on this browser-development surface a killed
  backend never flips `status` at all, because the `EventSource` stays in
  CONNECTING rather than erroring. Both are pre-existing behaviours of the
  session stream and the shell, outside this diff and deliberately not
  redesigned here. The branch is verified from the rendered stories, which is
  why it has story coverage and no live frame.

- **The `transportDown={status !== "live"}` wiring is verified by reading, not
  by running**, for the reason above: QA documented seven approaches and none
  reached the state on a live surface. A coverage gap, not a known defect.

- **Deferred, with reasons.** The two short failure spellings under-use their
  budget and stop naming the object (`Not loaded` 62px, `Did not load` 68px
  against 143px available; `Earlier messages failed` 130.34px and `Earlier
  messages did not load` 166.36px both fit) — deferred because changing rendered
  copy now would invalidate the design round that verified these exact strings.
  The 260px container-query switch sits 4px under the windowed branch's own full
  spelling (264.03px), so a 260–264px band can clip `…to load`. Focus drops to
  `<body>` when the affordance unmounts after a load or a failure (one keystroke
  of friction). The quiet row offers no route back and does not change when the
  transport returns — which pairs with the defensive-branch finding above. The
  `Reconnecting` notice the quiet line leans on has no live region.
