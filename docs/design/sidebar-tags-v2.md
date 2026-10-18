# LOH-11 v2 — drag, auto-tagging, better creation, agents, one vocabulary

**PROPOSED, not implemented.** 2026-10-18. Follows the merged first slice
(`sidebar-tags.md`, `sidebar-tags-flows.md`; UI #1177, core #2600). This document
is the operator-feedback plan: it updates the interaction contract and the slice
order before any v2 code.

Designer/manager baseline: `origin/main` after #1177 (`0c8a39a0e3`). The first
slice's measured geometry and off/on/tag-group contract remain authoritative;
v2 changes only the five areas below.

## 1. Why these changes

The first slice proved the data model and the optional grouped view. The
operator's 2026-10-18 feedback is about the *working* surfaces: tagging still
costs too many deliberate steps, drag is the natural gesture, the picker is a
checkbox list rather than a modern label control, forked sessions should arrive
pre-organised, and agents plus the other clients must see and write the same
vocabulary. The store does not change shape; every item below is a client of
the same `tags/` store and the same catalogue fields.

## 2. Slice plan (serial; each ships through the normal gates)

| Slice | Scope | Why this order |
|---|---|---|
| **V2-1 Drag + remove-all** | Click-hold row drag, tag-header/Untagged drops, primary rule, preview/autoscroll/cancel/undo, keyboard move, context-menu `Remove all tags (N)` | Pure desktop-client work on the already-merged assignment API; highest-frequency interaction. |
| **V2-2 Tag creation UX** | Searchable multi-select combobox with chips, inline create, dedupe/rename, keyboard-first, 420px; before/after frames | Reuses the same assignment API; independent of drag and auto-tagging. |
| **V2-3 Auto-tagging** | Fork naming call returns tags in one call; stable cacheable tag prefix + tag-set hash; View-options toggle; no tags → no call | Core prompt work; benefits from V2-2's clearer category control but does not depend on it. |
| **V2-4 Agents + surfaces** | `tags` agent tool (list/create/rename/assign), mobile read+assign contract, TUI primary-tag rendering behind its own opt-in | Needs the stable API; the mobile lane consumes the contract without duplicating the store. |

Each slice is one PR (or one core + one UI PR where the wire changes), with
affected tests, i18n, rendered evidence, independent review, QA, and design/UX
rounds where the surface changes. No version bump; each merge is handed to the
release window owner.

## 3. Drag and drop

### 3.1 Gesture

- **Click-and-hold anywhere on a conversation row** starts a drag candidate.
  Arm threshold: **180 ms hold with ≤5 px movement** (the same shape as the
  board's `armed` distinction; a press that never moves is a click). The
  threshold is a named constant and a pure predicate, not a scattered `if`.
- A normal click (release before the hold threshold, or movement beyond the
  click tolerance before arming) still opens the conversation. Once armed, the
  click that would open the row is suppressed for that pointer sequence.
- **Pinned rows keep the existing grip and its behaviour.** The grip remains
  the explicit affordance and starts the existing reorder drag exactly as
  today. Click-hold on the pinned row body starts a row drag that can reorder
  within the Pinned section *or* drop on a tag group; it must not regress the
  grip's pinned reorder, its insertion indicator, its Escape behaviour, or its
  one-row guard.
- Pointer events + `setPointerCapture`, not HTML5 drag: the row must not enter
  the OS drag loop, the drop target is geometry this repository can measure,
  and a committed frame can show the preview. This is the pinned drag's own
  reason and it applies unchanged.
- Touch: the same hold threshold; a vertical scroll that starts before the
  hold threshold is a scroll, not a drag. Do not set `touch-action: none` on
  the whole row; only the armed gesture claims the pointer.

### 3.2 Targets and the primary rule

- **Tag group header (28px)** — the whole header is the target. Dropping a row
  there adds that category if absent and makes it **primary**; other assigned
  tags stay. The row therefore appears in exactly one bucket: the primary one.
  If the tag is already primary, the drop is a no-op with no write.
- **Untagged header** — removes every assigned tag and clears primary. One
  assignment write; undo restores the exact prior tag list and primary.
- **Only a group header in the row's own existing section is eligible.**
  Pinned/Running/Today/This week/Older membership is authoritative; drag does
  not pin, unpin, run, archive, or move a row between time sections. An
  ineligible header does not highlight. This is the rule that prevents a
  "silent second group".
- **Grip/pinned reorder** keeps its existing slot model and insertion
  indicator. Tag-header drops show a header highlight (accent-wash + accent
  outline) rather than a row insertion line, because they assign rather than
  reorder. The row itself stays where React put it until the write settles.
- **No arbitrary row reorder inside a tag group**: the group's order is the
  existing sort. "Reorder feedback" is the pinned gesture's insertion line plus
  the tag header's highlight; after a tag change the row re-sorts by the
  existing rule. If a later slice wants manual order inside a group, it needs
  its own stored order and is out of scope here.

### 3.3 Preview, autoscroll, cancel, undo

- A drag also starts from a **long list**: autoscroll the owning list scroller
  (not the page) in a 32 px edge zone, 12 px per frame, with the same constants
  as pinned drag. Stop on cancel/settle.
- `Escape`, `pointercancel`, window blur, or a pointer released outside all
  eligible targets cancels with **no write** and clears the preview.
- A successful write shows an undo toast with the previous assignment:
  `Moved to “Review”` / `Removed all tags` + `Undo`. Undo issues one
  assignment write restoring the previous tag list and primary; a second undo
  is not offered. The toast's action is keyboard reachable.
- **Failure**: the row returns to its prior bucket/primary and the error names
  the action; no optimistic ghost group survives. A retry is the normal
  assignment retry, never a second drag.
- **Keyboard equivalent**: the row menu gets `Move to tag…` with the category
  list and `Untagged`; choosing one performs the same assignment and focus
  returns to the row. This is the WCAG single-pointer/keyboard path; drag is
  never the only route. (The existing `Move up/down` pinned items remain.)

### 3.4 Geometry / acceptance

- 220 px sidebar: row 32 px; tag header 28 px; header target full width; no
  horizontal overflow, no row indentation, no title change on drag until the
  write settles; header highlight visible in both themes and not clipped.
- Chips are a later slice; the drag must still set the **no chip swap during
  drag** latch now: while a row drag is armed or settling, the row's chip
  hover/focus/menu state is suppressed, so a future chip implementation cannot
  enter a swap mid-drag. Test the latch even though v2-1 draws no chips.
- Click/drag discrimination: a press shorter than 180 ms or moving ≤5 px then
  releasing opens the conversation; a held press that moves arms drag and does
  not open. Both paths tested in the real renderer.

## 4. `Remove all tags` in the row menu

- One item, only when the row has ≥1 tag: `Remove all tags (N)` where **N is
  the count of distinct assigned tags**, not conversations. For a multi-tag
  row this clears all N in one atomic assignment and sets primary null.
- It is an ordinary menu item (not a submenu) and is disabled while a picker
  is open on that row. Keyboard focus and menu-close behaviour follow the
  existing context menu.
- Success shows `Removed N tags` with **Undo**, restoring the exact prior tag
  list and primary. Failure leaves the row unchanged and shows the assignment
  error; no partial clear.
- The menu budget is revisited: Tags…, Remove all tags (N), and Move to tag…
  add three items to the current eight; the menu remains scrollable and its
  target sizes unchanged. The row-menu test pins the conditional presence and
  order.

## 5. Auto-tagging in the fork / naming call

### 5.1 One call, same context

The title call in `local_operator/session/naming.py` (`generate_title_acceptance`)
is already a bounded, tools-free model call on the fork's opening context. It
returns tags in the **same** call rather than making a second request:

- The system prefix gains an optional `<available-tags hash="…">` block
  (canonical `id: name` list in display order) and the output contract
  `… <tags>a1b2c3d4e5,f6e5d4c3b2</tags>`; the existing `<title>` contract is
  unchanged. The model may return ids or exact case-insensitive names; ids are
  preferred. Only the caller that supplies tags gets the block.
- Parse and validate: ids or exact case-insensitive names only, dedupe, retain
  caller order, cap 8, ignore unknowns. Invalid/empty output means **no
  assignment**, not an error and not category creation. The title is still
  accepted if tags are invalid; tags failing never discards the title.
- On first substantive turn of a fork with auto-tag enabled and a non-empty
  category registry, the naming caller writes `set_entity_tags` with the first
  returned page as primary. The fork request carries `auto_tag` (the UI sends
  `view.tagsEnabled && view.autoTagForks`, default true); core writes a
  `auto-tag.json` sidecar so the naming worker reads the intent without a
  second client call. If tags are empty or auto-tag is off, the naming prompt
  is **byte-identical to today** and no tag work occurs.

### 5.2 Stable prefix and cache key

- The tag block is a stable prefix: same category set/order → identical bytes;
  the conversation excerpt stays after it. `tag_set_hash` is SHA-256 over the
  canonical `[{id,name}]` order.
- The naming request's cache key includes `tag-set:<hash>`; a newly added tag
  changes the hash and therefore the next call's prefix, while title-only
  callers keep their existing prefix. No global invalidation and no per-call
  prefix churn. Tests: byte-identical prompt for the same set, hash change on
  add/rename/reorder, title-only prompt unchanged, unknown/invalid output
  assigns nothing, empty registry makes no tag block and no write.
- Cache correctness is a test of the rendered prompt/request, not a claim about
  a provider's internal cache hit rate.

### 5.3 Setting

- View options Tags group gains `Auto-tag forked sessions` (default **on**),
  persisted with the sidebar view. It is visible only when tags are enabled;
  turning tags off never runs auto-tagging. The toggle does not create a second
  call when tags are empty.
- Agent-created sessions are not auto-tagged by this setting; they use the
  explicit `tags` argument/tool. A future surface can opt in with its own
  client setting.

## 6. Tag creation UX — research and component

Researched patterns (2026-10-18): Linear's label picker (search, inline create,
keyboard-first, workspace/team vocabulary), Notion's multi-select (type a name
and press Enter to create, chips for selected values), GitHub labels (one
vocabulary, create/rename/dedupe in a management surface), and the generic
[multi-select input pattern](https://uxpatterns.dev/patterns/forms/multi-select-input)
(combobox + chips, Arrow/Enter/Space, Backspace removes the last chip, inline
create only when the query has no exact match). We take the interaction
patterns, not any product's colours or chrome.

Proposed picker (420px, viewport-capped):

- A combobox input with selected tags as removable chips; the primary chip
  carries a leading dot and an accessible "Primary" description, not a colour.
- Typing filters the list; Arrow keys move; Enter/Space toggles; Backspace on
  an empty query removes the last chip; `Create “query”` is the last row only
  when no exact (case-insensitive) match exists. Selecting an existing tag
  never creates a duplicate.
- Inline chips show full labels; long labels truncate inside the chip with the
  full name in the title/accessible description, never the title column. The
  chip row wraps within the 420px dialog; no horizontal scroll.
- `Group under` remains a compact row of radio choices among the selected
  tags, shown only with ≥2 selected; one selected tag is statically primary;
  zero previews `Untagged`.
- Footer: Cancel / Apply. New-tag creation is a registry write only when the
  user activates `Create`; Cancel never creates.
- Manage dialog: searchable ordered list, inline rename with duplicate
  validation, add, up/down, delete with count and primary consequence. No
  colour/role in this slice; no new dependency.
- Keyboard-first acceptance: open focus in the input, full traversal, Escape
  cancels, Apply commits one assignment, focus returns to the row.
- Before/after frames at 220/260/320 light/dark, including empty, long/
  Unicode names, no matches, inline create, primary, error and loading.

## 7. Agents and one vocabulary across surfaces

### 7.1 Agent tool

Add one `tags` tool (not a fourth spelling on `sessions`):

- `list` → categories with ids, names, order, conversation counts.
- `create(name)` → one category; duplicate/case/blank/reserved names refused
  with the known list; no silent partial.
- `rename(id, name)` → id and assignments preserved; no reassignment.
- `assign(session_id, tags[], primary?)` → the same store/validation as the
  `sessions spawn` path: known ids or exact names, ≤8, primary in tags, atomic;
  empty list clears. Delegated/hidden sessions are taggable; mesh/remote target
  is refused in this slice.
- Every result names the ids/names and the session, so the tool ledger is the
  audit trail. No model-created vocabulary: `create` is the only creation path.
- Prompt guidance: "use `tags` to list/create/assign; never spell a category
  the store does not contain; assign after creating." Budget the tool doc and
  update the token ledger deliberately.

### 7.2 The contract other surfaces consume

`docs/design/sidebar-tags-api.md` is the client-facing contract: capability
`session_tags`, catalogue `tags`/`primary`, `GET/PUT /tags`, `PUT
/sessions/{id}/tags`, validation and error codes, and the rule that clients
render the store response rather than caching a second category copy. Mobile
and TUI lanes read this document; they do not reimplement the store.

### 7.3 TUI session list

TUI parity is a **read-only render plus its own opt-in**, not a second
assignment surface:

- `CatalogEntry` carries the same `tags`/`primary` projection.
- A TUI setting, `/tags on|off` (default **off**), shows the primary tag as a
  compact `#Tag` suffix in the row when it fits; no grouping, no chips, no
  assignment in this slice. At narrow widths the suffix sheds before the title
  (same rule as other status marks).
- The full tag list is available to the row's detail/agent context; the TUI
  never invents a category or writes through a second store.
- Desktop/mobile/TUI all show the same assignments after the next catalogue
  read; the store remains the only writer.

### 7.4 Mobile

Separate lane. This slice exposes:
- read: catalogue rows with `tags`/`primary`; `GET /v1/desktop/tags`;
- write: `PUT /v1/desktop/sessions/{id}/tags`;
- capability: `session_tags: 1`;
- no client-side category database, no local ID generation, no offline name
  authority. The mobile lane's PR must state which of these it uses and must
  not duplicate the store.

## 8. Acceptance / evidence for each slice

- V2-1: before/after drag frames (armed, hover header, highlighted Untagged,
  cancelled, settled, undo toast) at 220/260/320 light/dark; click-vs-drag
  proof; pinned reorder regression proof; remove-all multi-tag proof.
- V2-2: before/after picker and Manage frames at the full matrix; keyboard-
  first transcript; long/Unicode/duplicate/empty/error states.
- V2-3: prompt byte/hash tests; one-call proof (no second provider call);
  no-tags/off-path proof; fork auto-tag real-path proof; setting persistence.
- V2-4: tool tests and real agent call; TUI frames on/off/narrow; API contract
  review with the mobile owner; no second store.

## 9. Risks / open decisions carried into implementation

- **Drag vs open** is the highest-risk interaction: threshold, pointer capture,
  scroll, touch, and the pinned grip coexist. Prove on the real renderer, not
  only Storybook; a click that opens after a drag is a release blocker.
- **Auto-tagging prompt drift** is a title-quality risk: the tag block must be
  optional and byte-identical when off; invalid tags must never affect the
  title. A model that returns a tag id embedded in a title sentence is a parse
  test, not a new heuristic.
- **Combobox chips at 220px** can crowd the 420px modal; wrap and measure, not
  a nominal-width claim.
- **Agent-created vocabulary** is deliberately bounded: `create` is an explicit
  tool op with the same caps; no free-form auto-creation from a model reply.
- **TUI opt-in** default off preserves the "never force chips" rule; a later
  parity slice can add grouping if the operator asks.
- **Cross-surface** mobile write semantics (offline, retry) belong to the mobile
  lane; this plan only guarantees the contract and the single store.

## 10. Slice exit

V2-1 and V2-2 are independent UI slices; V2-3 is core+UI; V2-4 is core+TUI+
contract. Each is review/QA/design/UX gated and handed to the window owner.
LOH-11 is not "complete" until the operator accepts these five items; the
original chips and drag items are now part of V2-1 (drag) and a later chip
slice, not silently dropped.
