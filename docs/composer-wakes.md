# Composer wakes — the armed-schedule chip, and the pane's Wakes section

The design record for the fourth count chip on the composer's status row and the
run pane's fifth section. `docs/composer-status-tabs.md` is the row's own record,
`docs/composer-activity-chips.md` is the third chip's, and `docs/run-sidebar.md`
§ 7.2 is the pane's section order; each carries the amendment this change made to
it.

## 0. The ask, verbatim

> "wakes don't show anywhere in the local-operator-ui"

> "showing them above the composer similar to how todos are currently shown, with
> a wake icon and how many wakes are armed and then make it so we can click that
> and it will open the status tab and in there, we can see all the armed wakes
> (add this too)"

Two surfaces, one feature: a count above the composer, and the list it counts
behind a press. "The status tab" is the operator's name for the run pane; this app
has no tab strip there, its sections are the status surface, so the destination is
a new **Wakes** section of that pane, revealed by the one-shot reveal request the
plan chip already files.

## 1. The problem, stated exactly

A session can be **armed**. A wake fires with no keystroke, and until this change
the only surface in the desktop app that said so was the wake-delivery receipt row
(`receipt-row-model.ts`'s `wakeReceiptHeadline`) — a row that exists only *after*
the wake has already fired. So the app could tell you a session had woken up and
could not tell you it was going to; the way to know a session would fire at 09:00
was to catch the delivery line as it scrolled past, which is the sentence the TUI
band's own docblock uses for the same problem in the terminal
(`local_operator/tui/widgets/wake_panel.py`).

`CanonicalFrontendState.wakes` was already on the wire and the renderer already
received it. Nothing read it. `grep` over `src/renderer/src` for `.wakes` returned
one comment and one unrelated identifier, which is why the type is declared in the
contract as part of this change rather than left as
`Array<Record<string, unknown>>`: the field decides whether two surfaces render at
all, so a rename on the wire has to be a compile error rather than two silently
empty surfaces.

## 2. The data, and the one unit that bites

`WakeState` (`~/local-operator/local_operator/session/frontend_state.py:933`):

| field | meaning |
|---|---|
| `id` | `w1`..`w16` — the schedule's identity, creation-ordered |
| `message` | the prompt a delivery would carry |
| `next_due_at` | the next fire instant, **epoch MILLISECONDS** |
| `created_at` | epoch milliseconds |
| `every_ms` | the recurrence interval in milliseconds, `null` for a single shot |
| `remaining` | deliveries left, `null` when not limit-bounded |

**`next_due_at` is milliseconds and every other clock on this wire is seconds.**
The job rows beside it (`start_time`, `settled_at`) are epoch seconds and the run
model divides them by 1000 on the way in (`readClock`). A wake's due instant is
not, and the failure mode is silent in the worst way: read the wrong way round, the
label simply prints a 1970 date and the row looks *plausible*. The unit is spelled
out on the contract type, on `WakeRow.nextDueAt`, on `formatWakeDue` and in the
fixtures' own helper, and the fixture helpers are deliberately two functions rather
than one `toWireInstant`.

`MAX_WAKE_SCHEDULES = 16` (`local_operator/harness/wake.py:47`) is the most the
wire can carry. Confirmed by reading that module, not taken from the brief.

### The one field the wire declares and never sends

**`remaining` is on `WakeState` and neither publishing path populates it.** Both
`frontend_state.py::_wake_state` and `attached.py::_cold_wakes` do
`WakeState.model_validate(schedule.model_dump())`, and the SCHEDULE
(`harness/wake.py`) carries `limit: int | None` and `fired_count: int` — there is
no `remaining` on it, so the model field defaults to `None` on every row. Measured
rather than read: a schedule created with `--limit 3` against a live backend
publishes

```json
{"id": "w3", "next_due_at": 1789528634262, "every_ms": 5400000, "remaining": null, "fired_count": 0, "limit": 3}
```

`every_ms` 5400000 is the `--every 1h30m` that was asked for, and `remaining` is
`null` beside a `limit` of 3 — so the bounded clause the brief asks for would be
**unreachable in the product while rendering in every fixture that filled the
field**, which is the worst shape a defect can take.

**The boundary this change takes is the UI's.** `run-detail-model.ts` reads
`remaining` first and falls back to `max(limit - fired_count, 0)` — the backend's
own arithmetic for the same quantity (`harness/wake.py::due_while_down` bounds a
catch-up by exactly that expression). No backend change was made: the two fields
are already published, both paths carry them, and `remaining` wins the moment a
runtime starts filling it. Reported in the PR rather than repaired here, because
the field is the backend's to populate and this repository does not own it.

## 3. The vocabulary: which of the app's two wake wordings this follows, and why

There are two wake vocabularies in the app already, and this change adds a third
surface that could have minted a third:

| | Where it lives | What it describes |
|---|---|---|
| "Wakes · N scheduled", `every 1h30m`, `once` | the TUI's dock band (`wake_panel.py`) | an **ARMED** schedule, in the future |
| "Scheduled wake w-9 (1, every 6h) — cancel with wake(...)" | the delivery receipt row (`receipt-row-model.ts`'s `wakeReceiptHeadline`, a verbatim port of `wake_receipt_headline`) | a **DELIVERED** wake, in the past |

**This change follows the band's vocabulary, and refuses the receipt's.** The
subject of both new surfaces is an armed schedule — the same object the band
lists — and the receipt's envelope is model-facing markup for a past event, which
is why the receipt row itself strips `(alarm)`/`Scheduled wake`/the cancel how-to
off the line before a user sees it. Copying that envelope onto a row that has not
fired yet would describe the wrong tense.

What that means concretely:

- the section's heading is **`Wakes`**, the band's own heading;
- the cadence is the band's own spelling — `once`, `every 1h30m` — plus the
  bounded form `every 6h · 3 left` (§ 5);- the **chip's** clause is `1 wake armed` / `2 wakes armed`. `armed` is the
  operator's own word and it is the right one *on this row*, where the
  neighbouring counts all state a condition (`3 to-dos open`, `2 subagents
  running`); the band's `N scheduled` is that surface's tally for its own heading.
  Both describe an armed schedule, so this is one vocabulary with two spellings,
  not two vocabularies — and the chip and the section print **one string from one
  function** (`wakeClause`), so the spelling cannot drift between them.

**The rejected alternative**: minting a third wording (for instance `3 pending
wakes`, or reusing the receipt's `(1, every 6h)` on the section rows). It would
have been three words for one object across two surfaces that are on screen at the
same time.

## 4. The chip

| | |
|---|---|
| reads | `RunDetails.wakes` |
| gated on | `runDetails !== null && wakes.length > 0` |
| spelled by | `wakeClause(wakes.length)` |
| leads with | `AlarmClock`, `size-3.5`, `aria-hidden` |
| opens | `section: "wakes"` |
| tooltip + name | `wakeChipLabel(armed)` — one derived string, `${WAKE_ACTION} — ${clause}` |

**One species with the plan chip.** Same control box (`READING_BUTTON`), same 24px
height, same radius, same padding, same hover ground and focus treatment, same
absence of `aria-pressed` — it REVEALS and never toggles, because a control that
closed the pane when pressed while looking for the wakes would be one control with
two meanings (`docs/composer-status-tabs.md` § 3.1).

**Position: goal, plan, wakes, subagents, jobs.** The wake chip sits *between* the
plan and the two activity chips. The row's meaning splits that way: the goal, the
plan and the wakes are what the session is **set up to do** (standing facts), and
the subagents and jobs are what is moving **now**. It is also the TUI dock's own
order, where the wake band renders directly above the plan band. The rejected
alternative — appending the newest chip at the end — reads `2 subagents running 3
wakes armed`, live work before a schedule, which is the reverse of how the two
groups relate.

**The gate is a VALUE, never a session**, and it is a count gate rather than the
plan's `0 to-dos open` still renders:

- `frontend.wakes` is empty on every session that has never armed one, which is
  nearly all of them, so `0 wakes armed` would be a line of chrome above nearly
  every composer in the app — the 24px box `docs/composer-status-tabs.md` § 2
  exists to prevent;
- and unlike the plan, there is no persisted "list of zero wakes" to be honest
  about: the list IS the schedules.

**The other half of the gate is the pane model.** `runDetails` is `null` for a
legacy non-canonical chat, which has no pane to open — so the chip is gated through
the model and not off `frontend.wakes` directly, exactly as the plan chip is. A
chip whose destination cannot open is a dead control.

**One glyph, one meaning.** `AlarmClock` is a MARK and not a state, which is why
nothing about it animates: this row's one motion is `SubagentStateIcon`'s spin, and
it exists because a child's state changes. A wake's state does not change — the
list is armed until it is not — so a moving mark would claim activity the wire is
not reporting. Rejected glyphs, each for a collision:

| Glyph | Refused because |
|---|---|
| `Clock` | `SubagentStateIcon` draws it for a capacity-QUEUED child on the chip beside this one — one glyph, two states, one row |
| `CalendarClock` | the schedules surface's glyph for a recurring job, and a wake is not a schedule job: different objects, different cancels |
| `Bell` / `BellRing` | the notification stack's, and a wake is a trigger rather than a notification |
| `Info` | the plan chip's, and one glyph in this row means one thing |
| no mark at all | what design review round 1's D1 refused for the plan chip: the count alone is plain muted text a reader has no way to tell from prose |

The Wakes **section's** rows wear this same glyph as their mark, so it means
"wake" on both surfaces rather than "press me" on one and "a wake row" on the
other.

## 5. The Wakes section

`run-detail-wakes.tsx`. One row per **SCHEDULE**, not per occurrence — the band's
own rule: a wake that fires hourly for a week is one schedule (`w1`) with one
next-due instant, and re-listing a recurrence per trigger would fill the pane with
the same wake.

**Sooner first.** The order is the due instant's, decided in the model
(`deriveWakes`) and not by the surface: `frontend.wakes` is the backend's
creation order (`w1`..`w16`), so a reader scanning for the next interruption would
otherwise have to compare every label themselves. A row with no readable instant
sorts **last** rather than first (`Array.sort` is stable, so those rows keep the
wire's order among themselves); treating an unknown instant as epoch 0 would put a
row the renderer could not date at the top of a soonest-first list.

Each row carries what a person needs to decide whether the wake is what they
intended:

| | |
|---|---|
| next fire | the local label (`formatWakeDue`), `text-ink-muted` |
| cadence | `once` / `every 1h30m` / `every 6h · 3 left`, `text-ink-dim` |
| prompt | the message, clamped at two lines, on the row's second line |

The bounded clause is `remaining`, or `max(limit - fired_count, 0)` when it is
absent — which is the case on the wire today (§ 2), and the reason the fallback
exists rather than a nicer-looking fixture.

**The two ports, and why the app's own helpers were not reused.**

- `formatWakeDue` ports `local_operator/wakes/display.py::format_wake_time`. The
  app's nearest helper (`features/schedules/…/schedule-list-item.tsx`) formats
  through `toLocaleTimeString(navigator.language, …)` and prints **no zone** — so a
  reader would get a bare `9:30` that implies UTC, at the one moment the question
  is "when does this actually fire". The port keeps the TUI's four rules verbatim:
  the local clock converted from the instant (correct across a DST change), a date
  when the due instant is not on today's local date, a year when it is not this
  year, an explicit `AM`/`PM` rather than the locale's `%p`, and the zone always
  visible. `24h` is the TUI's `display.time_format` setting and **this app has no
  such setting**, so the TUI's own default (12-hour) is what ships; a reader who
  has set the terminal to 24-hour will see the two spellings differ, and that is a
  missing preference in this app rather than a disagreement about the instant.
- `formatWakeDuration` ports `local_operator/harness/wake.py::format_duration`,
  and **not** the app's own `formatDuration`
  (`features/chat/session-status/session-duration.ts`). That helper is itself a
  port — of `tool_card.py` — and its own docblock states the rule this choice
  follows: "two spellings of one number is how a desktop app and a terminal come to
  disagree about what the same session did". It takes SECONDS, it stops at days
  (so a weekly wake would read `7d` where the band beside the same schedule reads
  `1w`), and its `100d+` cap is a width device belonging to a six-cell reading in a
  status strip. The duration a wake's cadence needs is the one `wake.py` defines.
- A **non-positive** `every_ms` reads as no recurrence at all (`once`, `everyMs:
  null`), which is the band's own test for the same field: its
  `if schedule.every_ms` is Python truthiness, so a `0` renders `once` there too.
  The wire cannot produce one (the minimum interval is 60 s) and the case is
  written because the fall-through is `every 0ms`, a row stating a cadence no
  scheduler has.

**The cap is the wire's own ceiling: 16 rows, with a statement marker as the
footer for anything past it.** `WAKE_ROW_CAP` is `MAX_WAKE_SCHEDULES`
(`harness/wake.py:47`), and it was six until UX round 1's U1 measured what six cost
here. The argument for six was the roster's — "this section is one list in a pane
that scrolls" — and it does not hold: the panes' other list SHEDS per phase rather
than scrolling (a 24-item plan leaves the whole region 9px of scroll), so six rows
did not buy the space the sentence claimed. What they bought was the operator's own
ask unkept: they asked to "see all the armed wakes", and above six the section said
more existed without saying which. Sixteen is the number the scheduler cannot
exceed, so a full session is the whole list, and the marker below the list is the
footer for a payload that exceeds the DECLARED bound (a hand-edited index, or a
future runtime that raises the limit) rather than the routine truncation it was.
The
marker is a **statement, not a control** — nothing in this pane can put a shed wake
back — so it wears the shared `Disclosure` primitive's `disabled` branch, which is
the plan's treatment for its own shed rows, and not the roster's `Show N more`,
which IS a control.

**The tally is the chip's clause.** The heading row's trailing slot prints
`wakeClause(details.wakes.length)` — the same string the chip carries — so the
count above the composer and the count in the pane it opens cannot state one number
two ways. The alternative, the band's `N scheduled`, was refused for exactly that
reason: one arm count spelled two ways across two surfaces that are on screen
together is how `1 to-dos open` reaches a user on whichever was written second.

**Absence is not a state.** Zero wakes renders no section, no empty heading and no
placeholder; the chip renders nothing for the same input. The two surfaces are
absent together.

**`hasRunDetails` is deliberately NOT widened.** The field answers "is anything
asking for something right now" (`run-detail-model.ts`), and an armed wake is a
future event that has asked for nothing yet. It gates the pane's quiet state, so a
wakes-only session would otherwise read "Nothing to show yet." under a chip
pointing into the pane — and it does not, because the section renders at
`wakes.length > 0`, which makes `sections.length` non-zero and the quiet branch
**unreachable** for that session. That is the honest answer: the section renders and
the quiet state cannot be reached, rather than the predicate silently widening to
mean something else at every one of its clauses. Asserted in
`scripts/run-detail-model.test.mjs` ("no wakes is absence…") so a later widening
has to come and argue with it.

**Order in the pane: after the tool jobs, before the MCP servers.** `docs/run-
sidebar.md` § 7.2 FIXES the section order rather than reordering sections by state,
and it fixes the MCP list as last — so a new section joins the end of the run's own
lists, which is where the Jobs section's own placement came from. The chip row's
order and the pane's are deliberately different orders on the two surfaces: the row
leads with the standing facts because it is 24px tall, the pane leads with the
roster because that is the live work a reader opened it for.

## 6. Nothing ticks

A wake carries an absolute local instant and a cadence, and neither is a function
of when it is read — so the section takes the **untimed** model, like the plan and
unlike the roster and the jobs list, and there is deliberately **no relative form**
("in 42m"). A relative label would have to be repainted to stay true, and
`run-details-clock.ts` exists to keep exactly that repaint off surfaces that do not
need it: the pane's clock re-measures only when an open child carries a clock.

The one cost, stated rather than hidden: a session left open across local midnight
keeps yesterday's date rule until the next wire frame arrives, because "is the due
instant today" is read against the frame's own instant (`nowMs`, pinned by the
fixtures so a frame's labels are reproducible).

## 7. Width, wrap, and the numbers

The row's budget was already spent: `docs/composer-status-tabs.md` § 5.4 budgets
~168px of a 204px content box for ONE count chip, the chips are `shrink-0`, and the
wake chip is the fourth. The wrap regime is unchanged — the chips are one group
that wraps inside its column, and the stacked arrangement below
`CHAT_CHIP_ICON_ONLY_PX` (240px) turns wrap off in its own query because in a
COLUMN container `wrap` wraps into extra columns, which is the horizontal overflow
the wrap exists to remove. What the fourth chip changes is *when* the group wraps,
by one chip's width, and that is what `wake-widths` measures.

The section's own width risk is its first line: a due label carrying a date, a year
and a zone plus a cadence is the longest thing any section draws. The due label
yields (`min-w-0 truncate`, its whole text in a `title`) and the cadence does not
(`shrink-0`), which is the pane's recorded yield order — the bounded figure is
never cut mid-word, the unbounded one has a second home.

## 8. Colour, motion and the contrast contract

- **No new role, no new token, no `CONTROLS` row.** The chip is the readings'
  control box the other three chips use, the section's rows are plain text on the
  pane ground, and the row's mark is an `aria-hidden` glyph in `text-ink-dim`. No
  new fill and no new border means nothing to add to
  `scripts/contrast-contract.mjs` — that table asserts over component triples, and
  a component that brings no fill and no border brings no pair to assert. Stated
  because green `check-themes` output about a component nobody listed is not
  evidence about that component.
- **No motion at all.** The wake mark does not spin and nothing on either surface
  animates: `docs/composer-activity-chips.md` § 8's rule is that a mark moves
  exactly while the work it names moves, and an armed schedule is not moving.
- **The rows are quiet.** No hover ground, no pointer cursor, no button role: a
  schedule is read here and cancelled by the agent, so there is nothing to press.

## 9. Evidence

| Frame set | What it is |
|---|---|
| `docs/evidence/chat-composer-status-row/wake-chip/` | The chip per state: wakes alone at the row's start, the plan-and-wakes pair, nine schedules, the no-wakes CONTROL band, and all five chips at 900. |
| `docs/evidence/chat-composer-status-row/wake-widths/` | The width story with four count chips at 900 / 240 / 220 / 172, each band printing its own row height and `overflowX` into the picture. |
| `docs/evidence/chat-run-panel/wakes-only/`, `--wakes-recurring/`, `--wakes-many/`, `--wake-long-message/`, `--wakes-and-plan/`, `--wakes-floor-320/` | The section: one schedule; three cadences published out of due order; nine schedules with the cap and its marker; a prompt longer than its row; the pair with the plan; and the pane's 320px floor. |

**What a story cannot settle, and what carries it instead.** A story has no live
`frontend.wakes` stream, so it cannot show a schedule appearing or retiring, and it
cannot show the *press* that opens the pane at the section — a still of an open pane
is not a still of the click. The press is carried by
`scripts/composer-tabs.test.mjs` (the request the chip FILES is pinned, its section
and its bumped nonce, and the source pins for the `Record` that resolves it, so a
destination added to the union and missed in the pane is a type error) and by
`docs/evidence/wake-live-app/` — the BUILT app, headless, against a real isolated
backend with real wakes armed by the real CLI, photographed through the app's own
`capturePage()` with the click dispatched through CDP's input pipeline. That set
carries the chip above the composer at one and at eight wakes, the same chip under a
real pointer and a real keyboard focus, a session with no wakes growing no row at
all, and the press: `live-wake-pane-press` and `live-wake-pane-many` are the pane
open at Wakes with the reveal landed.

   The one thing that set does NOT carry is a real wake RETIRING (§ 11.5), because
the isolated store is credential-less and a wake whose delivery cannot engage is
retained rather than consumed.

## 10. Rejected alternatives

| | Option | Verdict |
|---|---|---|
| A | A fourth section but no chip | Refused: the operator asked for the count above the composer, and a section nobody can find is the same defect one surface over. |
| B | A chip with no section (count only) | Refused, on `docs/composer-activity-chips.md` § 4's rule: a count with no list behind it is worse than neither. |
| C | `0 wakes armed` rendered like `0 to-dos open` | Refused (§ 4): the wire is empty for nearly every session, so it would be chrome above nearly every composer. |
| D | The chip appended after the activity chips | Refused (§ 4): it reads live work before a schedule, which is the reverse of how the two groups relate. |
| E | A relative due label ("in 42m") | Refused (§ 6): it would need a repaint to stay true, which is the 1 Hz reflow this pane's clock exists to avoid. |
| F | A countdown, or a "fires in" column | Same refusal as E, one column over. |
| G | An expander (`Show N more`) on the section's overflow | Refused (§ 5): the wake list is what the scheduler holds and nothing here can move a schedule, so a control would promise something no press delivers. The plan's disabled disclosure is the row for a statement. |
| H | Reusing the app's `formatDuration` | Refused (§ 5): it is a port of a different Python function, it takes seconds, and it would print `7d` where the TUI prints `1w` for the same schedule. |
| I | Reusing `schedule-list-item`'s local-time helper | Refused (§ 5): it prints no zone, so a bare `9:30` implies UTC at the one moment the question is when the wake fires. |
| J | Widening `hasRunDetails` to cover armed wakes | Refused (§ 5): it means "something is asking for something right now" and an armed wake is a future event; the section already keeps the quiet state unreachable. |
| K | Making the section's rows open the child/transcript, or offer a cancel | Refused: a schedule has no conversation to open, and cancelling is the agent's own operation (`wake({op:"cancel"})`) — a lit row that opens nothing is worse than a quiet one. |
| L | A second `wakes` count field on `RunDetails` beside the list | Refused: every row in the list is armed by definition, so `wakes.length` IS the count and a parallel number could only ever disagree with it (unlike `openChildren`/`openJobs`, which are filtered counts over lists that also hold settled rows). |
| M | Reading only `remaining` for the bounded clause | Refused (§ 2): the field is declared and never populated, so the clause would render in every fixture and in no real session. The fallback is the backend's own arithmetic, and `remaining` still wins when a runtime starts sending it. |
| N | Writing the fallback's two fields into a fixture's `remaining` instead | Refused: a frame that renders the clause off a field the product does not send is a frame that certifies an unreachable state, which is the failure this whole record is about. The fixtures carry `limit`/`fired_count` and a null `remaining`, exactly as the wire does. |

## 11. Risks, and what this does not settle

1. **The row's height can change when a wake is armed or retires.** This is the
   same cost `docs/composer-activity-chips.md` § 3 accepted for the activity chips,
   paid less often: a wake is armed by an explicit act and the chip's presence
   tracks it. The frames state the numbers rather than arguing the cost is small.
2. **A schedule's prompt is unbounded and this pane shows two lines of it.** The
   tooltip and the `sr-only` twin carry the whole (unflattened) text, which is the
   pane's own treatment for the plan's blocked reason. A prompt whose *structure*
   (a list, an indented block) carries meaning reads flattened in a row — the
   deliberate cost of a list row.
3. **The date rule is read at derivation time**, so a session left open across
   local midnight keeps yesterday's rule until the next frame (§ 6).
4. **No `24h` preference**, because this app has none — the label follows the TUI's
   default and § 5 says so rather than pretending the two agree everywhere.
5. **A live scheduler's RETIREMENT is still not verified, and the live frames do
   not claim it.** What `docs/evidence/wake-live-app/` verifies is the press, the
   reveal, the chip's two gates and the chip's count against a real armed store
   (agent review round 1's major 1 was that § 9 claimed this before it existed).
   The retirement half is unreachable in an isolated credential-less store, and
   this is measured rather than assumed: with no provider signed in, the
   supervisor's engage dies at construction
   (`HostingNotConfiguredError: Hosting platform is not configured`) and the
   schedule is RETAINED past its due instant rather than consumed, so neither "the
   chip clears while the reader watches" nor "the receipt row arrives" can be
   produced here. UX round 1's U2 is the nearest state a live pass reaches, and it
   is recorded as such rather than dressed as a retirement.
6. **The chip and the tally are a READING of the last canonical state, not a live
   watch of the wake index.** UX round 1's U2 measured the gap on a COLD session:
   with the pane open, emptying the session's schedule in an isolated index produced
   no update across 45 samples over 132s (`1 wake armed` throughout), and re-entering
   the conversation cleared both surfaces cleanly — no stranded heading, the pane
   still open. The reviewer's own caveat is part of the finding and is carried here:
   a `headless` window never receives the app's focus/visibility refresh, so a
   focused window may well refresh on its own, and a cold session has no runtime
   publishing anything in the first place — which is also the operator's own reading
   state for an old conversation. What is NOT claimed: that a wake index is watched.
   Nothing in this change subscribes to it, and closing that gap means a new
   subscription rather than a rendering fix.
6. **The wire's `remaining` is dead, and this change reads around it rather than
   repairing it** (§ 2). The consequence for a reader of these frames: every
   limit-bounded row in them renders its bound from `limit - fired_count`, which is
   what a real session does too. If the backend starts populating `remaining`, the
   clause silently starts coming from that field instead — the same string, and
   `scripts/run-detail-model.test.mjs` pins both paths so the switch is visible in
   the suite rather than only in production.
