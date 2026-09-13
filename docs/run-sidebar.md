# Run sidebar — the right pane, its roster, its child reader, its to-dos and its MCP servers

Status: this is a design record, not a description of shipped code. It supersedes
the *surface* half of `docs/run-details.md` (the header TRIGGER plus its transient
POPOVER) and extends the parts of it that survive: the nine-state roster, the
to-do encoding, the priority slice, and the failure-dot rule in its new form. Its
§ 7 (MCP) has no predecessor in that document — it is the one part of this
surface the old design does not contain in any form.
**Which ref every citation was read from**, because a line number without a
ref is a claim nobody can check. UI citations are this worktree's tree at
`78e694777` (`chore(release): bump version to 0.19.2`, the branch base). Python
citations are `~/local-operator` at **`origin/main`** (`430bd0fa6`), re-resolved
against that ref with `git show origin/main:<path>` after the first read — the
root checkout is five commits ahead of `origin/main` on a feature branch, and a
working-tree line number would have been off by tens to hundreds of lines per
file. Check any of them with
`git -C ~/local-operator show origin/main:<path> | sed -n '<line>p'`.

**One exception to that policy, and it is labelled wherever it appears.** The UI
half of this design is in flight on `feat/session-sidebar-panel` in this
worktree, uncommitted, so § 3.4 and § 7 also cite the working tree's in-flight files (`§ 7.5`): a
line number in an uncommitted file is not checkable at a ref, and saying so is
better than quoting it as though it were. Nothing in the design *rests* on those
citations — the route, the payload and the status vocabulary all exist at the
refs above — they record what the implementation already does so the deltas
§ 7.5 lists can be read against it.

Read with `docs/branding.md` open. The roles named here are roles, never
colours, and the twelve themes make that a promise rather than a preference.

---

## 1. The problem

The operator's ask, in three parts, against what exists:

1. **The trigger must be permanent and the panel must be a pane.**
   `run-details-trigger.tsx:299` renders the trigger only when
   `hasRunDetails(details, seen) || open` and never while the canvas is open
   (`:299`, `:206-210`), and its panel is a Radix popover
   (`run-details-trigger.tsx:308`, primitive at `shared/components/ui/popover.tsx:17-25`
   with no `modal` prop) — so a click outside it dismisses it, and with nothing
   open in flight the icon is not on screen at all. "It goes away after you
   click it" names exactly this: the surface is transient in both directions —
   its trigger is conditional and its panel is click-away.
2. **A child's conversation must be readable in the pane, live.**
   The row is deliberately inert today: `docs/run-details.md` § 4.3 records that
   the desktop has no child-reader surface to open, and the TUI's own row does
   open one (`subagent_panel.py:1496-1497`, `:1509`). This is that reader.
3. **One to-do list.** § 6 of this document reports what is actually redundant
   in `run-detail-todos.tsx` today; it is not what the old design assumed.

The data situation is now clear and it is the reason this change is smaller than
it looks:

- **The child's identity is already on the wire.** `CanonicalFrontendState.jobs`
  is `Array<Record<string, unknown>>` (`src/shared/desktop-session-contract.ts:208`)
  and the backend builds those rows through
  `FrontendStateStore._jobs` → `_with_lineage`
  (`local_operator/session/frontend_state.py:4034-4076`, `:4181-4230`), which
  stamps `parent_job_id`, `session_id` and `session_dir` from the comms NODE onto
  every row it can resolve one for, on the 50 ms roster coalesce
  (`:3586-3604`). `JobState` itself carries `prompt`, `launch_prompts`,
  `launch_message_id`, `attempt_aliases`, `agent_role`, `effort`, `model_label`,
  `context_window`, `direct_cost`, `start_time`, `settled_at`, `error_text`,
  `result_text` and the child's own `todos`
  (`local_operator/session/frontend_state.py:1363-1444`). So the roster, the
  lineage, the reader's header and the reader's brief are all already in
  renderer state.

  **Not every row, and the exceptions are load-bearing (review round 1, R1-6; and
  corrected against the backend: PR #1053's reviewer, 2026-09-13).** The stamp is
  the LIVE node's, and two other shapes carry less than this paragraph used to
  claim:
  - the PERSISTED roster record (`harness/comms.py:970-1010`,
    `SubagentComms.snapshot()`) carries `session_dir` and **never a
    `session_id`** — it stores the directory that makes a resume possible, and it
    skips a record with none;
  - a RESTORED row (`session/restored_rows.py:136-190`) updates only
    `status`/`restored`/`cut_off_cause` from that record and copies neither
    field, so on a COLD conversation every roster row arrives with
    `session_id: null` and `session_dir: null`.

  The renderer reads `session_id` (§ 4), so a cold row has no `childSessionId` and
  nothing to address the transcript route with. The fix is the backend's (copy the
  record's `session_dir`/`session_id` onto the restored row, PR #1053); until it
  ships on the pairing, the renderer's own answer is § 10.3: such a row is not
  openable, and a reader reached another way (the breadcrumb, the sibling
  stepper) states that plainly rather than sitting on `Loading…` forever.
- **The child's conversation is not, and cannot be.** The desktop wire strips
  job trajectories from the snapshot (`frontend_state.sync_wire_payload`,
  `local_operator/session/frontend_state.py:1955-1975`) and blanks them on every
  delta (`server/utils/desktop_sessions.py:246-264`,
  `payload["job_trajectory_appends"] = {}`), and `docs/desktop-controls.md:104-106`
  records trajectory retrieval as an unimplemented slice. The child's transcript
  is a file on disk, written incrementally at tool-batch boundaries
  (`harness/comms.py:1121-1145`), and reading it needs a **new read-only backend
  route** — the reason for the two-PR split in § 9.
- **A child is a real session on disk, gated out of the user route.** Its
  directory is `config_dir()/sessions/<12 hex>` minted at launch
  (`harness/subagent.py:1587-1600`), stamped
  `mark_session_origin(dir, ORIGIN_SUBAGENT, ...)` (`:1612`) — and
  `is_user_session` refuses it (`resume.py:1013-1032`, `USER_ORIGINS` at `:79` is
  `{fork}` only), which is the gate the existing desktop session route applies
  (`server/utils/desktop_sessions.py:803-810`).

---

## 2. What the TUI does today (the reference)

Cited because it is the reference the operator named, and because two of its
behaviours are deliberately **not** ported — each says so where it appears.

### 2.1 The roster row opens a page (`subagent_panel.py:1366-1381`, `:1496-1509`)

The row is `can_focus = True` with `Binding("enter", "open_subagent", ...)`
(`:1373-1377`), and both `action_open_subagent` (`:1496-1497`) and `on_click`
(`:1509-1511`) call `self._on_open(self._job_id)`. So in the TUI the row is
clickable **and** keyboard-openable, which is the behaviour the desktop row is
now required to grow (§ 4).

### 2.2 The page itself (`subagent_view.py`, `app.py`)

- **It is a left-hand landing, not a modal.** `SubagentView` is a `Vertical`
  with a title, a breadcrumb, a rule, a real `TranscriptView` body and a footer
  row of hints (`subagent_view.py:1365-1431`); the app mounts it in place of the
  transcript region and greys the dock
  (`app.py:24219-24296`, docstring at `:24221-24236`: *"A MODE of this screen
  rather than a modal over it"*).
- **Opening it again RETARGETS it.** `_open_subagent_view` detects an existing
  page and re-points it without a second level (`app.py:24241-24254`).
- **Navigation is by RELATION over the lineage, and the breadcrumb is the
  ancestor chain.** `p` parent, `c` first child, `[`/`]` previous/next peer over
  the authoritative sibling list, `r` root (= close),
  `esc` = back to parent, or out to the conversation when there is no parent
  (`app.py:2885-2889`, `:24174-24215`; breadcrumb built from `self._ancestors`
  at `subagent_view.py:3196-3206`; footer rungs at `:3436-3471`). Peer cycling
  walks the complete sibling order rather than a filtered list, and says why
  (`app.py:24187-24215`): a list that loses the selected node's position
  oscillates over the first two children.
- **The footer sheds whole hints and never drops the way out**
  (`subagent_view.py:3436-3471`): seven rungs from `p [ ] c r ↑ ↓ esc read-only`
  down to `esc back` alone.
- **The body is the child's durable transcript, paged, plus its live events.**
  `show(...)` takes `transcript_directory` off the job row
  (`subagent_view.py:1834-1865`) and `_reset_history` (`:1990-2025`) starts a
  tail read; `home` loads an earlier page and `end` follows the live tail
  (`:1533-1556`, `:2197`, `:2257`). Two absence states are distinguished and
  re-probed: "no directory at all" is final, "directory but no
  `transcript.jsonl` yet" is re-looked (`:2025-2047`,
  `_transcript_file_exists` at `:2025-2045`, the eager-create note at
  `:2046-2075` — `Transcript` no longer creates the file until the first
  append).
- **The brief is a folded block, expanded with `enter`**
  (`InstructionBlock`, `:1015-1108`): a summary plus `⟨expand⟩ N more lines`,
  where the count is stated because "⟨expand⟩" alone cannot distinguish two more
  lines from fifty.
- **The launch turn is reconciled, not shown twice.** The child's durable
  transcript contains a `subagent-launch:<job_id>` user row carrying the full
  role/team/system preamble
  (`harness/subagent.py:562`, `:750`; the message id IS the entry id —
  `session/transcript.py:656-672`). `_chronological_entries`
  (`subagent_view.py:2520-2570`) replaces every such row with the concise
  authored prompt from `launch_prompts` and suppresses the synthetic head,
  because otherwise "a prior attempt's full role/team/system preamble leaks back
  as a plain user row". § 5 ports this rule.
- **The composer goes read-only, and says so** (`READ_ONLY_NOTE` on the footer's
  key span, `subagent_view.py:1619-1623`). **Not ported:** the desktop's
  composer keeps working (§ 5.6 says why).

### 2.3 To-dos — luminance plus a word (`todo_panel.py:1750-1790`)

Per item: `pending` is `muted` (open work is an instruction), `done`/`dropped`
are `dim` with a strikethrough (settled work is a record), `blocked` is full
`fg` — the loudest row in the band — with `— blocked: <reason>` and no colour
anywhere, "because the dock band spends colour on failure and on nothing else".
Phases carry a header `PhaseName · done/total` (`:1256-1267`) and items sit
beneath them. **The count's reason is the auto-hide:** a phase that stays fully
settled for `TODO_PHASE_HIDE_DELAY_S = 60.0` (`:208`, applied at `:754-800`) is
hidden from the view, and the header's `n/n` is what keeps a hidden phase
accountable. The desktop panel hides no phase — § 3.1 already refused to port the
auto-hide — so the count has no job there; § 6 takes the consequence.

---

## 3. The surface

### 3.1 Options considered

| | Option | Verdict |
|---|---|---|
| A | Keep the popover, drop the gates | Rejected. The operator's first ask is a pane that swaps with the canvas; a popover cannot swap with anything, and the failure-acknowledgement rule it was built around (`docs/run-details.md` § 3.3) exists only because opening it is an event. |
| B | A dock band above the composer, mirroring the TUI | Rejected, unchanged from `docs/run-details.md` § 3.1 A: it reclaims transcript height on every turn and forces one placement for two surfaces with different lifetimes. Also, a child reader cannot live in a band. |
| C | A sheet / drawer over the chat | Rejected. A sheet is modal-ish chrome for something that must stay readable *beside* the transcript — the reader is reference material while the parent turn keeps painting underneath. |
| D | A full route (`/chat/:id/run`) that replaces the chat column | Rejected. It costs the transcript, and the TUI's own design note insists the reader is "the same app looking somewhere else", with the parent's turn still painting (`app.py:24221-24236`). |
| E | **A second pane in the right slot, mutually exclusive with the canvas** | **Chosen.** The slot already exists and is already the "look at this thing" side of the window (`chat-content.tsx:446-470`); the chat column's own flex layout (a `w-0 min-w-[220px] flex-1` column plus a pinned-width sibling, `chat-content.tsx:299-350`) needs no new mechanics. |

The principle: **the transcript is the record; the right pane is the live view.**
The popover already carried that sentence; this change gives the live view the
room its content actually needs (a roster *and* a conversation).

### 3.2 Placement and the swap

```
[ rail ] [ chat column                                            ] [ right pane ]
          avatar  name / description      [run details][canvas]     ...
```

- The trigger stays in the chat header's existing action cluster, immediately
  left of the canvas button (`chat-header.tsx:107-135`, cluster is
  `ml-auto flex items-center gap-2`, both buttons `variant="ghost" size="icon"`).
  It does **not** become the panel's own header: the operator's ask places it
  "at the top right of the chat", and it has to remain reachable and clickable
  while the pane is open — which is what makes the swap a toggle rather than a
  one-way door.
- **One right pane at a time.** `isRunPanelOpen` and `isCanvasOpen`
  (`shared/store/ui-preferences-store.ts:51-57`, `:236-240`) become mutually
  exclusive **by construction**: each setter clears the other. Two booleans whose
  setters own the exclusion, rather than one `rightPane: "canvas" | "run" |
  null` field, because `setCanvasOpen(true)` is called from eleven sites that
  mean "show me this file" (`chat-header.tsx:128`,
  `message-item/{image,file,video}-attachment.tsx`) and a union field would churn
  all of them for no behavioural gain. Opening either pane while the other is
  open swaps; that is the whole mechanism.
- The panel renders as a sibling of the canvas block, reusing the same three
  pieces: `ResizableDivider` (`shared/components/common/resizable-divider.tsx`),
  a pinned-width wrapper `h-full overflow-hidden border-l border-hairline`, and
  the pane's own root `<section>`. **The divider must be parameterised**: its
  separator hard-codes `aria-label="Resize canvas"`
  (`resizable-divider.tsx:225-230`), which would announce the wrong control for
  the run panel and would leave the two panes' handles indistinguishable to a
  screen reader. One required prop on an existing shared component — the
  smallest interface change in this document.
- **Rejected: a segmented control in the header.** It would read the swap
  correctly, but it restructures the canvas button, which carries its own
  `data-tour-tag`, its own tooltip and its own deliberate hide-when-open rule
  (`chat-header.tsx:120-134`), and it introduces an icon-only two-cell group into
  a header bar where no such pattern exists (the app's only segmented control,
  the canvas `ViewSwitcher`, lives on a `sunken` panel track —
  `canvas/index.tsx:89-152`). The pair of icon buttons already means "these two
  are the right-pane choices"; the pressed state below is what had been missing.

### 3.3 The trigger

**Visibility: `details !== null`.** Not `hasRunDetails`, not `!isCanvasOpen`.
`hasRunDetails` (`run-detail-model.ts:946-956`) is deleted as a visibility
predicate and survives only inside the panel's own copy logic, where "is there
anything outstanding" is still a fact worth stating. The remaining condition is
not a work gate but a data gate: `chat-page.tsx:159-167` derives the model only
when `canonical.frontend` exists and passes `null` on the legacy path
(`chat-content.tsx:132-137`), where there is no session identity and no
`jobs`/`todos` stream to show. So "always visible" means *always visible in a
canonical session*, which is the state every session this surface can describe is
in — and a legacy chat grows no button, exactly as it does not today.

**Icon: `Activity`, unchanged.** The old reasoning still holds: `Users` and
`ListChecks` already mean a specific tool in this app
(`trace/tool-glyphs.ts:54-79`) and a header button wearing one would read as that
tool.

**Behaviour: a toggle.** Clicking it when the pane is closed opens the run panel
and closes the canvas; clicking it when the pane is open closes the panel. It is
a real `aria-pressed` toggle with a pressed ground (`bg-accent-wash text-accent`
— `branding.md` § 2 spends the accent on "primary action, active state, focus
ring", and this is the middle one; the ghost `Button` variant's hover is
`bg-accent-wash hover:text-ink`, `shared/components/ui/button.tsx:167-172`, so
the pressed state needs an explicit override rather than a new variant), a
tooltip and an `aria-label` that name the action in both states ("Open run
details" / "Close run details"), and the existing `data-run-details-trigger`
hook, renamed to `data-run-panel-trigger` so the frames cannot photograph the
retired surface by accident.

**What the trigger shows when there is nothing to show:** the button only — no
disabled state, no count badge (`docs/run-details.md` § 6.1's "a badge that
ticks from 2 to 3 draws the eye to something the user is not going to act on"
still holds) — and the dot below.

### 3.4 The attention dot — two ledgers, one mark, and what replaces `acknowledgeOnOpen/OnClose`

The old rule was tied to the popover's transitions and to its own unmount hazard
(`run-details-trigger.tsx:212-270`, `run-detail-model.ts:819-904`). A persistent
panel is not *opened*, so the transition rule has no successor in that shape and
is **deleted**, not ported. What replaces it:

> **While the panel is showing the list — a failed child whose row is in the
> rendered slice, or a problem MCP server whose row the MCP section renders, is
> acknowledged. While the panel is closed, or showing a child's reader, nothing
> is, except the child the reader is showing.**

- "The rendered slice" is the existing predicate for children:
  `onScreenFailures` over `panelSlice` (`run-detail-model.ts:1187-1203`,
  `:1228-1232`). A failure behind the `+N more` disclosure is not in it and keeps
  its dot — the old doc's own argument (`docs/run-details.md` § 3.3) is
  unchanged. The MCP section has **no cap** (§ 7.2), so for that ledger the
  rendered slice is the whole set; a cap is an answer to an unbounded stream of
  children, not to the finite servers a user configured.
- The acknowledgement is now **continuous while shown** rather than bound to two
  instants: one pure function, `acknowledgeWhileOpen(shown, seen)`, is
  `accumulateSeen` (`:869-877`) over the slice, evaluated whenever the slice or
  the shown state changes. `acknowledgedOnOpen` / `acknowledgedOnClose`
  (`:839-847`, `:899-904`) are removed; `accumulateSeen` and `onScreenFailures`
  survive verbatim.
- **The dot needs to know WHICH VIEW the pane is showing, and this is new.** A
  reader replaces the panel's body wholesale (§ 5.1), so with a reader open
  neither the roster's rows nor the MCP section is rendered — and the in-flight
  working tree acknowledges on `isRunPanelOpen` alone, which marks a failure or a
  dropped server as seen at the moment it lands behind a reader the user is
  reading. The two facts the pane already knows are therefore reported up to the
  trigger, the same way `onOpenChild`/`onToggleRosterExpanded` already travel:
  `listOnScreen` and `readerChildId`. Then the child ledger's input is
  `listOnScreen ? onScreenFailures(details) : []`, plus `[readerChildId]` when a
  reader is open — the reader's own child's outcome IS the page, which is § 5.7's
  "the dot rule no longer applies (the row is on screen)" in the other
  direction — and the MCP ledger's input is
  `listOnScreen ? unseenMcpProblems(rows, seen) : []`. A breadcrumb acknowledges
  nobody: it names ancestors without showing their outcomes.
- The one property the old design protected is preserved: a failure that arrives
  while the list is shown and **is** in the slice is acknowledged because it is
  genuinely on screen — which is what the dot claims. The old objection ("the
  reader may be scrolled down in the plan") was an argument about a popover that
  could place a row outside the viewport; § 5.3 makes the roster the panel's
  scroll owner and states the same conclusion for a taller pane. Being *below the
  fold* of the panel's single scroll region is therefore "on screen" by this
  design's own standard — § 7.2 takes the consequence by fixing the section order
  rather than reordering sections by state.
- **The dot survives** for the case that matters: the panel is closed and
  something failed. It stays a single 8px `danger` dot at the button's top-right
  (`run-details-trigger.tsx:339-353`), still not a count.
- **ONE DOT, TWO LEDGERS — merged, never ranked.** A failed child and a broken
  MCP server are different facts with the same claim ("something needs your
  attention and you have not looked"), and one 8px dot cannot say which. It does
  not have to: the only action the dot offers is to open the panel, and the panel
  names both facts in its own sections. The ledgers are **separate sets** rather
  than one — a job id and a server name are both strings, and folding them into
  one set would let a server called `job-ledger` acknowledge a failed child.
  Priority (child failures outrank MCP, or the reverse) is **rejected**: it lights
  the same single dot for a second, unannounced reason the moment the first is
  acknowledged, so the dot appears not to clear when the user opens the panel —
  and while both hold it would hide the lower-ranked fact in the tooltip, which
  is precisely the hidden problem this surface exists to stop hiding.
- **The trigger's accessible name must say what the dot means.** The tooltip and
  `aria-label` are built as ordered clauses (`run-detail-model.ts:1336-1372`), and
  the in-flight label has no MCP clause — so today a lit dot for a dropped server
  announces "Open run details" and nothing else, to a reader who cannot see the
  dot. One clause, in the existing grammar and after the failure clause: `1 MCP
  server needs attention` / `2 MCP servers need attention`. `MCP` stays singular
  as the protocol's own name (`status_line.py:740-742`), and the two attention
  clauses are the last the budget may shed — a dot whose name lost its reason is
  the unreadable state.
- The TUI precedent for refusing to let a failure pass is unchanged and still
  cited: `note_child_failed` re-raises a hidden panel as a `1 failed` row
  (`subagent_panel.py:1858-1873`). Its MCP twin is the band's own lamp, which
  takes `danger` whenever any configured server did not come up — "FAILURE WINS
  even when other servers connected" (`status_line.py:763-790`).

The old doc's `!isCanvasOpen` term and its cost note
(`docs/run-details.md` § 3.3) die with the gate: with the panel in the pane, a
failure arriving while the canvas is open is announced by the dot that is now
always on screen.

### 3.5 Escape and the panel's own state model

| state | who owns it | survives navigation | survives restart |
|---|---|---|---|
| `isRunPanelOpen` | `ui-preferences-store` (global, persisted — same as `isCanvasOpen`, `ui-preferences-store.ts:180`, `:266-268`) | yes | yes |
| `runPanelWidth` | `ui-preferences-store` (global, persisted) | yes | yes |
| the reader's open child | the panel (component state) | **no** — a child belongs to one session's lineage | no |
| `listOnScreen` + `readerChildId` | the pane, reported up to the trigger (§ 3.4) — the same callback shape `onOpenChild` already uses | no (a view) | no |

- **The pane's view is the dot's second input.** `listOnScreen` and
  `readerChildId` are derived facts about what the pane is rendering, not state
  anyone sets; they exist as a row here because § 3.4's acknowledgement predicate
  needs them and the trigger cannot see the pane's own mode. They are deliberately
  NOT in `ui-preferences-store`: a mode of a pane is not a preference, and
  persisting one would restore a reader on a session whose lineage it does not
  belong to.
- **Switching conversations keeps the pane open and resets the reader.** The
  canvas behaves the same way (`isCanvasOpen` is global while the canvas's
  documents are per-conversation, `canvas-store.ts:22-30`, `:97-105`), and a
  reader pointed at another session's child is not a state anything should be
  able to reach.
- **Escape** has a two-step ladder, and it is bound on the panel container, not
  on `window`:
  - reader open → back one level (the TUI's `esc`, `subagent_view.py:3423-3424`);
  - at the roster → close the panel and return focus to the trigger.
  The window-level Escape that cancels a pending session open
  (`chat-page.tsx:804-815`) is untouched; the panel's handler stops propagation
  so the two cannot both act on one press.
- The panel is **not** a Radix portal and therefore not a dialog: it is an
  in-flow `<section>` with an `aria-label="Run details"` (the canvas's own
  precedent, `canvas/index.tsx:363-367`), so the old `aria-dialog-name` work and
  the Tab-out-of-a-portal walk (`run-details-trigger.tsx:70-141`) are deleted
  with the popover.

---

## 4. The roster (successor to § 4.1)

Structure, tallies, the nine state icons, the second line's two variants, the
number-omission rule and the default-role suppression are **carried over
unchanged** from `docs/run-details.md` § 4.1 and `run-detail-subagents.tsx`.
Three things change:

1. **The row is interactive.** Clicking it opens that child's reader (§ 5);
   `Enter`/`Space` on a focused row does the same (the row becomes a real
   `button`-role control with the app's `outline` focus ring, or a `li` holding a
   full-width button — an implementation choice; the constraint is that the row
   is a tab stop and reachable by keyboard, matching the TUI's `can_focus` +
   `Binding("enter", ...)` at `subagent_panel.py:1373-1377`).
2. **The row now HAS a hover ground: `bg-elevated`.** The old doc's § 4.3 rule
   ("no row has a hover ground, because nothing here is clickable") was right and
   is now inverted by this change; `elevated` is the role `branding.md` § 2 names
   for hovered rows, and it is the app's dominant list-row hover
   (`hover:bg-elevated`, eleven call sites). The to-do rows stay non-interactive
   and keep no hover ground — the two lists no longer have to agree, because they
   no longer both do nothing, and a to-do that lit up would be a promise the plan
   cannot keep.
3. **`+N more` becomes a disclosure control**, not an inert row: a button that
   raises the cap to a stated larger bound (render every row, in the same
   priority order) for as long as the panel is open on that session. Reason: the
   operator's ask is "click into subagents", and a child behind the cap would be
   unreachable — a roster where six rows are reachable and the seventh silently
   is not is the defect, not the fix. This changes the slice's *presentation*
   only; the priority rule, the failure reservation and the tie-break
   (`run-detail-model.ts:1064-1203`) are unchanged and stay pinned by
   `scripts/run-detail-model.test.mjs`. The expanded state is component state and
   resets when the panel closes.

The reader's needs add **three fields to `SubagentRow`**, all read off the job row
that already arrives (no wire change): `childSessionId` (from `session_id` — the
child's transcript directory name, `harness/comms.py:752-768`), `parentJobId`
(from `parent_job_id`), and `childCount` (derived in the renderer by grouping
`frontend.jobs` on `parent_job_id`). `resultText` and `errorText` become full
strings rather than `errorLine` alone, because the reader's outcome block needs
the whole thing (§ 5.2) — the roster's own `errorLine` rule (first line only,
`run-detail-model.ts:679-681`) is unchanged.

---

## 5. The child reader

### 5.1 What it shows

The child's **conversation**, rendered with the app's own canonical transcript
grammar, on the parent transcript's ground:

- **The body is the same row pipeline the parent uses.** The reader fetches a
  page from the new route (§ 10), reduces it with the existing
  `applyHistoryPage(state, page)` (`canonical/transcript-reducer.ts:677-830`) and
  paints it with the existing transcript view (`canonical/canonical-transcript.tsx:508-520`).
  This is not a convenience: the durable row → record mapping already drops the
  bookkeeping rows a child's transcript is full of — `SILENT_CUSTOM_TYPES`
  (`transcript-reducer.ts:502-509`) covers `frontend_state_checkpoint_v1`,
  `session_state`, `compaction_refused`, `hub_communication`, `wake_schedule` and
  `prune`, a `subagent_roster` / `todo_snapshot` row carries no `details.text` and
  so returns `null` (`:552-553`), and `compaction` rows become the one-line
  "Context compacted" record (`:520-522`). That list is the renderer-side twin of
  what `comms._render_transcript_steps` drops for `hub op='peek'` — and it is
  exactly why the reader can mount the child's transcript through the parent's
  reducer instead of inventing a rendering path.
- **Why this is a departure from the TUI, stated as one.** The TUI paints the
  child page with `fold_transcript_entries` into `SubagentEntry` blocks
  (`subagent_view.py:2520-2545`) — its own fold, with its own block grammar. The
  desktop reuses the parent's grammar because the *point* of the port is that the
  child's conversation "reads like the parent transcript"; a second desktop
  grammar for the same durable rows would be the two rails `branding.md` § 7
  forbids.
- **The brief is the head block**, folded to a summary with an expander, at most
  a handful of rows, with the hidden-line count stated (the TUI's rule,
  `subagent_view.py:1053-1073`). Its text is `launch_prompts[launch_message_id]`
  when the map carries the current launch, else `prompt`
  (`frontend_state.py:1413`, `:1461-1486`).
- **The launch turn is reconciled, not duplicated.** A durable user row whose
  entry id is in `launch_prompts` — the ids are `subagent-launch:<job_id>`
  (`harness/subagent.py:562`, `:750`) and the message id IS the entry id
  (`session/transcript.py:656-672`) — is replaced by that concise prompt; every
  attempt alias is reconciled the same way. This is the port of
  `_chronological_entries`' rule (`subagent_view.py:2547-2570`) and its reason is
  the same one recorded there: without it the reader opens on the full
  role/team/system preamble. A child whose record predates
  `launch_message_id` keeps the brief and whatever the transcript holds —
  duplicating wrapper text is the TUI's own chosen failure mode and it is the
  safer direction.
- **The outcome is rendered from the roster row, not from the transcript**:
  `result_text` when the child settled normally, `error_text` verbatim when it
  failed (the row's own machine-voice rule, `run-detail-model.ts:643-681`). This
  is the TUI's roster-carries-the-outcome rule (`subagent_panel.py:641-660`) applied
  in the page, and it needs no new wire data.
- **Images**: durable rows carry digests, not bytes
  (`transcript._externalize_attachments`; the parent's route at
  `server/routes/desktop_sessions.py:341-352` exists precisely because of that).
  A child's page therefore needs a child-scoped attachment path, which § 10 marks
  as part of the route family. The constraint if that path ships late: the reader
  renders an honest "Image not available" row rather than a broken one.

  **That is the branch this change takes, and the review round made it explicit
  (R1-5).** The child attachment op is NOT wired here: the reader renders a
  child image through the same path as any other blocked image, and the copy is
  the honest one for a subsystem that is absent — the bytes are not available to
  this reader — rather than `BrokenAttachment`'s "the file may have been moved,
  renamed, or deleted", which asserts a cause this code cannot know and is wrong
  in the ordinary case (the child's attachment store is intact; the route is
  missing). § 5.1's licence is exactly this: the honest row is the fallback
  "if that path ships late", and it has not shipped. When the child attachment
  op lands, the row becomes a picture and this paragraph goes.

### 5.2 The header

Two rows, mirroring the app's own pane-header idiom rather than inventing one:

1. **A 40px `sunken` chrome bar**, the canvas's own pattern
   (`canvas/index.tsx:380-425`): left = a back control + the breadcrumb; right =
   the sibling stepper (when the child has peers) and a `PanelRightClose`
   "Close run details" button (`:432-450` is the canvas's twin). No visible
   panel title — the canvas removed its own title for the same reason
   (`canvas/index.tsx:180-192`), and the breadcrumb is the title.
2. **A facts row**, the roster row's grammar re-used as a header: state icon,
   label at full ink, then the numbers run — `agent_role` (suppressed when it is
   the default `task`), elapsed, context, cost, and `model_label`. **Note the
   departure**: `docs/run-details.md` § 8 deliberately does not read
   `model_label` because the roster row has no model segment. The page header is
   the one place it belongs — the TUI's child page carries the tools, the failure
   count and the effort, and the operator's second ask is specifically about
   understanding a child (`frontend_state.py:1389-1415` carries `model_label` and
   `effort` for exactly this). The roster row is unchanged.

The header keeps its last-known facts if the child leaves `frontend.jobs` while
the reader is open (a settled child is swept minutes later, `harness/jobs.py`'s
manager sweep): the panel caches the row it opened with and updates it from the
roster while the row is present.

### 5.3 Live updates

The child's transcript is written at tool-batch boundaries
(`harness/comms.py:1121-1145`), and the parent's stream already carries a signal
at exactly that boundary: `subagent_progress` is emitted on tool starts/ends and
message ends, never per stream delta (`harness/types.py:1580-1591`), and
`subagent_start` / `subagent_end` bracket the child's life (`:1557-1580`,
`:1595-1602`). Today the desktop drops all three on the reducer's floor
(`docs/run-details.md` § 1).

- The canonical session hook exposes a **pulse**: a per-job counter bumped on
  `subagent_start|subagent_progress|subagent_end` in the live-event branch of
  `use-canonical-session.ts:463-471` (the same branch that calls `applyEvent`),
  and seeded from `frontend.live_events` on a snapshot
  (`:255`, `transcript-reducer.ts:1236-1250`).
- The reader refetches the tail page when its child's counter changes while the
  reader is open, **coalesced to at most 1 Hz**, plus one final read when the
  child settles, and then stops. No timer runs for a settled child, and none runs
  while the panel is closed — the same discipline the panel's elapsed clock
  already follows (`run-details-clock.ts`, `run-detail-model.ts:918-922`).
- **The cost is stated, because it is real.** `read_transcript_page` is a
  sequential scan of the whole file that retains `limit + 1` rows
  (`session/transcript.py:361-428`) — there is no tail-only read — so each poll
  parses the child's entire transcript. It runs off the event loop (the route
  must do the same, exactly as `bridge.history` does at
  `server/utils/desktop_sessions.py:476-484` and `peek` at
  `harness/comms.py:1189`). The pulse-driven cadence is what keeps this
  affordable: a child that thinks for ninety seconds costs one read, not ninety.
  A byte-offset incremental read is a follow-up, not this change.
- A fallback poll (5 s) while the reader is open on a **live** child covers the
  case where the pulse stream is degraded (`frontend.update` deltas can arrive
  shed, `frontend_state.py:3064-3084`) — it is a safety net, not the mechanism.
- There is no `aria-live` on the reader. It updates while open and announces
  nothing per row; the panel's opening announcement is the header.

### 5.4 Paging and settling

- Tail-first, like the parent: the reader loads the tail page on open and
  `before_id` pages via the existing "load earlier" affordance
  (`CanonicalTranscript`'s `onLoadOlder`, `canonical-transcript.tsx:118-124`),
  implemented with the parent's own loader shape
  (`use-canonical-session.ts:607-650`: guard against a stale request, a
  `loadingOlder` flag, `applyHistoryPage`).
- `cursor_missing` means the child's transcript was replaced under the reader
  (compaction replaces the JSONL atomically, `session/transcript.py:349-358`);
  the reader re-reads the tail and dedupes by stable entry id — the same rule
  `applyHistoryPage` already implements for the parent (`:750-815`).
- Nested children: the lineage comes from `parent_job_id`, so a grandchild is
  one more step down the same path and needs no extra mechanism.

### 5.5 Navigation: a lineage PATH, and the stack that was rejected

**Adopted: the path, derived from lineage.** The reader's position is the chain
`session → child → … → current`, built by walking `parent_job_id` over
`frontend.jobs` — the TUI's `_ancestors` model, which is what its breadcrumb
paints (`subagent_view.py:3196-3206`) and what the wire was explicitly extended
to carry (`frontend_state.py:1425-1443`: *"lets a follower rebuild the full
parent/peer/child graph from `state.jobs` alone, so the hierarchy keys navigate
the authoritative structure rather than silently doing nothing"*).

| binding | action | TUI analogue |
|---|---|---|
| click a roster row | open that child | `subagent_panel.py:1509` |
| `Enter` / `Space` on a focused row | open that child | `:1374` |
| click the back control, or `Escape` | pop one level; at the root, close the panel | `esc` = `_leave` (`subagent_view.py:3423`), handled by `_close_subagent_view` (`app.py:24335`) |
| `⌘[` / `Ctrl+[` | same as back (the platform's own back gesture) | `p` = parent (`app.py:2885`) |
| click a breadcrumb crumb | jump to that level | the breadcrumb itself |
| click a peer step (◀ / ▶) | previous / next sibling, in the authoritative sibling order | `[` / `]` = `subagent_peer(∓1)` (`app.py:2886-2887`) |
| a "N children" control in the header, when the child has children | descend to the first child | `c` = `subagent_child` (`:2888`) |
| clicking the trigger, the `PanelRightClose` button, or breadcrumb root + one more back | close the panel | `r` = `subagent_root` (`:2889`), `esc` at the root |

**Rejected: a visit-history stack** (open A, hop to B, back → A). It would have
to be maintained beside the lineage, and it diverges from the tree in exactly the
cases the TUI's own comment names: after an ancestor is resumed or swept the
lineage is still the truth while the history is a list of nodes that may no
longer exist. A path needs no separate state, cannot go stale, and makes the
breadcrumb and "back" agree by construction. The TUI's peer keys are kept as
controls rather than as bare-letter keys because `p`, `c`, `r` and `[`/`]` would
have to be stolen from a live composer — the desktop has a text field focused
most of the time, and the TUI's own read-only composer
(`app.py:24276`) is the mechanism it uses to make those keys safe. **That
mechanism is deliberately not ported** (§ 5.6).

### 5.6 What a user can and cannot do here

Read and navigate, and nothing else. No steering, no answering, no stopping a
child from this pane, and the composer stays live for the parent conversation —
`hub ask` traffic and stop controls are their own design problem and the old doc
already defers the first (`docs/run-details.md` § 10). The footer states the
surface is read-only for the child (the TUI's `READ_ONLY_NOTE` precedent,
`subagent_view.py:1619-1623`) so the absence of controls is a stated fact rather
than a puzzle.

### 5.7 What happens when the child changes underneath the reader

| event | rendering |
|---|---|
| child emits a progress beat | nothing structural; the pulse triggers a tail refetch |
| child settles (success) | one final refetch, outcome block appears, the header's status icon and elapsed settle, the elapsed timer stops |
| child fails | final refetch, outcome block becomes the verbatim `error_text` in machine voice, header icon takes `danger`, the dot rule in § 3.4 no longer applies (the row is on screen) |
| child is cancelled / interrupted / paused / swept (`gone`) | the header's state word changes; the body stops following; the outcome block says what the wire said |
| child never wrote a transcript | the body shows one quiet line naming that fact (§ 10's `pending` state) and the reader retries on the next pulse |
| transcript gone from disk | the body shows the final "no longer on disk" line (`gone`) |
| entry cursor vanished mid-read (compaction) | re-read the tail, dedupe by id |

---

## 6. The to-dos (successor to § 4.2)

### 6.1 What is actually redundant — the finding

I read `run-detail-todos.tsx` and the model, and the answer is **not** the one
the brief guessed at. Three facts, in order of how visible they are:

1. **The closure count is stated twice for one list, at two levels, in the same
   visual weight.** The section header carries `todoTally(details, budget)`
   (`run-detail-todos.tsx:181`) — `11 of 15 closed · 1 dropped`
   (`run-detail-model.ts:1040-1050`) — and every phase header beneath it carries
   `· {closed}/{total}` (`run-detail-todos.tsx:195-204`), which is a partition of
   the same number. Both are `text-meta`, both are `ink-dim` or `ink-muted`, and
   the same closure is measured at two levels. This is the thing that reads as
   redundant: **closure is asserted on every line and counted twice.**

   The WORD moved in the review round (D1-8): the tally says `closed`, which is
   the word the phase headers and the model already use (`TodoPhaseView.closed`).
   It used to say `resolved`, and on a plan with dropped work that was not merely
   a second spelling — `3 of 3 resolved · 1 dropped` cannot be checked against the
   three rows under it when one of them is the dropped one (3 + 1 > 3), and a tally
   exists to be checkable. `closed` is done OR dropped, so the two numbers always
   add up to the rows on screen.
2. **A phase whose name IS the implicit one collides with the section label.**
   `IMPLICIT_PHASE_NAME = "Todos"` (`run-detail-model.ts:182`) and
   `isNamedPhase` (`:800-803`) suppress that name — but only for a plan with
   exactly ONE phase (`headerlessPhase`, `:741-747`). A plan that mixes the
   implicit phase the backend lazily creates (`builtin.py:5834`, `:6160-6170`,
   reached by `add` before any phase was ever named) with a phase the agent did
   name renders a section headed **`To-dos`** directly above a phase headed
   **`Todos`** — the same plan named twice, with the section's tally counting a
   plan the first phase only partly owns. There is no rule that makes this
   impossible: the wire cannot distinguish an implicit phase from one an agent
   genuinely named `Todos`, and today only the single-phase case is folded.
3. **The plan is also a transcript receipt.** The `todo` tool's own `view` output
   is the same list in text form — `PhaseName · done/total` headers plus
   `- [x] text` rows (`builtin.py:6120-6155`), and the backend deliberately keeps
   the two spellings in step (`:6133-6150`). On the desktop that receipt is
   behind the tool row's closed disclosure (`canonical-transcript.tsx:283-319`),
   so it is **not** on screen at the same time as the panel. It is a real second
   presentation of one list and the reason "show just one to-do list" is the
   right ask — the panel becomes the plan's one expanded presentation, and the
   receipt stays the transcript's collapsed record. Nothing in this change
   touches the receipt.

I found **no** duplicate renderer of the plan: `RunDetailTodos` is the only
consumer of `details.todos` in the renderer (grep over `src/renderer/src`), and
the plan is not repeated between the panel's two sections. Verified, not assumed.

### 6.2 The single list

- **One list. Phases are section headers; items are indented rows under them.**
  This is already the structure (`run-detail-todos.tsx:184-236`) and it stays.
- **The section keeps the plan's ONE count; the phase headers lose theirs.**
  Fix (1) by removing the finer measurement, not the summary: the plan's progress
  is one fact about the plan, stated once at the head of the list, in the same
  grammar as the `Subagents` section's tally (`run-detail-subagents.tsx:292-307`)
  — and `dropped` can only live in the summary, because it is a breakdown *of*
  the closure (`run-detail-model.ts:1022-1038`). The phase header becomes the
  phase's name alone.
  The departure is from the TUI and the reason is citable: the TUI's
  `PhaseName · done/total` (`todo_panel.py:1256-1267`) exists because the dock
  **hides** a fully settled phase after 60 s
  (`TODO_PHASE_HIDE_DELAY_S = 60.0`, `:208`, applied `:754-800`), so the header's
  `n/n` is the only evidence that a hidden phase is complete. This panel hides no
  phase — the old doc refused the auto-hide for the same reason it now drops the
  count: a list that reflows under its reader is a defect
  (`docs/run-details.md` § 2.2). **The cost, stated:** a phase all of whose rows
  the cap shed (the `todos-only` fixture's `Reconcile · 5/5 resolved` + `+5 more`
  state) now reads as its name and `+5 more`; its completion is legible from
  `+5 more` only in combination with the rows that survived, and from the section
  tally when it is not. § 6.4 rejects the alternative that keeps the counts.
- **An implicit phase is headerless wherever it appears.** Fix (2) by applying
  `isNamedPhase`'s test per phase rather than to the whole plan: a phase whose
  name is `IMPLICIT_PHASE_NAME` renders no header, and its items join the plan as
  a leading unnamed group (its own `+N more` row still discloses what the cap
  took from it — the accountability rule of § 6.4 below is kept). A plan whose
  implicit phase is followed by named ones then reads as one list with real
  sections, which is exactly the shape asked for. This is a **bug fix against
  this codebase's own vocabulary**, not a TUI port: the backend's `_todo_view_text`
  makes the same fold for the receipt (`builtin.py:6133-6155`), and the desktop's
  model test already pins the single-phase half of it
  (`scripts/run-detail-model.test.mjs:776`, "a flat plan renders headerless").
- **`line-through` for done is already the behaviour** (`run-detail-todos.tsx:120`,
  `settled && "line-through"`, over `done` and `dropped`), together with the
  settled `ink-dim` ink (`:53-58`). Nothing to add; it is named here so the
  operator's third ask is answered with what is true rather than with a change
  that would be a no-op.

### 6.3 States, marks and overflow (carried over)

The four states and their encoding are `docs/run-details.md` § 4.2's, unchanged:
`pending` `ink-muted`, `done` / `dropped` `ink-dim` struck, `blocked` full `ink`
with `— blocked: <reason>` on its own indented line; lucide boxes for the marks
(`run-detail-todos.tsx:40-45`); the flat single-phase case headerless; items
capped at ten with the oldest **closed** rows shed first and the hidden rows
disclosed inside the phase that lost them
(`run-detail-model.ts:1234-1302`, `run-detail-todos.tsx:220-233`); a blocked row
is never shed. The TUI's luminance-plus-a-word rationale
(`todo_panel.py:1750-1785`) is kept verbatim, including that no item is coloured.

### 6.4 Rejected alternatives for the redundancy

| option | why it lost |
|---|---|
| Keep both counts, just style them differently | The redundancy is the second *statement*, not its weight. Restyling keeps the reader counting two partitions of one number. |
| Keep per-phase counts, drop the section tally | The plan would have no single progress statement at all, the summary would sit in the middle of the list rather than at its head, and `dropped` — the breakdown of closure — would have nowhere to live. |
| Show the per-phase count only when the phase lost rows to the cap | Two header grammars for one fact, which is the defect the old doc spends § 4.2 removing ("one word for one fact"); and `+N more` already states what was hidden. |
| De-duplicate by rendering the plan only in the transcript receipt | Loses the live view entirely, which is the surface's whole purpose, and the receipt is a disclosure a reader must open. |

---

## 7. The MCP servers

### 7.1 The problem, and what already exists

The operator's ask, third part: *"in that status sidebar can you include the
status of MCPs … there doesn't seem to be a robust way to know which MCPs are
connected or not and which have issues"*, with an indication when there is a
connection problem.

The fact the ask is about already exists on the wire, and the renderer already
has the op. What does not exist is a surface that shows it where the operator is
looking, at a cadence that could show it at all:

- **The op is shipped.** `mcp.list` (`desktop-contract.ts:527`) maps to
  `GET /v1/desktop/sessions/{session_id}/mcp` (`:1411-1415`; route at
  `desktop_lifecycle.py:107-141`), `"mcp"` is already a member of the
  `DesktopFeature` union (`desktop-hooks.ts:63`), and the backend already
  advertises `"mcp": 1` (`capabilities.py:53`). **No backend change, no new
  route, no capability bump, no new op** — the asymmetry with § 10's new route
  family is deliberate and is the reason this surface costs one renderer section
  rather than a two-PR split.
- **The payload is `MCPDesktop.snapshot()`** (`mcp/desktop.py:127-152`): per
  server `name`, `source`, `owned_scope`, `removable`, the public transport
  config (`public_server_config`, `:92-116`), a `setup` hint, `status` and
  `tool_count` — plus `operations`. The route's cold branch is the same shape
  with `"status": "cold"` on every row and `cold: true` in the envelope
  (`desktop_lifecycle.py:111-134`).
- **The status vocabulary is the wire's, and the backend says so explicitly.**
  `connected | connecting | auth-required | disconnected`
  (`mcp/manager.py:1330-1341`), whose docstring is an instruction to every
  status surface: *"Every status surface renders this string directly, so naming
  the actual fix costs nothing and stops an auth-blocked server from being read
  as a crashed one"*. `auth-required` is deliberately its own state because its
  fix (`/mcp reauth`, or completing a grant in another session) differs from a
  dead process's — which is exactly the confusion the operator reported.
- **The one surface that reads it today is in the wrong place and is not live.**
  The Settings section (`mcp-management-section.tsx`) is behind a page nobody
  opens during a run, and its query carries `staleTime: 10_000` and no interval
  (`:251-260`) — so it is read when the section mounts and not otherwise. The
  fact exists, on a page nobody is looking at, refreshed at nobody's cadence:
  that is the reported failure in one sentence.
- **That section also reads three fields the route never sends**, which is worth
  recording here because the panel must not inherit the mistake: `server.scope`
  (`:398`), `server.setup_prompt` (`:479`) and `server.error` (`:422`).
  `MCPDesktop.snapshot()` sends `owned_scope`, a `setup` object and **no error
  key at all**, so the scope badge never renders, the stdio setup offer never
  appears, and the error line is dead code. The remove control is the visible
  consequence: it sends `scope: server.scope === "project" ? "project" :
  "global"` (`:505-508`), and `mcp/desktop.py:191-193` refuses a mismatch with
  *"This source is not owned by the selected scope"* — so **a project-scoped
  server cannot be removed from the desktop**. Real, small, and the Settings
  surface's rather than this panel's; § 13 records it, and the panel reads
  `owned_scope`.

### 7.2 The section, the row and the states

**Presence**: the `mcp` capability resolves (`desktop-hooks.ts:73-80`) **and**
the read returned at least one server. Same rule as its two neighbours in
`run-details-panel.tsx` (`:72-93`): a section appears only when it has content,
and an empty heading is not a state anything renders. No servers configured is
therefore absence, not a line saying there are none.

**Order: last, after the roster and the plan.** The panel's subject is the run in
flight; a server's configuration is the least transient fact on the surface. The
alternative — moving the section up, or reordering sections when one has a
problem — is refused for the reason § 6.2 refuses reflow under a reader: a
section that moves because its state changed makes the reader re-find the thing
they were reading. The dot is what draws the eye (§ 3.4); the order stays fixed.
The consequence is stated rather than hidden: with many children, a problem MCP
row can sit below the fold of the panel's single scroll region, and § 3.4 counts
that as on screen because the panel's own standard for "rendered" is the slice,
not the viewport.

**The row, one line** — four segments, in the roster row's own grammar (mark,
label, then the quiet numbers):

| segment | source | ink |
|---|---|---|
| mark | the state table below; `aria-hidden` decoration, as the roster's is | the state's ink — `danger` on a problem state, neutral otherwise |
| name | `name`, truncating with an ellipsis, `title` carrying it whole | `ink` |
| status word | `status`, **verbatim** | `ink-muted`, `danger` on a problem row |
| qualifier | `tool_count` when connected (`12 tools`, singular `1 tool`), then `owned_scope` (`global` / `project`) else the source file's basename | `ink-dim`; the count `tabular-nums` |

**The second line exists only for a remedy**, and only on a problem row: an
indented, quiet line in the to-do section's blocked-row shape (`— <hint>`). The
scope is a qualifier, not a subject, so it stays on line one; giving it a line of
its own makes every healthy row two lines tall for a fact the reader is not
looking for, and doubles the section's height in the pane's scarcest direction.

**The state table**, marks ported by MEANING from the roster's own table
(`run-detail-subagents.tsx:51-84`) so the panel has one vocabulary rather than
two, and ink spent on failure and nothing else (the dock band's law, § 6.3):

| wire word | mark | the word rendered | problem state? | second line |
|---|---|---|---|---|
| `connected` | `Check` | `connected` | no | — |
| `connecting` | `LoaderCircle`, `motion-safe:animate-spin` | `connecting` | no | — |
| `auth-required` | `CircleAlert` | `auth-required` | **yes** | `— Grant this server account access in Settings` |
| `disconnected` | `X` | `disconnected` | **yes** | `— Reconnect this server in Settings` |
| `cold` | — (the section's own state, below) | — | no | — |
| anything else | `CircleHelp` | the wire's own word | **yes** | none — a fix for a word this build cannot name would be a guess |

- **The word is the wire's, verbatim, including `auth-required`.** A friendlier
  spelling in this one renderer would make the panel and the Settings page
  disagree about one server's state — the second, divergent reading of one
  document that this section exists to avoid — and the backend's own docstring
  (`mcp/manager.py:1331-1335`) makes rendering the string directly the contract
  between them. The human meaning is carried by the hint line instead, which
  names the fix in the app's own control vocabulary. A friendlier *word* is a
  backend vocabulary change; § 13 defers it rather than re-spelling it here.
- **The hint names the Settings control, not the TUI's verb.** The Settings
  section's own buttons are `Connect` / `Disconnect` / `Reload` /
  `Grant account access` (`mcp-management-section.tsx:447-478`), and `auth-required` is an OAuth-grant
  condition (`mcp/manager.py:1330-1341`, `_block_on_auth` at `:3051-3066`), which
  a stdio server cannot be in — so "grant this server account access" is exact
  for the state that carries it. `disconnected` is transport-level and either
  control applies, so the hint says reconnect.
- **The section has no cap and no `+N more`.** The roster's disclosure exists
  because children are an unbounded stream; servers are the finite set the user
  configured, so every row is rendered and § 3.4's "rendered slice" for this
  ledger is the whole set. A cap here would put a problem behind a control.
- **The section's tally** follows its neighbours' grammar (label left, quiet
  right-aligned tally): `{connected} of {total} connected`, and `·
  {problems} need attention` when there is one. Those are two different facts
  rather than one restated — `connecting` is neither connected nor a problem, so
  the healthy count does not imply the problem count — which is why § 6.2's
  de-duplication argument does not apply here.
- **The cold state is the SECTION's, not the row's.** The route's cold branch
  hard-codes `"status": "cold"` for every configured server
  (`desktop_lifecycle.py:127`), so a per-row status column would print one jargon
  word N times, and the tally would read `0 of 3 connected` — which claims three
  servers are down when in truth none was asked to be up. Instead the section
  renders **one line in place of its tally** and the rows render name and
  qualifier only: *`No session is running — server status cannot be checked.`*
  The cold section still shows WHICH servers are configured, which is worth
  having with no runtime attached; it lights no dot, because nothing is wrong.

### 7.3 What counts as a problem — the refusal, stated as a negative

The dot's rules are § 3.4's. This section fixes only which server states feed
that ledger:

- `connected` — not a problem.
- `connecting` — **not** a problem. The startup gate leaves slow OAuth servers
  here on every launch (`mcp_status.py:56-60`), and lighting for it would make a
  red lamp the normal boot (`tui/app.py:14650-14658`). A queued child is not a
  failed one, and the same ladder applies.
- `cold` — not a problem: no runtime attached is a fact about the session.
- **everything else — including any word this renderer has not been taught.**

The predicate is written as a **negative** — "neither `connected` nor
`connecting` nor `cold`" — and the reason is the TUI band's own recorded bug, on
the same data. `tui/app.py:8498-8504`: *"`== "failed"` only ever matched the
projection's own placeholder, which `_mcp_state` overwrites with the manager's
live status whenever a manager is present — so an auth-blocked server projected
as `auth-required` and this band stayed calm while the owner's went red"*; and
`_mcp_status`'s docstring (`:14650`) states the rule the fix adopted:
*"Every TERMINAL non-connected state is a failure, named as a negative rather
than as equality with "disconnected": the status vocabulary grew
`auth-required`, and an equality test on the old string silently stops counting a
server whose grant expired — exactly the case the band exists to surface."* A
two-word positive list has that same defect one vocabulary change later, and the
operator's complaint is a *missed* problem: a spurious dot costs one glance and
self-clears the moment the panel is opened, while a missed one is invisible
forever.

**But the unknown word is quiet, and still takes attention.** It renders with the
unknown mark and the quietest ink — the renderer must not claim a `danger`
failure it cannot name — and it *does* light the dot and *does* appear in the
trigger's label. That is not a contradiction: the two refusals in this codebase
agree on the thing that matters, which is never to claim the GOOD state.
`foldStatus` refuses to call an unrecognised child status `done`
(`run-detail-model.ts:460-476`: *"An unrecognised word is never `done`"*) — the
loud/quiet axis there is settled-versus-open, not good-versus-bad — and the
negative predicate here refuses to call an unrecognised server state
`connected`. Both err toward "you have not been told the truth" rather than
toward a confident green.

**The ledger needs a re-arm rule, and this is new.** The acknowledgement set is
keyed by **server name**, which — unlike a job id — recurs: a server that is
acknowledged while `auth-required`, then recovers, then breaks again would stay
silent forever under `accumulateSeen`'s union-never-subtract rule
(`run-detail-model.ts:869-877`). So the MCP ledger prunes to what is still a
problem: `seen' = seen ∩ problems(rows)`. A healed server leaves the set and can
announce itself again; a still-broken, already-acknowledged one stays quiet. The
child ledger is immune to this by construction (a child's id is one episode), so
the rule is the MCP ledger's own and is pinned in the model test (§ 11.2).

### 7.4 Freshness — the real design question

The dot must be right **while the panel is closed**, or the indication the
operator asked for does not exist. Three facts decide how:

1. **MCP status changes with no frontend frame.** A grant expires, a server
   process dies, a reconnect lands — none of those is a job, a to-do or a
   message.
2. **The canonical state already carries a coarse projection of it, and the
   backend already publishes it on most transitions.** `CanonicalFrontendState.
   mcp_servers` (`desktop-session-contract.ts:211-216`) is built by `_mcp_state`
   (`frontend_state.py:4370-4388`) into `FrontendSessionState.mcp_servers`
   (`:1738-1739`), and `refresh_frontend_state` runs when MCP discovery settles
   (`session_factory.py:2241` in `_fire_mcp_sink`, `:2396` in
   `_on_startup_settled`), when the tool inventory changes — reconnects and
   `tools/list_changed` (`:2479`), and the late-success settle arm at `mcp/manager.py:2559-2574`
   — and on attach (`:2501`). `mutate` ships a field only when its value actually
   changed (`frontend_state.py:3213-3220`), so a change to `mcp_servers` is a
   real delta frame and not a heartbeat.
3. **The projection cannot render this section's row, and it lags the case the
   operator reported.** `_mcp_state` sets `name`, `status` and `error` only
   (`:4385-4387`) — `McpServerState.tool_count` exists (`:916-919`) and nothing
   ever writes it, and there is no `owned_scope` or `source`, so a row built from
   it would have no qualifier at all. And a transport that closes mid-session is
   observed inside the manager (`mcp/manager.py:2953-2980`, `_handle_disconnect`)
   while the canonical refresh happens at the next turn boundary
   (`frontend_state.py:3896-3902`) — so on an idle session the canonical value
   can be minutes stale, which is exactly the "a server died while nothing was
   happening" case this surface exists for.

**Therefore: `mcp.list` is the one rendering source, polled; the canonical
projection is a change signal only.**

- **Cadence: 15 s while the panel is closed, 5 s while it is open**, and never
  while nobody is watching. The closed cadence is the one that pays for the
  indication to exist at all, and it is not arbitrary: the backend's own
  recover-a-grant clock is 60 s (`mcp/manager.py:207`,
  `AUTH_REVALIDATE_INTERVAL_S = 60.0`, whose comment explains that a minute of
  latency is imperceptible against a token's lifetime), so 15 s is already four
  times finer than the backend's own knowledge in that direction, and it is the
  user-visible latency for the drop direction. The open cadence is faster because
  the reader is *looking* at the rows, and 5 s is the app's existing status-poll
  interval (`use-connectivity-status.ts:24-46`, whose default is 5000 ms).
- **The accelerator, and why it is not a second source.** When the canonical
  `mcp_servers` value changes, invalidate the query once, so a *published*
  transition (a startup settle, a reconnect, an auth block discovered at boot)
  reaches the panel in about a frame instead of up to 15 s. The canonical value
  is **never rendered** — it is only a change signal — and a signal has no paint,
  so it cannot disagree on screen with what the rows say. This is the distinction
  that separates it from the rejected "two readings of one field" option in
  § 7.6: two *rendered* sources would need a merge rule, both would be
  untimestamped, and whichever rule was chosen would eventually let the staler
  reading win. React Query coalesces concurrent refetches of one key, so a burst
  of canonical changes costs one request.
- **Every condition that stops it:**
  1. no session id → the query is disabled;
  2. the `mcp` capability absent, or the pairing unavailable → disabled
     (`desktop-hooks.ts:73-80` returns false for both);
  3. **no canonical frontend** → disabled. The trigger itself is absent on the
     legacy path (§ 3.3), so there is no dot for a reading to be right about and
     the poll would be pure waste;
  4. the document hidden, or the window not focused → the interval is off
     (`document.visibilityState` and `hasFocus` are different questions: the
     first is a backgrounded window, the second a visible but inactive one). A
     return to the window refetches immediately, so the first frame after the
     user comes back is current rather than 15 s stale — which is the whole
     reason a stop is affordable.
- **Two of the stop conditions the brief lists are wrong, and this is why.**
  Both are argued rather than ignored, because each looks reasonable until the
  thing it would silence is named.
  *"Panel closed"* would delete the operator's ask: the dot exists for the
  closed panel, and a cadence that stops when the panel closes reports the
  problem only to someone already looking at MCP servers. Closed SLOWS the poll
  (15 s); it does not stop it. *"Cold backend"* must not stop it either, for two
  reasons: (a) the renderer's `cold` flag is written only from a snapshot
  (`use-canonical-session.ts:63`, `:220`, `:478`) and **no delta clears it** —
  the cold→warm attach arrives as an epoch-rollover `frontend.update`
  (`:507-520`), which adopts the `frontend` changes and leaves the sibling `cold`
  as it was — so keying a cadence on it would freeze a panel whose session has
  since come up; and (b) the cold path is the cheap branch (below), so not
  stopping costs a config read and stopping wrongly costs the section its
  freshness. The cold SESSION is rendered honestly (§ 7.2) rather than polled
  differently.
- **The cost, stated, because it is real.** One tick is (a) an IPC hop from the
  renderer through the main process (`main/desktop-transport.ts:14-58`), (b) an
  HTTP `GET` with the desktop bearer, (c) a bridge acquisition from the session
  pool (`server/utils/desktop_sessions.py:803-838`; the bridge is cached and
  already held by the open chat's own stream, so normally this is a lock, a
  counter and a touch — but when nothing else holds it, `acquire` builds a cold
  facade and `release` tears it down again, `:107-159`, against a pool cap of
  `BRIDGE_COUNT = 64` at `:52`), and (d) on the runtime's loop, `MCPDesktop.
  snapshot()`: `load_all_mcp_configs(cwd)` — up to eight config files including
  `~/.claude.json` (`mcp/config.py:329-420`) — plus one `get_server_tools` per
  server, a dict copy and a sort (`mcp/manager.py:1318-1325`). There is **no MCP
  protocol traffic** in it and it never binds or wakes a runtime: the GET does
  not call `bind_runtime()` (`desktop_lifecycle.py:137-139`) where the POST does
  (`:147`).
  That is four requests a minute per watched session with the panel closed, and
  twelve with it open. Against § 10.4's child pulse — 1 Hz, and only while a
  reader is open on a live child — this is deliberately the slower instrument,
  and it is bounded for the opposite reason: the pulse is driven by work the user
  started, while this runs when nothing else is happening, which is why it is the
  one that needs an interval and a window gate rather than a signal.
  **One correction to the in-flight file's own docstring**, because the load
  argument depends on it: `use-mcp-servers.ts` says *"no bridge is acquired to
  answer it"* — a bridge IS acquired (`desktop_lifecycle.py:108`), which is why
  the cold-acquire case above is stated rather than assumed away.
- **What this indication can and cannot claim.** It reports what the RUNTIME
  knows, not what the provider thinks. `auth-required` appears after an auth
  attempt failed — `_block_on_auth` is "called from every arm that gives up over
  authorization" (`mcp/manager.py:3051-3066`) — which is usually session startup,
  and that is exactly why the accelerator wins the race for the common case; a
  socket closed behind our back is observed when the manager's own watcher fires
  (`:2948-2952`). So the dot means "the runtime knows this server is unusable",
  and no copy in § 7.2 may claim more than that.

### 7.5 The implementation checklist, and where the working tree stands

The UI half is in flight on `feat/session-sidebar-panel` and is being written
CONCURRENTLY with this document, so its citations are the working tree and not a
ref (preamble), and this subsection is a CHECKLIST rather than a description:
**the spec is what precedes it; § 7.5 only says where the branch stands against
that spec.** An item already done is a tick, not a requirement, and a done item
the branch later un-does is still a requirement. It already implements the
section at `run-detail-mcp.tsx`, with the derivation in `run-detail-model.ts`
(`McpServerRow`, `deriveMcpServers`, `unseenMcpProblems`) and the read in
`use-mcp-servers.ts`.

Already satisfied and hereby ratified — no change wanted: presence and order; the
mark/word encoding with `aria-hidden` marks and colour spent only on failure; no
hover ground and no control on the row; a hint-not-control remedy; a scope
qualifier; name-only rows for a nameless payload row; sorting by name so the list
does not reorder across refetches; one query sharing the Settings cache key so a
screen with both surfaces open has one answer; and stop conditions 1-4 of § 7.4.

The requirements, in the order that matters:

1. **The problem predicate is a negative, not the two-word list**
   (`run-detail-model.ts:1186-1189`), and an unrecognised word takes attention
   (§ 7.3). This is the one item here that changes a user-visible behaviour: it is
   what stops a future terminal status from being invisible.
2. **The acknowledgement re-arm rule** (`seen' = seen ∩ problems`): today
   `unseenMcpProblems` unions through `accumulateSeen` and never subtracts, so an
   acknowledged server is silent forever (§ 7.3).
3. **The trigger's label gains the MCP clause**, and the pane reports
   `listOnScreen`/`readerChildId` so a reader's view stops acknowledging rows
   nobody can see (§ 3.4).
4. **The cold state is the section's**, not a per-row `cold` word
   (`run-detail-mcp.tsx:46`, `:58`) with a `0 of N connected` tally
   (`:80-85`) (§ 7.2).
5. **The scope moves to line one**; line two is the hint only
   (`run-detail-mcp.tsx:155-170`) (§ 7.2).
6. **The status word is the wire's verbatim**, including `auth-required`, not the
   working tree's `sign-in required` spelling (`run-detail-mcp.tsx:68-69`)
   (§ 7.2).
7. **The model test covers the derivation and these rules** (§ 11.2) — the four
   words, the cold payload, a nameless row, a missing status, the negative
   predicate with an unrecognised word taking attention, the hint on the two
   known problems only, the verbatim word, and the re-arm across a
   heal-and-break-again.
8. **The hook's docstring is corrected** on the bridge (`use-mcp-servers.ts:44-47`)
   and its `enabled` gains stop condition 3, which today requires only a session
   id and the capability (`:94-95`) (§ 7.4).

### 7.6 Rejected alternatives

| option | why it lost |
|---|---|
| Render `frontend.mcp_servers` (the canonical projection) as the rows | It is free and push-based, and it cannot render the row: no `tool_count`, no `owned_scope`/`source` (`frontend_state.py:4385-4387`), and no error for a server that dropped after boot — `mcp_status.py:47-49` is explicit that live state "is read from the manager, which is the only thing that actually knows it". It also cannot be MERGED with the route's answer: both are untimestamped readings of one field, so any merge rule eventually lets the staler of the two win. |
| Poll only while the panel is open | Deletes the operator's ask (§ 7.4) — the dot exists for the closed panel. |
| Poll only while a turn is running | A dead server is precisely what you want to learn while idle, and the runtime is attached between turns anyway; this makes the panel silent in the state it exists for. |
| A new push channel (a frame, or a field delta at every manager transition) | A backend change to close a gap that is in the PUBLISH, not the observation: the manager already observes a drop (`mcp/manager.py:2953-2980`). Deferred rather than refused (§ 13), because the poll is what makes it unnecessary. |
| A `reauth` / `connect` control on the row | The panel is a view (§ 5.6's rule for the reader, applied to the whole surface). A second place to press those buttons is a second place to get the confirmation, the scope and the error copy wrong, and the row names the fix in words instead. |
| A distinct dot or a second mark per ledger | One 8px dot cannot say which fact it means, and two marks on one 32px control is a decoration nobody can read (§ 3.4). |
| Re-spelling the wire word for humans (`sign-in required`) | One state would then have two spellings across two surfaces of the same app, which is the divergence this section exists to avoid; the hint line carries the human meaning instead (§ 7.2). |
| A per-row `cold` word | One jargon word repeated N times, plus a tally claiming `0 of N connected` — three servers reported down when none was asked to be up (§ 7.2). |
| Folding an unrecognised word to a quiet, dotless row | The operator's failure is a missed problem; a spurious dot costs one glance and self-clears when the panel is opened, and the negative predicate is the one this codebase already adopted for this exact data (§ 7.3). |
| A row cap or a `+N more` disclosure | Refused by the shape of the data: servers are the finite set the user configured, not an unbounded stream of children, so a cap would hide a problem behind a control (§ 3.4). |

---

## 8. Layout and geometry

Roles only; the values below are the ones the two PRs must agree on, and the
exact steps inside a stated range are the implementation's to choose.

| | Value | Why |
|---|---|---|
| Panel width | default 420px, min 320px, max 640px; `runPanelWidth` in `ui-preferences-store`, persisted | The canvas's own slot is 800/400/1200 (`ui-preferences-store.ts:167`, `chat-content.tsx:446-460`) and a *document* pane deserves 800; a roster plus a prose transcript does not, and 420 is wide enough for the roster's fixed segments (the popover's own 384px floor, `docs/run-details.md` § 5, plus the row's hover ground and the wider activity line). A persistent pane that cannot be widened would be the popover with more chrome, so it is resizable. |
| Tally budget | derived from the pane's ACTUAL width — `tallyBudget(paneWidth)` (`run-detail-model.ts`), the width minus a fixed chrome allowance over the mono advance — never a constant | A budget pinned to the 420px default was wrong at the pane's own FLOOR, and the failure was visible rather than theoretical: at 320px the subagents tally's 47 characters did not fit, the model shed nothing (it believed it had room), and the CSS `truncate` cut the values mid-word (`… 1 interr…`, review round 1 D1-2). Shedding is only a guarantee if the budget is the width the text is actually laid into, and `§ 8`'s own floor is one of the widths the pane can take. A budget that is not a finite positive number falls back to the default rather than propagating `NaN`, which would disable shedding silently. |
| Resize | `ResizableDivider`, `side="left"`, `minWidth={320}`, `maxWidth={640}`, `onDoubleClick` restores 420 | The canvas's own control, including its keyboard separator behaviour (`resizable-divider.tsx:220-256`). **Requires** the `aria-label` to be parameterised (§ 3.2). |
| Panel root | `<section aria-label="Run details">`, `bg-surface`, `h-full overflow-hidden border-l border-hairline` | The canvas's wrapper is exactly this (`chat-content.tsx:461-468`); the ground follows the app's own depth model (rail `sunken` → list panel `surface` → working surface `canvas`), which `chat-content.tsx:299-350` states. |
| Chrome bar | 40px, `bg-sunken`, full width | The canvas's bar (`canvas/index.tsx:380-425`), same height, same ground, so the two panes are visibly two modes of one slot. |
| Roster area | `bg-surface`, rows hover `bg-elevated`, scroll region = the rest of the panel | A list panel's ground; `elevated` is the hovered-row role (`branding.md` § 2). |
| Reader body | `bg-canvas` | The main transcript's ground (`chat-content.tsx:349`), so the child's conversation resolves against the same plane as the parent's — the "reads like the parent transcript" requirement is partly a *ground* requirement. |
| Between sections | one `hairline` rule | Unchanged from `docs/run-details.md` § 5. |
| Row heights | unchanged: subagent 32/48/64px, to-do 24/40px; **MCP 32px, 48px on a problem row** | Carried over with their line-height pins; the roster row gains only a hover ground, not a height. The MCP row is the roster's compact height, and takes the to-do blocked row's second line only for a remedy (§ 7.2) — so a healthy server costs one line and a broken one costs two. |
| MCP row segments | mark 16px (the roster's own box), name truncating with an ellipsis, then the status word, tool count and scope as non-truncating qualifiers | The roster's segment grammar, so the two lists read as one panel. The name is the only segment allowed to shrink: the numbers rule of § 9 forbids truncating a value mid-figure, and a name has a `title` to state it whole. |
| MCP section | last in the panel's scroll region; its own section header with the tally; no separate scroll container, no hover ground, no cap | § 7.2's fixed order; the panel's single scroll region (the `Scroll owner` row below) is the roster's, so a section with its own container would put two scrollbars in one pane. |
| Scroll owner | the roster area in the roster view; the transcript in the reader view — never both | Two nested scroll containers is the defect the old doc's `min(60vh, 480px)` ceiling existed to avoid; with a full-height pane the roster scrolls in the pane, and the cap that used to be a popover artefact is gone. |
| Narrow width | at the window floor (800px, `window-mode.ts:47`), rail expanded (220px, `sidebar-navigation.tsx:95`) leaves ~580px: the panel takes its 320px floor and the chat column sits near its 220px floor (`chat-content.tsx:302-320`), so `isSmallView` is on (<550px, `chat-content.tsx:210-224`). No overflow: only one pane is ever open. With the rail collapsed (48px) the column keeps ~430px. | Stated because "a pane and a column" has a floor, and the floor is what the two widths must respect. The panel does **not** auto-hide at narrow widths — the operator asked for persistence, and a pane that disappears below a breakpoint is the current defect in a new costume. |
| Ground step | the panel's `surface` against the column's `canvas` | The step `chat-content.tsx:299-350` establishes between list panel and working surface, unchanged. |

---

## 9. Keyboard, focus, motion, accessibility

- The trigger is a real toggle in the header's tab order with the app's `outline`
  focus ring (`styles/index.css:345-370`, and the reason it must be `outline`
  rather than `box-shadow` is recorded there: the header's `overflow` clips it).
- **Focus does not move into the pane when it opens.** Unlike the popover — which
  had to *seize* focus because it was a transient overlay, and had to hand-roll a
  Tab walk out of Radix's portal (`run-details-trigger.tsx:70-141`) — a pane is
  part of the page. Opening it leaves focus on the trigger; the reader, when
  opened from a row, moves focus into the reader's body (so `Escape` and the
  scroll keys work there) and returns it to that row on the way back.
- Escape is bound on the panel container and stops propagation (§ 3.5).
- **Motion**: the only animation is the running child's spinner, unchanged
  (`run-detail-subagents.tsx`'s existing icon; `prefers-reduced-motion` is capped
  to 0.01 ms globally by `styles/index.css`, and the spinner's *shape* already
  carries the state). Nothing slides the pane in: the canvas does not animate its
  own entrance either (`border-l` + pinned width, no transition on mount), and a
  panel that animates would be measuring its own arrival rather than its content.
- **Accessibility**: the section is a named `region` (`aria-label="Run details"`);
  the roster row is a control with an accessible name of *label + state word +
  the numbers it prints* (the row already carries `sr-only` state text,
  `run-detail-subagents.tsx:266`); the breadcrumb is a `<nav>`; the pressed
  trigger carries `aria-pressed`; the reader's body is not `aria-live` (§ 5.3);
  the resize handle announces its own value and needs its own label (§ 3.2).
- **The MCP rows are not controls**: no tab stop, no `Enter`, and no hover
  ground (§ 7.2), because the action they need is in Settings. Each row still
  carries the roster's `sr-only` state clause (`run-detail-subagents.tsx:266`) so
  a screen reader hears the name and the state word rather than the mark, which
  is `aria-hidden` decoration; the hint line is real text and is read with the
  row.
- **The trigger's name must carry the dot's reason** (§ 3.4): the tooltip and
  `aria-label` gain the MCP clause, so a lit dot for a dropped server is
  announced rather than implied by a mark nobody can see.
- Long labels truncate with an ellipsis; the numbers run never truncates
  mid-value (carried over, `docs/run-details.md` § 6.3).
- Reduced motion, long-label and high-contrast states are in the frame set (§ 11).

---

## 10. The wire — the frozen interface

Everything in this section is what the two work items in § 11 must agree on. It
is stated as an interface, not as code.

**The MCP surface adds nothing to this section** (`§ 7`): its op (`mcp.list`),
its route and its capability (`"mcp": 1`) all ship, so PR 2 reads a document
that PR 1 does not touch. The asymmetry is worth stating because the two
surfaces look alike — both are "read one thing about this session's capabilities"
— and only the child reader needs a route, because the child's transcript is a
file nothing has ever exposed on the desktop wire.

### 10.1 The backend route (one new read-only family)

```
GET /v1/desktop/sessions/{session_id}/children/{child_id}/transcript
    ?before_id=<entry id, max 128 chars>
    &limit=<int 1..500, default 100>

GET /v1/desktop/sessions/{session_id}/children/{child_id}/attachments/{digest}
```

- Both ids are `^[a-f0-9]{12}$` — the same `SESSION_ID` the whole desktop surface
  already validates on (`server/utils/desktop_sessions.py:48`).
- The transcript response is the parent's `/history` envelope plus one field:

```json
{ "status": 200, "message": "...", "result": {
    "entries": [ { "id": "...", "ts": 0.0, "type": "message", "payload": {} } ],
    "has_more": false,
    "cursor_missing": false,
    "state": "ready" } }
```

- **Source: the child's RAW transcript entries, never `peek`'s rendered steps.**
  `hub op='peek'` is the wrong reader: it clamps to `PEEK_DEFAULT_STEPS = 5` /
  `PEEK_MAX_STEPS = 50` with `PEEK_STEP_CHARS = 600` per step
  (`harness/comms.py:199-212`) because its budget exists for a *parent agent's
  context*, and `_render_transcript_steps` (`:2412-2430`) drops
  compaction/bookkeeping rows and flattens each message into a numbered
  `PeekStep` string pair (`_render_message_step`, `:2432`). The reader must show
  the child's conversation properly, so the route reads
  `read_transcript_page(child_dir, before_id=..., limit=...)`
  (`session/transcript.py:361-428`) and returns the rows verbatim in the parent's
  envelope — which is what lets § 5.1 render them through the parent's reducer.
- `state` is the one **derived** field, and it is needed: the two absences are
  different facts and only the filesystem can tell them apart. `pending` = the
  directory exists but `transcript.jsonl` does not (the child has not reached its
  first append; `Transcript` no longer creates the file eagerly — the note at
  `subagent_view.py:2046-2075`, mirrored by `_reset_history`'s
  `_history_absent_final`, `:1990-2015`); `gone` = the directory itself is
  missing, so the absence is final; `ready` = the file exists (`200` with an
  empty `entries` is a legal `ready`). The TUI distinguishes exactly these two
  and re-probes only the second (`_reconsider_missing_history`, `:2046-2085`), and
  a reader that conflates them either says "gone" about a child that has not
  written yet or promises a transcript that will never appear.
- Nothing else is derived and nothing else is returned: the header's facts come
  from the roster row (§ 4), so the route carries no label, status, cost or
  prompt.
- **Containment is part of the route, not the caller's to assert.** The child id
  is validated as an id (never a path — the renderer holds an absolute
  `session_dir` on the wire and must never be able to submit it), the child
  directory must be under `config_dir()/sessions/`, its origin marker must be
  `ORIGIN_SUBAGENT` (`resume.py:419-446`, `:456-478`; the exact complement of
  `is_user_session`, so this route can never read a user conversation or a fork),
  and the parent must actually name the child:
  - the parent directory must be a user session (`is_user_session`,
    `resume.py:1013-1032`), and
  - the parent's newest `subagent_roster` custom entry must carry a record whose
    `session_dir` is this child (`session/session.py:210`, `:11460-11488`; the
    records list is the whole graph, so a nested grandchild is named too,
    `harness/comms.py:970-1010`). It is matched **by directory, not by
    `session_id`**: the persisted record has no `session_id` field at all
    (`SubagentComms.snapshot()`, review round 1 against the backend, PR #1053),
    and the child's own `session_id` — the id this route is addressed with — is
    `session_dir.name` or the live child's own id (`harness/comms.py:752-753`).
    Precedent for treating a follower's roster —
    not the runtime's — as the ownership record: the mobile daemon reads exactly
    this entry to rebuild child routes (`mobile/daemon.py:657-660`).
  If the parent's runtime is already attached, its live comms graph may confirm
  instead of the persisted roster (the snapshot coalesces, so a child launched
  inside the last window may not be in it yet); **a bridge is never acquired just
  to answer this route**, and the route reads no runtime. Failure is `404` with a
  retryable `child_not_found` code for the "not in the snapshot yet" case.
- Error cases, and what each means to the reader:

| case | response | reader |
|---|---|---|
| unknown / non-subagent / uncontained child id | `404` | the row was not openable; the panel keeps the roster and says so in one line |
| parent unknown or not a user session | `404` | ditto |
| no transcript file yet | `200`, `state: "pending"`, empty `entries` | "This subagent has not written anything yet." + retry on the next pulse |
| directory gone | `200`, `state: "gone"`, empty `entries` | "This subagent's transcript is no longer on disk." (final) |
| cursor vanished (compaction replaced the file) | `200`, `cursor_missing: true` | re-read the tail, dedupe by id |
| no bearer / wrong origin | `401` / `403` (`require_desktop`, `server/desktop.py:28-64`) | the capability gate means this should not be reachable (§ 10.5) |
| oversize `limit` | `422` | a bug in this app, not a user state |

- The attachment route mirrors the parent's
  (`server/routes/desktop_sessions.py:341-352`): raw bytes, the digest's own mime
  type declared as the response class, the same containment proof. **Deliberately
  left to implementation:** whether both attachment paths land in the same PR;
  the constraint if only the transcript ships is in § 5.1.

### 10.2 The capability

- `GET /v1/capabilities` gains one entry in its `features` map
  (`server/routes/capabilities.py:23-39`): `"subagent_transcript": 1`.
- The renderer's `DesktopFeature` union gains the same name
  (`renderer/src/shared/api/local-operator/desktop-hooks.ts:54-64`) and the panel
  gates on `desktopFeatureEnabled(capabilities.data, "subagent_transcript", 1)`
  (`:73-80`) — the same call shape the checks in § 11.3 exercise.

### 10.3 Renderer operations

| layer | file | what changes |
|---|---|---|
| request schema | `src/shared/desktop-contract.ts:137-664` (`desktopRequestSchema`) | `{ op: "subagents.transcript", sessionId, childId, beforeId?, limit? }` |
| path mapping | same file, `desktopEndpoint` (`:1038-1420`), beside the `sessions.history` case (`:1108-1117`) | maps to the transcript route, `GET` |
| transport | `src/main/desktop-transport.ts:12-16` | nothing: the op is validated and budgeted generically; it is a control op (fixed-shape query, no body) |
| media relay | `src/main/desktop-media.ts:72-103` | `{ op: "subagents.attachment", sessionId, childId, digest }` |
| response types | `src/shared/desktop-session-contract.ts:291-300` | reuse `DesktopHistoryPage` and add the `state` field to the child-page type |
| subscription | `src/renderer/src/shared/hooks/use-canonical-session.ts:463-471` | the per-job pulse (§ 5.3) |

One renderer rule belongs to this section because it is about the WIRE's shapes
rather than the pane's: **a roster row with no `childSessionId` is not openable.**
`session_id` is nullable by design and arrives null on a cold conversation (§ 10.1
above), so the row renders as a plain state row rather than a control
(`childOpenable` in `run-detail-model.ts`, pinned by the model test), and a reader
reached another way — the breadcrumb, the sibling stepper — states the fact in one
honest terminal line instead of sitting on `Loading…` forever (review round 1,
R1-6; the backend's own fix for the restored row rides PR #1053).

### 10.4 Live updates, and the load

Covered in § 5.3. The one sentence the two coders must not lose: the pulse is the
mechanism, the 5 s poll is a safety net for a degraded stream, and the read is a
whole-file scan (off-loop) — so the cadence is capped at 1 Hz and stops when the
child settles or the reader closes.

### 10.5 An OLD backend (the honest degraded state)

Per `docs/desktop-controls.md:29-32`: a new feature control negotiates
`GET /v1/capabilities` before enabling itself, a missing capability requires a
visible backend update/setup action, and there is no unauthenticated fallback.

- Backend without `subagent_transcript`: the roster still renders (it is
  `frontend.jobs`, which predates this change), the to-dos still render, and the
  child row renders **without** an open affordance — no hover ground, no pointer
  cursor, the same "not clickable yet" state `docs/run-details.md` § 4.3
  describes, because a lit row that opens nothing is worse than a quiet one.
- The panel's chrome carries one quiet line naming the situation and offering the
  same update/setup action the app's other gated surfaces offer
  (`features/settings/components/backend-settings-section.tsx:63-190` is the
  in-repo pattern for "capability absent → visible action"), not a hidden failure.
- The trigger, the swap, the to-dos and the failure dot are **not** capabilities:
  they ship with the renderer and work against any backend the app can talk to.
- **MCP absent is different from MCP broken, and the section must not conflate
  them.** A backend without `"mcp": 1` — or without the desktop pairing — renders
  **no MCP section, no dot, and issues no `mcp.list` request**
  (`desktop-hooks.ts:73-80` is false for both), and it does **not** grow a second
  degraded line: the one quiet line this section already fixes names "this
  backend is older than the app", and a sentence per absent capability is the
  chrome that rule refuses. Inside a *supported* backend, a read that FAILS is a
  stale state and never an empty one: the query keeps its last good rows and the
  dot keeps its last known answer, so an unreadable list cannot render as "no
  servers configured" — the same refusal as the TUI band's `discovery_failed`,
  where hiding the segment for an unreadable config "would report a broken setup
  as an absent feature" (`status_line.py:724-729`).
- No token URL, no renderer-side HTTP request, no `session_dir` from the renderer
  — the route is the only door, and it takes ids.

### 10.6 What is left to the implementation

Deliberately not fixed here: the exact widths inside § 8's bounds; all copy except
the quotes this document fixes in place; whether the reader's scroll position is
restored when returning from a nested child; the reducer-level memoisation of the
pulse; whether the attachment path ships in the same backend PR; and the error
copy's wording. What is fixed is § 10.1's route shape, § 10.2's capability name and
§ 10.3's op names — those are the contract the two PRs are built against.

---

## 11. Work split and evidence plan

### 11.1 PR 1 — backend (`~/local-operator`)

Contents:

- the route family of § 10.1 (transcript; attachment if it ships here), the
  containment proof, and the `state` derivation;
- the `subagent_transcript: 1` capability entry;
- tests at the level this repo requires: unit coverage of the containment proof
  (the three refusals: not an id, not subagent origin, not named by the parent),
  the `pending` / `gone` / `ready` tri-state, the paging cursors and
  `cursor_missing`, and a real HTTP test in the style of
  `tests/unit/server` (the desktop routes' own evidence precedent) plus the
  `tests/e2e` assembled-application suite where the repo's conventions put it;
- no version bump (the release rules are the harness's, not this document's).

### 11.2 PR 2 — UI (`local-operator-ui`, this worktree)

Contents:

- the pane: store fields and the exclusivity setters, the divider parameter, the
  panel shell, and the swap in `chat-content.tsx`;
- the trigger rewrite (always-on toggle, pressed state, dot rule) and the
  deletion of the popover, its portal focus walk and the two acknowledgement
  instants — with `run-detail-model.ts`'s surviving rules intact;
- the roster's clickable row, its hover ground, the `+N more` disclosure, and the
  three new `SubagentRow` fields;
- the child reader (§ 5) including the reader's loader, the pulse, the brief
  fold and the launch-turn reconciliation;
- the to-do fixes of § 6.2 (the implicit-phase fold and the count removal), with
  `scripts/run-detail-model.test.mjs` extended for both and for the new
  `acknowledgeWhileOpen`;
- **the MCP section (§ 7) — renderer only**, on the shipped `mcp.list` op; the
  requirements § 7.5 lists are what remains, and
  `scripts/run-detail-model.test.mjs` gains the MCP cases with them: the
  derivation (the four words, the cold payload, a nameless row, a missing
  status), the negative problem predicate including an unrecognised word taking
  attention, the hint only on the two known problems, the verbatim word, and the
  re-arm rule (`seen' = seen ∩ problems`) exercised across a heal-and-break
  again, which is the case a name-keyed ledger gets wrong;
- the capability gate and the old-backend degraded state (§ 10.5), including the
  MCP-absent case (no section, no dot, no request);
- **no `package.json` version bump** — a version change inside a feature PR is a
  finding in this repo's own review rules.

### 11.3 Stories and rendered evidence

Rendered frames are the evidence; a green test is not. Every state below must
appear as a frame pair where the frame has a predecessor (before/after), captured
through `scripts/capture-evidence.mjs` into `docs/evidence/<story-title-slug>/<story>/<theme>.webp`
— the retired set's own directory is `docs/evidence/chat-run-details/` (21 files, both
brand themes), so the new set lands beside a `chat-run-panel` story title — in both
brand themes (`localOperatorDark`, `localOperatorLight`) at the minimum,
per `branding.md` § 9's checklist.

| story | state it exists to prove |
|---|---|
| `trigger-idle` | the icon is on screen with **no** work in flight and nothing open (the old design's "no button" state, inverted) |
| `panel-empty` | the panel open with nothing to show: the empty state, no skeleton, no placeholder rows |
| `roster-only` / `todos-only` | one section, no empty heading (`docs/run-details.md` § 6.3, carried over) |
| `both-in-flight` | both sections, the rule between them, the roster's live clock |
| `roster-capped-expanded` | `+N more` before and after the disclosure (before/after pair) |
| `todos-phased` | phases as headers, items indented, done struck, dropped tagged, blocked with its reason line — and **no per-phase counts** |
| `todos-implicit-phase` | the § 6.2 fix: an implicit phase rendered headerless beside a named one (the defect, then the fix) |
| `swap-canvas-open` | the canvas open with the run trigger still visible and pressed-state-free; then the run panel open with the canvas closed (before/after) |
| `swap-run-open` | the mirror: the flow a click makes, both directions |
| `reader-live` | a child's reader open on a **running** child (see below) |
| `reader-settled` | the same child settled: outcome block, settled clock, no pulse |
| `reader-failed` | the verbatim exception in the outcome block, `danger` on the header icon only |
| `reader-pending` / `reader-gone` | § 10.1's two absences, with their separate copy |
| `reader-nested` | breadcrumb path + back affordance with two levels |
| `reader-brief` | the folded brief and its expander, in the one state that renders it: a child whose transcript does NOT already carry the instruction (`reader-resumed` is the state where the brief stands down) |
| `reader-unaddressed` | § 10.3's third answer: a reader whose row has no child id — the honest terminal line, with a way out |
| `mcp-dot-ack-acknowledged` / `mcp-dot-ack` | one story each for the two halves of the dot's discipline, because a single frame cannot hold a sequence: closed with a problem (dot on) → the list shown (dot off, acknowledged) → the server heals while the list is shown → the panel closes → it breaks again shut (dot on AGAIN, the re-arm). The heal must happen while the list is ON SCREEN: pruning is part of showing the list, and a sequence that healed with the panel shut would leave the server acknowledged forever and could not be photographed at all. |
| `reader-resumed` | a RESUMED child's reader: the `subagent-launch:<job_id>` row reconciled to its concise prompt, with no role/team/system preamble above it — § 12's risk 3 has no other frame |
| `mcp-all-connected` | the section on a session whose servers are all up: one row each with the word, the tool count and the scope qualifier, the `{connected} of {total} connected` tally, and **no** dot on the trigger |
| `mcp-auth-required` | one server `auth-required`: the `danger` mark, the wire's own word, and its remedy line — plus the trigger's dot and its clause (before/after: closed with the dot, then open on the list with the dot cleared and the row visible) |
| `mcp-disconnected` | the same encoding for the transport state, with its own copy — the two states must be distinguishable side by side, which is the confusion the operator reported |
| `mcp-cold` | the cold payload: the section's one line in place of its tally, rows with no status word, no tool count and no dot |
| `mcp-unknown-status` | a status word this renderer was not taught: rendered verbatim in the quiet ink with the unknown mark, **no** hint, and the dot ON (§ 7.3) — the refusal is "never claim the good state" |
| `narrow-800` | the window floor: panel at its 320px minimum, chat column at its floor, small-view transcript |
| `capability-absent` | § 10.5's degraded state, **both gated surfaces in one frame pair**: the reader's non-clickable row with the one update line, and no MCP section at all beside it (§ 10.5). One rule, one frame pair — a second near-identical frame for the second capability is the redundancy § 6.1 spends a section removing. |
| `reduced-motion` | the panel with the spinner's motion off; shape still distinguishes state — for the roster's child spinner **and** the MCP `connecting` mark, which is the only other animated glyph in the pane |

**The `reader-live` frame must come from the real app against a real child.** Two
PRs shipping together are exercised locally, and this repo's own dev pairing
supports exactly that:

- the backend runs from a `~/local-operator` worktree with
  `LOCAL_OPERATOR_DESKTOP_TOKEN` set for the session and the matching
  `LOCAL_OPERATOR_DESKTOP_ORIGINS`, serving the new route;
- the UI runs with `.env.template`'s `VITE_DISABLE_BACKEND_MANAGER=true` (the
  file is committed with that default: "Set to false to force using an already
  running instance of the local operator backend") plus
  `VITE_LOCAL_OPERATOR_API_URL` pointing at it, and `LOCAL_OPERATOR_DESKTOP_TOKEN`
  in the **main process** environment, which is the documented external pairing
  path (`main/backend/backend-service.ts:62-67`; `docs/desktop-controls.md:8-12`);
- and the run names a window mode: `pnpm dev:headless`, per this repo's rule that
  every agent-driven launch names one (`AGENTS.md`, "Running the app without
  taking the operator's focus").
- For a browser surface the same pairing works through the Vite dev proxy with
  `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` and the token on the **Vite Node process**
  (`docs/desktop-controls.md:36-40`) — never a `VITE_*` variable, and never
  committed or printed.

Storybook frames alone are not sufficient for `reader-live`: the drill-in is a
flow (click a row, watch it update, go back up), and a fixture cannot prove the
pulse-to-transcript path. The story set is required as well — it is what makes
the states reproducible without a backend — but the live pair is the one that
proves the feature works.

The live pair taken for this change is committed as
`docs/evidence/chat-run-panel-live/`, declared in `manifest.json` as a
`supplementary` set because no sweep can re-derive it, and
`docs/evidence/chat-run-panel-live/README.md` records the pairing, the ids and
the readings — including the backend access-log count of transcript reads while
the reader was open, which is the number that shows the pulse driving a re-read
rather than a single fetch. It was taken from the BUILT app rather than
`pnpm dev:headless`, for the measured reason in
`docs/evidence/chat-title/README.md`: dev paints the development-only Chat|Raw
strip over the header, which is where this surface's subject lives. Same window
mode (`LOCAL_OPERATOR_UI_WINDOW_MODE=headless`), same pairing, no focus taken.

**The MCP section has the same split, and its live half is not a frame at all.**
The marks, the copy and the cold line are fixture-provable and belong in the
story set; but the two mechanisms § 7.4 specifies — a 15 s closed-panel poll with
a window gate, and a refetch accelerated by a real canonical delta — are TIMING
facts that no frame can carry. Their evidence is § 11.4's request counting: the
backend's log or the network tab over a measured window, plus one
server-recovered transition watched end to end. A frame of a row is evidence that
the row renders; it is not evidence that the dot could ever have been right while
the panel was shut, and the operator's ask is the second thing.

### 11.4 The QA matrix (independent, on the PR branch)

The QA pass is an independent one on the UI branch against the paired backend,
covering at least:

| surface | command/step | what must be true |
|---|---|---|
| trigger always on | open a canonical session with no work, and after work settles | icon present, enabled, pressed state correct; tooltip/aria name flips with state |
| swap | canvas open → click run trigger; then canvas button | exactly one pane; the other's state is closed; no layout jump in the header |
| roster | a session with ≥7 children | rows in priority order; `+N more` expands and every child is reachable; failed row never shed |
| reader live | click a running child; watch it write | the body grows without a manual refresh; the header's elapsed ticks; the pulse cadence is capped (network tab or backend log) |
| reader settle | let the child finish | final read, outcome block, clock stops, no further requests |
| reader failures | a child that fails; a child whose transcript file is removed; a child that never wrote | the three renderings of § 5.7 / § 10.1, each with its own copy |
| nested | a grandchild | breadcrumb path, back pops one level, child control descends |
| back/close | `Escape` at each level, the close button, the trigger toggle | focus lands where § 9 says; no orphaned scroll |
| to-dos | a phased plan with an implicit phase, a blocked item, a dropped item, and >10 rows | one count for the plan, no per-phase counts, implicit phase headerless, `+N more` inside the losing phase |
| MCP listed | a session with ≥2 configured servers, all up | one row per server with its word, tool count and scope qualifier, and the tally matching the manager's live view (the TUI's `/mcp`, or Settings) — the panel is not a third opinion |
| MCP problem states | expire a grant so a server lands `auth-required`, and separately kill a stdio server's process for `disconnected` | the `danger` mark, the wire's own word, and the RIGHT remedy for each; the words match Settings byte for byte; the dot is on with the panel closed |
| MCP dot acknowledgement | panel closed with a problem → open on the list → close → reopen | dot on, then off, then still off; and a problem that heals and breaks again is announced again (the re-arm rule of § 7.3) |
| MCP dot while reading | open a child's reader, drop a server while the reader is shown, then close the panel | the dot is ON — those rows were never on screen — while the reader's own failed child does not light it (§ 3.4's view predicate) |
| MCP cadence | log the requests for two minutes with the panel closed, then hide the window, then unfocus it | ≈4 requests/min while watched, **zero** while hidden or unfocused, and one immediate refetch on return — the numbers § 7.4 fixes, read off the backend log or the network tab |
| MCP published transition | let a server recover (its reconnect fires the manager's tools-changed path) and watch the open panel | the row updates within about a second, i.e. before the next 15 s tick — evidence that the canonical change signal reaches the query (§ 7.4's accelerator), not the poll |
| MCP cold | open a conversation whose runtime is not running | the section's one cold line in place of the tally, rows with no status word, no dot, and no per-row `cold` |
| MCP unsupported | an older backend without `"mcp": 1` | no section, no dot, and **no `mcp.list` request at all** — checked in the log, because "no section" is also what an empty server list looks like |
| degraded | an older backend (capability absent) | § 10.5, including the visible update action, the quiet non-clickable row, and no second degraded line for MCP |
| narrow | 800px window, rail expanded and collapsed | no overflow, one pane at a time, small-view transcript |
| keyboard | tab order, `aria-pressed`, the divider's separator and its own label | reachable, named, not trapped |
| security | a bad child id, a user-conversation id where a child id belongs, a path in place of an id | refused, with no path echoed |

The round-2+ pass focuses on the remediation delta rather than re-running the
whole matrix, per the standing rules.

### 11.5 Reviewer, design and UX rounds

This change is user-visible and changes an interaction flow, so the standard gates
apply on the UI PR: an agent review round, a design round (D-findings) over the
rendered frames, and a UX round (U-findings) that walks the real flow — roster →
reader → nested → back → swap with the canvas, **and the dot's own flow**: leave
the panel closed with a problem, acknowledge it by opening the list, break the
same server again, open a reader while a different one breaks. The dot is the one
thing on this surface whose state is usually invisible (the panel is shut), so
the design round judges its frames and the UX round judges its behaviour; neither
substitutes for the other. The MCP section's state table, its two problem copies
and the cold line are design-round surfaces even though they are not controls.
The backend PR takes the review round alone.

---

## 12. Risks to watch during rollout

1. **The child transcript read is O(file).** Every pulse refetches a whole-file
   scan off-loop. Watch the hover/pulse path on a long-lived child with a
   multi-megabyte transcript; if the 1 Hz cap is not enough, the follow-up is a
   byte-offset incremental read, and § 5.3 says so rather than hiding it.
2. **The persisted roster is a coalesced snapshot.** Containment by snapshot is
   restart-safe and cheap, but it lags a launch by its coalesce window; the
   `child_not_found` retry path (§ 10.1) exists for that window and must be
   exercised, not assumed.
3. **The launch-turn reconciliation is a string identity match.** It depends on
   the entry id being the message id, which is a property of
   `Transcript.append_message` (`session/transcript.py:656-672`) rather than of
   the desktop. If that ever changes, the reader silently starts opening on full
   preambles — the regression is invisible in frames unless one frame of a
   *resumed* child's reader is captured. § 11.3 should include one.
4. **The implicit-phase fold changes a pinned test.**
   `scripts/run-detail-model.test.mjs:776` pins the single-phase case; the
   multi-phase-with-implicit-phase case is new and must be pinned with it, or the
   defect returns unnoticed.
5. **The failure dot's new rule is weaker in one direction than the old one.**
   With the panel open, a failure in the slice is acknowledged the moment it
   renders, where the old rule waited for the close. That is the honest meaning
   of "on screen", and the TUI's own `note_child_failed`
   (`subagent_panel.py:1858-1873`) is about a *hidden* panel, not an open one —
   but a reviewer should check the case the old design cared about most: a
   failure that arrives while the panel is open **and visible**, then the panel is
   closed. The dot must stay off, and the row must still be there.
6. **The roster becomes interactive in a header-adjacent surface.** Hover and
   pointer affordances now exist inside a panel whose rows used to be inert;
   the design round should check that the to-do rows did not acquire one by
   inheritance.
7. **Reader scroll and focus on retarget.** Hopping peers or descending to a
   child replaces the body wholesale; the TUI resets the scroll only on a new job
   (`subagent_view.py:1865-1879`, the `clear_blocks` note). The same rule must
   hold, or a reader lands mid-transcript.
8. **The MCP dot's freshness is the one claim a frame cannot check.** The poll's
   cadence, the window gate and the accelerator are timing behaviour (§ 7.4), so
   they are proven by § 11.4's request counting and nothing else. Watch the
   question the operator will actually ask ("is this thing telling me the truth
   right now?") against the residue the design accepts: a transport that dies
   while the app is idle is visible within one 15 s tick, and NOT instantly —
   if that latency proves too coarse in practice, the lever is the closed
   cadence, and the reason it is 15 s rather than 5 s is § 7.4's comparison with
   the backend's own 60 s grant clock.
9. **The MCP ledger is keyed by a name that outlives the problem.** A re-arm rule
   is the fix (§ 7.3) and the failure it prevents is silent by construction: the
   dot simply never appears again for a server that recovered and broke again.
   It is pinned in the model test rather than hoped for, because no frame of a
   correctly-quiet dot can distinguish "acknowledged" from "never re-armed".
10. **Two readings of one server can still meet on one screen.** The panel's rows
    and the Settings section read the same document from one cache key, so they
    agree by construction (`§ 7.5`), and the canonical projection is a signal
    rather than a source — but a future change that RENDERS `frontend.mcp_servers`
    somewhere would reintroduce the untimestamped merge § 7.6 refuses. The
    reviewer should treat "renders the canonical MCP projection" as a finding.
11. **The Settings surface has a live field-name bug beside this section.**
    `scope` / `setup_prompt` do not exist on the payload and the remove control's
    scope is derived from the missing field (§ 7.1, § 13), so a project-scoped
    server cannot be removed from the desktop. It is out of this panel's scope
    and inside the same feature's, so it should not be discovered by a reviewer
    as if this change caused it — and the panel must not copy the read.

---

## 13. Deferred, and why

| item | reason |
|---|---|
| Steering, answering or stopping a child from the reader | The reader is an observation surface; `hub ask` is a separate design with its own gate semantics (`docs/run-details.md` § 10 defers it, and the TUI has no dock state for it either). |
| A byte-offset incremental transcript read | Real, but it is an optimisation of a route that does not exist yet; § 5.3 states the cost it addresses. |
| The 60 s auto-hide of settled phases (`todo_panel.py:208`, `:754-800`) | Still refused, for the reason § 6.2 now reuses: nothing is hidden here, so the count the auto-hide exists for has no job. |
| `ctrl+t`-style expand/collapse of the to-do list | Only if the plan outgrows the pane in practice; the pane is tall and scrolls. |
| Per-child plans (`JobState.todos`) in the reader | The child's own plan is on the wire (`frontend_state.py:1466`) and would be a natural block in the reader, but it needs its own rendering decision (and the child's todo surface is not this panel's). |
| The pause intent on a live session's job row | Unchanged from `docs/run-details.md` § 10: a backend publish-side fix, not this PR's. |
| A real keyboard shortcut for the panel | The canvas's advertised `⌘+Shift+C` (`chat-header.tsx:42`) has no handler anywhere in the renderer — the tooltip promises a keybinding that does not exist. This change does not repeat that: no shortcut is advertised until one is bound, and binding one is its own small change. |
| Restoring the reader's scroll position across nested hops | Implementation detail (§ 10.6); the constraint is only that a retarget resets and a pulse does not. |
| The failure REASON on a panel MCP row | `mcp.list` carries no error field (`mcp/desktop.py:127-152` sends none, which is why Settings' `server.error` read at `mcp-management-section.tsx:422` is dead), and the only source on the wire is the canonical projection's startup-failure map (`frontend_state.py:4385-4387`) — a BOOT snapshot that `mcp_status.py:47-49` explicitly says cannot describe a server that dropped later. Adding it to the route is a backend change, and a reason that is right for a startup failure and wrong for the reported case is worse than no reason. |
| A human spelling for the wire status words (`auth-required`) | The string is the wire's and the backend's docstring makes rendering it directly the contract between surfaces (`mcp/manager.py:1331-1335`); re-spelling it in one renderer is the divergence § 7.2 refuses. A friendlier word is a backend vocabulary change with its own review. |
| A push channel for MCP status (a frame, or a delta at every manager transition) | It would close the residue § 7.4 accepts — a transport that dies while the app is idle — but it is a backend change to fix a gap in the PUBLISH, not the observation, and the poll already makes the indication exist. Worth doing if the 15 s latency proves too coarse. |
| Restoring a control (reauth / connect / reload) to the MCP row | Refused by design rather than deferred (§ 7.6): the panel is a view, and the row names the fix instead. Listed here so it is not re-proposed as an oversight. |
| The Settings page's `scope` / `setup_prompt` / remove-scope field names | Real, small, and in the same feature: `mcp-management-section.tsx:398` and `:479` read fields `mcp/desktop.py:127-152` never sends, and `:505-508` derives the removal scope from the missing one, so `mcp/desktop.py:191-193` refuses a project-scoped removal. Its own small PR beside this one; § 12's risk 11 keeps it from surfacing as a review finding against this panel, and § 7.1 records it so the panel reads `owned_scope`. |

---

## 14. Evidence

The frames of § 11.3 are this design's evidence and are re-takeable with
`scripts/capture-evidence.mjs` (its per-story viewport list is the review
surface, and a story missing from it is a surface nobody judged — the script's
own comment says so). `docs/evidence/run-details/` and its README stay as the
record of the retired popover; the new set lives under its story-title slug
(`docs/evidence/chat-run-panel/` if the new stories keep the prefix) and its README
states, frame by frame, which decision each pair settles — including the two that exist for defects rather than for
states: `todos-implicit-phase` (the § 6.1 finding (2)) and
`trigger-idle` (the state the old trigger could not render at all).
`mcp-unknown-status` is a third of that kind — it exists to pin a REFUSAL rather
than a state, and its pair is what stops a later "tidy-up" from folding an
unrecognised word into the quiet, dotless row that § 7.3 spends a subsection
refusing.
