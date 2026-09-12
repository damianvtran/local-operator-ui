# The write/edit diff body — frames

Eight frames, two kinds of surface, and the honest boundary between them.
The law itself is in [`DIFF-BODY-SPEC.md`](DIFF-BODY-SPEC.md); this file says
what a reader can and cannot read out of these pixels.

| Frame | Viewport | What it shows |
| --- | --- | --- |
| [`diff-body`](diff-body/) | 1280 × 2110 | Seven rows in one frame: a two-hunk `edit` whose diff has additions, removals, context and two `@@` headers (including a REMOVED line whose content begins `--`, which a pattern-based header filter would silently delete); a new-file `write` (all additions, the nameless `---`/`+++` pair present in the payload); a `write` at the display cap with `… 4 more diff lines` under the 40th line; a `write` whose content did not change, keeping its ARGUMENTS because the producer omitted `diff` entirely; a FAILED `write` on the danger ground with the error in full; a composing `write` with no result; and a `bash` neighbour, so a regression in the ordinary args/output path is visible here rather than only in `states`. Each line carries its kind's ink END TO END here — a `+` line green, a `-` line red, `@@` muted, context dim — which is what the terminal's own loop paints and what this frame exists to show. |
| [`diff-body-narrow`](diff-body-narrow/) | 560 × 1380 | The same body in a narrow column: the wrap rule rather than the layout. Two cases — the two-hunk `edit` and the body at the cap — because under wrapping each body grows, and a picture of the rule cropped at the frame edge is not a picture of it. No horizontal scrollbar anywhere. |
| [`diff-body-narrow-wrapped-cap`](diff-body-narrow-wrapped-cap/) | 560 × 830 | The case the other two cannot show: a body AT THE CAP whose 40 lines are long enough to wrap, which is the shape that actually reaches the cap. The well clips 1415px of content into 738px, and the `… 4 more diff lines` marker is pinned to the well's foot so it is visible at rest — in the flow it would begin 648.6px below the clip (677px is the lift the pin applies, and this body's `maxScroll`; both quantities are labelled under "Measured, not eyeballed"), and the body would claim to be complete while 40 rows were hidden. If this marker stops being visible, this frame is where that shows. |
| [`real-durable-diff-rows`](real-durable-diff-rows/) | 1280 × 2734 | The same body over a REAL durable transcript: nine real rows of one of the operator's conversations around three consecutive `edit` results, folded by the SHIPPED `applyHistoryPage` and painted by the SHIPPED `CanonicalTranscript`. Two of the three diffs are longer than the display cap (197 and 58 lines) and one is shown whole (14 lines). |

Both brand palettes for each. The `write`/`edit` rows are opened the way a
reader opens them — the story and the harness CLICK the row's own disclosure
trigger, because the shipped transcript takes no "start open" prop. That is what
makes these frames evidence about the disclosure and not about a story-only
prop: if the trigger stopped reaching the body, every frame here would come out
collapsed.

## The two surfaces, and why both exist

**Storybook** (`diff-body`, `diff-body-narrow`) renders the production
`CanonicalTranscript` from `TranscriptRecord`s this repository builds. It covers
the states that are slow or awkward to produce live: a failure needs a real
failed call, a composing row needs a turn caught mid-dictation, a capped body
needs a diff longer than 40 lines.

**`real-durable-diff-rows`** starts one layer earlier, at the bytes
`/v1/desktop/sessions/{id}/history` serves. A story proves the component; only
this proves the payload reaches pixels. It is captured with:

```
node scripts/diff-body-evidence.mjs --session=<id> --anchor=<row id>
    [--before=4] [--after=4]
    [--themes=localOperatorDark,localOperatorLight] [--store=<dir>] [--port=5198]
```

`--session` and `--anchor` are **required** and have no default, deliberately:
these frames are a picture of a REAL conversation on the operator's machine, and
a session id committed here would both publish that and silently frame the wrong
rows on another machine. So say it plainly rather than let the README read as a
no-real-data claim: the rows in this frame are real tool results from one real
session, chosen because three consecutive `edit` results happen to have 197, 58
and 14 diff lines — the three shapes above. `CHROME_PATH` overrides the browser
if it is not at the macOS default.

The harness reads `<store>/<session>/transcript.jsonl` — the durable transcript
`read_transcript_page` reads, whose rows are serialised verbatim onto the wire
(`server/utils/desktop_sessions.py`) — takes a window of real entries around the
anchor, writes them to a **temp file**, serves them to a vite page mounting the
shipped reducer and transcript, drives a private headless Chrome over raw CDP,
and deletes the payload. No backend and no Electron are involved; the payload is
deliberately never committed, because a frame is evidence and somebody's
conversation is not a repository fixture. Two traps cost a round each and are
worth knowing before re-running it: the harness root is outside the renderer
tree, so `diff-body-evidence.css` must carry the explicit `@source` (without it
`sr-only` and `text-success` compile as nothing — the first frames showed the
outcome label's screen-reader text in the row and a diff with NO colour); and
the app's own `html, body { height: 100% }` makes `documentElement.scrollHeight`
report the window, so the viewport is sized from the height the harness
measured for its own frame.

## Measured, not eyeballed

The stills show the symptom; the numbers show the cause. Read out of the live
DOM in each surface:

```
diff-body @1280        bodies 356, 148, 739px      boxes 838/838, 838/838, 838/838  (scroll/client)
diff-body-narrow @560  bodies 476, 737px           boxes 418/418, 418/418
diff-body-narrow-wrapped-cap @560
                       1 row, 1 body: scrollHeight 1415 / clientHeight 738
                       (maxScroll 677), scrollWidth === clientWidth === 418,
                       line spans 41 (40 shown + the marker), marker top
                       709.61px in the well, its box flush with the well's inner
                       edge; in the flow that row would start 648.6px BELOW the
                       738px clip, and 677px is the lift the pin applies to it
real-durable @1280     5 rows, 3 bodies, 2734px    markers "… 155 more diff lines", "… 16 more diff lines"
                       first painted line "@@ -1120,2 +1120,194 @@"
```

Three things to read out of that. `scrollWidth === clientWidth` on every body is
the wrap claim: a diff line is long by nature, and a body that overflowed
horizontally would be CLIPPED by `overflow-x-hidden` — neither shown nor
scrollable — which is exactly what the first implementation did. The width pair
that found it was **610 against 418** at 560px, from a `whitespace-pre` on the
line span that overrode the well's `whitespace-pre-wrap`; the fix is the span
carrying `block` alone. And the marker text is quoted from the DOM rather than
read off the image: `… 155 more diff lines` is 197 body lines minus the 40 shown
minus the 2 header lines, and it is asserted against the producer's arithmetic in
`scripts/tool-row.test.mjs` rather than against the pixels.

The body's height ceiling is derived the same way. At `DIFF_EXPAND_MAX_LINES =
40` a body is 41 rows (40 lines plus the marker) of 17.4px at `text-mono-sm`
plus 24px of padding: `max-h-[740px]`. It was 720 for one round, and the frame
showed 39 lines with the marker clipped by 17px — a body claiming to be complete
while lines were hidden, caught by looking at the render and not by a green
test. The derivation holds for UNWRAPPED rows only, which is why the marker is
pinned and why `diff-body-narrow-wrapped-cap` exists; the numbers in both cases
are read out of the live DOM rather than asserted as CSS in a unit test.

The whole-line ink is measured the same way. The tightest pairs across the twelve
palettes are `success` on `sunken` at 4.58:1 and `danger` on `sunken` at 4.73:1
(both sage), inside the 4.5 floor and already asserted as text pairs by
`scripts/contrast-contract.mjs` (`AS_TEXT` against `canvas`/`surface`/`sunken`),
so a wholly green line is a pair this repo re-proves on every run rather than a
new unasserted one. A role WASH was rejected on the same measurements: no
contrast gain (`success` on `success-wash` bottoms out at 4.66:1) and it puts a
second ground inside a well whose point is being `sunken`. `DIFF-BODY-SPEC.md`
§ 4 carries the table.

## What these frames do NOT prove

- **Hover and focus grounds on a diff row.** The Storybook frames are at rest;
  the row's hover and focus grounds are the `states`/`spacing` surfaces' claim,
  not this one's.
- **The producer's 200-line truncation marker.** No committed frame contains a
  payload the producer itself capped with its trailing `…`; the real conversation
  used here has a 197-line diff, which is under the cap. That shape is covered
  by assertion (`scripts/tool-row.test.mjs`: the `…` is counted and painted as an
  ordinary dim line) and not by a frame.
- **The LIVE event path in pixels.** `tool_execution_end` carrying
  `result.details.diff` is asserted in `scripts/transcript-reducer.test.mjs`
  (extraction, the identity gate, and a replay whose `details` were stripped);
  `real-durable-diff-rows` only exercises the durable `provider_payload` half.
- **An HTTP round trip, Electron, or a packaged build.** The real frame reads
  the durable store from disk and renders it in a vite page; the desktop route
  that would serve the same bytes is not exercised. `docs/evidence/tool-rows/`
  carries the app-window frames that do reach a live backend.
- **Ten of the twelve themes.** Only the two brand palettes are captured.
  `pnpm check-themes` covers all twelve numerically (1910 assertions); these
  frames do not.
- **The tabs inside a real diff.** Real payloads contain tab-indented lines and
  there are THREE answers, not two. `rich.cells.cell_len("\t")` returns 0, so the
  terminal's own arithmetic counts a tab as zero cells while it paints an
  8-column stop; this browser advances a tab by 21.6094px against a 7.2031px
  space — exactly 3.0000 columns — because Tailwind v4's preflight sets
  `tab-size: 4` on `html, :host`, not the `<pre>` default of 8; and the app's
  other machine-voice blocks (`output-block`, the args block) inherit that same
  4. No `tab-size` is invented here. The frames show the resulting alignment;
  they do not argue it is right.
- **Keyboard reach into the scroll region.** The well is `overflow-y: auto` and
  has no tab stop: when a body scrolls, its remaining lines are reachable by
  pointer, trackpad and screen-reader virtual cursor, but not by Tab. That is the
  app's own scroll wells' behaviour (`output-block`, the args block) rather than
  something this body introduced, so it is an app-wide focus-model question, not a
  claim of these frames. (The wrapped-cap frame is at rest, scrolled to the top,
  which is the state the pinned marker is claimed for.)
- **An overlay cue on the pinned cap marker.** The marker's band is the well's own
  `bg-sunken` ground with the well's own bottom padding, so the wrapped
  continuation of the last visible line can sit under it with nothing on screen
  saying "this is an overlay": the reader's only signal that the body continues
  *there* is the marker's own `… N more diff lines` text, which is about the cap
  rather than the wrap. A cue would cost one line — a 1px
  `border-t border-hairline` on the pinned span, or a short `bg-gradient` fade
  above it. DEFERRED on purpose, not overlooked: `docs/branding.md` § 5 is
  explicit about defaulting to "more air and less chrome", which is the same
  principle that keeps a well on the `sunken` ground with a hairline rather than
  a shadow (§ 2, "elevation is a lightness step, not a shadow"); the band's
  ground already matches the well, so it reads as a band and not as a seam; the
  D2 verification measured no sliced or half-covered row; and the truncated line
  visibly ends on a comma, so it is not read as complete. The designer raised the
  cue as D6 in round 2 and its suggested forms are named here so it can be asked
  for: this frame is where such a change would be visible.
- **The neighbour frames, now `chat-tool-rows/*`.** This README was written when they lived under `tool-rows/`, which is the directory name the capturer derived before the story titles gained a `Chat/` prefix. The earlier note here - that a fresh capture put the transcript block 11px lower than the August frames - applied to THAT head: those surfaces were re-captured when this branch merged (they now come from the same head as these frames, and a fresh capture reproduces them byte-for-byte), so diffing them is now a fair test rather than a known offset.
- **That the operator's own machine renders it this way.** These are fixed
  viewport and device-scale captures; they cannot speak to his display, his zoom
  level, or a route nobody captured.
