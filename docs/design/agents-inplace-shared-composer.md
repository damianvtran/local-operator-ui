# Agents and teams: editing in place, and one composer for every send

Status: **design proposal, implementation not included.** This note is the anchor
for the design-consult and UX-exploration comments that follow it. It names the
mechanism, the alternatives it beat, and the questions the consult has to settle
before code is written.

Author: architect (lopdev team), 2026-09-30.

Written against UI head `961887cf7c` (this worktree, cut from `origin/main`;
`origin/main` has since moved to `dad1778e14`, which is #712 and does not touch
`features/agents/` or the composer). Backend citations were read with
`git show origin/main:<path>` against `local-operator` at `0dada4792`, because
the shared backend checkout is on a feature branch. Line numbers drift, so each
claim also names the symbol it is about.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (headless-run
and frame-capture recipes, change scope), and the note this one follows —
`docs/design/agents-conversational-config.md` (§ 5 is the page this note edits,
§ 3.4 is the write path both scopes share). PR #704 shipped that note's § 5 as
the read-first detail pane this note starts from.

---

## 0. The problem as found

Two asks, one page, and one shared component that is not yet shared.

**A. Editing is behind a gate that costs a round trip.** Every field on an agent
or team is edited by pressing **Edit**, changing what you want, and pressing
**Save changes** — one mode, one submit, one `profiles.update`/`teams.update`
for the whole record. Today that is `AgentDetail`'s `editing` flag
(`agent-detail.tsx:300`) gating the whole pane (`:671-758`), with a save that
already computes the changed fields alone (`changedFields`, `:112-129`) and
already merges onto the backend's partial-update semantics. The gate is the only
part that is not per-field: a one-word typo fix means entering a mode, scrolling
to a sticky footer, and submitting a form. The pane has already paid for the hard
parts of in-place editing — a value-based `dirty` (`:312`), a re-seed that never
clobbers typing (`:354-359`), a conflict banner (`:361-377`), Escape-to-cancel
(`:398-406`) and a fresh request id per attempt (`:436-441`) — so the remaining
work is the interaction shape, not the write path.

**B. The run composer is a restyle, not the component.** The Agents page's "Ask
for a change" box is a bare `<Textarea>` with a bespoke primary button
(`config-composer.tsx:531-585`). The chat's composer was lifted into
`shared/components/composer/message-input.tsx` by #683
(`d227214c13`, "lift the composer into a shared component"), but that lift was a
**file move, not a decoupling**: the file still imports the chat feature
wholesale — ~40 `@features/chat/*` modules including `SessionStatusStrip` and
`ComposerStatusRow` themselves (`message-input.tsx:22-24`, `:90`) — so mounting
it outside `/chat` today would drag the chat feature in with it. The ask is that
the run composer be *the same component*, with its capability set (STT,
attachments, model picker, effort, context, cost, duration), not a second
composer that looks alike.

### 0.1 What "done" means for each

- **A.** Drop the Edit gate. A field edits in place; blur accepts; Enter accepts
  (multiline per § 2.2); Escape reverts; idle → editing → dirty → saving → saved →
  error, each a designed, framed state; a dirty field is **never** silently
  clobbered by an out-of-band write; keyboard-first; a11y intact.
- **B.** One composer component, mounted by both `/chat` and the Agents page, that
  is single-source and carries the full capability set, with the run's
  background-aside behaviour rendered *inside* that component's chrome.

---

## 1. What the code is today, and what the wire allows

Both scopes live or die on what the write path already does, so this section is
the ground the rest stands on.

### 1.1 The two writers, and what each field can carry

| Route | DTO | Fields | Source |
|---|---|---|---|
| `PATCH /v1/desktop/profiles/{name}` | `ProfileEdit` | `kind`, `description`, `instructions`, `tools`, `effort`, `delegate`, `action_class` | `routes/desktop_profiles.py:64-78`, `:306-310` |
| `PATCH /v1/desktop/teams/{name}` | `TeamEdit` | `name`, `description`, `manager`, `members`, `instructions`, `project` | `:94-102`, `:363-365` |

Three facts follow, and each corrects something a reader might assume:

1. **Omission means "leave alone", never "clear".** `save_profile` sends
   `body.model_dump(exclude={"request_id","name"}, exclude_unset=True)`
   (`:277`) into `write_profile`, whose own rule is stated in the code: "An
   omitted field means 'leave it alone', never 'clear it'; clearing is done by
   naming the field with an empty value" (`agent_tool.py:1147+`, the update
   branch). `TeamEditFields` carries the same rule in its docstring
   (`teams.py:215-216`). **The changed-fields-only save the pane already does is
   therefore exactly the wire's contract, not a client nicety** — and it is what
   makes per-field autosave safe: two fields edited a minute apart are two
   independent PATCHes that cannot undo each other.

2. **`kind` is on the wire but frozen.** `ProfileEdit.kind` exists (`routes/desktop_profiles.py:66`), and an update
   that *names* the other kind is **refused**, not applied: a role asked to become
   a specialist raises, and an ordinary agent cannot be re-kinded at all
   (`agent_tool.py`, `write_profile`, the `creating`/else branch). `AgentDetail`'s
   `Draft` deliberately omits `name` and `kind` (`agent-detail.tsx:79-90`), and
   that decision is right for a different reason than the code comment gives: the
   comment says the tool "cannot rename or re-kind" (`:80-82`), while the wire
   accepts `kind` and answers a refusal. Read-only is the correct UI, but the
   contract to state is "refused on write", not "not a field" — a distinction the
   error copy depends on.

3. **Team rename is expressible, and nothing validates a roster on write.**
   `TeamEditFields.name` reaches `update_team`, which calls `validate_team_name`
   and refuses a collision with another team's name (`teams.py:1533-1541`), so a
   rename *works* even though `save_team` addresses the row by its old name
   (`:341-347`). `team-detail.tsx:14-17` says the rename path is "unverified from
   this side" and keeps the name read-only; that is a conservative choice, not a
   wire limit. Separately, `validate_target` — the manager/member resolution and
   `MAX_ORG_DEPTH`/cycle guard — has **no write-path caller**: its callers are the
   session *binding* and *move* paths only (`utils/desktop_profiles.py:110`;
   callers in `routes/desktop_sessions.py:2346-2558`, `utils/desktop_sessions.py:990`,
   `:6063`, `:6213`, `tui/app.py:30626`). A dangling `manager: no-such-agent`
   persists. **This corrects a live code comment**: `team-detail.tsx:104-107`
   claims "The backend refuses unresolved member names on WRITE
   (`validate_target`)", which the caller list refutes and which the merged note's
   R1-2 already corrected for the *note* (`agents-conversational-config.md:437-452`).
   Scope A inherits the UI-side resolution check and should fix that comment.

### 1.2 The read-first pane that #704 shipped

`AgentDetail` renders a read view when `editing` is false (`:759-859`) and the
form when it is true (`:671-758`). The pieces an in-place editor needs already
exist and are named here so the plan reuses rather than re-adds:

- `Section` / `ReadBlock` / `FieldLabel` / `SourceChip` (`detail-parts.tsx:33`,
  `:83`, `:162`, `:453`) — the section grammar and the chip vocabulary;
- `EditFooter` (`:224-290`) — sticky, one primary, dirty-confirm;
- `useEscapeToCancel` (`:196-210`) — a window-level Escape that marks the key
  handled, so the page's own Escape (leaving a definition at narrow widths,
  `agents-page.tsx:307-310`) still works;
- the page's dirty report and composer gate: each pane reports through
  `onDirtyChange` (`agent-detail.tsx:322-334`), the page resolves it against the
  pane *identity* so a stale report cannot outlive its record
  (`agents-page.tsx:265-285`), and a dirty edit blocks the config composer with
  "Finish or cancel your edit first." (`:804-805`); `requestGo` asks before
  discarding dirty typing on any navigation (`:296-305`).

### 1.3 The composer as it actually is

`MessageInput` is one `forwardRef` component (`message-input.tsx:1397`) with a
large, chat-shaped prop surface (`MessageInputProps`, `:452-960`). Two structural
facts decide Scope B:

- **The capability set is already inside it.** STT/dictation (53 references, the
  shared manager `shared/hooks/use-speech-to-text-manager.ts`, the
  `recordingProbe`/`onDictationStateChange` seams at `:898-935`), attachments
  including pasted images (`addAttachment` on the per-conversation
  `useConversationInputStore` at `:1513-1526`; the image/file paste branch at
  `:5918-5940`), and the model/effort/context/cost/duration readings — which are
  **not** separate furniture beside the box: `SessionStatusStrip`
  (`message-input.tsx:7520`) "sits INSIDE the composer's button row"
  (`session-status-strip.tsx:71-75`) and computes nothing itself, delegating to
  `session-cost.ts`/`session-context.ts`/`session-model.ts`
  (`session-status-strip.tsx:38-49`); `ComposerStatusRow` renders the run's own
  state at `:6403`.
- **It reaches the whole chat feature to do it.** `shared/components/composer/`
  importing `@features/chat/*` inverts the layering the directory name promises.
  The `index.ts` header calls it a "pure lift" and says "Nothing here reaches for
  the app shell" (`index.ts:1-12`) — true of the shell *stores*, false of the
  feature: `ChatMeasure`, `aside`, `ask-answer`, `credential-capture`,
  `draft-selection`, the picker registry, slash/at/skill pickers, `RadientSessionIssue`,
  and both status components are all imported from `@features/chat/...`
  (`message-input.tsx:9-376`). A standalone mount is *possible* — #683 added an
  `useOptionalQueryClient` fallback and pinned the no-provider mount in
  `scripts/shared-composer.test.mjs:370` — but "standalone" there means "with an
  inert fallback", not "without the chat feature's code".

### 1.4 The run's identity, which is deliberately not a session

`config-run-store.ts` states the constraint the run exists to keep: it must
**not** become a conversation (`:22-27`). The run's id lives in a module-scope
zustand store (`:1-20`), the transcript is read from the server with the ordinary
`useCanonicalSessionStream` (`use-config-run.ts:1-30`, `:37`), and the create goes
through `desktopResult` directly so `createSession` never `upsertSession`s it. So
the run has a **session id on the wire** but **no row in the canonical session
store** — which is exactly the identity the composer's attachments, drafts and
status strip are keyed by today.

---

## 2. Scope A — the per-field editing contract

### 2.1 The editable surface, per record type

**Agent.** Editable in place: `description`, `instructions`, `tools`, `effort`,
`delegate`. Read-only with a reason: `name` (addresses the row and every chat
that names it), `kind` (frozen on write, § 1.1), `action_class` (a real field the
page never set — `desktop_profiles.py:72`; offer it *only* if the consult wants
the proactive class exposed here, see Q3), and the provenance block (`source`,
`seed_origin`, `divergent_fields`) which is a fact, not a field.

**Team.** Editable in place: `description`, `instructions`, `project` (the two
briefs), `manager`, `members`. Read-only: `name` (today's deliberate choice,
`team-detail.tsx:14-17`; the wire would allow a rename — Q4 asks whether to
offer one), and the member *count* is a property of the row, not a free field.

A **built-in** agent stays read-only as a whole (`agent-detail.tsx:537`,
`:578-594`): it has no install until "Install to edit", and the read view already
carries that sentence (`:616-624`). In-place editing does not change that gate.

### 2.2 Save semantics

- **Click away (blur) accepts.** A field with a changed, valid value commits on
  blur. A field blurred with no change leaves edit state with no request.
- **Enter accepts, per field type.** Single-line fields (`description` is the one
  on both records; effort/delegate are controls, not text) commit on Enter and
  keep focus in the field. **Multiline fields (`instructions`, `project`) do
  not commit on a bare Enter** — Enter is a newline, and **Cmd/Ctrl+Enter**
  accepts. This is the one place the two-line rule has to be stated in the copy,
  and it is what Q1 asks the designer to confirm over the alternative (Enter =
  accept, Shift+Enter = newline), which is the same choice every code editor and
  every chat box makes differently.
- **Escape reverts** the *field*, not the record: it restores the value the field
  held when it entered edit state and leaves edit state. With a dirty field and a
  pointer-nav away, the existing "discard?" question is the model
  (`agent-detail.tsx:398-405`); with autosave the window is short, but the rule
  must still be one rule.
- **Affordances.** A subtle inline check (commit) and x (revert) appear only while
  a field is dirty (`dirty` = value differs from base, per-field now rather than
  whole-record), using the app's existing roles — colour and glyph, never a
  shape change `docs/branding.md` forbids.

### 2.3 The state machine

Per field, one machine, so the strip and the chips have something to render:

```
idle ──focus/click──▶ editing ──change──▶ dirty
  ▲                     │                  │
  │                     │ blur, no change  │ commit (blur | Enter | ⌘/Ctrl+Enter)
  │                     ▼                  ▼
  └────── Esc ──────────┘              saving ──ok──▶ saved ──(settle)──▶ idle
                                         │
                                         └──err──▶ error ──retry──▶ saving
```

Rule that keeps it honest: **`saved` is a transient acknowledgement, not mode** —
it decays to `idle` after a short dwell, exactly as the toast does today, and it
is `aria-live="polite"`. `error` holds the refusal **beside the field** (the #704
finding: the message must not be a banner 700px away, `agent-detail.tsx:866-872`)
and offers Retry; a field in `error` stays in `error` until retried or reverted.

### 2.4 The conflict rule — the one that must never clobber

The pane already refuses to re-seed a dirty draft (`agent-detail.tsx:354-359`)
and already shows a conflict banner when the record moved under the draft
(`:361-377`). Per-field autosave narrows this but does not remove it: a hub pull
or another window can land between a field's `editing` and its commit.

Recommended rule, stated as four cases:

1. **Field not dirty, record moves** → adopt silently (today's clean re-seed).
2. **Field dirty, record moves, *this field unchanged out-of-band*** → commit on
   blur/Enter as normal. The wire is a partial PATCH (§ 1.1), so the commit
   writes only this field and cannot revert the out-of-band one.
3. **Field dirty, record moves, *this field changed out-of-band*** → **do not
   clobber and do not silently adopt.** The field stays dirty, shows an inline
   "changed elsewhere — keep mine / use theirs" choice, and the commit is *held*
   until the operator answers. This is the case the "never silently clobber" ask
   is about, and it is the one the whole-record Save also had — but per-field it
   is answerable in one control instead of a banner and a reload button.
4. **A hub pull replaces the whole record** (`sync`, `replace`) → treat as a
   document reload: fields not dirty adopt; fields dirty are held per case 3.

This depends on one thing the codebase does **not** do today: knowing **which
fields** moved. The authoring frame invalidates the query and the detail
refetches a whole record (`profile-hooks.ts` `useAuthoringRefresh`; the merged
note's U6 measured the list refreshing ahead of the detail,
`agents-conversational-config.md:512-530`). Cases 2 and 3 cannot be told apart
from "the record changed". Q2 asks the consult to choose between (a) resolving
this at the UI by comparing the fresh record field-by-field against `base` — which
is what case 2/3 above already *is* — or (b) having the backend name the changed
fields, which would also fix U6 for the conversational path. **(a) is
recommended for v1**: it needs no backend change and the comparison is the same
`changedFields` shape the pane already computes.

### 2.5 Validation

- `instructions` on an agent: non-empty after trim. The pane refuses an empty
  instructions *before* sending (`agent-detail.tsx:424-431`) because the backend
  answers 200 and ignores it; that guard moves into the field's commit and is the
  reason a field can enter `error` without a round trip.
- `description` on an agent: free (the DTO caps at 8000, `:66`).
- `effort`: constrained to the live tiers plus `inherit` (`agent-detail.tsx:730-737`).
- team `manager` non-empty; `members` resolve against the loaded agents/teams,
  flagged inline when they do not (`team-detail.tsx:100-121`) — the check is the
  UI's, because nothing on the write path performs it (§ 1.1).
- team `name`: only on the create path today.
- Names may not contain spaces or slashes (create path, `team-detail.tsx:240-245`).

### 2.6 Keyboard and accessibility

- Tab reaches each field; Enter/⌘-/Ctrl+Enter accepts; Escape reverts; the
  check/x are real buttons with labels, in the tab order, not hover-only.
- Each field's control keeps its `FieldLabel`/`aria-invalid`/`aria-describedby`
  wiring (`detail-parts.tsx:453`), and a commit that starts a request sets
  `aria-busy` on the field's group.
- The transient `saved` acknowledgement is a single `aria-live="polite"` region
  per pane, not one per field, so a fast editor is not narrated into noise.
- Focus never falls to `body` on commit: it stays in the field (the pane's
  existing rule, `agent-detail.tsx:449-451`, is about a *mode* ending; under
  in-place there is no mode to end, so the caret simply stays put).

### 2.7 What happens to read-first and the Edit gate

**Retire the Edit button, keep every other thing it did.** The read view stays
the resting state; it just becomes *click-to-edit* at each section rather than a
mode. `EditFooter`, `EditSection`, the `editing` flag, `confirmDiscard` and the
whole-record `save` are removed **only after** their behaviours have a per-field
home:

- the sticky "Save changes" disappears (there is nothing to submit); the
  dirty-confirm moves to the per-field Escape/away rule;
- the create pane (`AgentCreate`, `agent-detail.tsx:948`; `TeamDetail`'s
  `creating`) keeps its form, because a new record has no base to diff against
  and no fields to edit *in place* — it is a create, not an edit;
- the "Duplicate as new agent" and "Ask for a change" header actions stay
  unchanged.

The one open shape is whether to keep a **bulk edit mode** for multi-field
changes. Recommendation: **no.** Per-field editing with a sticky nothing is
simpler, and a bulk mode would be a second way to edit the same record — the
thing the "one writer" rule below exists to avoid. If the consult wants a way to
edit instructions *and* tools together, the composer already is that path.

### 2.8 The page's dirty rule, restated for autosave

Today `editDirty` blocks the config composer for as long as *any* unsaved typing
exists on the pane (`agents-page.tsx:280-285`, `:804-805`). Under autosave the
dirty window is a keystroke-to-blur, so the block becomes almost always false —
but the race it guards (a run writing the record while a human is typing it) is
still real, just shorter and per-field. Recommended: keep the gate, scope it to
"a field on *this* record is dirty or saving", and let it name the field. The
pane's `onDirtyChange` contract (`agent-detail.tsx:314-334`) survives; what
changes is that it reports on field state rather than a mode.

---

## 3. Scope B — one composer for the run and the conversation

### 3.1 The requirement, read exactly

The run composer must **be** `MessageInput` — not a restyle of it — with the full
capability set, and the background-aside sentence
("Runs in the background. This does not appear in your conversation.",
`config-composer.tsx:594-598`) must render *within that component's chrome*.

### 3.2 Capability audit against the current component

| Capability | In `MessageInput` today? | How a non-chat host supplies it |
|---|---|---|
| STT / dictation | **Yes** — the button, the manager, the indicator (`:23`, `:371`, `:898-935`) | `recordingProbe` + `onDictationStateChange`; fails closed to "no key" (`:898-923`) |
| Attachments incl. pasted images | **Yes** — paste branch (`:5918-5940`), `AttachmentsPreview` (`:22`) | **needs `conversationId`**; attachments live on `useConversationInputStore` keyed by it (`:1513-1526`) |
| Model picker | **Yes** — `SessionStatusStrip` → `/model` dispatch (`session-status-strip.tsx:50-60`, `:71-75`) | needs the canonical frontend snapshot (`frontend` prop) |
| Effort | **Yes** — same strip, `/effort` (`:52`) | same |
| Context readout | **Yes** — same strip (`ContextWheel`, `:16-18`) | same |
| Cost | **Yes** — same strip (`session-cost.ts`) | same |
| Duration | **Yes** — same strip (`session-duration.ts`) | same |
| Run state row | `ComposerStatusRow` (`:6403`) | `runDetails` prop (`:432`) |

**The audit's conclusion: the capabilities are already in the component; what the
run lacks is the identity and the snapshot the strip reads them from, not the
controls.** That is the whole of Scope B's difficulty, and it is deliberately
narrower than "port a composer".

### 3.3 The run's four differences, and how each is reconciled

1. **No canonical session store row.** The run's id is in `config-run-store`
   (§ 1.4). *Reconcile by prop, not by store*: `MessageInput` already takes
   `conversationId` as an **optional** prop (`:583`) and degrades to no
   drafts/attachments when absent. The run passes its own id as `conversationId`
   for the composer's *internal* keys, while the store row stays absent — the two
   are already separate (the composer reads `useConversationInputStore`, which is
   not the canonical session store). **Verify at implementation that nothing on
   the mount path `upsertSession`s** — that is the leak the whole feature exists
   to prevent (`use-config-run.ts:1-30`), and mounting the chat composer is a new
   chance to cause it.
2. **Background aside, no conversation entry.** Render the aside sentence through
   `placeholderOverride`-style chrome — the component already has a host-owned
   invitation slot (`placeholderOverride`, `:937-951`) and a notice band. The
   aside line is *not* a placeholder (it is a permanent footnote) so it wants a
   small host slot, recommended as a new optional `hostNotice?: ReactNode`
   rendered above the box, rather than overloading the placeholder. Q5 confirms
   the slot's shape with the designer.
3. **The strip's readings.** The run is a real session, so `useCanonicalSessionStream`
   already produces a frontend snapshot (`use-config-run.ts:37`). Whether the
   strip *should* show model/effort/context/cost/duration for a configuration run
   is a product question (Q6): the run's model is resolved by the backend
   (§ `use-config-run.ts:22-30`), so a model *picker* may be inert. Recommended:
   mount the strip, keep the readings live, and gate the pickers off where the
   run's model is backend-resolved.
4. **Send shape.** The run's send is `run.start(text, about)` (`config-composer.tsx:465-469`)
   with an "About <agent>" chip — not a message into a transcript. *Reconcile by
   the `onSendMessage` seam* (`:453`): the run's handler takes `(content)`,
   ignores attachments it did not receive, and keeps `about` as host chrome beside
   the box (the chip already exists, `:518-527`).

### 3.4 The layering problem, and the smallest fix

`shared/` importing `@features/chat/` is the reason "mount the shared composer"
is not free. Two options:

- **(i) Leave the imports and mount it anyway.** Quickest; but it means `shared`
  depends on a feature forever, and the next consumer inherits the coupling. It
  also makes the component's own doc comment false.
- **(ii) Move the chat-owned satellites the composer genuinely needs into
  `shared/`** — at minimum `SessionStatusStrip` (+ its three reading modules),
  `ComposerStatusRow`, `AttachmentsPreview`, the credential-capture cluster, and
  the slash/at pickers it renders. Largest, but it is the only version where the
  component is *shared* rather than relocated.

**Recommended: (ii), scoped to what the run actually renders.** The run does not
need the credential capture, slash commands or at-mentions — those are chat
surface. So the honest split is: **lift the composer's *own* furniture
(status strip and readings, run row, attachments preview, dictation indicator)
into `shared/`, leave the chat-only pickers imported behind props the run does
not pass.** That is a smaller move than (ii) wholesale and it removes the part of
the coupling the run would otherwise carry. Q7 asks the consult to confirm the
cut line.

### 3.5 Single source, and what the manager must coordinate

The component must stay **one file**. That has two coordination consequences, and
both are the manager's to run, not this note's to message:

- **Chat-composer owners.** Any change to `MessageInput`'s props or internals now
  has two consumers. The manager should name a single owner for
  `shared/components/composer/**` for the window this lands in, so a chat PR and
  the run PR cannot edit it simultaneously.
- **The mobile parity lane.** The ask says mobile mirrors the shared component.
  Because the run's differences are props (§ 3.3), the parity lane should mirror
  the **props contract**, not a second component. The manager owns telling that
  lane when the contract is frozen.

### 3.6 Step plan

1. **Lift the coupled satellites into `shared/`** (§ 3.4), one PR, no behaviour
   change, parity frames. This is the enabling step and it is reviewable on its
   own.
2. **Add the host seams the run needs** — `hostNotice` (§ 3.3.2) and whatever the
   strip needs to render for a session with no draft — again no consumer yet.
3. **Mount `MessageInput` on the Agents page**, replacing `config-composer`'s
   textarea, with `conversationId` = the run id, `onSendMessage` = `run.start`,
   the About chip and the aside notice as host chrome.
4. **Delete `config-composer`'s bespoke box** once the mount has parity frames.

A single PR is possible but not advised: step 1 is a pure move that a reviewer
can check mechanically, while step 3 is a behaviour change. Keeping them apart
also keeps the chat unaffected if step 3 slips.

### 3.7 Risks to watch during rollout

- **The leak.** Mounting the chat composer must not `upsertSession` the run
  (§ 3.3.1). Watch: the run is absent from `lop sessions`, the sidebar and search
  after a send from the new box.
- **The strip's reads returning nothing** for a no-draft session, leaving a strip
  that claims a model the run is not on — the exact drift `session-status-strip.tsx:60-75`
  says the slash-dispatch path exists to prevent.
- **Autosave write amplification.** Per-field commits are more requests than one
  Save. Watch: a blur storm (tabbing through a form) firing a PATCH per field.
  Mitigation is in the machine (commit only a *changed, valid* field), but it is
  worth a test.
- **The conflict rule shipping as case 2 only.** If case 3 is not built, a dirty
  field silently reverts an out-of-band write — the U5 defect returning
  (`agent-detail.tsx:1-24`).
- **The page's dirty gate going stale** as the mode disappears (§ 2.8).

---

## 4. Open questions for the consult

- **Q1 (design).** Multiline accept: Enter = newline + ⌘/Ctrl+Enter = accept
  (recommended), or Enter = accept + Shift+Enter = newline? The copy changes with
  the answer.
- **Q2 (arch/backend).** Field-level conflict (case 3, § 2.4): compare the fresh
  record field-by-field in the UI (recommended, no backend change), or have the
  backend name changed fields — which would also fix U6 for the conversational
  path?
- **Q3 (product).** Expose `action_class` (the proactive/class control) in the
  Behaviour section? It is a real field the page has never set
  (`desktop_profiles.py:72`).
- **Q4 (product).** Offer a team rename, now that § 1.1 shows the wire allows it?
  Today the name is read-only and a chat/schedule addresses a team by name.
- **Q5 (design).** The aside notice's slot: a host-owned `hostNotice` above the
  box (recommended), or fold it into the existing placeholder/notice band?
- **Q6 (product).** Should a configuration run's strip show model/effort/context/
  cost/duration at all, and should the pickers be live when the backend resolves
  the run's model?
- **Q7 (arch).** Confirm the `shared/` cut line (§ 3.4): move the
  status-strip/readings, run row, attachments preview and dictation indicator;
  leave the chat-only pickers behind host props.
- **Q8 (design).** The dirty check/x affordances: where they sit in the field's
  own box versus its label row, and their disabled/saving states.

---

## 5. What this note deliberately does not do

- It does not specify copy or spacing; those are the designer's.
- It does not propose a backend change except where § 1.1 records one already
  owed elsewhere (`validate_target` on the write path, which belongs to *both*
  writers — `agents-conversational-config.md:437-452`).
- It does not decide the `shared/` refactor's namespace beyond the cut line in
  § 3.4; if the consult prefers the minimal mount (option (i)), the note's § 3.4
  and Q7 are the only parts that change.
- It carries no implementation; the second writer (the configuration run) and the
  manual editor keep sharing one `write_profile`/`update_team`, so no second way
  to edit a record is introduced by either scope.
