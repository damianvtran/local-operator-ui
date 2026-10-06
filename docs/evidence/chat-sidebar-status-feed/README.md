# The sidebar's completion marks, on the machine-wide feed

The frames in this set photograph the conversation sidebar's rows as their
status arrives from the desktop feed rather than from a whole-catalogue read,
and — since the bulk read receipt landed — the one control that clears a pile of
unacknowledged completions.

## The feed stories

- **`gate-answered/`** — an approval answered on a row the operator is NOT
  looking at. The list said `approval` / "Approval needed"; the frame carries the
  post-answer code, so the glyph moves to the spinner between two polls.
- **`gate-parked/`** — the state the daemon leaves a session in when it stops
  answering, on the same row.
- **`completion-unseen/`** — a turn that finished while the reader was elsewhere:
  the green check the sidebar paints for an unacknowledged completion. **This
  story is also the pair's "after" half**: `chat-sidebar-status-feed-baseline/`
  is the same story captured from unmodified `origin/main`, where the pile of
  marks is present and there is no way to clear it in bulk.
- **`completion-moves-bin/`** — a completion that moves the row's TIME BIN
  (2026-09-28, the operator's report: "even if I've asked an older session
  something today, once it completes I can't see it within the today bin"): an
  older session starts under THIS WEEK "5d", the frames a finished turn always
  publishes land (a `session_status` edge and an `attention` mark — no
  `catalogue` frame at all, which is the point), and the row re-files under
  TODAY "1m" with its unread check. The still cannot carry the LATENCY the
  report is about; that is the live measurement below. ROUND 1 (design D2) fixed
  the story's own settle loop — it queried a `data-session-row` hook no element
  carries and could never observe the refile — onto the file's `[data-chat-row]`
  convention; ROUND 2 (R2-1) corrected the lookup's first form, which matched a
  native `title` no session row has carried since the row-space change (design
  D7), to the row's own TEXT (`scrollToRow` / `focusRow`'s shape), so the loop
  can break on the refile it exists to observe. No pixel changed, so the frame
  was not re-taken. The empty-section rail rule of the same round is not in this
  state (its subject is the row, not the panel).

## The bin move, measured live

Stills carry the poles; the promptness needs timestamps. The measurement is a
driver scene (`scripts/renderer-driver.mjs`, `--scene sidebar-bin-promptness`,
`--bin-expect prompt|stale`) against a scratch daemon the run owns
(v0.64.1), with a headless app built against it:

```
node scripts/renderer-driver.mjs --scene sidebar-bin-promptness \
  --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
  --seed-onboarding-complete --bin-expect stale|prompt \
  --out <frames> --window-size=1380x900
```

The scene creates the subject through the daemon's own routes, materialises it
with one real turn, then BACKDATES both clocks (birth record and transcript
mtime, 40 days) and reads them back from `sessions.list` before measuring
anything. It subscribes to `/v1/desktop/events` from its own Node process, so
the completion's `attention` frame is timestamped by the same clock that polls
the DOM for the row's `data-chat-section`.

**Before** (`--bin-expect stale`, base tree, subject carrying its unread mark
the way the operator's store does):

```
{"expect":"stale","completionFrameAt":2063,"completionAt":2029,
 "catalogueAfterMs":[],"subjectFrames":["attention@2063ms"],
 "binAt":28408,"lagMs":26345,
 "transitions":[{"at":28408,"section":"today","time":"now"}]}
```

The backend published the `attention` frame and NOTHING else — no `catalogue`
invalidation, because the completion moved no order key (the subject was
already in its completion band and the busy band was missed). The row sat in its
old bin for **26.3 s after the completion**, moving only at +28.4 s when the
sidebar's 30 s safety poll fired. That is the operator's report, measured.

**After** (`--bin-expect prompt`, branch tree, same steps):

```
{"expect":"prompt","completionFrameAt":1102,"completionAt":1103,
 "catalogueAfterMs":[966,1113],
 "subjectFrames":["session_status@965ms","attention@1102ms","session_status@1113ms"],
 "binAt":1103,"lagMs":1,
 "transitions":[{"at":987,"section":"running","time":null},
                 {"at":1103,"section":"today","time":"now"}]}
```

The row left for RUNNING at +987 ms on the busy edge, and the bin changed at
+1103 ms — **1 ms after the completion frame, 10 ms BEFORE the backend's own
`catalogue` frame at +1113 ms**. So the mover was the client's refetch on the
completion's own frames (`activityRevision` in `use-desktop-feed.ts`), not the
catalogue invalidation arriving behind it. The class of completion that
published no invalidation at all is the one measured above, and it now lands
inside the 2 s budget instead of the poll's 26 s.

## `wedged-owner/` — the row the operator reported, and the tooltip

A session whose runtime has stopped reporting, with a FAILED row directly under
it. Before this change the two drew the same `CircleAlert` in the same
`text-danger`; the pair is now the waves in amber against the ring in red, and
the adjacency is the whole claim — a separation is not visible in the fixed
state it produced. `wedged-status-baseline/` is the before half, on the tree the
branch was cut from.

The story is also the one place the row's **composed tooltip** is photographed.
A native `title` cannot be, and the remedy clause this change adds
(`· /stop if it stays silent`) lives only there, so the readout prints every
on-screen row's `title` — read off the document rather than rebuilt from the
store, like the readout's other measured lines. That line is asked for by this
story alone (`<Page tooltips />`): printing it in every story would grow every
other caption by a line, and nineteen re-taken directories to show a clause that
none of them is about.

## The bulk read receipt

"Mark all as read" (`attention.seen`, `POST /v1/desktop/attention/seen`) clears
every completion mark this client has rendered, in one request, from the group
heading the marks are under. It is gated on the backend advertising
`completion_ack_bulk`, and hidden when no row carries an unacknowledged
completion.

- **`mark-all-read-pile/`** — the operator's report: a pile of finished turns,
  each with its check, and the control beside the group's own count — its label
  naming the number the click will clear (`Mark all 3 read`), which is the set the
  request carries, because the same predicate produces both.
- **`mark-all-read-unseen-without-mark/`** — the operator's report from the other
  side, and the state that produced this control's own count fix: three rows that
  still carry `unseen` and a completion token, whose live state has taken the row
  over (a session waiting on its subagents, a parked approval, a runtime that
  stopped answering), so each draws a spinner, a gate or a "not answering" row and
  NONE draws a mark. There is no control and the readout says `0 unread row(s) it
  would name`, with `unseen, no mark drawn` printed per row so the frame shows
  both halves of the disagreement. Before the fix the same roster offered
  `Mark all 3 read`, because the count read `unseen` alone while the glyph read
  the runtime's derived `status.code` as well — and a click would have
  acknowledged completions that were never on screen, which nothing can undo.
  The readout's own line is the same one every frame in this set carries, so the
  absence is stated in words rather than left to be inferred from a missing
  button.

  **Its BEFORE half is photographed, and lives outside this set**:
  `chat-sidebar-status-feed-baseline/mark-all-read-unseen-without-mark/` is the
  SAME roster under `main`'s predicate (`unseen` plus a token, no code filter), and
  it is the operator's own screenshot — `Active chats 3 · ✓ Mark all 3 read` over a
  spinner, a gate and a "not answering" row, with the readout saying `3 unread
  row(s) it would name`. The pair is the state's whole claim: the control is
  offered over rows that draw no mark, and then is not. Its `source` in the
  manifest names what that capture staged and the two lines main's tree cannot
  compile (see below).
- **`mark-all-read-mixed-marks/`** — the marks the count KEEPS, and the one class
  no other frame in this set shows: an unseen `complete` (green check), an unseen
  `error` (danger alert, "Unseen error") and an unseen `interrupted` (warning
  pause, "Unseen interruption") — the three codes the runtime publishes while an
  unread completion stands — beside a busy row carrying the same unread state,
  which the control must not count. The header reads `Active chats 4 · ✓ Mark all 3
  read`, and the readout prints `unseen, no mark drawn` for the busy row. It is the
  frame that decides whether a failure row needs a read/unread step of its own
  (design D3): the alert glyph and its ink do not move when such a row is
  acknowledged, so what a bulk clear changes there is the section the row sits in
  and the label behind the tooltip — not a pixel of the row.
- **`mark-all-read-partly-read/`** — the state the whole per-item verdict exists
  for. Two marks cleared, one REFUSED (`superseded`: the conversation completed
  again between the render and the click, so the token this client held is no
  longer current and nothing was written). The remaining check is still there and
  the receipt names it rather than claiming the pile was cleared.
- **`mark-all-read-cleared/`** — the pile gone, the receipt sentence in the
  toast, and the control itself absent, because an action with no subject is not
  offered.
- **`mark-all-read-unsupported/`** — an older backend: the marks are all still
  there and the capability that would let this client clear them is not
  advertised, so no control is rendered. Clicking a control that answers 404 is
  the shape this gating exists to prevent.
- **`mark-all-read-loading/`**, **`mark-all-read-failed/`**,
  **`mark-all-read-empty/`** — the three states in which there is nothing to
  clear: a catalogue read that has not answered, one that failed, and a machine
  with no conversations. Each frame is an ABSENCE claim, which is why the readout
  beside the panel states the control's own state in words —
  `Bulk read receipt: absent · 0 unread row(s) it would name` — rather than leaving
  a reviewer to infer it from a missing button.
- **`mark-all-read-narrow-default/`** (280px panel) and
  **`mark-all-read-narrow-minimum/`** (240px) — the app's own clamps
  (`chat-layout.tsx`; 280 is the default preference), and the widths at which the
  action's label SHEDS so the group's own name never breaks to make room for it.
  The shed fires on the header ROW's width — 271px and 223px here — against the
  253px row a two-digit section badge leaves the name (design round 2's own sweep:
  at 250/251/252px rows the name was ellipsised with the action fully spelled).
  A set captured only at 360px, the clamp's maximum, cannot photograph this state
  at all.

  The shed is `sr-only`, never `hidden`, and that is the whole of review R2-1 /
  UX U2-1: `display: none` would take the label out of the accessibility tree,
  leaving the `sr-only` scope suffix as the control's entire computed name
  (", including 4 in Previous chats", with the `title` demoted to a description),
  which is the width the operator shrinks the panel to. The readout's
  `Action label:` line is the instrument for that fact and says which of the two
  it found: it asks the sheet whether the span is laid out, because `textContent`
  reads the same either way — which is how a frame claiming an intact name survived
  review round 1.
- **`mark-all-read-in-flight/`** — the interval between the click and the receipt,
  which is the only progress cue an irreversible write has. The label keeps its
  readable ink and only the glyph steps down, and the control stays focusable and
  in the ring (`aria-disabled`, not `disabled`).
- **`mark-all-read-refused/`** — the transport failing: both facts in one toast,
  because the question an irreversible action raises is "did it happen?" rather
  than "what is the backend doing?". Every check is still on screen behind it.

## What produced these frames

Storybook, through the repo's own `scripts/capture-evidence.mjs`:

```
npx storybook dev -p 6037 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6037 \
  --only=chat-sidebar-status-feed-- --allow-backend
```

`--allow-backend` is required while the operator's own backend is answering on
the default port (1111): the capturer's pre-flight guard refuses to run against a
live one, and these stories stub their own transport, so no frame can show any
backend's replies. The frames in this set were taken on port **6037** because
6017 and 6027 were serving other sessions' worktrees at the time — the port is
the capturer's first argument and nothing about the frames depends on it. Both
lines are the command that actually produced them; a README that records a
different command from the run is a claim a reproducer cannot trust (agent review
round 1, R6).

Both states this round added came from the same two lines, narrowed:
`--only=chat-sidebar-status-feed--mark-all-read-unseen-without-mark` and
`--only=chat-sidebar-status-feed--mark-all-read-mixed-marks`. The
`completion-moves-bin` state arrived in a LATER pass (2026-09-28, the bin
report) from the same two lines on port 6047 —
`node scripts/capture-evidence.mjs http://localhost:6047
--only=chat-sidebar-status-feed--completion-moves-bin --allow-backend` — and
the commands above remain the record for the states that pass produced. **The first capture
after a story file changes FAILS, on a cold Storybook**: the theme wait gives the
page 10 s and a cold vite transform of this component graph outlasts it
(`document carries theme "" after 10s`). Re-running the same command succeeds —
the second run compiles nothing new — so a first-attempt failure here is the rig
warming up rather than a story that does not render. Every capture in this round,
including the before half below, succeeded on its second attempt.

The BEFORE half of `mark-all-read-unseen-without-mark` is deliberately not in this
directory: it is the same-named state under
`chat-sidebar-status-feed-baseline/`, captured in a detached worktree of
unmodified `origin/main` at `896b19134` with this branch's story file staged in
and exactly two things patched — the per-row readout marker back to main's own
`row.attention?.unseen` spelling (main has no `unreadMarkKind` to ask), and the
story's `play` inverted to assert the control IS present and reads `Mark all 3
read`, which is the defect it photographs. The mixed-marks story was dropped from
that staged file: the state it shows cannot exist on main's predicate. The
manifest's `source` for that set records the same two edits.

**Run this set as a WHOLE, never one story at a time** — the states in it share
module state (`entities`, the agents and teams a story stages) that no story
resets, so a story captured alone is a picture of a fixture the sweep does not
build. Measured: a narrowed `--only=chat-sidebar-status-feed--mark-all-read-pile`
run and the same frame from a full sweep agree byte for byte, and both differ
from the committed one by the line below — so a narrowed run is not a cheaper
re-take of a state.

**EIGHT STATES IN THIS SET PICTURE AN EARLIER TREE, and neither delta is this
change's.** They were last re-taken at `7d41e63e3` (05:48), and two commits on
`main` have since changed what the same stories render:

- `c1dfcc27f` (10:04) gave the agents section an empty state of its own, so a
  re-capture draws `No agents yet` where those frames carry nothing.
- `ab76b06f3` (11:11) moved a busy row's ink from `info` to `accent`, so their
  spinners are the retired blue where a frame taken now is green. Census over the
  glyph column (x 8-38) of each state's `localOperatorDark` frame, counting pixels
  with hue 200-255 and **HSL** S>0.18, 0.15<L<0.92: `completion-reordered` 95,
  `completion-acknowledged` 93, `completion-in-place` 93, `gate-answered` 86,
  `completion-unseen` 85, `truncating-title` 85, `completion-second-in-band` 47,
  `gate-parked` 42. Three things about those numbers that the sentence above used to
  leave out. **They are not one viewport**: `gate-answered`, `gate-parked`,
  `truncating-title` and `completion-unseen` are 780x560 and the other four are
  780x660 (the `mark-all-read-*` states are the 780x600 ones, two of them narrower
  and one taller). **They are one colour model**: the same eight under HSV's S/V
  read 174, 168, 177, 125, 131, 127, 86, 65, so HSL is part of the figure rather
  than a detail. And **they are the whole population**, not a sample: the census was
  widened over all 24 frame directories in this set and no others carry the arc.
  The arc stroke sampled in `gate-answered` is `rgb(156,176,206)`, hue 216°, the
  `info` role, and the same theme's ground is byte-identical between the two epochs,
  so the difference is the ink and not the palette.
- **The zero in the `mark-all-read-*` states proves less than it looks like it
  proves, and the sentence above it used to overclaim.** Fifteen `mark-all-read-*`
  states read 0 in the same census, but THIRTEEN of them were also written at
  `7d41e63e3` and stage NO busy row at all, so a zero there is what the census gives
  over a roster that draws no spinner — it says nothing about the ink a spinner
  carries. It is worth spelling out because it is the shape of the mistake this
  paragraph exists to stop: only the two states this branch added
  (`mark-all-read-unseen-without-mark`, `mark-all-read-mixed-marks`) stage a busy
  row, and being captured after the move their spinners are `accent` — a fact about
  this branch's frames, not evidence about the older thirteen.

This paragraph replaces one that said the agents line was "the whole of the
difference", and the two figures it quoted have to be split rather than
re-attributed as a pair. The **12,656-pixel** reading for `gate-answered` is a
`7d41e63e3`-epoch measure of the agents line AND that story's repainted busy glyphs
TOGETHER — that roster draws a spinner. The **11,830** for `mark-all-read-pile` is
the agents line ALONE: that roster stages no busy row, so nothing else in those
frames moves under a re-take. Both figures hold; the attribution was what was wrong
(design round 1, **D1**, and its second half, **D7**). The re-take is DETERMINISTIC
rather than a settle race — the same bytes with this change in the tree, with it
stashed back out, and across repeated runs.

So this branch ships the new state's frames and leaves those eight states at the
bytes `main` holds. Re-taking them is a pass for `ab76b06f3` and `c1dfcc27f`
rather than for this fix, and per the note above it is a whole-set pass when it
comes; the frames that carry the earlier ink are named here so that a reader
meeting one role in two hues in one theme is not left to reconcile it unaided.

The stories (`chat-sidebar-status-feed.stories.tsx`) drive the REAL
`ChatSidebar` — including `ChatSessionStatus`'s glyph, ink and accessible name —
against the REAL canonical-sessions store, with only the transport below the
hook stubbed. The click-driven stories press the shipped button and hold
`documentElement.dataset.capturePending` until the state under test is on
screen — the receipt, or the in-flight announcement — so a frame is a settled
state rather than a race between a request, a store commit, a toast and the
shutter.

The control's KEYBOARD behaviour is pinned separately, in
`scripts/mark-all-read-control.test.mjs`, which mounts this same sidebar in jsdom
and drives the real key events: the control is a stop in the ↑/↓ walk between its
section's toggle and the first conversation, it keeps focus and its stop for the
whole request (`aria-disabled`, never `disabled`), and clearing the last mark
hands focus to the section's own disclosure rather than dropping it to `<body>`.
jsdom has no layout engine, so that file says nothing about pixels — which is
exactly why the widths and the shed are photographs.

The readout panel beside the sidebar is not decoration: it subscribes to the
same store the panel reads, and its last two lines are measured off the DOM (the
element the control stamps itself with, and the shed span's own tree membership)
so a caption cannot claim a control that is not on screen — or a name no assistive
technology can see.

## Re-running the gates a reviewer of this set needs

The frames are pictures of a state, so what re-checks them is the suite:

```
env -u NO_COLOR TERM=xterm-256color pnpm test:desktop   # includes this set's stamp test
pnpm check-evidence                                     # the machine-wide sweep over every committed frame
```

`test:desktop` needs the explicit `TERM` and a cleared `NO_COLOR` because the
sidebar's own contrast probes read rendered styles through the theme; both are
what CI does.

`check-evidence` admits **one** sweep per machine through a permanent lock at
`/tmp/local-operator-ui-check-evidence.lock`. A second caller exits **75
DEFERRED** — that is a lease, not a failure, and the lock file is never deleted
or reclaimed. It is also slow on a loaded laptop: 5,700+ frames go through
ImageMagick, so on a busy machine it can outlast a review round. If it defers,
say so and retry rather than reading it as a pass.

## What these frames are not

They are not the native window's pixels, and they are not the store's behaviour:
the store action, the wire shape and main's foreground gate are asserted in
`scripts/attention-seen.test.mjs`. Together those two answer different questions
— this set answers "what does the user see, in every theme", and that file
answers "is the request, the answer and the write what they claim to be".

## The subagent indicator (2026-09-29)

Six rosters added for the operator's report: sessions "not displaying the icon
where they're done but they still have running subagents, so it just looks like
they're inactive in the sidebar".

- **`subagent-rows-running/`** and **`subagent-rows-running-minimum/`** (280 and
  240) — the rungs the catalogue ranks ABOVE `delegating`: a `busy` row with two
  running children and one queued (the three-glyph worst case), a `busy` row with
  two, a `wedged` row with one, the three `delegating` cells (queued-and-running,
  running-only, queued-only), and TWO compatibility cells — `null` counts and
  `0/0` counts, both on a busy row.
- **`subagent-rows-resting/`** and **`subagent-rows-resting-minimum/`** (280 and
  240) — the resting primaries the indicator has to read beside: an unseen
  completion, an attached session, a scheduled wake with a queue, an idle ring, an
  unseen failure, the same compatibility pair on a RESTING row (`0/0` and
  `null`), and a bound (agent-attributed) row. The compatibility cells are four
  because the rule is not a function of the status code, and the four are how
  that is said in pixels: S11 asks for the pair on a busy row AND on an idle one
  (review MINOR 2 — the first pass photographed two of the four).
- **`subagent-selected-row/`** — the operator's own case: the row they had
  opened, on the `rowSelected` ground, with two running children and an
  unselected twin below it.
  **THIS CELL'S FIRST PASS PHOTOGRAPHED TWO RESTING ROWS, and the frame was the
  evidence for it**: the story passed `selected={`session/<id>`} while the row's
  own definition of current is `selectedConversation === row.session_id` — the
  BARE id the app's caller passes (`sidebar-navigation.tsx`) — so no row was ever
  current, and a persisted `activeDraftKey` (the store's `partialize` names it)
  suppressed it a second time even after the id was fixed. Both are repaired:
  the story passes the bare id and clears the inherited key, and this cell's own
  capture entry now refuses the frame unless
  `[data-chat-row][aria-current="page"]` is on screen. The before/after pair was
  re-taken so each half carries a genuinely selected row and differs only by the
  indicator.
- **`subagent-archived-row/`** — an archived row carrying BOTH conditional marks
  (the leading `Archive` glyph and the post-title indicator). Archived rows are
  filtered out of the at-rest list by `chat-archived.ts`'s `visibleRows`, so this
  story reaches the row the only way a reader can: a query plus the search
  block's own `Include archived` control.
  **THE FIRST PASS OF THIS STORY PHOTOGRAPHED THE WRONG STATE** (QA round 1, Q-1;
  design D1 on the same frame): the play asked for "Search chats and agents" by
  label, and the band's search BUTTON and the search FIELD carry that one
  accessible name, so the lookup matched two elements and the play died before a
  character was typed — leaving a frame of the unarchived twin that still looked
  like evidence. Roles separate them now, and the capture entry carries
  `expectPresent: '[data-session-archived="true"]'`, so the rig itself refuses to
  write these frames unless an archived row is on screen.

**The before half is a separate declared set**, `docs/evidence/chat-sidebar-subagent-baseline/`
— the same six rosters, same fixtures, same two viewports and same twelve
palettes, rendered by unmodified `origin/main` at `073164505e` in its own
worktree (re-taken at the round-1 fold, since the fold moved the tree the
roster's own file is staged into). That set's manifest entry carries the
provenance. Read against it: the archived baseline row carries the `Archive`
mark and NO indicator, which is the pair this cell exists for. Every cell's before/after pair therefore
differs by the indicator and by nothing else; on the baseline, a busy row with two
running children draws one spinner and the sidebar says nothing about them.

**THE TWO `subagent-rows-*running*` CELLS WERE RE-TAKEN AT THIS BRANCH'S HEAD
(agent review round 1's M3, design's D1), AND THE PAIR'S "NOTHING ELSE" NO LONGER
HOLDS FOR THEM.** Issue #840 replaced the running mark itself - `Share2` in the
accent, which read as an action beside the row's own buttons, is now the filled
`SubagentRunningMark` dot - so the after half was photographing a glyph the head
no longer draws, and a reader tracing the component landed on evidence that
contradicted it. The 24 frames (two viewports x twelve palettes) were re-taken
through this set's own capture path at the head, and the narrowing is recorded in
`manifest.json`'s `partialCapture` rather than left to look like a sweep.

**The other four cells, and the whole baseline half, are untouched, and that is a
provenance decision rather than an omission.** The baseline is defined as
unmodified `origin/main`'s rendering; main still draws `Share2`, so re-taking it at
this head would make the set describe a tree other than the one it names. The
resting, selected and archived cells carry no running mark - they were checked
against the re-taken pair and left.

**WHAT THE RE-TAKEN PAIR IS, AND IS NOT (design round 2's D-r2-1).** It is an
INDICATIVE picture of the mark as the head draws it, not a controlled before/after
- the two halves are two different trees, so a reader should not read every
differing pixel as this change. The after half additionally carries main's own
sidebar-header door (a fourth icon, `data-sidebar-open-agent`, from the
agent-roster commit `fe2de1f2098`) and the 18px leading-cell shift #843 made to
every row, both of which the baseline (taken at `07316450`) predates. The mark is
what the re-capture was for; the rest is the tree moving under it, and this note is
here so the next reader does not have to difference the frames to find out.

What that leaves for the pair is stated rather than implied: the re-taken halves
differ by the indicator (their purpose), by the mark's SHAPE (#840), and by the
header and leading-cell differences named above.

**The two widths are the point, not a courtesy.** One mark costs the title
**22px**, measured box-to-box in the frames (14px glyph + the row's own 4px
`gap-1` + `ml-1`'s 4px), 8px between two marks, and a truncated row carrying both
loses **41px** of title - and
`docs/design/sidebar-row-space.md` §2 states this row's invariant as "the title's
leading edge never moves; what moves is the title's clip" — which is why the
indicator sits AFTER the title rather than in the leading cluster. The 240px
frames are where that clip pays hardest, and the worst cell in the set is the
bound row at 240, where a trailing statement and a time leave the title ~3.8
characters (design D3, recorded as a follow-up rather than fixed here).

**Recorded gap.** The spec's S15 cell (a NESTED row, filed under its agent) is
not photographed: this fixture's profile catalogue renders the Agents section's
empty state rather than an entity row (the offered install line names the profile,
so the read lands — the section lists installed agents and the fixture's catalogue
has none; the committed `completion-reordered/` frames show the same empty
section). The bound row in `subagent-rows-resting/` renders FLAT for that reason,
and the nested under-an-agent frame is owed to whoever can drive an installed
agent in this set.

## The running mark is the trio (2026-10-06)

The operator's report on the mark #840 shipped — a single filled accent disc —
is that one 8px dot states "something is here" and not "CHILDREN are here", in a
family the app already spends on unrelated facts. It is the operator-ACKed
**trio** now: three equal filled circles on the 24-unit grid, in the caller's
ink, inside an `svg` that fills the caller's box.

**What was re-taken, and how.** Nine cells, 108 frames at twelve palettes each,
through this set's own path:

```
node scripts/capture-evidence.mjs http://localhost:6006 \
  --only=chat-sidebar-status-feed \
  --dirs=delegating-row-default,delegating-row-minimum,subagent-archived-row,\
subagent-rows-resting,subagent-rows-resting-minimum,subagent-rows-running,\
subagent-rows-running-minimum,subagent-selected-row --allow-backend
node scripts/capture-evidence.mjs http://localhost:6006 \
  --only=chat-session-status --dirs=neighbours --allow-backend
```

The pass was run twice and the two runs are byte-identical (108/108 sha256); the
second is the one the manifest names, taken on the committed code tree so the
record's `head` and `dirtyWorkingTree` describe a clean tree rather than an
in-flight edit. That is also the guard against the stale-module defect design
round 2 found in its own rig — a re-run that is not byte-identical is telling you
the module graph did not invalidate, not that the app moved.

**The two before/after pairs are not equally clean, and this note says which is
which rather than leaving a reader to difference them.** `subagent-rows-running/`
and `subagent-rows-running-minimum/` were re-taken at issue #840 and wore the DOT
the operator rejected: those two differ by the mark and nothing else — six
~16x16px boxes per palette, three in the leading slot and three in the trailing
one. The other seven cells carried older captures (`delegating-row-default/`,
`delegating-row-minimum/` and `chat-session-status--neighbours/` from 2026-09-22;
the resting, selected and archived cells from 2026-09-29), and all of them still
drew `Share2` in the accent — neither the dot nor the trio — over a sidebar that
has moved since (the RUNNING/OLDER grouping, the header's agent door, the 18px
leading-cell shift). Their deltas are the mark **and** that accumulated movement.
They are re-taken because the alternative is a set whose frames contradict the
component they photograph, and because those cells ARE the arm's own surface: the
`delegating` rung is what `delegating-row-*` exists to photograph, and the
neighbours matrix is the one place a delegating row is read against `busy`. The
baseline half (`chat-sidebar-subagent-baseline/`) was **not** re-taken, for the
reason its own entry gives: it is defined as unmodified `origin/main`'s rendering.

**The readings, taken on these frames** with the design round's own instrument
(coverage by projection onto the ground→accent axis) rather than quoted from its
corpus. Trailing slot, the sidebar row's 14px box (`subagent-rows-running*`,
240px floor included): n=3, ink **10x10**, children gap **2**, coverage mass
47.2–51.3, parts `4x4@x,279 + 4x4@x-3,285 + 4x4@x+3,285`. Leading slot, the
`delegating` rung's 16px box (`delegating-row-*`, and the matrix): n=3, ink
**12x12**, gap **2**, mass 65.7–67.5, parts `6x5@39,278 + 5x5@36,285 +
5x5@43,285` — the same components the design round's independent pass measured
on its own corpus. The mark is static, count-free, `aria-hidden`, and takes
`currentColor`; `data-subagent-mark` and the `sr-only` sentence are unchanged.

**Why equal beads.** The row is the parent, so a centred larger apex over a pair
draws the head-and-shoulders figure — `Users` — that the design round refused.
Equal radii and no hierarchy is what makes the mark say *children*.

**The spacing is a constraint, not a taste.** The round-1 candidate was the same
beads with a larger apex and lower centres 4.43px apart against radii summing to
4.32px: the children overlapped by 0.12px at 14px, fused, and its component count
flipped between 1 and 2 with the box's sub-pixel phase. These three clear each
other at every phase and at every x the app places the box, which is why the
count holds in all twelve palettes here and at the 240px floor.
