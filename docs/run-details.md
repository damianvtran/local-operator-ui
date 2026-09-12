# Run details — subagents and to-dos in the desktop chat header

Status: design proposal. Nothing in the application is wired to this document
yet; the view model, the components and the story states exist so the surface
can be judged as rendered frames before any of it is connected.

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
- **A settled child is a quiet `✓` with no activity text** (`:653-660`).
- **Numbers are omitted when unknown, never zeroed** (`:429-450`).
- **Overflow is a budgeted priority slice**, not the newest N: running and
  queued first, then failed, then interrupted/paused, then settled, ties
  newest-first (`:2051-2099`), always disclosing `+N more` (`:1964-1982`).
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
- `hasRunDetails` is true when **any child is open** (running, queued, starting,
  pausing, paused) **or any to-do is open** (pending, blocked) **or a child has
  failed and the popover has not been opened since**. Settled work alone does not
  raise the trigger: a finished roster is history, and history lives in the
  transcript. This is what "only when applicable" has to mean, or the button
  becomes permanent furniture after the first `task` call.
- The failure clause is the TUI's `note_child_failed` rule (`:1837-1852`)
  carried over. A failure that nobody has seen is precisely the state where the
  affordance must not disappear, so the trigger stays and carries a `danger`
  dot (§ 6.1) until the popover is opened.
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
  - A settled child that did not fail has no second line, matching the TUI's
    blanked activity (`:653-660`) and keeping the settled tail of the list quiet.
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
| Panel width | 384px | The subagent row's fixed segments plus a label floor of roughly 20 characters. The popover primitive's default `w-72` cannot hold the numbers run and the activity line. |
| Max height | `min(60vh, 480px)`, contents in a `ScrollArea` with `type="auto"` | A long plan scrolls inside the panel rather than growing past the viewport, and the thumb paints whenever the content actually overflows — so a still can show that more follows and a panel that fits gains no chrome. Radix's default `hover` cannot: it needs a pointer, which a capture never has, and the only cue left was a row sliced by the panel's bottom edge, which reads as damage. |
| Anchor | `align="end"`, `side="bottom"`, `sideOffset={6}` | Anchored to the header cluster's right edge, opening away from the transcript's own content. |
| Panel padding | `p-0`; sections own their padding | The primitive ships `p-4` for content-shaped popovers; this one is a list, and a list needs its rows to reach the panel edge so the section rules and the row grounds can. |
| Radius | `rounded-md` (10px) | Panel tier, inherited from the primitive. |
| Ground and edge | `bg-elevated`, `border-hairline`, `shadow-overlay` | Inherited. It leaves the flow, so it takes the one shadow and does not take a second boundary. The shadow is what paints the edge in the frames: the ground outside the hairline runs from the darkest pixel at the panel's edge back to the canvas ground ≈20px out (the token's `32px` blur less its `-12px` spread), in both brand themes. |
| Between sections | one `hairline` rule | Two stacked lists need a boundary; nothing else in the panel does. |
| Row height | subagents: 32px single line, 48px with a second line, 64px for a failure whose exception takes both clamped lines. To-dos: 24px single line, 40px for a blocked row's reason line | Both pairs sit on the 4px ramp, and 32/48 is what a 16px icon on the label's baseline plus one 16px second line measures. The line heights are pinned (`leading-5` on the first line, `leading-4` on the second) rather than inherited: `body-sm`'s 1.5 and `meta`'s 1.45 land off the ramp at 19.5px and 17.4px, which measured as a 48-50px two-line row. |
| Row hover | **none** | Nothing in this panel is clickable (`§ 4.3`), so nothing may react to a pointer: a row that lights up under the cursor is a promise the surface does not keep. The `accent-wash` step belongs to rows that do something, and the two lists agree — neither of them hovers. |
| One grid | marks and state icons in the same 16px column at `px-3`; first-line text at the same x in both lists; second lines indented under the text | Two lists in one panel have to read as one panel. The plan used to sit 12px right of the roster's icons (marks at `pl-6`, text at `pl-6`+20px), which is what made the panel read as two lists rather than one. |

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
opens.

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
| overflowing subagents | 6 rows, then `+3 more` as a quiet trailing row, ordered by the TUI's priority slice (running/queued, failed, paused, settled; ties newest-first) |
| overflowing to-dos | cap the item rows at 10, never dropping an open or blocked item. The **oldest** closed rows are the ones shed — earliest phase first, earliest item first — so a long plan keeps its recent end, and the hidden rows are disclosed as `+N more` **inside the phase that lost them**, under its surviving rows: the plan never appears to start mid-way, and every phase header stays accountable to the rows beneath it. A phase all of whose rows were shed keeps its header and its own `+N more` |
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
| failed | cross | **`danger`** |

Motion is a bonus, never the contract: running and paused are different
*shapes*, so the list survives `prefers-reduced-motion` and survives being
looked at by someone who cannot separate the two inks. Each row also carries the
state as visually-hidden text, so the panel reads as a sentence to a screen
reader rather than as a column of unlabelled icons.

## 7. Keyboard, focus and motion

- The trigger is a real button, reachable in the header's tab order, with the
  app's `outline` focus ring — not a `box-shadow` ring, which the header's
  `overflow` would clip.
- Opening moves focus to the panel container (rendered `tabIndex={-1}`), not to
  the first row — the rows are not interactive and focusing one would imply
  they are. Escape closes and returns focus to the trigger.
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

`JobState` to `SubagentRow`: `id`, `label`, `agent_role`, status with `queued`
and `paused` folded in, elapsed from `start_time`/`settled_at`, activity from
`latest_details.progress`, `model_label`, context tokens over `context_window`,
`direct_cost`, and the first line of `error_text` for a failure.

`TodoPhaseState` to `TodoPhaseView`: pass-through. The wire shape is already
the shape the panel wants — which is the second reason this change is small.

Two notes on what is *not* in the model:

- Child lineage (`parent_job_id`) is carried on the job but unused: the roster
  is flat, as the TUI's is. The tree in `docs/design-team-chart.md` is the
  org chart for declared *teams*, not for live subagents, and reading it as the
  latter would be a mistake worth naming here so nobody makes it again.
- A child's own plan (`JobState.todos`) is carried on the wire and unused. The
  popover shows the session's plan, not each child's.

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
