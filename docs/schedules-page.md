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
  fewer`. The pane uses a statement marker because nothing there can cancel; here
  a shed line can be brought back, so the app's one disclosure idiom is used and
  the count is in its label.
- **A nameless conversation** still lists: `resume.session_name` is a best-effort
  read, so an empty name falls back to the shortened id plus the directory's own
  name (`a1b2c3d4 · invoices`).
- **Nothing ticks.** A due label is an absolute local instant plus a cadence, and
  neither is a function of when it is read (`docs/composer-wakes.md` § 6's rule,
  and the reason there is no "in 42m" here either).

## The states

| State | What it says |
|---|---|
| Loading | The header and the panel stay, `Spinner` centred in the panel, `Loading scheduled tasks`. No skeleton rows: the length is not knowable before the load. |
| Empty | `No scheduled tasks yet`, the operator's body copy with typographic quotes, and the second `New scheduled task` button. |
| Error | `Could not load scheduled tasks.` · the backend's own message · `Try again` (a refetch). Three parts, where the alert it replaces had one and no way back. |
| Unreadable store | `read_error: true` is a 200 that could not read the index: a warning strip, because "could not read" and "nothing is scheduled" are different sentences. |
| Supervisor down | `supervisor.running` false (or `supported` false) is a warning strip naming the backend's own `detail`. "Will my scheduled task fire" is not answerable from the index, and a listing that omitted this would invite trusting a dead schedule. |
| Parked | A conversation whose session was stopped (or whose transcript is gone) drops its instants everywhere and states the fact: `Parked — wakes resume when you open it`. A stored instant would be wrong twice over — it will not fire then, and it will be re-anchored when someone opens the session. |
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
   its first message.
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
  already in the listing this page holds.

### The approval sentence

A wake-fired turn runs with the session's own **unattended posture**: a tool that
needs approval parks the turn until `runtime.unattended_gate_timeout`, where a
legacy schedule ran with `yolo=True` and never asked. The dialog states it in one
line — *"This runs as a turn in the conversation, so a tool that needs approval
waits for you instead of running unattended."* — and the legacy group's own
description states the other side of it. Both are stated rather than changed:
this change does not touch the posture, and a user who cannot tell the two
engines apart cannot judge the trade.

## Editing an armed wake

The editor is the same dialog on an armed wake (`wakes.edit`). `Run in` is
absent — a wake is edited where it lives — and every timing control gains a
`keep` option as its default, because a PATCH says only what should change: an
omitted field is "leave this alone", never "clear this". That asymmetry is the
whole reason the branch looks different: on create an omitted `every` means a
one-shot, and on edit it means nothing at all.

What a timing change does is stated on the dialog rather than implied: the
backend re-anchors the due instant to the first run the user picks, and
deliveries already made stay counted.

The designer's record refused an edit in its first version — with the id
creation-ordered, "editing is a replace, and a replace re-anchors the
recurrence". The interface now has an op for it, so the page offers the control
and says what the op does, instead of offering nothing.

## Permissions, and where they stop

**Cancel: yes**, on each wake line, hover- and focus-revealed like every other
row action in the app, `danger`-tinted, behind a confirm that quotes the prompt
and says the conversation stays. Without it, a wake a user made by hand could
only be removed by asking an agent — on the page whose job is managing them.

**Open: yes**, from the row head. The row's identity is the conversation, so the
row must lead to it.

**Pause: no** (above). **Edit: yes** (above). **The run pane stays read-only**,
and `docs/composer-wakes.md` § 8 now says why that is a rule about the pane
rather than about wakes: the pane watches a live turn, the page is where the
thing is managed.

## Freshness

Nothing pushes the wake index — the supervisor is a separate process writing
files, and the app's only event stream is per session — so the listing polls at
30 s (three supervisor re-reads of lag) with `refetchOnWindowFocus`. After every
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
  session) does not need a control.
