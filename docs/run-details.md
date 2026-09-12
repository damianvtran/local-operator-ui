# Run details — subagents and to-dos in the desktop chat header

Status: the surface is WIRED as of the finish round — `chat-page.tsx` derives the
view model from the canonical stream and hands it to `ChatHeader`, so the trigger
appears in the running app for a session with work in flight. The design record
below is written as the proposal it was judged as; § 8 carries the two notes the
wiring added.

Scope: the Electron renderer (`local-operator-ui`). The TUI
(`~/local-operator`) is the reference implementation for both data models and is
cited throughout rather than paraphrased from memory.

---

## 1. The problem

A desktop chat turn is opaque while it runs. The agent may be running four
subagents, each on its own model, each spending its own context and money, and
holding its own plan — and the desktop shows none of it. Today the only
subagent output on screen is a single `notice` line minted when a child ends
(`features/chat/canonical/transcript-reducer.ts:1090-1103`); `subagent_start` and
`subagent_progress` fall through the reducer's `default` and are dropped
(`:1105-1106`). A `task` or `hub` call is painted as an ordinary tool row whose
category is `meta` and whose glyph is the generic `Users`
(`trace/tool-row-model.ts:279-286`, `trace/tool-glyphs.ts:54-79`).

To-dos are in the same place. A `todo` call becomes a generic ledger row
(`tool-glyphs.ts:61`), and the plan itself is only ever visible as unstructured
text behind that row's disclosure. The session's phased plan is on the wire —
`frontend.todos` — and no renderer file reads it.

Meanwhile the backend already delivers everything the surface needs:

- `CanonicalFrontendState.jobs` and `.todos`
  (`src/shared/desktop-session-contract.ts:133-134`), forwarded on every
  `frontend.update` delta. `JobState` carries `label`, `agent_role`, `status`,
  `queued`, `latest_details`, `error_text`, `result_text`, `model_label`,
  `context_window`, `usage`, `direct_cost`, `start_time`, `settled_at`,
  `parent_job_id` and the child's own `todos` plan.
- `TodoPhaseState { name, items: TodoItemState[] }` with
  `TodoItemState { text, status, reason }`.

So this is a presentation gap, not a data gap. That is the whole reason a small
surface is the right answer.

## 2. What the TUI does today (the reference)

Both facts below come from the TUI's own code and design records; they are what
this proposal ports, and where it deliberately departs it says so.

### 2.1 Subagents — a flat, start-ordered dock roster

The TUI mounts a `SubagentPanel` in a dock band between the transcript and the
composer, alongside the to-do panel. It is `display: false` when there are no
`task` jobs, so an idle session has a zero-height band
(`local_operator/tui/widgets/subagent_panel.py:2166-2174`, and the band
positioner's own comment at `local_operator/tui/app.py:7056-7059`).

One row per job, with a fixed grammar (`subagent_panel.py:1056`):

```
• <label>  <glyph> <elapsed> · <context> · <cost>    <activity>
```

The rules that matter for the port:

- **Motion means alive, colour means failure.** The running state is a spinner
  in `muted` ink; queued, cancelled and done are `dim`; failed is `danger` —
  and failure is the only colour the panel spends (`subagent_panel.py:345-391`).
- **A settled roster row carries its OUTCOME, not its progress.** `row_facts`
  fills the row's second field from `error_text` for a failure and from
  `result_text` for every other settled state (`:628-640`); the only settled row
  that goes quiet is the one whose page is already open (`:653-660`, `if current
  and not running`), and the collapsed preview never is that row (`current=False`).
  **§4.1 departs from this on purpose, and says so there.**
- **Numbers are omitted when unknown, never zeroed** (`:429-450`).
- **Overflow is a budgeted priority slice**, not the newest N: running and
  queued first, then failed, then the two states that end without settling —
  `interrupted` and `paused`, which the TUI ranks together at 2 — then settled,
  ties newest-first (`:2051-2099`), always disclosing `+N more` (`:1964-1982`).
  § 6.3 states the one bound on that slice (`paused` here is the restored
  record's word; § 3.3 has why).
- **Failure re-emerges a hidden panel.** `note_child_failed` brings a hidden
  panel back as a single `1 failed` summary row regardless of the user's
  density setting (`:1837-1852`). This is the one case the TUI refuses to let
  the user miss, and it is the precedent for the failure dot in §6.
- There is **no unread badge and no blocked-while-waiting state** on the dock;
  a child's question is only visible inside the child's full-page transcript.

### 2.2 To-dos — a phased panel whose encoding is luminance plus a word

The phased to-do panel (`local_operator/tui/widgets/todo_panel.py`) renders,
per item:

| status | mark | body ink | trailing |
|---|---|---|---|
| pending | `- [ ]` | muted — open work is an instruction | — |
| done | `- [x]` | dim, struck — settled work is a record | — |
| dropped | `- [-]` | dim, struck | ` — dropped` (dim, not struck) |
| blocked | `- [~]` | full ink, the loudest row in the panel | ` — blocked: <reason>` |

with the rationale written into the source itself: *"OPEN vs SETTLED is
LUMINANCE … WHICH open and WHICH settled state is a WORD … No colour,
deliberately — the dock band spends colour on failure and on nothing else"*
(`todo_panel.py:1754-1778`). Phases carry a header `PhaseName · done/total`
(`:1256-1267`), items indent two spaces under it (`:1103-1105`), and overflow is
disclosed rather than truncated (`+N more · ctrl+t to expand`, `:1269-1306`).

Two TUI behaviours are **deliberately not ported**:

- **The 60 s auto-hide of settled phases** (`:753-792`). It exists to keep a
  permanently-visible dock band from accumulating closed work. A popover the
  user opens on purpose and closes in seconds has no such problem, and a list
  that reflows under the reader while it is open is a defect, not a feature.
- **The `ctrl+t` expand cycle** (`:487-496`). The popover is the expanded view;
  there is no collapsed roster to cycle between.

## 3. The surface

### 3.1 Options considered

| | Option | Verdict |
|---|---|---|
| A | A dock band above the composer, mirroring the TUI (`app.py:7054-7102`) | Rejected. It reclaims transcript height on every turn, needs a new slot in the chat column's flex layout, and forces one placement decision for two surfaces with different lifetimes — a child roster is transient, a plan is reference material. The most invasive of the four. |
| B | Live rows inline in the transcript, one card per child | Rejected on the design contract: branding.md § 7 requires a completed action to be one line, not a card, and prefers one disclosure idiom app-wide. It would also duplicate what `task` tool rows already record. |
| C | A third pane or a sheet beside the canvas | Rejected. The canvas already owns the right pane; a second pane is a layout overhaul, and a sheet is the wrong shape for something that is glanced at and dismissed. |
| D | **A header button that opens a popover** | **Chosen.** No layout cost, nothing reclaimed from the transcript, absent entirely when there is no live work, dismissed with one click or Escape — and the data is already in renderer state. |

The principle the choice encodes, and the one the copy should carry: **the
popover is the live view of work in flight; the transcript remains the record
of what happened.** This surface adds a view. It replaces nothing, and no
existing row's meaning moves.

### 3.2 Placement

The trigger joins the chat header's action cluster, immediately to the left of
the canvas button (`features/chat/components/chat-header.tsx:92-107`). Today
that button carries `ml-auto`; the cluster takes it instead, so the two actions
sit as one group at the end of the 56px bar:

```
[ avatar ] [ name / description ] ............ [ run details ] [ canvas ]
```

Both are `Button variant="ghost" size="icon"` — the 32px control size the rest
of the app's headers use, and the size the canvas button was already corrected
to.

### 3.3 Visibility

The trigger renders when, and only when:

```
hasRunDetails(state) && !isCanvasOpen
```

with one term that is not about visibility at all:

```
// already mounted and open — the reader is looking at the panel
hasRunDetails(state) || open
```

- **An open panel is never unmounted by the data settling underneath it.**
  `hasRunDetails` answers "is there anything to open FOR"; `open` answers "is
  someone reading it right now". Gating on `hasRunDetails` alone unmounted the
  portal the moment the last open child or to-do settled, so the panel vanished
  mid-sentence under the reader. It also made the failure clause unreadable: with
  the dot lit and nothing else open, opening the panel acknowledged the failure
  in the same commit that displayed it, `hasRunDetails` went false, and the panel
  went with it — the one state the dot exists for could never be read. And
  because `open` outlived that gate, the panel then re-rendered open, and
  re-focused, the next time work started. `§ 6.3` states the resulting state that
  is now reachable.
- `hasRunDetails` is true when **any child is open** (running or queued) **or
  any to-do is open** (pending, blocked) **or a child has failed and the popover
  has not been opened since**. Settled work alone does not raise the trigger: a
  finished roster is history, and history lives in the transcript. This is what
  "only when applicable" has to mean, or the button becomes permanent furniture
  after the first `task` call.
- **The states are the union of both producers' vocabularies, folded word by
  word, and no word falls through to a default.** `frontend.jobs` rows come from
  two places, which is why a list read off `JobState` alone is one word short.
  The execution ledgers are `JobState`
  (`local_operator/session/frontend_state.py:1279-1291`): `status` is
  `running|completed|failed|cancelled|interrupted` (`harness/jobs.py:215`) plus
  the `queued` flag, and there is no pause field on the shape at all. The
  **durable graph** adds the other rows — one per `SubagentNode` whose id is not
  already in the live rows, for the cold-restart case where "nested execution
  ledgers no longer exist, but the shared durable graph still does"
  (`frontend_state.py:3690-3709`), with `status=getattr(node, "status", "gone")`.
  And `SubagentNode.status` is `SubagentComms._describe(record, now).status`
  (`harness/comms.py:793`), whose vocabulary is the roster's own:
  `pausing|paused|running|queued|starting|completed|failed|cancelled|interrupted|gone`
  (`ChildInfo.status`, `comms.py:288-299` — which lists nine of the ten and
  omits `interrupted`, a restore-only word `harness/jobs.py:205-215` documents).
  A nested child is exactly one whose job row never reaches the root's sidecar,
  so that branch is how a restored nested child reaches this popover at all.
  So the words that can arrive are those ten plus the `queued` flag, and the
  fold names every one of them: `running`, `queued` (flag or word), `starting` →
  `queued` (admitted by the capacity gate, not yet in its runner — a clock, and
  still open work), `pausing` → `running` (the pause flag is set before the
  cancel it awaits, so the child is demonstrably still going, which is the
  window `status_glyph` gates its own paused branch on), `paused`, `completed` /
  `done`, `failed`, `cancelled` (and the one-word spelling `canceled`),
  `interrupted`, and `gone`.
- **`paused` is reachable — from the restored record, not from a live pause, and
  the two halves are different facts.** `_describe` returns `paused` *ahead of*
  the recorded outcome (`comms.py:1233-1256`), and `record_outcome` deliberately
  keeps `_ChildRecord.paused` set across the child's exit — only `resume` and
  `cancel` clear it — so a record that was parked before the process ended comes
  back carrying that word. It has its own mark (§ 6.4), its own rank in the slice
  and membership of the open set: **a restored pause is open work**, because a
  child the user parked to come back to is precisely a row this surface must not
  draw as finished. A **live** pause is a different thing and still arrives as
  `cancelled`: `pause` is mechanically a cancel, and the intent lives on
  `_ChildRecord.paused`, which nothing publishes onto the job row or the desktop
  frontend (`tui/app.py:22215` does that for its OWN frontend, and only there).
  So the earlier claim that `paused` was a state no user could reach was wrong,
  and this section and § 6.4 say what is true instead: `paused` **is** rendered —
  it just cannot arrive from a live pause. The live half keeps its stated cost,
  unchanged: a pause that leaves no other open work hides the trigger, and the
  transcript's own notice is the fallback. The real fix is on the wire, injected
  at the frontend/bridge builder rather than copied onto the job row, and is
  deferred in § 10.
- **An unrecognised word is never `done`.** The TUI's `status_glyph` ends
  `GLYPH_DONE, status or "completed"` — an unknown status painted the completed
  check with its own word — and that default is the one branch of its table this
  port refuses. Silently promoting a state to "finished" is how a row the user is
  waiting on disappears: it stops counting as open work, it ranks with the settled
  tail in the slice, and it renders as a green check. A word this model has not
  been taught therefore becomes its own quiet settled mark carrying **the wire's
  own word**, so the row stays visible and says what the wire actually said — and
  that word is the WIRE's, not this renderer's: not its raw bytes, and not a state
  the fold knows. Two rules, both about the same failure: the string is flattened to
  its first line with control characters stripped, because it is painted in the
  visible tally and in the row's `sr-only` label and a newline would break both;
  and it is kept only when the fold does not recognise IT either, because the
  fold reads the WHOLE raw string. `"done\u0000"` folds to `unknown` while its
  first line still says `done`, which would put a recognised state word on a row
  drawn as the question mark and print `1 done` in the tally — exactly the count
  this rule reserves for words nobody has been taught. Keeping the two in step is
  the rule; `scripts/run-detail-model.test.mjs` pins the four shapes (round 4,
  R4-1). `gone` — the graph's word for a row swept without a recorded outcome —
  is its own state for the same reason, from the same branch. Neither raises the
  trigger on its own: an unknown state is not evidence of anything to act on, and
  inventing an announcement for it would be a second guess on top of the first.
- The failure clause is the TUI's `note_child_failed` rule (`:1837-1852`)
  carried over. A failure that nobody has seen is precisely the state where the
  affordance must not disappear, so the trigger stays and carries a `danger`
  dot (§ 6.1) until the popover is opened.
- **Acknowledgement follows the panel's own view, in both directions, and both
  instants are asked the SAME question.** That question is
  `onScreenFailures(details)` — `visibleFailures` over the roster: the rows the
  panel actually RENDERS, after the cap, which is the slice `§6.3` describes.
  Opening records the failures in that slice at that instant and those only: a
  child that fails while the panel is open keeps its dot for the next view,
  because the reader may be scrolled down in the plan and never see the row it
  belongs to. Closing then records the failures whose rows the slice HELD at any
  point while the panel was open (`accumulateSeen` over those slices, which is
  what the trigger's own `viewedRef` accumulates), because a dot that says "you
  have not looked" about a row the reader watched arrive is the same defect
  pointing the other way — and clearing it used to cost a reopen. The two halves
  between them leave exactly one case carrying its dot: a failure that was never
  in the slice. A row behind `+N more` is in neither set, so the trigger's
  failure clause survives the close for it.
  **"Shown" means RENDERED IN THE LIST, not scrolled into view.** The frame the
  rule is about is the panel's rendered slice: a row in it has been put in front
  of the reader, and the alternative reading — the part of the list currently in
  the viewport — would make a rule this surface cannot implement, since the view
  model has no viewport in it. The two readings coincide in practice today: the
  panel's `min(60vh, 480px)` ceiling is taller than a roster row, so no roster
  row can be scrolled out of an ordinary window.
  The rules are pure functions in the model (`onScreenFailures`,
  `accumulateSeen`, `acknowledgedOnOpen`, `acknowledgedOnClose`), so they are
  asserted rather than described; the call sites are asserted against their own
  components' source (`scripts/run-detail-model.test.mjs`), because the model
  alone cannot see the wiring — which is exactly how this was found. That pin
  covers three sites rather than the trigger's two, because the pairing has two
  ends and the PANEL's end is the one a model test cannot reach: the open
  instant, the close (which counts the accumulated ref rather than re-asking the
  slice, since a row displaced by a later arrival has still been read) and the
  section's own `panelSlice(...)` call, which must be the same function
  `visibleFailures` counts out of — a panel-side filter or cap would otherwise
  restore the divergence with every test green. The version
  this replaces broke the first half twice over: a `[open, details]` effect
  re-recorded the whole failure set on every change while the panel was open, so
  a failure arriving while the reader was scrolled down in the plan was marked
  read without ever having been displayed; and the open instant then recorded
  `details.failedChildIds` — EVERY failure on the roster — so past the cap a
  failure behind `+N more` was marked read by an open that never rendered its
  row, and with nothing else outstanding `hasRunDetails` went false and the
  trigger, panel and all, disappeared in the commit that opened it (round 3,
  R3-2 = U1).
- `!isCanvasOpen` is as requested, and it has a real rationale: with the canvas
  open the chat column is narrowed (default 800px) and its header holds one
  action beside the title block; a second panel-opening control there competes
  with the canvas's own header controls, and the popover would open across the
  canvas pane. The canvas is also a deliberate "look at this artefact" mode —
  while it is open the operator has already chosen what to look at.
  **Cost, stated plainly:** a failure arriving while the canvas is open is not
  announced by the trigger. The transcript's own failure notice is the fallback,
  and the trigger returns with its dot when the canvas closes. Closing the
  popover automatically when the canvas opens is part of this rule.

## 4. The panel

One panel, two sections, and a section appears only when it has content. A run
with only to-dos shows only `To-dos`; a run with only children shows only
`Subagents`.

### 4.1 Subagents

Section label `Subagents` with a quiet trailing tally that sheds whole segments
as width comes under pressure: `2 running · 1 done` → `2 running`.

One row per job. **The row is two lines, and this is the one place the port
departs from the TUI's single-line grammar.** The TUI has a full dock band and
a fixed-cell terminal to lay a row out in; a 384px popover does not, and the
activity string is the single most useful live datum in the list. So it gets
its own line rather than being the first thing shed:

```
[icon] Invoice reconciliation        reviewer · 1m 12s · 46% · $0.31
        Running pytest tests/unit/server -q
```

- Line 1 identity: state icon, `label` at full ink, then the numbers run —
  `agent_role` first (as the TUI orders it, `subagent_panel.py:1133-1146`),
  then elapsed, context, cost — in `ink-muted`, with the elapsed value in
  `tabular-nums` so a column of them aligns.
- Line 2 is **the activity while the child is running or queued, and the first
  line of the error when it has FAILED.** A failure is settled, so "a settled
  child has no second line" was never true of the one settled state that has
  something to say. The two variants are different kinds of text and are set
  differently:
  - *Activity* is prose about the work: sans, `ink-muted`, one line,
    head-truncated with an ellipsis, because there the head is the useful part
    (the tool, then its arguments). `ink-muted` rather than `ink-dim`, because at
    12px on this ground `dim` measures ≈4.7:1 — the tightest text on the surface
    — and it is the ink the TUI moved away from for this same field
    (`subagent_panel.py:1069-1071`, assignment at `:1153`).
  - *A failure's line* is machine voice: `font-mono text-mono-sm`, the exception
    **verbatim** (a fabricated translation is a claim nobody can check), allowed
    to wrap to at most two lines (`line-clamp-2`). The wrapping is the
    substantive half: head-truncated on one line,
    `FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'`
    rendered as `…'le…` — the exception's preamble survived and the identifier,
    the only part that says WHAT failed, was cut.
  - A settled child that did not fail has no second line here, and **that is this
    design's own choice rather than a port** — the citation this used to carry
    (`:653-660`) is the row whose page is OPEN, and §2.1 records what the TUI's
    roster actually does instead. The reason is the medium: a 384px popover two
    lines a row cannot hold a paragraph of `result_text` per settled child and
    keep the live rows legible, and the outcome of settled work is the
    transcript's job (§3.1). The distinction that survives is the one that
    matters: a FAILURE keeps its line, because it is the settled state that has
    something the reader has to act on.
- Every number is omitted rather than zeroed when unknown
  (`subagent_panel.py:429-450`); a child with no cost reported shows no cost
  segment, not `$0.00`.
- `agent_role` equal to the default `task` is suppressed, as the TUI suppresses
  it in the child view title (`subagent_view.py:3168-3196`).

### 4.2 To-dos

Section label `To-dos` with the plan's progress in the same quiet trailing form:
`10 of 14 resolved`, plus ` · 1 dropped` when any exist.

- **`resolved` is closure — done OR dropped — and it is one word for one fact,
  used by the section tally and by every phase header beneath it.** They used to
  disagree: the tally counted `done` only while a header counted closed
  (= done + dropped), so `9 of 14 done` sat above a `Verify · 4/5` whose four had
  included a dropped row, with nothing on screen saying the two were measuring
  different things. The TUI's `n/total resolved` is the same notion in a
  terminal's compression.
- The `dropped` segment is the breakdown *of* that closure, not a second count:
  it says how much of the finished work was abandoned rather than done, which is
  a distinction a plan should not quietly lose — and it is why the word stays
  beside the count that contains it.

Then the plan, in the model's own order, because a plan should read in the
order it was written:

```
PhaseName · 2/4 resolved
  [ ] Verify the migration on a scratch database
  [x] Add the composite index
  [~] Backfill rows older than 2024
      — blocked: the writer is still running
  [-] Drop the legacy column             — dropped
```

- Phase header: name `ink-muted`, counts `ink-dim`, and the counts say
  `resolved` like the section tally does rather than leaving the reader to infer
  which notion of closure they are.
- The blocked row is the only one that wraps: item text on the first line,
  `— blocked: <reason>` on the second, indented under the text (`§ 5`, one grid).
- Items indent under the phase header, with the mark first in a fixed column so
  the text of every item starts on the same x — **and that column is the
  roster's state-icon column** (`§ 5`): the two lists are one panel and they
  share one grid. The indent that separates a plan from its phase header lives on
  the second line, not in the first column.
- **The per-phase `+N more` sits in the item-text column too, not in the mark
  column** (`§ 5`, one grid). It is the footer of the rows above it, so it has to
  look like one: in the first column it took the same x as the phase headers, the
  same 12px type and one ink step away from them, with no rule between phases to
  say where one ended — at the boundary it read as the NEXT phase's header rather
  than as this phase's count. Under the text it attaches to the rows it counts,
  which is the same place a blocked row's reason sits.
- Encoding is the TUI's, unchanged: **luminance says open or settled, a word
  says which settled state, and no item is coloured.** Pending text is
  `ink-muted`; done and dropped are `ink-dim` with a line-through; blocked is
  full `ink` — the loudest row in the section.
- **A blocked item is the plan's one two-line row.** Its text takes the full row
  width, and `— blocked: <reason>` goes on its own line beneath, indented under
  the text, in `ink-muted`. Sharing one line truncated both strings to fragments
  — the item, which is the subject, lost its payload and the reason was cut
  mid-word — and a reason is the only variable-length string in the plan, so
  there is no width at which sharing works. `dropped` keeps `— dropped` inline:
  one fixed word, on a row that stays one line.
- The marks are lucide icons rather than ASCII: a box for pending, a checked
  box for done, a slashed box for dropped, a dashed box for blocked. The `- [ ]`
  of the TUI is a terminal drawing a picture with the characters it has; what
  ports is the meaning, exactly as `tool-glyphs.ts` ports the TUI's nerd-font
  table to lucide by meaning rather than by codepoint.
- The flat, single-phase case (an `init` with no phases) renders headerless, so
  a simple plan does not grow a `Todos · 0/3` header it does not need. This is
  the TUI's own back-compat rule (`docs/design-phased-todos.md:385-391`).

### 4.3 What a user can do here

Nothing but read, in this iteration. Rows are not clickable — and, for the same
reason, **no row has a hover ground**: a row that reacts to the pointer is an
affordance the surface does not honour, and the two lists have to agree about
it rather than one of them hinting at a click. The TUI's row
opens the child's full-page transcript (`subagent_panel.py:1475-1476`), and the
desktop has no child-reader surface to open — a subagent reader is a real
feature and a real piece of scope, and inventing it here would double this
change. The `task` tool row in the transcript already carries the child's
result once it lands.

## 5. Geometry

| | Value | Why |
|---|---|---|
| Panel width | 384px | The subagent row's fixed segments plus a label floor of roughly 20 characters. The popover primitive's default `w-72` cannot hold the numbers run and the activity line. While the panel's scrollbar is painted, its 10px lane comes off the content rather than out of the right padding (see Max height below), so the floor there is about one character narrower. |
| Max height | `min(60vh, 480px)`, contents in a `ScrollArea` with `type="auto"` | A long plan scrolls inside the panel rather than growing past the viewport, and the thumb paints whenever the content actually overflows — so a still can show that more follows and a panel that fits gains no chrome. Radix's default `hover` cannot: it needs a pointer, which a capture never has, and the only cue left was a row sliced by the panel's bottom edge, which reads as damage. While the thumb IS painted its lane is reserved in the CONTENT — 10px off the scroll viewport, keyed on the live scrollbar — because the bar is an overlay pinned to the viewport's right edge and would otherwise land inside the panel's 12px right padding and leave every right edge in the panel 3px from the thumb. The bar cannot move out of the padding (the panel is the edge) and a narrower thumb is a control you cannot grab, so the lane comes out of the content instead, and a panel that fits gains no gutter. |
| Anchor | `align="end"`, `side="bottom"`, `sideOffset={6}` | Anchored to the header cluster's right edge, opening away from the transcript's own content. |
| Panel padding | `p-0`; sections own their padding | The primitive ships `p-4` for content-shaped popovers; this one is a list, and a list needs its rows to reach the panel edge so the section rules and the row grounds can. |
| Radius | `rounded-md` (10px) | Panel tier, inherited from the primitive. |
| Ground and edge | `bg-elevated`, `border-hairline`, `shadow-overlay` | Inherited. It leaves the flow, so it takes the one shadow and does not take a second boundary. The shadow is what paints the edge in the frames, measured by walking DOWNWARD from the panel's floor — a horizontal probe crosses the transcript the panel overlaps, which is what made the previous set's edge numbers a mixture of shadow and glyph ink: dark `(16,14,8)` just below the hairline → `(23,19,14)`, light `(217,214,206)` → `(245,239,230)`, with the falloff reaching the ground 21px below the floor in dark and 37px in light (at three units per channel it is 21px / 29px; the reach is uniform across the panel's INTERIOR — the columns nearest the rounded frame read shorter, 15px and 19px in dark, because the frame cuts the shadow there, which is why this row no longer claims one number across the whole span). Naming the token's parts is what makes the two directions checkable rather than one quantity read twice: it is `0 12px 32px -12px` (`--lo-overlay-shadow`), so the nominal reach is `32 − 12 = 20px`, and the LATERAL reach the pixels actually show is 8px in dark and 24px in light — it is palette-dependent, because the two palettes' shadows sit on grounds of very different luminance (the dark theme's `rgb(0 0 0 / 0.6)` perturbs a `(23,19,14)` ground by a few units and is gone within 8px, while the light theme's `rgb(20 17 12 / 0.25)` darkens a `(246,241,231)` ground much further and still reads at 24px). The DOWNWARD reach is the larger one for a stated reason rather than by symmetry: the token's 12px y-offset pushes the shadow down, so the vertical number (21 / 37) carries that offset and the lateral one (8 / 24) does not — a probe has to say which direction it walked, and `32 − 12 = 20` is the arithmetic, not a measurement. **That ground is `canvas`**, which is what the app paints under this popover since #113 gave the working surface the page ground; a frame set that rendered the story's column on `surface` measured the falloff against a plane the app no longer paints there, and `docs/evidence/run-details/README.md` carries the re-measured pair. The change can only widen the step: `elevated` already clears `canvas`, so a panel that used to sit on the lighter `surface` now starts further from its ground — measured from the frames, dark L* 6.14 → 13.62 (Δ 7.48) and light 95.28 → 99.43 (Δ 4.16), against the token's own `elevated`-over-`canvas` step of 7.90 (dark) and 4.73 (light) and its `elevated`-over-`surface` step of 4.41 / 2.10 — which is the ≈4.4 / ≈2.1 that the frames rendered on the wrong plane certified. Read those two as an APPROXIMATION: they are the panel's modal colour against the `surface` plane around its upper body, measured on a frame set that is not the one under review, and the pairing is lossy in a way the exact token steps are not (this head's frames read 4.07 dark / 1.85 light on a text-free band probe at `x0..112`, and 4.57 / 2.62 at the `x520, y200` point the row quotes; the round-4 capture read 4.50 / 2.07 there). What the approximation does carry is the DIRECTION, which the tokens settle exactly: `elevated` clears `canvas` further than `surface` in both palettes. |
| Between sections | one `hairline` rule | Two stacked lists need a boundary; nothing else in the panel does. |
| Row height | subagents: 32px single line, 48px with a second line, 64px for a failure whose exception takes both clamped lines. To-dos: 24px single line, 40px for a blocked row's reason line | Both pairs sit on the 4px ramp, and 32/48 is what a 16px icon on the label's baseline plus one 16px second line measures. The line heights are pinned (`leading-5` on the first line, `leading-4` on the second — both variants of it, the activity line and the wrapped exception) rather than inherited: `body-sm`'s 1.5, `meta`'s 1.45 and `mono-sm`'s 1.45 land off the ramp at 19.5px and 17.4px, which measured as a 48-50px two-line row and a 67px failure row. Measured off the frames, the failure row is 12 + 20 + 2×16 = 64px. |
| Row hover | **none** | Nothing in this panel is clickable (`§ 4.3`), so nothing may react to a pointer: a row that lights up under the cursor is a promise the surface does not keep. The `accent-wash` step belongs to rows that do something, and the two lists agree — neither of them hovers. |
| One grid | marks and state icons in the same 16px column at `px-3`; first-line text at the same x in both lists; second lines indented under the text, and the plan's `+N more` with them | Two lists in one panel have to read as one panel. The plan used to sit 12px right of the roster's icons (marks at `pl-6`, text at `pl-6`+20px), which is what made the panel read as two lists rather than one. The disclosure joins the indent because it belongs to the rows above it, not to the phase headers below it (`§4.2`). |

## 6. Trigger and states

### 6.1 The trigger

**Icon: `Activity`.** Not `Users`, not `ListChecks`. Those two glyphs already
mean *a specific tool* everywhere else in this app — they are the ledger rows
for `task`/`agent` and for `todo` respectively (`tool-glyphs.ts:54-79`) — and a
header button wearing one of them would read as that tool rather than as the
view over both. One new symbol is cheaper than re-teaching an existing one.

A single 8px `danger` dot at the button's top-right corner carries the
unseen-failure state described in § 3.3. It is not decoration and it is not a
count: it says a child failed and nobody has looked. It clears when the popover
opens, **for the rows that open put on screen** — the panel's own rendered slice,
which is the rule § 3.3 states in both directions; a failure behind `+N more` is
not one of them and keeps its dot.

Icon-only, with the meaning carried by the tooltip and the `aria-label` — the
same contract as the canvas button beside it. No count badge: a badge that
ticks from 2 to 3 draws the eye to something the user is not going to act on,
and the count is the first thing the tooltip and the panel's own header say.

### 6.2 Tooltip and aria-label copy

Event-shaped and count-carrying, shedding clauses rather than truncating them:

| state | text |
|---|---|
| children and to-dos | `Run details — 2 subagents running, 4 to-dos open` |
| children only | `Run details — 2 subagents running` |
| to-dos only | `Run details — 4 to-dos open` |
| failure, unseen | `Run details — 1 subagent failed` |
| one child, one to-do | `Run details — 1 subagent running, 1 to-do open` |

Sentence case, pluralised honestly, no jargon beyond `subagent` and `to-do` —
both of which are the product's own nouns and both of which the TUI uses.

### 6.3 Panel states

| state | rendering |
|---|---|
| both sections | `Subagents` then `To-dos`, hairline between |
| one section | the other is omitted entirely; no empty heading, no placeholder |
| overflowing subagents | 6 rows, then `+N more` as a quiet trailing row, ordered by the TUI's priority slice (running/queued, failed, interrupted/paused, then settled; ties to the NEWEST, by the child's own `settled_at` for a settled row and `start_time` otherwise). **A failed row is not shed while the failures fit the cap**: up to six of them, failures are reserved before the ranked slice, evicting the quietest visible row one per dropped failure, so the `danger` dot's promise — a child failed and you have not looked — is redeemable in the panel. Beyond the cap the reservation runs out of victims and the oldest failures go behind `+N more` like anything else, with the disclosure count still reporting what is actually hidden: eight failures at a cap of six show six and disclose two, which is the arithmetic maximum the cap allows and a bound the wording has to state rather than round up. The reservation keeps the rank order rather than moving failures to the top. The other extreme is stated too: with more failures than the cap, failures displace running children first, because the promise the dot makes is about failure specifically |
| overflowing to-dos | cap the item rows at 10, never dropping an open or blocked item. The **oldest** closed rows are the ones shed — earliest phase first, earliest item first — so a long plan keeps its recent end, and the hidden rows are disclosed as `+N more` **inside the phase that lost them**, under its surviving rows and in the item-text column (`§4.2`): the plan never appears to start mid-way, and every phase header stays accountable to the rows beneath it. A phase all of whose rows were shed keeps its header and its own `+N more` — photographed in `todos-only`, whose oldest phase (`Reconcile · 5/5 resolved`) is wholly closed, so the cap takes every row it has and leaves the header and `+5 more` |
| all settled | reachable, and now by two paths: the panel was opened while work was live and the work then settled, or the last open item settled under an open panel (`§ 3.3`). Every row quiet, no activity lines, and the trigger is gone unless a failure is unseen |
| long label | label truncates with an ellipsis; role, elapsed, context and cost are fixed-width and never truncate mid-value |
| reduced motion | the running icon stays put; shape already distinguishes it (§ 6.4) |
| no content | unreachable: the trigger is not rendered, so the popover cannot open empty |

### 6.4 State icons

| state | icon | ink |
|---|---|---|
| running | spinner | `ink-muted`, animated |
| queued | clock | `ink-dim` |
| paused | pause circle | `ink-muted` |
| interrupted | rotate | `ink-muted` |
| done | check | `ink-dim` |
| cancelled | slashed circle | `ink-dim` |
| gone | dashed circle | `ink-dim` |
| unrecognised word | question circle | `ink-dim` |
| failed | cross | **`danger`** |

Nine marks. `status_glyph` has a mark for the pause circle and no branch for the
other two — `gone` and an unrecognised word both fall through to its completed
check — and each has its own here instead, because that fall-through is exactly
the rule § 3.3 refuses. Three of the nine are reachable only from the durable
graph (a restored pause) or from a runtime this renderer has not been taught
(`gone`, an unrecognised word) — and all three are photographed in
`restored-and-unrecognised`, which carries them the way the wire does: as the
graph's own status WORD on a restored row (`getattr(node, "status", "gone")`),
not as a `paused` field, which `JobState` does not have (§ 8). Before that frame
these three were the only marks the word-level tests in
`scripts/run-detail-model.test.mjs` covered and no frame had ever shown —
including `paused`, which is the one of the three that also decides whether the
trigger exists at all (a restored pause is open work). The fixture set now
renders all nine states.

Motion is a bonus, never the contract: the running spinner and the three settled
marks are different *shapes*, so the list survives `prefers-reduced-motion` and
survives being looked at by someone who cannot separate the two inks. Each row
also carries the state as visually-hidden text, so the panel reads as a sentence
to a screen reader rather than as a column of unlabelled icons.

## 7. Keyboard, focus and motion

- The trigger is a real button, reachable in the header's tab order, with the
  app's `outline` focus ring — not a `box-shadow` ring, which the header's
  `overflow` would clip.
- Opening moves focus to the panel container (rendered `tabIndex={-1}`), not to
  the first row — the rows are not interactive and focusing one would imply
  they are. Escape closes and returns focus to the trigger.
- **Tab and Shift+Tab move OUT of the panel** — and the move is made by the
  component rather than left to the browser. It cannot be left to it: the panel
  is Radix's portal, so it is the last element in `<body>`, and the document's
  own order puts it after every header control — a Tab from the container would
  leave the header entirely rather than reach the canvas button 8px away. It
  cannot walk inwards either, because the content holds no tabbable element at
  all (the rows are not interactive). So focus goes to the trigger's next
  tabbable neighbour, or to its previous one for Shift+Tab, **whatever those
  are** — on this layout, the canvas button going forward and the canvas resize
  handle going back, both measured live by QA (x1332 and x494 respectively).
  The header cluster is only the forward half; the earlier wording in this
  paragraph promised the cluster in both directions, and a destination that is
  a real focusable control outside the cluster is legitimate while a promise
  the surface does not keep is not. At either end of the document's order the
  trigger itself is the destination, which is where Escape already returns
  focus. Two consequences are stated rather than left to be discovered: **Tab
  out dismisses the panel just as Escape does, in both directions** (QA's real
  key dispatch measured it: focus leaving Radix's content is a close, and only
  Escape's return-to-trigger is explicit), and
  Radix's own zero-size `[data-radix-focus-guard]` spans are never a
  destination — they are excluded by attribute and by size, so a keyboard user
  cannot land on an invisible element with no focus ring anywhere.
- **The panel is a named dialog.** Radix renders `role="dialog"` on the content,
  and an unnamed dialog is announced as "dialog" and fails axe's
  `aria-dialog-name`. It carries `aria-label="Run details"` rather than a
  `labelledby` pointing at the first section heading, because the sections are
  conditional — with no children on screen the only heading would be `To-dos`,
  and a name that changes with the contents names the contents rather than the
  surface. The TRIGGER keeps its derived `aria-label` (`§ 6.2`): one is the
  control's name, the other is the dialog's.
- **What is asserted and what is exercised live.** The decisions that can be
  stated as rules are pure functions in the model with real assertions in
  `scripts/run-detail-model.test.mjs`: the visibility predicate
  (`hasRunDetails`), the acknowledgement rules both ways
  (`acknowledgedOnOpen` / `acknowledgedOnClose`, with `onScreenFailures` deciding
  which rows either one may count, and `accumulateSeen` accumulating them over an
  open period) and the clock predicate
  (`hasLiveChildClock`). The acknowledgement's call sites are asserted too,
  against the source of the components that hold them — the trigger's two
  instants and the section's `panelSlice(...)` call, so the slice the dot counts
  and the slice the section renders cannot drift apart — because a model test
  cannot see which
  argument the component passes: which is how the open half came to acknowledge
  the whole roster while the close half counted the rendered slice. What cannot
  be a pure function is
  the timer's LIFETIME — that it starts when a live child is on screen, ticks at
  1Hz and is cleared when the panel closes — and that is exercised against the
  running panel in QA rather than claimed by a comment here.
- **That container carries `outline-none`, and this is the case the app's own
  focus doctrine names as legitimate.** `styles/index.css:355-370` allows the
  suppression when "focus is moved there programmatically and a ring would be
  noise", and requires the decision to be "visible in the component" — which is
  why the comment lives on the popover content rather than in a stylesheet.
  Without it the app's unlayered `html :focus-visible` rule (`:345-352`) paints a
  2px accent ring around the whole panel: at 7.24:1 against the panel's own
  hairline at 1.19:1 it is the loudest line on the surface, and it nicks the
  header's bottom rule. The trigger keeps its ring — the keyboard user still has
  to see where they are, and the ring marks something actionable there.
- **`shadow-overlay!` on the same element, for the same reason.** That rule also
  sets `box-shadow: none !important` on any `:focus-visible` element — it exists
  to neutralise MUI's shadow rings — so the panel, which IS focus-visible from
  the moment it opens, had its one shadow suppressed and this section's own
  elevation promise went unfulfilled: the ground 1px outside the hairline was the
  canvas ground. The `!` is load-bearing rather than tidy, because a plain
  utility cannot outrank an unlayered `!important`. Removing the ring is what puts
  the boundary back, and `§ 5` records the measured falloff.
- The panel is **not** an `aria-live` region. It updates live while open, and a
  region that announces every progress tick would be hostile; the opening
  announcement is the summary, and the panel is re-read on demand.
- No entrance animation on the panel, which is the primitive's own rule and is
  correct here: a keyframe that plays pending renders `opacity: 0` and can
  strand an invisible panel.
- The only animation anywhere in this surface is the running spinner.

## 8. Data mapping

The view model is derived, never stored, and derived from state the renderer
already holds:

```
frontend.jobs  (JobState[])      -> SubagentRow[]
frontend.todos (TodoPhaseState[]) -> TodoPhaseView[]
```

`JobState` to `SubagentRow`: `id`, `label`, `agent_role`, the status WORD folded
into one of the nine renderable states — with the `queued` flag fused in, and the
word itself carried as `stateWord` when the model does not recognise it: its first
line, control characters stripped, and refused if that text is itself a state the
fold knows (§ 3.3) — elapsed from `start_time`/`settled_at`, activity from
`latest_details.progress`, context tokens over `context_window`, `direct_cost`,
and the first line of `error_text` for a failure.

Two consequences of that mapping are worth naming, because both were wrong here
in an earlier draft:

- **The `queued` flag is read, and the status word too, and the two producers of
  a `frontend.jobs` row differ.** The execution ledgers' rows are `JobState`,
  which has no pause field; the durable graph's reader rows carry whatever
  `SubagentComms._describe` returns, which includes `paused` and `gone`. The
  fold's union is enumerated in § 3.3, and no word falls through to a default.
- **A restored row has no clock.** The graph's rows carry `id`, `label`,
  `status`, `prompt`, `agent_role`, `effort` and the terminal texts — not
  `start_time` and not `settled_at` — so a restored child renders without an
  elapsed value and without a live timer, which the model's tests pin.

`model_label` is on the job and is deliberately NOT read. It was listed here in
an earlier draft, and the row grammar has no model segment (`§ 4.1`): a mapping
that names a field the model never reads is a claim about the code that the code
does not make. Carrying it would mean a third fixed-width segment on a 384px row
competing with the label, and a model name is not a datum this list is for — the
child's own page is.

`TodoPhaseState` to `TodoPhaseView`: pass-through. The wire shape is already
the shape the panel wants — which is the second reason this change is small.

Two notes on what is *not* in the model:

- Child lineage (`parent_job_id`) is carried on the job but unused: the roster
  is flat, as the TUI's is. The tree in `docs/design-team-chart.md` is the
  org chart for declared *teams*, not for live subagents, and reading it as the
  latter would be a mistake worth naming here so nobody makes it again.
- A child's own plan (`JobState.todos`) is carried on the wire and unused. The
  popover shows the session's plan, not each child's.

And one note on *when* the model is read, which the wiring made load-bearing:

- **A running child's elapsed label is the one figure here that is a function of
  the current time**, so it is the one figure a live session can show stale.
  `frontend.update` arrives only when the runtime has a field delta, and the
  stream's only periodic frame is a 15s heartbeat the renderer drops on purpose,
  so a child thinking for ninety seconds would read the same number for ninety
  seconds. The row therefore keeps the clock it was measured from
  (`startSeconds`/`settledSeconds`) and `retimeRunDetails` re-measures that label
  and nothing else, at 1Hz, inside the panel that draws it — the same scope the
  TUI's own re-derivation has, and the same reason the transcript's tool rows
  keep their own clock in their own row. Nothing above the panel ticks, so the
  transcript is not re-rendered once a second to move one number — **and the
  re-measured model is handed only to the SUBAGENT rows.** The to-dos section has
  no time-dependent field in it: an item is pending, done, dropped or blocked and
  every count is derived from those, so passing it the re-measured object would
  re-render the whole plan once a second to paint the same pixels. The clock's own
  predicate (`hasLiveChildClock`) is a pure function with assertions; the timer's
  lifetime is exercised live (§ 7).

## 9. Why this is non-invasive

1. Nothing in the transcript changes. No existing row's rendering, meaning or
   position moves, and `task`/`hub`/`todo` rows keep the glyphs and categories
   they have today.
2. No layout slot is taken. The trigger lives in the header's existing action
   cluster at the existing 32px size; the panel is portalled and out of flow.
3. An idle session looks exactly as it does now — no button, no band, no
   reserved space, nothing to learn.
4. Nothing is disconnected to make room. This adds a live view of state that is
   already on the wire and currently dropped on the floor.
5. No new colour role, no new radius, no new primitive: one `Popover`, one
   `ScrollArea`, the existing `Button`, `Tooltip` and `Badge` inputs, and the
   roles the contract already names.

## 10. Deferred, and why

| item | reason |
|---|---|
| Clicking a child row to open its transcript (the TUI's `SubagentView`) | Needs a child-reader surface in the desktop. A real feature, and not one to smuggle into a header popover. |
| A dock band above the composer, mirroring the TUI | The first alternative in § 3.1. Worth doing only if the plan turns out to be reference material people keep open, which the popover's usage will show. |
| Consuming `subagent_start` / `subagent_progress` in the reducer | The popover derives liveness from `frontend.jobs` and needs no reducer change. The events would add per-tool granularity to the activity line. |
| Per-child plans (`JobState.todos`) | Carried on the wire, unused. Needs a nested rendering decision first. |
| A child blocked on a question (`hub ask`) | The TUI has no such dock state either — there is no blocked-while-waiting glyph in its vocabulary. Inventing one here would be new vocabulary, not a port. |
| The pause intent on a live session's job row | **The rest of § 3.3's pause gap, and it is a `local-operator` change rather than this PR's.** A live pause is mechanically a cancel, so the row `frontend.jobs` publishes says `cancelled` and the intent on `_ChildRecord.paused` is not on it: a pause that leaves nothing else in flight does not raise the trigger. The fix is to publish the intent where the desktop frontend is BUILT — the analogue of the TUI's own `tui/app.py:22215`, which injects `paused=<id> in paused_ids` into its frontend — not to copy it onto the roster row `comms.job_rows()` builds. `local_operator/harness/jobs.py:139-150` rules that mechanism out in so many words: `AsyncJob` has no such field and cannot get one honestly, and copying `_ChildRecord.paused` onto the row "would create a second, independently-mutable source of truth for one fact — the drift this PR exists to remove", with the owning record there to be consulted instead. (R2-1's other option — projecting the node vocabulary into the `JobStatus` domain at the frontend row — is the same shape.) The RESTORED half of § 3.3 is already fixed in this PR and does not wait on it: a word the graph sends is folded and marked, `paused` included. What is deferred is only the live session's intent, where this popover goes on reporting what the wire says. |
| Unread markers on to-do items | The TUI has none, and a plan is read as a whole rather than item by item. |

## 11. Evidence

Rendered frames are the evidence for this design; a green test is not. The
story states in § 6.3 are captured through `scripts/capture-evidence.mjs` and
committed under `docs/evidence/`, so the same frames the design was judged on
are the ones a reviewer can re-take.

One of them exists for a defect rather than for a state: `failure-unseen` — a
run whose ONLY reason for a trigger is a failure nobody has read — is the
regression frame for the panel surviving its own acknowledgement (§ 3.3). Against
a trigger gated on `hasRunDetails` alone it renders no panel at all, so the frame
cannot quietly pass if that gate comes back.

`crowded` carries the same kind of claim for the slice: its children are stored
deliberately out of chronological order, so a tie-break that reads the array
index shows a different six rows from one that reads the children's own clocks
(`scripts/run-detail-model.test.mjs` asserts both the fixture and the rule).

All twenty frames were re-taken on the head that remediated those review
rounds, and again on the head that closed them, and the tenth story
(`restored-and-unrecognised`) was added at the end for the three states a live
session cannot produce — a restored pause, a swept row and an unrecognised word
— whose marks rounded out `§ 6.4`'s nine. The first re-capture is the one
that moved every frame: #113 gave the working surface the page ground, so the
story now paints the ground the app actually paints under this popover (§ 5);
the frames whose CONTENT changed are `crowded` and `subagents-only` — the rows
the slice now selects and the tally that follows them — plus the live clock in
`both-in-flight`. The second moved none of them: its only rig-side change was
giving the story's chat column a definite height, so the panel's floor and
shadow sit on the column the panel is over rather than on the preview frame's
own ground, and 14 of the 18 frames it re-took came back byte-identical with the
other four differing only in a running row's elapsed label. The third added the
two frames of the new story and re-took eighteen to no visible change: their
pixel-count differences from the set they replaced are in
`docs/evidence/run-details/README.md`, quoted with the capture they were read
off, and the counting is what
keeps this paragraph falsifiable rather than reassuring.
