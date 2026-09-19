# TUI-parity tool rows and the working line

Frames of the rebuilt canonical tool row — the TUI's dense fixed-column ledger,
ported to this app's own medium — and of the working line that replaced the
three pulsing dots.

Two capture surfaces, and the difference matters when reading them:

- **Storybook frames** (`states`, `names-and-fallbacks`, `narrow`, `working`,
  `working-labels`, `compacting-rung`, `compacting-settled`,
  `compacting-settled-unchanged`, `compacting-refused`,
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
| [`compacting-rung`](compacting-rung/) | A compaction pass in flight. The rung is the ONLY thing on screen that says so — `compacting context`, the terminal host's own label for the same fact — and it has a phase of its own, which is what the clock times. This is the half of the change that replaced `/compact`'s modal dialog: the dialog used to be the surface's whole answer to the command, and it stayed up over a pass that had already finished. The frame is the state the transcript could not previously express at all. |
| [`compacting-settled`](compacting-settled/) | The same transcript once the pass has settled: the rung is gone and the reducer's own info line — `Context compacted, 41.0k to 9.0k tokens` — is what took its place, carrying the counts the backend reported. The pair is one change, so the two frames are its before and after; the dialog this replaces lived between them, and the frames of it are in [`../chat-compact-dialog-before`](../chat-compact-dialog-before/). |
| [`compacting-settled-unchanged`](compacting-settled-unchanged/) | The same settled line where the pass's two figures round to the SAME step: it says the number once (`Context compacted to 52.7k tokens`) rather than `52.7k to 52.7k`, which reads as "changed nothing" (UX round 1, U4). Deleted for one round while the copy carried no figures at all; the rule prints the pair again, so the branch and its frame are back. |
| [`compacting-refused`](compacting-refused/) | The third ending: a pass that did NOT run. The row is the runtime's own sentence for a declined pass, on the tier its shared helper derives (`warning`), and this frame is a picture of the INK rather than of the projection: the records are handed to the frame by hand, so it cannot evidence the `durableRecord` path that paints a `compaction_refused` entry off a history page — that path is pinned by `scripts/transcript-reducer.test.mjs` ("a refused pass paints the runtime's own row, in the tier it derives"), which is where a reader checking U1 should look. |
| [`working-labels`](working-labels/) | Every label the line can carry — `thinking`, `responding`, `composing a call`, the model's own sanitised intent, and `running 3 tools` for a batch. No trailing ellipsis anywhere: the clock is what says it is ongoing. |
| [`real-conversation-tool-rows`](real-conversation-tool-rows/) *(declared, not swept)* | The shipped reducer and transcript over a real backend and a real conversation, paged oldest-first in 20-entry pages: **38 real tool rows, 0 blank object columns**, every row on one pitch, 38 `sr-only` outcome labels. These frames predate the 2px hairline and so show the run at the 20px pitch; what they evidence is the arguments and the outcome labels, not the current spacing — for that, see `operator-spacing-cases` and `trace-gap-boundaries`, which a sweep retakes. Every row carries its own arguments — the defect this replaced showed a run of unlabelled `bash`/`wait`/`task` rows. |
| [`joined-mid-turn`](joined-mid-turn/) | The reported defect, at the only moment it is visible: a viewer that joins a turn already in flight. The owner's seed keeps the settling frame of every call that finished before the viewer attached and drops the start it replaces, and the settling frame carries no `args` — so a run of rows used to read `exit code: 0`, the file's first line, or `result: None` instead of the call. Six rows: one whose row is recreated by that settling frame after a receipt gap (it must still say the command), one whose arguments are genuinely unknown with a result opening on the harness's own `exit code: 0` wiring, a `read` in the same state, a call that printed NOTHING (so the object column is deliberately EMPTY rather than quoting the producer's `(empty)` section body), a stand-in line long enough that the column truncates it, and a control row whose arguments arrived normally. Records are built by the PRODUCTION reducer in the order the session hook applies them. Where a row shows a line of its RESULT rather than its own object, the line is marked with a leading `…` — the design round's D1 — so a column that is normally a command cannot be misread as one. The same story captured from UNMODIFIED `origin/main` (`2217ea59a`) lives in [`../tool-rows-baseline/`](../tool-rows-baseline/), with the row-by-row pair and the one-line reproduction: rows 1 and 2 read `exit code: 0` there, which is the reported defect. |
| [`operator-spacing-cases`](operator-spacing-cases/) | The same three runs as a STORY, so they are re-captured by every sweep: four consecutive settled rows, an assistant line followed by `hub`/`send` rows, and a long run mixing tool rows with prose-free tool turns. Every adjacent like pair sits on ONE pitch — 20px of row plus the 2px hairline. |
| [`trace-gap-boundaries`](trace-gap-boundaries/) | Where that hairline applies and where it does NOT, which a run of identical rows cannot show on its own: a margin carried by every row would photograph the same. Three blocks — a LONE call between two paragraphs (no ledger neighbour, so no hairline, `item` either side); a NOTICE inside a run (`trace`-like, so every adjacent pair takes the same 2px GAP — which is the claim, and all of it: the block measures `22, 23.7, 22`, because the notice's own line box is taller than a 20px tool row. The gap is uniform, the pitch is not, and that difference predates this tier); and a run OPENING a turn (the 24px boundary sits above its first row, the hairline only from the second). |
| [`spacing-uniformity`](spacing-uniformity/) *(declared, not swept)* | The three runs as they were captured by hand for the spacing round: a short run of settled rows, a `hub`/`send` run, and a longer mixed run. Every inked band in these frames is a ledger row or its trailing timestamp — there is no prose in shot, so the assistant line that sets the middle block's pitch in the story above is NOT part of what this pair evidences. Its sibling above is the same claim as a story; this is the pair the operator's own screenshot was compared against, and what it holds is what those frames show, not the story's fuller set. |
| [`turn-boundary-and-working-line`](turn-boundary-and-working-line/) | The hierarchy that survives the tightening: two ledger rows, a user turn, an agent reply, and a running row with the working line under it. Tightening a run is only correct if the reader can still see where a turn began. (The older `turn-boundary/` frames were removed: they came from a story title that no longer exists, so no sweep could refresh them.) |
| [`prose-tool-alignment@1024`](prose-tool-alignment@1024/), [`@1440`](prose-tool-alignment@1440/) | Agent prose and the ledger sharing ONE left rail and ONE right edge, with prose both BETWEEN tool rows and as a final answer. The operator reported the answer as inset and narrower than the tool calls; it was capped at a reading measure and then centred inside the row it owns. Measured here, the answer and the tool row now span the same 102..962 at 1024 and 310..1170 at 1440 — left and right deltas both 0, where they were 156.6px each before. Two widths because a max-width cap only binds on a wide column, so one narrow capture would photograph the defect as absent. The user bubble is in frame as the control: it keeps its own narrower measure, and the stamp under it follows that bubble — which, on a user row, is the same right edge as the row's, because the row is `flex w-full justify-end` with no right inset (review round 1, R2/D3: measured 0.0px apart on 420/1024/1440; what § 7 distinguishes on a user turn is the bubble's LEFT inset). |
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

## The category inks, and this set's re-capture on the `fix/trace-category-ink-rebased` branch

**Why the frames in this set were re-shot (PR #391, round-1 remediation).** The
branch gives the settled row its CATEGORY ink back — `read` -> `info`, `meta` ->
`accentAlt`, the rest the neutral ramp — and the set a reader opened still showed
the ink it replaced, so the operator's own report was reproducing in the
repository's own evidence. Every frame below was re-captured from the branch's
own static Storybook build, in TWO passes that this lineage carries: the round-1
pass shot them at the tree this fold spells `4271c27c6` — the commit
`manifest.json`'s `head` names, whose `dirtyWorkingTree: true` discloses that the
round's own edits were uncommitted when the run started — and `5f0ff1ea6`, the
remediation commit that re-shot the ten directories this round's ink change
repaints, is where this set's shipped bytes come from. NEITHER SPELLING IS THE
CLAIM a later fold inherits: the claim is the derivation, and the derivation is
`git log --format=%h -1 -- docs/evidence/chat-tool-rows/states/<theme>.webp`,
which answers `5f0ff1ea6` for every frame in the ten directories below and an
earlier pass's commit for every frame outside them — so a fold that re-spells the
commits moves the hash and not the sentence. The PRE-REBASE spelling `2fe1f982`,
which earlier revisions of this note carried, resolves on no clone a reviewer
has, so this record does not cite it. Nor is "the tree that ships this" a claim
either pass can make on its own: the frames ship in THIS tree because every
commit above `5f0ff1ea6` is this record or its stamps, and a comment cannot paint
a pixel — which is the property that makes the citation a claim about `src/`
rather than about the tip's SHA.

**WHICH SETS CARRY THE TWO INKS, so a reader knows where to look.** The ledger's
category ink is visible in these, and they are the ones a round about the ink
needs:

| Set | What it shows of the ink |
| --- | --- |
| [`states`](states/) | the whole vocabulary in one column: a settled `read` (`info`), `bash`/`write`/`edit` neutral, an error on the wash ground, an interrupted `grep` (`info`, hueless mark), a running `web_fetch` (`accent`, live clock), and a never-run `hub` (`danger`) |
| [`names-and-fallbacks`](names-and-fallbacks/) | `read_variable`/`list_variables` in `info` beside `mcp__*` and unknown tools on the neutral — the ink at the right end of the name column |
| [`receipt-rows`](receipt-rows/) | the two RECEIPTS: `peer` and `wake`, which both take the neutral because a receipt is not a call (`_category_element` has one caller in the TUI, `ToolCard`) |
| [`operator-spacing-cases`](operator-spacing-cases/) | settled `hub`/`send` rows — the `accentAlt` identity ink at its own pitch, which no other story in this set carries |
| [`operator-spacing-cases-hovered`](operator-spacing-cases-hovered/) | the SAME story with the pointer parked on the first `hub` row: the identity ink on the row's own HOVER ground (`elevated`), the one pair no site of this role had painted before PR #391 |
| [`screenshots`, `screenshots-two`](screenshots/) | the composed run the operator's report came from |

`narrow` and `mixed-run` are re-shot alongside them and are the width and the
mixed-run cases for the same inks.

**The hovered pair, measured rather than argued.** `operator-spacing-cases-hovered`
parks the pointer on row `b1` and photographs what a reader's pointer meets: the
row's ground and its name. Read back from the frames, the band's modal colour
reproduces the palette's own `elevated` token in both themes checked —
`localOperatorDark` `#322D21` against the token `#322D22`, `monokai` `#38372F`
against `#39382F` — and the name's chromatic pixels are `accentAlt`'s, so the pair
the gate asserts (4.5:1 on that ground) is the pair in the frame. The floor itself
is asserted on the TOKENS, not eyeballed from the frame: a name is a few
antialiased strokes, so every pixel sample of it is a partial blend of ink and
ground and a ratio read from them would understate it.

**A frame whose story does not carry a settled `meta` row cannot show
`accentAlt` at all**, and most of this set's stories do not: `states`' only
`hub` row is never-run (so it takes `danger`) and `names-and-fallbacks` has no
`meta` tool. `operator-spacing-cases` is the one that does, which is why it is
named above rather than left to be found.

**The hovered set photographs ONE of the ten re-seated palettes, and that gap is
recorded here rather than left to be found.** `operator-spacing-cases-hovered`
sweeps the twelve-theme list — `dracula`, `dune`, `iceberg`, `localOperatorDark`,
`localOperatorLight`, `monokai`, `neon`, `obsidian`, `radient`, `sage`, `synth`,
`tokyoNight` — and of the ten palettes this branch re-seated so the identity ink
would clear the row's state ground, exactly ONE (`monokai`) is in it. So the six
the design round named as the worst for that floor — `kanagawaWave`, `oneDark`,
`nightfox`, `nord`, `solarizedDark`, `everforest` — have **no hovered frame at
all**: what the fix ships for them is a gate assertion over all fifty-nine
palettes plus one photographed palette, and a reader cannot LOOK at the six the
finding was written about. The floor is asserted numerically either way, which is
why this is recorded as a coverage gap rather than left as a claim of coverage;
closing it is one `--only` run —
`node scripts/capture-evidence.mjs <storybook-url> --only=chat-tool-rows--operator-spacing-cases --themes=kanagawaWave,oneDark,nightfox,nord,solarizedDark,everforest --allow-backend`
(the hovered entry is that story's `b1` variant, so the six frames land in this
directory) — and the reason it did not happen in this pass is the design round's
own measurement: its attempt died in the rig's launch/hang failure, the one
recorded under the traps below.

**The same move reaches a surface OUTSIDE this set, and its frames were not
re-taken.** Ten palettes' `accentAlt` moved in `5f0ff1ea6`, and `accentAlt` is
what the theme picker's miniature paints (`theme-selector.tsx`'s `ThemeSwatch`, a
`bg-accent-alt` bar beside the `bg-accent` one), so
`docs/evidence/settings-appearance/gallery/` still carries the
PRE-REMEDIATION fill on tiles of exactly the surface a reader opens to judge the
theme work — decisively for `ayuMirage`, `catppuccinMocha` and `nightfox`. No
sentence in THIS set's record could show that, so the disclosure, its measured
tile list and the command that closes it live in that set's own README
(`../settings-appearance/README.md`, section "The tiles this branch left stale")
and in `manifest.json`'s `themePortCapture.staleTilesNote`; this paragraph is the
pointer, not the record.

**What this re-capture does NOT carry.** The set's other directories were not
re-shot in that pass — the host was at load 90-295 for the window it ran in and
`capture-evidence.mjs` allows Chrome 30 s to report its debug port, which a cold
start on this machine missed repeatedly.

**THIS PASS'S OWN LIST, because `partialCapture` cannot give it.** An earlier
revision of this note sent a reader to `docs/evidence/manifest.json`'s
`partialCapture` "for a frame's provenance", and that field does not answer the
question it was being asked. Its `refreshedStories` is a UNION across every pass
the block records — 602 entries at this head — so a directory named there was
not necessarily touched by THIS pass, and a reader who took presence in that
list as "this pass re-shot it" would conclude backwards for most of them:
measured against this set, 41 of its 49 frame-bearing directories are named
there and **31 of those 41 belong to other passes**. What this pass rewrote is
the ten directories the ink change repaints — `states`, `names-and-fallbacks`,
`receipt-rows`, `receipt-hostile-sender`, `operator-spacing-cases`,
`operator-spacing-cases-hovered`, `screenshots`, `screenshots-two`, `narrow` and
`mixed-run` — and it is derivable from the tree rather than from the field:
`git log --format=%h -1 -- docs/evidence/chat-tool-rows/<dir>/<theme>.webp`
answers `5f0ff1ea6` for every frame in those ten and an earlier pass's commit
for every frame outside them. A directory not on that list still carries the
previous tree's ink.

**The set's most glanceable artefact is NOT in that list.**
`contact-sheet/tool-row-states.png` and `tool-row-states-colour-themes.png` were
not re-composed, so the sheet's "after" column still shows the HUELESS pass.
The sheet is labelled with its own head (`4755b126c`) and the section on the
colour-application pass explains the pair, so the sheet is not false — but a
reader who opens the sheet before the frames sees the pre-fix state under an
"after" heading, and that is worth knowing before the columns are read.

**Three traps for the next person who re-shoots this set**, all measured on this
host rather than inferred. (1) A `capture-evidence` run REWRITES
`docs/evidence/manifest.json` and leaves any theme outside the sweep's own list
as an untracked frame, so `node --test scripts/evidence-manifest.test.mjs` then
fails with `partialCapture claims N refreshed frames, but M committed frames
stand in the directories refreshedStories names at HEAD` —
`git checkout -- docs/evidence && git clean -f docs/evidence` restores it, and
that the same test is 35 pass / 0 fail on the restored tree is what shows the
failure is the rig's write rather than the environment (QA round 1, Q-4). (2)
The rig DELETES every `.webp` outside a declared set (`clearSweptFrames`,
`capture-evidence.mjs`), so a narrowed run against a tree whose frames are not
committed takes the committed ones with it: commit or stash first, and check
`git status docs/evidence` before the run. (3) The rig gives Chrome 30 s to
report its debug port (`capture-evidence.mjs:4765`); on a loaded host that line
failed four launches in five this round, and the one launch that got through
wrote nine frames and then hung in a CDP await for twelve minutes without
reporting — its browser was reaped by exact pid, which is why none was left
behind.

## The turn stamps (the `feat/transcript-timestamps` branch)

Two frames are NEW in this set, and the rest of it was re-taken because the same change
paints in them.

| Frame | What it shows |
| --- | --- |
| [`turn-timestamps`](turn-timestamps/) | All four shapes of the formatter in one column — `12:14 PM` for a turn from today, `Yesterday 8:14 AM`, `Aug 27, 2:14 PM` for a day this year, and `Sep 12, 2025, 3:42 PM` for last year — plus an OPEN call whose stamp sits at the foot of its pane, and the CLEAR beside it: a call with nothing to disclose, which is a line with no stamp at all. The last of those is half the design (the operator asked for the time "below the card", and a ledger that stamped every row would undo the quiet the hover model bought), so a frame holding only the stamped rows could not show it. |
| [`turn-timestamps-narrow`](turn-timestamps-narrow/) | The same stamps in a NARROW COLUMN (420px at `isSmallView={false}`, so the bubble takes the comfortable `max-w-[75%]`; the small view is pictured by [`admitted-send-before-first-frame-small-view`](admitted-send-before-first-frame-small-view/)). It is here because the transcript is a different shape at that width, not because the placement could be confused: a user row has a single right edge, so the bubble's and the row's are the same line. |

The instants in `turn-timestamps` are **relative to the capture** — last year's date is fixed,
the rest are offsets from `Date.now()` — which is the only way `today` and `Yesterday` can be
photographed at all: they are calendar facts about the moment of reading, so a fixed fixture
would photograph a stamp still reading `Sep 12, 2025` a week later. Everything else in this
set keeps the fixed `TS` fixture for the opposite reason, and the instants here are the only
part of the two frames that moves between runs. A re-capture therefore reads the same four
shapes with different numbers, which is correct rather than noise.

### What moved, and what the pair is

Every frame this branch re-took MOVED, and it is worth saying why rather than leaving a
reviewer to guess at the diff: the stamp adds a line to the block it is under, and the
transcript is bottom-pinned (`flex-col-reverse`), so a stamp under a user turn shifts every
row above it. The movement is therefore a layout shift plus about a thousand pixels of text,
not the text alone. The smallest movements are the surfaces with the least content above the
change: `expanded-failed-edit` 4,133px, `reader-pending` 5,082px, `roster-members` 5,992px;
the largest are the dense transcripts (`mixed-run` 271,611px, `mixed-prose-code-and-tables`
267,907px, `expanded-detail` 226,822px of a 1280x760 frame).

THE BEFORE HALF is [`../turn-stamps-before/`](../turn-stamps-before/), declared as its own
supplementary set because a sweep captures the current tree and can never produce it: it is
`expanded-detail` and `prose-tool-alignment` at both widths, captured by this same harness in
a worktree checked out at this branch's base (`0c04cbb09`), with every frame byte-identical
to the committed copy of that path. Two stories were chosen and one dropped, and the reason
is in that set's README: `turn-boundary-and-working-line` carries a live spinner, so its
frames are not reproducible and a diff there would not separate the stamp from the working
line.

### Two rules the frames are the evidence for

- **The stamp is OUTSIDE the pane's scrollers.** `ToolDetail` caps each of its two sections
  and prints a `detailOverflowLabel` under it, deliberately outside the scroller so the
  report stays true at rest. A stamp inside either section would be off screen on a long
  payload — visible in the frames as a stamp that sits under the pane's own border, and in
  `expanded-overflow` where the sections are at their caps.
- **The footer no longer repeats a clock the turn above it already states.** The
  transcript's own footer stamp is gated to last rows that paint no stamp of their own: a
  user turn (its stamp is the line above), or a ledger row the reader has left OPEN, whose
  stamp sits at the foot of the expanded section. A CLOSED last ledger row keeps the footer,
  since nothing else on screen states the time there. The gate was raised because a
  conversation asked and not yet answered printed the same clock twice with nothing between
  them — which is what these frames caught on their first take and what the `admitted-send-*`
  frames would otherwise show — and its second half is the open row, found in review round 1
  (D1/Q-1) and made a membership test in round 2 (R2-1/D2-1).
  **THE FOOTER ITSELF IS NOW GONE** — the gate below was a gate on a line that no longer
  exists, and the section *The footer's removal* carries that report, the frames it moved and
  why the gate could not survive it.
- **And it states that time in the same words.** The footer line answers the same question a
  turn's stamp answers, so it renders the same component; it used to render the HOVER row's
  `MessageTimestamp`, which formats for a reader already looking at the message, and the two
  shapes met in one column as `2025-10-09` directly under `Oct 9, 2025, 4:53 AM` — visible in
  [`../chat-notification-feed-states/cached-paint/`](../chat-notification-feed-states/cached-paint/),
  where the same frame now carries three stamps in one shape. This is the defect class
  `date-utils.ts` records in `formatCalendarDate`'s own comment (`August 5, 2026` beside
  `8/5/2026, 10:40:00 AM`), so it is fixed here rather than left as a follow-up.
  **What that second pass moved, measured** (`magick compare -metric AE` against the frames the
  first pass committed): **97 frames, 28px to 50,981px**, every one of them a frame with a footer
  stamp in it. The two new stories are the one case where the movement is NOT the footer alone:
  their instants are relative to the capture, so their clock reads a few minutes later than the
  first pass's (`2:14 PM` against `2:27 PM`) — which is those frames' documented behaviour rather
  than a defect, and the reason the pair's own comparison is made on the deterministic stories.

### Theme coverage for this pass

Both brand palettes, which is this surface's own rule (see *What these frames do NOT prove*).
The same change paints in four other surfaces, re-taken in their OWN theme sets rather than
this one's: `chat-ask-options` (twelve palettes), `chat-notification-feed-states` (three),
`chat-reconnect-gap` (twelve, and `restored-running` gained the ten it did not have rather
than being left stale), and `chat-run-panel`'s reader states (two).

## The footer's removal (the `fix/turn-stamp-scope` branch)

The transcript's footer line is **removed**, not gated a third time. It stated when the last thing
in the conversation happened, and the operator reported on 2026-09-17 that during a live turn it
painted under the working line: "the time that shows up below messages also seems to be showing up
below the thinking indicator, make sure that it doesn't, only beside user messages and in tool
traces when expanded". Every gate the line had asked WHICH ROW came last, and the row that comes
last during a turn is the working line — not a record, and not something the gate could name — so
the fix is the removal of the line rather than a third condition on it.

WHAT SURVIVES is exactly the two placements the operator named, and both are untouched:
[`turn-timestamps`](turn-timestamps/) (the stamp under a user turn's bubble) and
[`expanded-detail`](expanded-detail/) (the stamp at the foot of an open disclosure) are this pass's
controls and are **not re-encoded at all**.

### Which frames moved, and how they were found

**60 stories across eight surfaces**, counted against the BASE this branch was folded onto rather
than against `origin/main` — which is the correction review round 2's R2-1 asked for, because
`origin/main` moves and the number does not. The eight are this one, `chat-canonical-notices`,
`chat-canonical-quote`, `chat-notification-feed-states`, `chat-phantom-compose-rows`,
`chat-reconnect-gap`, `chat-run-panel` and `chat-stale-seed-order`. Reproduce it with the diff
itself, against the named base:

```
BASE=$(git merge-base origin/main HEAD)   # the commit this branch was folded onto; NOT origin/main, which keeps moving
git diff --name-status $BASE -- docs/evidence \
  | awk '$2 ~ /\.webp$/ {print $2}' | sed 's#/[^/]*$##' \
  | grep -vE 'turn-(stamp-footer|answer-stamp)-before' \
  | grep -vE 'chat-tool-rows/(answer-in-progress|prose-between-calls@(420|1024)|answer-then-statement)' \
  | sed 's#@[0-9]*$##' | sort -u | wc -l   # 60 stories (61 directories before the width pair merges)
```

`chat-trace-order-while-live` is NOT in that list, and it was in the first spelling of this section:
its frames are `main`'s own and nothing here moves them (`git diff --name-status $BASE --
docs/evidence/chat-trace-order-while-live` prints nothing). Review round 2 caught it by running the
command rather than reading it, which is the only way this kind of claim is ever checked — the 64/9
this replaced was a measurement of a different base, not of this branch.

The stories to re-take were chosen with a DOM query over the sweep's list, run against the capture
BASE tree, because a pixel diff cannot answer that question on its own: several stories carry a live
clock or a `Date.now()` fixture, so a capture of the UNCHANGED tree already moves them — the base tree
re-captured against its own committed frames differs by 36,166px in
`turn-boundary-and-working-line`'s light frame and 3,114px across the prose block of
`prose-tool-alignment@1024`'s dark one. Those two are inside the affected set anyway; the point is
that a diff alone would also have named frames nothing moved in.

The query is `document.querySelectorAll('time[data-stamp]')`, and each pass narrowed it to its own
carrier (`time[data-stamp="footer"]` for the removal, `time[data-stamp="answer"]` for the caption).
It is a DERIVATION, not the affected set: the query names which stories to re-take, the tree names
what moved, and only the second number is the one to hold these frames to. Review round 1's R2 found
two documents quoting 34/6 and 53/8 for "the same query"; round 2 found the 64/9 that replaced them
unreproducible for the same reason (a base nobody had named). This section and the manifest's
`turn-stamp-footer-before` entry now state the same query string and the same tree-derived number,
with the base in the command so neither can drift.

Each affected story's directory was re-taken **in the themes it already carried** (twelve for this
surface, three for `chat-notification-feed-states`, two for the rest), so this pass moves frames and
adds none: the tree's added frames are the three new stories' 38 and the two before-halves' 14, which
are the 52 the manifest's `supplementary` list declares.

THE PAIR is [`../turn-stamp-footer-before/`](../turn-stamp-footer-before/), declared as its own
supplementary set for the reason the previous pair is: a sweep captures the current tree and can
never produce the base tree's frames.

### The measurement, rather than "the footer is gone"

- **The removed line, measured on a story with no clock in it.** `prose-tool-alignment`, both widths
  and both brand themes: the whole difference between the two trees is the stamp's own box —
  `138x26` at `+838+358` for `@1024` and at `+1046+358` for `@1440`, AE 2,721 / 2,165 (dark / light)
  at 1024 and 2,673 / 2,431 at 1440. Nothing else in those frames moved, which is what makes the
  pair checkable rather than asserted.
- **The reported state.** `turn-boundary-and-working-line`, the stamp's own band (`300x30+700+320`):
  **472 ink pixels before, 0 after** in `localOperatorDark`; in `localOperatorLight` the same band's
  mean luminance moves off the ground the other way, 0.9293 to 0.9464. Read as a picture, the before
  half ends `⠹ Measuring the row pitch 1s` with `Oct 9, 2025, 4:53 AM` under it, and the after half
  ends at the working line.
- **The two survivors, unmoved.** Neither control is in the re-encoded set, the probe finds no footer
  in either on either tree, and the capture's own noise floor there is 0px on `expanded-detail`'s
  light frame and 29px in an 8x8 box (a glyph edge) on its dark one.

### What the removal costs, stated rather than found later

A transcript ending on assistant prose, or on a settled tool row nobody opened, now shows no time at
its foot. Both end on a row whose own affordance is the disclosure, and that is the trade the
operator asked for; it is also why the render tests' footer assertions were **inverted rather than
deleted** (`scripts/turn-timestamp.test.mjs`), the working line's own case among them.

## The agent's answer gets a caption (the same day, the same branch)

The operator reported the other half of the same surface hours later:

> "The agent responses (just the final responses, not the in-progress tool intent/response) don't
> have a time displayed on them — that would be helpful to show too. It should probably be on the
> left under the agent message instead of on the right."

So every SETTLED agent answer carries an always-visible stamp under it, left-aligned on the agent
rail — the mirror of the user side's caption, with the same `TurnTimestamp`, the same caption roles
and the same 4px of air. Two things about it are decisions rather than consequences:

- **`streaming` is the discriminator, not "the last row" and not the stop reason.** A record still
  arriving is the working line's job (§ 7's one liveness element per turn), and a stamp on it would
  state a time for a message that has not finished being one. A settled answer in the MIDDLE of a
  turn is still an answer the agent gave, so it keeps its caption; and a durable entry may carry a
  null stop reason, which is why `stopReason === "toolUse"` is not the test either.
- **It is a sibling of the answer's content box, not a line inside it.** `turnRef` is what the quote
  toolkit reads, so a selection drag over an answer must not be able to sweep a clock into a quote.

### The three frames that carry the claims

| Story | What it shows |
| --- | --- |
| [`answer-in-progress`](answer-in-progress/) | The in-progress half of the operator's sentence, and this round it is stronger evidence than it was: a user turn with its caption, a SETTLED narration (`Reading the ledger first.`), the call it narrated, and an answer still arriving (`Four were late, and the oldest is 41 days`) — and **no caption on any row of the turn**, because the turn has not handed its answer over yet. The working line is the only liveness element (§ 7). |
| [`prose-between-calls@1024`](prose-between-calls@1024/), [`@420`](prose-between-calls@420/) | The shape the caption's COUNT has to survive: three intermediate paragraphs interleaved with the calls they narrate, plus a closing answer. **One** caption in the turn, under the answer it ends on, at two widths (it was four before review round 1's D1). |
| [`answer-then-statement`](answer-then-statement/) | A statement row between the answer and the next turn — a notice and a peer receipt — where the first gate painted **nothing at all** for the turn, because a statement carries no `<time>` of its own and has no disclosure to open (design round 2's D2-1). Both answers keep their caption now, and the statements below them stay unlabelled. **This frame is new for that reason:** the reviewer could not find a committed real-session frame showing the shape, so this PR owns one. |

### The noise question, answered on the pixels rather than in prose

`prose-between-calls` is in this set because the operator asked, in the same message that requested
the caption, what that shape looks like — and the answer changed once the frame was judged rather
than argued:

- **Four captions in one turn, and in this fixture they read as noise** — that was this frame's first
  state, and design round 1's D1 is the finding it produced. The four were literally the same string
  (`Oct 9, 2025, 4:53 AM`), because the story's records share one `ts`; in a live turn they would
  differ by the seconds between the paragraphs, which is a slightly different annoyance rather than a
  smaller one. Between two of them sat a ledger row, so the turn read as
  caption-line-caption-ledger-caption, a stamp between every paragraph at the same visual weight as
  the durations it sits beside.
- **The count is bounded by the content, not by the rows.** A record with nothing to say paints
  nothing (`paintsSomething`), so a turn that goes quiet between calls adds no caption — the
  `working`, `streaming-before-first-token` and `compacting-*` frames are that case. The noise is
  therefore specific to a turn that TALKS between its calls, which is the shape a chatty agent
  produces routinely and this fixture reproduces.
- **What removed it, and HOW it was decided:** captioning only the answer a turn CLOSES on rather
  than every settled prose row. That is implemented — `closingAnswerIds` in
  `canonical/transcript-rows.ts`, whose docstring states the two conditions — and this frame is now the
  ONE-caption state. The decision was made on pixels rather than argued from the sentence, which is
  what the frame was for: the operator's request names the row ("the agent responses", plural) while
  his in-progress exception is stated as a property of the record, so both readings were live until the
  designer rendered this alternative from the same story (4 captions → 1, same left edge, same
  ink/role). Design round 2 then found the one case the first version of THAT rule got wrong — a
  statement row after the answer stripping a caption that had nothing to replace it
  (`isStatementRow`, and the `answer-then-statement` frame in the table above).

### Where the caption's left edge is, measured rather than assumed

The caption shares the answer's left rail because it is a sibling inside the same `pl-10` box the
prose starts at — structural, not a second measurement. The frame is what checks the structure:

| Story | Prose ink's left edge | Caption ink's left edge |
| --- | --- | --- |
| `prose-tool-alignment@1024`, `localOperatorDark` | 103, at y 364..375 | 102, at y 388..394 |
| `prose-between-calls@1024`, `localOperatorDark` | 103, at y 182..194 | 102, at y 210..218 |

A one-pixel difference is the glyph's own side bearing at 12px versus 16px, not a rail: which is the
point, since a caption placed by its own rule would be off by whatever the two rules disagreed about.
(The rows above exclude the agent turn's 28px avatar, which sits at x 68..70 in the gutter those two
edges are measured past — the measurement is the prose and the caption, not the icon.)

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

## The colour-application pass (18 September 2026), at head `4755b126c`

`states/` IS RE-SHOT at this head across twenty-eight themes, and the change it
photographs is the one the row's own docstring states: **identity is hueless and
only the state carries colour**. The tool GLYPH and the tool NAME used to be two
expressions — the glyph read `running ? accent : failed ? danger : ink-dim` while
the name read a five-entry category map — which is what shipped `task`/`hub`/`todo`
with an accent name beside a grey glyph, and grey glyphs on every settled row
(the operator's own report: "the icon is not colored but the tool name is
colored"). Both now read ONE expression, so this board's settled rows are all
`ink-muted` whatever their category, `running` is `accent`, and `error`/`not-run`
are `danger`. Category is carried by the glyph's SHAPE, which already differed per
category; the category-to-hue table is deleted rather than extended.

- **The before column is `origin/main`'s own committed frames** for the same
  story and theme, not a re-shoot of this pass, and it exists at the sweep's
  twelve-theme spine only — that is the set `main` committed for this directory.
- **`contact-sheet/tool-row-states.png`** puts those two side by side over the
  twelve, and **`tool-row-states-colour-themes.png`** carries the head alone over
  the eighteen themes the brief's spread and `4755b126c`'s eleven re-solved
  palettes share. Both are composed with `magick` from these frames (the rig has
  no montage facility) with a fixed crop of the row band, so a column is a
  like-for-like.
