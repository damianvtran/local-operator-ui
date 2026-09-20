# Sidebar sections — a resizable, collapsible split between the entity lists and the chats list

Status: **design, implementation not included.** Written read-only at UI head
`db615bd46` (`feat/sidebar-sections`, off `origin/main`) in
`~/local-operator-ui/.worktrees/sidebar-sections`: no install, no build, no
capture, no Storybook, no dependencies touched. Every line citation below is
against that tree, read rather than recalled.

Read with: `docs/branding.md` (the design contract — § 5 space/radii/motion,
§ 6 focus, § 9 *Adding something new* and its `### Disclosure` subsection),
`AGENTS.md` (environment, the evidence and `check-evidence` sections, change
scope, release mechanics) and `docs/agent-driver.md` (the supported way to drive
the built app and what a frame from it can and cannot prove).

The operator's request, verbatim:

> In local-operator-ui can you improve the sidebar by making the divider between
> agents/teams and chats draggable with memory to different heights, and make it
> so that you can collapse either section to only see one. The collapse UX should
> be subtle so that it doesn't take up a whole line of space at all times, but
> consider with UX and design the best way to make either section collapsible and
> even to drag+drop and reorder with intuitive but subtle mouse UX to have the
> agents at the bottom and the chat at the top, etc. if desired
>
> Thoroughly test it and design/UX review, since I like the current layout and
> don't want to make it feel more cluttered but want to give users more options to
> control the sidebar and what's in there and whether or not they want to use
> teams/chats/either
>
> Make sure all those decisions are captured in memory so that reloading/restarting
> will restore any adjustments

The last sentence is an acceptance criterion, not a remark: it is the one claim
in this document that no unit test can carry, and § 7 says exactly how it is
proved.

---

## 0. The problem as I found it

The panel the operator means is **`ChatSidebar`**, one component
(`src/renderer/src/features/chat/components/chat-sidebar.tsx`, **2727 lines** —
the brief that reached me said 1317; that number is stale and the file's
comments are load-bearing, so the extra length is review decisions rather than
drift), mounted once:

* `chat-page.tsx:2163-2170` renders it into `ChatLayout`'s `sidebar` slot;
* `ChatLayout` (`shared/components/common/chat-layout.tsx:23-51`) sizes that slot
  from `chatSidebarWidth`, clamped 240..360 at the render boundary, and puts a
  vertical `ResizableDivider` on its right edge.

Inside the panel (`chat-sidebar.tsx:1989-2725`) the DOM is exactly this, in this
order, as a `flex-col` column:

| # | Element | Class as shipped | Lines |
|---|---|---|---|
| 1 | `<nav aria-label="Chats">` | `flex h-full min-h-0 flex-col bg-surface p-2 text-ink` | 1989-1993 |
| 2 | the fixed `Chats` heading row | `flex h-8 items-center px-1` | 1999-2001 |
| 3 | the search field | `relative my-2`, input `h-8 … border-control` | 2008-2041 |
| 4 | search notices + the `sr-only` live region | nav children, `pb-2` | 2055-2127 |
| 5 | **the entity region** — `<section>` Agents, `<section>` Teams | `min-h-0 flex-1 space-y-4 overflow-y-auto p-1 [overflow-anchor:none]` | 2146-2152, closes 2332 |
| 6 | pin failure line | nav child | 2391-2405 |
| 7 | **the list region** — All chats, New chat, Pinned chats, Active chats, Previous chats | `mt-2 max-h-[45%] shrink-0 space-y-4 overflow-y-auto border-t border-hairline pt-2 [overflow-anchor:none]` | 2406-2432, closes 2707 |
| 8 | catalogue error alert | nav child | 2709-2724 |

So the "divider between agents/teams and chats" is the **`border-t
border-hairline` on the list region** (line 2432), and the two things the
operator wants to control separately are what this file already calls the
**entity region** (the container `entityPanelRef` points at, 2146-2152) and the
**list panel** (the container `listPanelRef` points at, 2406-2432) — the names
this document uses from here on, because they are the code's own.

Three facts about that boundary decide most of what follows:

1. **The boundary sits in 17px of dead space that nothing can click.** Between
   the entity region's own `p-1` (4px, inside its clip box and therefore paintable
   by a scrolled row's tail), the list region's `mt-2` (8px), the 1px rule and the
   list region's `pt-2` (8px) there are 21px between the last content line and the
   first — and the 17px of that below the entity region's clip edge belongs to
   nobody. That is where a drag handle can live without stealing a click from
   anything.
2. **The list region is anchored to the bottom of the column** (it is a
   `shrink-0` sibling *after* the `flex-1` entity region), so the boundary's
   position is a function of the list region's height, not of the entity
   region's.
3. **The list region's `max-h-[45%]` is a cap, not a look.** For any user with
   more than about four chats the region is already at the cap and scrolling, so
   a stored pixel height between the floors (below) reproduces the common case
   closely and the sparse case not at all — which is why the default has to stay
   the *auto* rule and not a number (§ 2, S3).

The operator also likes the current layout. The measure of success for this
change is therefore: **what is on screen at rest, when nothing is hovered and
nothing is collapsed, is nothing new.** § 2 S12 and § 9 A1 make that checkable
rather than rhetorical.

### What this is not

* It is not a collapse of the **nav rail**. `isSidebarCollapsed` /
  `toggleSidebar` (`ui-preferences-store.ts:229,485-495`) and the rail's own
  collapse control (`sidebar-navigation.tsx:369-393`) are a different panel, one
  slot to the left, and they already work.
* It is not a change to *what* each region lists — no new grouping, no change to
  the catalogue, the pins, the search, or the read receipts.

---

## 1. Ground truth that shapes the design

Read, not recalled. Each of these is a constraint the rest of the document is
derived from, and two of them contradict something a reviewer would otherwise
assume.

1. **`ResizableDivider` is already a complete, keyboard-reachable separator.**
   `resizable-divider.tsx`: `role="separator"` (238), `aria-orientation="vertical"`
   (240), `tabIndex={0}` (244), `aria-valuenow/min/max` (241-243), a 12px hit band
   (`h-full w-3 cursor-col-resize`, 246), a 2px state line invisible at rest that
   steps to `bg-control` on hover and `bg-accent` while dragging (213-233), a
   200ms hover-intent delay (44), arrow keys at 16px / Shift 64 (36-37, 143-170),
   Home/End to the bounds, Enter to restore the default, a full-viewport
   `col-resize` cursor overlay for the duration of a drag (51-62, 172-211), and a
   `label` prop that is deliberately **required** (146-155) because two panes once
   shared one name.
2. **Its own header docstring is stale and contradicts its own code.**
   `resizable-divider.tsx:9-11` says "The handle has no keyboard affordance and
   never had one: it is `tabIndex={-1}` and out of the tab order", while line 244
   is `tabIndex={0}` and 25-34 is a `## Keyboard` section describing the key map
   that exists. The second is true. This is flagged rather than fixed silently:
   the change described here edits that file, and a file that argues with itself
   is where the next reader believes the wrong half.
3. **The container-capacity precedent already exists, one slot over.**
   `chat-content.tsx:694-762` measures the run panel's available width with a
   `ResizeObserver` (`useLayoutEffect`, sub-pixel changes ignored so the pane
   cannot re-render against its own measurement), derives a **capacity**, and
   then defines the divider's contract in one place: `runPanelResizable = capacity
   >= floor`; when it is false the range **collapses onto the drawn value and a
   write is refused** so the user's stored preference survives intact for a window
   that can honour it; the reset goes through the same clamped write as a drag
   (763-775). The split below copies that contract rather than inventing one.
4. **A stored disclosure map already exists, in a *different* place.**
   `chat-sidebar.tsx:559-567` reads `localStorage["chat-sidebar-disclosures"]` in
   a lazy initialiser; `943-945` writes the whole map back on every change. It is
   not in the preferences store, it has no validation, and its keys are the five
   per-group disclosures (`agents`, `teams`, `pinned`, `active`, `previous`).
5. **The store is the established home for panel geometry, and adding to it is
   additive by construction.** `ui-preferences-store.ts` holds
   `chatSidebarWidth` (269, clamped in the setter at 580-584 and again at the
   render boundary in `chat-layout.tsx:28-31`), `canvasWidth`, `runPanelWidth`,
   `browserPanelWidth`, their `restoreDefault*` setters, and a `partialize`
   (626-629) that excludes exactly one field (`runPanelReveal`). There is no
   `version` and no `migrate`; with `zustand ^5.0.3` (`package.json:206`) a stored
   blob that lacks a new key rehydrates to the initial state's value for it. That
   is the whole of the migration story for adding fields, and § 5 says why that is
   enough here.
6. **A decision belongs in a pure module with a `scripts/*.test.mjs` beside it.**
   `sidebar-catalogue-gate.ts` and `scripts/sidebar-catalogue-gate.test.mjs` are
   the worked example, and the gate module states the reason in its own docstring
   (1-12): a JSX condition is a decision no test can reach, because
   `pnpm test:desktop` bundles the shipped TypeScript in memory rather than
   rendering the component.
7. **The repo already generalises a collapse affordance, and it argues the
   operator's constraint for us.** `sidebar-navigation.tsx:353-393`: the rail's
   collapse toggle is revealed on `group-hover` / `group-focus-within` with
   `pointer-events-none opacity-0` at rest, and the comment records why — it used
   to have "a full-width row of its own at the foot of the rail … about 40px of
   permanent chrome and one border, to hold a control that is used a few times a
   week". `pointer-events-none` "gates the mouse only. Focus is unaffected by it,
   so the button keeps its place in the tab order and reveals itself with
   `group-focus-within`". That is the shape S4 copies.
8. **Search already overrides a user's disclosure state, and writes nothing.**
   `chat-sidebar.tsx:1878`: `aria-expanded={query ? true : isOpen(key, initial)}`
   while `onClick` (1879) still writes the persisted map. S7 extends exactly this
   rule to the regions instead of inventing a second one.
9. **The nav's own class string is pinned by the theme gate.**
   `scripts/contrast-contract.mjs`'s source-boundary table carries
   `file: chat-sidebar.tsx, must: "flex-col bg-surface p-2 text-ink"`. Any edit to
   the nav's class list must keep that substring byte-for-byte. Nothing pins the
   list region's class string, so changing `max-h-[45%]` is free from that gate
   (which is a statement about the gate, not about the design).
10. **The sidebar's catalogue-gated content renders in Storybook, without a
    backend.** `chat-sidebar-agents.stories.tsx:110-217` stubs
    `window.api.desktop.request` and answers `capabilities` with
    `session_catalogue: 2`, `profile_catalogue: 1`, `team_catalogue: 1` — so
    `ready` is true, `showList` is true, and both regions mount; the `Page`
    wrapper fixes the panel at a chosen width (`chat-sidebar-status-feed.stories.tsx:
    638-666` takes `sidebarWidth`, defaulting to 360, and says why the width is a
    parameter). `docs/agent-driver.md:389-395` says the opposite for the *driver*:
    a backend-gated screen does not reach a reviewed state without `--backend`.
    Those two facts together are the whole of § 7's split of labour.
11. **`:hover` is reachable headless; focus-dependent rendering is not.**
    `renderer-driver.mjs:1920-1937` moves the pointer with
    `Input.dispatchMouseEvent` precisely because "the claim … is `:hover`/
    `group-hover` — a CSS state only the browser can enter", and its own comment
    says a synthetic event would answer the wrong question.
    `docs/agent-driver.md:383-388` states the other half: a `headless` window is
    never shown and cannot be focused, so `:focus`/`:focus-visible` rings do not
    render as they do for a user, `Emulation.setFocusEmulationEnabled` moves the
    page's focus and not the window's, and a run that forces focus must say so.
12. **There is one machine-wide evidence lease, and a `src/` or `scripts/` commit
    re-stamps every open branch.** `AGENTS.md:108-145`: `pnpm check-evidence`
    admits one sweep per machine and defers with exit 75; `docs/evidence/manifest.json`
    pins `srcTree`/`scriptsTree`, so any commit that moves `src/` or `scripts/`
    costs every open branch two commits, and the stamp is re-derived from the
    **merged** tree.
13. **A new dependency is not available.** `scripts/check-runtime-deps.mjs` gates
    an allowlist and the operator treats dependency weight as a shared commons
    (it is also why this design uses no `dnd-kit` and no
    `react-resizable-panels`). Nothing below needs one: the divider exists, the
    store exists, `lucide-react` and `Button` exist, and the motion tokens
    (`duration-fast` 120ms, `duration-base` 180ms, `ease-out-quart`) are already
    in `styles/index.css:164-173`.
14. **The row rhythm the floors are derived from.** A section heading row is
    `h-7` = 28px (`chat-sidebar.tsx:1861`); a row is `h-8` = 32px (`rowStyle`, 75).
    Region floors use those two numbers and nothing else.

---

## 2. The decisions

Each is stated as what is being decided, what I recommend, the alternative I
rejected, and why. S1-S12 are the settled set; § 12 lists the three items in here
that I think are somebody else's call rather than mine.

### S1 — The interaction model: a horizontal `ResizableDivider` on the existing rule, sizing the list region

**Recommend: generalise `ResizableDivider` with an `orientation` prop and use it
for the boundary; the thing it sizes is the *list region's* height, stored in
pixels; the entity region stays `flex-1 min-h-0` and absorbs the remainder.**

Why the list region and not the entity region: the boundary is the list region's
top edge (ground truth 2), so the number the user is dragging *is* the list
region's size, and the entity region's size is then whatever is left — which is
the arithmetic the browser already does for free, with no second stored number
and no way for the two to disagree. A stored *entity* height would render the
same layout but would need the list region's cap re-derived on every resize.

Why pixels and not a fraction: every persisted panel dimension in this app is
pixels (`chatSidebarWidth`, `canvasWidth`, `runPanelWidth`, `browserPanelWidth`),
and a fraction makes the user's split silently change when they resize the
window — which is the opposite of "memory". The px choice has a cost and § 2 S2
pays it explicitly.

Why generalise rather than add a second divider component: the alternative is a
new sibling with its own copy of the pointer-capture lifecycle, the window-level
`mousemove`/`mouseup`/`blur`/`mouseleave` teardown, the cursor overlay, the
keyboard map and the clamp — the same contract written twice, which is the class
of defect this repo names (`branding.md` § 9.1; the disclosure rule at
§ `### Disclosure`). The cost of generalising is contained and enumerable, and it
is confined to one file:

| Site | Today | Horizontal |
|---|---|---|
| cursor overlay (51-62) | `col-resize`, full viewport | `row-resize` |
| wrapper (220) | `h-full w-0` | `h-0 w-full` |
| state line (222-233) | `w-0.5 h-full`, `left-0`/`right-0` | `h-0.5 w-full`, `top-0`/`bottom-0` |
| hit band (245-249) | `h-full w-3`, `-left-1.5`/`-right-1.5` | `w-full h-2.5`, `-top-1.25`/`-bottom-1.25` |
| `aria-orientation` (240) | `vertical` | `horizontal` |
| drag axis (172-211) | `clientX`, `delta = clientX - startX` | `clientY` |
| grow sign (135-141) | `side === "right" ? +delta : -delta` | `side === "right" \|\| side === "bottom" ? +delta : -delta` |
| keys (143-170) | ArrowLeft/Right, Home→min, End→max | ArrowUp/Down (Up = the +y direction, so the *divider* moves up), Home = axis start, End = axis end |
| `side` union (140) | `"left" \| "right"` | `+ "top" \| "bottom"` |

The mapping is closed under one rule: **positive delta is movement in the +axis
direction, and "wider" is away from the sized panel's anchored edge.** For the
list region the divider is on the panel's *top* edge, so `side="top"`, ArrowUp
moves the divider up and the list region grows, Home puts the divider at the top
(max height), End at the bottom (min height). That is a pure function and § 8
pins it for all four sides.

The existing four call sites (`chat-layout.tsx:37-44`, `chat-content.tsx:1208-1216`,
`1287-1301`, `1385-1393`, plus two story specimens) pass no `orientation` and keep
the current behaviour byte-for-byte. Keeping the `sidebarWidth` prop name is
deliberate: it already means "the size of the panel this separator sizes" for a
canvas dock and a run panel, and renaming it would touch six call sites for no
behaviour. Its docstring becomes "the size along the separator's axis".

### S2 — Bounds, resize and very short windows

**Recommend: `SIDEBAR_MIN_REGION_PX = 72` for the list region, the same 72 as a
drag floor for the entity region, and a live `max = capacity - 72` measured from
the split container. Below `capacity < 144` the split is not *offered*: the
divider reports the drawn height, its range collapses onto it, and a write is
refused (the `runPanelResizable` shape, `chat-content.tsx:735-762`).**

72 is derived, not chosen: a heading row (28) plus a row (32) plus the region's
own rule and padding (8 + 1) is 69, and 72 is the next value on § 5's 4px ramp.
Both regions get the same floor, so neither can be dragged to a state where its
own header is unreachable.

The window is not watched by hand:

* **Growing the window** gives the extra pixels to the entity region, because it
  is the `flex-1` one. The user's chats height is unchanged, which is what a
  stored pixel value is for.
* **Shrinking the window** is bounded by a MEASURED cap rather than a CSS one:
  the list region carries `listMax`, resolved by `resolveSidebarSplit` from the
  capacity and the same 45% fraction the shipped `max-h-[45%]` used, and
  `minHeight: 0`, and the entity region keeps `min-h-0 flex-1`. The cap is a
  number the module computed because the number is also what the boundary
  ANNOUNCES, and a `calc` in a class is not a number any of this can read back
  (review round 1, NIT-1). The capacity is the split container MINUS the children
  that are not regions - the boundary's own band and the pin-failure line - so a
  floor of 72px is 72px for the region rather than 64px for the region and 8px for
  the rule above it (m-1, U3, D5's arithmetic, fixed after review round 1).
* **Below the point where both floors fit, the entity region yields first**, as
  it does today. ABOVE that point it does not: a stored height is honoured, so a
  short window can leave the entities at their floor while both floors fit
  comfortably, and today's auto rule cannot reach that state. The clamp is the
  right contract - the stored number survives for a window that can honour it -
  so the state is stated instead of removed: the separator's own accessible name
  becomes `Resize the chats list - showing 352 of 900 pixels in this window`
  whenever the drawn height differs from the stored one (review round 1, D5).
* **The stored number is never rewritten by a resize.** The render clamps; the
  prefence survives for a window that can honour it (the U6 rule,
  `chat-content.tsx:678-696`). `chat-layout.tsx:28-31` clamps `chatSidebarWidth`
  at the render boundary for the same reason and is the precedent.
* **When the split cannot be offered** (`capacity < 144`, i.e. a window whose
  content height is below about 240px once the panel's own `p-2`, the `h-8`
  heading row and the `my-2` search field are counted) the divider's `aria-valuemin` and `aria-valuemax` both equal the drawn
  height, `resizable` is false, and the store write is refused. A control that
  announces a range it cannot honour is the defect that rule exists for.

Rejected: making the value a fraction of the column (survives resize, but changes
the user's split under them, contradicts every other panel in the app, and makes
the drag a mapping through a rounding step); enforcing the floors in JavaScript
on window resize (a listener whose only job is to do what `calc()` already does,
and one more thing to get wrong on the first frame).

### S3 — The default is *auto*, not a number, and `null` means auto

**Recommend: `chatSidebarListHeight: number | null`, defaulting to `null`, and
`null` renders today's rule exactly — the intrinsic height, capped at
`max-h-[45%]`, with the entity region `flex-1`.**

An existing user who upgrades sees the panel they already had, to the pixel, and
the first three consequences are the ones that matter:

1. **Nothing on screen changes at rest for anyone who never touches the new
   controls**, which is the operator's own constraint stated as behaviour.
2. **No committed sidebar frame goes stale.** The four sidebar evidence surfaces
   (`chat-sidebar-agents`, `chat-sidebar-status-feed`, `chat-sidebar-current-row`,
   `chat-sidebar-selection`) photograph this DOM at 240-360px. A px default would
   move every row in all of them and turn a UI change into a re-capture of four
   surfaces; `auto` keeps them valid and makes the parity claim checkable by
   diffing one of them (§ 7).
3. **No migration write.** There is nothing to migrate from: absent means today.

The cost is one nullable field, one extra branch in the pure module, and a
measurement at drag start (S6). Rejected: a px default of "45% of a 900px
window" (369px) — it puts a mostly-empty 369px list region on a fresh install
with two chats, which is a visible change nobody asked for.

### S4 — The collapse affordance: two glyph buttons revealed on the boundary

**Recommend: a two-button cluster at the centre of the boundary, in the pointer's
own hit band, `opacity-0 pointer-events-none` at rest and revealed on
`group-hover` / `group-focus-within`, in the shape the rail's collapse toggle
already uses (`sidebar-navigation.tsx:369-393`). At rest it costs zero pixels and
zero lines.**

* `ChevronUp` → hide the entity region; tooltip and accessible name "Hide agents
  and teams".
* `ChevronDown` → hide the chats list; tooltip and accessible name "Hide the
  chats list".
* Both are `Button variant="ghost" size="icon-sm"` (28px, `[&_svg]:size-3.5`), so
  the 14px glyph is on the icon ramp and the ghost variant's own docstring
  applies (`button.tsx:66`: "`ghost` has neither fill nor edge at rest, so its ink
  carries the press").
* The cluster is absolutely positioned and 28px tall, so it overflows its 10px
  band without contributing layout — the mechanism the rail's toggle already uses
  to stay out of the flow. A press on one of its buttons must not also start a
  drag: one `stopPropagation` between them (§ 10, risk 4).
* Hover-intent: **keep the existing 200ms delay** (`resizable-divider.tsx:44`).
  The boundary is crossed constantly while scrolling between the two regions and
  the comment's own reasoning ("the gap … is crossed constantly on the way to the
  panel, and an instant accent line flashed on every pass") is even truer here.

Rejected, with the reason each one loses:

| Candidate | Why not |
|---|---|
| A control on each region's existing header row | There is no region-level header. In the entity region the headers are per-*section* ("Agents", "Teams", `heading()` at 1851), so the affordance would have to be duplicated or a new region header invented — a permanent line of chrome, which is the thing the operator forbade. In the list region the only candidate is the `All chats` row, which is itself a button (a nested control) and already carries a label and a count. |
| Double-click the boundary | The existing divider's double-click is already *restore the default* (S10), and one gesture with two meanings is how a user learns neither. |
| Drag the boundary to an extreme to collapse | It conflates two states: a 72px region is not a collapsed one, so "restore" becomes ambiguous, and an accidental collapse would arrive with no undo. It also makes the drag's end position meaningful rather than bounded, which is what the clamp exists to prevent. |
| A keyboard-only control (a chord) | Required as an *additional* path (§ 6), never as the only one: a feature reachable only by a chord nobody documented is not discoverable. |
| A split-button menu on the boundary | A menu is a shadowed, elevated surface (`branding.md` § 5) for two items that would each be a 28px button on the same band, and it costs a click to open plus a click to choose. |

### S5 — Bringing a region back: a slim restore row, shown only when collapsed

**Recommend: when a region is hidden, a `h-7` row appears where its edge was,
naming what is hidden and carrying the control that brings it back. It is the
only permanent-looking thing in the collapsed state, and it exists because
"nothing came back" is worse than 28px.**

This is the consequence of S4 that is easy to miss: the cluster lives on the
boundary, and with one region collapsed there is no boundary left, so **the
affordance that collapsed a region cannot be the only one that restores it**.
Concretely:

* entities hidden → the restore row sits directly under the search field, at the
  top of the column;
* chats hidden → it sits at the bottom of the column, under the entity region.

The row is a single `<button>` with `rowStyle`-adjacent geometry (`h-7`, `px-1`,
`text-ink-muted`, `hover:bg-row-hover`), a `ChevronUp`/`ChevronDown` at 14px on
the leading edge, the region's own name, and — for the chats list — the same
count the region's own `All chats` row carries (`countBadge(matching.length)`,
the same predicate the shipped row uses at 2448-2451, so the collapsed state
tells the truth about how many chats there are rather than hiding the panel's
main signal). No count for the entity region, which has none today.

**The `New chat` row lives in the list region**, so collapsing the chats list
hides the app's primary new-chat entry point (its own comment at 1994-1998
records that a *smaller* entry point was the reported defect once). The restore
row is one click away and `⌘N` still works, so the trade is acceptable — but it
is a real trade, it is stated here rather than discovered in review, and § 12
records the alternative I rejected (putting a `MessageSquarePlus` on the restore
row, which turns the restore row into two controls and the collapsed state into
chrome).

### S6 — Drag in the auto state measures first, then stores

**Recommend: at `pointerdown`, if there is no stored height, read the list
region's live height from its own element and use it as the drag's start value;
the first `mousemove` that changes it writes a pixel value for the first time.**

That is the same shape the existing divider uses (`const startWidth =
sidebarWidth` in its `mousedown`, 172-186) with a measurement instead of a store
read, and it is the whole of the "auto until touched" mechanism: no
`ResizeObserver` is needed to start a drag, because the element being measured is
the one under the pointer. A drag in a container where the split is not offered
(S2) is refused at the store write, so the user's preference is not destroyed by
a drag the layout could not honour.

### S7 — A query renders both regions, and writes nothing

**Recommend: `resolveSidebarSplit` takes `query: boolean` and returns both
regions visible whenever a query is active, leaving the persisted region state
untouched — the rule `heading()` already applies at 1878.**

This is not a nicety, it is the reason the search field can stay honest. Three
consequences, all of them the ones the file's own comments demand elsewhere:

1. With the entity region collapsed, `placeholder="Search chats and agents"`
   (2012) is only true because a query brings the agents back. Without the
   override, typing an agent's name into a field that promises to search agents
   and getting "Nothing in your chats matches …" would be precisely the class of
   claim the search notices at 2042-2047 exist to refuse ("a search that quietly
   stops looking inside conversations is indistinguishable from one that found
   nothing there").
2. The persisted collapse is **not** rewritten, so clearing the query restores
   exactly the state the user chose — the same contract as a per-group
   disclosure.
3. The collapse control stays operable during a query and its `aria-expanded`
   reports `true`, again exactly as a section disclosure does. A press during a
   query writes a state that becomes visible when the query clears; that is the
   shipped precedent, not a new one.

### S8 — "Both collapsed" is unreachable by construction: one union field, three states

**Recommend the persisted region state is a single field,
`chatSidebarRegions: "both" | "entities" | "chats"`, and hiding the last visible
region shows the other one instead.**

The alternative — two booleans — has a fourth state (neither visible) that means
"an empty column with a title, a search box and two restore rows", and a state
that can be persisted is a state somebody will reach. A three-value union makes
the impossible state unrepresentable, which is the argument the store already
makes for its right-slot panes (`ui-slot`/`claimRightSlot`,
`ui-preferences-store.ts:360-389`: "one slot, one pane, and the exclusion lives
in `claimRightSlot` so no call site has to remember it"). The operation the user
performs is read as *hide this one*; if the other is already hidden, hiding this
one means showing the other, which is a legible outcome rather than a dead
control.

Rejected: allowing both collapsed (a column with no content is not a layout the
operator asked for, and it is one more state to photograph, persist, migrate and
explain); disabling the control when the other region is hidden (a control that
refuses is worse than one that does the only sensible thing, and it needs its own
explanation on screen).

### S9 — Reorder SHIPS in this change, as the swap glyph this section specified

**Amended after review round 1 (design D2, agent review's addition to it, UX
U2/U5).** The paragraphs below were written when the recommendation was "not in
this change", and the manager put reorder IN scope on the operator's behalf, in
the shape this section itself described: a third `icon-sm` ghost glyph in the same
hover-revealed cluster, toggling a persisted `chatSidebarOrder:
"entities-first" | "chats-first"`. Everything this section said about the cost is
true and was paid rather than avoided - the frame set grew (two swapped-order
states at two widths, both brand palettes, and a driven swap frame), the state
field is a third one rather than the two S10 describes, and the at-rest ledger is
four tab stops rather than three. What it said about the LAYOUT is why the frames
were the price: the regions' `flex-1`/`shrink-0` roles invert, the boundary's
`side` flips to `"bottom"`, and the rule above the lower region moves from the
list to the entities; and driving it found a defect no still would have (U2: the
scrolled region lost its position, because the two regions reconciled
positionally - they are keyed now, and the scene checks node identity across the
swap).

The original recommendation, kept as the record of what was weighed:

**Recommend: not in this change.** The operator's phrasing makes it optional
("even to drag+drop and reorder … if desired"), and the honest reading is that it
is a second feature with its own gesture, its own persistence field and its own
evidence set.

Why not now, in the terms the decision actually turns on:

* The only two gestures that add no chrome are (a) dragging the boundary past its
  own bound and swapping the regions, and (b) dragging a region by its header.
  (a) conflicts with the drag this change is introducing and with its clamp; (b)
  conflicts with what the headers *are* — in the entity region the headers are
  disclosure triggers (`heading()`, 1851-1893) and in the list region the first
  row is the `All chats` button. Both regions' hands are full.
* A true drag-and-drop reorder also needs a keyboard equivalent and an
  announcement (`aria-grabbed`/live region). Nothing in this app reorders by
  drag today (the only `draggable` in the tree is `draggable={false}` on links,
  `markdown-renderer.tsx:130-179`), so the idiom would be invented here first,
  for two items.
* Blast radius: the regions' own roles invert (`flex-1` vs `shrink-0`), the
  sticky `Active chats` header's ground (`heading()`'s `sticky -top-2`, 1870) has
  to hold on whichever region is second, and every existing sidebar frame is
  invalidated. That is a change worth its own review round, not a rider on this
  one.

**The follow-up's shape, so the deferral is not a shrug:** a `chatSidebarOrder:
"entities-first" | "chats-first"` field in the same store, driven by a swap glyph
in the same hover-revealed cluster (a third icon-sm button, so it still costs
nothing at rest), with the header and the search field staying put and only the
two regions trading places. That achieves the operator's stated goal ("agents at
the bottom, chats at the top") with a click rather than a drag, which is *better*
than drag-and-drop for two items — and it is a separate PR because it is a
separate decision, with its own evidence set and its own UX round. § 12 flags
this one as the operator's call rather than mine.

### S10 — Persistence: two additive fields in the existing store, and the disclosures blob coexists

**Recommend: `chatSidebarRegions` and `chatSidebarListHeight` join
`ui-preferences-store`, alongside `chatSidebarWidth`, with setters
`setChatSidebarRegions`, `setChatSidebarListHeight`,
`restoreDefaultChatSidebarListHeight`. The `chat-sidebar-disclosures` blob is left
exactly as it is.**

* **The blob coexists rather than migrates or is absorbed.** Absorbing it means
  writing a migration for a `Record<string, boolean>` that today lives outside the
  store, writing the validation it has never had, and moving a working surface's
  persistence for tidiness — while this change's own new state can be added with
  *no* migration at all (ground truth 5). The two are also different kinds of
  thing: the blob is five per-group disclosure flags the component owns; the new
  fields are panel geometry the store owns. If a later change wants one sidebar
  state object, the migration is `localStorage["chat-sidebar-disclosures"]` →
  a store field with the same validation § 3 describes, and it should be done
  then, by whoever needs it.
* **Validation lives on read, not in the setter**, because `zustand`'s persist
  rehydrates past the setters: a tampered `localStorage` never calls
  `setChatSidebarListHeight`. So the pure module takes the persisted values as
  `unknown` and validates them (§ 3), which also makes the tamper cases testable
  without a browser.
* **Reset: a double-click on the boundary returns the split to auto** (the
  component's `onDoubleClick`, `resizable-divider.tsx:91`, applied to its band at
  266 — the same gesture that restores the sidebar width one panel over). That is enough for the split, and
  the collapse state needs no reset affordance of its own because its own control
  is its inverse and it is on screen whenever a region is hidden (S5). I would
  **not** add a "Reset sidebar layout" item anywhere: it would be the only reset
  in the app that resets two unrelated fields at once, and it would live in
  Settings, where a user who wants their sidebar back will not look.
* **`partialize` is not touched** (626-629): both new fields must persist, which
  is the default behaviour, and the one excluded field stays excluded.

### S11 — Accessibility

**Recommend the horizontal separator uses the axis-matched ARIA and key map, and
every new control gets a name, a focus step and no shadow.**

* `role="separator"`, `aria-orientation="horizontal"`, `aria-valuenow` = the drawn
  height rounded, `aria-valuemin`/`aria-valuemax` = the live bounds from S2
  (`aria-valuemin === aria-valuemax` when the split is not offered).
* `label` is required by the component and must name what it sizes:
  `"Resize the chats list"`. Two separators 0px apart with one name is the defect
  that required prop exists for (146-155).
* Keys: ArrowUp/ArrowDown by 16px, Shift by 64, Home to the top (max height), End
  to the bottom (min height), Enter to restore auto. `preventDefault` as today.
* **The divider must `stopPropagation()` on the keys it consumes.** The nav's own
  `keyDown` (1894-1945) walks `[data-chat-row]` in DOM order on ArrowDown/Up and
  jumps to the first/last row on Home/End, and it does not check
  `event.defaultPrevented`. Today no divider lives inside the nav, so the clash is
  latent; this change puts one there, and without `stopPropagation` every resize
  key would also move focus. Pinned in the QA matrix (§ 9 A7) because no unit test
  can reach a bubbling order.
* The collapse buttons are `Button`s with `aria-label`s, `aria-expanded`, and
  `aria-controls` naming the region they hide; they are in the tab order at all
  times (the rail's rule: `pointer-events-none` gates the mouse only) and reveal
  the cluster on focus via `group-focus-within`. Focus never lands on `body` when
  a region unmounts: the control that unmounts a region is on the boundary or on
  the restore row, both outside the region.
* Focus visibility comes from the existing idiom — the global `:focus-visible`
  outline (`branding.md` § 6, `rowStyle`'s `focus-visible:outline-accent`), never
  a `box-shadow`.
* Reduced motion needs nothing new: the only transitions are opacity and colour
  on the state line and the cluster (S4), and `styles/index.css` caps durations;
  no width or height is animated, which is the existing divider's own rule
  (222-226: "Opacity and colour only: animating width would animate layout").

### S12 — At rest, nothing new on screen

**Recommend the boundary keeps the shipped `border-t border-hairline` as its
resting appearance, keeps the 17px of dead space it already sits in, and adds
only nodes that paint nothing.** The band is 10px, centred on that rule: 5px
inside the list region's `mt-2` above and 5px inside its own `pt-2` below, which
leaves 3px clear of the entity region's box on either side. It is deliberately
narrower than the vertical divider's 12px, because the vertical band lives in a gap
that belongs to nobody while this one has a scroll container above it whose
*clipped row tails can paint into its own 4px padding strip* — the property the
sticky-heading comment records at 1863-1868 ("padding is not a clip"). At 10px no
row's last pixels become a drag handle. QA tests exactly this (§ 9 A4).

The at-rest ledger, stated so it can be falsified: zero pixels changed, zero lines
added, no new motion, and **four new tab stops** (the separator and the cluster's
three buttons, which are focusable while invisible by design). The ledger said
three until review round 1: it was written before S9's swap control shipped inside
this change, and its own falsification test caught the fourth (design D6, UX U5).
If a reviewer finds a fifth thing, it is a finding.

---

## 3. The pure module: `src/renderer/src/features/chat/sidebar-split.ts`

Sibling of `sidebar-catalogue-gate.ts` and `sidebar-focus-hold.ts`, with
`scripts/sidebar-split.test.mjs` beside it, for the reason those two state in
their own docstrings (ground truth 6). I would name it `sidebar-split` rather than
`sidebar-layout` so the file claims the split and nothing wider, and so the test
name matches the module name the way `sidebar-catalogue-gate` does.

```ts
export type SidebarRegions = "both" | "entities" | "chats";

export const SIDEBAR_MIN_REGION_PX = 72;   // heading 28 + row 32 + rule 1 + pad 8, rounded to the ramp
export const SIDEBAR_AUTO_MAX_FRACTION = 0.45;  // today's `max-h-[45%]`

export type SidebarSplitInput = {
  /** persisted, unvalidated: localStorage is not the setter's path out. */
  regions: unknown;
  listHeight: unknown;
  /** the catalogue gate's own output: with no catalogue there is no split. */
  showList: boolean;
  /** a query is active. Overrides the collapse (S7) and writes nothing. */
  query: boolean;
  /** the split container's measured height, px. */
  capacity: number;
};

export type SidebarSplit = {
  entityVisible: boolean;
  listVisible: boolean;
  /** null = today's rule. Never clamped here; the render clamps (S2). */
  listHeight: number | null;
  /** which region's restore row renders, if any (S5). */
  restore: "entities" | "chats" | null;
  /** null when there is no boundary: one region is hidden, or the catalogue is closed. */
  divider: null | { value: number; min: number; max: number; resizable: boolean };
};

export function resolveSidebarSplit(input: SidebarSplitInput): SidebarSplit;

/** +1 when the arrow's direction grows the sized panel. Shared with the divider. */
export function growSign(side: "left" | "right" | "top" | "bottom"): 1 | -1;

export function parseSidebarRegions(value: unknown): SidebarRegions;
export function parseSidebarListHeight(value: unknown): number | null;
```

The validation table, which is the half of this module that only exists because
`localStorage` is writable by hand:

| Input | Result | Why |
|---|---|---|
| `"both"` / `"entities"` / `"chats"` | itself | the three legal states |
| anything else (object, `"neither"`, `null`, `[]`, `7`) | `"both"` | the fallback is the state that shows everything |
| number, finite, `> 0` | itself | the ordinary case |
| `null` | `null` | auto |
| `"369px"`, `"369"`, `NaN`, `Infinity`, `-1`, `0`, `1e9`, `{}`, `[]` | `null` | a non-finite or nonsensical height is *no height*, never a coerced one; `1e9` is not clamped to a number the user did not choose, it is discarded (S2's render clamp is for legal values in a too-small window, not for garbage) |
| `showList === false` | `divider: null`, both regions "visible" | the withdrawn-gate/no-catalogue DOM must not gain a divider (ground truth 10) |
| `query === true` | both visible, `restore: null`, persisted state echoed unchanged | S7 |
| `regions === "entities"` | `listVisible: false`, `restore: "chats"`, `divider: null` | S5, S8 |
| `capacity < 2 * 72` | `divider.resizable = false`, `min === max === value` | S2 |

---

## 4. What changes where

Four source files, plus a test, a story file and evidence. No new dependency, no
new route, no change to the catalogue, the search, the pins or the receipts.

1. **`shared/components/common/resizable-divider.tsx`** — add
   `orientation?: "vertical" | "horizontal"` (default `"vertical"`), extend `side`
   with `"top" | "bottom"`, make the nine sites in S1's table axis-aware, and
   **rewrite the stale header docstring** (ground truth 2) so the file has one
   account of its own keyboard behaviour. Existing call sites unchanged.
2. **`features/chat/sidebar-split.ts`** (new) — § 3.
3. **`features/chat/components/chat-sidebar.tsx`** — inside the existing `nav`,
   below the search field: a split container with the entity region, the boundary
   (band + state line + cluster) and the list region; the restore row (S5); the
   `ResizeObserver` measuring the container's height (the `chat-content.tsx:707-734`
   shape, `useLayoutEffect`, sub-pixel changes ignored); the `onKeyDown` guard from
   S11; and a `data-tour-tag`-style stamp on the boundary for the driver
   (`data-sidebar-split`), which is how the existing scenes find their targets
   (`scripts/sidebar-resort-geometry.mjs:24-28` records why a finder that walks
   from a row rather than from an identity measured the wrong container once). The
   `nav`'s own class string keeps `flex-col bg-surface p-2 text-ink` verbatim
   (ground truth 9).
4. **`shared/store/ui-preferences-store.ts`** — two fields, three setters,
   documented with the why (S10).
5. **`scripts/sidebar-split.test.mjs`** (new) — § 8.
6. **`features/chat/components/chat-sidebar-sections.stories.tsx`** (new) and a
   `STORIES` entry set — § 7.

Nothing in `chat-layout.tsx` changes: the panel's width divider is a different
axis on a different box, and its clamp is already correct.

---

## 5. Persistence contract

Storage key: unchanged — the zustand persist blob under
`ui-preferences-storage` (`ui-preferences-store.ts:613`). No new key and no
second blob: the two fields ride the store that is already the established home
for panel geometry (ground truth 5).

```jsonc
{
  "state": {
    "chatSidebarWidth": 280,                 // unchanged
    "chatSidebarRegions": "both",            // NEW  "both" | "entities" | "chats"
    "chatSidebarListHeight": null            // NEW  px, or null = auto (S3)
  },
  "version": 0
}
```

* **Shape**: `chatSidebarRegions` is the union and never a boolean pair (S8);
  `listHeight` is a pixel number or `null`, and `null` is a first-class state, not
  a missing value.
* **Defaults**: `"both"` and `null` — today's panel.
* **Migration**: none required, by construction (ground truth 5). A user's
  existing `chat-sidebar-disclosures` blob is untouched and keeps working, and
  their `ui-preferences-storage` blob rehydrates with the new keys at their
  defaults, so an upgrade is visually a no-op. Nothing is written until the user
  drags or collapses something.
* **Validation**: on read, in the pure module (§ 3). The store's setters take
  typed arguments and are not the tamper path.
* **Reset**: double-click the boundary → `restoreDefaultChatSidebarListHeight()`
  → `null` → auto. The collapse states are reset by their own controls (S5/S10).
* **The acceptance criterion**: "reloading/restarting restores any adjustments" is
  satisfied by zustand's own rehydration plus S2's render clamp, and § 7 proves it
  on a real second boot rather than by reading the middleware.

---

## 6. Accessibility summary

Restated as the checklist a reviewer tests against, because it is spread across
S5, S7, S8 and S11:

| Requirement | How |
|---|---|
| The split is one widget with one name | `role="separator"`, `aria-orientation="horizontal"`, required `label="Resize the chats list"`, `aria-valuenow/min/max` live (S11) |
| It is reachable and operable without a pointer | `tabIndex={0}`, Arrow/Shift/Home/End/Enter (S11) |
| Resizing does not hijack the panel's arrow walk | `stopPropagation()` on consumed keys (S11) |
| Every new control has an accessible name | `aria-label` on both cluster buttons and the restore row, `aria-expanded`, `aria-controls` (S5, S11) |
| The cluster is discoverable without a pointer | `group-focus-within` reveal, in the tab order while invisible (S4) |
| A hidden region is never a silent absence | the restore row names it, and carries the chats count (S5) |
| A query never lies about its scope | both regions render under a query, and the persisted state is not rewritten (S7) |
| Focus is visible and never clipped | global `:focus-visible` outline, never a `box-shadow` (S11) |
| Reduced motion | opacity/colour only; nothing animates an axis (S11, S12) |

---

## 7. Evidence strategy

This is the part that decides whether the change can be reviewed at all, and it
turns on one fact from ground truth 10: **Storybook can render this panel's
catalogue-gated content with a stubbed bridge, and the driver cannot reach a
reviewed sidebar without `--backend`.** So the labour is split by what each
instrument can honestly answer.

### 7.1 Storybook — the resting states, all twelve themes, no backend

A new `chat-sidebar-sections.stories.tsx` reusing the agents story's bridge stub
(`chat-sidebar-agents.stories.tsx:110-180`) and the status feed's width-parameterised
`Page` (`chat-sidebar-status-feed.stories.tsx:638-666`), with a fixture that has
agents, teams, chats, one pinned chat and one unread completion, so both regions
have real content. Title `"Chat sidebar/Sections"` → story id prefix
`chat-sidebar-sections--…` → evidence directory `docs/evidence/chat-sidebar-sections/`,
matching the two existing sidebar surfaces.

Required states, each captured in `localOperatorDark` and `localOperatorLight` at
minimum (and in the full twelve for the ones the design round judges):

| Story | What it proves |
|---|---|
| `resting-default` | **the S12 claim**: with no stored value, this is today's panel. This frame is the one diffed against the baseline. |
| `dragged-split` | a stored px height renders where it says, and `aria-valuenow` matches the drawn height |
| `entities-only` | the entity region fills the column and the restore row names the chat list, with its count |
| `chats-only` | the mirror, with the entity region's restore row under the search field |
| `short-window` | at ~560px of column: the clamp holds, the entity region yields first, both floors visible |
| `narrow-240` | the panel at the width clamp, where the cluster and the restore row have least room |
| `query-while-collapsed` | S7: a query brings both regions back, and clearing it restores the collapse |

Honest limits, to be stated on the frames rather than implied: **a story that sets
the split through the store photographs the rendering of a resolved layout, not a
drag.** `:hover` is not reachable in a story (the reveal is a CSS `:hover` variant,
and Storybook's own `userEvent.hover` dispatches events rather than entering the
pseudo-class), so the revealed cluster is a driver frame, not a story frame.

Command shape (the panels convention, `docs/design/panel-views.md:1428-1441`):

```
pnpm check-types && pnpm lint && pnpm check-themes
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=chat-sidebar-sections --themes=localOperatorDark,localOperatorLight
```

`--only`/`--themes` switch the capture to append mode and record `partialCapture`
in the manifest; a narrowed set is legitimate for a remediation recapture and must
not be presented as a sweep. Each state's declared height in the `STORIES` table
must be sized to the band it actually draws — `check-evidence` fails a frame whose
dominant colour covers more than 98.5% of it (`scripts/check-evidence.mjs:93`), and
a `chats-only` state at 900px is exactly that.

### 7.2 The before/after pair, and what happens to the committed sidebar frames

The parity claim (S12) must be a **pair**, and the new story cannot supply its own
"before": it does not exist at the merge base. So the pair is taken on an
**existing** surface that renders this DOM at rest —
`chat-sidebar-status-feed--completion-in-place` is the right one, because it draws
both regions with real content and its story exists on both sides of the change.

* Before: a scratch worktree at the merge base, the same
  `pnpm build-storybook` + `capture-evidence` command, frames into
  `docs/evidence/chat-sidebar-sections-baseline/` (the existing `*-baseline`
  directories are the precedent, e.g. `chat-sidebar-status-feed-baseline`).
* After: the same story from this branch, same command.
* The claim is then checkable two ways: the two frames are compared, and — because
  S3 makes the default a no-op — they should be pixel-identical; any difference is
  either a finding or a stated, understood change.

**If the frames differ, the existing sidebar sets are stale and must be
re-captured in one sweep** (`--only=chat-sidebar-`) in the same pass, with the
manifest re-stamped. That is the cost S3 exists to avoid, and it is the reason the
decision is worth the nullable field.

### 7.3 The driver — the gesture, the geometry and the restart

`scripts/renderer-driver.mjs`, a new scene `--scene sidebar-split`, run with
`--backend <url>` and a renderer built against that URL (the sidebar's catalogue is
backend-gated; this is the `--scene pins` situation and it needs the same
`LOCAL_OPERATOR_DESKTOP_TOKEN` and a backend on a port the page's own `connect-src`
allows — 8080 or 1111, `docs/agent-driver.md:66-74`). What it asserts, in order:

1. **The reveal is real.** `movePointer` onto the boundary (the existing
   `Input.dispatchMouseEvent` helper, 1930-1937; the app's own 200ms intent delay
   means the scene waits it out the way `parkPointer` waits 320ms), then assert the
   cluster is hit-testable at its painted centre, and capture. This is a claim no
   story can make and no synthetic event can make honestly.
2. **The drag is a drag.** `mousePressed` on the band, N × `mouseMoved` with
   `buttons: 1`, `mouseReleased` — the primitives already exist
   (`pressPointerStationary`/`pressPointer`, 1956-1990); the new part is the moves
   with the button held. Then assert the list region's
   `getBoundingClientRect().height` moved by the pointer delta (±1px), that the
   first move stored a px value, and capture the dragged state.
3. **The clamp holds** at both ends, the other region keeps 72px, and
   `aria-valuenow` equals the drawn height.
4. **The collapse is real, and the restore row is the way back.** Press each
   cluster control through CDP, assert the region unmounts and the other fills the
   column, assert the restore row is present and named, press it, assert the region
   returns. Capture each state.
5. **Keyboard.** Focus the separator, press ArrowUp/ArrowDown through
   `Input.dispatchKeyEvent`, and assert both halves: the height moved **and focus
   did not move to a row** (S11's `stopPropagation`). Focus rings are the caveat
   below — this asserts focus *location*, which is honest headless.
6. **The write.** Read `localStorage["ui-preferences-storage"]` from the page and
   assert it carries the resolved `chatSidebarListHeight` and `chatSidebarRegions`.
7. **The restart.** Reap the app by pid and boot it again **with the same scratch
   profile** — `--user-data-dir` is `${USER_DATA}-${tag}` (declared at 350, passed
   at 765-775), i.e. per *run* rather than per boot (the comment at 650-651 says as
   much, and `--gate-check` already boots four apps in one run), so a second boot in
   the same run rehydrates the same `localStorage`. Assert the
   boundary renders at the stored height and the collapsed region is still hidden.
   Capture the post-restart frame. This is the acceptance criterion, and it is the
   one claim in the whole change that only a real second boot can make.

**Harness cost, named rather than discovered later.** A scene today runs inside one
boot (11151 and the dispatch at 11272-11284: one `app`, one `cdp`, one scene call
before the reaper). A restart step needs a small addition — a `restart()` handed to
the scene, implemented on the existing `reapLiveBoots` plus the launch path, with
an assertion that the second boot's pid differs and that the profile path is
unchanged. That is a `scripts/` change, so it is one of the two commits this branch
owes the manifest (`AGENTS.md:124-145`), and the stamp must be re-derived from the
**merged** tree, not from the working tree.

**Honest limits, stated on the frames and in the README beside them:**

* A synthetic pointer sequence dispatched from inside the page (`press`,
  `docs/agent-driver.md:396-399`) proves a handler ran; it does not prove the
  control is hit-testable. The drag above therefore uses the **CDP input domain**
  (`Input.dispatchMouseEvent`), which enters Chromium's own pipeline — the
  distinction the harness's own comment draws at 1920-1929. What it still cannot
  prove is a *real hand*: no pressure, no jitter, no trackpad momentum.
* **`:focus`/`:focus-visible` rendering is not covered headless**
  (`docs/agent-driver.md:383-388`). The cluster's focus reveal and the separator's
  focus ring need either `--window-mode=inactive` or
  `Emulation.setFocusEmulationEnabled`, and the run must say which it used. If the
  scene does not do that, the frames must not be presented as evidence about focus.
* A driver run has no backend unless `--backend` names one, and with none the
  sidebar renders its notices rather than its regions — so a frame from a run
  without `--backend` is not evidence about this change at all.

### 7.4 The frames this change commits

| Frame | Provenance | What it proves |
|---|---|---|
| `docs/evidence/chat-sidebar-sections/*.webp` | Storybook, 12 themes | every resting state (S3, S5, S7, S12), and the parity diff |
| `docs/evidence/chat-sidebar-sections-baseline/*.webp` | Storybook at the merge base | the "before" half of the parity pair |
| `docs/evidence/sidebar-split-live/*.png` | `--scene sidebar-split --backend` | the reveal, the drag, the clamps, the collapse and restore, the keyboard path, and the restart |

Each directory gets a README naming the exact command that produced it (the
`docs/evidence/chat-usage/README.md` style), and the manifest gets its own
`headNote` in the established form plus the `frames` / `surfaces` / `themes` counts
it derives. `scripts/evidence-manifest.test.mjs` checks the stamp without the
sweep's machine-wide lease, so a stale one is visible locally in under a second
(`AGENTS.md:121-134`).

### 7.5 QA's independent pass

The matrix in § 9 plus the neighbours a split can regress, which are named here so
QA does not have to guess them: the per-group disclosures, the `all` filter, the
pinned re-file geometry (the shipped rig is
`scripts/sidebar-resort-geometry.mjs`, and it finds its two containers from the
*row kinds* — `[data-tour-tag="chat-session-row"]` and `[data-child]` — so a split
that re-parents rows without keeping those stamps breaks the instrument rather than
the product), the bulk read receipt, the withdrawn-gate frame (which must gain no
divider), and a window resized to ~600px and ~380px of column height.

---

## 8. Unit test matrix: `scripts/sidebar-split.test.mjs`

Bundled in memory with `esbuild` and driven as the shipped TypeScript, in the shape
`scripts/sidebar-catalogue-gate.test.mjs` establishes (its header states why the
module is bundled rather than mirrored, and why nothing but the boundary is faked).
Cases:

1. **Region resolution**: each of the three values resolves to the right pair of
   visibilities; the union is exhaustive (`switch` default asserted).
2. **The invariant**: no reachable input yields neither region visible; hiding the
   visible region while the other is hidden shows the other (S8), asserted for all
   three starting states.
3. **Query override**: `query: true` returns both visible for all three stored
   states, leaves the stored value echoed unchanged, and returns `restore: null`
   (S7).
4. **The catalogue gate**: `showList: false` returns `divider: null` and both
   regions visible, for every stored state.
5. **Auto**: `listHeight: null` → `listHeight: null` in the output (the component,
   not this module, applies `max-h-[45%]`), and the divider's value is the drawn
   height passed in rather than a number the module invented.
6. **Clamp arithmetic**: at a given capacity, `divider.max === capacity - 72`;
   `min === 72`; `resizable` is false below `2 × 72` and `min === max === value`
   there; a stored value above `max` or below `min` is clamped **for the render**
   and the stored value is echoed unchanged (S2's "never rewritten").
7. **Tamper**: every row of § 3's validation table, including the coercible-looking
   ones (`"369"`, `"369px"`) which must fall back to `null` rather than becoming
   `369`.
8. **Small window**: the same stored height resolves to two different rendered
   requirements at two capacities, and to `resizable: false` at a third (the case
   a single-capacity test would pass by accident).
9. **Grow sign**: `growSign` for all four sides, and the drag arithmetic
   (`start + delta × growSign`, then clamped) for each side, so the horizontal
   direction cannot be shipped inverted.
10. **Key map**: ArrowUp/ArrowDown → ±16, Shift → ±64, Home → the axis start,
    End → the axis end, Enter → `null` (auto), each asserted against the clamped
    write rather than against a returned constant.

What this file cannot pin, and where each is covered instead: the pointer lifecycle
(§ 7.3 by CDP), the bubbling order of the nav's arrow walk (§ 9 A7), and the panel's
actual rendering (§ 7.1 by frames). The module's own docstring should say so, in the
form `sidebar-catalogue-gate.ts` uses ("this file says the decision is right, the
frames say it looks right").

---

## 9. Acceptance criteria

Stated so that a reviewer, a QA pass, a design round and a UX round can each test
against them without reading each other's notes.

**A1 — Parity.** With no stored values, the panel is today's panel: the
`resting-default` frame of the new story is pixel-identical to the
merge-base capture of `chat-sidebar-status-feed--completion-in-place`, and the four
existing sidebar evidence sets remain valid. Any pixel difference is either a
finding or a stated change with a re-capture.
**A2 — Drag.** Dragging the boundary moves it 1:1 with the pointer, the list region
follows, and the value is stored. At both ends the clamp holds, the other region
keeps 72px, and `aria-valuenow` equals the drawn height.
**A3 — Memory.** A drag and a collapse survive a restart of the built app on the
same profile, with the persisted blob naming both values (§ 7.3 step 7).
**A4 — Hit testing.** A press within 5px of the boundary on either side starts a
drag; a press on the last visible row of the entity region and on the `All chats`
row does not, at 240px and 360px panel widths and at two window heights.
**A5 — Collapse.** Each region collapses to a filled column for the other, the
restore row names what is hidden, one press restores it, and no input reaches "both
hidden".
**A6 — Search.** With a region collapsed, a query for a row in that region finds it
and renders both regions; clearing the query restores the collapse exactly, and the
disclosures blob is unchanged by any of it.
**A7 — Keyboard.** Tab reaches the separator and both cluster controls; Arrow/Shift/Home/End/Enter do what § 6 says; the arrow walk does not move focus on a consumed key; focus never lands on `body` when a region unmounts.
**A8 — Small windows.** At ~600px and ~380px of column the layout is legible, the
clamp holds, the entity region yields first, and below the offer threshold the
separator reports one value and refuses writes without destroying a stored one.
**A9 — Gates.** `pnpm check-types`, `pnpm lint`, `pnpm lint:scripts`,
`pnpm check-themes`, `pnpm check-changed` and the desktop suite all pass, and no new
runtime dependency exists, so `scripts/check-runtime-deps.mjs` is untouched. On the
theme gate specifically: the cluster reuses the ghost step (`hover:bg-accent-wash`,
`button.tsx:167-172`) and the restore row the row step, both of which the existing
`CONTROLS` rows cover, so **no new row is expected** — but the boundary's *state
line* is a new ground+fill pair on this surface (`bg-control` on hover, `bg-accent`
while dragging) and the vertical divider's identical line has no row today, so if
the design round wants that line asserted, one row covers both.
**A10 — Evidence.** The three frame sets of § 7.4 exist with READMEs naming their
commands, the manifest is re-stamped from the merged tree, and the limits in § 7.3
are stated on the frames.
**A11 — Visual round.** Before/after stills at `localOperatorDark` and
`localOperatorLight` for: resting, dragged, entities-only, chats-only, the revealed
cluster (hovered, via the driver), the restore row in both positions, and the short
window. Consecutive frames where anything settles (the reveal and the collapse are
the two transitions worth two frames each).
**A12 — Flow round (UX).** The real flow walked end to end in the live app: drag →
read → collapse → search → clear → restart, with the recovery path (restore row,
double-click, Enter) checked as part of the flow rather than as separate controls.

---

## 10. Risks to watch during rollout

1. **The clamping contract drifting into two opinions.** `chat-content.tsx` keeps
   capacity, drawn value and stored preference as three separate numbers with one
   written contract (735-762). If the sidebar grows a second clamp in a different
   place, a stored height and a drawn height will disagree in a small window, which
   is exactly round 2's U6 one slot over. Watch: a single `resolveSidebarSplit`
   call site, and a test that a stored-but-unhonourable value is echoed unchanged.
2. **The 10px band stealing clicks.** § 9 A4 is the test. If a real drag turns out
   to be too easy to trigger by accident while scrolling, the answer is the hover
   intent delay rather than a wider band — the band must not grow into the row
   tails.
3. **The reveal being undiscoverable.** A hover-revealed control on a boundary the
   user has no reason to hover is a real risk, and the rail's precedent is not
   proof for this surface. Watch the UX round's answer to "how would somebody find
   this?", and be prepared to pair it with one line of discoverability (the restore
   row is the natural place for a one-time hint) rather than with permanent chrome.
4. **The cluster overlapping the boundary's own drag.** Both live in the same
   ~10px band. The band must be the drag target *outside* the cluster's box, and a
   press on a cluster button must not start a drag — one `preventDefault`/
   `stopPropagation` away from a control that also resizes the panel under it.
5. **Focus on unmount.** Collapsing the region that holds the focused row must not
   strand focus. S5/S11 put the controls outside the region, but the *keyboard*
   path collapses from the cluster which is inside the boundary — verify with A7.
6. **The evidence stamp.** The restart step is a `scripts/` change; a stamp derived
   before the merge names the pre-merge trees and looks right (`AGENTS.md:136-145`).
   Watch: derive after the merge commit exists.
7. **The reorder temptation.** *This happened, deliberately, and the cost below
   was paid rather than avoided - the frames, the third store field and the fourth
   tab stop all exist, and driving the swap found a scroll-position defect no
   still would have (U2).* The warning, kept for the record: if someone adds the
   S9 swap control as a
   "small addition" inside this PR, the frame set, the UX round and the state field
   all grow with it. It is a separate PR on purpose.

---

## 11. Non-goals

1. No drag-and-drop reorder: S9's swap glyph ships instead, which is what the
   manager put in scope. No new dependency (ground truth 13).
2. No change to what each region lists: not the grouping, the pins, the search, the
   receipt, or the sort.
3. No collapse of the nav rail, and no change to `chatSidebarWidth`.
4. No animation of the split. The boundary moves with the pointer; nothing else
   moves, and no height transition is added (S11).
5. No new route, no settings row, no reset-all control (S10).
6. No change to the `chat-sidebar-disclosures` blob or its keys (S10).
7. No persisted per-region scroll position, no persisted `all` filter: neither is
   persisted today and neither is part of this ask.

---

## 12. Items that are a human or product decision, not an engineering one

I made the call on each of these and implemented the consequence in the design
above; they are listed because the operator would reasonably want the last word.

1. **Whether reorder ships in this window or the follow-up.** RESOLVED after
   review round 1: it ships here, as the glyph S9 specified, with its own frames,
   its own driven scene and its own findings (design D2, UX U2). My recommendation
   was the
   follow-up (S9) with a named gesture. This is the one item the operator raised
   himself, so it is his.
2. **What "collapse the last visible region" does.** I recommend hide-one-shows-the-
   other (S8), because it makes the impossible state unrepresentable. The
   alternatives — allowing an empty column, or refusing the press — are defensible
   product positions rather than mistakes.
3. **Whether the collapsed chats row should offer a way to start a chat.** I
   recommend no (S5), keeping the restore row a single control, and accept that the
   primary `New chat` row is one click further away while the list region is hidden.

---

## 13. Review rounds this change needs

Per the standing rules: `### Agent review — round N` with `Reviewer:`/`Scope:`
lines and a per-finding remediation reply, until no blocker or major remains and
the round is fresh on head; a clean **QA** round on the same head (independent
pass, scratch profile, the matrix in § 9 plus § 7.5's neighbours); a **design**
round, because every surface here is user-visible, judged from rendered frames
rather than source, including `localOperatorLight`, where contrast defects hide;
and a **UX** round, because this changes an interaction flow — a drag, a collapse
and a restore, in the real app, with the restart in the flow.

The evidence each round needs is in § 7: the design round takes § 7.1's frames plus
the § 7.2 pair plus § 7.3's hover and collapsed states; the UX round takes the live
app and the flow; the reviewer takes the pure module and the divider diff; QA takes
the matrix. Nothing in this document is a commitment about when any of it merges.
