# Schedules, harmonized onto wakes — the page's design record

The record for the change that made `local-operator-ui`'s Schedules section a
view of the harness's **wakes**: the page lists every conversation that has
wakes, `New scheduled task` creates a conversation and arms a wake in it, and
cancel and edit are offered here. `docs/composer-wakes.md` is the run pane's and
the composer's record and is amended by this change in three places (§ 4's glyph
table, § 8's "the rows are quiet", § 10's alternative K); this file is the page's.

Structural background — what the code actually does, the write paths, and the
permutations to exercise — is the architect's design for the change. This file
records the UI's side of it: the frozen interface it consumes, what each state
renders, and every place a decision was made rather than inherited.

## The interface this page consumes

Four desktop-contract ops, mapped in `desktopEndpoint` beside the `sessions.*`
family and served by the wake routes behind the same router-level desktop
bearer (`routes/desktop_sessions.py`):

| op | route | read by |
|---|---|---|
| `wakes.list` | `GET /v1/desktop/wakes?limit=&include_dormant=` | the page's primary list |
| `wakes.create` | `POST /v1/desktop/wakes` | the create dialog |
| `wakes.edit` | `PATCH /v1/desktop/wakes/{session_id}/{wake_id}` | the editor |
| `wakes.remove` | `DELETE /v1/desktop/wakes/{session_id}/{wake_id}` | the cancel confirm |

The listing and create responses are **typed** (`DesktopWakesListResponse`,
`DesktopWakeCreateResponse` and their rows, `desktop-contract.ts`), not
`Record<string, unknown>`: a rename on the wire has to be a compile error rather
than a page that renders empty and blames the user's schedule. `next_due_at`,
`until_at`, `last_fired_at` and `last_attempt_at` are epoch **milliseconds** —
every other clock on this wire is seconds — and the page formats them through
the run pane's own `formatWakeDue`, which states the unit at its boundary.

`wakes.create`'s body is built once, in `wakeCreateBody`
(`shared/api/local-operator/wakes-api.ts`), and its two destination shapes are
mutually exclusive by construction: `{session_id}` arms into a conversation that
exists, `{cwd, target?}` has the backend create one and arm it in the same
request. The exclusivity cannot be a `.refine()` on the op's schema — that makes
the union member a `ZodEffects`, which a discriminated union cannot take (the
trap `mcp.credentials.store` records) — so it is enforced where the body is
built, and a body that names neither is refused with a sentence rather than
reaching the wire as a 422.

## The row is a conversation

One row is a conversation with wakes. Its wakes are lines beneath it, rendered
by **`WakeRowView`**, the run pane's own row component
(`features/chat/components/run-details/run-detail-wakes.tsx`), which was exported
for this. That is the strongest form of the rule this whole change exists for: one
object must not read two ways on two surfaces that can be on screen at once. The
page passes two things the pane cannot: a `trailingClause` (`Ran 3 times`, from
the listing's `fired_count`, which the pane's wire does not carry) and an
`action` (the line's own controls).

- **Head**: the conversation's name, then one clause — `2 wakes · next 9:26 AM
  EDT`, or `1 wake`, or the parked sentence. Rows sort by the earliest
  `next_due_at` across their wakes, ascending, conversations with no future
  instant last, ties by name: the pane's rule lifted from the schedule to the
  conversation, so the two surfaces agree when they are read together.
- **Wake lines**: the mark, the due label, `· cadence`, the prompt clamped at two
  lines — the pane's anatomy, unchanged. The count clause is the page's own
  (`1 wake` / `2 wakes`, not the composer's `1 wake armed`): the composer's clause
  is a tally among counts of live work, and this one is a row's subtitle over the
  lines that are the wakes.
- **Cap**: three lines, then a `Disclosure` reading `Show N more wakes` / `Show
  fewer` — singular at one (`Show 1 more wake`), because the label is also the
  control's accessible name and the plural-only string shipped ungrammatical on
  the first populated frame (design round 1, D4; review round 1, R5, the same
  defect). The pane uses a statement marker because nothing there can cancel; here
  a shed line can be brought back, so the app's one disclosure idiom is used and
  the count is in its label.
- **A nameless conversation** still lists: `resume.session_name` is a best-effort
  read, so an empty name falls back to the shortened id plus the directory's own
  name (`a1b2c3d4 · invoices`).
- **Nothing ticks.** A due label is an absolute local instant plus a cadence, and
  neither is a function of when it is read (`docs/composer-wakes.md` § 6's rule,
  and the reason there is no "in 42m" here either).

**Row height, measured, because the design input claimed the opposite.** The
migration is **not** a density win and this record does not claim one. Measured
off the frames at DPR 1 (dark): a one-wake row is **86 px**, two wakes 127 px,
three plus the disclosure 199 px, against the **66 px** of the whole legacy row
the design input's D9 measured (its 65.8 CSS px, hairlines every 131.5 px on the
2× before-frame). So 2–3 wakes per conversation is roughly density-neutral, and
the common one-wake conversation is ~30 % taller than what it replaces. The space
is the row head — the point of the change, since the old row had nowhere to go —
plus `py-3` and the 4 px list gap. What the design input's D9 got right is the
caption: the cadence sentence really is terser (`every 1h30m` against `Every hour
at 16 minutes past, from Sunday, March 15, …`). The added line is what the change
buys, and the record says so rather than claiming a win it cannot show.

## The states

| State | What it says |
|---|---|
| Loading | The header and the panel stay, `Spinner` centred in the panel, `Loading scheduled tasks`. No skeleton rows: the length is not knowable before the load. |
| Empty | `No scheduled tasks yet`, the operator's body copy with typographic quotes, and the second `New scheduled task` button. |
| Error | `Could not load scheduled tasks.` · the backend's own message · `Try again` (a refetch). Three parts, where the alert it replaces had one and no way back. |
| Unreadable store | `read_error: true` is a 200 that could not read the index: a warning strip, because "could not read" and "nothing is scheduled" are different sentences — with the same `Try again` the total-failure branch has, since the recovery is the same one (design round 1, D6). **And the empty state is suppressed in this state**: it is `read_error` plus both lists settled and both empty, which is what `isEmptyListing` encodes — the strip said the list may be incomplete while the state beneath it told a user with thirty schedules that they had none and offered a button to make one (round 2, D13/U8). |
| Failed read with rows on screen | React Query keeps serving the last answer, so the rows under a failure are the last list that LOADED: the strip names them (`The list below is the last one that loaded, so it may be out of date.`) rather than letting each row go on asserting `1 wake` as if it were a claim about now (round 2, U4). Its story is `stale-rows`, and it needs one of its own: `load-error`'s stub never answers, so that story can only ever photograph a page with no rows in it and the marker is conditional on rows for exactly that reason (round 3's evidence gap). The story's stub answers one listing and then refuses, and a Drive step presses the header's refresh control so the frame is not a minute of the page's own poll. |
| Supervisor down | A warning strip, with the lead sentence picked by three states (`supported`, `verifiable`, `running`) and the backend's own `detail` on its own line in `text-mono`, because a daemon's words are a bug report's sentence rather than a user's (design round 1, D6). Every lead names the rows it covers and none of them says `scheduled tasks`: the fenced legacy group renders below the strip and runs on another engine, so a sentence scoped to the whole page claimed more than it knew (round 2, U7). The direction is **`the wakes below`**, corrected in round 3 after the round-2 wording shipped as `above`: the strip sits above the first row (measured natively on `supervisor-down`: strip y147..161, first row name y236..245, nothing between it and the header), so `above` pointed at the header. Two words, and a reader who follows them walks the wrong way. The strip is the ONE place the page states whether anything can fire: the panel footer's "wakes fire whether or not this window is open" is gated on the same verdict, and when nothing can fire **no row prints an instant either** — the parked rule applied one state over, because a stored instant is equally wrong there (design round 1, D2). |
| Listing truncated | `truncated: true` (beyond the backend's own page cap) adds `Showing N of M conversations with wakes.` rather than silently under-reporting (review round 1, R7). |
| Parked | A conversation whose session was stopped (or whose transcript is gone) drops its instants everywhere and states the fact: `Parked — wakes resume after its next turn`. A stored instant would be wrong twice over — it will not fire then, and it will be re-anchored when the conversation runs again. **The earlier clause said "when you open it", and round 2 measured that as false**: pressing a parked row's `Open conversation` leaves the index's `stopped_at` set (the warm correctly refuses a session reporting stopped), and only a turn clears it and re-arms the wakes (U9). |
| Spent | Absence, deliberately: a one-shot that has fired retires out of the schedule list, and a recurring wake that has fired shows `Ran 3 times` so a row that is working does not read as untouched. |
| Legacy | The fenced group below, present only when a legacy row exists. |

Pause is **not** here, and not faked: the wake model has no `paused_at`, so a
toggle could only be cancel-and-re-arm, which silently resets `fired_count` and
re-anchors a recurrence to the moment of the toggle. The legacy rows keep their
own activate/deactivate switch — that engine still has the field.

## The create flow

`New scheduled task` opens one dialog, `maxWidth="sm"`, one column (the
two-column grid it replaces split `Interval` and `Unit` across cells of unequal
width for no reason).

1. **Prompt** — required, three rows, with the helper `This is the message the
   conversation receives when it wakes up.`
2. **Run in** — a segmented pair: `A new conversation` (default) or `An existing
   conversation`, which reveals the conversation picker (name plus how long ago
   it was last active, newest first). Under the new-conversation choice, one
   `ink-dim` line: `Starts in <workspace> with your default model.` — the
   workspace being the store's staged cwd, the same value the chat pane sends on
   its first message. Under the existing-conversation choice the same slot says
   `Runs in <conversation>, as a turn in that conversation.` — the previous
   version removed the sentence and put nothing in its place, so the branch that
   writes into work the user already has was the one that said least about what
   it would do (design round 1, D10; the model clause is the same paragraph of
   that finding, deferred below).

   Two decisions this branch needed:

   - **The picker reads `sessions.list`, not the wake listing.** The wake index
     is a projection of conversations that already HAVE a wake, so a picker built
     on it could not name the common case — a conversation with none (review
     round 1, R1). The listing's own count is still what the ceiling is checked
     against, because that is the count the create would run into.
   - **A `Select`, not the app's searchable picker host.** The design input asked
     for the picker-host idiom; a searchable host is more than this commit should
     carry, and the control it would replace is an ordinary single-choice field.
     The `Select` is searchable by typing its first letters, which is the app's
     own behaviour for a short list; the host itself is recorded as deferred
     rather than silently swapped.
   - **`mtime` is the session's own activity stamp**, which is what the row's
     "last active" says. The wake index's `updated_at` — the wake listing's own
     write stamp, which a first version of this branch rendered as activity — is
     not used here (review round 1, R6: the two fields mean different things and
     only one of them is about the conversation).
3. **First run** — `In an hour` · `In 30 minutes` · `Tonight at 8:00 PM` ·
   `Tomorrow at 9:00 AM` · `Pick a time…`. The presets are sent as the `in`/`at`
   the tool already takes, so the common path never touches a calendar;
   `Pick a time…` sends the ISO instant the picker yields. `Tonight at 8:00 PM` is
   offered only while tonight's 8pm is still ahead — a preset naming a past
   instant is a request the backend refuses, and that refusal would be about
   arithmetic the dialog can see coming.
4. **Repeat** — `Don't repeat` (default) or `Every` plus a count and a unit,
   composed into the tool's own duration string (`1h`, `30m`, `2d`, `1w`). Below
   a minute the create is refused with the reason: `Wakes repeat no more often
   than once a minute.` A wake is not a cron job and the model has no field for a
   cron expression, so the dialog offers a bounded grammar and leaves the
   fuzzy-language path where it already is — the agent, in chat.
5. **Ends** — only when repeating: `Never` (default), `On a date…` (`until`),
   `After N runs` (`limit`). Without this a repeating wake is permanent.
6. **Create** — the dialog closes, a toast reads `Scheduled task created —
   <prompt head>`, and the row appears in due order. The page does **not**
   navigate away.

Three rules the flow keeps rather than discovers:

- **Creating does not start a turn.** The first turn is the wake's.
- **The prompt names the conversation.** The backend writes it into the
  session's stored-title sidecar, which `resume.session_name` consults first, so
  the flow needs no `Name` field and a list of ten scheduled conversations does
  not show ten copies of the working directory.
- **The ceiling is stated before the press.** At `MAX_WAKE_SCHEDULES` (16) the
  create is refused with the reason inline and the action disabled — the count is
  already in the listing this page holds. The prompt's own ceiling is stated the
  same way: past `WAKE_MESSAGE_MAX_CHARS` (2 000, the harness's
  `MAX_WAKE_MESSAGE_CHARS`, exported from the contract so there is one number)
  the refusal is inline and the action disabled, because the main process answers
  an over-long body with its generic `Invalid desktop operation.` — a sentence a
  user can neither read nor act on (review round 1, R3). A run budget at or below
  the runs a wake has already made is refused inline in the same voice (design
  round 1, D3 point 4: `limit` is a TOTAL, so `After 1 run` on a wake that has run
  three times means "one more and stop").

### The approval sentence

A wake-fired turn runs with the session's own **unattended posture**: a tool that
needs approval parks the turn until `runtime.unattended_gate_timeout`, where a
legacy schedule ran with `yolo=True` and never asked. The dialog states it in one
line — *"If a tool needs approval, the wake parks and waits for you rather than
acting on its own; a wait that runs out stops the turn without running the
tool."* — and the legacy group's own description states the other side of it.

The wording is deliberate in both halves. The previous sentence said the run was
**not** unattended, while the harness's own name for this posture is the
unattended one (`runtime.unattended_gate_timeout`) and this branch's own record
called it "the session's own unattended posture" — the copy argued with the doc
it shipped beside (design round 1, D7). "Parks" is the harness's own word
(`serving.py::_parked_timeout_s`), and the sentence names the bound: the gate
parks rather than denying, and a wait that runs out ends the turn instead of
running the tool. The exact number of hours is a runtime setting the renderer
does not read, so the sentence states the bound exists rather than promising a
number it cannot check (deferred below). Both are stated rather than changed:
this change does not touch the posture, and a user who cannot tell the two
engines apart cannot judge the trade.

## Editing an armed wake

The editor is the same dialog on an armed wake (`wakes.edit`). `Run in` is
absent — a wake is edited where it lives — and every timing control gains a
`keep` option as its default, because a PATCH says only what should change: an
omitted field is "leave this alone", never "clear this". That asymmetry is the
whole reason the branch looks different: on create an omitted `every` means a
one-shot, and on edit it means nothing at all.

**The `keep` options carry the value they keep** — `Keep 4:00 PM EDT`, `Keep
every 1d`, `Keep never ending` / `Keep ending Mar 16 8:00 AM EDT` / `Keep 3 runs
left` — and the dialog opens with a context line naming what is being edited
(`Invoices workspace · wake 2 of 4`). The first version said only "Keep the
current time/repeat/end", on the one surface in this feature where the user
decides with the value hidden: every other surface here is value-bearing (the row
reads `4:00 PM EDT · every 1d · 3 left · Ran 3 times`), so the labels are the
row's own formatters applied to the same fields, not a second vocabulary (design
round 1, D3).

**One sentence states what a save does**, because there is one rule:
`build_wake_edit` moves the due anchor only when the request carries `in`/`at`,
so a new first run moves the next fire and nothing else does — not the repeat,
not a bound, not the prompt. The earlier two-variant sentence claimed a new time
*or repeat* re-anchors, which is false on the path the dialog defaults to
(review round 1, R2). Runs already made still count (`fired_count` survives, so
`Ran 3 times` stays on the row and a `limit` still counts against it), and the
wake keeps its place in the conversation, which is why an edit is offered at all.

`Save` is disabled until a field differs from the value it started with: opening
the editor fills the prompt and leaves all three timing controls on `keep`, so an
enabled primary there is a button whose press would PATCH nothing (design round
1, D11).

The designer's record refused an edit in its first version — with the id
creation-ordered, "editing is a replace, and a replace re-anchors the
recurrence". The interface now has an op for it, so the page offers the control
and says what the op does, instead of offering nothing.

## Permissions, and where they stop

**Cancel: yes**, on each wake line, hover- and focus-revealed like every other
row action in the app, `danger`-tinted, behind a confirm that quotes the prompt
and says the conversation stays. Without it, a wake a user made by hand could
only be removed by asking an agent — on the page whose job is managing them.
The confirm's buttons are `Keep` on the left with the default focus and
`Cancel wake` on the right in the danger role — the safe action focused, the
destructive one distinguished by role rather than position. A first version of
this record listed them the other way round; the frames are the better
arrangement, so the record is corrected rather than the code (design round 1,
D12), and it is recorded here so a later round does not "fix" it back.

**Open: yes**, from the row head. The row's identity is the conversation, so the
row must lead to it.

**Pause: no** (above). **Edit: yes** (above). **The run pane stays read-only**,
and `docs/composer-wakes.md` § 8 now says why that is a rule about the pane
rather than about wakes: the pane watches a live turn, the page is where the
thing is managed.

## Freshness

The header's two controls are **one group** (`flex items-center gap-2`) rather
than three siblings in `PageHeader`'s `justify-between` row: as siblings the
refresh icon was stranded mid-header (measured on `list`: icon box x=757..788 at
the 60% mark, CTA x=1079..1255, 291 px of empty band between them) and at the
app's minimum width the wrap put the secondary control in the right corner while
`New scheduled task` dropped to its own line at the left edge, demoting the
primary action below a secondary one (round 3, the designer's placement finding,
which is also its U-N2).

Nothing pushes the wake index — the supervisor is a separate process writing
files, and the app's only event stream is per session — so the listing polls at
30 s (three supervisor re-reads of lag) with `refetchOnWindowFocus`, and the
header carries a `Refresh scheduled tasks` control for the case the user knows it
moved: round 2 caught the page up to a poll behind on a conversation un-parked by
a turn in the same window (U3). The poll stays; the control is the press, not a
replacement. After every
write the page invalidates the listing **and** asks the affected conversation's
canonical snapshot to re-read (`resyncCanonicalSession`,
`shared/hooks/use-canonical-session.ts`): a live session pushes its own frame when
its scheduler changes, but a cold session's snapshot is synthesised from the
index at subscribe time and nothing pushes when the index moves underneath it —
`docs/composer-wakes.md` § 11.6's stale-chip gap, closed for changes made here.

## Evidence

`docs/evidence/schedules-page/**` (20 stories × 12 themes) is re-shot whole by
this change: the surface's rows are a different object now, so every frame the
page had was a picture of a page that no longer exists. The capture ran with
`--allow-backend` because the operator's own daemon answers on `127.0.0.1:1111`;
that opt-in is documented for exactly this case, and it is honest here only
because `schedules.stories.tsx` stubs the desktop-control boundary for every op
the page issues (`wakes.list`/`create`/`edit`/`remove`, the legacy schedule list
and the agent lookup) and rejects any unrouted backend path — so no frame in the
set carries a reply from the live daemon.

The create-and-cancel drive is a live-app run rather than a story: a story has no
working backend, and the evidence for "create a scheduled task, show the row,
cancel it, show the row gone" is the real page against a real route.

## What this change does not do

- No pause (needs `WakeSchedule.paused_at`).
- No legacy teardown, and no automatic migration of legacy rows: auto-migration
  silently changes approval posture, conversation count and transcript home, so
  legacy rows are frozen, fenced and visible until the engine is retired.
- No **convert** action on the legacy group. The architect's design proposes one
  per row (create with the agent's cwd and target, arm a wake carrying the legacy
  instruction preamble, then mark the legacy row inactive). It is not in the
  frozen v1 interface this page was built against, and the page's task scope does
  not name it, so it is deliberately absent rather than half-built: the legacy
  group keeps its own toggle, edit and delete, and a user who wants a wake today
  creates one.
- No notification work: the truth already reaches the user twice (a delivery
  receipt row and the app's notification stack). This page's duty is to be
  truthful on arrival.
- No paging UI: `limit`/`truncated` exist on the wire so a pathological store
  degrades visibly, and the realistic cardinality (one entry per wake-carrying
  session) does not need a control — the count clause above is what `truncated`
  buys today.

### Deferred, recorded rather than fixed (round 3, non-gating)

- **D14 — the read-error strip's direction when there is nothing under it.** The
  strip says "the list below may be incomplete" and, in the state where the store
  could not be read, there is no list below: the sentence is aimed at something
  absent. It is not wrong (a list may still be there and unreadable) but it is the
  same class of word as U7's `above`, and the honest fix is either to name what is
  missing or to drop the clause in the empty case. Recorded, not fixed, because
  the state's frames are the round's own evidence and the copy is not false.
- **D15 — the way back lasts the toast.** The cancel toast carries
  `Open conversation`, and a toast lives about four seconds: a user who misses it
  has no path from this page to the conversation the confirm promised stays. The
  page has no other door to a conversation whose last wake is gone. Recorded, not
  fixed: the honest fix is a decision about where else that door belongs (the
  conversation is in the sidebar), not another control on this page.
- **U-N2 — the placement question**, settled by the header group above rather
  than deferred: the designer raised it as the placement blocker and the one
  wrapper answers it.

### Deferred, with the reason

- `deferred — the desktop stop route's contract, not this feature's`: this page's
  copy now says which stop parks a conversation, and the reason it has to is
  that `POST /v1/desktop/stop` answers `stop_requested` and writes no durable
  `stopped_at` (the marker has exactly one writer, the control ladder in
  `session/runtime/control.py`). Whether the desktop route SHOULD stamp it is a
  decision about the stop contract, larger than this page, and deliberately not
  taken here (round 2, U9).
- `deferred — the wake model's gap, not this page's`: `Repeat` is a count and a
  unit, so "not on weekends" cannot be expressed and nothing on the dialog says
  the model holds no weekly shape. `WakeSchedule` is `every_ms` + `until_at` +
  `limit` with no day-of-week field, so the control is honest about what exists
  (round 2, U5).
- `deferred — the wire carries no model on a session row`: the existing-
  conversation consequence sentence says where the wake runs but not whose model
  runs it. `sessions.list`'s row is `id, name, mtime, preview` plus decorations
  (`SessionRow`), and a `sessions.get` per pick would be a second read for one
  clause; the designer's D10 asked for the model in that gap.
- `deferred — the renderer does not read the gate's hours`: the approval sentence
  states the bound without a number, because `runtime.unattended_gate_timeout` is
  a runtime setting no op on this surface carries (and `0` means it never runs
  out, so a hard-coded "up to 24 hours" would be wrong twice).
- `deferred — more than this commit should carry`: the app's searchable
  picker-host idiom for `An existing conversation`; the `Select` is what shipped,
  with the reason above.
- `deferred — needs the primitive first`: pause (`WakeSchedule.paused_at`).
- `deferred — platform parity`: `docs/composer-wakes.md` § 5's footer sentence
  needs a Linux supervisor installer before one sentence is true on both
  platforms. Until then the strip's three-state lead is what says it here, and
  the sentence that would be false on Linux is the one the strip gates.
