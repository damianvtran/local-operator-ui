# TUI-parity tool rows and the working line

Frames of the rebuilt canonical tool row — the TUI's dense fixed-column ledger,
ported to this app's own medium — and of the working line that replaced the
three pulsing dots.

Two capture surfaces, and the difference matters when reading them:

- **Storybook frames** (`states`, `names-and-fallbacks`, `narrow`, `working`,
  `working-labels`, `compacting-pass-before`, `compacting-pass-after`,
  `operator-spacing-cases`, `turn-boundary-and-working-line`,
  `joined-mid-turn`, `admitted-send-before-first-frame` and its three siblings
  below) render the **production `CanonicalTranscript`**
  from fixture `TranscriptRecord`s. They cover the states that are slow or
  awkward to produce live: an interrupted call needs a turn stopped at exactly
  the right moment, an `mcp__*` row needs a server connected, a narrow row needs
  a resize. Captured over CDP with `scripts/check-evidence.mjs`'s own
  `assertFramePaints` guard.
- **`real-conversation-tool-rows`** (and, in `transcript-images/`, its image-side
  sibling) render the **shipped `applyHistoryPage`
  reducer and the shipped `CanonicalTranscript`** over real `/history` pages
  from one of the operator's actual conversations, served by a real
  `local-operator serve` backend. Electron is not required to render this
  surface: the desktop API answers a plain bearer request, so a vite harness
  mounting the production components against the real route exercises the same
  code path the app does. Two things to reproduce it (both cost a round when
  missed): page the history OLDEST-FIRST in small pages (20 entries), because
  the blank-summary condition only arises when an assistant entry and its tool
  result land on different pages; and if the harness root sits outside
  `src/renderer/src`, name an explicit Tailwind `@source` at it, or every role
  utility (`text-mono-sm`, `min-h-5`) compiles as ABSENT and the rows measure
  24px instead of 20px — reading as the pitch fix failing when it has not.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| [`states`](states/) | Every outcome in one column, plus the state before there is an outcome at all: a COMPOSING call has no execution time to report, so its duration slot is reserved and empty (`tool_card.py:2503-2507`) and the only thing on the row that moves is the dictation counter — kept at a `KB` step, because the spelling is what that row is for. The rest: success, a write with `+42 -11` diff counters, a failure on the danger ground with a cross, an interrupted call with the slashed circle, and a running `web_fetch` with a live clock and **no** outcome glyph. The empty status column is what says "still running". |
| [`names-and-fallbacks`](names-and-fallbacks/) | Long builtin names, two `mcp__linear_*` calls displaying as just `create_issue` / `list_issues` with the plug glyph, and unknown tools (`some_custom_tool`, `team`, `eval`) taking the wrench. The wrench and the plug are deliberately different marks: "I do not know this tool" and "this came from a server you connected" are different answers. |
| [`narrow`](narrow/) | The same rows at 420px. The shed ladder is visible: the `edit` row's `+42 -11` counters are **gone**, the summaries truncate with an ellipsis, and the outcome glyph and duration survive — they are the last thing to go, not the first. |
| [`working`](working/) | The working line under a running tool row. The row states the ARGUMENTS and that call's own execution time; the line states the KIND of work and the phase age. They do not restate each other. |
| [`compacting-pass-before`](compacting-pass-before/) | A compaction pass in flight. The rung is the ONLY thing on screen that says so — `compacting context`, the terminal host's own label for the same fact — and it has a phase of its own, which is what the clock times. This is the half of the change that replaced `/compact`'s modal dialog: the dialog used to be the surface's whole answer to the command, and it stayed up over a pass that had already finished. The frame is the state the transcript could not previously express at all. |
| [`compacting-pass-after`](compacting-pass-after/) | The same transcript once the pass has settled: the rung is gone and the reducer's own info line — `Context compacted, 41.0k to 9.0k tokens` — is what took its place, carrying the counts the backend reported. The pair is one change, so the two frames are its before and after; the dialog this replaces lived between them, and the frames of it are in [`../chat-compact-dialog-before`](../chat-compact-dialog-before/). |
| [`working-labels`](working-labels/) | Every label the line can carry — `thinking`, `responding`, `composing a call`, the model's own sanitised intent, and `running 3 tools` for a batch. No trailing ellipsis anywhere: the clock is what says it is ongoing. |
| [`real-conversation-tool-rows`](real-conversation-tool-rows/) *(declared, not swept)* | The shipped reducer and transcript over a real backend and a real conversation, paged oldest-first in 20-entry pages: **38 real tool rows, 0 blank object columns**, every row on one pitch, 38 `sr-only` outcome labels. These frames predate the 2px hairline and so show the run at the 20px pitch; what they evidence is the arguments and the outcome labels, not the current spacing — for that, see `operator-spacing-cases` and `trace-gap-boundaries`, which a sweep retakes. Every row carries its own arguments — the defect this replaced showed a run of unlabelled `bash`/`wait`/`task` rows. |
| [`joined-mid-turn`](joined-mid-turn/) | The reported defect, at the only moment it is visible: a viewer that joins a turn already in flight. The owner's seed keeps the settling frame of every call that finished before the viewer attached and drops the start it replaces, and the settling frame carries no `args` — so a run of rows used to read `exit code: 0`, the file's first line, or `result: None` instead of the call. Six rows: one whose row is recreated by that settling frame after a receipt gap (it must still say the command), one whose arguments are genuinely unknown with a result opening on the harness's own `exit code: 0` wiring, a `read` in the same state, a call that printed NOTHING (so the object column is deliberately EMPTY rather than quoting the producer's `(empty)` section body), a stand-in line long enough that the column truncates it, and a control row whose arguments arrived normally. Records are built by the PRODUCTION reducer in the order the session hook applies them. Where a row shows a line of its RESULT rather than its own object, the line is marked with a leading `…` — the design round's D1 — so a column that is normally a command cannot be misread as one. The same story captured from UNMODIFIED `origin/main` (`2217ea59a`) lives in [`../tool-rows-baseline/`](../tool-rows-baseline/), with the row-by-row pair and the one-line reproduction: rows 1 and 2 read `exit code: 0` there, which is the reported defect. |
| [`operator-spacing-cases`](operator-spacing-cases/) | The same three runs as a STORY, so they are re-captured by every sweep: four consecutive settled rows, an assistant line followed by `hub`/`send` rows, and a long run mixing tool rows with prose-free tool turns. Every adjacent like pair sits on ONE pitch — 20px of row plus the 2px hairline. |
| [`trace-gap-boundaries`](trace-gap-boundaries/) | Where that hairline applies and where it does NOT, which a run of identical rows cannot show on its own: a margin carried by every row would photograph the same. Three blocks — a LONE call between two paragraphs (no ledger neighbour, so no hairline, `item` either side); a NOTICE inside a run (`trace`-like, so every adjacent pair takes the same 2px GAP — which is the claim, and all of it: the block measures `22, 23.7, 22`, because the notice's own line box is taller than a 20px tool row. The gap is uniform, the pitch is not, and that difference predates this tier); and a run OPENING a turn (the 24px boundary sits above its first row, the hairline only from the second). |
| [`spacing-uniformity`](spacing-uniformity/) *(declared, not swept)* | The three runs as they were captured by hand for the spacing round: a short run of settled rows, a `hub`/`send` run, and a longer mixed run. Every inked band in these frames is a ledger row or its trailing timestamp — there is no prose in shot, so the assistant line that sets the middle block's pitch in the story above is NOT part of what this pair evidences. Its sibling above is the same claim as a story; this is the pair the operator's own screenshot was compared against, and what it holds is what those frames show, not the story's fuller set. |
| [`turn-boundary-and-working-line`](turn-boundary-and-working-line/) | The hierarchy that survives the tightening: two ledger rows, a user turn, an agent reply, and a running row with the working line under it. Tightening a run is only correct if the reader can still see where a turn began. (The older `turn-boundary/` frames were removed: they came from a story title that no longer exists, so no sweep could refresh them.) |
| [`prose-tool-alignment@1024`](prose-tool-alignment@1024/), [`@1440`](prose-tool-alignment@1440/) | Agent prose and the ledger sharing ONE left rail and ONE right edge, with prose both BETWEEN tool rows and as a final answer. The operator reported the answer as inset and narrower than the tool calls; it was capped at a reading measure and then centred inside the row it owns. Measured here, the answer and the tool row now span the same 102..962 at 1024 and 310..1170 at 1440 — left and right deltas both 0, where they were 156.6px each before. Two widths because a max-width cap only binds on a wide column, so one narrow capture would photograph the defect as absent. The user bubble is in frame as the control: it keeps its own narrower measure. |
| [`streaming-before-first-token`](streaming-before-first-token/) | The gap between `message_start` and the first token. The claim is an ABSENCE: no "Writing" row above the working line, which used to state the same fact a second time in the answer's own register. What must still be here is the liveness — the working line, spinning, reading `thinking`. Losing the row and the signal together would be a regression, not a fix. |
| [`admitted-send-before-first-frame`](admitted-send-before-first-frame/) | The cold engage: a send the app has admitted and the owner has not answered. One quiet line at the foot, `waiting for the agent`, in the ladder's own register and on its `thinking` phase — the same rail, ink and typeface as every other rung, and the only liveness element on screen. This is the state the operator reported as dead air ("I hit send and nothing happens for three seconds"), so the frame's job is to show that the wait is now ON SCREEN: built by the real `appendPendingUser` echo, nothing hand-written. |
| [`admitted-send-before-first-frame-baseline`](admitted-send-before-first-frame-baseline/) | The AFTER half's own control, and the reason the pair exists: the same transcript with `starting={false}`, which is exactly the old behaviour — the user's bubble and then nothing until the owner's first frame. The two frames differ by one line and by nothing else, which is what makes the claim checkable rather than asserted. |
| [`admitted-send-before-first-frame-small-view`](admitted-send-before-first-frame-small-view/) | The same rung in the small-view wrapper (no `AGENT_GUTTER`, the tighter `GAP.item`), which no other frame in this set could show: `narrow` varies the viewport WIDTH rather than the `isSmallView` flag (design round 1, D2). Same records as the frame above, so the difference between them is the wrapper alone. |
| [`admitted-send-transport-down`](admitted-send-transport-down/) | The wait's other clear: the stream is unavailable, so the transcript renders the failure and the rung is NOT painted beside it. A line claiming progress next to "the connection was lost" would be a claim the transport is not making. The state was not expressible before this (the story hardcoded `status="live"`), and the derivation behind it is asserted in `scripts/tool-row.test.mjs`. |

> **How the headline frame was proven to be a real reading.** A frame showing
> no blanks is worthless if the instrument could not have shown blanks, so the
> same harness was run with the reducer deliberately starved, and the numbers
> come from a probe that locates the summary column STRUCTURALLY (the `flex-1`
> middle column, `sr-only` excluded) rather than by position — a positional
> probe scores a genuinely blank row as populated when the `sr-only` outcome
> slides into that slot.
>
> | control | what is starved | result |
> | --- | --- | --- |
> | *(none)* | nothing | **38 rows, 0 blank** — real arguments on every row |
> | `stripargs` | `tool_calls` only | **38 rows, 0 blank** — the output fallback carries it alone |
> | `stripboth` | `tool_calls` **and** output | **53 of 53 blank** — the defect reproduced exactly |
>
> The middle row is the evidence that both halves of the fix contribute
> independently, which the aggregate zero cannot show; the last row reproduces
> the operator's original complaint from the CURRENT head, so the probe
> demonstrably detects the bug it reports absent.

The reducer measurement that stood in for this frame while it could not be
captured still holds, and it remains the broader evidence — one screenful
against six conversations. The shipped reducer replayed page-by-page over six
real transcripts, blank-summary count against the pre-fix head:

| Session | Tool rows | Blank at `2e83b46f9` | Blank now |
| --- | --- | --- | --- |
| `c53d69f9033b` | 418 | 14 | 0 |
| `aa7355037e1f` | 402 | 10 | 0 |
| `8b5a3a71e677` | 293 | 8 | 0 |
| `37f60b478edd` | 293 | 5 | 0 |
| `1443d08ba7c9` | 238 | 7 | 0 |
| `83fdf0935d46` | 222 | 7 | 0 |
| **Total** | **1,866** | **51** | **0** |

Both halves contribute: `argsByCall` recovers the arguments for rows whose
assistant entry fell on another page, and the rows left with nothing to say
fall back to the output's first line rather than rendering empty.

Both brand themes for each. The 12-theme sweep was **not** regenerated — see
`manifest.json`'s `partialCapture` — but the eight story ids are registered in
`STORIES` in `scripts/capture-evidence.mjs`, so the next full recapture covers
them.

## Measured, not eyeballed

The stills show the symptom; the geometry shows the cause. Read out of the live
DOM in the real app window:

```
tool:1  x=182 w=65 'bash'       x=255 w=665 'ls ~/ | head -50; echo'  x=948 w=36 '2.9s'
tool:2  x=182 w=65 'read'       x=255 w=665 '~/local-operator-ui/do'  x=948 w=36 '0.0s'
tool:6  x=182 w=65 'web_fetch'  x=255 w=665 'https://example.com/ve'  x=948 w=36 '0s'
```

Every name starts at the same x, every summary at the same x, every duration at
the same x — one shared column each, grown to the longest visible name
(`web_fetch`, 9 characters) between the 8ch floor and the 24ch ceiling. That
alignment is the whole reason a run of twenty rows can be scanned by position
instead of read one at a time, and it is the property a screenshot alone cannot
demonstrate.

## The row pitch, before and after

The operator's second complaint was density and uniformity, and that is a
number rather than an impression: the distance between the top edges of
consecutive rows, read out of the live DOM with `getBoundingClientRect()`. A
uniform run shows a CONSTANT delta. The reference in
`../tui-parity/OPERATOR-TUI-REFERENCE.md` measures ~20.4px per line.

| Case | Before | Tightened | Now (2px hairline) |
| --- | --- | --- | --- |
| (a) four consecutive settled rows | `28, 28, 28` | `20, 20, 20` | `22, 22, 22` |
| (b) prose, two `hub` rows, a `send` row | `34.4, 36, 12, 28` | `30.4, 20, 20` | `30.4, 22, 22` |
| (c) long run mixing rows and prose-free turns | `36, 12, 28, 36, 12, 28` | `20, 20, 20, 20` | `22, 22, 22, 22` |
| turn boundary + working line | `28, 48, 72.4, 34.4` | `20, 44, 72.4, 30.4` | `22, 44, 72.4, 30.4` |

Three columns because the pitch was set twice. `Tightened` is the correction
from the operator's "much too wide", which took the `trace` tier to zero; `Now`
is the hairline that followed it, because at zero a run fused into one unbroken
column with no boundary between consecutive calls. 2px is the smallest step
that reinstates one, and deliberately not the 4px it came down from — which is
a claim you can now check by looking rather than take on trust:
[`../tool-rows-4px-rejected/`](../tool-rows-4px-rejected/) is this same story at
`GAP.trace = mt-1`, captured by temporarily editing the tier and reverting it,
against [`operator-spacing-cases`](operator-spacing-cases/) at the shipped 2px.
The rejected alternative is not shipped anywhere, so no sweep can produce that
frame; it is declared `supplementary` for the same reason `spacing-uniformity`
is.

Three things to read out of the table. Every run is CONSTANT inside itself,
which is what "uniform" means here — and it is structural rather than lucky,
because every adjacent like pair takes the same tier and therefore the same
distance. The pitch is the row's own 20px height plus that 2px, so a run of N
rows measures `N × 20 + (N-1) × 2`. And the turn boundary is still the widest
gap in the last row: the hierarchy was not flattened to buy the density, and it
is unchanged by the hairline (2 against 24, where the tightening had 0
against 24).

The hairline applies only BETWEEN adjacent ledger rows, which the runs above
cannot show on their own — a margin on every row would reproduce them exactly.
`trace-gap-boundaries` is the surface that separates the two: a lone call takes
no hairline, a notice inside a run takes the same one as its neighbours, and a
run opening a turn keeps its 24px boundary above the first row and takes the
hairline only from the second.

The BEFORE column is also the diagnosis. In (b) and (c) the alternating
`36, 12` pairs are a record that RENDERS NOTHING sitting between two visible
rows — an assistant turn that carried only tool calls. It contributed its own
12px margin and pushed the row after it off the tight tier, which is the "extra
space randomly inserted" with no visible cause. `transcript-rows.ts` now
computes adjacency over what the reader can see; `scripts/tool-row.test.mjs`
pins it, and both of those tests were confirmed to FAIL against the pre-fix
code rather than merely passing against the fixed one.

Measured under CDP focus emulation. An unfocused window throttles `setInterval`,
which makes the working line's clock and spinner read as frozen — a real
measurement artifact on this surface, not a hypothetical one.

## What the hairline cost the frames, and how the set was reframed

Every frame in this directory was re-taken for this change, and the reason is
worth stating because it is a trap specific to this surface. A story `Frame`
shorter than its own transcript **clips** it rather than letterboxing: the
fixture's history is anchored at its top, so the rows that leave the picture are
the **newest** ones, off the **bottom**, and everything above them stays exactly
where it was. The frame still looks well-composed. It is simply a photograph of
a shorter run.

That is measured off the frames rather than inferred from a flex direction —
which matters, because the inference points the wrong way and an earlier draft of
this section followed it. Across the short frame and its resized replacement the
`Start of conversation` divider sits at the **same** y, rows 1–5 sit at the same
y, and what the short frame is missing is its sixth row and the trailing date
band. Anyone debugging a short frame should look at its bottom edge, not its top.

It is not hypothetical either: the design and QA rounds on the hairline both
caught `joined-mid-turn` showing **five** rows where the entry above describes
six, and QA established the cause — the story is byte-identical to the one that
produced the six-row frame, so the 2px per gap, plus the height the
`Start of conversation` divider (#112) takes at the top, had consumed the slack
its declared height left. Two pixels a row is enough to push a row out of a
picture.

So the rule is now uniform across the set rather than applied where a reviewer
happened to look: every `Frame` height is the transcript's own `scrollHeight`
measured in the rendered story, plus the `Frame`'s 48px of padding, rounded up
to the 4px ramp — and **all fifteen** `Frame`s across the twelve refreshed
stories were short, not only the one that had visibly lost a row. (Fifteen, not
sixteen: `working-labels` is the twelfth story and renders `WorkingLine`s
directly with no `Frame` at all, so it could not be short. The three `diff-body`
`Frame`s are a different story group, were not reframed, and are not short —
`-wrapped-cap` runs flush against its clip *by design*, to pin the overflow
marker to the well's foot.) The capture viewports in `capture-evidence.mjs`
moved with them, because the harness captures at `max(scrollHeight, declared)`
and a viewport shorter than the frame re-crops exactly what the frame just made
room for.

One consequence to read the before/after pairs with: the refreshed frames are
framed differently from the ones they replace — they sit a little lower, they
carry the divider, and they show the trailing date band the short frames had
pushed out. They are pitch-of-record for this change; a pair of them is not a
controlled A/B of framing.

## The name/summary gutter

The name column grows to the longest visible name, so at its widest the two
columns came within 8px of each other. Text-to-text separation, read out of the
live DOM at 1280px with a `Range` over each name (the box edge overstates it,
because the gutter is padding inside the box):

| Story | Column | Worst-case gap | Truncated? |
| --- | --- | --- | --- |
| `states` (`web_fetch`, 9ch) | 68.8px | **12px** | no |
| `names-and-fallbacks` (`some_custom_tool`, 16ch) | 119.2px | **12px** | no |

12px against the 8px the design round measured. The gutter is added to the
column (`calc(${nameColumn}ch + 0.25rem)`) rather than carved out of it: as
padding inside the measured width it stole 4px from the text box and truncated
`web_fetch` to `web_fet…` — the column sized for a name no longer fitting it.
That regression was caught by looking at the frame, not by a test.

## The two clocks, and what freezes

Both are `setInterval`, so both were measured with
`Emulation.setFocusEmulationEnabled` — an offscreen window throttles timers and
a working clock reads as frozen, which is how a real defect and a measurement
artifact came to look identical in round 1.

Sampled at ~1.1s intervals, eight times, `document.hidden === false`:

```
motion on   row durations   2.9s|0.0s|0.1s|0.2s|5.0s|14s -> ...|22s   (8 distinct)
motion on   spinner         ⣷⣟⢿⣽⣷⡿⣻⣾                                 (7 distinct)
motion on   working clock   2s 3s 4s 5s 6s 8s 9s 10s                  (8 distinct)

reduce      spinner         ⣾⣾⣾⣾⣾⣾⣾⣾                                 (1 distinct)
reduce      working clock   2s 3s 4s 5s 6s 8s 9s 10s                  (8 distinct)
```

Three things to read. The running row's duration now MOVES (14s→22s) while the
five settled rows beside it stay fixed — it counts from the record's own
`startedAt`, because `durationS` is `null` until the call ends and the row
previously rendered `0s` for its entire life. Under `prefers-reduced-motion` the
spinner collapses to one frame (`⣾`, frame 0) while both clocks keep ticking:
the freeze is implemented in JS, because the global CSS cap bounds
`animation-duration` and this spinner is a text node swapped on a timer, which
no media query can reach.

The `states` and `working` stories pin their running rows' `startedAt` in the
past for exactly this reason: captured at `startedAt: now` every running row
reads `0s`, which is indistinguishable from the frozen clock it replaced — and
that indistinguishability is why the defect survived a review round.

## What these frames do NOT prove

- **Packaged Electron.** The real-app frames run the compiled main and preload
  from `out/` against a Vite renderer, not an installed `.app`. Native dialogs,
  auto-update and the packaged bundle are untested here.
- **The shipped CSP string.** The live harness rewrites the backend port inside
  the policy so it can reach a backend on its own port (see the note in the PR).
  The one CSP change this branch makes — `blob:` in `img-src` — is asserted
  directly against the committed HTML in `scripts/tool-row.test.mjs`, precisely
  so it cannot be certified by a surface that rewrote it.
- **Ten of the twelve themes.** Only the two brand palettes were captured.
  `pnpm check-themes` covers all twelve numerically (1884 assertions); these
  frames do not.
- **That the pitch is right on the operator's own machine.** These are
  Storybook frames at a fixed viewport and device scale. They demonstrate that
  the pitch is uniform and how tight it is; they cannot speak to his display,
  his zoom level, or a route nobody captured.
- **That `states` re-captures byte-identically.** Two consecutive captures of
  that story differ by ~288 pixels of 1,152,000, in the `web_fetch` row's
  duration: its fixture declares `phase: "running"` with
  `startedAt: Date.now() - 12_000`, so the row paints a live clock and reads
  `12s` or `13s` depending on the second the frame was taken. Nothing else on
  the surface moves. It is worth knowing before diffing a re-capture, because
  the one honest way to check a spacing claim here is to re-take the frame and
  compare — and on this surface a difference of that size and in that band is
  the clock, not the change under review. Pre-existing, and not something the
  hairline touched.
- **That the whole small-view tier is what the code says.** One state now has a
  frame in that wrapper (`admitted-send-before-first-frame-small-view`), which
  shows the wrapper and the tighter item gap the rung is rendered with there;
  the rest of the tier still rests on construction rather than on pictures,
  because `GAP.trace` carries the same `mt-0.5` in both indices, so no pair of
  frames could distinguish the two views for the rows that do not change.
  `scripts/tool-row.test.mjs` asserts the pair; that assertion, not a picture,
  is the evidence for the rows.

## Declared, not swept

Three surfaces in this set cannot be regenerated by `node scripts/capture-evidence.mjs`, and each
is therefore its own `supplementary` declaration in `manifest.json` — the same
mechanism `sidebar-new-chat` uses. A sweep clears the frames it can retake and keeps everything else, but an
undeclared frame set is still deleted — and because the sweep rewrites its own
frame count in the same pass, `check-evidence` stays GREEN over the loss. That is
why each of these is named rather than counted: not to keep the arithmetic
honest, but because nothing else would notice they had gone.

| surface | why a sweep cannot produce it |
| --- | --- |
| `spacing-uniformity` | the runs that preceded this change were driven by hand against the live app; there is no story for them |
| `real-conversation-tool-rows` | a bespoke harness over a real `/history` page from a real `serve` backend, never committed — the one surface whose durations still predate the `<0.1s` spelling |
| [`../tool-rows-baseline/`](../tool-rows-baseline/) | the before/after pair needs an older SOURCE TREE (unmodified `origin/main`), which a sweep of this tree cannot be |
