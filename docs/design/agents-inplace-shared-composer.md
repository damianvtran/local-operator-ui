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

Round 2 (2026-10-01): amended for M5 (the box's own text is the fourth store write,
and the (a) decision plus the store that owns it), m6 (the image-encoding path in the
lift list), m7 (navigating away with a dirty field) and n4 (outside vs inside chrome).

Round 1 (2026-09-30): amended for the agent review (B1, M1-M4, m1-m5, n1-n3) and
for the UX consult, which settled the former Q1 and Q8 (folded into § 2.2 and
§ 2.6, recorded as resolved in § 4). The wire reading and Scope A's write path are
unchanged; the amendment turns the run's *surface*, the mount's store reads and
the `shared/` cut line from open items into stated decisions.

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
composer that looks alike. Two facts about the run belong here once, because they
set up § 3.1: its **send is a session create + message on a hidden run id**
(`use-config-run.ts:490-508`, `:590-598`), never a message into a thread; and its
**box is not its whole surface** — the run's own activity/state strip
(`RunStrip`/`RunActivity`/`RunSummary`, `config-composer.tsx:96-326`, `:494-517`)
is a second, run-owned surface that stays.

### 0.1 What "done" means for each

- **A.** Drop the Edit gate. A field edits in place; blur accepts; Enter accepts
  (multiline per § 2.2, settled with the UX consult); Escape reverts; idle → editing → dirty → saving → saved →
  error, each a designed, framed state; a dirty field is **never** silently
  clobbered by an out-of-band write; keyboard-first; a11y intact.
- **B.** One composer component, mounted by both `/chat` and the Agents page, that
  is single-source and carries the full capability set, with the run's
  background-aside behaviour rendered *inside* that component's chrome. Its box
  replaces the run's `<Textarea>` only — the run's own activity/state strip and
  its settled summary stay, run-owned (§ 3.1).

---

## 1. What the code is today, and what the wire allows

Both scopes live or die on what the write path already does, so this section is
the ground the rest stands on.

### 1.1 The two writers, and what each field can carry

| Route | DTO | Fields | Source |
|---|---|---|---|
| `PATCH /v1/desktop/profiles/{name}` | `ProfileEdit` | `kind`, `description`, `instructions`, `tools`, `effort`, `delegate`, `action_class` | `routes/desktop_profiles.py:64-78`, `:306-310` |
| `PATCH /v1/desktop/teams/{name}` | `TeamEdit` | `name`, `description`, `manager`, `members`, `instructions`, `project` | `:94-102`, `:363-365` |

Four facts follow, and each corrects something a reader might assume:

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

3. **An ordinary conversational agent cannot be edited here at all (m1).** The
   read-only list in § 2.1 is about *fields*; this is about the *row*. For a row
   that is neither a role nor an authored specialist, `write_profile`'s
   else-branch **refuses the update outright** (`agent_tool.py:1192-1199`:
   "Converting it is the fail-open hijack the role tag exists to stop") — so an
   in-place edit of such a row fails on the first commit, whatever field it is.
   Only a role or a specialist (or one of the shipped agents the pane can
   install) is editable in place; everything else keeps the read view and the
   "New chat" / "Duplicate" actions.

4. **Team rename is expressible, and nothing validates a roster on write.**
   `TeamEditFields.name` reaches `update_team`, which calls `validate_team_name`
   and refuses a collision with another team's name (`teams.py:1533-1541`), so a
   rename *works* even though `save_team` addresses the row by its old name
   (`:341-347`). `team-detail.tsx:14-17` says the rename path is "unverified from
   this side" and keeps the name read-only; that is a conservative choice, not a
   wire limit. Separately, `validate_target` — the manager/member resolution and
   `MAX_ORG_DEPTH`/cycle guard — has **no write-path caller**: its callers are the
   session *binding* and *move* paths only (`utils/desktop_profiles.py:110`;
   callers in `routes/desktop_sessions.py:2346-2558`, `utils/desktop_sessions.py:990`,
   `:6063`, `:6213`, `tui/app.py:30626`). The line that most
   plausibly seeded the wrong comment is `network/definitions.py:690`, which
   *asserts* the desktop path validates the graph — it does, at **bind**, not at
   **write**. A dangling `manager: no-such-agent` persists. **This corrects a live code comment**: `team-detail.tsx:104-107`
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
- `useEscapeToCancel` (`:196-210`) — **the PAGE-level Escape, and it must not be
  reused for a field (m2)**: it is a `window` listener that marks the key handled
  for the whole pane, which cannot express "revert *this field*, not the record"
  (§ 2.2). It stays for leaving a definition at narrow widths
  (`agents-page.tsx:307-310`); per-field Escape needs its own handler, guarded on
  `defaultPrevented` so an open picker closes first;
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

That is not a *write* risk on its own — the composer's canonical read is
`sendUnsettledForSession(state.drafts, conversationId)`
(`message-input.tsx:2532-2534`), a lookup that cannot create a row — but it is
not a "verify at implementation" item either (M1). § 3.3.1 states the decision,
because `use-config-run.ts:10-14` is the file whose whole existence is that the
run never becomes a conversation.

### 1.5 Two frozen briefs this note supersedes

Both are live comments that will otherwise be argued from, and each is
**superseded by this design, not contradicted by it**:

1. **`config-composer.tsx:5-11` freezes the opposite brief.** "It is not the app's
   chat composer and must never read as one (UX brief, must-nots): no slash
   dispatch, no attachments, no `@` references, no draft store, no route change."
   That was written for the shipped scope; Scope B supersedes the *control
   surface*, while the parts it protects — the run's send path, the aside's
   meaning, no route change — are exactly what § 3.3 keeps. The mount PR rewrites
   that comment to name which half survives (the send path and the aside) and
   which half is retired (the control-surface prohibition). Left standing, review
   argues from whichever file it reads second.
2. **The aside sentence is not a placeholder.** The composer has both a
   `placeholderOverride` (`message-input.tsx:934`, `:937-951`) and a notice band;
   U4 requires the sentence to stay a **persistent node that is still the box's
   `aria-describedby` target**, verbatim. § 3.3.2 and Q5 follow from this.

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

The *row-level* gate is separate from the field-level one: an ordinary
conversational agent (neither a role nor an authored specialist) cannot be edited
by this pane at all, because `write_profile` refuses its update outright (§ 1.1
item 3). § 2.5 carries that as a validation rule rather than a silent failure.

A **built-in** agent stays read-only as a whole (`agent-detail.tsx:537`,
`:578-594`): it has no install until "Install to edit", and the read view already
carries that sentence (`:616-624`). In-place editing does not change that gate.

### 2.2 Save semantics

- **Click away (blur) accepts.** A field with a changed, valid value commits on
  blur. A field blurred with no change leaves edit state with no request.
- **Enter accepts, per field type — SETTLED (UX consult, was Q1).** Single-line
  fields (`description`; `manager`/`name` on a team; effort and delegate are
  controls, not text) commit on Enter, and focus **stays in the field** (or moves
  to the next field where that is the walk's flow). **Multiline fields
  (`instructions`, `project`, the team briefs) do not commit on a bare Enter** —
  Enter is a newline and **Cmd/Ctrl+Enter** accepts, because Enter-to-accept on a
  12-row prose field makes writing impossible and the chat box's Enter-sends
  contract is a different box with a different job. This is the one two-line rule
  the copy has to state.
- **Escape reverts** the *field*, not the record: it restores the value the field
  held when it entered edit state and leaves edit state — **with no prompt**
  (SETTLED, UX consult), because with per-field autosave there is nothing to lose
  that a re-type cannot restore. `defaultPrevented` is checked first so an open
  picker (effort, member search) closes before the field does, reusing the guard
  `useEscapeToCancel` already carries (`detail-parts.tsx:196-210`).
- **Navigating away with a dirty field commits it, exactly as blur does (m7).**
  Clicking another roster row, switching the Agents/Teams tab or following a link
  blurs the field, and blur accepts — so a dirty field commits on the way out. That
  is the deliberate opposite of Escape, which *reverts*: the pointer has left, the
  keyboard action was a decision. It is also why the page's discard question is
  retired with the mode rather than re-pointed — with per-field autosave there is
  nothing to discard (D2). Until the per-field commit lands the page's existing
  guard stays as it is (`agents-page.tsx:296-305`, § 2.7).
- **Affordances — SETTLED (UX consult, was Q8).** A check (accept) and x (revert)
  appear in the field's own row **only while the field is dirty** (`dirty` =
  value differs from base, per-field now rather than whole-record), at a **32x32**
  hit area matching the composer's icon buttons — glyph and colour only, no shape
  change `docs/branding.md` forbids and no hover lift. They are **never the only
  route to commit** (blur and the Enter rule are), so a pointer-less or
  keyboard-only user is never dependent on them.

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
- **The row itself may be un-editable.** An ordinary conversational agent is
  refused by `write_profile`'s else-branch (§ 1.1 item 3), so the pane must know
  this *before* a commit and render the read view with its reason rather than
  accepting a field and failing the write. "Editable" is a property of the record
  (role / specialist / installed), not only of the field.
- `effort`: constrained to the live tiers plus `inherit` (`agent-detail.tsx:730-737`).
- team `manager` non-empty; `members` resolve against the loaded agents/teams,
  flagged inline when they do not (`team-detail.tsx:100-121`) — the check is the
  UI's, because nothing on the write path performs it (§ 1.1).
- team `name`: only on the create path today.
- Names may not contain spaces or slashes (create path, `team-detail.tsx:240-245`).

### 2.6 Keyboard and accessibility

- **One tab stop per field, in reading order** — agent: `description` →
  `instructions` → tools → delegate → effort; team: `description` → the two
  briefs → `manager` → `members` (SETTLED, UX consult). Nothing else in the pane
  gains a stop.
- The check/x are real buttons with labels — "Accept the new <field>" / "Revert
  the <field>" — **immediately after their field in the tab order** (SETTLED).
  **A field in `error` or in conflict stays one stop, and the choice control is
  the NEXT stop** — the field must not fragment into several stops or drop the
  value's stop when it matters most.
- Keys: Enter / ⌘-/Ctrl+Enter accepts; Escape reverts the field (§ 2.2).
- Each field's control keeps its `FieldLabel`/`aria-invalid`/`aria-describedby`
  wiring (`detail-parts.tsx:453`), and a commit that starts a request sets
  `aria-busy` on the field's group.
- **A refusal renders BESIDE the field with `Retry`, re-issuing the SAME write**
  (SETTLED), and the field stays in `error` until retried or reverted — #704's own
  finding (`agent-detail.tsx:866-872`: the message must not be a banner 700px
  away). **A conflict reuses the shipped wording "This changed while you were
  editing" at field scale** with "keep mine / use theirs", and **holds the
  commit** — the hold is not silent (§ 2.4 case 3).
- The transient `saved` acknowledgement is a single `aria-live="polite"` region
  per pane, not one per field, so a fast editor is not narrated into noise.
- Focus never falls to `body` on commit: it stays in the field, or advances on a
  single-line Enter-accept (the pane's old rule, `agent-detail.tsx:449-451`, was
  about a *mode* ending; under in-place there is no mode to end).
- **Read-only fields stay read-only with a reason, and are never rendered as
  fields that refuse** (SETTLED, executed against #704's U4/D1): `name`, `kind`,
  provenance and `action_class` (unless Q3 says otherwise) render as prose and
  chips — the read view's model — never as a disabled input, which is the exact
  regression per-field editing could reintroduce.

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
"a field on *this* record is **dirty or saving**" — **not `editing`** (m3): in
§ 2.3's machine a field is `editing` on a bare focus and only `dirty` after a
change, so a gate keyed on `editing` would fire when the operator has merely
clicked into a field and is racing nobody — and let it name the field. The
pane's `onDirtyChange` contract (`agent-detail.tsx:314-334`) survives; what
changes is that it reports on field state rather than a mode.

---

## 3. Scope B — one composer for the run and the conversation

### 3.1 The requirement, read exactly — and the surface it leaves alone

The run composer must **be** `MessageInput` — not a restyle of it — with the full
capability set, and the background-aside sentence
("Runs in the background. This does not appear in your conversation.",
`config-composer.tsx:594-598`) must render *within that component's chrome*.

**The run has two surfaces, and only one of them is the composer (B1).** The
Agents page's configuration card is `ConfigComposer`, and above the box it renders
a **run-owned activity and state strip**: `RunStrip` (`config-composer.tsx:96-326`)
with `RunActivity`'s tool rows (`:66-94`), the `Watch` disclosure (`:186-200`), the
Stop control (`Square`, `:203-212`), the `runDetails` row and the settled summary
`RunSummary` (`:327-383`). `MessageInput` is a composer only — the
transcript it sits under in chat is `features/chat/components/chat-content.tsx`,
which mounts it, and chat's own tool rows are chat's. So mounting `MessageInput`
in place of `:531-585` replaces **the box**, and the run's strip stays exactly
where it is.

Which half of chat's pane comes along: **none**. There is no chat transcript on
this page to bring, and the run's strip is not one — it is the run's own progress
vocabulary (`config-composer.tsx:18-22`: a state dot, a one-line step and elapsed
time; no percentage). The note therefore says, once, what "one composer" means
here: **the box is shared; the surface above it is the run's.**

The parity evidence in § 3.2 and the step plan in § 3.6 are written against this
two-surface reading.

### 3.2 Capability audit against the current component

Capability, where it lives today, and what the run must supply. "In the
component" is about the **control**; delivery and enablement are separate rows,
because two of them are not free (M2, M3).

| Capability | In `MessageInput` today? | What the run supplies / must decide |
|---|---|---|
| STT / dictation | **Yes** — the button, the manager, the indicator (`:23`, `:371`, `:898-935`) | `recordingProbe` + `onDictationStateChange`; fails closed to "no key" (`:898-923`). A transcription lands in the box's text, which rides `text`. |
| Attachments incl. pasted images | **Yes** — the control (paste branch `:5918-5940`, `AttachmentsPreview` `:22`) | **needs `conversationId`** for the input store (`:1513-1526`), **and a delivery path the run does not have yet (M2, § 3.3.4)** |
| Model picker | **Yes** — `SessionStatusStrip` → `/model` dispatch (`session-status-strip.tsx:50-60`, `:71-75`) | the `frontend` snapshot (present, `use-config-run.ts:37`) **and a dispatcher it will not have** — M3, § 3.3.3 |
| Effort | **Yes** — same strip, `/effort` (`:52`) | same |
| Context readout | **Yes** — same strip (`ContextWheel`, `:16-18`) | same |
| Cost | **Yes** — same strip (`session-cost.ts`) | same |
| Duration | **Yes** — same strip (`session-duration.ts`) | same |
| `@` references | **Yes** — `mentionsEnabled` (`:748`), fails closed | **not enabled for the run** (§ 3.3.1) |
| Slash commands | **Yes** — `slash.available && Boolean(onSlashCommand)` (`:3427`) | **not passed for the run** — the gate that reaches the picker registry (§ 3.3.1) |
| **Run activity/state strip** | **No — and it is not the composer's (B1)** | the run keeps its own `RunStrip`/`RunActivity`/`RunSummary` above the shared box (§ 3.1) |

**The audit's conclusion: the capabilities are already in the component as
*controls*; what the run lacks is the identity, the snapshot's dispatcher, and the
attachment *delivery* — not the controls.** That is the whole of Scope B's
difficulty, and it is deliberately narrower than "port a composer". But "the
control exists" is not "the capability arrives": M2 and M3 are the two rows where
it would not, and § 3.3 settles both.

### 3.3 The run's four differences, and how each is reconciled

1. **No canonical session store row — the mount's reads AND writes are a stated
   decision, not a "verify later" (M1, M5).** The component reads canonical state on
   its mount path — `useCanonicalSessionsStore((state) =>
   sendUnsettledForSession(state.drafts, conversationId))`
   (`message-input.tsx:2532-2534`) and `useAsideStore` (`:123`, `:1478`) — and it
   writes through **two** seams: the **command** path (slash dispatch, whose
   destination calls the router and `upsertSession` —
   `features/chat/components/slash-dispatch.ts`, the `/new` branch) and the **box's
   own text**, mirrored into `useConversationInputStore` on the keystroke path
   (`setCurrentInput(conversationId, …)`, `use-message-input.ts:691`, `:1100`;
   `message-input.tsx:2844`), a **persisted** store
   (`conversation-input-store.ts:774`, `:1377`).

   **Reads — allowed.** The **drafts lookup** is a pure read keyed by the id (it
   cannot create a canonical row), and the aside read is inert (no
   `asideSessionId` is passed).

   **Command writes — denied.** `onSlashCommand` **is not passed**, so
   `slash.available && Boolean(onSlashCommand)` (`:3427`) is `false` and the whole
   slash surface — the one that reaches `upsertSession` — is off; `mentionsEnabled`
   is **not enabled** (`:748`); and the run's `onSendMessage` calls `run.start`
   directly and **never** `admitChatDraft`.

   **The box's text — the fourth write, and M5's decision: (a), keep
   `conversationId`.** The composer owns the box's text, so the run's text and its
   attachments live in `useConversationInputStore` **keyed by the box's own
   constant** — a client-minted `agents-config`, ONE CONSTANT for the app's whole
   life rather than a uuid per launch (UX exploration, U2 and its review: the draft
   lives under this key in the composer's persisted store, so a key that died with
   the mount took the draft with it; and `useConversationInputStore` sweeps no
   rows, so a uuid per launch would orphan a row per launch and still lose an
   unsent draft at relaunch, while chat's drafts survived — a constant makes
   relaunch behave like leaving and returning, and it cannot collide with a
   conversation id) — and that is deliberate rather than an oversight. What this bends is named: the second of
   the three mechanisms in `use-config-run.ts:12-16` reads "nothing about it reaches
   the canonical session store, **the draft store** or the chat route" — mechanism 2
   is amended to **"the canonical session store or the chat route"**, because the
   run id *is* now a key in the input store. The invariant that must not bend is the
   one the constraint exists for: the run never becomes a **canonical session row** —
   absent from `lop sessions`, the sidebar and search, never a route, never
   `upsertSession`ed. A stale `inputByConversation[<run id>]` entry may outlive the
   run (the id is never re-created, so it can never be shown again); that is the
   tolerated residue, and § 3.7's test gains it as a row it must *expect* alongside
   the rows it must never see.

   **Which store OWNS the box's text after the mount: the composer's, not
   `config-run-store`.** `config-run-store.draft` / `setDraft` / `acceptDraft`
   (`config-run-store.ts:67`, `:121-123`, `:187`; called `use-config-run.ts:558`,
   `:619`) exist to keep a draft alive across a *failure*, and the composer's store
   already provides that — persisted, which is stronger. The run keeps what its own
   surface needs: `topic` (the strip's "what you asked for") and the accepted text
   its `retry` re-issues. The "spent only when the send was accepted" rule survives
   through the send seam rather than a run-level call: the host's `onSendMessage`
   returns the `SendOutcome` the composer already understands — **`false` when the
   `sessions.message` call fails**, which is the seam's own "put the text back in
   the box" answer (`use-message-input.ts:182-196`), and `true` only once that call
   resolves. `acceptDraft`'s semantics move to the one place that now owns the
   text. **Option (b)** — a seam that keeps the text in `config-run-store` and
   bypasses the chat store — was rejected: it needs a new prop the component does
   not have (§ 3.6 step 2 adds none) and would still need the input store for
   attachments, so it would bend the same clause with more machinery.

   The acceptance test this owes, as the constraint demands
   (`use-config-run.ts:10-14`): after a send from this box, the run id is absent
   from `lop sessions`, from the sidebar, from search and from the chat route, and
   no canonical session row is created for it. That is the *design-level*
   statement; the note no longer leaves it to implementation to discover.
2. **Background aside, no conversation entry — reuse the existing notice band,
   add no prop (Q5, U4).** The aside sentence is a **permanent footnote, not a
   placeholder**, and U4 requires it to stay the box's `aria-describedby` target,
   verbatim. So the recommendation is now explicit: put it in the composer's
   **existing notice band** (`message-input.tsx:934`, `:937-951` is the
   placeholder slot; the notice band is the sibling) and point the box's
   `aria-describedby` at that node. A new `hostNotice?: ReactNode` slot is the
   alternative, not the recommendation — one sentence does not justify a third
   slot. Q5 keeps both options and rules out `placeholderOverride` on U4's terms.
3. **The strip's readings — a three-way choice, and (b) is the pick (M3).** The
   run *does* have a non-null snapshot (`use-config-run.ts:37`), so the question
   is not "is there a snapshot" but **which strip**: (a) no strip (a `null`
   `frontend` renders nothing — `session-status-strip.tsx:758-784`); (b) **the
   readings render, the pickers do not**; or (c) the pickers render visibly inert.
   The recommendation is **(b): pass `frontend`, withhold `onCommand`** — with no
   dispatcher each reading renders as a label carrying the shipped `COMMANDS_OFF`
   sentence (`session-status-strip.tsx:628-630`, "Slash commands are off on this
   server…"), which is the honest state for a run whose model the backend
   resolves (`use-config-run.ts:22-30`). **This is a new *use* of an existing
   strip mode, not a prop the run already has** — the same control in a
   configuration the chat pane never puts it in — and it is what Q6b asks the
   consult to confirm. Whether the readings should appear *at all* is Q6a.
4. **Send shape, and the attachment delivery gap (M2, m5).** The run's send is
   `run.start(text, about)` (`config-composer.tsx:465-469`), which is a
   `sessions.create{purpose}` + `sessions.message{text}` on a hidden id
   (`use-config-run.ts:490-508`, `:590-598`) — not a message into a transcript,
   and `about` is **folded into the text** (`About the ${kind} "${name}": …`,
   `use-config-run.ts:504-508`), so m5 is right that it becomes part of
   `content`, not chrome that "stays beside the box". The About *chip* stays host
   chrome (`:518-527`), but its content is inside the text. On attachments:
   `MessageInput`'s seam is `onSendMessage(content, attachments: string[])`
   (`:453-472`, called with `attachments.map((a) => a.path)` at `:2388-2396`),
   while `sessions.message` carries only `text` today — and the wire's `Prompt`
   accepts `images` (max 8), `audio` (max 1) and `input_path`
   (`routes/desktop_sessions.py:1061-1080`). **Decision: carry attachments
   end-to-end.** The ask names pasted images/screenshots as required, so the
   run's send is extended — `run.start(text, about, images)` forwarding to
   `sessions.message{text, images}` — rather than mounting an attach control that
   drops its payload. (If the consult prefers not to extend the run's write path,
   the honest alternative is to **not mount the attach control at all**: the note
   forbids the middle state, a control that appears to collect what the send
   discards.)

### 3.4 The layering problem, and the smallest fix

`shared/` importing `@features/chat/` is the reason "mount the shared composer"
is not free. Two options:

- **(i) Leave the imports and mount it anyway.** Quickest; but it means `shared`
  depends on a feature forever, and the next consumer inherits the coupling. It
  also makes the component's own doc comment false.
- **(ii) Move the chat-owned satellites the composer genuinely needs into
  `shared/`**, chosen by a rule rather than by appearance. **The rule is state
  reach (M4): a satellite may move to `shared/` only if it neither reads the
  canonical store nor issues a command.** Drawn that way it excludes
  `ComposerStatusRow`, which is *not* chat-only furniture — it reaches owner
  commands through `useSessionCommand`/`sessions.command`
  (`composer-status-row.tsx:146`, `:1186-1197`), a write outside the run's remit —
  and excludes the pickers, whose click path reaches the registry and
  `upsertSession`. It *includes* the class that genuinely qualifies:
  `AttachmentsPreview`, which imports only `@shared/*`
  (`attachments-preview.tsx:1-4`), and `SessionStatusStrip`, which imports only
  `@shared/*` plus three sibling arithmetic modules and two **type-only**
  `features/chat` modules (`session-status-strip.tsx:1-36`).

**Recommended: (ii), scoped by the state-reach rule.** Under it the lift is:
`SessionStatusStrip` + its reading modules (`session-cost`/`session-context`/
`session-duration`/`session-model`), `AttachmentsPreview`, and the dictation
indicator. `ComposerStatusRow` **stays in the feature** (it commands) — which
also removes the temptation to hand the run a control that writes. What remains
behind host props is exactly the chat-only surface, and the props are nameable (n1): slash availability is `slash.available && Boolean(onSlashCommand)`
(`message-input.tsx:3427`) and `@` is `mentionsEnabled` (`:748`) — the run passes
neither, so the cut line is checkable rather than a promise. Q7 asks the consult
to confirm the rule before answering.

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
   change, parity frames. The lift list must include the **image binding and
   encoding path**, or step 3's send accepts chips it cannot encode: `WireImage`
   (`features/chat/utils/bound-image.ts:57`), `encodeImageAttachments`
   (`features/chat/components/chat-page.tsx:191`, called `:1708`), and the
   unreadable-attachment refusal beside it (`utils/attachment-read.ts:65`). This is
   the enabling step and it is reviewable on its own.
2. **Add only the seams the run genuinely needs** — with Q5 answered as the
   recommendation there is **no new prop** (the aside rides the existing notice
   band, § 3.3.2); the enabling work is the strip's readings-only use (§ 3.3.3),
   which is a *call-site* choice, not a new prop. Again, no consumer yet.
3. **Mount `MessageInput` on the Agents page**, replacing **only**
   `config-composer`'s `<Textarea>` (`:531-546`) — the run's `RunStrip`,
   `RunActivity`, `Watch`/Stop and `RunSummary` **stay exactly as they are**
   (§ 3.1, B1) — with `conversationId` = the run id (reads allowed, writes denied
   per § 3.3.1), `onSendMessage` = `run.start` extended to carry attachments
   (§ 3.3.4), `frontend` = the run's snapshot with **no** `onCommand`, and the
   About chip and the aside band as host chrome — **two different kinds of host
   chrome (n4)**: the About chip is host chrome rendered by the page **outside** the
   component (beside the box), while the aside sentence is host chrome **inside** it,
   in the composer's notice band (§ 3.3.2). Parity evidence for this step is a frame
   of the **box plus the strip**, not the box alone.
4. **Retire `config-composer`'s bespoke *box*, not the file** (n3). What remains
   in `config-composer.tsx` after the mount is the run's own surface: `RunStrip`,
   `RunActivity`, `RunSummary` (`:66-326`), the `EXAMPLES` row, the About chip,
   the aside band and the strip-height measurement (`:421-439`). The header
   comment is rewritten per § 1.5 at the same time.

A single PR is possible but not advised: step 1 is a pure move that a reviewer
can check mechanically, while step 3 is a behaviour change. Keeping them apart
also keeps the chat unaffected if step 3 slips.

### 3.7 Risks to watch during rollout

- **The leak, restated as a test of § 3.3.1's decision.** The mount denies the
  command write paths (no `onSlashCommand`, no `mentionsEnabled`, no
  `admitChatDraft`). Watch, after a send from the new box: the run id is absent from
  `lop sessions`, from the sidebar, from search and from the chat route, and no
  canonical session row exists for it. **One row the test must EXPECT rather than
  forbid:** `inputByConversation[agents-config]` in the persisted
  `conversation-input-store` (the box's text, § 3.3.1's (a)) — its presence is the
  designed bend, its *visibility anywhere* is not.
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

The UX consult settled the former Q1 and Q8; they are recorded as **resolved**
rather than open.

- **Q1 — RESOLVED (UX consult).** Single-line fields accept on Enter; multiline
  fields (instructions, project, team briefs) take Enter as a newline and
  ⌘/Ctrl+Enter to accept. See § 2.2.
- **Q2 (arch/backend).** Field-level conflict (case 3, § 2.4): compare the fresh
  record field-by-field in the UI (recommended, no backend change), or have the
  backend name changed fields — which would also fix U6 for the conversational
  path?
- **Q3 (product).** Expose `action_class` (the proactive/class control) in the
  Behaviour section? It is a real field the page has never set
  (`desktop_profiles.py:72`).
- **Q4 (product).** Offer a team rename, now that § 1.1 shows the wire allows it?
  Today the name is read-only and a chat/schedule addresses a team by name.
- **Q5 (design) — two options, not three.** The aside sentence's slot: **(b)
  reuse the composer's existing notice band and add no prop**, keeping the box's
  `aria-describedby` on it (recommended), or **(a) a new `hostNotice` slot** above
  the box. **(c) `placeholderOverride` is ruled out** on U4's terms — the sentence
  is a permanent footnote, not an invitation.
- **Q6 (split — product vs impl).** **Q6a (product):** should a configuration
  run's strip show model/effort/context/cost/duration *at all*? **Q6b (impl):** if
  yes, confirm the readings-only strip (b) of § 3.3.3, and that it is a new *use*
  of an existing mode rather than a prop the run already has — so M3 is not
  settled by accident.
- **Q7 (arch) — restate the cut line on STATE first.** § 3.4's rule: a satellite
  may move to `shared/` **only if it neither reads the canonical store nor issues
  a command**. Confirm which pass it (`SessionStatusStrip` + readings,
  `AttachmentsPreview`, the dictation indicator) and which are excluded
  (`ComposerStatusRow`, the slash/`@` pickers).
- **Q8 — RESOLVED (UX consult).** The check/x: 32x32 hit area, visible only while
  dirty, immediately after its field in the tab order, labelled, never the only
  route to commit. See § 2.2 and § 2.6.
- **Q9 (arch/product) — the question B1 is.** Is the run's **activity/state
  strip** (and its settled summary) in scope for "one composer", or does it stay a
  run-owned surface above the shared box? **Recommended: it stays** (B1, § 3.1) —
  asked so the consult can veto that boundary explicitly rather than by omission.

---

## 5. What this note deliberately does not do

- It does not specify copy or spacing; those are the designer's.
- It does not propose a backend change except where § 1.1 records one already
  owed elsewhere (`validate_target` on the write path, which belongs to *both*
  writers — `agents-conversational-config.md:437-452`).
- It does not decide the `shared/` refactor's namespace beyond the cut line in
  § 3.4; if the consult prefers the minimal mount (option (i)), the note's § 3.4
  and Q7 are the only parts that change.
- It **supersedes** the `config-composer.tsx` header brief (§ 1.5) and the
  placeholder treatment of the aside sentence; rewriting that comment is part of
  the mount PR, not a change to the run's send path.
- It carries no implementation; the second writer (the configuration run) and the
  manual editor keep sharing one `write_profile`/`update_team`, so no second way
  to edit a record is introduced by either scope.
