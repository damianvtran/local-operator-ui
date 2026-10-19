# LOH-11 v2 — drag, auto-tagging, better creation, agents, one vocabulary

**PROPOSED, not implemented.** 2026-10-18. Follows the merged first slice
(`sidebar-tags.md`, `sidebar-tags-flows.md`; UI #1177, core #2600). This document
is the operator-feedback plan: it updates the interaction contract and the slice
order before any v2 code.

Designer/manager baseline: `origin/main` after #1177 (`0c8a39a0e3`). The first
slice's measured geometry and off/on/tag-group contract remain authoritative;
v2 changes only the five areas below. It also records one shipped pinned-drag
defect found while planning V2-1 and fixes it in that slice rather than building
on it.

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
| **V2-1 Drag + remove-all** | Click-hold row drag, visible tag-header/Untagged drops, primary rule, preview/autoscroll/cancel/undo, keyboard move, context-menu `Remove all tags (N)`, the grouped pinned-drag slot fix, and an additive conditional-assignment precondition for guarded undo | Highest-frequency interaction; the conditional write is needed by both drag undo and V2-3's auto-tag precedence. |
| **V2-2 Tag creation UX** | Searchable multi-select combobox with chips, immediate inline create, dedupe/rename, keyboard-first, viewport-capped 420px; before/after frames | Reuses the same assignment API; independent of drag and auto-tagging. |
| **V2-3 Auto-tagging** | Fork naming response returns tags in the existing call; stable tag prefix + tag-set hash; View-options toggle; accepted-sample-only parse; manual-edit precedence | Core prompt work; uses V2-1's conditional write for precedence. |
| **V2-4 Agents + surfaces** | `tags` agent tool (list/create/rename/assign), mobile relay read+assign contract, TUI primary-tag rendering behind its own opt-in | Needs the stable API; the mobile lane consumes the contract without duplicating the store. |

Each slice is one PR (or one core + one UI PR where the wire changes), with
affected tests, i18n, rendered evidence, independent review, QA, and design/UX
rounds where the surface changes. No version bump; each merge is handed to the
release window owner.

## 3. Drag and drop

### 3.1 Gesture state machine

- **Click-and-hold anywhere on a conversation row** starts a drag candidate.
  Arm threshold: **hold reaches 180 ms with ≤5 px movement** (the same shape as
  the board's `armed` distinction). Both numbers are named constants consulted
  by one pure predicate, not scattered `if`s. A press on an interactive
  descendant (pin grip, menu trigger, chip, link) keeps that control's own
  gesture; click-hold arming does not start from it.
- The pointer sequence is a small state machine, not two independent guesses:

| State | Event | Result |
|---|---|---|
| pending | pointer moves >5 px before 180 ms | cancel the candidate; this is a scroll/selection, never a click and never a drag |
| pending | released before the hold reaches 180 ms, ≤5 px | ordinary click: open the conversation |
| pending | hold reaches 180 ms at ≤5 px | **armed**; capture the pointer |
| armed | pointer moves | drag; preview updates; the completing click is suppressed |
| armed | released on an eligible target | drop; one assignment write |
| armed | released elsewhere, Escape, pointercancel, window blur | cancel with no write; no click |

- Once armed, suppress the click that would otherwise open the row for that
  pointer sequence. A release after a drag must not also open the conversation.
- **Pinned rows keep the existing grip and its behaviour.** The grip remains
  the explicit affordance and starts the existing reorder gesture. Click-hold
  on the pinned row body starts the row drag: over the dragged row's own
  bucket it uses that same reorder model (not a second one), and over an
  eligible tag header it assigns. The gesture keeps its insertion indicator,
  Escape behaviour and one-row guard; its slot arithmetic is bucket-scoped as
  described next, so it is not identical to the flat case.
- **Pinned reorder defect to fix in V2-1, and the correct algorithm.** The
  shipped `pinDragRowBoxes` reads grouped DOM order while `movePinnedOrderTo`
  receives the flat stored order; `pinDragSlot` is an order-independent
  midpoint count, so swapping the ids does not repair it. With tag headers,
  the visual Pinned order is bucket-concatenated, not the stored order. V2-1
  scopes the grip/body reorder to the dragged row's **own bucket**: derive the
  bucket id with the same rule `groupChatsByTag` uses — the row's `primary`
  only when it is non-null, present in the category registry, and present in
  the row's `tags`; otherwise `untagged` — then filter the measured row boxes
  to that bucket's ids and pass those ids as `shownIds` to
  `movePinnedOrderTo` (which already steps through the drawn neighbours while
  preserving hidden ids). A drop on a different tag header is an assignment,
  not a reorder; a drop on another bucket's rows is not a reorder target. The
  write moves the row among that bucket's base-order positions and preserves
  every other row's relative order. With tags off or no headers, the bucket is
  the whole Pinned section and the existing flat behaviour is unchanged.
  Regression tests: visual no-op writes nothing; each direction with ≥2
  occupied buckets; a cross-bucket drop assigns and does not reorder.
- Pointer events + `setPointerCapture`, not HTML5 drag: the row must not enter
  the OS drag loop, the drop target is geometry this repository can measure,
  and a committed frame can show the preview. This is the pinned drag's own
  reason and it applies unchanged.
- Touch: the same hold threshold; a vertical scroll that starts before the
  hold threshold is a scroll, not a drag. Do not set `touch-action: none` on
  the whole row; only the armed gesture claims the pointer.

### 3.2 Targets and the primary rule

- **Eligible contexts** for tag drops: tags enabled, `groupBy === "section"`,
  no search/filter active, and the row's section draws tag headers. This
  includes the Pinned section: the shipped Pinned section groups by tags
  (`taggedRows(orderedPinned)`), so Pinned headers are valid assignment
  targets. Agent/team and Flat modes have no tag headers and no pinned
  section, so neither the grip nor the pinned row-body reorder exists there.
- **Visible occupied tag header (28px)** — the whole header is the target.
  Dropping there adds that category if absent and makes it **primary**; other
  assigned tags stay. The row appears in exactly one bucket: its primary. If
  the tag is already primary, the drop is a no-op with no write.
- **Empty categories are not drag targets.** A category with no conversations
  in this section has no header, and the plan does not create one mid-gesture:
  inserting headers under a captured pointer would move the rows the user is
  aiming at. Assign an empty category through `Move to tag…` or the picker.
- **Visible Untagged header** — removes every assigned tag and clears primary.
  It exists only in a mixed section, which is exactly the section that has a
  tagged row to clear. An all-tagged section has no Untagged header, so a drag
  there cannot clear; use `Remove all tags (N)` or `Move to tag… → Untagged`.
  A fully untagged section has no header and needs none.
- **Only a target in the row's own existing section is eligible.** Pinned/
  Running/Today/This week/Older membership is authoritative; drag does not
  pin, unpin, run, archive, or move a row between time sections. An ineligible
  header does not highlight. This is the rule that prevents a "silent second
  group".
- **Grip/pinned reorder** keeps its insertion indicator and one-row guard;
  its slot arithmetic is bucket-scoped as described above. Tag-header drops
  show a header highlight (accent-wash + accent outline) rather than a row
  insertion line, because they assign rather than reorder.
- **No arbitrary row order inside a tag group**: the group's order is the
  existing sort. "Reorder feedback" is the pinned gesture's insertion line plus
  the tag header's highlight; after a tag change the row re-sorts by the
  existing rule. If a later slice wants manual order inside a group, it needs
  its own stored order and is out of scope here.

### 3.3 Preview, optimistic write, autoscroll, cancel, undo

- A drag also starts from a **long list**: autoscroll the owning list scroller
  (not the page) in a 32 px edge zone, 12 px per frame, with the same constants
  as pinned drag. Stop on cancel/settle.
- A successful drop goes through the shipped optimistic assignment path: the
  row may re-bucket immediately, the request settles it, and a failure restores
  the prior tags/primary and shows the error. There is no ghost bucket; there
  is also no claim that the row is frozen until the response.
- `Escape`, `pointercancel`, window blur, or a pointer released outside all
  eligible targets cancels with **no write** and clears the preview.
- Success shows an undo toast: `Moved to “Review”` / `Removed all tags` +
  `Undo`. **Undo is guarded by a per-session revision.** V2-1 adds an opaque
  `tags_revision` to the store and catalogue/assignment responses and an
  optional `expected_revision` to the assignment route. Undo captures the
  revision its write returned; a 409 `tags_conflict` means any later write
  changed the row, even if the tag values were returned to the same list, so
  the client refreshes and does not overwrite it. A 409 is a visible "Tags
  changed elsewhere", not a silent retry. Clients that omit
  `expected_revision` keep the shipped last-writer-wins behaviour; mobile may
  omit it in its first slice.
- **Failure**: the existing rollback restores the prior bucket/primary and the
  error names the action; a retry is the normal assignment retry, never a
  second drag.
- **Keyboard equivalent**: the row menu gets `Move to tag…`, which opens the
  picker in a compact move mode with the categories and Untagged; choosing one
  performs the same assignment and focus returns to the row. This is the WCAG
  single-pointer/keyboard path; drag is never the only route. The existing
  `Move up/down` pinned items remain.

### 3.4 Geometry / acceptance

- 220 px sidebar: row 32 px; tag header 28 px; header target full width; no
  horizontal overflow, no row indentation, no title change from the drag
  preview itself. The drop may optimistically re-bucket the row; failure
  restores the prior position. Header highlight visible in both themes and not
  clipped.
- Chips are a later slice; the drag must still set the **no chip swap during
  drag** latch now: while a row drag is armed or settling, the row's chip
  hover/focus/menu state is suppressed, so a future chip implementation cannot
  enter a swap mid-drag. Test the latch even though v2-1 draws no chips.
- Click/drag discrimination: the state table in §3.1 is the acceptance table.
  Both ordinary click and armed drag are tested in the real renderer, including
  a move before the hold threshold (scroll, no open) and a release after a
  drag (no open).

## 4. `Remove all tags` in the row menu

- One item, only when the row has ≥1 tag: `Remove all tags (N)` where **N is
  the count of distinct assigned tags**, not conversations. For a multi-tag
  row this clears all N and primary in one atomic assignment.
- `Move to tag…` is the second new item; `Tags…` already ships. The shipped
  menu mounts **up to eight** rows on a pinned row (Archive, Pin, Fork, Copy
  session id, Rename, Tags, then the conditional Move up/down pair) and six on
  a non-pinned row. V2-1 adds
  `Move to tag…` to every row and `Remove all tags (N)` to every tagged row:
  the widest state is a **pinned, tagged row at 10 rows** (two over the cap);
  a non-pinned tagged row is 8, a pinned untagged row 9, a non-pinned untagged
  row 7. The count does not vary with the number of tags; N varies. The shipped
  menu is `overflow-hidden` with no scroll, so V2-1 changes it to a max-height
  scroll container with the existing 32 px targets, never a clipped or
  unreachable item. The alternative — dropping `Remove all tags` or the
  keyboard move — would fail the operator's request or WCAG. The menu test
  pins presence, order, conditional count and scroll reach at 220 px and a
  short viewport.
- The actions are disabled while a picker is open on that row. Success offers
  guarded Undo; failure leaves the row unchanged and shows the assignment
  error.
- A multi-tag row is the acceptance case; a single-tag row must not show a
  misleading plural count.

## 5. Auto-tagging in the fork / naming call

### 5.1 Same call, accepted sample only

The title call in `local_operator/session/naming.py`
(`generate_title_acceptance`) is a bounded, tools-free model call on the fork's
opening context. Tags ride that call; they do **not** add a tag-specific
provider request:

- The system prefix gains an optional `<available-tags hash="…">` block
  (canonical `id: name` list in display order) and the output contract:
  ```
  <title>Fix the parser</title>
  <tags>a1b2c3d4e5,f6e5d4c3b2</tags>
  ```
  The existing `<title>` contract is unchanged. The model may return ids or
  exact case-insensitive names; ids are preferred. Only the caller that
  supplies tags gets the block.
- **Extract the trailing `<tags>` block, then parse the title.** The block is
  recognised only after the closing `</title>` (same-line or newline) or as
  the final block; a `<tags>` string inside a title body is not stripped — it
  is title text, and the existing angle-bracket gate rejects it as before.
  Remove the recognised block before `parse_title` sees the response.
- **The corrective addendum is tag-gated too.** `_accept_generated_title` takes
  an optional `tag_contract`; the system prefix gets `<available-tags>` only
  when it is set, and the corrective addendum uses a tag-bearing variant only
  when it is set. `generate_retitle` passes `None`, so its prompt (and the
  title-only corrective addendum) stays byte-identical. Tests cover both
  variants; do not append the tag contract unconditionally.

  The shipped title gate bans angle brackets; a same-line tag block makes the
  title parser return markup and the title is lost if this order is wrong.
  Tests cover same-line and newline forms, a truncated tags block (no
  assignment, title still accepted), and a stray `<tags>` inside a title.
- **Accepted sample only.** The title cascade can make up to two samples (and
  up to two fit checks, plus its existing auth retry). Tags from a rejected
  first sample are discarded; tags are written only from the same response
  whose title is accepted. If no title is accepted, no tags are written. The
  corrective addendum's tag variant carries the tag contract only when the
  caller supplied `tag_contract`; otherwise the existing addendum is byte-
  identical.
- "No tag-specific extra call" is the acceptance claim, not "one provider
  call": compare call count with and without tags on the same fork; the delta
  must be 0. The existing title cascade's bounded calls remain.
- Parse and validate: ids or exact case-insensitive names only, dedupe, retain
  caller order, cap 8, ignore unknowns. Invalid/empty output means **no
  assignment**, not an error and not category creation. The title is still
  accepted if tags are invalid; tags failing never discards the title.

### 5.2 Fork intent and manual-edit precedence

- On the first substantive turn of a desktop fork with auto-tag enabled and a
  non-empty category registry, the naming caller may write `set_entity_tags`
  with the first returned tag as primary.
- The desktop UI sends `auto_tag` on the fork request (`tagsEnabled &&
  autoTagForks`, default true). `Fork` gains `auto_tag: bool = False`; after
  the fork returns the child id, the desktop route writes an `auto-tag.json`
  sidecar into the child session directory only when true. The sidecar carries
  the child's **fork-time `tags_revision`** as well as the enable bit: this is
  the eligibility snapshot, not a value read later at naming time. The
  shared-slash fork payload remains `{entry_id}`-only; TUI direct forks and
  peer/shared-slash forks do not acquire the sidecar. The naming
  worker reads the sidecar; a missing sidecar means off. The View-options
  toggle is captured at fork time: changing it later does not change an
  existing fork's intent, and no existing fork sidecar is repurposed.
- **Scope:** only the desktop UI fork path carries `auto_tag` in V2-3. The
  TUI's direct `fork_session` call and the peer/shared-slash fork route default
  it to false; they do not acquire the sidecar. A later surface that wants
  auto-tagging must pass the flag explicitly.
- **Manual edits win, including add-then-clear before the first turn.** At
  fork creation, the sidecar records the child's fork-time `tags_revision`
  (a new/empty child has the store's stable zero revision). The auto-tag write
  is conditional on that recorded revision, not on a snapshot taken when the
  naming call starts: a human who tags and then clears the fork before its
  first substantive turn has still edited the row, so the revision differs
  from the fork-time value and auto-tag skips. If the child already has tags at
  fork time, auto-tag never runs. If the user clears auto-assigned tags later,
  auto-tag does not run again for that fork.
- **Registry drift:** validate against the live registry at write time; a
  category deleted during the call is dropped, and if none survive there is no
  assignment. No category is created from model output.
- **Visible correction path:** the assigned tags appear in the row and in
  `Tags…`; changing or clearing them there is the correction route. Auto-tag
  does not own the tags afterwards and does not reassert them. (The naming
  worker runs in the background; a toast is not guaranteed to be seen, so the
  persisted row is the receipt.)
- If tags are empty or auto-tag is off, the naming prompt is **byte-identical
  to today** and no tag work occurs. The title call still runs; "no tag call"
  never means "no title call".

### 5.3 Stable prefix, hash, and the cache-key boundary

- The tag block is a stable prefix: same category set/order → identical bytes;
  the conversation excerpt stays after it. `tag_set_hash` is SHA-256 over the
  canonical `[{id,name}]` order.
- A newly added tag changes the hash and therefore the tag-enabled prefix;
  title-only callers keep their existing prefix. No global invalidation and no
  per-call prefix churn. Tests: byte-identical prompt for the same set, hash
  change on add/rename/reorder, title-only prompt unchanged, unknown/invalid
  output assigns nothing, empty registry makes no tag block and no write.
- **No provider cache key is claimed.** The shipped naming errand carries no
  `prompt_cache_key`, `complete_once` takes no key, and `isolated=True`
  deliberately keeps the errand off the session's cache namespace. Adding a
  provider key would touch account-affinity/correlation and errand isolation;
  it is not part of V2-3. The operator's stable-prefix requirement is met and
  tested at the prompt bytes; provider cache hit rate is **not** measured or
  promised here. If a provider-level key is required, that is a separate
  change with its own review.

### 5.4 Setting

- View options Tags group gains `Auto-tag forked sessions` (default **on**),
  persisted with the sidebar view. It is visible only when tags are enabled;
  turning tags off never runs auto-tagging. The toggle does not create a
  second call when tags are empty.
- The added row/line is part of the View-options height budget. Tags group,
  `Auto-tag forked sessions`, and the existing Sections controls share ONE
  scroller; there is no nested scroll. At 220/260 px and in a short viewport,
  wrapped Sections controls still leave the panel scrollable and the last
  action reachable; measured, not estimated.
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

Proposed picker (420px nominal; `min(420px, viewport - 32px)` actual):

- A combobox input with selected tags as removable chips; the primary chip
  carries a leading dot and an accessible "Primary" description, not a colour.
- Typing filters the list and resets the active option to the first match.
  `ArrowDown`/`ArrowUp` (plus Home/End) move the active option (`aria-
  activedescendant`); `Enter` toggles it. **`Space` toggles only when focus is
  on an option row** (Tab into the list / roving tabindex); with focus in the
  input, `Space` types a space, so multi-word names remain typeable. `Backspace`
  on an empty query removes the last chip; `Delete` on a focused chip removes it
  and returns focus to the input; `Escape` closes the listbox first and a
  second Escape cancels the dialog. Every removal/selection is announced.
- Focus order: input → selected chips (Tab/Shift+Tab) → option list → Create
  row when present → Group under radios → Cancel/Apply. Removing a chip returns
  focus to the input; applying returns focus to the row. The dialog traps focus
  and restores the trigger on close.
- `Create “query”` is the last row only when no exact (case-insensitive) match
  exists. Selecting an existing tag never creates a duplicate. **Activating
  Create writes the category immediately** (durable, shared with all
  conversations) and selects it; Cancel closes without assigning but does not
  undo the created category. The helper says `Create “X” — saved for all
  conversations` so this is not a surprise. No duplicate is created by typing
  the same name in another case.
- Inline chips show full labels; long labels truncate inside the chip with the
  full name in the title/accessible description, never the title column. The
  chip row wraps within the dialog; no horizontal scroll. The dialog's body
  scrolls at a short viewport and the footer stays pinned.
- `Group under` remains a compact row of radio choices among the selected
  tags, shown only with ≥2 selected; one selected tag is statically primary;
  zero previews `Untagged`.
- Footer: Cancel / Apply. Apply commits one assignment; Cancel never assigns.
- Manage dialog: searchable ordered list, inline rename with duplicate
  validation, add, up/down, delete with count and primary consequence. No
  colour/role in this slice; no new dependency.
- **Keyboard-first acceptance:** open focus in the input, the focus order
  above, Escape semantics above, Apply commits one assignment, focus returns
  to the row.
- Before/after frames: sidebar 220/260/320 light/dark for the entry point, and
  the dialog at 420px plus a short/narrow viewport; empty, long/Unicode names,
  no matches, inline create, primary, error and loading. Cap is 32 categories,
  so the density matrix is 0/1/32, not 50.

## 7. Agents and one vocabulary across surfaces

### 7.1 Agent tool (V2-4 target — not shipped)

Add one `tags` tool (not a fourth spelling on `sessions`):

- `list` → categories with ids, names, order, conversation counts.
- `create(name)` → one category; duplicate/case/blank/reserved names refused
  with the known list; no silent partial.
- `rename(id, name)` → id and assignments preserved; no reassignment.
- `assign(session_id, tags[], primary?)` → the same validation as the shipped
  `sessions spawn tags`: **category names only**, exact case-insensitive,
  deduped, ≤8, primary in tags, atomic; empty list clears. Ids are returned by
  `list` for display/diagnostics, not accepted as a second assign spelling.
  Delegated/hidden sessions are taggable; mesh/remote target is refused with
  the route's 409 `session_is_remote`.
- Every result names the names and the session, so the tool ledger is the
  audit trail. No model-created vocabulary: `create` is the only creation
  path. A misspelling is refused, never auto-created.
- Prompt guidance: "use `tags` to list/create/assign; never spell a category
  the store does not contain; assign after creating." Budget the tool doc and
  update the token ledger deliberately.
- The tool is **not present today**; the merged capability is only
  `sessions(op='spawn', tags=[...])`. V2-4 adds the tool and its tests.

### 7.2 The contract other surfaces consume

`docs/design/sidebar-tags-api.md` is the client-facing contract. The
capability is `GET /v1/capabilities` → `result.features.session_tags` (the
shipped route is not under `/v1/desktop`). It also covers catalogue
`tags`/`primary`, `GET/PUT /v1/desktop/tags`, `PUT
/v1/desktop/sessions/{id}/tags`, the optional `expected_revision`
precondition, 409 `session_is_remote`/`tags_conflict`, validation and the rule
that clients render the store response rather than caching a second category
copy. Mobile and TUI lanes read this document; they do not reimplement the
store.

### 7.3 TUI session list

TUI parity is a **read-only render plus its own opt-in**, not a second
assignment surface:

- `CatalogEntry` **will gain** the same `tags`/`primary` projection in V2-4;
  it does not carry them today.
- A TUI setting, `/tags on|off` (default **off**), shows the primary tag as a
  compact `#Tag` suffix in the row when it fits; no grouping, no chips, no
  assignment in this slice. At narrow widths the suffix sheds before the title
  (same rule as other status marks).
- The full tag list is available to the row's detail/agent context; the TUI
  never invents a category or writes through a second store.
- Desktop/mobile/TUI all show the same assignments after the next catalogue
  read; the store remains the only writer.

### 7.4 Mobile

Separate lane, owner session `4264c9a75553`. Mobile read/write goes through
the **mobile relay**, not `/v1/desktop/*`:

- read: `GET /api/sessions` and the `sessions` SSE rows with
  `tags: [{id,name}]` and `primary: string|null`, always present, assignment
  order preserved; `GET /api/tags` read-only catalogue;
- write: `PUT /api/sessions/{id}/tags` desired-state, empty+null clears;
- capability: `capabilities.session_tags: {available: true}` on the mobile
  list frame, not the lifted `features.session_tags` (released relays can have
  the store flag without the routes);
- no `PUT /api/tags` on mobile: creation/rename stays desktop/agent-only;
- remote/mesh rows `tags: []`, `primary: null`, assignment refused;
- external writes (desktop, TUI, agent, auto-tag) are picked up by the relay's
  tag-store fingerprint on its existing 2 s scan tick, so V2-3 introduces no
  extra mobile call;
- no client-side category database, no local ID generation, no offline name
  authority. The mobile lane's PR must state which of these it uses and must
  not duplicate the store. Its additive global `tags/revision` marker is
  relay-internal and is not the desktop per-session `tags_revision`; it does
  not change the desktop contract or `session_tags` semantics.

## 8. Acceptance / evidence for each slice

- V2-1: before/after drag frames (pending, armed, hover occupied header,
  highlighted Untagged, cancelled, optimistic settled, undo toast) at
  220/260/320 light/dark; the §3.1 click-vs-drag table executed in the real
  renderer; pinned reorder regression at ≥2 occupied Pinned buckets (visual
  no-op writes nothing; each direction per bucket correct; cross-bucket drop
  assigns); `tags_revision` in catalogue and assignment responses; Undo
  conflict after an add-then-clear (409 leaves newer tags intact); `Remove all
  tags (N)` on a multi-tag row; menu widest state 10 rows with scroll/reach at
  220 and short viewport; optimistic rollback on failure.
- V2-2: before/after picker and Manage frames at the full matrix; the §6
  keyboard table executed; immediate Create + Cancel persistence; duplicate/
  empty/Unicode/long/error states; dialog at short viewport with pinned footer
  and a visible focus ring; Tags helper on/off and font-scale variants; content
  height vs client height recorded; 0/1/32 category density.
- V2-3: prompt byte/hash tests; no tag-specific extra call (delta 0 vs the same
  fork without tags; existing title cascade allowed); same-line/newline/
  truncated tag parse; tags only from the accepted sample; invalid/empty output
  assigns nothing; tag-gated corrective addendum; manual-edit precedence by
  fork-time revision including pre-naming add-then-clear; apply-once; registry
  drift; fork auto-tag real-path proof; setting persistence; no-tags/off
  byte-identical prompt; title still runs.
- V2-4: tool tests (names-only assign, duplicate/unknown/remote 409) and a real
  agent call; TUI frames on/off/narrow; API contract review with the mobile
  owner (session `4264c9a75553`); no second store; full CI terminally.

## 9. Risks / open decisions carried into implementation

- **Drag vs open** is the highest-risk interaction: threshold, pointer capture,
  scroll, touch, pinned grip and optimistic rollback coexist. Prove on the real
  renderer, not only Storybook; a click that opens after a drag is a release
  blocker. The grouped pinned-drag slot fix is part of the same slice because
  the first slice's grouping exposed it.
- **Conditional assignment** is a new optional wire field plus a per-session
  revision in the store. It is additive and backward compatible, but it must be
  tested for 409 after an add-then-clear (value returned to the same list),
  atomicity, and the post-write re-read that can legitimately return
  `tags: []`/`primary: null`
  after a concurrent category deletion. Clients render that as a settled empty
  row, not a failed write.
- **Auto-tagging prompt drift** is a title-quality risk: the tag block must be
  optional and byte-identical when off; tags are parsed before the title and
  only from the accepted sample; invalid tags never affect the title. A model
  that returns a tag id embedded in a title sentence is a parse test, not a new
  heuristic.
- **No provider cache key** is a deliberate boundary, not an oversight: the
  naming errand is isolated and has no key seam; stable prefix/hash is what this
  slice can prove. A provider-key change needs its own review of isolation and
  correlation.
- **Menu height**: adding two items to an `overflow-hidden` menu whose widest
  shipped state is eight rows (ten with the additions) is a real clipping risk;
  the scroll container and short-viewport test are part of V2-1, not polish.
- **Combobox chips at narrow widths**: the picker is a viewport-capped modal,
  not a 220px surface; chips wrap inside it and the sidebar width only affects
  the entry point. Measure the 420px and short/narrow viewport, not a nominal
  220px modal.
- **Agent-created vocabulary** is deliberately bounded: `create` is an explicit
  tool op with the same caps; no free-form auto-creation from a model reply.
- **TUI opt-in** default off preserves the "never force chips" rule; a later
  parity slice can add grouping if the operator asks.
- **Cross-surface** mobile write semantics (offline, retry) belong to the mobile
  lane; this plan guarantees the contract and the single store, not its offline
  behaviour.

## 10. Slice exit

V2-1 is core+UI (`tags_revision`/`expected_revision` and the grouped
pinned-drag fix), V2-2 is UI, V2-3 is core+UI, V2-4 is core+TUI+docs. Each is
review/QA/design/UX gated and handed to the window owner. LOH-11 is not
"complete" until the operator accepts these five items; chips remain a
separate, later slice (v2-1 only sets the no-swap-during-drag latch), not
silently dropped.
