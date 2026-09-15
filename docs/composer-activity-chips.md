# Composer activity chips — running subagents and jobs, and the run pane's blip

The design record for the two chips the composer's status row gained after the
plan count, the run pane's **Jobs** section, and the second ink the header
trigger's dot can take. `docs/composer-status-tabs.md` is the row's own record and
§ 5.5 defers here; `docs/run-sidebar.md` § 3.4 and § 4 are the pane's, and each
carries the amendment this change made to it.

## 0. The ask, verbatim

> "Add a tab/summary similar to the todos in local-operator-ui which shows the
> number of running subagents, number of running jobs, etc. which can help to
> indicate that there is activity on the session, and show a blip on the info
> button when there are subagents so that users can know that there's something
> there."

> "It should probably be in the same row as the todos since it's a similar
> status-related thing and clicking the subagents (should have an animation/effect
> while active) or jobs (same) should open the run status tab same as the todos."

Three nouns, one surface. "Subagents" and "jobs" are **not** the same rows (see
§ 1), one row of chips holds both, and both open the on-demand surfaces
`docs/on-demand-surfaces.md` describes — nothing here is a new kind of thing to
learn, which is why the chips are the plan chip's own control box and the blip is
the dot the failure ledger already lights.

## 1. Two chips, because the wire has two lists

`CanonicalFrontendState.jobs` is `comms.job_rows()`: the ROOT session's job manager
plus every live child's (`harness/comms.py:799-815`). It carries both kinds of
activity, and the runtime's own vocabulary is exactly two words —
`JobType = Literal["bash", "task"]` (`harness/jobs.py:216`):

- a **delegated child** is `type: "task"` (`harness/subagent.py:656`) — the
  roster's rows, and the only rows the child reader can open;
- a **tool job** is `type: "bash"`, whatever tool ran, because a settled job's
  completion is auto-delivered only for `("task", "bash")`
  (`tools/eval.py:937-945`) and the label carries the distinction
  (`bash: <command>`).

`deriveRunDetails` therefore PARTITIONS the list rather than filtering it
(`run-detail-model.ts:931-960`): `bash` → `RunDetails.jobs`, `""`/`task` →
the roster's candidates, and **any other word → neither**. The third case is
written rather than left implicit: an unrecognised `type` is not evidence that a
row is a child (round 1's over-reporting) and it is not evidence that it is a
shell job, so it belongs under no heading whose tally would then disagree with it.
The two lists are still separate — `deriveChild` derives both, and the tool rows
are re-measured on the roster's own tick (`run-details-clock.ts`, because a
running `bash` row's elapsed label is drawn) — and none of this is a wire change.

**One combined "activity" chip is refused**, and for two reasons: it would be a
button inside a button (the reason this row sits outside the composer box at all,
`composer-status-row.tsx:1-42`), and its click would have to choose between two
sections that cannot show each other's rows. "N subagents running, M jobs running"
is a sentence, not a control.

## 2. What each chip says, and the mark that leads it

| | subagents chip | jobs chip |
|---|---|---|
| reads | `RunDetails.subagents` | `RunDetails.jobs` |
| derived by | `activityTally(rows)` | `activityTally(rows)` |
| spelled by | `childClause(tally)` (`run-detail-model.ts`) | `jobClause(tally)` |
| leads with | `tally.mark` | `tally.mark` |
| opens | `section: "subagents"` | `section: "jobs"` |

**One spelling per count, in the model, and ONE derivation for the sentence and
the mark.** `childClause` was module-private while the trigger was its only reader
and is now exported; `jobClause` is new; both are the functions the trigger's
tooltip prints, so the tooltip above the composer and the chips in it cannot state
one number two ways. The visible label is the model's clause and nothing here
tallies (`scripts/composer-tabs.test.mjs` pins the absence of a local filter, a
status comparison and a length).

**The clause takes a tally, never a bare number**, and that is the fix for a
defect design review round 1 (D1) found in the pixels and UX round 1 (U4) found in
the copy: the chips printed `N running` for ANY unsettled row while the mark
beside them drew `Clock` for a capacity-queued child or `CirclePause` for a parked
one. The mark is `aria-hidden` by the roster's own contract, so the sentence was
not a second opinion — it was the only reading assistive tech got, and it said a
parked child was working. `activityTally(rows)` returns `{ count, mark }` or
`null` (the chips' gate), `childClause`/`jobClause` are defined over that object,
and the row has no `count`-shaped argument to pass: a sentence built here has a
state by construction, so the two cannot drift back apart. The roster's own
`CHILD_STATE_WORD` supplies the word (`running` / `queued` / `paused`), and
`todoClause` is untouched — to-dos have one open state.

**The mark is the roster's, not a new one.** `SubagentStateIcon`
(`run-detail-row-parts.tsx:74-96`) already encodes the whole contract — one mark
per state, `motion-safe:animate-spin` for `running` and nothing else, shape as the
contract with motion as the bonus, and never the accent ink ("the accent green is
a scarce budget and a child at work has not done anything yet"). Importing it is
what keeps the row at one glyph per meaning: `Info` stays the plan chip's alone,
and the reader who learns the roster's marks reads the chips without a legend.

**`activityMark` is the busiest open row** (`run-detail-model.ts`), and its
precedence IS `OPEN_CHILD_STATUSES`' own order — running, then queued, then
paused. With one row open, the ordinary case, the mark is simply that row's own;
with several, a spinner beside a queued sibling is the honest reading of
"something here is running", and taking the first row on the ledger would make the
mark depend on the ledger's order. **It returns `null` when nothing is open**, and
the chips gate on that rather than counting separately: the mark and the number
come from one predicate (`isOpenRow`), so "the chip renders" and "the number it
prints is positive" cannot come apart (pinned over a matrix of wire shapes in
`scripts/run-detail-model.test.mjs`).

A settled row never contributes a mark, including a FAILED one: a failed child is
the trigger dot's `danger` fact, and a `failed` mark on a chip that stands for
running work would be that fact in a second, quieter place.

## 3. The gate: a chip needs a value, never a session

Both chips are gated on there being something open to count, and that is a
deliberate departure from the plan chip's "`0 to-dos open` still renders" rule
(`docs/composer-status-tabs.md` § 3.1).

**The gate's other side is a control that unmounts under its own focus, and the
row hands focus back when it does** (UX round 1, U1 — observed live:
`active=BUTTON/jobs`, then `active=BODY/None` the moment the last running row
settled). The browser drops focus to `<body>` rather than restoring it, so the next
`Tab` starts from the top of the document instead of from the composer the user was
writing in. The row does what the pane trigger above it already does for its own
close: a CONDITIONAL refocus — and the condition has two halves, because by the
time the effect runs the browser has already moved focus and the evidence is gone.
The row must have HELD focus at the end of the previous commit (`rowHeldFocus`),
and must have lost it (`!holdsFocus`) while shrinking (`chipCount` fell). Without
the first half, every settle in a session whose user was typing in the transcript
would yank focus into the composer. The target comes in as a prop from the
composer's owner (`onFocusComposer`, the same `textareaRef` the field renders)
rather than being found by selector from here, because a row rendered BY that
component reaching back for its box would be a second way to name one element.

- The plan's zero is **persisted state**: `frontend.todos` outlives the run, so
  `0 to-dos open` is an honest statement about a plan that exists.
- `frontend.jobs` is **swept minutes after a row settles**. A lingering
  `0 subagents running` would describe rows that are about to vanish, and — the
  larger cost — it would put a chip above every composer on every session that
  has ever delegated anything, which is the empty 24px box
  `docs/composer-status-tabs.md` § 2 exists to prevent.

The consequence is stated rather than hidden: **the row's height changes when the
last child settles**, from a wrapped or one-line arrangement back to fewer chips.
`docs/evidence/chat-composer-status-row/activity-chips/` photographs the settled
band beside the live one for exactly this reason.

## 4. The Jobs section (the pane's fourth)

`run-detail-jobs.tsx`. The jobs chip opens it, and it ships with the chip or
neither ships: a chip pointing at the roster would open a section that **cannot
show its own rows** — the roster is a filter on `task`, pinned since round 1
(`scripts/run-detail-model.test.mjs`).

- **Presence**: `details.openJobs > 0`, the same rule the chip is gated on, so the
  section draws exactly the rows its own count claims. `hasRunDetails` gained the
  same clause (`run-detail-model.ts:1197`) so the pane's quiet line cannot claim
  "Nothing in flight" over a section that is drawing rows.
- **The slice is the model's predicate** (`isOpenRow`), not a local status
  comparison: the section and `openJobs` cannot come to different answers.
- **Quiet, non-interactive rows.** A tool row carries no `session_id`, so
  `childOpenable` is false for every one of them and there is no reader to open:
  the rows render as the roster's own DEGRADED row — label, state mark, the state
  in words (the mark is `aria-hidden`) and the numbers run, with no hover ground,
  no pointer cursor and no button role. A lit row that opens nothing is worse than
  a quiet one.
- **One line per row.** The roster gives a child a second line because a
  delegation's activity is the most useful live datum in that list; a tool row's
  second line is the command it is running, which its label already is. What the
  row states is the label, the mark, the state and the ELAPSED clock — the one
  figure that moves, and the reason the pane's clock re-measures this list too.
- **The row body is shared** (`SubagentRowBody`,
  `run-detail-row-parts.tsx`), extracted from the roster's private one in this
  change: two copies of that markup would be two places for the 32/48/64px row
  height contract to drift, and the failure would be silent.
- **Order**: after the plan, before the MCP servers
  (`run-details-panel.tsx`; `docs/run-sidebar.md` § 7.2's order rule is why it
  did not try to sit beside the roster it is derived from).
- **The tally reuses `subagentTally`** verbatim over this list, at the section's
  own `tallyBudget`: same eviction ladder, same voice — `1 running` above a row
  whose mark says the same thing.

## 5. The blip: one dot, two inks

`run-details-trigger.tsx`. The dot has always meant "something needs your
attention and you have not looked" (`docs/run-sidebar.md` § 3.4, two ledgers, each
with its own `seen`-set). It now also carries **live activity**:

```ts
const activity = details !== null && !listOnScreen && details.openChildren > 0;
```

- **It is not a third ledger.** There is no `seen`-set, no `useState`, nothing to
  acknowledge: the whole gate is `!listOnScreen`, which is the term the failure
  ledger already reads, so the ink clears the moment the pane paints the list.
  `scripts/composer-tabs.test.mjs` pins both halves — the ink switch AND the
  absence of a `seen`-set.
- **Distinguished by ink, not by shape.** `bg-danger` when attention, `bg-info`
  otherwise: one 8px mark in one position, because two marks on a 32px control is
  a decoration nobody can read, and both facts answer one question — is there
  something in the pane I should look at.
- **Subagents only, never jobs.** A background `eval` may legitimately run for
  hours; a jobs-driven dot would mean "a long job exists" on a session nobody has
  touched since yesterday, and a dot that is always lit is a dot nobody reads. The
  jobs count still reaches the user through the tooltip and the chip.
- **No clause is added to the accessible name.** The label already carries
  `1 subagent running` (`runDetailTriggerLabel`) whenever the activity ink is up —
  which is the reverse of the failure case, where no clause exists and the dot is
  the only statement it makes, which is why `aria-hidden` on the dot is right
  there and right here.
- **The `danger` ink is unchanged**, so the `mcp-dot-ack` pair still photographs
  the ledger it was written for. Its fixture changed (see § 8) because with the
  second ink in place a run with RUNNING children can no longer show a closed pane
  with the dot OFF — which is not a broken story but the new rule working.

## 6. The reveal: three sections, one request, focus unmoved

`RunPanelSection = "todos" | "subagents" | "jobs"`
(`shared/store/ui-preferences-store.ts`; the type's docblock already reserved the
place for the second member). `revealRunPanelSection` and `RunPanelReveal` needed
no change — the nonce, the slot claim and the one-update rule are the same — and
the pane's consume-once effect resolves the request through a **section→ref map**
(`run-panel.tsx`), so adding a section does not add a branch per section.
Everything else is identical and deliberately so: a reader is left first and the
request is held; the request is retired on its nonce; and focus does not move
(`docs/composer-status-tabs.md` § 5.2). A request whose section is not on screen (a
child that settled between the press and the effect) resolves to nothing and is
retired, which is the behaviour this path already had for its one section.

**The pane moves its own region and nothing else, and this change is where that
became true.** The reveal used `target.scrollIntoView({ block: "start" })`, whose
default `container: "all"` walks every scrolling ancestor: at 1024x673 the chat
column's slot row is scrollable because the pane does not fit beside the column, so
pressing the plan chip slid the FRAME 108px (221px at 800x600) and the operator
reported it. PR #207 exists for exactly that, is still open and conflicting, and
its author session is gone; this branch adds TWO more triggers for the same defect
(the subagents and jobs chips), so the fix could not wait for it. The helper is
`scrollRegionToTop(region, target)` in `shared/lib/scroll.ts` — PR #207's own
function, same name and semantics, adopted here because a second copy in a second
place would be worse than landing it once — and it assigns the pane's own
`scrollTop`, computed from rects, clamped by the browser. **If #207 lands first,
delete `shared/lib/scroll.ts` and import its copy.** The map is a
`Record<RunPanelSection, RefObject<HTMLElement | null>>` rather than a chain of
ternaries, because as a chain the last arm was a catch-all and a fourth member of
the union would have compiled and silently scrolled the JOBS section (agent review
round 1, m2); the omission is now a type error.

**It clamps, and the record says so rather than claiming every reveal lands at the
head.** When the content below the target is shorter than the region, the
assignment stops at the region's own maximum: QA round 1 measured the Jobs chip at
`scrollTop 447 === maxScroll 447` on a short wire, which is the section as close to
the region's head as the region allows. A wire with a real wall of MCP servers
below it lands the section exactly at `top 0` (the same round measured 108 of 251).
Focus still does not move, and nothing animates.

## 7. Width, wrap, and the numbers

The row is at its budget: `docs/composer-status-tabs.md` § 5.4 budgets ~168px of a
204px content box for ONE count chip, the chips are `shrink-0` on the record's own
rule that a bounded count is never cut, and the app's real column floor is 172px.
So the row wraps above the floor, and the stacked arrangement **turns wrap back
off in its own query** — in a COLUMN container `wrap` wraps items into extra
columns, which is the horizontal overflow the wrap exists to remove.

Measured on the frames (`docs/evidence/chat-composer-status-row/activity-widths/`,
which prints its own numbers into the picture, after `document.fonts.ready`):

| Column | Row height | `overflowX` | Chips |
|---|---|---|---|
| 900px | 32px | 0 | 4 |
| 240px (`CHAT_CHIP_ICON_ONLY_PX`) | 80px | 0 | 4 |
| 172px (the floor) | 106px | 0 | 4 |

At 240px the three count chips take the lines under the goal; at the floor the
row stacks, the goal first and the chips under it. The heights are the cost, and
§ 3's gate is what keeps them from being paid on a session with nothing running.

**The counts are ONE GROUP, and the goal keeps a floor.** Both are design review
round 1's D2, and both are layout properties rather than taste. With the chips as
siblings of the goal, the wrap regime tore: on the line the goal shared with one
chip, the goal's `flex-1` box stretched to the line and pushed that chip to the
RIGHT margin, while its siblings started a left-aligned column underneath — a 35px
gap that was a stretched box and not the row's 8px `gap-x-2` — and the 172px floor
read BETTER than the 240px band above it (`Goal: Reconcile t…` against
`Goal: Rec…`). As one flex item the row wraps the goal's line and the counts' line
and the chips wrap among themselves, left-aligned, inside a column that cannot hold
them: `flex min-w-0 flex-wrap` and deliberately not `shrink-0`, because the group
has to shrink to a narrow column and wrap INSIDE it. The goal's `min-w-[140px]` is
the second half — flex breaks lines on each item's hypothetical size, so the floor
is what makes the row wrap the WHOLE group under the goal instead of letting the
two share a squeezed line — and 140px is the width at which the chip still says
something (its chevron, `Goal:` and padding measure ~75px of fixed ink).

The arrangement is photographed at three widths and in three browser states
(`activity-widths/`, and `activity-stacked/` at 240px at rest, hovered and
keyboard-focused, the last two through the rig's own input because `:hover` and
`:focus-visible` are browser state a story cannot set).

## 8. Colour, motion and the contrast contract

- **No new role and no new token.** The chips use the readings' control box
  (`READING_BUTTON`), the roster's mark and its inks, `text-ink-muted`/`text-ink-dim`
  and the semantic `info`/`danger` the palette already owns.
- **`scripts/contrast-contract.mjs` gains a `GRAPHICS` row.** That table exists for
  a fill that carries meaning and holds no text, and the trigger's dot is exactly
  that and was unlisted: the contract was blind to the `danger` dot and would have
  been blind to the `info` one. Both are now asserted on **both of the grounds the
  dot actually sits on** — `canvas`, and `accentWash` for the pressed trigger,
  because `-top-0.5 -right-0.5` leaves about 6 of the dot's 8px inside the button
  and the pressed state is precisely the one where `info` is drawn (agent review
  round 1, n1) — at the 3:1 non-text floor, listed separately for the same reason
  the `/usage` status dots are: a set of semantics that passes on average is not a
  set of semantics.
- **Motion is the roster's own.** `motion-safe:animate-spin` on a running row, no
  new keyframes, and reduced motion leaves the shape that already distinguishes the
  state (`styles/index.css` CAPS durations rather than cancelling anything, so the
  mark must land on a visible end state).
- **What the frames can and cannot show about that motion.** The capture rig injects
  `animation: none !important` before every shutter (`capture-evidence.mjs`), so NO
  ordinary frame in this repository can show a spin, and two stills of one story are
  byte-identical by construction: the first version of
  `activity-chips-reduced-motion` was exactly that, and design review round 1 (D3)
  was right to call it a comparison that was not one. Three separate claims are
  therefore carried separately rather than by one picture:
  1. the class contract is pinned in a test, not in a frame —
     `scripts/composer-tabs.test.mjs` asserts `motion-safe:animate-spin` on a
     running mark and its absence for `queued`/`paused`;
  2. `activity-chips-reduced-motion/` shows what the CAP does to the PAINT (the mark
     lands visible, in all four bands) and proves nothing about the animation, since
     the animation was off in both frames;
  3. `activity-motion-1/` and `activity-motion-2/` are the pair that shows the spin
     actually turning: the rig's `{ liveMotion }` tuple skips the override for those
     two shutters only, so the same story, theme and rig are photographed a rotation
     angle apart. Their limits are stated with them: they prove the shipped class
     animates, and they are a Storybook wire fixture rather than a live app.
- **No hover ground, no lift, no scale** — hover is the colour step the readings'
  box already ships.

## 9. Evidence

| Frame set | What it is |
|---|---|
| `docs/evidence/chat-composer-status-row/activity-chips/` | The gate, per state: both lists in flight, jobs alone at the row's start, a parked child (Clock, nothing spinning), and settled work with no chip at all. |
| `docs/evidence/chat-composer-status-row/activity-widths/` | The width story at 900 / 240 / 172, each band printing its own row height, `overflowX` and chip count into the picture. |
| `docs/evidence/chat-composer-status-row/activity-chips-reduced-motion/` | The same states with `prefers-reduced-motion: reduce`: the mark is a visible shape, not a paused animation. |
| `docs/evidence/chat-run-panel/jobs-in-flight/`, `--jobs-only/` | The section: two running tool rows, a settled row on the wire and deliberately not drawn, and the jobs-alone pane. |
| `docs/evidence/chat-run-panel/trigger-activity-dot/` | The blip: pane closed, a child running, the dot in `info`. |

**What no still can show, and what carries it instead.** The capture rig injects
`animation: none !important` before every shutter
(`scripts/capture-evidence.mjs:1851-1855`), so no Storybook frame can photograph
the spin. It is therefore pinned as a class string in
`scripts/composer-tabs.test.mjs` ("a running activity chip carries the roster's
spin, and only the running state does"), the reduced-motion frame proves the mark
lands visible, and the frames prove the geometry. A frame the rig cannot produce
is not a licence to claim motion nobody verified.

## 10. Rejected alternatives

| | Option | Verdict |
|---|---|---|
| A | One combined "activity" chip | Refused (§ 1): a button inside a button, and one click that has to choose between two sections that cannot show each other's rows. |
| B | The chips pointing at the roster | Refused (§ 4): the roster is a filter on `task`, so a jobs chip would open a section that cannot show its own rows. |
| C | A `danger`/`info` PAIR of dots, or a second mark | Refused (§ 5): two marks on one 32px control is a decoration nobody can read, and both facts answer one question. `docs/run-sidebar.md` § 3.4 refuses a ranked pair for the same reason. |
| D | A third ledger with a `seen`-set for activity | Refused (§ 5): the state already exists — "the pane is not showing the list" — and a copy of it would go stale the moment a child settled unseen. |
| E | A dot driven by jobs too | Refused (§ 5): a background `eval` can run for hours, so the dot would mean "a long job exists". |
| F | A numeric badge on the trigger, mirroring the chips | Refused — `run-details-trigger.tsx`'s own record: a badge that ticks draws the eye to something the user is not going to act on, and the counts are the first thing the tooltip says. |
| G | `animate-pulse-visible` on an active chip | Refused: that role is the loading skeleton's, and its own docblock says so (`styles/index.css:157-191`). The roster's spin is a state, not a placeholder. |
| H | `0 subagents running` rendered like `0 to-dos open` | Refused (§ 3): the wire sweeps the rows, so the sentence would describe rows about to vanish and the chip would appear above every composer that ever delegated. |
| I | Counting in the composer (a local `.filter(...).length`) | Refused: the model derives both counts off the one `deriveRunDetails` call, the rule `docs/composer-status-tabs.md` § 3.2 fixes for the plan. |
| J | Fetching the roster from the trigger to decide the dot | Refused: the panel owns that read; a trigger with its own copy could acknowledge a row the panel never drew (the same argument `RunDetailsTrigger`'s `mcpServers` prop records). |
| K | A `seen`-ledger for the activity dot, so it lights only for work nobody has looked at (UX round 1, U3) | Refused, and it is the OPERATOR'S OWN ASK that refuses it: "show a blip on the info button when there are subagents so that users can know that there's something there". A ledger answers "what is new since you last looked" instead. The cost is real and recorded: for a user who delegates and keeps reading, the dot is lit for the whole run, in the same 8px slot the failure dot uses. The two facts are distinguished by INK (`danger` / `info`), and the failure fact is stated nowhere else — it is `aria-hidden` with no clause in the trigger's label — so the ink is what carries it. |
| L | Reordering the pane's sections to match the row's chip order (UX round 1, U5) | Refused: the pane's order is its own record's (`docs/run-sidebar.md`), it is the order of the sections' AGE — the plan, then the roster, then the jobs — and moving a reader's sections to mirror a composer row would be a layout change to fix a mnemonic. The divergence is recorded here instead: the row reads subagents-then-jobs, the pane reads to-dos, subagents, jobs. |
| M | The chip's on-surface text saying where it goes, not only how many (UX round 1, U6) | Refused: the operator asked for counts, the destination words are the tooltip and the accessible name (one derived string each), and the row is at its width budget (§ 7). "2 subagents running" is the reading; "Open the subagents in run details" is the control's name. |

## 11. Risks, and what this does not settle

1. **The row's height is now visible in three arrangements.** A session with four
   chips wraps inside a 240px column, and the composer box moves down by the extra
   lines. The frames state the numbers rather than arguing the cost is small, and
   § 3's gate is what bounds how often it is paid.
2. **The settled row's mark is not the roster's `failed`/`done` mark.** A tool row
   whose wire word is `succeeded` folds to `unknown` (`foldStatus` has no such
   case) — settled, quiet and `CircleHelp`. It is **not reachable through this
   change** (the section draws open rows only, and `activityMark` ignores settled
   ones), so it is recorded here rather than repaired: the fix belongs to
   `foldStatus` and would change the roster's own marks.
3. **A child's own tool job is drawn and counted as the session's** (agent review
   round 1, m1 — **deferred**, and recorded here plainly because the copy must not
   claim ownership). `frontend.jobs` is `comms.job_rows()`, which walks the root
   session's manager **and every live child's** (`~/local-operator/local_operator/
   harness/comms.py:799-815`), so a Jobs row may be a child's own `sleep 150`; the
   jobs chip's count and the section's tally are the whole tree's, and a Jobs row
   carries no owner signal — no lineage, no second line, no `session_id` (a bash
   job has none), which is also why every row in the section is non-interactive. A
   detached shell can outlive its registrant (`registrant_id=None`), so a child can
   settle while its shell still runs and the pane then reads "1 job running" with no
   child row to attribute it to. That is a WIRE property, not a rendering choice:
   making the rows say whose they are needs `JobState` to carry an owner, which is a
   change in the backend repository and is not in this PR. The section's README-level
   claim is therefore "the session's jobs, tree-wide", and the copy says `Jobs`
   rather than `Your jobs`.
4. **A settled row removes its chip silently** (UX round 1, U2 — **deferred**). The
   row unmounts, the row's height drops (28px to 0 in the measured bands) and the
   trigger's label drops the clause; nothing says "2 subagents finished". A settled
   ECHO would be a new behaviour nobody asked for, and the transcript's job-result
   row is the existing receipt for the same event — the surface this row is on is a
   status line, not a log. Recorded because it is a decision a user cannot see, and
   because the plan chip's opposite rule (`0 to-dos open` persists) is stated where
   this one should be read against it.
5. **`+N more` does not exist for the jobs list.** The roster sheds under a cap;
   the Jobs section does not, on the reasoning that a session running a dozen
   background shells is not yet a state this app has seen. If it becomes one, the
   roster's cap and its disclosure are the pattern to copy rather than invent.
