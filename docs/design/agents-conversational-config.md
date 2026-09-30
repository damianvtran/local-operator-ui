# Agents and teams: a structured page, and configuration by conversation

Status: **design proposal, implementation not included.** This note is the
anchor for the design-consult and UX-exploration comments that follow it; it
names the recommended mechanism, the alternatives it beat, and the questions the
consult has to settle before code is written.

Author: architect (lopdev team), 2026-09-30.

Written against UI head `9dd18ab318` (`origin/main`) and backend
`origin/main` at `144a6fa86` (`local-operator`). Every backend citation was read
with `git show origin/main:<path>` because the shared backend checkout sits on a
feature branch; UI citations are this tree. Line numbers drift, so each claim
also names the symbol it is about.

Read with: `docs/branding.md` (the design contract; § 7 for how agent work is
shown), `AGENTS.md` (headless-run and frame-capture recipes, release rules),
`docs/run-sidebar.md` (§ 5.3, the per-child pulse this note reuses), and
`docs/design/panels-without-session.md` for the house style of a design note.
PR #681 (`feat/agent-hub-ux-revamp`, the Agent hub's browse bar, Agents | Teams
tabs and scope chips) is being coordinated with; it does not touch
`features/agents/`, and § 6 says what this note takes from its shape.

---

## 0. The problem as found

The `/agents` route is where an operator defines reusable agents (roles and
specialists) and teams. It is the page every other surface points at for
"make me a reviewer that..." and it is the weakest page in the app.

**A. The editors are raw free-text forms.** `AgentsPage`
(`features/agents/components/agents-page.tsx:533`) is a 256px list column
(`:587`) holding two buttons that toggle Agents and Teams, a create button and a
name-only list, beside a main pane that shows either a placeholder sentence or
an editor. `ProfileEditor` (`:34`) is a stack of labelled inputs: name, a
`<select>` for kind (`:223`), description, a free `<textarea>` for
instructions (`:246`), and `tools` as a **comma-separated string** that is split
on save (`:64-69`). `TeamEditor` (`:311`) is the same shape: manager as a bare
text input (`:427-431`), members as rows of a name input plus a kind `<select>`
whose second option reads "Nested team" (`:451`), and two more textareas for
"Collaboration instructions" and "Project brief" (`:508`, `:517`). Nothing
tells the operator what a field is *for*, whether a member name resolves, what
source a profile came from, or what it diverged from. A team member typed with a
typo is accepted by the form and refused (or worse, silently unresolvable) later.

The wire already carries far more than the form shows. `ReusableProfile`
(`shared/api/local-operator/profile-hooks.ts:9`) has `source`
(`builtin | installed | custom`), `seed_origin`, `divergent_fields`,
`packaged_instructions`, `delegate`, `effort`, `tools`, and `already_installed`.
The page renders almost none of it.

**B. Authoring is a chore that an agent could do.** The operator's own model of
this work is a sentence: "add a reviewer that only reads code", "put the coder
and reviewer in a team called shipping". The backend can already do exactly that
from inside a conversation: the `agent` tool (`tools/agent_tool.py`,
`AgentParams` `:117`, `write_profile` `:1097`) and the `team` tool
(`tools/team_tool.py`, `TeamParams` `:54`) create and update profiles and teams,
and the desktop feed already publishes an `authoring` frame when they do
(`server/utils/desktop_feed.py:1606`, `_maybe_emit_authoring`), documented as
existing "because the writer is usually an AGENT"
(`shared/hooks/use-desktop-feed.ts:22-28`). What is missing is a door on the
page itself: today the only way to have an agent do this is to ask the main
(Aida) conversation, which puts a configuration chore into the operator's
long-running personal thread.

### 0.1 Goal

1. **Scope A** — replace the form-first page with a structured list + detail
   presentation: sections instead of raw textareas, provenance visible, honest
   states, and the same information architecture as the Agent hub's browse bar
   that #681 lands.
2. **Scope B** — add a composer to the Agents and Teams pages where the operator
   asks, in natural language, to add or edit agents and teams. Sending from it
   starts a **visible, supervised background run**, watchable at a high level
   the way a subagent is, whose resulting agent/team changes then appear on the
   page. Conversational configuration is the **recommended, leading** method;
   the structured editor remains the precise, manual one.

### 0.2 The hard constraint

**A send from this composer never enters the main (Aida) conversation.** Not as
a message, not as a queued turn, not as a tool result, not as a steer. That is
the property the whole mechanism is chosen to guarantee, and § 3 checks each
place a leak could occur rather than asserting it.

### 0.3 Naming: this is not the `/btw` aside

The word "aside" already means something specific in this app, and the two must
not be conflated. The existing aside is an **off-record, model-only** side
question asked *inside an open conversation*:

- it posts `sessions.aside` (`features/chat/aside.ts:540`) to
  `POST /v1/desktop/sessions/{session_id}/asides`
  (`server/routes/desktop_lifecycle.py:488`), which needs an existing session id;
- it has no tools: a model that answers with "a bare tool call (or nothing at
  all)" is refused with `aside_unanswered` (`aside.ts:71-80`), so it cannot write
  a registry;
- its exchange lives in backend memory (a table capped at 64 entries,
  `desktop_lifecycle.py:493`, and 32 turns per exchange, `:505`) and is never
  journalled; the renderer's store states "NOTHING HERE IS PERSISTED"
  (`shared/store/aside-store.ts:26`);
- the operator can *adopt* it into the conversation (`sessions.adopt`,
  `aside.ts:634`).

What this note adds is the opposite on every axis: it has **tools** (the
registries), it is a **real session** with a transcript, it is **never adopted**
into another conversation, and it exists precisely so it does *not* live inside
one. This note calls it a **configuration run** (working name; UI copy is for
the designer to settle). Neither the code nor the copy should say "aside",
"btw" or "workstream" — the last is taken by the agent-opened parallel run
(`resume.py:123`) that is *listed and steerable in the sidebar*, which is also
the wrong disposition here (§ 2.3).

---

## 1. What the platform already gives us

Everything the run needs to be *watched*, *stopped* and *reflected* already
exists; the gap is narrower than it first looks.

| Need | Existing surface | Where |
|---|---|---|
| Create a session with a cwd, model, and agent/team binding | `POST /v1/desktop/sessions`, `CreateSession{cwd, target, model, peer, draft_id}` | `routes/desktop_sessions.py:764`, `:2003` |
| Send it a prompt | `POST .../{id}/messages`, `Prompt{text, mode}` | `:1030`, `:2874` |
| Follow it live | `GET .../{id}/events` (SSE) plus the `watch` lease beat | `:4014`, `:3567`; UI `useDesktopWatchLease` (`shared/hooks/use-desktop-watch-lease.ts:24`), `useCanonicalSessionStream` (`shared/hooks/use-canonical-session.ts:2010`) |
| Stop the current turn without ending the session | `POST .../{id}/interrupt`, `Interrupt{request_id}` | `:1176`, `:3747`; UI `interruptTurn` (`features/chat/interrupt-turn.ts:67`), gated by `session_interrupt` (`:52`, `features.py:331`) |
| Write agents and teams | the `agent` and `team` tools, both `approval_tier="read"` so a write needs no prompt | `agent_tool.py:1470` (rationale `:1460-1469`), `team_tool.py:306` |
| Delete a team | `team_delete`, deliberately a **separate write-tier tool** so deletion always asks | `team_tool.py:339-353` |
| Tell the UI the registries moved | `authoring` frame, one per tick, revision only | `desktop_feed.py:1606`; UI `useAuthoringRefresh` (`profile-hooks.ts:79`) |
| Manual writes | `profiles.*` / `teams.*` ops over `AgentRegistry`/`TeamRegistry` built **fresh per operation** | `routes/desktop_profiles.py:109-114`, `:226`, `:290` |

Three facts in that table shape the design and are easy to miss.

**The registries are shared and re-read.** `registries(request)` builds a new
`AgentRegistry` and `TeamRegistry` for every op ("sees authoring from another
process", `desktop_profiles.py:110`), and the feed's authoring probe hashes the
name set plus each row's content digest once per `CATALOGUE_PROBE_INTERVAL_S`
(`desktop_feed.py:166`, `:1645`). So a write by a session, by the editor, or by
a hand edit on disk all converge on the same refresh. The run needs no
notification channel of its own to make its results appear.

**The `authoring` frame carries only a revision, on purpose.** The feed's
docstring is explicit that "a per-name diff ... is not expressible: the frame
says 'your profile and team lists are stale'" (`desktop_feed.py`, § THE FRAME
CARRIES ONLY THE REVISION). A "what changed" summary therefore cannot come from
the feed (§ 3.6).

**There is no desktop delete for profiles or teams.** `desktop_profiles.py`
registers get/list/install/sync/create/update for profiles and get/list/create/
update for teams (`:117-324`) and nothing that deletes. The only deletion is the
`team_delete` tool. This matters for what the run is allowed to do (§ 3.4).

---

## 2. The mechanism, and the options that lost

### 2.1 What a configuration run must be

Restating the requirements as properties a mechanism has to have:

- **P1 — separate.** It is a different session from Aida's and from any
  conversation the operator has open. Nothing it says or does is written to
  another transcript.
- **P2 — tooled and bounded, by OP and not only by name.** It can reach the
  add/edit ops of `agent` and `team` and little else — `list`/`show`/`search`/
  `create`/`update` (and `install`) — and never `agent reset`, `agent sync` or
  `team_delete`. It cannot read the operator's files, run a shell, or reach the
  network, because the operator asked it to edit two registries, not to act on
  their machine. The containment must be enforced at the declaration seam, and
  that seam must be able to express OPS as well as tool names (§ 3.4; review
  round 1, R1-1).
- **P3 — supervised.** The operator sees that it is running, what it is doing at
  a high level, can stop it, and is told what it changed.
- **P4 — reachable from the UI alone.** The Agents page has no agent shell and no
  terminal; the mechanism cannot depend on a session already existing.
- **P5 — additive.** An older backend must keep working untouched, and an older
  renderer must be unaffected by a newer backend.

### 2.2 Option (i): a desktop-op-spawned background session over the existing surface

The UI calls `sessions.create`, then `sessions.message`, then follows the new
session through `events`/`watch`, and stops it with `interrupt` — the same four
calls that run every conversation, with **one additive field on create** that
says what kind of session this is.

*For:* reuses every hard-won surface (receipts and idempotency keys, the
retire/latch door, the watch lease, the event stream, interrupt); the UI already
has readers for it; it satisfies P4 outright; and it is the smallest backend
delta — a field, an origin value, a door predicate, a capability key.

*Against — and this is the finding that drives the design:* **as the code
stands, this option cannot be built with a hidden session.** The desktop door
(`DesktopSessions.session` → `locate()`, `server/utils/desktop_sessions.py:7071`)
resolves a local id only when `path.is_dir() and is_user_session(path)`; anything
else falls to `remote_row_for` and then `KeyError("Unknown session")`. Every
route that watches, streams, prompts or interrupts goes through that door
(`desktop_sessions.py:2874`, `:3567`, `:3747`, `:4014`). And `is_user_session`
is an **opt-in allow-list** (`resume.py:142`, `USER_ORIGINS`;
`resume.py:1255`): a new origin value is hidden from every listing *and* refused
by the door unless it is registered there. So a run that must be
*unlisted* (§ 2.3) and *watchable* needs a small, explicit, one-origin widening
of the door — not a free ride.

*Also against:* `CreateSession` has no way to say "this is a configuration run".
`Input` is `extra="forbid"` (`desktop_sessions.py:600-601`), so an unknown field
is a 422, which is the documented release-skew behaviour
(`desktop_lifecycle.py:78-108` says so for `AsideInput`) and means the UI must
capability-gate before sending it (§ 3.9).

### 2.3 Option (ii): `lop exec --workstream` from an agent shell

The backend already has a supervised, listed, steerable background run:
`lop exec --workstream`, which stamps origin `agent-workstream`
(`agent_shell.py:356`, `stamp_agent_shell_session`; `resume.py:123`;
`exec_mode.py:149`) and is *registered as a user origin* so listings show it
with an `opened_by` attribution (`resume.py:142`; `catalog.py:1546`).

*For:* it exists today, its listing and attribution are built, and `--tools`
declares an allow-list (`exec_startup.py:441-480`).

*Against:*
- **It needs an agent's shell.** The stamp is only written when
  `agent_shell_opened_run()` is true (`agent_shell.py:192`); outside an agent's
  shell "nothing is stamped and the flag is a no-op" (`exec_mode.py:147`). The
  Agents page has no agent shell (P4). Getting one means asking *some session* to
  run the command — and the only session that is always there is Aida's, which is
  the exact leak the constraint forbids.
- **Wrong disposition.** A workstream is deliberately *listed in the sidebar,
  `/resume` and the phone list* as the operator's parallel work
  (`resume.py:96-122`). A configuration chore would clutter three lists it was
  never meant for, and the row's attribution keys (`agent`, `label`, `session`,
  frozen in `OPENED_BY_KEYS`, `resume.py:3667`) describe an *opening agent*, which
  a UI-initiated run does not have.
- **Approval posture.** A non-tty `exec` without `--control` denies any
  write/exec call instantly (`exec_control.py` module docstring; `--workstream`
  help text in `cli.py` says it "changes only the row's visibility"). The `agent`
  and `team` tools are read-tier so writes would pass, but `team_delete` would
  be denied silently rather than asked, and adding `--control` to make gates
  park brings a supervisor-socket lifecycle the page would have to own.

Rejected: it solves a different problem (an *agent* delegating a long job) and
its two load-bearing properties (needs an agent shell; listed by design) are the
opposite of what is wanted.

### 2.4 Option (iii): a new dedicated op

A purpose-built `agents.configure` op (route family under
`/v1/desktop/agents/`) that creates the session, injects the server-owned
prompt, and returns a `run_id`, with `agents.configure.cancel` and a status read.

*For:* the server owns everything — the preamble, the tool inventory, the cwd,
the model, single-flight — so a client cannot drive the run with an arbitrary
prompt or widen its tools; one capability key; the cleanest security story.

*Against:* it is a **second copy** of create/prompt/watch/interrupt. The
progress stream would need its own frames or would re-expose the session's
anyway; cancellation would re-implement interrupt; idempotency would re-use the
receipt journal by hand. Each duplicate is a place the two paths drift, and the
codebase's own house rule (`desktop_sessions.py`'s door comment: "a list of
gated routes is the defect this replaces") argues against a parallel plane. It
is also the largest change on both repos.

### 2.5 Option (iv): reuse the `/btw` aside

Rejected in § 0.3: no tools, needs an existing session, in-memory only, adopt
semantics. It is the wrong shape on every axis, and reusing its name or store
would make the two states unreadable to the next engineer.

### 2.6 Recommendation: (i), hardened by the server owning the run's shape

**Build option (i), and let the server — not the renderer — own everything about
what the run is.** Concretely, one additive field on `sessions.create`:

```
purpose: "agents-config"     # absent = today's create, byte for byte
```

When it is present the backend:

1. **stamps a new hidden origin** (working name `agent-config`) in the session's
   `origin.json` *before* the session becomes discoverable (§ 2.7);
2. **admits that one origin through the desktop door** for watch/events/messages/
   interrupt/snapshot only, while leaving it out of `USER_ORIGINS` — so it stays
   absent from the sidebar, `/resume`, the phone list, the attention/notification
   feed and the first-run predicate (§ 3.1);
3. **declares the run's reach to the add/edit OPS of `agent` and `team`** — the
   inventory must express ops, not only tool names, or `agent reset`/`sync` ride
   in with the admitted `agent` tool (R1-1) — with no `team_delete`, no shell, no
   file tools and no network, and **injects a server-owned preamble** that says
   what the run is for and what it must not do (§ 3.4);
4. **resolves the cwd and model itself** (§ 3.3), so the client sends neither;
5. **enforces single flight** and answers a second create with the active run's
   id (§ 3.7);
6. is **local-only**: it refuses `peer` with a `purpose` (the registries it edits
   are this device's, § 3.9).

Everything after create — the prompt, the follow-ups, the live view, the stop —
is the **existing** `messages`, `events`, `watch` and `interrupt` surface,
unchanged. That is what makes (i) the smallest correct change: it adds a
*discriminator*, not a plane.

Why not the pure form of (i) (the UI sending a prompt and picking tools)? Because
then the renderer decides the run's authority. A run that can write agent
instructions is a **persistent privilege surface** — an instruction it writes
governs every future session that uses that profile, and `tools: null` means
"whatever the parent would build" (`agent_profiles.py`, `AgentProfile.tools`).
The authority must live where the registries live.

Why not (iii)? It buys the same server-owned shape for the price of a parallel
control plane. (i) with `purpose` gets the security property and keeps one
plane.

### 2.7 Where each piece lives, and the ordering that matters

- **Create.** The route `create_session` (`desktop_sessions.py:2003`) and the pool
  method `DesktopSessions.create` (`server/utils/desktop_sessions.py:5956`) gain
  the `purpose` admission. The marker precedent is `write_desktop_marker(...,
  model=...)` (`:538`), which stores the draft's chosen model as an **additive key
  the first turn is born from**. A `purpose` key follows exactly that shape: one
  additive key in `desktop.json`, read at first boot.
- **Origin stamp, and its ordering.** `mark_session_origin` (`resume.py:500`)
  writes `origin.json`. The stamp must land **before** `desktop.json`, because the
  pool treats the desktop marker as what *materialises* the session
  (`create`'s own comment: "the MARKER, not the registry entry, is what makes an
  id materialised") and the feed memoises the user-session verdict per id
  (`desktop_feed.py:1576`, `_user_cache`). A session whose origin is written second
  can be classified as the operator's own by a scan or a feed tick that lands in
  the gap, and that classification is then cached. Origin first, marker second.
- **The door.** One predicate change in `locate()` (`:7071`):
  `is_user_session(path) or session_origin(path) == ORIGIN_AGENT_CONFIG`. It must
  *not* touch `is_user_session` itself — that predicate is consulted by the
  catalogue (`catalog.py:1106`), the feed (`desktop_feed.py:2133`), the first-run
  scan (`aida/onboarding.py:184`) and the mobile list, and all four should keep
  treating this run as not-the-operator's-conversation.
- **Tool declaration.** This is the piece I could **not** locate on the desktop
  path. `Session.set_tool_inventory` (`session/session.py:8356`) is the enforcing
  seam and `_filter_declared` (`:8301`) makes excluded tools unreachable "by name,
  not only hidden", but its callers are the exec path
  (`exec_startup.apply_startup`, `:441`/`:478`), subagent launch
  (`harness/subagent.py:2990`) and the SDK (`sdk.py:636`). A runtime booted by the
  desktop bridge is built through `session_factory`; whether it exposes a
  startup-declaration hook that reads the marker is **unverified**, and it is the
  first thing the backend spike must settle (§ 8, Q1). If no hook exists, adding
  one that reads a `purpose` marker key is the one non-trivial backend change, and
  it should be the same declaration seam exec uses, not a second one.

---

## 3. How the run behaves

### 3.1 Staying out of the main conversation — checked place by place

A leak is any path by which the run's traffic becomes visible in, or addressed to,
another conversation. Each is closed by a distinct mechanism, and each needs a
test that can fail:

| Leak | Why it cannot happen | Evidence to capture |
|---|---|---|
| The composer's send is a message to the open session | The composer is **not** the app's `MessageInput`. It is a small dedicated component (textarea, send, stop) with no slash dispatch, no attachments, no credential capture, no draft store — the machinery in `shared/components/composer/message-input.tsx` exists to serve a conversation. The send calls `sessions.create` then `sessions.message` on the *run's* id only. | A rendered `/agents` page with a session open elsewhere; the open session's transcript unchanged after a send. |
| The run's session is added to the client's session store and selected | The launch path must call `desktopResult` directly, **not** `createSession` in `canonical-sessions-store.ts:5756`, which `upsertSession`s the new row and would make it a conversation the sidebar tracks. | Store snapshot before/after: no row added. |
| The run appears in listings | The origin is hidden (§ 2.6-2): `USER_ORIGINS` is untouched, so `is_user_session` is false for it in the catalogue, `/resume`, mobile and the first-run scan (`resume.py:1255`, `catalog.py:1106`, `aida/onboarding.py:184`). | `sessions.list` and `sessions.search` with a run live: not present. |
| The run raises a toast, an unseen dot or a notification | The feed's user-session filter (`desktop_feed.py:2133`) drops non-user identities from `session_status` and `attention`. The completion signal is the page's own strip, not the notification plane. | Feed capture during a run: no `attention` for the run's id. |
| Aida hears about it | Aida's context is her transcript and her wakes. The run writes only to its own transcript and the registries. She sees the *result* — the registries changed — the same way she would see a hand edit. | Aida's transcript byte-identical across a run. |
| A follow-up lands in the wrong place | The composer holds exactly one run id in component state; a follow-up is `messages` to that id. There is no "current session" fallback. | Two runs in sequence; each follow-up in its own transcript. |

The renderer-side rule that keeps this honest: **the composer's state has no path
to `stageDraft`, `upsertSession` or the chat route.** The current page already
hands a *different* action to chat — "New chat" calls
`useCanonicalSessionsStore.getState().stageDraft(...)` then `navigate("/chat")`
(`agents-page.tsx:188`). The composer must not share that code.

### 3.2 How it is listed and watched "at a high level"

Not in the sidebar (that would be the wrong disposition, § 2.3). It is watched
**where it was asked**: a **run strip** anchored to the composer on the Agents /
Teams page, and nowhere else.

The strip reads the run's session the way the run panel reads a subagent child
— by pulse rather than by stream deltas. `docs/run-sidebar.md` § 5.3 and
`shared/hooks/subagent-pulse.ts` establish the pattern: the child's durable state
"may have grown" on `subagent_start` / `subagent_progress` / `subagent_end`, and a
coalesced tail read follows the beat, because a delta is the wrong signal for a
durable projection. A configuration run is a *top-level* session rather than a
child, so it follows its own event stream through `useCanonicalSessionStream`
(`use-canonical-session.ts:2010`, the hook the chat pane uses) and projects it
down to a few lines: the current step (the latest tool call's label — "Updating
agent `reviewer`"), the entities touched so far, and the elapsed time. Reasoning
is hidden by default and a completed action is one quiet line, per
`docs/branding.md` § 7.

The watch lease (`useDesktopWatchLease`) is what marks the viewer visible and
keeps the runtime warm; the strip mounts it while a run is live and releases it
on settle. **The exact projection — which frames name a tool call and its target
— needs a spike** against a real run (§ 8, Q4); I have not assumed frame names
beyond the three the pulse module already uses.

### 3.3 Working directory, profile and model

- **cwd.** `CreateSession` requires a folder for a local create; an empty one is a
  422 because it would resolve to "the server's own working directory — a
  directory the user never named" (`desktop_sessions.py:801-818`). The run has no
  file tools (§ 3.4), so cwd is not authority, but it is still stored in the
  marker and shown in diagnostics. Recommendation: **the server resolves it** when
  `purpose` is set (a carve-out in that validator, stated where the rule is), to
  the config directory. The renderer should not invent a path it cannot verify
  exists.
- **Profile.** No bound `target`. The shipped seeds are `aida`, `architect`,
  `coder`, `copy-reviewer`, `designer`, `manager`, `reviewer`, `scout`,
  `tui-designer`, `ux-reviewer` (`agent_seeds/manifest.json`); none is a config
  author, and adding one would put it in every operator's agent list:
  `profile_catalogue` (`server/utils/desktop_profiles.py:90`) unions the
  registry's roles and specialists with the packaged starters — `|
  set(list_seeds())` at `:93`, over `agent_profiles.py:313` — so a new
  `agent_seeds/<name>.md` reaches every operator's list, not only a run's.
  Recommendation: a **server-owned preamble** in code, versioned with the backend,
  not a seed. Trade-off: the operator cannot tune it. That is the right default
  for a bounded-authority run; Q6 asks whether it should be user-visible.
- **Model.** The configured default, chosen by the server, via the same
  resolution `create` already applies when `model` is omitted
  (`desktop_sessions.py` create docstring: "No `model` ⇒ ... byte-for-byte
  today's"). The strip should **name the model** in its details, because a send
  is a paid turn. Whether the operator may pick a different model is a consult
  question (Q7); the default is "no picker in v1".

### 3.4 What it may edit, and what it may not

Allowed: the `agent` tool's `list`, `show`, `search`, `create`, `update`
(and `install` of a packaged starter), and the `team` tool's `list`, `show`,
`create`, `update` (`agent_tool.py:117-130`, `team_tool.py:54`). That is the
"add or edit agents and teams" the operator asked for, through the *same* write
functions the manual editor's `profiles.*`/`teams.*` ops use
(`desktop_profiles.py:226` calls `write_profile` from the tool module), so the two
paths share one writer and the field validations that writer applies (effort
against the live configuration; name collisions — `NameTakenError`).

**What is NOT validated on write, on either path — and must not be claimed as
parity (review round 1, R1-2).** `validate_target`
(`server/utils/desktop_profiles.py:110`) has **no write-path caller**. Its callers
are the session *binding* paths (`server/utils/desktop_sessions.py:5991`,
`:6115`; `routes/desktop_sessions.py:2208`, `:2310`, `:2416`) and the TUI's move
(`tui/app.py:30506`) — never the desktop `teams.*` ops, which call
`registry.create_team`/`update_team` directly (`routes/desktop_profiles.py:296`,
`:304`), and never the `team` tool, which calls the same two registry methods
(`team_tool.py:229`, `:233`). So `MAX_ORG_DEPTH` (`teams.py:148`), the cycle guard
and manager/member resolution are **not** enforced when a team is written: a
roster naming `no-such-agent` persists and renders as an ordinary row — the UX
consult's U7. The configuration run inherits exactly that: it can write a dangling
reference as the manual form can, and the UI is where the operator is meant to see
it flagged (§ 5, U7). Wiring `validate_target` into the write path is a real
backend change that belongs to *both* writers at once (the registry's write arm),
not to the run, and it is not in scope here.

**Excluded by OP, enforced at the declaration seam (review round 1, R1-1).** The
declaration seam is per tool **name**: `Session._filter_declared` narrows on
`getattr(tool, "name")` (`session/session.py:8323`) and `set_tool_inventory` takes
`names: Sequence[str]` (`:8356`). But `reset` and `sync` are not tools — they are
`op=` values of the single `agent` tool (`agent_tool.py:120`, dispatched at
`:1383`/`:1385`). Declaring `agent` therefore hands the run the whole tool, `reset`
and `sync` included, which would give it `sync`'s hub credential path while the
note promises it no network reach. The requirement is stated as a contract with
two allowed mechanisms, and the core coder will state which it built:

- **(a) preferred — op-level exclusion at the declaration/enforcement seam.** The
  seam must express OPS as well as names, so `agent` is admitted for
  `list`/`show`/`search`/`create`/`update`/`install` and `reset`/`sync` are refused
  at the same enforcement point `_filter_declared` uses — an excluded op must be
  *unreachable*, not merely unadvertised (`set_tool_inventory`'s docstring:
  "Declare — and ENFORCE").
- **(b) acceptable — split `reset`/`sync` into their own tools**, so the
  name-level seam excludes them outright. Larger, but it leaves the existing seam
  sufficient rather than widening it.

With that contract, the exclusions are:

- **`team_delete`.** Separate and write-tier "so deletion always asks for write
  approval" (`team_tool.py:339-353`); excluding it is name-level today and stays so
  under either mechanism. A supervised run *could* surface that approval in the
  strip, but the page has no delete affordance today either (`desktop_profiles.py`
  registers none), so a conversational delete would be the first delete in the
  product. Out of scope; noted for a later round.
- **`agent reset` and `agent sync`.** `reset` overwrites operator-edited
  instructions (`agent_tool.py:875`, which prints the replaced text back to keep it
  recoverable) and `sync` pulls from the hub with credentials. Neither is
  "add or edit"; both stay manual, and both must be excluded by (a) or (b) above,
  because neither is a tool the name-level seam can name.
- **Setting `action_class: proactive`.** The proactive class lets an agent attach
  hidden patience waits and run proactive deliveries (`agent_tool.py:217-224`,
  "set it ONLY when the user clearly asked for a..."). Recommended: the run may not
  set it, and says so. Q8 asks the consult to confirm.
- **Everything else.** No `bash`, no `write`/`edit`, no network tools. The
  registry tools write to the operator's *own configuration directory* and are
  "trivially reversible by editing the profile back" (the comment at
  `agent_tool.py:1460-1469`); nothing else has that property.

### 3.5 Progress and cancellation map onto existing surfaces

| Operator action / system event | Surface | Notes |
|---|---|---|
| Send | `sessions.create{purpose}` then `sessions.message` | Two calls; each carries its own `request_id` (`RequestID`, the receipt journal key). A retry repeats the body byte-for-byte or is a 409 (`Prompt` docstring, `desktop_sessions.py:1030`). |
| Follow | `events` SSE + `watch` beat | The viewer subscription id from the stream's `open` frame is what `watch` names (`use-desktop-watch-lease.ts:24`). |
| Stop | `sessions.interrupt` | Gated on `session_interrupt` (`interrupt-turn.ts:52`). It stops the **turn**, leaves the session and its transcript alone, and is idempotent per `request_id` (`desktop_sessions.py:1176`). It is deliberately **not** `sessions.stop`, the kill switch (`interrupt-turn.ts` header). |
| Follow-up | `sessions.message` to the same id | A run is multi-turn: "also give it the browser tool" continues the same session until the operator starts a new one. |
| Result | `authoring` frame → `useAuthoringRefresh` | Lists and details invalidate; § 3.6. |

**Cancellation is not rollback.** The tools write through as they go, so a stop
mid-run leaves whatever it had already written. The copy must say so ("Stopped.
Changes already made were kept."), and the summary (§ 3.6) is exactly the list of
those changes. A designed undo is out of scope; Q9 asks whether the summary needs
one in v1.

### 3.6 How updates land in the UI, and the "what changed" summary

Two independent channels, on purpose:

1. **The lists refresh themselves; the open DETAIL does not, today.** The run
   writes; the authoring probe notices within one probe interval; the frame
   arrives; `useAuthoringRefresh` (`profile-hooks.ts:79`) invalidates
   `["desktop", "profiles"|"teams"]` **and** the singular detail keys
   (`["desktop","profile"]`/`["desktop","team"]` — the hook's comment explains why
   the list key does not reach the detail key). The hook is correct and the
   invalidation does reach the singular key (`profile-hooks.ts:91-95`), but the UX
   consult's **U6 measured the list refreshing in ~4 s while the open detail did
   not change for 14 s+** on this same head. Whichever half is at fault — the
   authoring revision not being raised by the consult's out-of-band patch, or the
   active detail query not refetching on an invalidation it did receive — the note
   cannot claim "this already works", and **U6 is an explicit acceptance test of
   Scope A/B: a change made out of band must appear in the open detail without a
   reload.** The UI PR fixes it; the conversational path depends on it, since
   "then the changes appear on the page" is this promise.
2. **The run's settle also invalidates, unconditionally.** The feed is
   capability-gated both ways (`use-desktop-feed.ts`: `available:false` for an
   older backend or a browser-dev build with no relay), and a lost frame after a
   sleep/wake is not distinguishable from a quiet machine. On run settle the page
   invalidates the same keys itself, so the result appears even when the frame
   never does. (The hook already refetches on reconnect; this covers the gap
   between "run ended" and "socket back".)

**The summary is built client-side from two things**, because the feed cannot
carry a diff (§ 1):

- the **touched set** — the `(entity, op, ok|error)` triples from the run's own
  tool-call rows, which is authoritative about *which* entities it touched and
  covers fields the catalogue omits (instructions, collaboration and project
  briefs are `exclude`d from `team_catalogue`, and `profile_catalogue` builds with
  `detail=False`, `desktop_profiles.py`); and
- a **before/after diff over the catalogue fields** the lists *do* carry —
  description, kind, tools, effort, delegate, class, manager, members — taken from
  the already-cached lists at send time and at settle.

Together they let the strip say "Created `shipping` (team, 2 members). Updated
`reviewer`: tools narrowed, instructions edited." Instruction *text* is not diffed
in v1 (the list omits it); the entity's detail view is one click away. The fields
worth highlighting in the summary are the ones that change **authority**: tools
widened or set unrestricted, `delegate` turned on, class changed. That is where the
persistent-privilege concern of § 2.6 is answered for the operator: the change is
named in words at the moment it lands, not discovered later.

### 3.7 Single flight, and re-attaching

**One live configuration run per config root, enforced by the server.** The
registries are global to the machine, two runs racing on the same row would be
last-writer-wins, and a second window or a restarted renderer should join the
running one rather than start a rival. The team registry serialises writers with a
file lock (`teams.py:1421`, `_persistence_lock`), but that protects file integrity,
not intent — two runs could each write a *valid* team and the second silently
replaces the first.

Mechanism: a `create` with `purpose` while a run is live answers **409 with a code
and the active run's `session_id`** (the form the route already uses for typed
refusals, e.g. `{"code": ..., "message": ...}` in `create_session`), and the UI
re-attaches to that id instead of erroring. The same lookup is how a page that
mounts mid-run finds it after a reload; the renderer persists **nothing**, for the
opposite reason to the `/btw` aside store — that one keeps its exchanges in memory
because they are off the record (`aside-store.ts:26`), while this run is a real
transcript the server owns, so the server is the source of truth and a client copy
would be the second place the two could disagree.

A **manual editor save during a run** is the second concurrency case. The page's
existing idempotency (`request.current` in `ProfileEditor`, `agents-page.tsx:56`)
protects retries, not interleaving. Rule: if the operator has **unsaved edits** on
an entity when a run touches it, the detail view shows a non-blocking banner
("Changed by the setup run — reload, or keep yours") and does **not** replace typed
text. Otherwise the view updates in place.

### 3.8 Failure and offline states

| Situation | What the operator sees | Basis |
|---|---|---|
| Backend older than the feature | The composer is absent; the structured editor is the only path, with one honest line saying conversational setup needs a backend update. | `desktopFeatureState` distinguishes `unknown`/`unpaired`/`below-version`/`enabled` (`desktop-hooks.ts:612`); the page already words its own below-version state (`agents-page.tsx`, "Update the backend to manage reusable agents"). |
| Create refused (daemon retiring, latch, no usable model) | `refused`: the backend's own sentence via `userFacingMessage`, with the message retained in the composer so nothing typed is lost. | The `/btw` aside's `asideAskFailure` habit (`aside.ts:63`) is the precedent; `DaemonRetiring`'s message says to reconnect. |
| Run errors (the turn fails) | `error`: what failed, the touched set so far ("it had already updated `reviewer`"), and a retry that sends a **new** request id. | Same receipt rule as § 3.5. |
| Run is slow | Stays `running`. **No timeout copy** — a turn's duration is the model's, and inventing a threshold would call a healthy run broken. The elapsed time is shown; Stop is always there. | — |
| Feed/socket down mid-run | "Connection lost. The setup run may still be going." The run is server-side and continues; on reconnect the page re-attaches through § 3.7. | `use-desktop-feed.ts` reports `connected`/`available` separately, and its header argues a dead socket must be surfaced, not swallowed. |
| Window closed mid-run | The run finishes on the server; on next open the page re-attaches and shows the settled state with its summary. | § 3.7. |
| Two windows | Both see the same run (server-owned). Only one may hold the composer's send; the other shows "Already running." | § 3.7 |

### 3.9 Capability gating, and who may drive config edits

**Capability.** A new feature key (working name `agents_config`) in
`server/features.py` (alongside `profile_catalogue`/`team_catalogue`, `:54-55`) and
in the `DesktopFeature` union (`desktop-hooks.ts:194`). It is **its own key, not a
version bump of an existing one**, for the reason `interrupt-turn.ts` gives for
`session_interrupt`: an older backend "answers an unknown operation with a masked
422" and must never be told it can do this. The composer requires **all of**
`profile_catalogue`/`team_catalogue` (to read and show results), `agents_config`
(to start), and `session_interrupt` (to stop). A supervised run the operator cannot
cancel is not acceptable, so a backend advertising the first two but not the third
gets the structured page and no composer.

**Who may drive edits.** Reasoning it through rather than assuming:

- The route family is behind the desktop bearer (`require_desktop`,
  `desktop_profiles.py:36`), the same authority that can already call
  `profiles.create`/`teams.update` directly. The config run does not widen *who*
  may edit; it changes *what does the typing*.
- What is new is that the writer is a **model**, and a model reads text. A hub-pulled
  agent's instructions, or a name the operator pasted, is untrusted input to a
  session that holds write access to the registries. The defence is that the run's
  authority is exactly the two registry tools and nothing that reaches beyond the
  config directory (§ 3.4) — and that it is declared by the **server** at the
  inventory seam, where "the excluded tools are not reachable" is enforced rather
  than requested (`_filter_declared`, `session.py:8301`). A model that is talked
  into wanting a shell simply does not have one.
- The residual risk is a **persistent instruction the run writes** that a later
  session then obeys. That is why the summary highlights authority-changing fields
  (§ 3.6) and why the run may not set the proactive class (§ 3.4). It is a real
  residual and is listed in § 8 for the consult rather than declared solved.
- **Local only.** `CreateSession.peer` (`:789`) with a `purpose` is refused: the
  registries are per-device, and a config run that edited a peer's would need the
  definitions-sync story, which this note does not attempt.

---

## 4. The configuration run's states, affordances and surfacing (UI)

### 4.1 States

Five states the strip paints, plus one transient. The vocabulary is the
operator's ("running", "done"), not the wire's.

| State | Meaning | On screen | Controls | Live-region text |
|---|---|---|---|---|
| `idle` | No run, composer empty or being typed | Composer only; a one-line hint and a few example requests | Send | — |
| `running` | Create/message accepted, turn in flight | Strip: current step, touched chips accumulating, elapsed; composer disabled for a *new* topic but enabled for a follow-up | Stop | "Setting up…" then the step, coalesced |
| `stopping` | Stop sent, turn not yet settled | Same strip, step reads "Stopping" | none (Stop is spent) | "Stopping" |
| `done` | Turn settled without error | Summary: what changed (§ 3.6), links to each entity, the run's closing sentence | Dismiss; send a follow-up; start a new one | the summary sentence |
| `stopped` | Settled after Stop | Summary of what was already written; "Changes already made were kept." | Dismiss; follow-up | as above |
| `error` | Refused, or the turn failed | The failure sentence, touched set so far, the retained text | Retry (new id), Dismiss | the failure sentence |

A `done` with **zero touched entities** is its own honest case: the run answered a
question ("what does the reviewer role do?") and changed nothing. It says so
instead of showing an empty "Changes" list.

### 4.2 Progress affordances

Indeterminate by construction: there is no percentage to show and inventing one is
the fake-progress failure `docs/branding.md` § 7 warns against. What the operator
gets instead is *evidence of motion that is also information*: the current step in
words, chips for entities as they are touched (so the row they will see in the list
is already named), and elapsed time. The details expander shows the run's tool rows
in the § 7 hierarchy — a completed action is one quiet line, internal reasoning is
hidden by default.

### 4.3 Surfacing without jank

The failure modes of a live-updating page are the reordered list and the vanishing
selection. Rules the implementation should be held to and the QA capture should
check:

- **The strip's slot is reserved.** It occupies its height from first paint (an
  idle placeholder or the composer's own bottom edge), so it appearing on send does
  not push the detail pane. Measure content-box vs pinned height across the
  `idle → running → done` frames, per `AGENTS.md`'s visual-validation section.
- **The list does not reorder under the cursor.** The catalogue is sorted
  case-folded by name (`team_catalogue`/`profile_catalogue`), so a created entity
  inserts at a stable position; the row keeps its box and the list keeps its scroll
  anchor. Verify with a run that creates a row above the operator's scroll position.
- **Never auto-navigate.** A run that creates `shipping` does not select it; the
  summary offers "Open `shipping`". Moving the operator's selection would discard
  an in-progress read.
- **Changed rows get a quiet mark, not motion.** A small "Updated" tag that clears
  when the row is opened. Nothing lifts, scales or translates on hover; focus is an
  outline (`docs/branding.md` § 6).
- **A selected entity updated remotely updates in place — once U6 is fixed.** This
  is *not* today's behaviour: the consult measured the open detail stale for 14 s+
  after an outside change (U6). It is an acceptance criterion of this work (§ 3.6
  item 1), and the qualifier stands — if the operator has unsaved edits on the
  entity, § 3.7's banner applies instead of a silent replace.
- **The composer keeps its text on any refusal.** A retained draft is the
  difference between "the backend was down" and "I lost what I typed".

---

## 5. Scope A: the structured list + detail direction (brief)

This is direction, not a spec; the UX exploration comments refine it.

**Shape.** Keep the two-pane structure the page already has (list left, detail
right) but make both carry information. It is a *list + detail*, not a modal form.

**List.**
- Agents | Teams as the app's own `Tabs`, each tab carrying its count, replacing
  the two `Button`s at the top of today's list column — the same control #681's browse bar
  uses, so the two surfaces read as one system.
- Each row: name, a **source badge** (built-in / installed / custom, from
  `source`), the one-line description, and for teams the member count. A search
  field above the list; a filter for source. Rows are alphabetical (the wire's
  order) and never reorder on selection.
- The empty state is not a blank pane: it leads with the composer ("Describe the
  agent or team you want") and demotes "Create manually".

**Detail — sections, not one long form.** Each section is read-first and edits in
place with its own Save, so one small change does not re-submit the whole record
and a dirty section is visibly dirty.

- *Overview* — name, description, source and, for a hub-pulled or installed
  profile, where it came from.
- *Behaviour* — the instructions as a rendered read view with an expander; the
  textarea appears only when this section is being edited.
- *Tools* — the allow-list as chips with an explicit "all tools" state. Today's
  comma string cannot say "unrestricted" versus "empty": `tools: null` means
  "whatever the parent would build" while a list filters to exactly those names
  (`agent_profiles.py:180`, `AgentProfile.tools`) — two different meanings the form
  renders identically. A tool picker needs a catalogue of tool names — Q3.
- *Delegation and autonomy* — `delegate` as a switch, `effort` as a select, class as
  a labelled control (the `action_class` field exists on `ProfileEdit`,
  `desktop_profiles.py:72`, and the page never sets it).
- *Provenance* — `divergent_fields`, `seed_origin`, and the reset-to-packaged
  affordance where the wire supports it. This is information the wire already
  ships and the current page discards.
- *Teams* — manager and members as **rows with resolved state**: a kind icon, the
  count as a stepper, and an inline warning when a referenced name does not
  resolve. **The resolution check must be the UI's**, because nothing on the write
  path performs it (R1-2; § 3.4): `validate_target`
  (`server/utils/desktop_profiles.py:110`) is wired only to the session *binding*
  paths, so a dangling manager or member saves silently today (U7). The editors
  should offer resolved names, and the warning is the honest state for a stored
  roster that already names something missing. Collaboration and project briefs
  are sections with the same read-first treatment.

**Actions** live in a header: New chat, Extend, Install (built-ins), and a new
**"Edit with setup assistant"** entry that opens the composer prefilled with the
entity's name — the conversational path is reachable from the detail, not only the
page foot.

**Honest states** on both panes: skeleton while loading, an empty state that says
what to do, an error with a retry that names the cause, and the existing
below-version / unpaired wording (`desktopFeatureState`). The page currently
collapses list, team and detail errors into one `role="alert"` block
(`agents-page.tsx`); each pane should own its own.

**Acceptance criteria carried in from the consults** (so a reader of this note
alone knows what is owed, not only a reader of the PR thread):

- **U1 — the save dead-lock must be fixed here.** `ProfileEditor`'s `save` sets
  `request.current ??= {id, body}` **before** the call and clears it only on
  success, so a *definite* 4xx refusal (a bad effort tier, a duplicate name)
  leaves the ref set and the next edit trips the `body !== request.current.body`
  guard — "The previous save has not been confirmed" on a form the user has just
  corrected (`agents-page.tsx:56`; the same shape at `:328` for teams). The guard
  is right for an **ambiguous** outcome (a dropped request); it is wrong for a
  definite refusal, which should free the request id. Scope A must fix it: Scope
  B's fallback path lands on this same form, so the dead-lock would greet every
  operator whose conversational request the agent could not complete.
- **U6 — the open detail must refresh** (§ 3.6 item 1).
- **U7 — an unresolved team reference must be visible** (Teams section, above).

**Consistency with #681.** Take, do not copy: the Agents | Teams `Tabs` with
counts, the aria-live status-sentence habit, and the scope-chip *pattern*. The
Agent hub's scope axis is public/organisation; this page's is on-device and
source. Until #681 lands the page should not fork those components — build to the
same contract, import when merged, and rebase over #681's changes. The two PRs do
not share files (#681 does not touch `features/agents/`), so the coordination cost
is visual and IA, not a merge.

---

## 6. Sequencing, and what can move independently

1. **Backend PR** (`local-operator`): `purpose` on create, the hidden origin,
   the door predicate, tool declaration and preamble, single flight, capability
   key, and tests that can fail (a hidden run is absent from list/search/feed/
   first-run; a run is reachable by watch/events/interrupt/message; a second create
   returns the active id; `peer` + `purpose` is refused; an older body is
   byte-identical). This has its own release train and the UI must ride behind the
   capability.
2. **UI Scope A**: the list + detail shell. Independent of the backend; can start
   now. It defines the slot Scope B's strip sits in.
3. **UI Scope B**: composer, strip, summary, re-attach. Lands behind
   `agents_config` and `session_interrupt`.

A and the backend PR are parallel; B needs both. Splitting B out of A keeps each
change reviewable, and a backend without the UI (or the reverse) is a no-op by
construction, which is the release-skew property P5 requires.

---

## 7. Risks to watch during rollout

- **The door widening is the sharpest edge.** It is one predicate, but it turns
  "hidden means unreachable" into "hidden means unlisted" for exactly one origin.
  The test must assert both that the run is reachable by id *and* that a
  `subagent`- or `agent-shell`-origin session is still refused — the widening must
  not generalise.
- **Origin/marker ordering** (§ 2.7). A scan or feed tick that lands between the two
  writes can misclassify the run and cache the verdict (`_user_cache`). Assert
  origin-first.
- **A hidden session's lifecycle.** Retention and cleanup of a hidden, machine-made
  session is unread (`session/retention.py` keeps `origin.json` as bookkeeping, but
  I did not trace when hidden directories are reclaimed). Left alone they
  accumulate; Q5.
- **The op-level exclusion (R1-1).** Containment now rests on the declaration
  seam expressing OPS; if it only ever narrows by name, `agent reset`/`sync` ride
  in with the admitted `agent` tool. The test must assert the excluded ops are
  *unreachable*, not merely absent from the advertised list — the same bar
  `_filter_declared` already meets for names.
- **The detail's refresh (R1-3/U6).** Scope B's "the changes appear on the page"
  promise is the detail-refresh behaviour the consult measured as broken; do not
  sign off the run on a green list refresh alone.
- **Persistent instructions** (§ 3.9). The run writes text future sessions obey.
  Watch the authority-changing fields in the summary, and watch for the first
  operator report of a profile that "changed by itself".
- **Interleaved manual edit and run** (§ 3.7). The banner rule prevents lost typing
  but last-writer-wins on the file is still real; look for it in QA.
- **Paid-turn surprise.** Each send is a model turn. If the model is not shown, the
  first bill is the discovery.
- **Frame assumptions.** The step projection (§ 3.2) rests on frame shapes I did not
  read; the spike must capture a real run before the strip is built against a guess.

---

## 8. Open questions for the design consult

Each is answerable by evidence or a decision, and each says what would settle it.

- **Q1 — the tool-declaration seam on the desktop path.** Does a desktop-bridge
  runtime expose a startup-declaration hook that can read a marker key, or must one
  be added? *Settle by:* tracing `session_factory` from the bridge's engage to
  `set_tool_inventory`. This decides whether the backend PR is small or not.
- **Q2 — status when nobody is watching.** The run is excluded from the feed's
  `session_status` (§ 3.1). Is the strip's own event stream enough, or does a page
  that mounts mid-run need a cheap "is a run live?" read (a `GET` or a field on a
  list)? *Settle by:* prototyping re-attach after a reload.
- **Q3 — a tool-name catalogue.** The Tools section needs the names an allow-list can
  hold. Is there an existing op (the MCP catalogue is one shape, `mcp-list.ts`), or
  does the section fall back to a validated free chip input?
- **Q4 — which frames name a tool call and its target** so the strip can say
  "Updating `reviewer`". *Settle by:* capturing one real create and one update run
  and reading the frames; do not build the projection from this note.
- **Q5 — reclaim policy for hidden run sessions.** When are they removed, and is a
  bounded history ("last run") useful to the operator or just residue?
- **Q6 — is the preamble visible?** A server-owned preamble is safe; it also cannot
  be tuned. Should the operator be able to read it (a details line), and should a
  future version let them extend it?
- **Q7 — model choice.** Default-only in v1, or a picker? If default-only, is the
  model named in the strip's details?
- **Q8 — proactive class, and other authority fields.** Confirm the run may not set
  `action_class: proactive`; decide whether widening `tools` to unrestricted or
  turning `delegate` on should require an explicit confirm in the strip.
- **Q9 — undo.** Is "the summary lists what changed" enough for v1, or does a run
  that overwrote instructions need a recoverable prior state (`reset` prints the
  replaced text back for this reason, `agent_tool.py:875`)?
- **Q10 — global indicator.** If the operator navigates away, is a run on the
  Agents nav item worth a marker, or is the page-local strip plus re-attach enough?
- **Q11 — the composer's placement and weight** (designer): docked at the foot of
  the main column, or leading the empty state and collapsing to a bar? How does it
  read beside the app's main composer without looking like a second chat?
- **Q12 — delete.** No `profiles.*`/`teams.*` desktop op deletes anything today (the
  only deletion is the `team_delete` tool), and the Agents page has no delete control. Is that a gap to close (manual first) before conversational delete is even
  discussed?

---

## 9. What this note deliberately does not do

- It does not touch `docs/branding.md`, the theme palettes or the contrast
  contract. A new component with its own fill and border needs a row in `CONTROLS`
  in `scripts/contrast-contract.mjs` when it is built (`AGENTS.md`), which is an
  implementation task.
- It does not design the Agent hub, and it changes nothing #681 owns.
- It does not decide a delete story, a peer-device config story, or a custom
  per-operator preamble; each is named in § 8 as an open question rather than
  smuggled in.
- It does not claim the mechanism works. Q1 and Q4 are the two facts the design
  rests on that I could not verify from source; both are cheap to settle with a
  spike, and both should be settled before the backend PR is opened.
