# Browser approvals and tab chrome — UX architecture

Status: **proposal, implementation not included.** Written at UI head
`e83ab9b1f` (`approval-ux` worktree, off `origin/main`, version 0.24.0). Every
line citation was read at that head; where a citation is to the backend design
authority it is spelled `design <section>` and resolves to
`docs/design/ui-browser-tab.md` in `damianvtran/local-operator` at `origin/main`
(the UI repo does not carry a copy — read it with
`git -C ~/local-operator show origin/main:docs/design/ui-browser-tab.md`). A bare
`§n` in this document is a section of THIS document; every reference to the
backend authority is spelled `design §n.m`.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
window modes, evidence, release mechanics), `docs/design/panel-views.md` (the
panel architecture this document's §7 must compose with),
`docs/agent-driver.md` (the live-app harness).

This document settles the surface, the object model, the visual grammar and the
PR split. It deliberately does **not** settle §8's root cause — a parallel
scout is reproducing that in a real headless run, and §8 says exactly what to
slot in when it lands.

---

## 0. The four asks, and what each actually requires

The operator asked for four things across three messages. Stated as
requirements, because three of the four turn out to need a change below the
renderer:

| # | Ask (his words, abridged) | What it requires |
|---|---|---|
| R1 | "a badge notification number … at the corner of the button to show how many outstanding approvals there are (allow a queue)", plus "a popup in a dialog at the top right, or a drawer … make sure that also highlights a numbered badge callout" | A queue that can actually hold more than one request (`src/main/browser/approvals.ts`), a badge, and a surface that shows the numbered set |
| R2 | "the tabs should look more like browser tabs and not just buttons" | Tab-strip visual grammar, in roles (§6) |
| R3 | "I approved a bunch of agents to work in there but I don't actually see any navigation or work — make sure that we can actually show the agents' work only while that tab is open" | §8: a mechanism to confirm before anything is fixed |
| R4 | "show the browser tabs in a browser icon in the chat window and … pop out the same visuals there … open up the browser from the right in that conversation only, similar to the canvas and info panels, showing that conversation's tabs vs all tabs" | A second host for the one browser surface, plus per-tab session attribution over IPC (§7) |

R1 and R4 are the two that move data, not paint. Everything else is grammar.

---

## 1. The problem as I found it

Nine facts, each read rather than recalled. They are the constraints the rest of
the document is derived from, and four of them are defects in the current build.

1. **The queue is one slot, and the design says it is FIFO.** `requestAccess`
   calls `displaceLive` before pushing a new entry
   (`approvals.ts:439`, `:816-832`), and `displaceLive` clears the whole live
   queue and tombstones every displaced entry. The test states the intent
   plainly: `"one prompt slot, replace-don't-queue"`
   (`scripts/browser-host.test.mjs:964-981`). The design authority says the
   opposite: "the queue is FIFO with a 10-minute async TTL"
   (design §9.1), and it is the reason `access-queue.ts` ships a cap of 16
   (`vendor/driver/access-queue.ts:21`) that the host can never reach.

   So `BrowserChromeState.pendingConsent` is an array that is never longer than
   one (`use-browser-chrome.ts:82`), the band's `waitingBehind` is always 0
   (`browser-page.tsx:170`, `:262`), and the "queued" consent-bar story
   (`browser-consent-bar.stories.tsx:75-87`) depicts a state the host cannot
   produce. **The operator asked for a queue; the model has one and the host
   does not.**

2. **Nothing fires at expiry.** An entry is live while `now < expiresAt`
   (`access-queue.ts:72-74`); `sweep` prunes expired entries only when
   `requestAccess` runs (`approvals.ts:429`, `:844-851`), and every
   `onChanged()` call site is a user or agent action (`:452,531,571,592,613,659,754,785,800`).
   The projection publishes `expiresAt` (`host.ts:559-575`) but the renderer
   never reads it (`grep expiresAt src/renderer` → the story fixture and the
   type only). A badge derived from `pendingConsent.length` would therefore
   keep counting a request that expired minutes ago until something else
   happens to change state.

3. **An expired request can still be granted.** `respond` looks the entry up in
   the raw queue with no liveness check (`approvals.ts:544-556`), so a click at
   `expiresAt + 1s` on a request the UI is showing as expired is accepted and
   writes a durable grant. The 10-minute TTL exists precisely so that "an
   unanswered prompt left open forever would let a long-forgotten Allow click
   grant a navigation nobody remembers requesting"
   (`vendor/driver/access-flow.ts:41-44`). The bound is enforced on read and not
   on write.

4. **The "Sites" control is a bare label with a count of the wrong thing.**
   `variant="outline" size="sm"`, the word `Sites`, and `approvalCount` = the
   number of records with `scope !== "deny"` (`browser-url-bar.tsx:208-219`,
   `browser-page.tsx:252-255`). It counts what is already granted, says nothing
   about what is waiting, and has no icon, badge or attention state.

5. **The Sites sheet's own docstring is wrong about the layering, and the wrong
   claim is load-bearing.** `browser-sites-sheet.tsx:33-35` says the sheet was
   chosen over a dialog "because it is a list the user reads while the page
   stays visible behind it — and because a dialog would hide the native view".
   But `Sheet` registers suppression exactly like a dialog
   (`sheet.tsx:52-71`, `useSuppressBrowserView(open === true, "sheet")`), so the
   page **is** hidden while the sheet is open and the user gets the paused note
   instead (`browser-page.tsx:194-214`, `:390-406`). The chrome proof asserts
   this outcome for a dialog and is equally true of the sheet
   (`scripts/browser-chrome-proof.mjs:1593-1604`). A design decision recorded
   against a mechanism that behaves the other way round is how the next person
   picks a Sheet for the wrong reason.

6. **A native view paints above all DOM, so the chrome band is the only
   reliably visible strip.** `browser-view-policy.ts:14-18` states it, `:145-175`
   records the two things that deliberately do not register and the measured
   toast failure. Every dialog in the app funnels through `BaseDialog`
   (`base-dialog.tsx:120`), every sheet through `Sheet` (`sheet.tsx:69`), and
   the browser page's own failure panel registers itself
   (`browser-page.tsx:214`). The suppression cost is a hidden page, a paused
   note, and design probe **P11**'s unresolved question of whether a
   `setVisible(false)/(true)` pair flashes on macOS (`browser-view-policy.ts:41-44`,
   probed as consecutive frames in `browser-chrome-proof.mjs:1606-1616`).

7. **The rectangle is the renderer's to place, and only the active tab occupies
   it.** The renderer measures the content element and reports it
   (`browser-page.tsx:105-136`, throttled by a frame in
   `use-browser-chrome.ts:275-306`); main applies it to the active tab only, and
   every other tab gets `BACKGROUND_VIEWPORT` with `presented = false`
   (`registry.ts:492-503`, `:101-106`). Design §11.1 words this as "one rect
   authority, N views", and design §11.9 says the chrome tree "takes the content rect
   from its parent rather than assuming full-window. A route gives it the whole
   `<main>`; a panel would give it a pane." **The pane in R4 was planned for;
   this document is the plan.**

8. **The right pane is one exclusive slot, and its own comment anticipates a
   third tenant.** `claimRightSlot(pane: "isRunPanelOpen" | "isCanvasOpen")`
   owns the exclusion (`ui-preferences-store.ts:250-271`), and the comment above
   it says the next person to add a term to the rule — "a third pane" — is the
   reason the rule lives in one place. Panes render as a flex sibling with a
   `ResizableDivider` and a persisted width (`chat-content.tsx:918-960`;
   `DEFAULT_RUN_PANEL_WIDTH = 420`, `DEFAULT_CANVAS_WIDTH = 800`,
   `ui-preferences-store.ts:296-298`); the chat header's action cluster holds
   one trigger per pane (`chat-header.tsx:204-262`).

9. **Per-tab session attribution exists one layer below the IPC projection.**
   `TabRecord` carries `sessionId` and `handedTo` (`registry.ts:38-51`) and
   `snapshot()` returns them (`:556-585`, `sessionId` at `:559-560`), but `chromeState()` maps each tab to
   six fields and drops both (`host.ts:531-543`). The nonce is correctly not
   projected (`ipc.ts:30-32`). The requester's session id *is* already published
   for pending requests, strictly `session:`-prefixed (`host.ts:565-581`).
   A conversation-scoped pane therefore needs one additive field, not a new
   channel — and the wire is `unknown`-typed at the preload
   (`src/preload/index.d.ts:31-36`), so no schema changes with it.

**What is already right, and must not be re-litigated by this work:** the band's
place in the chrome (`design 9.2`, `browser-consent-bar.tsx:16-21`), the five
scopes and their per-choice glosses (`browser-consent-bar.tsx:233-257`), the
requester attribution that resolves a session id to a conversation title
(`:99-109`), the agent marker as the one thing that distinguishes an agent tab
(`browser-tab-strip.tsx:155-165`), the tab width policy from design round 3 D13
(`:119-128`), the active tab's `border-control` edge from D18 (`:108-133`), and
the standing "agents can drive tabs in this app" notice
(`browser-sites-sheet.tsx:100-116`).

---

## 2. The one principle this document is built on

**The band is the interactive surface. The content area belongs to the page.**

Everything that asks the user for something — the prompt, the queue, a tab's
actions — renders *inside the chrome band*, which is outside the native view's
rectangle and therefore never occluded. Everything that is a *list to read
beside the page* — the approvals, the grants, the denials — renders as an
in-flow dock that **narrows the content rectangle** instead of covering it.

That gives the design two mechanisms it never needs: `setViewVisible(false)`
for anything in this feature, and probe P11's unresolved flash. It also settles
the operator's dialog-vs-drawer question in a way his two candidate surfaces
could not: a top-right popup or a modal drawer over the page area is either
invisible behind the native view or hides the page exactly when he is deciding
about it, and neither is fixable by z-index.

Two consequences to state up front, because they are costs:

- **The dock narrows the page.** A native view cannot be CSS-scaled, so there
  is no zoom-to-fit: the page lays out at the width it is given, which on a
  1380x900 window is about 1000px and in the chat pane about 300px. A page that
  reflows to its container is displaying honestly; a page scaled to 70% would
  not be the page the agent is driving.
- **The band grows, and the page shrinks by exactly that much.** The content
  rect is measured from a `ResizeObserver` on the content element
  (`browser-page.tsx:108-111`), so band growth re-reports and re-bounds the view
  with no new mechanism. This is the reason the queue belongs in the band rather
  than in a floating list: it costs a re-measure, not a suppression.

---

## 3. A — The approval object model and queue semantics

### 3.1 The objects, named

| Object | Where it lives | What it is |
|---|---|---|
| **Request** | `ApprovalStore.queue`, projected as `pendingConsent[]` (`host.ts:559-575`) | One agent's `request_access` for one origin, raised by a navigation that was refused early. Live while `now < expiresAt`; TTL 10 minutes (`access-flow.ts:45`) |
| **Decision** | `respond(entryId, decision)` (`approvals.ts:544`) | One of `once \| session \| site \| domain \| deny` (`use-browser-chrome.ts:89`), applied to the request's origin at the scope the button names |
| **Grant record** | `ApprovalStore.records` + `sessionRecords`, projected as `approvals[]` (`host.ts:592-596`) | A decision still in force: `origin`, `domain`, `host`, `session` or `deny`, with `grantedAt`. **`once` never appears here** — it lives in `onceGrants` and is spent by the requester's next navigation (`approvals.ts:558-568`) |
| **Receipt** | `results`, internal | What the asking agent's `await_access` reads. Never rendered |

The UI's three lists map onto two ranges of one array, which is why they belong
in one surface:

- **Waiting** — live requests, in FIFO order. New in this design.
- **Approved** — records with `scope !== "deny"`, which today is
  `browser-sites-sheet.tsx:81`; the sheet already splits `granted` from `denied`
  at `:81-82`.
- **Denied** — records with `scope === "deny"` (`browser-sites-sheet.tsx:172-198`).

### 3.2 The queue becomes real (main-process change)

`requestAccess` stops displacing. The rules, stated as the code will read:

1. **Same origin, same requester, already pending → idempotent**, original TTL
   kept. Unchanged (`approvals.ts:408-416`).
2. **A repeat request that has a live receipt → answered from the receipt**,
   never re-prompted. Unchanged (`:417-428`).
3. **A different origin or a different requester → the new request is appended**
   to the live queue in `sequence` order and waits. This is the change: today it
   clears the queue (`:439`).
4. **At the cap (16) → the oldest live entry is displaced** and gets the
   `superseded` receipt it gets today, so the displaced agent still learns what
   happened instead of timing out into an anonymous `none`
   (`access-flow.ts:29-34`). The requester of the newest request is not refused;
   refusing the *asking* agent because 16 others are queued would turn a full
   queue into a hard failure for the agent that is behaving normally. Alternative
   rejected in §3.5.
5. **Ordering is FIFO by `sequence`**, which `liveQueue` already sorts on
   (`access-queue.ts:72-74`) and `chromeState` already preserves
   (`host.ts:559`). The renderer adds no ordering of its own; it derives the
   ordinal from the projection's index (below).

The agent-visible consequence, stated because it is a real trade and the
reviewer should not have to find it: **a displaced request taught the agent
immediately; a queued request waits.** An agent whose request sits at position
5 waits for its own `await_access` budget and then re-requests, which is
idempotent while the entry is live. In exchange, a user with four agents working
sees four requests instead of one, and no agent's request is destroyed by
another's arrival. That is the trade the operator asked for by name ("allow a
queue"), and it is the behaviour the design authority already specifies.

### 3.3 Liveness is derived in the renderer, from one clock

Because nothing fires at expiry (§1.2), a badge or a count that reads
`pendingConsent.length` is wrong for up to the whole TTL. The rule:

- **Live** = `expiresAt > now`, evaluated against a single shared clock that the
  browser surface owns (one interval, 1s granularity while any request is
  pending; no interval when nothing is pending). One clock, because two
  surfaces computing liveness from two clocks is how the badge and the tray
  disagree by one for a second.
- The **badge count** is the number of live requests. Not grants, not denials,
  not expired. Zero → no badge at all (the control is then a plain labelled
  button, which is the honest rendering of "nothing is being asked").
- The **ordinal** of a request is `index + 1` over the live FIFO subset, computed
  in one pure function (`approval-queue-model.ts`, §10.1) so the tray, the dock,
  the tab chip and any story all agree by construction. It is a **position in a
  list**, not an identity: answering request 1 renumbers the rest, exactly as a
  numbered list does. Alternative rejected in §3.5.
- Each row shows the **remaining time** in words ("expires in 9 minutes";
  "expires in under a minute" below 60s). A user deciding whether to grant a
  durable approval should know how long the agent has been waiting and when the
  agent's own window closes. `expiresAt` is already on the wire; this costs no
  main-side change.

### 3.4 Expiry, including while the surface is hidden

- **The request vanishes from the projection as soon as a read happens after the
  TTL**. With the renderer's clock, the row leaves the Waiting list at
  `expiresAt` even if no read happens, and the badge drops with it.
- **The vanished row is shown as expired for a bounded time, from the renderer's
  own memory of the last projection** — not from main. Rules: an entry present in
  the previous projection, absent from the current one, not answered locally, and
  past its `expiresAt` is **expired**; the same with a future `expiresAt` is
  **withdrawn** (cancelled by the agent, or superseded at the cap). Retention is
  bounded (the last 5, dropped 5 minutes after the fact, and always dropped on
  leaving the surface) and the rows are non-interactive, because there is nothing
  left to decide. Copy: "Expired — the agent has to ask again" / "Withdrawn by the
  agent".
  *Why this is renderer-side and not a new projection field:* the empty question
  is "why did the count change", which is a presentation fact about a list the
  user is watching. Publishing a resolved set from main would add a second,
  expiring copy of state the store deliberately does not keep
  (`approvals.ts:157-158` — the queue is in-memory precisely so a prompt cannot
  outlive its navigation).
- **Expiry while the view is hidden is the same event** with no special case: the
  badge drops, the row expires, the tab's Waiting chip clears. The agent's side
  is unchanged and already correct — its `await_access` reads `none` and it must
  re-request (`access-flow.ts:119-124`).
- **An expired request is not a denial.** No durable record is written, nothing
  appears under Denied, and the agent is free to ask again.

### 3.5 What a decision applies to, and the badge's arithmetic

A decision applies to the **entry's origin** at the scope chosen, with one
requester-bound exception — this is today's behaviour and it does not change:

| Button | Applies to | Survives | Shared with other conversations |
|---|---|---|---|
| Allow once | one navigation, bound to the asking conversation | ≤10 min, in memory | no — fails closed for any other caller (`access-flow.ts:24-34`) |
| Allow until the app quits | that exact origin | until quit | yes |
| Always allow this site | that exact origin | durable | yes |
| Allow all of `<domain>` | the registrable domain (only offered when the host computed the key, `use-browser-chrome.ts:42-45`) | durable | yes |
| Don't allow | that exact origin, as a durable no | durable | yes |

These five glosses are the band's `<dl>` (`browser-consent-bar.tsx:233-257`) and
must survive verbatim in the new tray and dock (see §4.5). The honesty standard
that produced them — the previous copy compressed five lifetimes into one false
sentence (design round 1, D3) — is a constraint on this work, not a suggestion.

**Alternatives rejected, with the reason:**

- *Keep one slot and make the badge show 0 or 1.* Refuses the ask by name, and
  makes "superseded" the ordinary fate of an agent's request whenever two agents
  work at once.
- *Stable, never-renumbered request ids shown to the user.* They are monotonic
  for the life of the process, so a single outstanding request would read
  "request 47". The user's mental model is a list they work through top to
  bottom.
- *Refuse the newest requester when the queue is full.* Turns a busy machine into
  a hard agent failure with a `access_queue_full` error the user cannot act on;
  displacing the oldest request is a state the displaced agent already handles.
- *Badge = pending + denied (i.e. "anything needing attention").* Two different
  actions under one number: a denial is durable and ignorable, a request expires.
  The denial count belongs where the decision does, in the dock's Denied section.
- *Badge = pending + approved.* The approved count is not a demand on the user;
  it moves into the dock's header as a fact ("4 sites approved"), which is where
  the current `Sites 4` count relocates to.
- *Publish a resolved/expired set from main.* Rejected above (§3.4).

---

## 4. B — The surfaces

Three surfaces, one implementation of the request, three levels of engagement.

### 4.1 The tray (the band): always visible, never occluded

The band becomes a **tray**: it renders the whole live queue and the choices for
the selected request.

```
┌ band (outside the view rect, never occluded) ────────────────────────────┐
│ 3 approvals waiting · [1] [2] [3]              Open approvals   ⌄        │  ← header row, ~28px
│ ─ selected request (full card, today's consent bar content) ──────────── │
│   The agent in 'Quarterly research' wants to open login.example.com.     │
│   <two facts: what the grant buys; the user may open it either way>      │
│   [Allow once] [Until quit] [Always allow this site] [All of …] [Deny]   │
│   Allow once            one navigation, for that conversation, up to 10m │  ← the <dl>, unchanged
│   …                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

- The **header row** carries the count and one numbered chip per live request;
  the chips are the "numbered badge callout" of R1 and they select, they do not
  navigate the page. One request pending → no header row at all, so the common
  case is byte-for-byte today's band.
- The **selected request** is `attention ?? oldest` — exactly today's rule
  (`browser-page.tsx:165-174`), with the local selection added as view state
  that defaults to the attention entry. Precedent for "a request consumed once,
  the pane's own state decides the rest": `runPanelReveal`
  (`ui-preferences-store.ts:88-118`). The tray does not get its own queue state;
  `browser-consent-attention.ts` stays the only cross-surface "show me this one"
  channel (`:22-25`).
- `aria-live="polite"` stays on the band (`browser-page.tsx:257-260`).

### 4.2 The dock: a review list that narrows the page instead of hiding it

The approvals list moves from the `Sheet` to a **dock inside the browser
surface**, on the right, in flow:

- It is a flex sibling of the content element, so the content element — and
  therefore the reported rect — narrows by the dock's width. No suppression, no
  paused note, and the page stays visible while the user reads what they granted.
- Width: `24rem` (384px) at a 1280px surface and above; `20rem` (320px) below
  that; the content area keeps `min-w-0` and is never allowed under 240px. A
  fixed width rather than a drag handle: the canvas dock needs resizing because
  its content has no natural size, while a list of rows does.
- Ground and edge: `bg-surface` with `border-l border-control`. `border-control`
  rather than `hairline` because this is the sole boundary between the app's own
  approvals chrome and a live page — remove it and the two become one surface.
  The canvas dock's `border-hairline` (`chat-content.tsx:949`) is a boundary
  between two app surfaces; this one is not the same case, and the difference is
  deliberate.
- Sections, top to bottom: **Waiting** (numbered, the selected one expanded —
  §4.5), **Approved** (today's list), **Denied** (today's), **Browsing data**
  (today's), and the standing agents-can-drive-tabs notice, which keeps its
  position and its words (`browser-sites-sheet.tsx:100-116`).
- Header copy: title `Approvals`, and the description keeps the sheet's
  explanation of the four separations (approvals vs cookies; revoke vs forget vs
  clear; the jar is this app's and its sign-ins are shared)
  (`browser-sites-sheet.tsx:88-98`). Add one sentence for the queue: "Requests
  wait here for ten minutes; after that the agent has to ask again."
- Keyboard and focus: opening the dock moves focus to its header; **Escape
  closes it and returns focus to the trigger**; it is a `<section
  aria-label="Approvals">`, not a dialog, so there is no focus trap and no scrim.
  The tray's chips and the dock's rows are ordinary buttons in the same tab
  order. Focus-visible is `outline` (branding §6) — no ring on the dock itself.

### 4.3 What happens to the three things it replaces

- **`BrowserSitesSheet` is deleted**, and its content moves into the dock
  (§4.2). Keeping both would be two implementations of one list — the defect
  `branding.md:467-471` names. Its evidence stories are withdrawn and replaced
  (§10.4).
- **The in-band consent bar is not replaced; it is split in two.** Its
  request card becomes `BrowserConsentRequest` (one component, rendered by the
  tray for the selected request and by the dock for the expanded row) and the
  band keeps being the surface that appears without the user's action. There is
  no state in which a request exists and the band is silent: the band is the
  notification, the dock is the archive of it.
- **`BrowserUrlBar`'s Sites button becomes the Approvals control**: an icon plus
  the label, `variant="outline" size="sm"` unchanged (the "outline control"
  contrast row already covers it), carrying the badge when the live count is
  non-zero (§5).

### 4.4 Where the dock lives in each host

The dock is part of the browser surface, so both hosts get it: the route renders
it full-height beside a ~1000px page area, and the chat pane (§7) renders it
beside whatever the pane leaves. In a pane narrower than ~520px the dock takes
the whole pane width and the page area is simply not given any width — that is a
layout decision, not a suppression, and it is why the pane's default width is
wide enough to avoid it in practice.

### 4.5 Alternatives rejected for the surface

| Rejected | Why |
|---|---|
| **A top-right popover anchored to the badge** (the operator's first suggestion) | It paints over the content area, which a native view occludes; making it visible means suppressing the view, i.e. hiding the page to read about the page. Also unreadable over arbitrary page content. |
| **A modal dialog over the page** | Same suppression cost, plus a focus trap and a mandatory dismissal for a list the user may want to keep open while working. It also reproduces the failure the async approval flow was built to remove (design §9.2). |
| **Keeping the Sheet and adding a second surface** | Two implementations of the same list, which drift (the same reason `branding.md` refuses a second button). |
| **Separate OS windows per tab or for the approvals list** | Every view is added to the one window's `contentView` (`index.ts:535`); a second window needs a second view host, a second rect authority and a second `window-raise.ts` decision. Design §11.1 rejects per-tab windows for the same reasons. |
| **A floating "queue chip" over the page in the bottom-right** | Occluded, and it puts the count where the toast overlap already measures badly (`browser-view-policy.ts:145-167`). |

---

## 5. C — The numbered badge, and the contrast rows it needs

The badge is a requirement, not decoration (the operator asked twice), so it is
specified to the role and to the assertion.

### 5.1 Grammar

| Property | Value | Why |
|---|---|---|
| Shape | `rounded-full`, `h-4 min-w-4 px-1`, `text-meta`, tabular numbers | One of the three places `rounded-full` is allowed (`badge.tsx:15`), and a count that changes width on every decision is a twitch |
| Fill | `bg-warning-wash` | One meaning, already in this feature: "an agent is blocked on you" (the tab's Waiting chip) |
| Edge | `border border-control` | `warningBorder` measures 2.51-2.98:1 on graded grounds in seven palettes — recorded in `contrast-contract.mjs`'s "browser waiting marker chip" row. `border-control` is the contract's own answer |
| Ink | `text-ink` | 8.62:1 on the danger wash measured for the sibling chip; `warning` as ink is not the same triple |
| Position | absolute, top-right of the Approvals control, `-translate-y-1/2 translate-x-1/2` | The operator's "corner of the button". The control gains `pr-4` so the badge never sits over the label |
| Content | the live count, and `aria-label` on the control: "Approvals, 3 waiting" | Screen readers get the number as part of the control's name, never as a bare floating digit |

**The accent is deliberately not spent here.** The accent budget is about three
spends per screen (`branding.md:109-115`), and on this surface it is already
spent once per agent tab on the agent marker (`browser-tab-strip.tsx:160-165`) —
three agent tabs alone exhaust it. A count is passive; the marker is the thing
the user must not miss.

**Primitive:** `Badge` (`badge.tsx:17-41`) gains one variant,
`attention: "border-control bg-warning-wash text-ink"`, and the badge is rendered
`variant="attention" shape="pill"`. The alternative — `variant="warning"` plus a
`className` that overrides half of it — is precisely the drift the primitive
exists to prevent; the second alternative, a new bespoke span, breaks
`branding.md:467-471`.

### 5.2 The ordinal, anchored three ways

One number appears in three places, and that is what "unifies" the surfaces:

1. **On the Approvals control**: the *count* of live requests.
2. **On the tab's Waiting chip**: `Waiting 2` — the ordinal of the live request
   whose origin this tab is parked on (today the chip is a bare `Waiting`,
   `browser-tab-strip.tsx:192-203`; `waitingTabIds` becomes
   `waiting: Record<number, number>` built from the same pure model).
3. **In the tray header and in the dock's Waiting list**: the same ordinal, in
   the same order, as the leading chip of each row.

The chip's own contrast row is unchanged by the number (same fill, edge and
ink), so this is copy and plumbing, not a new component.

### 5.3 Rows to add to `scripts/contrast-contract.mjs`

Three `CONTROLS` rows and one modification. Without them
`pnpm check-themes` says nothing about the new components
(`contrast-contract.mjs:45-48`).

| Row | `on` | fill | border | ink |
|---|---|---|---|---|
| `browser approvals badge` **(new)** | `["canvas", "surface"]` | `warningWash` | `borderControl` | `ink` |
| `browser approvals tray row (selected)` **(new)** | `["surface"]` | `elevated` | `borderControl` | `ink` |
| `browser approvals dock` **(new)** | `["canvas"]` | `surface` | `borderControl` | `ink` |
| `browser tab (hover)` **(new)** | `["sunken"]` | `elevated` | *(none)* | `ink` |
| `browser active tab` **(modified)** | `["sunken"]` | `canvas` | `borderControl` | `ink` |

Notes for whoever edits the file: the badge's two grounds are the URL bar
(`bg-canvas`, `browser-url-bar.tsx:120-123`) and the chat pane's header
(`surface`), because the same control carries the badge in both hosts; the
active tab's fill becomes `canvas` (the page's own ground) and its bottom edge
stops existing, so its `on` list loses `surface` — the ground step alone is
1.11:1 in the dark palettes, which is the measurement D18 already recorded, so
the row asserts the edge, exactly as it does today. The tray row and the dock
both hold text, which is why they are `CONTROLS` rows rather than `GRAPHICS`.

---

## 6. D — Tab-strip visual grammar

The operator reads the current strip as buttons because it *is* buttons: one row
of `rounded-sm` cells with `bg-surface`, a `border-transparent` edge and a close
button each (`browser-tab-strip.tsx:108-134`, `:242-252`). A browser tab is not a
button; it is a sheet of paper standing in a well, continuous with the page it
belongs to.

| Element | Today | Proposed | Roles and reasons |
|---|---|---|---|
| Strip | `bg-sunken`, `border-b border-control`, `min-h-10`, `px-2 py-1` | keep | The strip is the well; `border-control` is its one structural boundary against the page (D18, `:92-95`). Unchanged |
| Tab, inactive | `bg-surface`, `border-transparent`, `rounded-sm`, `text-ink-muted` | **no fill**, top-only radius, `text-ink-muted`, 1px `hairline` divider between adjacent tabs | Inactive tabs are a row of titles in the well, not raised controls. Removing the fill loses no information (the titles and the divider identify them — the `branding.md:96-107` test), so the fill comes off rather than being promoted |
| Tab, hover | `hover:bg-elevated hover:text-ink` | keep, and only that | A colour step; nothing lifts, scales or translates (`branding.md:245-250`) |
| Tab, active | `bg-elevated border-control` all round, `rounded-sm` | `bg-canvas`, `border-x border-t border-control`, no bottom edge, `rounded-t-sm`, `text-ink` | The active tab takes **the page's own ground** and is continuous with the content area through a 1px notch in the strip's bottom rule. `border-control` on the three edges it has is what makes it survive a glance (D18); the ground step is the depth cue, not the marker |
| Notch | — | the active tab paints a 1px `bg-canvas` span across its own bottom edge (`relative` + an absolutely positioned child) | This is what "connected to the content area" means mechanically, and it is why the strip's own `border-b` stays: the rule continues everywhere except under the active tab |
| Title | `truncate`, native `title` | keep | Truncation is recoverable with the pointer and the full text is in the DOM (D13, `:145-152`) |
| Width policy | `basis-32 grow min-w-32 max-w-[50%]`, row scrolls | keep | D13's reviewed policy. Chrome shrinks tabs below 128px; this strip cannot, because the mark, the chips and the close button need the room, and a 60px tab would show no name at all. **A deliberate difference from Chrome**, stated so it is not "fixed" later |
| Close | always rendered per tab | rendered for the active tab always; for an inactive tab on hover **or** focus-within; always available from the row's menu | A focusable but invisible control is a keyboard trap of its own; the menu's `Close tab` (`:237-239`) is the always-visible path. Reveal is a colour/opacity transition, never a layout shift |
| Row menu | Radix `DropdownMenu` opening *downward* over the page area | **inline expansion inside the band** | The menu is anchored at the strip's bottom edge and paints downward into the content rect, where the native view occludes it: menus in the band are deliberately not registered (`browser-view-policy.ts:32-39`), and a `z-index` cannot beat a native sibling view. The row's actions expand *inside the band* (the strip grows ~28px, the page shrinks by the same 28px, no suppression). The same fix applies to the hand-over entry point, which lives in that menu (`:225-236`) |
| Waiting chip | `Waiting` | `Waiting <n>` | §5.2 |
| Agent / Shared / Restored / Failed chips | as today | as today | The agent marker is the one thing that tells an agent tab from the user's, and its text is what a QA pass asserts on (`:155-165`); the other three are the only carriers of their state on a background tab. Restyle only if a frame shows them reading as buttons — and then as compact pills on the title row, never as new colours |
| Activation scroll | — | the activated tab scrolls into view | With the width policy kept, a long strip scrolls; a tab activated from the dock or by attention must become visible or the click looks inert |

**Deliberately not done in this PR: drag-to-reorder.** `TabRecord` has no order
field, and `snapshot()` maps `list()`, which sorts by `tabId` (`registry.ts:276-278`,
`:566-585`) — so the strip's order is creation order. A drag would have to invent
a persisted order, and one that survives restore collides with design §7.3: a
restored tab is the user's, gets no nonce (`:19-25`), and is placed by the
restore file rather than by the strip. R2 was about grammar; ordering is a
separate change with its own evidence, and it would drag a
capability-sensitive decision into a visual PR.

---

## 7. E — The conversation-scoped browser pane

### 7.1 One implementation, two hosts

`BrowserPage` splits into:

- **`browser-surface.tsx`** — everything that exists once per host: the rect
  reporter and its `ResizeObserver` (`browser-page.tsx:105-136`), the view
  visibility policy call (`:128-131`), the popup/error/failure notices, the tray
  (`:257-300`), the dock, the paused and empty states, and the tab strip and URL
  bar wiring. It takes a **scope** prop and a **surface tag**.
- **`browser-page.tsx`** — a route that renders `BrowserSurface` with
  `scope="all"`, in the same place in the tree (`app.tsx:282`), lazily imported
  as today (`app.tsx:51`).
- **`browser-pane.tsx`** — the chat-hosted surface: a right-slot pane that
  renders the same `BrowserSurface` with `scope={sessionId}`.

This is what design §11.9 asked for in advance ("the chrome is a
self-contained component tree … a route gives it the whole `<main>`; a panel
would give it a pane"). A re-implementation is rejected for the same reason a
second button implementation is: the tab strip, the tray, the dock and the
liveness model would each exist twice and drift.

### 7.2 Scope: this conversation's tabs, or all of them

- The pane's header holds a two-state switch — **This conversation** /
  **All tabs** — using the existing segmented primitive (`tabs.tsx:32-51`: a
  `sunken` track with an active pill on the next ground up), not a new control.
  Labels are the switch's own and the pane title is `Browser`.
- **This conversation** = tabs whose `sessionId` equals the pane's session id.
  That is exactly the set an agent in this conversation may drive: an agent tab
  carries the session that created it (`registry.ts:230-232`), and a handed-over
  user tab carries the session it was handed to (`:369-373`). Both are the same
  field, which is why one field answers both questions.
- **A tab with no session attribution** — a restored tab (`sessionId: null` by
  design, `:231`), a user tab never handed over, a tab handed back — appears
  only under **All tabs**, and the this-conversation tab's empty state says so:
  *"No browser tabs in this conversation yet. A tab an agent opens appears here
  while it works."* with a `Show all tabs` action. Saying "no tabs" while three
  are open behind a filter would be the kind of half-truth this feature's copy
  standard exists to prevent.
- **Requests are scoped by requester, not by tab.** `requesterSessionId` is
  already published (`host.ts:565-581`), so the pane's tray shows only the
  requests this conversation's agent raised, and the scope switch does not apply
  to it (a request belongs to a conversation by who asked). When the pane is
  showing All tabs, the tray still shows this conversation's requests and says so
  in the header ("2 approvals for this conversation"). *Alternative rejected:*
  scoping requests by origin-matching a tab in the pane, which would mis-attribute
  a request raised for a site whose tab belongs to another conversation.
- The pane's badge counts this conversation's live requests; the route's counts
  all of them. Same component, same model, different input.

### 7.3 Opening it, and how it composes with the pane stack

- **The chat header's action cluster** (`chat-header.tsx:204-262`) gains a third
  control beside `RunDetailsTrigger` and the canvas button: a Globe
  `variant="ghost" size="icon"` trigger, `aria-label="Open browser"`, carrying
  the same attention badge when this conversation has live requests (§5.1), with
  the same dot-not-count discipline debated there — here the count wins, because
  a request is an ask.
- **The right slot becomes three-way exclusive.** `claimRightSlot` gains
  `isBrowserPaneOpen` (`ui-preferences-store.ts:250-271` — the comment there
  already anticipates a third term). Width: a new `browserPanelWidth`, default
  `640`, clamped by the divider (`minWidth={480}`), because a page at 420px is
  not a page. The pane persists open across conversation switches, exactly as the
  canvas does and for the reason the store already records (`:63-70`): the slot
  belongs to the window, the content follows the conversation.
- **The rail's Browser item stays** (`sidebar-navigation.tsx:134-142`) and keeps
  navigating to `/browser`.
- **A consent banner click keeps navigating to `/browser`** (`app.tsx:185-188`,
  a reviewed fix for R8: the click must work from settings, agents, schedules).
  The pane is an additional entry point, not a replacement. *Alternative
  rejected:* having the click open the pane in the asking conversation's route —
  it would break the one property the fix was made for, that the click works from
  anywhere without knowing which conversation is open.
- **One host is mounted at a time**, so there is exactly one rect reporter: the
  route and the pane are never co-mounted (different routes). The unmount
  contract does not change — a null rect is delivered on the spot
  (`use-browser-chrome.ts:275-306`) — and the host handover is a required test
  (§10.3), because a stale null landing after the new host's first report would
  leave the page invisible on a surface that looks correctly laid out.

### 7.4 States the pane adds

Everything the route shows (`!state` spinner, no tabs, no active tab, load
failure, paused) renders identically, from the same components. Two pane-only
states are added: **scope-empty** (§7.2) and **scope-with-one-tab**, where the
strip must not look broken with a single tab. The pane's loading state is the
same `Spinner` (`browser-page.tsx:346-350`) so that a QA pass can assert one
selector in both hosts.

### 7.5 The route stays

Yes. It is deep-linkable, it is what the rail points at, it is the surface the
consent banner navigates to from any route, and it is the only host that can give
the page a full window. The pane exists because the operator's actual question
("what is the agent in *this* conversation doing") is conversational, not global.

---

## 8. F — "I don't see any navigation or work"

**This section states a hypothesis and the checks that would falsify it. It does
not assert a fix.** A parallel scout is reproducing the behaviour in a real
headless run; §8.4 says what slots in where.

### 8.1 The mechanism I believe is responsible, from the code

The agent's tab is created **non-active** and a non-active tab's view is never
presented:

- `registry.create` sets `activeTabId` only for a user tab — the comment records
  the bug that made this explicit (`registry.ts:222-249`);
- `applyLayout` computes `presented = isActive && visible && rect !== null` and
  hides everything else, parking it at `BACKGROUND_VIEWPORT`
  (`registry.ts:492-503`, `:101-106`);
- the only path that activates a tab is the renderer's own IPC call
  (`ipc.ts:93-96` → `host.ts:786` → `registry.activate`), and nothing in the
  agent's actions calls it (`grep activateTab src/main` → the IPC handler and the
  method);
- the page area renders the active tab's URL and title only
  (`chromeState`, `host.ts:544-551`), and design §11.1 is explicit: "only the
  active tab occupies the rect; every other tab is `setVisible(false)`";
- the chrome proof harness confirms this is observable behaviour, not theory: its
  comment says the active tab is the user's, and it has to **click the strip's
  agent tab** precisely so the composited frame can hold the agent's page
  (`browser-chrome-proof.mjs:656-665`, `:1470-1479`).

So an agent can be navigating, reading and filling forms while the user sees: a
new tab appear in the strip marked `Agent`, its title change, and **nothing in
the page area**. Add the second-order effect — nothing fires on an agent tab's
navigation beyond `onChanged` (`actions/tabs.ts:145-150`), so the strip's spinner
is the only live signal — and the report "I approved a bunch of agents but see no
work" is exactly what the implemented layout predicts.

### 8.2 The falsifiable checks

Run in one headless session, in this order, and record the actual output:

1. **Is the agent's tab real and did it navigate?** Read the projection
   (`browser-state`) before and after an agent `open` with a URL: assert the new
   tab exists, `owner: "agent"`, and `activeTabId` is **unchanged**. Then capture
   the agent tab's page through the host's own `screenshot` RPC
   (`browser-host-proof.mjs` already drives exactly this call at `:685-690`) and
   assert the PNG shows the URL the agent asked for.
   *If this fails*, the mechanism is not layout: the agent's navigation was
   refused (`origin_not_allowed`) or never issued, and §8 goes with the scout's
   finding instead.
2. **Does the user's view change at all?** Capture the renderer frame on
   `/browser` and assert the content area shows the user's tab, not the agent's —
   i.e. the frame is a function of `activeTabId`, not of who navigated.
3. **Is the tab parked, not damaged?** Compose the rect the renderer reports with
   the agent tab's page capture at that rect (the mechanism
   `browser-chrome-proof.mjs:551-600` already implements) and confirm the page
   renders fully at the background viewport. This distinguishes "hidden" from
   "broken", which is the difference between a UX fix and a host fix.
4. **Ruling out the neighbours**, each with one read: the tab was closed by the
   agent after finishing (`tabs` action `close`); the hand-over was revoked or the
   tab handed back (`handedOver` false in the projection); the agent's approval
   was granted for a *different* origin than the one it navigated to (compare the
   tab's `url` origin against `approvals[].origin`); the app was on another Space
   so nothing was on screen at all (the harness runs `headless`, so this is
   observable as "the user was not looking", not as a defect).

### 8.3 What the fix belongs to (once confirmed)

The fix is **UX, not layout**, and it does not get to violate design §11.4:

- **No auto-activation, ever.** `registry.ts:215-219` and design §11.4 say an agent
  `open` must never switch the tab the user is looking at; a "follow the agent"
  mode that changed the presented tab would be that switch with a different name.
- **Make the activity legible in the strip** (§6): a live title (already
  projected), a spinner on an agent tab that is loading (today the spinner is
  gated on the *active* tab — `browser-tab-strip.tsx:65-71` — which means a
  background agent tab loading a page shows nothing at all; that gate is a
  defect against §8.1 and belongs in PR 1), and a `Waiting <n>` chip when it is
  blocked.
- **Make it one click to watch**: a `Watch this tab` item in the row's
  (now in-band) action expansion, and in the pane, a per-tab `Watch` action in
  the conversation's tab list. Activation is the user's click, which is what
  design §11.4 permits.
- **Say where the work is in the pane**: the conversation-scoped list (§7.2) is
  itself the answer to R3 for the conversational half — the user opening the pane
  sees the conversation's tabs, their live titles and their state. If the scout's
  finding is that the tab is never activated *and* the user has no reason to look,
  the pane is the missing affordance, and it is already PR 2.

### 8.4 What the scout's result changes here

- If checks 1-3 confirm the mechanism: §8.3 stands as written, and the strip's
  spinner gate plus `Watch` land in PR 1 (small, testable) with the pane's list
  in PR 2.
- If check 1 fails (the agent never navigated): the layout is innocent; the
  defect is upstream in the gate or the agent's flow, this document's §8.3 is
  withdrawn, and the fix moves to a backend-side ticket-shaped change with its
  own reproduction.
- If check 2 shows the user's view *does* change on an agent navigation: the
  hypothesis is wrong at `registry.create` or `applyLayout`, and the fix is in
  main (a presentation bug), which is a different PR from either of ours.

---

## 9. G — The PR split

The proposed split is **confirmed**, with two amendments: the dock moves *into*
PR 1 (the queue and the count have nowhere to be read without it), and
`BrowserSurface`'s scope API is fixed in PR 1 even though only the route uses it.

### PR 1 — the queue, the surfaces, the badge, the tab grammar

| Area | Files |
|---|---|
| Main: queue semantics | `src/main/browser/approvals.ts` (stop displacing; displace at the cap; refuse a decision on an expired entry), `src/main/browser/consent-notifier.ts` (one banner per batch — see below) |
| Main: projection | none (no new field is needed for PR 1) |
| Renderer model | `src/renderer/src/features/browser/model/approval-queue-model.ts` (new: liveness, ordinal, scope labels, expiry memory — pure functions, unit-tested) |
| Renderer surface | `browser-surface.tsx` (new, extracted from `browser-page.tsx`, takes `scope`), `browser-page.tsx` (becomes the route wrapper), `browser-approvals-tray.tsx` (new), `browser-approvals-dock.tsx` (new), `browser-consent-request.tsx` (new, the card extracted from `browser-consent-bar.tsx`), `browser-consent-bar.tsx` (keeps the band's framing, renders the tray), `browser-tab-strip.tsx` (grammar, `Waiting <n>`, in-band row actions, background spinner), `browser-url-bar.tsx` (Approvals control + badge slot), `use-browser-chrome.ts` (expose the model inputs and the shared clock, `sessionId` untouched in PR 1) |
| Renderer deleted | `browser-sites-sheet.tsx`, `browser-sites-sheet.stories.tsx` |
| Primitives | `src/renderer/src/shared/components/ui/badge.tsx` (`attention` variant) |
| Gates | `scripts/contrast-contract.mjs` (four rows, §5.3) |
| Tests | `scripts/browser-host.test.mjs` (two origins coexist; cap displacement keeps `superseded`; a decision on an expired entry is refused), `scripts/browser-chrome.test.mjs` (the pure model: liveness, ordinal, expiry memory), `scripts/browser-chrome-proof.mjs` (extended: two pending, tray, badge, dock open/close, rect narrows, tab actions in band) |
| Evidence | withdrawn `browser-sites-sheet--*`; new stories (§10.4) |

**Amendment, the notifier.** With a real queue, `announce` raises one banner per
unannounced entry (`consent-notifier.ts:66-95`) — up to 16 banners for one busy
minute, against a rule that exists to avoid interrupting the operator. New rule:
announce on the **live-count increase** only, at most one banner per count
change, body "An agent wants to open `<origin>`." when one is pending and
"`<n>` site approvals are waiting." otherwise, click naming the oldest live
entry. The `announced` set becomes a count watermark. The copy lives in
`consent-notifier.ts:35-38` and nothing else imports it — checked, not assumed.

### PR 2 — the conversation-scoped pane

| Area | Files |
|---|---|
| Main: one additive field | `src/main/browser/host.ts` (`chromeState()` projects `sessionId` per tab, `:531-543`; `snapshot()` already carries it at `:556-560`; the nonce stays unprojected) |
| Renderer types | `use-browser-chrome.ts` (`BrowserTabView.sessionId`) |
| Pane stack | `src/renderer/src/shared/store/ui-preferences-store.ts` (third pane in `claimRightSlot`, `browserPanelWidth` + default), `src/renderer/src/features/chat/components/chat-content.tsx` (render the pane beside the canvas branch), `chat-header.tsx` (the Globe trigger with the badge) |
| Pane | `src/renderer/src/features/browser/components/browser-pane.tsx` (new), `browser-surface.tsx` (honour `scope`, add the scope switch and the scope-empty state), `approval-queue-model.ts` (scope filter) |
| Tests | `scripts/browser-host.test.mjs` (the projection carries `sessionId`; the nonce still does not), `scripts/browser-chrome.test.mjs` (scope filter; a tab with no attribution appears only under All tabs), a new scene in `scripts/renderer-driver.mjs` for the pane (§10.4) |

**What makes PR 2 depend on PR 1's component APIs** — name these in review, they
are the interfaces PR 1 must get right the first time:

1. `BrowserSurface`'s **`scope` prop** (`"all"` | `{ sessionId: string }`) and
   its shape as a component that owns the rect reporter. If PR 1 hard-codes
   "all", PR 2 becomes a refactor of the surface under a review round.
2. The **liveness/ordinal model as a hook over the projection**, not as page
   state: the pane mounts the same hook, and a model that lives inside
   `BrowserPage` would be duplicated.
3. The **tray's scoping inputs** (which requests it shows, and the header's
   wording) as props, so the pane can narrow by requester.
4. **The dock's `surface` tag**: it must be per-host (`browser-dock` vs
   `browser-pane-dock` is *not* needed — the hosts never co-mount — but the
   evidence tags must be asserted by a test that knows which host it is driving).

---

## 10. H — Evidence plan

### 10.1 What each kind of evidence can and cannot show

| Claim | Evidence | Why not the other |
|---|---|---|
| Band/tray/dock/tab grammar, copy, badge | **Storybook capture**, sized tight to content | The chrome band is ordinary DOM; the native page under it is not (`capture-evidence.mjs:218-225`). Frames that are 99% ground cross `check-evidence`'s uniformity ceiling — declare a height that fits the band, not a window |
| The tray/dock/tab strip on the real route, with a real page | **`scripts/browser-chrome-proof.mjs`** — composes the renderer frame with the host's page capture at the reported rect | A renderer frame alone cannot contain the page (`docs/agent-driver.md:268-280`, measured with a magenta page) |
| The pane in the chat, opened by a click, at a real viewport | **`scripts/renderer-driver.mjs`** — a new scene: navigate `/chat`, press the header's `browser-pane` trigger, capture, assert the pane's rect and the page host handover | The driver cannot see inside the page either; the pane's own chrome is the claim |
| The queue's rules | `scripts/browser-host.test.mjs` with the injectable clock (`approvals.ts:126`, `:201`) — expiry and cap are deterministic, no waiting | A live 10-minute wait is not evidence anyone re-runs |
| Anything about the page's content | The host's `screenshot` RPC (`browser-host-proof.mjs:685-690`) | |

### 10.2 Per-PR matrices

**PR 1 — states that must exist as frames** (each in `localOperatorLight` and
`localOperatorDark` at minimum; `branding.md:492-496` puts the light themes
first because that is where contrast defects hide):

| State | Story / surface |
|---|---|
| one pending (the common case, visually unchanged) | tray |
| two pending, selected = 1 | tray |
| three pending, selected = 2 from an attention click | tray |
| busy (a decision in flight) | tray |
| expired just now + withdrawn | tray (the §3.4 memory states) |
| badge: none, 1, 3 | url bar / Approvals control |
| dock: waiting (2), approved (3), denied (1), empty, narrow (320px) | dock |
| tab strip: one, many (6), overflowing (12), waiting, agent+waiting mixed, failed, restored | strip |
| in-band tab actions expanded | strip |
| past the fold: the dock's long list (fold rule + fade) | dock |

**Before/after pairing:** capture the *before* from `origin/main` in a scratch
worktree at the same sizes with the same command, attach both to the PR (not into
`docs/evidence`, which holds one tree's set), and label the pair. A visual-change
review needs the pair; a single "looks fine" hides exactly the regressions §6 is
about.

**Motion:** the strip growing when the row actions expand and the dock opening
are transitions the user sees. Capture **consecutive frames** across each (the
pattern already used for P11 at `browser-chrome-proof.mjs:1606-1616`) and state
the settle time. A first frame that differs from the settled frame is a reflow;
the pair is what makes it visible.

**PR 2 — states:** pane empty (no tabs for this conversation), pane with one
agent tab and a live page, pane with the scope switch on All tabs, pane dock open
at 640px, pane at its 480px minimum, the host handover (chat→`/browser` with the
pane open: the page must appear once, and the rect must be the route's).

### 10.3 The commands

```bash
# rules, on the shipped TypeScript
env NODE_TEST_CONTEXT=child-v8 pnpm test:desktop     # includes browser-host/browser-chrome

# quality gates, all four, before any PR
pnpm check-types && pnpm lint && pnpm check-themes && pnpm check-evidence

# the DOM half, captured from Storybook (append mode for a narrowed set)
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=browser- --themes=localOperatorDark,localOperatorLight
pnpm check-evidence        # the manifest must record partialCapture honestly

# the live app, page composed at the reported rect (scratch HOME + profile, headless)
node scripts/browser-chrome-proof.mjs

# the live app, the pane walked by a real click (built app, headless)
pnpm build
node scripts/renderer-driver.mjs --scene browser-pane --out /tmp/frames
```

**Isolation, non-negotiable** (the harnesses already do this; anything new must
too, `browser-chrome-proof.mjs:9-28`, `agent-driver.md:120-160`): redirect `HOME`
**and** `LOCAL_OPERATOR_CONFIG_DIR`; use a scratch `--user-data-dir`; launch
`--window-mode=headless` (never `normal` — `AGENTS.md:195-224`); unset **every**
`CMUX_*` and `LOP_*` variable, because an inherited `CMUX_WORKSPACE_ID` has
already renamed the operator's real workspaces. Never answer an approval through
the dev driver (`agent-driver.md:303-306`): approvals are the operator's.

### 10.4 The evidence set's own change (PR 1)

Withdrawing `browser-sites-sheet--populated` and `--empty` and adding the new
story ids is a change `check-evidence` enforces (`REACHABLE` shas, manifest
counts, the `partialCapture` record). Do it in the same commit as the stories:
the manifest is derived, and a hand-edited `countsMean` is the failure the script
exists to catch. PR 1's evidence commit should say which ids left and which
arrived, in the PR body, the way the last browser round's did.

---

## 11. Risks I would want watched during rollout

1. **The queue change is the only change here with an agent-visible
   consequence.** A queued request waits where a displaced one failed fast. Watch
   `status`'s `pending` count and the host log line
   (`approvals.ts:453-455`, "... is asking for access to ... (N pending)") in the
   first real multi-agent session, and be ready to lower `ACCESS_QUEUE_CAP` or
   restore displacement-under-pressure if agents start timing out.
2. **The dock narrows the page, and pages are opinionated.** A site that refuses
   to render below its own breakpoint shows a mobile layout at 1000px — honest,
   but it will be reported as "the panel broke the page". The alternative (hiding
   the page) is worse; the copy should name the trade in the dock's description.
3. **The tab grammar touches colours the contract asserts.** Every row in §5.3
   must be added *and* passing before the frames are taken; a `check-themes`
   failure after frames exist means recapturing them.
4. **The in-band action expansion is a new interaction shape.** It is the fix for
   an occlusion nobody has measured yet (§6) — so the occlusion itself needs a
   frame first (§8.2 check 2's capture with a menu open), otherwise the
   "improvement" is asserted rather than shown.
5. **Two hosts, one rect authority.** The failure mode is a page that is
   invisible or painted over the wrong surface after a route change; the handover
   test in §10.2 is the one that catches it.
6. **R3's fix depends on a result we do not have yet.** Do not let PR 1 grow a
   speculative "follow the agent" mode; §8.3's legibility work is bounded, and
   anything beyond it waits for the scout.

---

## 12. What I could not determine, and what would settle each

1. **Whether the strip's row menu is currently occluded in practice.** The
   mechanism is certain (a downward Radix menu from the band into the content
   rect, unregistered by design) but I have not measured it, and there is a
   plausible escape: if Radix's portal or the menu's own positioning happens to
   land it inside the band for every real strip height, the defect is theoretical.
   *Settles it:* one capture with the menu open on `/browser` with a page loaded
   (`browser-chrome-proof.mjs` already opens this menu at `:1583-1600` — the
   frame it does not take is the one that shows where the menu painted).
2. **The panel's minimum usable width for a real page.** 480px is a guess
   justified by breakpoints, not a measurement. *Settles it:* capture two or three
   real sites the operator uses at 480/640/1000 and look.
3. **Whether expiry is worth a countdown at all.** "expires in 9 minutes" is
   honest and cheap, but it may read as pressure on a decision that is not
   urgent. *Settles it:* the design round's judgement on the frames; it is one
   line to remove.
4. **The banner-per-batch copy.** §9's amendment names new strings; nothing else
   imports them, but a native banner's wording is a product decision. *Settles
   it:* the operator reading the two sentences.
5. **Whether the route should default to All tabs while the pane defaults to
   this conversation.** I recommend it; it is a taste call, not a constraint, and
   it is a one-line default in the scope prop.

---

## 13. Not addressed, deliberately

- **Drag-to-reorder tabs** (§6): no order field in the registry, and it is not
  R2.
- **A third "requests" history** (expired/superseded, durable): the store is
  in-memory by design (`approvals.ts:157-158`), and a history would be a new
  persisted thing with its own retention question.
- **Per-tab approval scoping** ("let the agent use *this* tab on this site"):
  the gate is per-origin by design (§9.2, `access-flow.ts`), and per-tab grants
  would be a new authorization model, not a UI change.
- **A browser pane on other routes** (settings, agents): the pane exists for a
  conversation; the rail's route is the global surface.
- **Favicons**: the strip keeps its glyph marks (`browser-tab-strip.tsx:53-60`);
  a favicon fetcher is a network path this feature has no other use for.
