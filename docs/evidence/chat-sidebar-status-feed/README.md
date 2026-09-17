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
  each with its check, and the control that clears them beside the group's own
  count.
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
  `Mark all as read: absent · 0 unread row(s) it would name` — rather than leaving
  a reviewer to infer it from a missing button.

## What produced these frames

Storybook, through the repo's own `scripts/capture-evidence.mjs`:

```
npx storybook dev -p 6017 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-sidebar-status-feed--
```

The stories (`chat-sidebar-status-feed.stories.tsx`) drive the REAL
`ChatSidebar` — including `ChatSessionStatus`'s glyph, ink and accessible name —
against the REAL canonical-sessions store, with only the transport below the
hook stubbed. The two click-driven stories press the shipped button and hold
`documentElement.dataset.capturePending` until the receipt is on screen, so the
frame is the settled state rather than a race between a request, a store commit,
a toast and the shutter.

The readout panel beside the sidebar is not decoration: it subscribes to the
same store the panel reads, and its last line is measured off the DOM (the
element the control stamps itself with) so a caption cannot claim a control that
is not on screen.

## What these frames are not

They are not the native window's pixels, and they are not the store's behaviour:
the store action, the wire shape and main's foreground gate are asserted in
`scripts/attention-seen.test.mjs`. Together those two answer different questions
— this set answers "what does the user see, in every theme", and that file
answers "is the request, the answer and the write what they claim to be".
