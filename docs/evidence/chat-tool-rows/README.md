# TUI-parity tool rows and the working line

Frames of the rebuilt canonical tool row — the TUI's dense fixed-column ledger,
ported to this app's own medium — and of the working line that replaced the
three pulsing dots.

Two capture surfaces, and the difference matters when reading them:

- **Storybook frames** (`states`, `names-and-fallbacks`, `narrow`,
  `operator-spacing-cases`, `turn-boundary-and-working-line`,
  `working`, `working-labels`) render the **production `CanonicalTranscript`**
  from fixture `TranscriptRecord`s. They cover the states that are slow or
  awkward to produce live: an interrupted call needs a turn stopped at exactly
  the right moment, an `mcp__*` row needs a server connected, a narrow row needs
  a resize. Captured over CDP with `scripts/check-evidence.mjs`'s own
  `assertFramePaints` guard.
- **`real-conversation-tool-rows`** renders the **shipped `applyHistoryPage`
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
| [`working-labels`](working-labels/) | Every label the line can carry — `thinking`, `responding`, `composing a call`, the model's own sanitised intent, and `running 3 tools` for a batch. No trailing ellipsis anywhere: the clock is what says it is ongoing. |
| [`real-conversation-tool-rows`](real-conversation-tool-rows/) *(declared, not swept)* | The shipped reducer and transcript over a real backend and a real conversation, paged oldest-first in 20-entry pages: **38 real tool rows, 0 blank object columns**, every row on a 20px pitch, 38 `sr-only` outcome labels. Every row carries its own arguments — the defect this replaced showed a run of unlabelled `bash`/`wait`/`task` rows. |
| [`joined-mid-turn`](joined-mid-turn/) | The reported defect, at the only moment it is visible: a viewer that joins a turn already in flight. The owner's seed keeps the settling frame of every call that finished before the viewer attached and drops the start it replaces, and the settling frame carries no `args` — so a run of rows used to read `exit code: 0`, the file's first line, or `result: None` instead of the call. Five rows: one whose row is recreated by that settling frame after a receipt gap (it must still say the command), one whose arguments are genuinely unknown with a result opening on the harness's own `exit code: 0` wiring, a `read` in the same state, a call that printed NOTHING (so the object column is deliberately EMPTY rather than quoting the producer's `(empty)` section body), and a control row whose arguments arrived normally. Records are built by the PRODUCTION reducer in the order the session hook applies them. Where a row shows a line of its RESULT rather than its own object, the line is marked with a leading `…` — the design round's D1 — so a column that is normally a command cannot be misread as one. The same story captured from UNMODIFIED `origin/main` (`2217ea59a`) lives in [`../tool-rows-baseline/`](../tool-rows-baseline/), with the row-by-row pair and the one-line reproduction: rows 1 and 2 read `exit code: 0` there, which is the reported defect. |
| [`operator-spacing-cases`](operator-spacing-cases/) | The same three runs as a STORY, so they are re-captured by every sweep: four consecutive settled rows, an assistant line followed by `hub`/`send` rows, and a long run mixing tool rows with prose-free tool turns. Every adjacent like pair sits on ONE pitch. |
| [`spacing-uniformity`](spacing-uniformity/) *(declared, not swept)* | The three runs the operator screenshotted when he called the spacing "much too wide" and "not very uniform", reproduced as a regression surface: four consecutive settled rows, an assistant line followed by `hub`/`send` rows, and a long run mixing tool rows with prose-free tool turns. Every adjacent like pair sits on ONE pitch. |
| [`turn-boundary-and-working-line`](turn-boundary-and-working-line/) | The hierarchy that survives the tightening: two ledger rows, a user turn, an agent reply, and a running row with the working line under it. Tightening a run is only correct if the reader can still see where a turn began. (The older `turn-boundary/` frames were removed: they came from a story title that no longer exists, so no sweep could refresh them.) |

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
`manifest.json`'s `partialCapture` — but the seven story ids are registered in
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

| Case | Before | After |
| --- | --- | --- |
| (a) four consecutive settled rows | `28, 28, 28` | `20, 20, 20` |
| (b) prose, two `hub` rows, a `send` row | `34.4, 36, 12, 28` | `30.4, 20, 20` |
| (c) long run mixing rows and prose-free turns | `36, 12, 28, 36, 12, 28` | `20, 20, 20, 20` |
| turn boundary + working line | `28, 48, 72.4, 34.4` | `20, 44, 72.4, 30.4` |

Two things to read out of the table. The AFTER column is constant inside every
run, which is what "uniform" means here — and it is structural rather than
lucky, because the `trace` tier carries no margin at all, so the row's own
height IS the pitch. And the turn boundary is still the widest gap in the last
row of the table: the hierarchy did not get flattened to buy the density.

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

## Declared, not swept

Three surfaces in this set cannot be regenerated by `pnpm capture-evidence`, and each
is therefore its own `supplementary` declaration in `manifest.json` — the same
mechanism `sidebar-new-chat` uses. A sweep DELETES every top-level entry no
declaration names, so without this they would be lost the first time anyone ran
the full sweep, and the manifest's arithmetic would stop matching the disk.

| surface | why a sweep cannot produce it |
| --- | --- |
| `spacing-uniformity` | the runs that preceded this change were driven by hand against the live app; there is no story for them |
| `real-conversation-tool-rows` | a bespoke harness over a real `/history` page from a real `serve` backend, never committed — the one surface whose durations still predate the `<0.1s` spelling |
| [`../tool-rows-baseline/`](../tool-rows-baseline/) | the before/after pair needs an older SOURCE TREE (unmodified `origin/main`), which a sweep of this tree cannot be |
