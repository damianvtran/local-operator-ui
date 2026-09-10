# TUI-parity tool rows and the working line

Frames of the rebuilt canonical tool row — the TUI's dense fixed-column ledger,
ported to this app's own medium — and of the working line that replaced the
three pulsing dots.

Two capture surfaces, and the difference matters when reading them:

- **Storybook frames** (`states`, `names-and-fallbacks`, `narrow`,
  `working`, `working-labels`) render the **production `CanonicalTranscript`**
  from fixture `TranscriptRecord`s. They cover the states that are slow or
  awkward to produce live: an interrupted call needs a turn stopped at exactly
  the right moment, an `mcp__*` row needs a server connected, a narrow row needs
  a resize. Captured over CDP with `scripts/check-evidence.mjs`'s own
  `assertFramePaints` guard.
- **`real-conversation-tool-rows`** is the **real Electron app** — the app's own
  compiled main and preload, its real `window.api` IPC bridge, its real
  `BrowserWindow` — showing one of the operator's actual conversations served by
  a real `local-operator serve` backend.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| [`states`](states/) | Every outcome in one column: success, a write with `+42 -11` diff counters, a failure on the danger ground with a cross, an interrupted call with the slashed circle, and a running `web_fetch` with a live clock and **no** outcome glyph. The empty status column is what says "still running". |
| [`names-and-fallbacks`](names-and-fallbacks/) | Long builtin names, two `mcp__linear_*` calls displaying as just `create_issue` / `list_issues` with the plug glyph, and unknown tools (`some_custom_tool`, `team`, `eval`) taking the wrench. The wrench and the plug are deliberately different marks: "I do not know this tool" and "this came from a server you connected" are different answers. |
| [`narrow`](narrow/) | The same rows at 420px. The shed ladder is visible: the `edit` row's `+42 -11` counters are **gone**, the summaries truncate with an ellipsis, and the outcome glyph and duration survive — they are the last thing to go, not the first. |
| [`working`](working/) | The working line under a running tool row. The row states the ARGUMENTS and that call's own execution time; the line states the KIND of work and the phase age. They do not restate each other. |
| [`working-labels`](working-labels/) | Every label the line can carry — `thinking`, `responding`, `composing a call`, the model's own sanitised intent, and `running 3 tools` for a batch. No trailing ellipsis anywhere: the clock is what says it is ongoing. |
| [`real-conversation-tool-rows`](real-conversation-tool-rows/) | The real app, real backend, real conversation: 41 real tool rows including a live turn caught mid-flight (a running `bash` row with no outcome glyph, and the working line reading "Verifying nexus MR 69"). **STALE — see the warning below.** |

> ⚠️ **`real-conversation-tool-rows` predates the D1 fix and still shows the
> defect.** The frame was captured at `2e83b46f9`, where a durable tool row
> whose arguments arrived on another page settled with a blank object column;
> the run of nine identical unlabelled `bash` rows in it is that bug. The fix
> is in `transcript-reducer.ts` (session-wide `argsByCall`) and a renderer-only
> fix cannot retroactively repair a captured PNG, so the picture disagrees with
> the build until the live harness can be stood up again.
>
> What replaces it as evidence, until then, is a measurement rather than a
> picture — and on this particular claim the measurement is the stronger of the
> two, because it covers six conversations instead of one screenful. The
> shipped reducer was replayed page-by-page over six real transcripts and the
> blank-summary count compared against the reviewed head:
>
> | Session | Tool rows | Blank at `2e83b46f9` | Blank now |
> | --- | --- | --- | --- |
> | `c53d69f9033b` | 418 | 14 | 0 |
> | `aa7355037e1f` | 402 | 10 | 0 |
> | `8b5a3a71e677` | 293 | 8 | 0 |
> | `37f60b478edd` | 293 | 5 | 0 |
> | `1443d08ba7c9` | 238 | 7 | 0 |
> | `83fdf0935d46` | 222 | 7 | 0 |
> | **Total** | **1,866** | **51** | **0** |
>
> Both halves contribute: `argsByCall` recovers the arguments for rows whose
> assistant entry fell on another page, and the two rows left with nothing to
> say fall back to the output's first line rather than rendering empty.
| [`spacing-uniformity`](spacing-uniformity/) | The three runs the operator screenshotted when he called the spacing "much too wide" and "not very uniform", reproduced as a regression surface: four consecutive settled rows, an assistant line followed by `hub`/`send` rows, and a long run mixing tool rows with prose-free tool turns. Every adjacent like pair sits on ONE pitch. |
| [`turn-boundary`](turn-boundary/) | The hierarchy that survives the tightening: two ledger rows, a user turn, an agent reply, and a running row with the working line under it. Tightening a run is only correct if the reader can still see where a turn began. |

Both brand themes for each. The 12-theme sweep was **not** regenerated — see
`manifest.json`'s `partialCapture` — but the five story ids are registered in
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
