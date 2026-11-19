# Customisable destinations in the sidebar

Design direction and implementation contract for the operator's ask:

> Make the left sidebar's navigation customisable: drag destinations in and out
> of the `More` collapse, and reorder them, so the user decides what is always
> visible.

Status: implemented on this branch. This document is the authority the coder,
reviewer, QA and designer rounds read; where it and a screenshot disagree, the
screenshot is the observation and this document is the intent.

## 1. What is being customised, and what is not

The column has two kinds of row:

* **Actions** — `New chat`, `Search`. They are pinned at the top, are not
  destinations, and never participate in the layout. No drag handle, no menu
  items, no stored id.
* **Destinations** — the rows that navigate. The ids are the stable spelling
  used on the wire and in the store; the labels are localised and are not ids:

  | id | default label (en) | default region |
  | --- | --- | --- |
  | `aida` | Aida (her configured name) | visible |
  | `library` | Library | visible |
  | `projects` | Projects | visible |
  | `agents` | Agents | visible |
  | `schedules` | Schedules | visible |
  | `browser` | Browser | visible |
  | `team-bridge` | Team Bridge | More |
  | `agent-hub` | Agent Hub | More |
  | `mesh` | Mesh | More |

`More` itself is not a destination and has no id. It is the fold line between
the two regions (see § 3).

**Copy rule, written down because it drifted.** Destination labels are proper
names and take title case (`Agent Hub`, `Team Bridge`, `Library`). Action labels
are sentences and take sentence case (`New chat`, `Search`). Localised labels
follow their own locale's conventions; the English source does not impose
English title case on them. The context note on each catalogue key carries this.

## 2. The model

One ordered list, cut at one point:

```ts
type SidebarLayout = {
  visible: SidebarDestinationId[];  // drawn first, above the More row
  more: SidebarDestinationId[];     // drawn after the More row when it is open
};
```

`visible ++ more` is the single order the drag operates on. The boundary is
`visible.length`; it is a fold, not a second container.

Defaults are today's arrangement exactly:

```ts
visible = [aida, library, projects, agents, schedules, browser]
more    = [team-bridge, agent-hub, mesh]
```

**All nine ids are stored even when a destination is not currently available.**
A capability gate (Aida disabled, Library below the backend version, not in a
mesh, Team Bridge ineligible) removes the row from the *render*, never from the
stored order — so a preference survives an app or backend update that
temporarily hides a destination. Missing ids are re-inserted at their default
position relative to the ids that remain; unknown ids are dropped; duplicates
are impossible. That merge is one pure function and is tested.

### The TUI decision

The terminal app's sidebar is a **session list**, not a destination rail: it
has no Aida/Library/Projects/Schedules/Browser rows to order. There is
therefore no second surface to share this with today, and this setting is
**desktop-scoped**. It is still stored on the backend (not in renderer
`localStorage`) so it survives app updates, is one source of truth, and a future
terminal or phone surface can read the same resource without a second
preference. We are not half-sharing: the terminal does not read or write it.

## 3. Rendering

```
[Aida]            visible[0]
[Library]         visible[1]
...               ...
[Browser]         visible[n-1]
[More  ⌄  (3)]    <- fold line, only when more is non-empty
  [Team Bridge]   more[0]      (only while the fold is open)
  [Agent Hub]     more[1]
  [Mesh]          more[2]
```

* The fold open/closed state stays the existing local disclosure preference
  (`sidebarOverflowExpanded`). It is not part of the customisation.
* A route that lives inside a closed fold reveals the fold for that visit,
  without overwriting the preference — the existing rule.
* **More is empty → no More row at all.** No empty disclosure.
* **Everything is in More → the visible region is empty and the More row is the
  only row**; it still opens, and its contents are draggable back out.
* If no destination is available at all, the destinations region renders
  nothing.
* Aida's row keeps its badge and working mark in either region. When she is
  folded away, the **More row carries the aggregate**: every hidden row's
  attention count is summed into its badge, and any hidden row working draws
  the working glyph. This is the requirement that an unread chief of staff can
  never be hidden by customisation.
* The collapsed 56px strip draws the same order. Dragging is enabled there too
  (same component, same threshold); the row menu is available by right-click /
  `Shift+F10` even though the ellipsis is not drawn at that width.

## 4. The backend resource

New desktop route, gated on the `sidebar_layout: 1` capability:

* `GET /v1/desktop/sidebar-layout` → `{ layout: SidebarLayout }`
* `PUT /v1/desktop/sidebar-layout` with `{ layout: SidebarLayout }` → the
  normalised layout.

Stored at `config_dir() / "sidebar-layout.json"` as
`{"version": 1, "visible": [...], "more": [...]}`. Reads are best-effort and
degrade to defaults (a corrupt preference must not cost the column); writes are
atomic (`os.replace`) and a failed write is a 500, because a save the user was
told succeeded and did not is worse than an error. The route validates against
the static id allow-list, refuses duplicates, and accepts a subset (the client
fills missing ids from the default). Last writer wins; the app is effectively
single-window, and the file replace is atomic.

The client falls back to the fixed default order — with drag and the menu
absent, fail-closed — when the capability is missing or the read fails. It
never invents a write against a backend that cannot store it.

## 5. Drag

Pointer events, not HTML5 drag-and-drop. `draggable` hands the gesture to the
OS drag loop: the browser draws its own lifted, translucent drag image (both
things `docs/branding.md` forbids), the drop target is an allow-list rather
than geometry a rig can read, and no frame can photograph the indicator. The
pinned-chat reorder in `chat-sidebar.tsx` is the precedent; this is the same
family of mechanics.

* **Threshold: 5px** of movement from `pointerdown` before the gesture arms. A
  click never becomes a drag, and a drag never becomes a navigation.
* **One indicator, not a highlighted row.** A 2px line between rows says
  "insert here". The row under the pointer is never filled. A dropped-in row is
  never lifted, scaled or translated.
* **Hit testing by row midpoints.** The pointer has passed a row when it is
  below that row's midpoint; the slot is the count of passed rows, excluding
  the dragged row. This is the shipped `pinDragSlot` rule.
* **The fold is a drop target.** Hovering the More row while dragging a
  visible row arms a short dwell (~400ms) that opens the fold so an insertion
  point inside it can be chosen; dropping on the More row itself puts the row
  at the end of `more` and opens the fold so the landing is visible.
* **The trailing band is the outside zone.** While a drag is live, a thin band
  below the list is a drop target labelled by direction: dragging from visible
  → "Move to More" (lands at the end of `more`); dragging from More → "Show in
  sidebar" (lands at the end of `visible`, and the line is drawn at the end of
  the visible region). It exists so pulling a row out of the fold never depends
  on hitting a 30px row, and it is a visible affordance rather than a hidden
  gesture.
* **Auto-scroll** when the pointer is within 24px of the destinations
  scroller's top or bottom: one 8px step per animation frame, re-deriving the
  slot from the boxes as they move.
* **Esc cancels** the gesture and restores the starting layout. Nothing was
  written before the drop, so there is nothing to undo but the line.
* A drop that lands where the row already is writes nothing.

## 6. Every path is a non-drag path

Each destination row carries a trailing ellipsis button (expanded width) and
opens the same menu on `contextmenu`, `Shift+F10` and the `ContextMenu` key:

* `Move up` / `Move down` — within the row's own region; disabled at the
  region's boundary. Keyboard equivalents: `Alt+ArrowUp` / `Alt+ArrowDown` on
  the focused row.
* `Move to More` (when visible) / `Show in sidebar` (when in More) — appends to
  the other region and opens the fold if it moved there.
* `Reset sidebar layout` — only when the layout differs from the default.

The menu is the discoverability path: a user who never guesses that rows drag
still finds the feature on the row they are looking at. It is also the complete
keyboard path — reorder, change region, reset — with a polite live-region
announcement after every move.

## 7. Persistence and failure

The read happens at mount (React Query, keyed under `["desktop",
"sidebar_layout"]`), plus ONE deliberate re-read when the latest queued write
settles - a failed earlier save must not leave the rail showing a snapshot the
backend does not hold. Writes are optimistic and one per completed gesture; on
failure the previous layout is restored and a toast says the order could not be
saved. Restarting the app re-reads the stored layout, so the arrangement
survives: that is the acceptance test, not a local-storage side effect.

## 8. Evidence this change owes

* before/after stills of `Team Bridge` dragged out of More into the visible
  list between two named rows, and of a visible reorder;
* the same two results through the context menu;
* the arrangement after an app restart;
* a keyboard-only sequence (open menu, move, change region, reset);
* the More-empty state;
* Aida folded into More with her badge still on the More row;
* every frame in the app's own built renderer, captured through the driver
  (`scripts/renderer-driver.mjs`), plus a design round with its own frames.
