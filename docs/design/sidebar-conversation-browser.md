# Conversation browser affordances and session-scoped tabs — design

Scope: `local-operator-ui`, branch `feat/session-browser-tabs` (cut from
`origin/main` at `0c04cbb09`). This document designs the *next* increment over
what PR #253 already shipped (the conversation-scoped pane, the surface split, the
scope switch, the tab-strip grammar, the approvals tray and dock). It does not
redesign any of that; every recommendation below is stated as a delta against the
code on this branch.

Read alongside: `docs/branding.md` (the design contract),
`docs/design/browser-approval-ux.md` (§6 tab-strip grammar, §7 the
conversation-scoped pane, §9 the PR split, §10 the evidence plan),
`docs/agent-driver.md`, and `AGENTS.md`.

---

## 1. The problem as I found it

### 1.1 A tab opened in a conversation is unattributed, and no sidebar control exists

`BrowserHost.newTab()` creates the tab with no session
(`src/main/browser/host.ts:650-656`):

```ts
async newTab(): Promise<Record<string, unknown>> {
    const record = this.registry.create({ owner: "user" });
```

`registry.create` therefore stores `sessionId: null`
(`src/main/browser/registry.ts:221-254`, the field written at `:231`), and
`chromeState().tabs[].sessionId` — the ONE field the pane's scope filter reads —
is `null` (`src/main/browser/host.ts:574`, filtered by
`tabsInScope` in `src/renderer/src/features/browser/model/approval-queue-model.ts:382`).
So the three user-facing ways to open a tab all produce a tab that "This
conversation" will never show: the strip's `Plus` (`browser-tab-strip.tsx:838-849`
→ `chrome.newTab()`, `browser-surface.tsx:452`), the empty state's `New tab`
(`browser-surface.tsx:624-630`), and the blocked-popup notice's "Open in a new tab"
(`browser-surface.tsx:508-521`). `git grep -n "browser" chat-sidebar.tsx` returns
nothing: there is no per-conversation entry point in the sidebar at all. The only
entry points are the Globe in the open conversation's header
(`chat-header.tsx:283-360`) and the rail's route.

### 1.2 The route's strip is flat

`BrowserSurface` renders `BrowserTabStrip` with `tabs={tabs}` where `tabs` is
`tabsInScope(allTabs, stableScope)` and the route passes `tabScope="all"`
(`browser-page.tsx:1-32`, `browser-surface.tsx:236-242`, `:446-455`). There is no
grouping anywhere in the renderer: the strip iterates `tabs.map(...)`
(`browser-tab-strip.tsx:333`) in registry order, which is `tabId` order
(`registry.ts:276-278`). A tab's conversation is published on the wire
(`host.ts:574`) and read by the scope filter, and by nothing else.

### 1.3 The squish, precisely

The width policy is `basis-32 grow max-w-[50%]` plus a hand-written floor ladder
by chip count, in three container tiers (`browser-tab-strip.tsx:459-479`, `:507`).
The floors are honest about their own limit, and the file says so: at five chips
the inactive row's title is **72px** and the committed `worst-case` frame reads
`Check...` (`:384-398`). At the base tier the five-chip row needs a 465px floor to
keep an 85px title; the file deliberately declines to give one pathological row
that much scroll order. So the reviewed policy already fails the outcome this
change is asked to produce ("a tab's title is never reduced to less than a readable
floor") in one reachable state, and the arithmetic that proves it is in the file.

Two more facts matter for the route at scale:

- the tiers are measured against `@container/strip` on the strip's **row**, which
  is load-bearing (`:314-328`) — moving it to the scroller is what made the strip
  oscillate between fitting four tabs and not;
- the reach-any-tab guarantee is the pinned `+N` control (`:769-832`), and that
  control is a **Radix `DropdownMenu` anchored in the band**, which paints
  downward into the content rect — exactly the shape §6 identified as occluded by
  the native view and replaced for the row menu (`:62-67`,
  `shared/browser-view-policy.ts:34-38` deliberately does not register menus in
  the band). §12.1 of the design doc flags this class as mechanism-certain but
  unmeasured. If it is occluded, the "always reach any tab" guarantee is broken at
  exactly the scale R3/R4 are about.

### 1.4 The row menu is a band, and it has two items that address one tab at a time

The row's actions are an in-band expansion (`browser-tab-strip.tsx:851-956`) with
`Watch "X"`, `Let an agent use "X"…` / `Stop letting the agent use "X"`, and
`Close "X"`. There are no batch closes. `host.closeTab` closes exactly one tab per
intent (`host.ts:658-664`), and each close runs
`registry.destroy → forget` (`registry.ts:515-547`), which calls `applyLayout()`
and `onChanged()` per tab. `onChanged` is not incidental: it publishes
`browser-state-changed` and writes `session.json` (`src/main/browser/index.ts:294-302`,
`notifyChanged`). So N sequential closes are N full `chromeState()` builds, N IPC
broadcasts, N renderer re-reads and N session-file writes.

### 1.5 One more thing, found on the way: the projection is subscribed per consumer

`useBrowserProjection()` owns `useState` plus **two** IPC subscriptions and an
initial read, per call (`hooks/use-browser-chrome.ts:237-281`). That is correct
today because there are at most two consumers (the surface, and the header's
badge via `use-conversation-approvals.ts:43-54`). R2 wants a mark on *every*
conversation row, and the sidebar renders every row in one scroll container with
no virtualisation (`chat-sidebar.tsx:979`). Forty rows × one subscription each =
forty `/browser-state` reads per `browser-state-changed` event, each returning the
whole projection. This is the single most important structural decision in the
change, and it is why §7 below starts by making the projection a shared store.

---

## 2. The principle this design is built on

**One model, one strip, three hosts, and no second place where a tab's
conversation is decided.** The registry's `sessionId` is already the answer to
"which conversation is this tab's" (`registry.ts:231` for an agent tab, `:371` for
a hand-over, both projected at `host.ts:574`). Everything in this document derives
from that one field: the pane's scope, the route's groups, the sidebar's mark, and
the one "new tab" attribution rule. Nothing introduces a second attribution field,
a second list, or a second close path.

---

## 3. Decisions, R1–R6

### R1 — A tab opened from a conversation is attributed to it

**Main-process change, additive and one argument wide.**

```ts
// src/main/browser/registry.ts — unchanged: CreateTabOptions.sessionId already exists (:181-190)
// src/main/browser/host.ts
async newTab(sessionId?: string | null): Promise<Record<string, unknown>> {
    const record = this.registry.create({ owner: "user", sessionId: sessionId ?? null });
    …
}
```

`registry.create` already stores a non-restored tab's `sessionId` (`:231`) and
already sets `nonce: null` for every user tab (`:232`), so:

- **the capability model does not change.** `mayDrive` requires
  `record.sessionId === sessionId && record.nonce !== null` (`:395-397`); a user
  tab created this way has the session but not the nonce, so an agent in that
  conversation still cannot drive it. The `tabs` listing redacts its handle
  (`actions/tabs.ts:293-296`), `agentTabCount()` is unmoved (`:286-288`, it filters
  on `owner`), the agent cap is unmoved (`:262-269`), and hand-over remains the
  only authority transfer (`:352-377`). This is the property to assert in a host
  test, not to assume: a test that a `{ owner: "user", sessionId }` tab is
  `mayDrive === false` and lists with a redacted handle.
- **the tab is the user's and becomes active**, because `create` activates only
  user tabs (`:250`) — which is right: the user pressed the button.

**What the control does, per host and per scope.** The attribution target is the
**host's** conversation, not the list currently on screen. The scope switch is a
lens over the pool, not a creation mode; a lens that changed what `New tab` did
would mean a tab opened while reading "All tabs" could not be found after
switching back to "This conversation", which is the half-truth class this feature's
copy standard exists to prevent.

| Host | Scope on screen | Control | Accessible label | Effect |
|---|---|---|---|---|
| Pane (`hostSessionId = S`) | This conversation | strip `Plus`, empty-state `New tab`, popup notice's `Open in a new tab` | `New tab in this conversation` | tab created with `sessionId: S` |
| Pane | All tabs | same | `New tab in this conversation` | same — the host is still S |
| Pane on a draft (`sessionId = null`) | all | same | `New tab` | unattributed (`sessionId: null`) |
| Route (`hostSessionId = null`) | all | same | `New tab` | unattributed (unchanged) |

`BrowserSurface` gains one prop to carry this: **`hostSessionId: string | null`** —
the conversation this host belongs to, independent of `tabScope`. The route passes
`null` (`browser-page.tsx`), the pane passes its `sessionId`
(`browser-pane.tsx:86`), and `useBrowserChrome`'s `newTab` takes it as an argument
rather than the hook taking it as state, so there is exactly one call site per
control.

**Copy change this forces.** The pane's scope-empty sentence is now incomplete: it
says only that an agent's tab appears here
(`browser-surface.tsx:608-611`). It becomes: *"No browser tabs in this
conversation yet. Tabs opened here, and tabs an agent opens while it works, appear
here."* The `Show all tabs` action and both existing sentences otherwise stand.

### R2 — A corner affordance on every conversation row

**Where it goes, and why the row has to be restructured.** The conversation row is
one `<button>` (`chat-sidebar.tsx:467-582`) carrying `data-chat-row`
(`:478`), `data-tour-tag="chat-session-row"` (`:484`), `aria-current` (`:498`),
the `title` tooltip (`:513`), `ChatSessionStatus` in the lead (`:516`), the
truncating title (`:531-533`) and one trailing statement (`:540-579`). A second
interactive control cannot be nested in it. The pattern to copy is the **entity
row** two hundred lines below: a wrapper `div` that paints the row's ground, a
`flex-1` name button carrying `data-chat-row` and `rowStyle`, and sibling 24px
controls (`:609-680`). So the session row becomes the same three-part shape:

```
div.group (ground: rowCurrent when selected)                      ← new wrapper
├─ button[data-chat-row][data-tour-tag=chat-session-row][aria-current][title]  ← unchanged attributes
│   ├─ ChatSessionStatus
│   ├─ span.flex-1.truncate          (title)
│   └─ trailing statement            (unchanged: rowTrailingStatement, chat-search.ts:215-227)
└─ BrowserConversationMark           ← the new corner affordance, NOT data-chat-row
```

Non-negotiable details, each because something already depends on it:

- `data-chat-row` stays on **exactly one** element per row: `keyDown` moves focus
  by `querySelectorAll("[data-chat-row]")` (`chat-sidebar.tsx:804`), and the
  session-switch harnesses select `[data-chat-row][title^=…]` and
  `[data-chat-row][aria-current="page"]` (`scripts/session-switch.tsx:260,469`,
  `scripts/session-switch-latency.mjs:408,427`,
  `docs/evidence/chat-sidebar-selection/harness/drive.mjs:478`). The corner mark
  must **not** carry `data-chat-row`, or arrow traversal starts landing on the
  browser affordance of every row.
- `title` and `aria-current` move with the row button, not the wrapper.
- the ground goes on the wrapper **and** the row button, for the reason the entity
  row's own docstring records (`chat-sidebar.tsx:90-100`): a child's
  `hover:bg-elevated` paints over a parent's ground, so selection and hover
  collapse. `scripts/chat-sidebar-selection.test.mjs` resolves these expressions
  through the shipped `cn`; it gains the session row's pair.

**The mark's states.** A new component,
`features/browser/components/browser-conversation-mark.tsx`, entirely derived from
the shared model (§7) — it holds no tab list of its own, so it cannot become a
second browser implementation. Props: `{ sessionId: string; summary: ConversationBrowserSummary; onOpen: (sessionId: string) => void }`.

| State | Visible | Role of the count | Accessible label |
|---|---|---|---|
| no tabs, no approvals | `Globe`, `text-ink-dim` | — | `Open the browser for "Reports"` |
| has tabs | `Globe` + `n` in `text-meta text-ink-muted tabular-nums` | quiet; a tab count is a fact, not an ask | `Open the browser for "Reports" — 3 tabs` |
| an agent tab is loading | glyph swapped to `RotateCw` `animate-spin` (the strip's own per-tab treatment, `browser-tab-strip.tsx:112-126`) | count unchanged | `… — 3 tabs, loading` |
| approvals pending | the same accent `Badge` the header uses (`chat-header.tsx:343-359`), positioned for this box | an ask gets a count and the accent, per §5.1 | `Open the browser for "Reports" — 2 approvals waiting` |
| a tab failed to load | glyph keeps a `text-danger`… **no.** See below | | |
| unavailable outside Electron | **not rendered** | — | — |

Two of those rows need the reasoning written down:

- **"a tab failed" is deliberately NOT a sixth state.** The strip marks `Failed`
  because a *background* tab's blank page has no other signal
  (`browser-tab-strip.tsx:569-580`). In the sidebar there is no page on screen to
  explain, the row is 280px wide and already carries `ChatSessionStatus` in the
  lead, and a fourth mark on one row is noise. `failedCount` stays in the summary
  (cheap, and it is what the pane's frame is *for*), and the mark does not draw it.
- **unavailable outside Electron: the mark is not rendered at all.** The whole row
  is the densest list in the app, and this state exists only in Storybook and the
  unit tests — for a user the app is Electron. The header's Globe still opens the
  pane that says "The browser is only available in the desktop app."
  (`browser-surface.tsx:431-439`), so the fact is not hidden, it is just not
  repeated 40 times. *(Open question 5 has the alternative: render it disabled.)*

**Hit area and focus.** `size-6` (24px) matching the entity row's controls, inside
the row's `h-8`, `shrink-0`, `rounded-md`, the same `focus-visible:outline
focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`
the row uses. On the session row the slot is **reserved at rest list-wide**, and
**drawn in the state table's first row rather than revealed on hover** (settled at
implementation; review round 1, D2/A4). The earlier wording here — "reveal is
`opacity` only" — described the search mark's treatment, which this section already
distinguishes: that mark appears on the rows that carry it, so a reveal is how it
stays out of the way, while this control is on *every* row, its first state is a
fact a user needs ("does this conversation have a browser?"), and `opacity-0` at
rest would put the entry point back behind the pointer on exactly the rows where
nothing is open yet. So the slot is always occupied and the quiet state is a dim
`Globe` (`text-ink-dim`), which is what the state table above has said all along.
The cost is 28px of a 280px sidebar for every title — measured in the slot-cost
frame (`docs/evidence/browser-conversation-mark/slot-cost/`, `browser-conversation-mark--slot-cost`),
which prints the two rows' title widths and their difference; the title truncates
and `title` carries the full string, so nothing is lost, and the trade is the same
one the entity rows already make.

**Where the mark's data comes from, and the rows that are not in the store.**
`sessionRow` is rendered from four places — the nested and flat lists and three
search sections (`chat-sidebar.tsx:708`, `:1218`, `:1232`, `:1251`) — so the mark
belongs inside `sessionRow` and not at a call site. The summaries map is keyed from
the **tab** side (a tab's `sessionId`, plus requests by requester), not from the
session list, so a row rendered from a search answer for a conversation whose
tabs exist still shows its true mark; the conversation's *name* resolves through
`sessionDisplayName`, whose fallback is the session id, which is the rule the
hand-over dialog already uses for an unnamed conversation
(`browser-consent-request.tsx:118-127`).

**What a press does.** Select the conversation, set the pane's lens to
`"conversation"`, open the pane. All three in the click handler, so React batches
them into one render:

```ts
onOpenConversationBrowser(sessionId)   // chat-content.tsx
  → onSelectConversation(sessionId)
  → useUiPreferencesStore.setBrowserPaneScope("conversation")
  → useUiPreferencesStore.setBrowserPaneOpen(true)   // clears canvas/run via claimRightSlot
```

The lens overwrite is deliberate and is named as open question 7: the control says
"this conversation's browser", so what it opens has to be that, even if the user
last left the pane showing All tabs. One click in the pane's own switch takes the
lens back, and the switch's value is what the pane shows
(`browser-pane.tsx:110`).

**The press TOGGLES (review round 2, U6, ruled).** A second press on the same mark
used to be inert — state before and after identical, which is indistinguishable from
a press that did not register. It now closes the pane when that pane is already open
on that conversation (`isBrowserPaneOpen && browserPaneScope === "conversation" &&
active === sessionId`); every other press is the three steps above. The lens is one
of the three conditions rather than a detail: a pane left on *All tabs* is not "open
on this conversation" in the sense the control means, so a press there normalises the
lens instead of closing a surface the user is looking at for another reason. The
header's `Globe` is NOT this and is left alone — it renders only while the pane is
shut (`chat-header.tsx`: `onOpenBrowser && !isBrowserPaneOpen`), so it has no
second-press state to make inert and already behaves as a one-way toggle by
disappearing. The mark's accessible name is unchanged, deliberately: the press's
outcome is visible on screen, and a state-dependent label would change the label
grammar the driver scene reads.

### R3 — The route pools tabs by conversation

**Grouping happens in the renderer, and the registry's order is untouched.** This
matters: `registry.snapshot()` sorts by `tabId` (`registry.ts:276-278`) and the
host-proof harnesses assert on `state.tabs[0]`
(`scripts/browser-chrome-proof.mjs:1239,1319`). Grouping is a *presentation of the
pool*, so it lives where presentation lives.

**Order rule: groups by their first tab, tabs within a group by creation order.**
`pooledTabs(tabs)` returns a stable re-ordering of the pool. Rationale against the
alternative (contiguous runs in creation order, which never moves a tab): with
runs, three conversations interleaved by creation give a strip that reads
`A B A C A`, i.e. the same conversation labelled three times, and "see all the tabs
opened by that session" — the operator's words — stops being answerable by looking
at one place. The cost of blocks is that a hand-over can move a tab between groups;
that is a change the user caused, and the `Shared`/`Agent` chip already announces
it. It is also the one order that keeps the pane's conversation scope
(single group ⇒ no labels) byte-identical to today.

The unattributed run (`sessionId === null` — restored, never handed over, handed
back: `registry.ts:231`, `:386`) sorts **last**, under the label
**`No conversation`**.

**Group chip anatomy**, rendered only when the pool has ≥2 groups (so the pane's
conversation scope and every existing story are visually unchanged):

- no fill — the strip's grammar says an inactive tab is text in the well
  (`browser-tab-strip.tsx:48-60`), and a group label is not a control either;
- `MessagesSquare` 14px + the conversation's name, `text-meta text-ink-dim`,
  `shrink-0`, `max-w-24`, `truncate`, `title` = the full name;
- the group's tab count, `tabular-nums`, `text-ink-dim` — the strip and the pinned
  list both state the run's size here;
  *it is NOT what lets `Close all tabs in this conversation` carry no number*: that
  was the shipped reasoning, and review round 1 (U3/Q3) measured it false in the host
  this feature adds. The chip is drawn only when the pool holds more than one
  conversation, and the pane opened from a sidebar mark is the single-conversation
  case — so beside `Close 5 other tabs` the most destructive item on the row carried
  no number and nothing on screen stated the group's size. The item is counted now:
  `Close all 6 tabs in this conversation`.
- a 1px `bg-hairline` divider after it, `my-2 self-stretch`, the same rule the
  per-tab divider uses (`:487-492`);
- **inside the scroller**, so the tiers keep reading the strip row's width and the
  label scrolls with the run it names.

The name is resolved by **one** rule, extracted from the existing one:
`sessionDisplayName(sessionId, sessions)` — `title?.trim() || session_id` — which
`requesterLabel` (`browser-consent-request.tsx:103-127`) already implements and
which the hand-over dialog and the guard rails use. Extract it; do not write a
second.

**The active tab's group is revealed by the existing mechanism.** The strip already
scrolls the active tab into view (`browser-tab-strip.tsx:211-217`); the group chip
immediately precedes its group's first tab, so it comes into view with it. No new
reveal logic, and therefore no new oscillation risk.

**Collapse past N: not in this change.** It is the obvious next lever and I am
declining it deliberately, for three reasons: (i) a collapsed group is a second
hiding mechanism beside the pinned control's `+N`, with different semantics;
(ii) the pane's conversation scope *is* the collapse ("show me only this
conversation") so the pooled view is the one place all tabs must stay reachable;
(iii) it needs per-group state that survives a remount, and the existing `+N`
measurement counts DOM boxes — collapsed tabs would need to be added to it
explicitly, which is exactly the kind of interaction with the reviewed
measurement that produced the historic oscillation. Open question 3 names the
trigger for revisiting it.

**What 20 tabs across 6 conversations at 1160px actually does.** The numbers, from
the file's own arithmetic (`floor − 16 − 16 − chips − 6×(chips+1)`), with the chip
cap from R4:

| Element | Width | Count | Total |
|---|---|---|---|
| zero-chip inactive tab, base tier | 176 (`min-w-44`) | 20 | 3,520 |
| group chip (icon 14 + gap 6 + name ≤96 + gap 6 + count ≈20 + rule 1 + gaps) | ≈150 | 6 | ≈900 |
| scroller available | 1160 − 16 (row padding) − 28 (pin) − 28 (new tab) − gaps | 1 | ≈1,050 |

So the pool needs ≈4,400px of a ≈1,050px scroller: the strip **scrolls**, four to
five tabs are on screen at once, and the pinned control reads `+15` or `+16`. That
is the honest answer at that scale, and it is why the pinned control's own
occlusion problem (§1.3) is not a side quest — it is the answer to "the user can
always reach any tab" and it has to work. R4 makes the pinned list an in-band,
sectioned list, so at this scale the user can read and reach every tab, grouped by
conversation, without scrolling the strip at all.

### R4 — The squish, and the three things that fix it

**Fix 1: bound the chips, not the floor.** The frame the code itself documents
(`:384-398`, the committed `worst-case` story reading `Check...` at a 72px title)
proves the floors cannot be paid at five chips. Paying them would hand one
pathological row 465px of scroll order ahead of every ordinary tab; dropping a chip
hides a state the design round approved. Third option: **show at most three state
chips inline, and collapse the rest into one `+n` chip**. Priority order, most
load-bearing first:

| Order | Chip | Why |
|---|---|---|
| 1 | `Request n` | an ask; the number ties to the tray's chip and the dock's row (§5.2) |
| 2 | `Agent` | the only thing that distinguishes an agent tab from the user's; QA asserts on it |
| 3 | `Failed` | a background tab's blank page has no other signal |
| 4 | `Shared` | implied by `Agent` today (`registry.ts:369-372`) — real information, lowest value |
| 5 | `Restored` | useful once (why am I signed out); recoverable from the tooltip |

Worst case becomes `Request n` + `Agent` + `Failed` + `+2` ≈ 189px of chips against
today's 244px. At the existing 384px floor that is **139px of title** for the
inactive worst case (today: 72px), and **109px** for the active worst case at the
existing `min-w-[26rem]` (416px). Both clear the 85px this file promises, so the
ladder simplifies: the `chips >= 4` and `chips === 5` rungs disappear, and one
step past the spacing scale survives instead of two. The invariant to test is
`title = floor − 32 − chips − 6×(chips+1) − (active ? 68 : 0) ≥ 85` at every
reachable chip count, which is a pure function and belongs in
`browser-chrome.test.mjs`, not in a frame. The exact class strings are the
implementer's to settle from frames; the invariant is the requirement.

**The NARROW TIER pays the same floors, and its rungs were raised for it (review round
2, D1, ruled as option 1 of the two the finding priced).** Below `@max-2xl` — the
pane's own width — the active row's cluster is `absolute`, so it costs no width and the
promise there is `floor − 32 − chips − 6×(chips+1) ≥ 85` with no 68px term. Round 1's
frames showed that promise broken at the pane: a 640px pane rendered a four-chip row's
title as the single glyph `C`, because the narrow rungs were 120/132/200/224/248 against
a chip cluster of up to 189px. The narrow rungs are now **inactive 124/192/240/296/336
and active 192/260/308/364/404** for 0-4 chips, which leaves 86/86/85/87/85 and
154/154/153/155/153px of title, and the test asserts that floor **at every reachable
count in every tier** rather than comparing the narrow tier to its own past. What it
costs, knowingly: at a 640px pane the common CHIP-LESS active row goes 120 → 192px and
the worst four-chip row 248 → 404px, so fewer tabs fit whole. That is the trade the
pinned control exists to absorb — the tabs that no longer fit are reachable through it,
and the pane's own scope switch is the narrowing tool — and it is the price of the
operator's requirement that no title is ever reduced below a readable floor.

The collapsed chip is honest about what it hides: visible `+2`, `title` listing
them, and an `sr-only` span inside the button carrying the words (`, 2 more:
Restored, Shared`) so assistive tech reads the state rather than a number. The
full state is also in the tab's native `title` and in the actions band, which names
the tab.

**And the row-level chip is not the only `+` in the strip (review round 2, U5,
ruled).** The pinned control's count was a bare `+N` sitting immediately left of the
new-tab control's `+`, so at a glance "add N" and "open one" were one glyph apart.
The count now carries the chip grammar (`border-control`, `ink-dim`, tabular) with the
words `N more tabs` in its accessible name and its tooltip, the new-tab control is a
bounded icon button (`variant="outline"`, its own `New tab …` tooltip) rather than a
second bare plus, and the strip's own `hairline` rule is drawn between them while the
count is on screen. `N not shown` remains the pinned LIST's heading, where the
sentence is about the rows below it.

**Fix 2: the pinned control becomes an in-band list, sectioned by conversation.**
Per §6's rule and `browser-view-policy.ts:34-38`, a menu inside the band paints
into the content rect and loses to the native view. The row menu was fixed this way;
the `+N` control was not, and it is the token that "the user can always reach any
tab" is spent on. It becomes a band row under the strip (the same shape and the same
dismissal contract as the actions row, `browser-tab-strip.tsx:851-956`): one
section per conversation with the group's name as its heading, every tab as a row
with the active one ticked, bounded by `max-h-36 overflow-y-auto` so 20 tabs do not
push the page away, Escape and a dismiss control, focus moved into the band on open
and returned to the trigger on close. The band is outside the native view's rect,
so nothing is occluded and nothing is suppressed; the page narrows by the band's
height, which is the same trade the actions row already makes and the reason the
dock narrows rather than hides.

**Fix 3: the group chips cost less than the space they save.** `max-w-24`,
`shrink-0`, no fill, one hairline rule — see R3. They are inside the scroller, so
they can never make the tier container change width, which is the documented cause
of the historic oscillation.

**What must not change.** The container stays on the strip's *row*
(`:314-328`); `tabsOffScreen` keeps measuring `[data-tab-id]` boxes so group chips
are not counted as tabs (`:249-258`); activation still scrolls the active tab into
view; `min-w-44` remains the base-tier floor for a bare tab. Twelve themes:
everything above uses existing roles (`ink-dim`, `ink-muted`, `hairline`,
`control`, `accent`, `elevated`), and **no new palette role is required**. The
`+n` chip reuses the `Restored`/`Shared` triple; confirm with `pnpm check-themes`
whether that triple is already a `CONTROLS` row in `scripts/contrast-contract.mjs`
and add one only if it is not.

### R5 — The per-tab utility menu

The band gains four items, in this order, all in the in-band expansion that
already exists:

| Item | Label | Shown when | Resolves to |
|---|---|---|---|
| — | `Watch "X"` (existing, non-active tabs) | existing | activate |
| — | `Let an agent use "X"…` / `Stop letting the agent use "X"` (existing) | existing | hand-over / revoke |
| 1 | `Close "X"` (existing) | always | `ids: [X]` |
| 2 | `Close N other tabs` | `N ≥ 1` | `ids: all pooled tabs except X` |
| 3 | `Close N tabs to the right` | `N ≥ 1` | `ids: the tabs after X in the order shown here` |
| 4 | `Close all tabs in this conversation` | X is attributed and that conversation has ≥ 2 tabs | `conversation: X.sessionId` |
| 5 | `Copy URL` | `X.url` is http(s) | `navigator.clipboard.writeText(X.url)` |

**Why the counts are in the labels.** Each of these is destructive, has no undo
(closing a tab is not recoverable — the session file records the current set, not a
history: `host.ts:716-746`), and three of them ("others", and the conversation
item's own count) read the **pool** while a scoped host is showing a list — a number
is the disclosure. This is also
why `Close other tabs` means **the whole pool**, not the host's visible list: in
the pane, scoped to 2 tabs of 8, the item reads `Close 7 other tabs`, which is the
truth about what it does. `paneApprovalHeaderLabel`'s sibling rule applies here
too — the words have to agree with the scope.

**RULED THE OTHER WAY IN ROUND 2 (U7), and this paragraph is the correction.** Round 1
(A3) read the sentence above as a requirement and the branch threaded a second, WIDER
list into the strip — a `poolTabs` prop the pane filled with every tab it had — so the
item could count tabs the host was not showing. The operator's round-2 ruling settled
it the other way: **the count is the scoped list the strip passes**, because a scoped
host's band must not close tabs the user cannot see. In the pane scoped to two tabs of
a pool of eight the item reads `Close 1 other tab`, and those six tabs survive. The
label is truthful either way — it counts exactly what the press closes — so this is a
scope decision rather than a correctness one, and the scope rule is the one
`paneApprovalHeaderLabel`'s sibling sentence states: the words have to agree with the
scope. The `poolTabs` prop is gone from the component, so there is one list and no
pair that can drift; `Close N tabs to the right` reads the order on screen for the
same reason.

**Every bulk label carries a count** (review round 1, U3): the four items read
`Close "X"`, `Close N other tabs`, `Close N tabs to the right` and
`Close all N tabs in this conversation`.

**The band is a COLUMN, one item per row at every width (review round 2, D7, ruled).**
It used to be a wrapping flex row, so `Copy URL` orphaned onto a second line once the
four counted closes were present at the 1280px fixture — a failure class a wrap at one
fixture width hides and a wider band only postpones. The order is the item table's:
the closes, then a hairline, then `Copy URL` last (the only item that closes nothing).
Bounded with internal scroll, and the bound is a guard rather than a fold: eight rows
at 28px plus the rule is 233px against `max-h-60`'s 240px, so nothing D7 is about sits
below a scroll. Its heading row and dismiss control live outside the scroller, the
same shape the pinned list uses, and the focus contract is unchanged (`focus` in on
open, Escape and the dismiss control back to the trigger, dismiss last in DOM order).

**Why the closes are one intent, not N `closeTab` calls.** From the code (§1.4):
`closeTab` is one tab per intent, and each `destroy` fires `onChanged` per tab,
which broadcasts state and writes `session.json` (`index.ts:294-302`). Three
further reasons, in order of weight:

1. **"All in this conversation" cannot be expressed as a list without racing.** A
   list computed from a projection the renderer read up to seconds ago (the band
   stays open while the user reads it) misses a tab an agent opened in that
   conversation in the meantime, and the user pressed something that said *all*.
2. **N round trips is N full `chromeState()` builds and N renderer re-reads**, each
   of which re-renders the strip. A batch is one.
3. **`registry.destroy` is synchronous and the chrome's closes do not take the
   per-tab lane** (`registry.lane` is the dispatcher's, `host.ts:68-79`,
   `registry.ts:443-457`; `host.closeTab` calls `registry.destroy` directly,
   `:658-664`). So there is no interleaving to reason about *within* one intent,
   and N separate intents are N separate windows in which an agent can create a
   tab. One intent, one window, one decision.

```ts
export type CloseTabsIntent =
    | { mode: "ids"; tabIds: number[] }          // positional/pooled items; resolved against the live registry
    | { mode: "conversation"; sessionId: string }; // the group item; resolved at execution time
```

Main closes exactly the ids it is given and **skips ids that are already gone**
(the user's intent is that they be closed; they are), closes every tab whose
`sessionId` matches for the group mode, and beyond that the resolution is
presentation-free. `Close tabs to the right` is an `ids` intent computed from the
**rendered** order, which is the only order in which the words are true for a
grouped strip; a tab an agent creates after the press is not in the list and
survives, which the strip shows honestly.

**Registry change, small and named.** Add
`destroyMany(tabIds: number[]): number` to `TabRegistry`: drop each record without
notifying, then one `applyLayout()` and one `onChanged()`, then `onRemove` per
record so the webContents/debugger/log release path stays the single one
(`:543-547`). Extract the body of `forget` into a private `drop(tabId)` for it.
Also: **`Close tabs to the right` may close an agent-owned tab**, which is correct
— design 11.8 says every tab in the strip is the user's — and the agent's next
action on it gets the ordinary `tab_closed`, whose documented recovery is `open`
(`:310-336`).

**Focus after a batch close.** The band's anchor tab is usually gone, so
`menuRefs` has no target and focus would fall to `<body>` — the UX-round-2 U9
class of defect (`browser-tab-strip.tsx:175-186`). After a batch close: clear
`actionsTabId` and move focus to the new active tab's element if it is in the
strip, else to the scroller (`tabIndex={-1}` on it for this). Named because it is
easy to miss and the existing dismissal path assumes its trigger still exists.

### R6 — Centralization: one module, and the shared read

Two new modules, no behavioural duplication, and the existing hosts change only
their wiring.

**A. `src/renderer/src/features/browser/model/tab-index-model.ts` (new).** Owns
scope resolution, the by-session index, the pooled order, the per-conversation
summary and the close intents. Pure functions over structural inputs, following
`approval-queue-model.ts`'s convention of declaring its own input types
(`:35`, `:45`) rather than importing the hook's — so the whole thing is unit-
testable without a window, which is what `browser-chrome.test.mjs` does.

```ts
// moved here from approval-queue-model.ts (:94, :128, :137, :382); importers updated, no shim
export type SurfaceScope = "all" | { sessionId: string };
export function scopeKey(scope: SurfaceScope): string;
export function scopeFromKey(key: string): SurfaceScope;
export function tabsInScope<T extends TabInput>(tabs: readonly T[], scope: SurfaceScope): T[];

export interface ConversationTabGroup { sessionId: string | null; tabs: BrowserTabInput[] }
export function groupTabsBySession(tabs: readonly TabInput[]): ConversationTabGroup[];
export function pooledTabs(tabs: readonly TabInput[]): TabInput[];
export function tabsBySession(tabs: readonly TabInput[]): Map<string, TabInput[]>;

export interface ConversationBrowserSummary {
    tabCount: number; loadingCount: number; failedCount: number; pendingApprovals: number;
}
/** Entry-wise identity reuse: an unchanged conversation keeps the same object, so a
 * row that has not changed does not re-render when the projection ticks. */
export function summariseConversations(
    tabs: readonly ApprovalTabInput[],
    requests: readonly ApprovalRequestInput[],
    previous?: ReadonlyMap<string, ConversationBrowserSummary>,
): Map<string, ConversationBrowserSummary>;

export type CloseTabsIntent =
    | { mode: "ids"; tabIds: number[] }
    | { mode: "conversation"; sessionId: string };
export function closeOthersIntent(allTabs: readonly TabInput[], keepTabId: number): CloseTabsIntent | null;
export function closeToTheRightIntent(orderedTabs: readonly TabInput[], anchorTabId: number): CloseTabsIntent | null;
export function closeConversationIntent(sessionId: string): CloseTabsIntent;

/** The one conversation-name rule (extracted from `requesterLabel`, browser-consent-request.tsx:118-127). */
export function sessionDisplayName(sessionId: string, sessions: ReadonlyArray<{ session_id: string; title?: string | null }>): string;
```

**B. `src/renderer/src/features/browser/model/browser-projection-store.ts`
(new).** One module-level subscription to `window.api.browser`'s
`onStateChanged` + `onConsentChanged`, one initial read, one snapshot, exposed to
React via `useSyncExternalStore`. `useBrowserProjection()` becomes a three-line
selector over it and keeps its exact return shape, so the surface, the header and
the drawer need no changes at all. This is the fix for §1.5: the sidebar's rows and
the header's badge and the pane all read one subscription and one snapshot.

What is **deleted or made private**:

- `useBrowserProjection`'s per-call `useState` pair, its `useEffect`, and its two
  `ipcRenderer.on` subscriptions (`use-browser-chrome.ts:238-274`) — replaced by
  the store.
- `tabsInScope` out of `approval-queue-model.ts` (moved, importers updated).
- The pinned control's `DropdownMenu*` usage in the strip (Fix 2) — the imports
  go with it, so the band keeps its no-dropdowns rule by construction.
- The `chips >= 4` / `chips === 5` floor rungs (Fix 1).
- Nothing else. `useBrowserChrome` keeps every intent it has and gains two:
  `newTab(sessionId?: string | null)` and `closeTabs(intent: CloseTabsIntent)`.

**One `browser-conversation-mark.tsx`** (new) consumes the summary; **one**
`BrowserTabStrip` consumes the groups; the pane and the route pass different
props and nothing else. That is the whole of "both hosts plus the sidebar consume
one module".

---

## 4. The attribution lifecycle, worked

`sessionId` is the only attribution field, and it is projected, never a capability
(`host.ts:523-548`). Every row below is what the storage library shows the pane in
**This conversation** scope and the route's group for that conversation.

| # | Event | `owner` | `sessionId` | `nonce` | In this conversation's scope? |
|---|---|---|---|---|---|
| 1 | **Agent `open`** in conversation A | `agent` | `A` (`actions/tabs.ts:150-154`) | minted | yes — the normal case, and the one the pane exists for |
| 2 | **User `New tab`** from A's pane (R1) | `user` | `A` | `null` | **yes** — new with R1; not drivable |
| 3 | **User `New tab`** on the route | `user` | `null` | `null` | no — `No conversation` group |
| 4 | **Hand over** tab #2 to A (`handOver`) | `agent` | `A` (`:370-373`) | re-minted | yes — and now drivable |
| 5 | **Hand over** tab #3 to A | `agent` | `A` | re-minted | **yes** — it joins A's group |
| 6 | **Revoke** the hand-over of #2 (`revokeHandOver`) | `user` | `A` (its `homeSessionId`; `:386`) | `null` | **no** — and this is the settled answer to open question 2 |
| 7 | **Restore** at launch (`restoreTabs`) | `user` | `null` (`:230-231`) | `null` | no — `No conversation`, by design 7.3 |
| 8 | **A session's tab closed by the user** | — | — | — | gone from every list; the agent's handle gets `tab_closed` |
| 9 | **Revoke the hand-over of #1** (an agent tab) | `user` | `A` (its `homeSessionId`) | `null` | no — it becomes the user's, still in the conversation it was opened in |

Row 6 was the one place the code produced a surprise: a tab the user opened in A's
pane (#2), handed to A, then revoked, left A's scope and landed in `No conversation`
— revoking a hand-over silently deleted the conversation the user opened the tab in
(review round 1, Q2). It is settled in the direction open question 2 recommended:
`TabRecord.homeSessionId` is set once at `create` (and is `null` for a restored tab,
which is nobody's) and restored by `revokeHandOver`, `sessionId` stays the scoping
field, and the wire is unchanged. Rows 3 and 9 therefore differ only by
`homeSessionId`: a tab opened on the route has no conversation to return to, while a
tab revoked out of a hand-over still has one.

---

## 5. File-level plan

**Main process**

| File | Change |
|---|---|
| `src/main/browser/registry.ts` | `destroyMany(tabIds)`; extract private `drop(tabId)` from `forget`; `TabRecord.homeSessionId`, set at `create` (`:231`), restored by `revokeHandOver` (`:386`) — open question 2, settled (b) and implemented |
| `src/main/browser/host.ts` | `newTab(sessionId?)` (`:650`); `closeTabs(intent)` — resolve, `registry.destroyMany`, ONE `onChanged()`, return `chromeState()`; `chromeState()` unchanged |
| `src/main/browser/ipc.ts` | `browser-new-tab` takes an optional `sessionId` (validated as a non-empty string or absent); new channel `browser-close-tabs` with a validator for the two intent modes; add `"browser-close-tabs"` to `BROWSER_IPC_CHANNELS` (`:47-65`) |
| `src/preload/index.ts` | `newTab(sessionId?)`, `closeTabs(intent)` (`:495`) |

**Renderer — the model**

| File | Change |
|---|---|
| `features/browser/model/tab-index-model.ts` | new (R6-A) |
| `features/browser/model/browser-projection-store.ts` | new (R6-B) |
| `features/browser/model/approval-queue-model.ts` | scope helpers move out; `requestsInScope` and the queue stay |
| `features/browser/hooks/use-browser-chrome.ts` | `useBrowserProjection` → store selector; `useBrowserChrome` gains `newTab(sessionId?)` + `closeTabs(intent)` |
| `features/browser/hooks/use-conversation-approvals.ts` | reads the stored projection + `summariseConversations`; signature unchanged |

**Renderer — the surfaces**

| File | Change |
|---|---|
| `features/browser/components/browser-surface.tsx` | new prop `hostSessionId`; pass it to every `chrome.newTab` (`:452`, `:515`, `:627`, `:647`); pass groups/sessions/intents to the strip; scope-empty copy (`:608-611`) |
| `features/browser/components/browser-tab-strip.tsx` | group chips; the chip cap + `+n`; the simplified ladders; the pinned control → in-band sectioned list; the four new band items and their focus handling |
| `features/browser/components/browser-page.tsx` | `hostSessionId={null}` |
| `features/browser/components/browser-pane.tsx` | `hostSessionId={sessionId}`; the new-tab label copy |
| `features/browser/components/browser-conversation-mark.tsx` | new (R2) |
| `features/browser/components/browser-consent-request.tsx` | `requesterLabel` uses `sessionDisplayName` (one rule, two callers) |

**Renderer — the chat**

| File | Change |
|---|---|
| `features/chat/components/chat-sidebar.tsx` | the session row's three-part restructure (`:467-582`); `onOpenConversationBrowser` prop; one subscription for the summaries map |
| `features/chat/components/chat-content.tsx` | `onOpenBrowser` accepts an optional session id (`:728`); select + set lens + open; pass `onOpenConversationBrowser` to the sidebar |
| `features/chat/components/chat-header.tsx` | unchanged (it keeps its own badge, now reading the shared store) |
| `shared/store/ui-preferences-store.ts` | unchanged — `isBrowserPaneOpen`, `browserPanelWidth`, `browserPaneScope` and `claimRightSlot` already exist (`:98-154`, `:360-369`) |

**Nothing else moves.** In particular, no change to `browser-view-policy.ts` (the
in-band list needs no suppression), no new store field, and no change to
`registry.snapshot()`'s order.

---

## 6. Test and evidence plan

### 6.1 `scripts/browser-host.test.mjs` (real registry + Electron IPC fixture)

1. a user tab created with a `sessionId` is projected with that id, `mayDrive` is
   **false**, and it lists with a redacted handle (the capability claim of R1);
2. `destroyMany` fires `onChanged` **once** and releases each webContents exactly
   once (count the `onRemove` calls — the leak class of review R5);
3. a `conversation` intent closes a tab created *between* the intent's construction
   and its execution; an `ids` intent does not (the race the design claims);
4. an `ids` intent naming an already-gone tab closes the rest and does not throw;
5. `browser-new-tab` with an empty or non-string session id is refused at the
   boundary (the IPC validator's contract);
6. revoke restores a tab's conversation attribution (open question 2, settled (b): `homeSessionId`).

### 6.2 `scripts/browser-chrome.test.mjs` (pure model, shipped TypeScript)

1. `groupTabsBySession`: order by first tab, unattributed group last, tabs within a
   group in creation order, and a single-group pool is returned unlabelled;
2. `summariseConversations`: counts per session, and **identity reuse** — an
   unchanged conversation's entry is `===` the previous one (this is the property
   that stops 40 rows re-rendering per browser event, so it is asserted);
3. the chip cap: which chips survive at each reachable combination (the file's own
   enumeration at `browser-tab-strip.tsx:350-361` is the input list);
4. the title-floor invariant at every reachable chip count and tier, including the
   active row's 68px cluster;
5. the close intents: `closeOthersIntent` excludes exactly the kept tab;
   `closeToTheRightIntent` returns `null` for the last tab in the order and the
   right set for a middle one in a **grouped** order;
6. the existing scope test at `:1897` still holds (an unattributed tab is out of a
   conversation scope) **and** a user tab created in that conversation is in it.

### 6.3 Storybook (the DOM half; `capture-evidence.mjs` + `check-evidence`)

`browser-tab-strip.stories.tsx` (fixtures already carry `sessionId`,
`:24-58`): `Grouped` (3 conversations + `No conversation`), `GroupedOverflow`
(20 tabs / 6 conversations at 1160px), `ChipsCollapsed` (the five-state row, the
successor of `worst-case`), `ActionsExpandedBatch` (the band with the four new
items), `OverflowList` (the in-band sectioned list, open). New
`browser-conversation-mark.stories.tsx`: no tabs, has tabs, loading, approvals
(1 and 3), all four simultaneously, focused, and a row-context specimen so the
mark is judged on the `surface` and `sunken` grounds. The sidebar's own story file
(`chat-sidebar-status-feed.stories.tsx`) gains a rows-with-marks story.

**Before/after pairs** for: the strip's grouped and 20-tab states, the collapsed
chips, the in-band list, and the sidebar row with and without the mark — captured
from a scratch worktree at the merge base with the same command, attached to the
PR, and labelled. **Motion**: the band opening (both the actions row and the new
list) is a reflow the user sees — consecutive frames and a settle time, as §10.2
requires. `docs/evidence/manifest.json` must be re-stamped in the evidence commit
(`git rev-parse HEAD:src`, `HEAD:scripts`), per `AGENTS.md`.

### 6.4 Live app

`scripts/browser-chrome-proof.mjs`: a step that opens the pinned control and
captures the band (**the frame §12.1 asked for** — the occlusion check, now on the
in-band list); a step that presses `New tab` in the pane's conversation scope and
asserts the new tab's `sessionId` in `chromeState()` (`:661`); a 20-tab / 6-
conversation scene that asserts the group-chip count, the pin's count, the title
boxes' widths (`data-tour-tag="browser-tab-title"`, the measurement already there),
and that the last tab is reachable from the in-band list; a batch-close step that
counts `browser-state-changed` events for one intent and asserts the resulting tab
set.

`scripts/renderer-driver.mjs`: a scene that presses a session row's corner mark and
asserts the pane opened with the scope switch on **This conversation** for that
conversation — a real click, because the claim is about the interaction.

### 6.5 The QA matrix (independent pass, PR branch)

Surfaces the diff touches plus their neighbours: (1) open conversation A, open its
pane, `New tab` → the tab is in A's pane, absent from B's pane, marked `Agent` in
neither, and A's agent cannot drive it (a `tabs` listing from A shows it redacted;
hand it over and the same listing shows it full); revoke → back to the user's;
(2) route: 20 tabs / 6 conversations → grouped order, the pin's count, the in-band
list reaching every tab, the title floors holding; (3) the batch closes: `others`,
`to the right` (assert the exact surviving set), `all in this conversation`, each
with one state event, plus the right-most tab showing no `to the right` item;
(4) the sidebar: counts and the approvals badge per conversation, a press opening
the right conversation's browser from a *different* conversation's route,
keyboard Tab reaching the mark while arrow traversal does **not**; (5) regressions:
the existing browser-chrome-proof patterns unchanged, the sidebar evidence
harnesses (they read `[data-chat-row]`), and the session-switch harnesses.
Isolation is the standing rule: scratch `HOME` + `LOCAL_OPERATOR_CONFIG_DIR` +
`--user-data-dir`, `--window-mode=headless`, every `CMUX_*`/`LOP_*` variable
unset.

---

## 7. Commit order

Each commit is self-contained and green on its own.

1. `refactor(browser): move scope resolution into a tab index model` — new
   `tab-index-model.ts` with the moved helpers plus `groupTabsBySession`,
   `pooledTabs`, `tabsBySession`, `summariseConversations`, the three intent
   builders and `sessionDisplayName`; importers updated; unit tests added. No
   behaviour change.
2. `perf(browser): read the browser projection from one shared store` — new
   `browser-projection-store.ts`; `useBrowserProjection` becomes a selector; a test
   that N consumers produce one `state()` read per event.
3. `feat(browser): attribute a tab to the conversation it was opened in` — R1:
   `newTab(sessionId)`, IPC arg, preload, `hostSessionId` on the surface, pane and
   route wiring, the new-tab labels, the scope-empty copy; host tests; one proof
   step.
4. `feat(browser): group the pooled strip by conversation` — R3, renderer-side
   only: `pooledTabs` in the strip, group chips, stories; the 20/6 proof scene.
5. `fix(browser): bound the tab chips so a title keeps its floor` — R4 fix 1: the
   cap, the `+n` chip, the simplified ladders, the invariant test, the `ChipsCollapsed`
   story, `contrast-contract.mjs` only if the chip's triple is uncovered.
6. `fix(browser): list every tab in the band instead of a menu the page occludes` —
   R4 fix 2: the pinned control's in-band sectioned list, focus contract, the
   occlusion frame.
7. `feat(browser): add bulk close intents` — R5: `registry.destroyMany`,
   `host.closeTabs`, the IPC channel and validator, preload, the band items, the
   post-close focus path; host tests, model tests, the batch proof step.
8. `feat(chat): open a conversation's browser from its sidebar row` — R2: the row
   restructure, the mark, `chat-content` wiring, stories, the renderer-driver
   scene, before/after frames, the manifest re-stamp.

Commits 4–8 each move `src/`, so the evidence stamp is re-derived once, in the
evidence commit that follows the visual work — not per commit (`AGENTS.md`: a
commit that moves `src/` costs every open branch two commits).

---

## 8. Risks to watch during rollout

1. **The sidebar row is the app's most evidence-covered surface.** Two session-
   switch harnesses and one selection harness select on
   `[data-chat-row][title^=…]`, `[data-chat-row][aria-current="page"]` and the
   `cn`-resolved ground. Mitigation is the one-element rule in R2 and running all
   three before the PR.
2. **A per-consumer projection is the default the code invites**, and it is the
   wrong default at sidebar scale (40 rows × 2 subscriptions × a full projection
   per event). Commit 2 lands before anything consumes it, and the test that pins
   it is a read count, not a frame.
3. **Grouping changes the strip's rendered order.** A host test asserting
   `state.tabs[0]` is unaffected (grouping is renderer-side), but any *renderer*
   assertion that indexes tabs by position in DOM order is not. Grep the proof and
   driver scripts for positional tab assertions before commit 4.
4. **R1 changes what the pane's scoped list contains** (a user-open tab now
   appears there), so the pane's stories' fixtures and any frame pinned to
   "conversation with no tabs" change legitimately.
5. **Chip collapse changes reviewed visuals.** The design round must re-approve the
   chips at the cap, with before/after frames; the invariant is a test, the look is
   a review.
6. **The batch closes are destructive with no undo.** The counts in the labels are
   the disclosure; if the design round judges a confirmation necessary, it is one
   dialog and a real cost in the band's one-interaction shape.
7. **The in-band tab list grows the band and shrinks the page.** It must stay
   bounded (`max-h-36` + internal scroll) or 20 tabs push the page off screen —
   which is the failure the dock's design exists to avoid.
8. **Revoke and attribution** (open question 2): under the pre-implementation code a
   tab opened in a conversation and then revoked left that conversation's list. Settled
   (b) and implemented — `homeSessionId` restores it, and the host test pins both the
   restored case and the tab that has no conversation to return to.
9. **Twelve themes**: the mark's hover ground, the group chip's rule and the `+n`
   chip are the new triples; `pnpm check-themes` is the gate, and a failure after
   frames exist means recapturing.
10. **The occlusion question is load-bearing for R4**, not cosmetic: the pinned
    control is the reach-any-tab token. If the frame shows the dropdown was never
    occluded, commit 6 is unnecessary and should be dropped rather than done for
    symmetry.

---

## 9. Open questions

1. **Is the pinned `+N` control's dropdown actually occluded today?** Mechanism
   says yes (a downward Radix menu from the band into the content rect, unregistered
   by `browser-view-policy.ts:34-38`), and it has never been measured (§12.1).
   *Two answers:* (a) assume yes — ship the in-band sectioned list (commit 6);
   (b) capture the frame first and keep the dropdown if it paints inside the band.
   **Recommendation: (a), with the frame as the acceptance test for the replacement
   — the same fix was already accepted for the row menu, and the in-band list is
   also what makes 20 tabs reachable.**
2. **Does revoking a hand-over return a tab to the conversation it was opened in?**
   *Two answers:* (a) the behaviour that shipped — `sessionId = null`, so the tab moves
   to `No conversation` (reachable in two clicks from the pane, and it reads as the
   tab leaving its conversation); (b) add `TabRecord.homeSessionId`, set once at
   `create` and restored by `revokeHandOver`, so revoke is a true inverse.
   **SETTLED (b), and implemented** — one additive field, no wire change (the scoping
   field stays `sessionId`), and it removes a surprise. Review round 1's Q2 raised it
   as a `major` because the behaviour and this line disagreed; the code moved.
   `scripts/browser-host.test.mjs` pins both halves: a revoked tab returns to its
   conversation, and a tab opened with no conversation is still nobody's.
3. **Do groups collapse past N?** *Two answers:* (a) not now — the pane's
   conversation scope is the collapse and the pooled view stays complete;
   (b) make each group chip a disclosure that hides its run. **Recommendation:
   (a), and revisit if the design round's 20/6 frames show the labels crowding the
   tabs.**
4. **Is a batch close confirmed?** *Two answers:* (a) no dialog — the counts in the
   labels are the disclosure and a single close has no undo either;
   (b) a confirmation for counts above some threshold. **Recommendation: (a),
   because a threshold is arbitrary and a second interaction shape in the band is a
   real cost; if the design round disagrees it is one dialog.**
5. **Does the sidebar mark render outside Electron?** *Two answers:* (a) not
   rendered (the state is Storybook-only; the header's Globe already states the
   fact); (b) rendered but disabled. **Recommendation: (a).**
6. **What does the mark show for "has tabs"?** *Two answers:* (a) the tab count,
   quietly, beside the glyph; (b) just the glyph, with the count in the tooltip.
   **Recommendation: (a) — it is the operator's own question ("whether that
   conversation has tabs") and a count answers it without a hover.**
7. **Does the corner mark overwrite the pane's sticky scope lens?** *Two answers:*
   (a) yes — it sets `browserPaneScope = "conversation"` so what opens is what the
   label promised; (b) no — it opens the pane with whatever lens was last used.
   **Recommendation: (a).**
8. **Does the unattributed group come first or last?** *Two answers:* (a) last
   (recommendation) — conversations are the organising idea and the tail is the
   miscellaneous set; (b) first, because those are the user's own tabs.
   **Recommendation: (a).**
9. **Chip priority when the cap bites.** I have ordered `Request n` > `Agent` >
   `Failed` > `Shared` > `Restored`; `Restored` yields first and `Shared` second
   (`Shared` is implied by `Agent` today). *The alternative* is to keep every chip
   and pay it with one more step past the spacing scale on the inactive row.
   **Recommendation: the cap, in that order — it is the change that makes the 85px
   promise hold for every reachable row.**
10. **Which side does the sidebar mark's reserved slot cost?** A reserved 28px on
   every row is the entity rows' precedent and stops the hover reflow, but it
   narrows every conversation title by 28px. *The alternative* is reveal-without-
   reservation, which reflows under the pointer. **Recommendation: reserve, and let
   the design round judge the title width in the before/after pair.**
