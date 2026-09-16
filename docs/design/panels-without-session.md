# Panels without a session — the shell's second presentation slot

Status: **design contract, implementation not included.** One implementer follows
this document; no backend change is expected (§ 1.1, § 1.2) and none is required
for either requirement.

Written against UI head `647396910` (`fix/panels-without-session`, off
`origin/main`) and backend head `e368e69a5` (`local-operator` `origin/main`,
checked out of a stale local branch, so every backend citation below is read from
`git show origin/main:…`). Line citations are against those two trees.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
evidence, release mechanics), `docs/command-palette.md` § "Panels are
destinations, not routes" (the contract this document amends), and
`docs/design/panel-views.md` (the panels themselves; § 13 there is the "no router
routes" decision this document keeps).

---

## 0. The problem as I found it

Two requirements from the operator, and the four gates in the code that answer
them with a refusal.

R1. **`/info` and `/analytics` must run with no open conversation.** The
screenshot that prompted this shows the composer on an empty "Start of
conversation" pane answering `/analytics` with:

> /analytics needs an open conversation. Start one first.

That sentence is the dispatcher's own, verbatim — `slash-dispatch.ts:489`, one of
three `if (!sessionId)` sites in the same function. The panel it refused is a
pure read: `/info` describes the install and every runtime on the machine, and
`/analytics` describes the ledger across every conversation. Neither needs a
conversation to be read, and neither reads one.

R2. **A panel must be viewable from any page.** Today the only way to name a
panel from outside the chat route is the command palette, and its panel rows
route the user back to chat before presenting anything
(`command-palette.tsx:327`: `if (!location.pathname.startsWith("/chat"))
navigate("/chat")`). Choosing "Analytics" while reading Settings therefore
throws the user out of Settings.

**Two gates the recon did not name**, and both would survive a fix of the ones it
did:

- `use-palette-sources.ts:465` gates `analytics` (and `session.diagnostics`) a
  *second* time on a live session, so R1's panel is hidden from the palette even
  once the dispatcher stops refusing it.
- `slash-contract.ts:687-713` (`NO_CONVERSATION_CLAUSE`, `stagedNote`) prints the
  dispatcher's refusal **before the keypress** on a pane with no session. Fixing
  the dispatcher without this makes the composer promise a refusal it will not
  deliver; leaving this alone makes it print a refusal for a command that then
  runs. One of the two is wrong, and it is this one.

---

## 1. Ground truth that shapes the design

Each of these was read, not recalled.

1. **The backend is already session-independent, so no Python change is
   expected.** `GET /v1/desktop/analytics` takes
   `session_id: str | None = Query(default=None, …)` and its own payload declares
   `daily_scope: "all_sessions"`
   (`local_operator/server/routes/desktop_catalogues.py:151-176`).
   `GET v1/desktop/info` takes **no parameters at all** (`:…/info`, same router),
   and the `/info` comment in `slash_commands.py:363-367` states why the read is
   built from an empty `LiveState`. The evidence for the label — the panel
   describing "the machine this app is connected to" — is § 14 of
   `panel-views.md` and is unchanged by this work.
2. **The catalogue already offers the destinations.** The three rows exist on the
   backend's `origin/main`: `desktop_destination="usage"` (`slash_commands.py:421`),
   `"info"` (`:474`), `"analytics"` (`:498`). The `/info` row landed in
   `1e1a48dde` and is in `v0.54.44` and later, so this is a pairing floor the QA
   matrix records rather than a change to make.
3. **The renderer's transport already supports it.** `analytics.get` omits
   `session_id` when it is absent (`desktop-contract.ts:1934-1941`) and
   `info.get` builds a bare path (`:1943-1945`). `analyticsQueryOptions` already
   documents `undefined` as "every session on this machine"
   (`panel-queries.ts:44-52`). Nothing to change in either file.
4. **What the three views actually read.** Measured by reading their signatures,
   not assumed:

   | view | file:line | reads from its context |
   |---|---|---|
   | `UsageView` | `usage-view.tsx:777` | `onClose`, `action` (its `provider` filter, `:779`) |
   | `AnalyticsView` | `panels/analytics-panel.tsx:415-437` | `sessionId` (only for the scope toggle), `onClose` |
   | `InfoView` | `panels/info-panel.tsx:570-585` | `sessionId`, `canonical.frontend`, `onClose`, and the `diagnostics` capability |

   None of the three reads `spec`, `commands`, `dispatch`, `rebind`, `note` or
   `draft`. A `grep` for `note(` across `panels/*.tsx` and `usage-view.tsx`
   returns nothing: **no machine panel writes to the transcript today**, which is
   what makes § 6 a typing decision rather than a behaviour change.
5. **The picker host is a Radix modal portalled to `document.body`.** `PickerHost`
   renders `<Dialog>`/`<DialogContent>` (`picker-host.tsx:830-836`) and
   `DialogContent` portals (`shared/components/ui/dialog.tsx:77`). It does not
   structurally need to live inside the chat pane — but note § 1.6.
6. **A native `WebContentsView` paints above all DOM, and the picker host does
   not register with the policy that hides it.** `browser-view-policy.ts:14-19`
   states the fact; `BaseDialog` registers on every dialog
   (`base-dialog.tsx:108-120`); `PickerHost` uses `DialogContent` directly and
   contains no `suppressBrowserView` call (grep over `src/` finds call sites only
   in `app.tsx`, `base-dialog.tsx`, `sheet.tsx`, `update-notification.tsx`,
   `browser-surface.tsx`). Today this is invisible because opening a panel always
   navigates to `/chat` first, so the browser route is unmounted. **R2 removes
   that accident**, so this becomes load-bearing (§ 9, item 6).
7. **The presentation slot is the pane's own hook state.** `picker` is a
   `useState` inside `useSlashDispatch` (`slash-dispatch.ts:288`), consumed by
   `SessionPanel` (`chat-page.tsx:202`) at `:730` and rendered at `:1965`. That
   component is the presenter, so it is also the one that claims the slot (§ 4.2). It dies when the chat route
   unmounts, which is why the palette cannot simply write to it.
8. **The palette's panel rows are gated on pane presence and then navigate.**
   `paneCanPresent = canStageDraft && Boolean(activeSessionId ?? activeDraftKey)`
   (`use-palette-sources.ts:458-459`), `sessionPanelsAvailable =
   Boolean(activeSessionId)` (`:465`), rows built at `:467-538`, dispatch at
   `command-palette.tsx:312-327`, store at `shared/store/chat-panel-request-store.ts`.
9. **The dispatcher's general gate is one branch, below the direct/navigate
   ones.** `slash-dispatch.ts:487-493`. The other two (`:356`, `:419`) belong to
   `/move` and are correct as they are: a move needs a session to write to.
10. **A non-owner command's round trip is not a read.** For a destination outside
    `OWNER_COMMANDS` the command endpoint returns `native_action(spec, session_id,
    args)` without touching the runtime
    (`local_operator/server/routes/desktop_sessions.py:1649-1657`), and the
    backend's own comment says the read-only views need "no `native_action` branch
    or `OWNER_COMMANDS` entry" (`slash_commands.py:345-355`). The POST also needs
    a session id in its path — the one thing a sessionless pane does not have.
11. **The composer's staged copy quotes the dispatcher's refusal from one
    constant**, `NO_CONVERSATION_CLAUSE` (`slash-contract.ts:687-688`), used by
    `stagedNote` (`:705-713`) and `reassembledNote` (`:732-736`); the input is the
    boolean `paneHasSession` (`message-input.tsx:964`, threaded to
    `slash-commands.tsx:250`), which is `Boolean(sessionId)` at
    `chat-page.tsx:794`.
12. **`needsSession` on the argument list is a different question and stays
    alone.** `argumentEmptyCopy` prints "Needs an open conversation. Start one
    first." (`slash-contract.ts:1044-1045`) from `SlashArgumentListState.needsSession`,
    which `useArgumentList` sets when a *session-scoped entity list* has no
    session to query (`slash-commands.tsx:325-330`). The sources that reach it are
    `model`, `effort`, `team`, `agent`, `approvals` (`theme` is explicitly
    exempt, `:317-324`) — all of which really do need a session. None of the three
    machine panels declares an `inline` source
    (`picker-registry.tsx:241-244`), so none of them can reach this copy.

---

## 2. The decision, in one paragraph

`info`, `usage` and `analytics` become a **fourth kind of destination** —
`machine-panel` — whose context is a strict subset of `PickerContext`, and which
the **shell** can present because it needs no pane. The chat pane keeps its slot
and keeps presenting everything it presents today, machine panels included (so a
conversation on screen still gets its own section and its own scope toggle). When
no chat pane is mounted, the shell claims the same one-shot request the palette
already writes and presents it there, without navigating. The dispatcher stops
refusing a machine panel for lack of a session, and presents it directly instead
of posting a command whose only answer is "please present this". Nothing about
the session-scoped pickers changes.

---

## 3. How "this destination needs no session" is expressed, and what it drives

**The flag is a kind on the table, not a name list in the dispatcher.** The
codebase's stated preference, and its reason, is the header comment at
`picker-registry.tsx:1-13`: the table is keyed by destination and is "the
renderer's answer for each one", so a new registry row fails loudly rather than
silently doing nothing. A `Set(["info", "analytics", "usage"])` in
`slash-dispatch.ts` would be a second answer table, and the palette, the
dispatcher and the composer would each have to be told about it separately.

```ts
/** What a destination that describes the MACHINE is handed (§ 3.1). */
export type MachinePanelContext = {
  /** The registry's own action, with `args` — UsageView's provider filter. */
  action: NativeDesktopAction;
  /** "" when the shell presents it; the live id when the chat pane does. */
  sessionId: string;
  /** The conversation in front of the user, or null when there is none. */
  frontend: CanonicalFrontendState | null;
  onClose: () => void;
};

export type DestinationEntry =
  | ({ kind: "picker"; component: FC<PickerContext>; inline?: InlineArgumentSource } & ArgsBehavior)
  | { kind: "machine-panel"; component: FC<MachinePanelContext> }   // NEW
  | ({ kind: "navigate"; route: (args, sessionId) => string } & ArgsBehavior)
  | ({ kind: "direct"; action: "clear" | "exit" | "focus-cwd-chip" } & ArgsBehavior);
```

The kind is named `machine-panel`, not `panel`, deliberately: `shell="panel"` is
already the *layout* variant of `PickerHost` and is worn by the session-scoped
panels too, so `panel` as a kind would read as "any panel view". The word is the
backend's own register ("every session on this machine", "the install and every
runtime on the machine").

**The set, and why each one is in it.** `info` and `analytics` are the two the
requirements name. `usage` joins them because the codebase already treats it as
session-free in one of its two doors — the palette offers "Provider usage" on a
draft pane (`use-palette-sources.ts:486-501`, outside the
`sessionPanelsAvailable` arm) and the request path passes `sessionId ?? ""` with
the comment "`info` and `usage` do not read it"
(`slash-dispatch.ts:777-779`) — while the typed form refuses it at `:487` for
lack of a session. Leaving `usage` out would mean two doors that disagree about
the same destination, which is the defect class this table exists to prevent.

**Rejected for this change (named, measured, cheap, and each needing its own
evidence):** `appearance` (`ThemePicker` reads `onClose` + `action`,
`destination-pickers.tsx:1130`), `auth.login` and `auth.logout` (`:2440`,
`:2503`) read no session either, so `/theme` on a draft is refused for a reason
that is not true. They are *not* in the set because neither requirement asks for
them, they widen the QA matrix, and `/theme`'s refusal is a separate defect with
a separate reproduction. § 12 records them.

**What the kind drives, site by site.**

| site | today | after |
|---|---|---|
| `slash-dispatch.ts:487-493` | refuses any picker destination without a session | refuses unless `DESTINATIONS[spec.destination]?.kind === "machine-panel"` |
| `slash-dispatch.ts:500` (`PRESENT_DIRECTLY`) | three session-scoped reads presented without an owner round trip | plus every `machine-panel`, which must not post: the POST needs a session in its path (§ 1.10) |
| `picker-registry.tsx:264-279` (`PickerOutlet`) | `entry.kind !== "picker"` → nothing | plus a `machine-panel` branch that maps the pane's context down |
| `use-palette-sources.ts:458-473` | one gate for all four panel rows | machine rows gated on liveness only; `session.diagnostics` unchanged |
| `command-palette.tsx:312-327` | always routes to `/chat` | routes only when the destination is pane-only |

**What the kind deliberately does not drive.** The two `/move` gates
(`slash-dispatch.ts:356`, `:419`) keep their `!sessionId` refusal — a move writes
to a session. `argumentEmptyCopy`'s `needsSession` (§ 1.12) is untouched: it is
about entity lists, not panels. The `stagedNote` copy (§ 1.11) is *not* driven by
a boolean any more; see § 3.1.

### 3.1 The composer's staged copy, and the one owner of the predicate

`stagedNote` already receives the destination (`slash-contract.ts:705-713`) and
already receives `paneHasSession`. The honest fix is one exported predicate, used
by the dispatcher's gate *and* by the two copy sites, so the note and the refusal
cannot disagree:

```ts
// picker-registry.tsx
/**
 * Whether this destination addresses a conversation at all.
 *
 * ONE derivation, because two surfaces quote the same refusal:
 * `useSlashDispatch`'s `!sessionId` gate and the composer's staged line
 * (`slash-contract.ts:687`). `undefined` is a destination the catalogue has no
 * row for, which is a refusal for the same reason the dispatcher's is.
 */
export function destinationNeedsSession(destination: string | undefined): boolean;
```

- `message-input.tsx:1259` (`reassembledNote`) has no destination in hand and
  keys off free-text commands; leave it. The line it prints is about a sentence
  *pushed to the front*, which only a prompt-consuming command does.
- `message-input.tsx:1344-1353` (`stagedNote`) passes
  `destinationNeedsSession(destination) ? paneHasSession : true` — i.e. for a
  machine panel the clause is never printed, whatever the pane's state.
- `slash-dispatch.ts:487` calls the same function. It must not import a *value*
  from `picker-registry` where it already imports `DESTINATIONS` — it does
  (`:65`), so this is a second name in an existing import.

---

## 4. Where a session-free panel is presented

### 4.1 The options, measured

**Option A — move the one slot to the shell, pane publishes its context.**
Rejected. `PickerContext` carries `canonical` (a live stream handle),
`draft`, `dispatch` and `rebind`, and `chat-panel-request-store.ts:9-16` states
why the pane owns the slot: those are the pane's own handles, and a store holding
them would be a handle the route can tear down under a modal. It also buys
nothing: neither requirement asks a *session-scoped* panel to outlive its pane.

**Option B — a router route per panel (`/info`).** Rejected for the reason
`panel-views.md` § 13 already gives: the mental model is "open a panel, Esc closes
it", and a route would need its own deep-link semantics, its own Esc handling and
a back/forward story for a modal. It also does not remove R1's gate, so it would
be a second mechanism for one requirement.

**Option C — keep it in the pane and stop navigating.** Rejected: with nothing
mounted on `/settings` the request would expire unread (`PANEL_REQUEST_TTL_MS`)
and the palette row would become the dead control its own contract forbids.

**Option D (recommended) — a second host for machine panels only, arbitrated by
a presenter claim.** The chat pane keeps its slot and its adapters unchanged. A
new shell-level host renders `machine-panel` destinations when no pane is
mounted. Both resolve the destination through the same `DESTINATIONS` table, and
`PickerOutlet` remains the only place that maps a destination to a component.

### 4.2 Why the arbitration is a claim and not a route check

The shell host must present *only* when the pane cannot. The tempting predicate
is the route (`location.pathname.startsWith("/chat")`), and it is the wrong one:
the chat route also paints a connecting or error state when the catalogue
capability is not live, in which case no presenter exists and a route check would
strand the request until it expires — the exact failure the TTL was added to bound.
The honest question is "is a presenter mounted", so it is asked of the presenters:

```ts
// the store, extended
/** Registered by whichever mounted host owns the chat pane's slot. */
presenterClaimed: boolean;
claimPresenter: () => () => void;   // returns the release
```

- The chat pane claims wherever it owns the slot — `SessionPanel`
  (`chat-page.tsx:202`, its `useSlashDispatch` call at `:730`) — releasing on
  unmount. Mounting that component *is* the claim, which is why the predicate is
  "is a presenter here" and not a route check.
- The shell host consumes the request only while `presenterClaimed === false`.
- The pane's consumer (`slash-dispatch.ts:761-803`) is unchanged in behaviour: it
  is the claimant whenever it is mounted.

Both hosts may therefore be mounted at once — which they are on every chat route
— and exactly one acts.

### 4.3 What happens to the session-scoped pickers

Nothing. `/session`, `/context`, `/failovers`, `/model`, `/effort`, `/goal`,
`/compact`, `/team`, `/agent`, `/loop`, `/rename`, `/fork`, `/stop`, `/resume`,
`/new`, `/skills`, `/credential`, `/copy`, `/mcp` and the rest keep
`kind: "picker"`, keep their `PickerContext`, keep their `!sessionId` refusal,
and keep being presented by `SessionPanel` at `chat-page.tsx:1965` with the pane's own
`canonical`, `draft`, `note` and `rebind`. The claim changes *when* the pane
consumes a palette request, not what it consumes or how it renders it.

---

## 5. What each panel renders with no session

The rule for both panels is one sentence: **the conversation half is present
exactly when a conversation is in front of the user**, which is what `sessionId`
means at the point of paint (`""` at the shell host, the live id at the pane).

### 5.1 `/info`

- **The "This conversation" section (`info-panel.tsx:474-483`) is omitted.**
  Today, with no session, `conversationRows(null, "")` returns `[]`
  (`info-model.ts:610-614`) and `FactsTable` renders
  `<PanelNotice kind="empty" text="Nothing to report here." />`
  (`info-panel.tsx:85-87`) — a section headed "This conversation" that says
  nothing is there. That is the state R1 asks to remove, and it is worth naming
  as a defect rather than a rendering quirk: the heading is the lie, not the
  notice.
- **Its `meta` ("live · this conversation") goes with it.** No section, no meta.
- **The panel's `description` (`:266`) is conditioned.** It reads "The install,
  the host this app is connected to, and the conversation in front of you."
  Session-free, the third clause is false; the honest form names what replaced it,
  e.g. "The install, the host this app is connected to, and the sessions running
  on it." The exact words are the designer's call (§ 11) — the *requirement* is
  that the clause not promise a conversation.
- **The "Sessions on this machine" table is unchanged** and does not need a
  session: `sessionLineRows` marks the current row only when
  `line.session_id === thisSessionId` (`info-model.ts:309-313`), so with `""` the
  marker is simply absent. Its columns, the fleet section, Environment and
  "Could not be read" are untouched.
- **No empty state or skeleton changes.** The install/fleet skeletons
  (`hostBody`, `:262-274`) are driven by `loading`/`error`, which are unchanged.

### 5.2 `/analytics`

- **The "This session only" check is not rendered when `sessionId === ""`**
  (`analytics-panel.tsx:279-285`). Its promise is honest only where a session
  exists; `AnalyticsView` already sends `sessionId: thisSessionOnly ? sessionId :
  undefined` and the transport drops a falsy id, so a sessionless tab today would
  render a checkbox that changes nothing but the query key — the dead affordance
  the palette's own contract forbids.
- **`thisSessionOnly` stays `false`** in that case (its default, `:418`), so the
  scope label is "all sessions" (`:248`), the Totals meta keeps its suffix, and
  the chart meta (`dailyMeta(win, false)`, `analytics-model.ts:116-122`) drops the
  "· all sessions" clause — which is correct, because that clause exists to say
  the *daily series* is machine-wide even when the totals are scoped
  (`store.daily_series(days)` takes no session). Nothing to fix there; it is worth
  recording that it is deliberate so a reviewer does not "fix" it.
- **Empty states are unchanged.** "No calls recorded in the last 7 days." and its
  detail (`:303-313`) are already conversation-free and already true on a machine
  that has only ever run sessions in the terminal.
- **The `scope` label keeps saying "all sessions"** when the toggle is absent.
  It is the honest scope, and it becomes information rather than redundancy the
  moment the panel is reachable with no conversation.

### 5.3 `/usage`

Nothing changes. It reads `onClose` and `action` only, its query is
`usage.get` with no session, and the palette already offers it on a draft pane.

---

## 6. The note line, when the presenter has no transcript

**Decision: `MachinePanelContext` has no `note`, and the shell host has no
transcript to write to. The omission is the honest answer, not a limitation.**

Three facts make this a typing decision rather than a behaviour change:

1. **No machine panel writes a note today** (§ 1.4): a grep for `note(` across
   the three panels and `usage-view.tsx` returns nothing. Their feedback idiom is
   their own body — `PanelNotice` for a failure, the empty notice for an empty
   answer, the `error` prop threaded from the query (`info-panel.tsx:262-274`,
   `analytics-panel.tsx:296-313`). That is where a panel's words belong, because
   the panel is the receipt (`slash_commands.py:487-488` and the `/usage` rule it
   cites).
2. **A note written into a transcript nobody is looking at is worse than no
   note.** On `/settings` there is no transcript; a machine panel's sentence about
   a failed read has to appear where the user is looking, which is the panel.
3. **The pane keeps its own `note` for the destinations that use it.** The
   session-scoped pickers (`/model`, `/effort`, `/goal`) still write
   ("The model was not changed. …", `destination-pickers.tsx:730-743`) through the
   pane's `note` into the canonical transcript, unchanged.

Consequences to implement, both mechanical:

- `PickerOutlet`'s machine-panel branch **drops** `note`, `commands`, `dispatch`,
  `rebind` and `draft` when it maps down; it is not allowed to pass a pane
  function into a context whose contract does not mention it, or the shell host
  would have to invent one.
- If a future machine panel needs to say something memorable, it renders it in
  its own body (the panels' existing `PanelNotice`), or the field is added to
  `MachinePanelContext` *with* an argued placement for the shell case. Adding a
  toast for this change would be inventing a second feedback surface for a
  sentence no panel writes.

The one copy that must move is the dispatcher's refusal, and it does not move to
a new surface: for a machine panel there is no refusal to print (§ 3).

---

## 7. `/analytics`'s "this session" scope on a live conversation

**Unchanged, and this is a requirement, not a liberty.** When a conversation is
open and the pane presents the panel, `sessionId` is the live id, the toggle is
rendered, and its read is scoped to that conversation. R1 must not regress it.

The rule generalises: the scope control exists exactly when `sessionId !== ""`,
which is the same condition as the info panel's conversation section (§ 5). A
user who opens the palette on `/chat` with a live conversation gets the scoped
panel, because the pane is the claimant (§ 4.2). A user who opens it on
`/settings` gets the machine-wide read, because there is no conversation on
screen to scope to — and the panel does not silently scope itself to the store's
active session, which is a real decision: the store *does* know an active session
id from any route (`use-palette-sources.ts:438-441` reads it), and using it would
put a control labelled "This session only" in front of a user looking at
Settings, where "this session" names nothing on screen. § 8 records the one case
that follows from this.

---

## 8. Keyboard, pointer and route interaction

- **The modal covers the app, so the pointer cannot navigate behind it.**
  `PickerHost` renders a modal `Dialog` (`picker-host.tsx:830`) whose
  `DialogContent` paints `fixed inset-0 z-50 bg-scrim`
  (`ui/dialog.tsx:41-46`). A click on a sidebar destination while a panel is open
  lands on the scrim, which closes the panel (`onOpenChange`, `:830`) — the
  destination is **not** visited. This is today's behaviour for every picker and
  this change does not alter it; it is recorded because the operator asked, and
  because the honest reading of the click ("close this") differs from the intent
  ("go there"). Making the click fall through would mean a non-modal dialog and
  the loss of the focus trap, which is not a trade worth making for one gesture.
- **Keyboard cannot leave the dialog either.** The modal traps focus while it is
  open, so no chord reaches the rail. Escape closes, as it does today.
- **Programmatic navigation while a panel is open does not close it** — for the
  shell host. A notification click, a consent banner's click
  (`app.tsx:162`, `:201`) or a palette row for another destination can
  move the route under an open panel. A shell-presented machine panel survives,
  because it is a portal into `document.body` fed by a store that the route does
  not own, and because its content is route-independent by construction (it
  describes the machine). A **pane-presented** panel closes, because its state
  dies with the pane (§ 1.7) — which is the honest pairing, since that panel was
  drawing the conversation the user just navigated away from.
- **Focus on close.** The pane's `closePicker` already records its invoker and
  falls back to the composer (`slash-dispatch.ts:305-321`). The shell host adopts
  the same rule with the fallback it actually has: record
  `document.activeElement` when the request arrives, restore it on close if it is
  still connected (`Node.isConnected`), and otherwise let Radix do what it does.
  A shell panel has no composer to fall back to, and focusing nothing is better
  than focusing a node that was removed with the palette — the exact bug that
  rule was written for (`slash-dispatch.ts:289-303`).
- **One panel at a time, across both hosts.** The store holds one request and the
  pane holds one `picker`; a second request replaces the first, as it does today.
  The claim is what keeps that true once two consumers exist.

---

## 9. Files, in order, and what each change is for

Each step leaves the tree green. Steps 1-3 are the mechanism, 4-8 the
destinations, 9-13 the call sites, 14-16 the record.

1. **`src/renderer/src/shared/store/chat-panel-request-store.ts` →
   `panel-presentation-store.ts`** (rename; update the two importers in
   `slash-dispatch.ts` and `command-palette.tsx` and the bundle path in
   `scripts/palette-panel-request.test.mjs`). Add `presenterClaimed` +
   `claimPresenter()` (§ 4.2); rewrite the header comment, whose "only the chat
   pane can open [a panel]" premise becomes false. **Why:** the request must be
   consumed by whichever host is mounted, and the store is where that is decided.
   *Alternative the coder may take:* keep the filename and add the claim — the
   rename is honesty, not architecture, and if it churns anything beyond the
   three paths above, keep the name and say so in the PR.
2. **`picker-registry.tsx`** — add `MachinePanelContext`, the `machine-panel`
   arm, `destinationNeedsSession()`, and the four-kind header comment (§ 3, § 3.1).
   **Why:** one table, one answer per destination.
3. **`picker-registry.tsx:241-244`** — `info`, `usage`, `analytics` become
   `{ kind: "machine-panel", component: … }`; `PickerOutlet` (`:264-279`) gains the
   branch that maps the pane's `PickerContext` down to three fields plus
   `onClose`. **Why:** the pane keeps its slot for these destinations, with the
   conversation half intact (§ 7).
4. **`panels/info-panel.tsx`** — `InfoView` takes `MachinePanelContext`; the
   "This conversation" section is rendered only when `sessionId !== ""`; the
   `description` is conditioned (§ 5.1).
5. **`panels/analytics-panel.tsx`** — `AnalyticsView` takes
   `MachinePanelContext`; the `This session only` check renders only when
   `sessionId !== ""` (§ 5.2).
6. **`usage-view.tsx`** — `UsageView` takes `MachinePanelContext`; no behaviour
   change (it already reads `onClose` and `action`).
7. **`slash-dispatch.ts`** — the gate at `:487` becomes
   `if (!sessionId && destinationNeedsSession(spec.destination))`; a new branch
   for `kind === "machine-panel"` presents directly, beside `PRESENT_DIRECTLY` at
   `:500`, **above** the `sessions.command` POST at `:539`
   (`session_id: sessionId ?? ""`, `args: ""`); the pane claims the presenter slot
   (§ 4.2). **Why:** the round trip's only answer for these rows is a
   `native_action`, and it needs a session id the pane does not have.
8. **NEW `src/renderer/src/features/chat/pickers/panel-outlet.tsx`** — the shell
   host: read the request, claim only while `!presenterClaimed`, resolve through
   `DESTINATIONS`, render the component for `kind === "machine-panel"` with
   `{action, sessionId: "", frontend: null, onClose}`, ignore every other kind,
   honour the TTL, record and restore focus (§ 8). **Why:** it is the second
   presenter, and it must not import the chat pane.
9. **`app.tsx`** — mount `<PanelOutlet />` beside
   `{isCommandPaletteOpen && <CommandPalette />}` (`:297`). **Why:** one shell, so
   one place for a route-independent surface.
10. **`picker-host.tsx`** — add `useSuppressBrowserView(open, "panel-picker")`
    inside `PickerHost`. **Why:** § 1.6 — with R2 a panel can now be open over
    `/browser`, where a native `WebContentsView` paints above all DOM. One line in
    the one funnel covers both hosts.
11. **`use-palette-sources.ts:458-473`** — machine rows (`info`, `usage`,
    `analytics`) gated on the liveness bit only (`canStageDraft`, the same bit the
    chat route and sidebar read); `session.diagnostics` keeps
    `paneCanPresent && sessionPanelsAvailable`. Update the two doc comments
    (`:414-437`, `:444-457`). **Why:** R1's panel must be reachable where no pane
    exists. *Argued alternative:* gate them on `diagnostics` (the capability the
    two panels read, `info-panel.tsx:577`) and accept that the rows then vanish on
    a backend that lacks the routes; the panel already renders its own update
    notice for that case, and the liveness bit is the gate the palette already
    holds every other row to.
12. **`command-palette.tsx:312-327`** — route to `/chat` only when
    `destinationNeedsSession(destination)`; otherwise request and close, exactly
    as today. **Why:** R2, in one condition. (The `location.pathname` check stays
    for the pane-only rows.)
13. **`message-input.tsx:1344-1353`** — the staged line asks
    `destinationNeedsSession(destination) ? paneHasSession : true` (§ 3.1).
    **Why:** otherwise the composer prints the refusal the dispatcher no longer
    gives.
14. **`docs/command-palette.md:102-127`** — amend "Panels are destinations, not
    routes": three of the four rows no longer require a pane, `analytics` leaves
    the conversation-requiring pair, and the "All four require a pane that can
    present them" paragraph becomes the two-host rule. **Why:** that file is the
    palette's own record and goes stale silently otherwise.
15. **Storybook** — a session-free story for each machine panel under the existing
    titles (`panels-info`, `panels-analytics`, `usage-view`) so a narrowed
    recapture catches them, rendering the production component over fixtures with
    `sessionId: ""` (§ 11).
16. **Tests** — extend `scripts/palette-panel-request.test.mjs` for the renamed
    store, the claim arbitration and the one-shot semantics; pin
    `destinationNeedsSession` and the routed/pane-only split the way this repo
    pins non-runtime facts (a structural assertion over the table, in the style of
    the existing `slash-contract.test.mjs` and `chat-page` structural tests, since
    bundling a React-importing module into a node test is the wrong tool).
    Add the file to `test:desktop` in `package.json` only if a new file is added.

---

## 10. Concurrent work, and the edits that must survive it

Two peers are working in this repo on, respectively, an **analytics-session-view
pagination change** and an **info-output change**. As measured while writing this
(16 Sep 2026): `feat/analytics-session-table-paging` is at `647396910` with no
commits, and the fleet worktree is at `a2995e066` — so nothing is pinned yet and
the coder must rebase before opening a PR.

The overlap is small and each item is a single edit inside a named function:

| file | this change | the likely peer change |
|---|---|---|
| `panels/analytics-panel.tsx` | the toggle's condition, `AnalyticsView`'s props | the by-session table's paging (a sibling section) |
| `panels/info-panel.tsx` | the conversation section's condition, `description`, `InfoView`'s props | the info/fleet output |
| `panels/info-model.ts` | none | the info output |
| `panels/analytics-model.ts` | none | the by-session rows |
| `panel-queries.ts` | none | possibly the session-report key |
| `picker-registry.tsx` | three rows, the table's type, `PickerOutlet` | unlikely |
| `slash-dispatch.ts` | one condition, one branch, a claim | unlikely (the `/move` work is in `move-session.ts`) |

Files no peer should be touching: `panel-presentation-store.ts` (new),
`panel-outlet.tsx` (new), `app.tsx`, `picker-host.tsx`, `use-palette-sources.ts`,
`command-palette.tsx`, `slash-contract.ts`, `message-input.tsx`.

---

## 11. Verification, under this repo's gates

Nothing here adds a visual primitive: no new fill, border or ink role, so **no
`CONTROLS` row is added to `scripts/contrast-contract.mjs`** and `pnpm
check-themes` is expected green unchanged. If the info panel's conditioned
description turns into a new heading treatment, that changes and the row comes
with it.

**Static:** `pnpm check-types`, `pnpm lint`, `pnpm check-themes`, plus the
desktop suite (`pnpm test:desktop`).

**Storybook frames** (production components over fixtures, `--only=panels-` and
`--only=usage-` append-mode captures):

| frame | what it proves |
|---|---|
| `panels-info` session-free | no "This conversation" heading, no empty notice where it stood, machine table intact with no "this session" marker |
| `panels-analytics` session-free | no scope check, scope label "all sessions", Totals meta and chart meta both absent the scoped clause |
| `panels-info` / `panels-analytics` populated (unchanged) | the live-conversation rendering is untouched — the regression pair for R1 |
| both panels narrow (720px) | the removed blocks do not shift the surviving ones |

**Live frames** (`pnpm app:headless --remote-debugging-port=… --user-data-dir=$SCRATCH/profile
--window-size=1380x900` — every agent-driven launch names a window mode,
`AGENTS.md` "Running the app without taking the operator's focus"), before and
after each:

1. `/analytics` typed on an empty "Start of conversation" pane — before: the
   refusal sentence; after: the panel, machine-wide.
2. `/info` typed on the same pane — before: the same refusal; after: the panel
   with no conversation section.
3. Cmd+K → Analytics **from `/settings`** — before: lands on chat; after: the
   panel over Settings, route unchanged.
4. Cmd+K → Info **from `/browser`** — proves item 10 (`useSuppressBrowserView`):
   without it the dialog is invisible behind the native view. Capture with the
   backend running and the browser route showing a real page.
5. `/analytics` typed on a **live** conversation — the toggle present, the panel
   scoped; the pair with (1) is the whole of R1's "and not the other way round".
6. Cmd+K → Analytics on `/chat` with a live conversation — proves the claim
   arbitration sends it to the pane, not the shell.

**QA matrix** (independent pass, `qa-tester`): the six live cases above plus
the negative surfaces — `/move` and `/move <path>` on a draft must still refuse;
`/session` from `/settings` must still route to chat; a backend without
`features.diagnostics` must still show the info panel's update notice; the
palette rows on a backend-down launch must still be absent.

**Design round** (`designer`, D-findings, on the PR with the frames): the
session-free `description`, the removed blocks' effect on the panels' rhythm, and
the analytics toolbar's balance once the check is gone. **UX round**
(`ux-reviewer`): the flow changed — a palette row no longer moves the route — so
it walks the real flow over the running app, not stills.

---

## 12. Non-goals, and things found and not addressed

1. **No backend change.** § 1.1 and § 1.2; if a reviewer believes a route needs a
   session, the check is one `curl` (§ 14).
2. **No router routes for panels** (`panel-views.md` § 13).
3. **No second presentation slot for session-scoped destinations**, and no
   persistence of the pane's handles into a store (§ 4.1, option A).
4. **No new npm dependencies.**
5. **`/theme`, `/login`, `/logout` on a sessionless pane stay refused.** Measured
   as session-free (`destination-pickers.tsx:1130`, `:2440`, `:2503`) and named
   here so the next reader does not re-derive it; not in this change because
   neither requirement asks, and each needs its own reproduction and QA pass. One
   table row each when they are wanted.
6. **`/settings`, `/providers`, `/accounts`, `/updates` on a sessionless pane stay
   refused** for the same reason (`slash-dispatch.ts:487` covers `navigate`
   destinations too, and their routes ignore the session id they are handed at
   `:483`). Same shape of one-line fix, same reason to leave it.
7. **The abandoned click in § 8** — a click on a rail destination while a panel is
   open closes the panel and does not navigate. Pre-existing, unchanged, recorded
   because it was asked.

---

## 13. The riskiest assumption, and the check that falsifies it

**Assumption.** Presenting directly — skipping the `sessions.command` POST for a
machine panel (item 7) — loses nothing the user can see, because the endpoint's
answer for these destinations is always `native_action`
(`desktop_sessions.py:1649-1657`) and the panel is the receipt.

**Why it is risky.** The POST also opens a session bridge
(`host(request).session(session_id)`) and therefore admits the session to this
viewer. If a machine panel's *read* depends on that admission, presenting
directly would turn a working panel into an error on a session that has never
been viewed — and the fix would be to keep the round trip for the session-ful
case, which is a different shape from what § 9 describes.

**The check that falsifies it (do this first, before writing any UI code):**

```sh
# With the UI's backend running and one conversation open, on a pane that has
# just been opened (so the bridge is cold):
curl -s -H "Authorization: Bearer $LOCAL_OPERATOR_DESKTOP_TOKEN" \
  "http://127.0.0.1:$PORT/v1/desktop/analytics?days=7" | python3 -m json.tool | head -20
curl -s -H "Authorization: Bearer $LOCAL_OPERATOR_DESKTOP_TOKEN" \
  "http://127.0.0.1:$PORT/v1/desktop/info" | python3 -m json.tool | head -20
```

Pass if both answer with real data with no session attached and without a prior
`sessions.command` POST in the same backend log. Falsified if either 4xx/5xx's, or
if the answer changes after a POST — in which case the machine-panel branch keeps
the round trip when a session exists and skips it only when none does, and § 3's
table gains that asymmetry as a decision rather than a detail.

**Second check, cheap and worth doing in the same pass:** with the backend
reachable but `features.diagnostics` absent (or a stale backend), confirm the
palette's machine rows behave as § 9 item 11 says and the panel's own update
notice is what the user reads.

---

## 14. Items the manager must hold the reviewers to

1. `destinationNeedsSession` is one exported function, and **three** call sites
   use it (the dispatcher gate, the staged line, the palette's routing). A fourth
   copy of the predicate is the defect this item exists to prevent.
2. The `/move` gates (`slash-dispatch.ts:356`, `:419`) still refuse without a
   session, shown in the QA matrix.
3. `PickerOutlet`'s machine-panel branch passes exactly
   `{action, sessionId, frontend, onClose}` — no `note`, no `canonical`, no
   `dispatch` (§ 6).
4. The live-conversation frames (§ 11.5, § 11.6) show the conversation section
   and the scope toggle intact.
5. `PickerHost` registers with the browser-view policy, and the `/browser` frame
   shows the panel (§ 1.6, item 10).
6. `docs/command-palette.md` § "Panels are destinations, not routes" is rewritten
   rather than left adjacent (item 14).
7. No version bump in the PR, and no `CONTROLS` row added unless a new visual
   surface actually appears (§ 11).
