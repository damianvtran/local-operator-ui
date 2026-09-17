# The sidebar's completion marks, on the machine-wide feed

The frames in this set photograph the conversation sidebar's rows as their
status arrives from the desktop feed rather than from a whole-catalogue read,
and — since the bulk read receipt landed — the one control that clears a pile of
unacknowledged completions.

## The three feed stories

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
  264px measured break for a two-digit section badge. A set captured only at
  360px, the clamp's maximum, cannot photograph this state at all.
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
npx storybook dev -p 6017 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-sidebar-status-feed-- --allow-backend
```

`--allow-backend` is required while the operator's own backend is answering on
the default port (1111): the capturer's pre-flight guard refuses to run against a
live one, and these stories stub their own transport, so no frame can show any
backend's replies. The frames in this set were taken on port **6027** because
6017 was serving another session's worktree at the time — the port is the
capturer's first argument and nothing about the frames depends on it. Both lines
are the command that actually produced them; a README that records a different
command from the run is a claim a reproducer cannot trust (agent review round 1,
R6).

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
same store the panel reads, and its last line is measured off the DOM (the
element the control stamps itself with) so a caption cannot claim a control that
is not on screen.

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
