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
`--only=chat-sidebar-status-feed--mark-all-read-mixed-marks`. **The first capture
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
