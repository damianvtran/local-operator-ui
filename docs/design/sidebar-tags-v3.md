# Sidebar tags v3 — tagging where the user already is

**PROPOSED, not implemented.** 2026-10-21. Baseline: `origin/main` `48985d5025`.
Operator request (verbatim, 2026-10-21): *"review the tagging UX in the local
operator UI, it's currently quite janky and feels like a lot of steps to add
tags … leave the subheaders and drag and drop to tag/untag but make adding and
managing tags easier and meet the user generally where they are instead of
requiring full screen dialogs"*.

Supersedes, where they conflict: `sidebar-tags.md` §4–5 and
`sidebar-tags-flows.md` §2.5 ("Picker and Manage tags are viewport-bounded
**modal dialogs**"), and `sidebar-tags-v2.md` §6 (picker as a 420px modal) and
§3.2 ("empty categories are not drag targets"). Everything else in those
documents stands: optional/off-by-default, neutral names (no colour), one row =
one bucket, primary-tag semantics, the drag state machine (§3.1), the wire
contract in `sidebar-tags-api.md`.

## 0. How this was derived (and what was not)

- **Rendered:** Storybook `chat-sidebar-tags--*` stories from `origin/main`, own
  worktree, harness `browser` tool, frames in
  [`assets/sidebar-tags-v3/`](assets/sidebar-tags-v3/) (not `docs/evidence/`: its
  `*.png` is git-ignored and `check-evidence-structure` refuses committed
  frames; `docs/design/assets/` is the existing home for design-doc images).
  Frames: `before-groups-{220,260}-dark`, `before-row-menu-260-dark`,
  `before-row-tags-dialog-{260-dark,220-light}`, `before-manage-dialog-260-dark`,
  `before-move-dialog-260-dark`, `before-view-options-220-dark`.
- **Honest limit on "seen":** of those frames I looked at the rendered Manage
  dialog and the row menu (`Tags…` / `Remove all tags (2)` / `Move to tag…`
  stacked under Rename, nine rows, two disabled). The other frames were
  captured but my viewer returned them without pixels, and the operator's two
  screenshots likewise; claims about the View-options row therefore rest on the
  operator's description plus code (`chat-sidebar-view-menu.tsx` L351–367: label,
  `Switch`, ghost `Button`, in one `h-[39px]` flex row; the story asserts the
  Manage button is one line and the group is 40px) — not on my own reading of
  that frame. A reviewer should look at `before-view-options-220-dark.png`.
- **Measured:** tag group header = `div.flex.h-7.px-2.text-meta` **195 × 28 px**
  at the 220px sidebar (browser `styles` on `chat-sidebar-tags--narrow-220`),
  12px / 17.4px line-height. Contrast pairs from `localOperatorDark/Light` in
  `themes.generated.css` through `design-qa/scripts/contrast_pairs.py` (§8).
- **Derived from code, not stopwatch:** step counts (§2) from
  `use-chat-tag-assignment.ts`, `manage-tags-dialog.tsx`,
  `chat-session-tags-dialog.tsx`, `chat-sidebar.tsx` and the stories' `play`
  functions.
- **Not run:** `dom_audit.mjs` (no v3 DOM exists to audit), `copy_scan.py`
  (copy below is a draft). `token_audit.py` over the three dialog files: 0
  anomalies, meaningless for a spec. Other 57 themes are unmeasured; v3 adds no
  colour role (§8).

## 1. What is wrong today (before)

| # | Finding | Evidence |
|---|---|---|
| P1 | **Every tag act is a modal.** Assign, create, rename, delete, reorder, move: each opens a `Dialog` that blocks the list the user is trying to organise. | `chat-session-tags-dialog.tsx` 413 lines, `manage-tags-dialog.tsx` 507, mounted `chat-sidebar.tsx` ~L9732–9750 |
| P2 | **Manage swaps the picker out.** From a chat's `Tags…`, `Manage tags…` closes it and opens a second dialog; the chat context is lost. | `chat-session-tags-dialog.tsx` ~L385 |
| P3 | **Management lives in the wrong place.** You rename a tag you can see in the list by leaving the list: View options → Manage tags… → Rename. | `onManageTags` ~L9888 |
| P4 | **View options row is cramped:** label + switch + a text button sharing one 39px row at 220px. | operator frame 1 + code above |
| P5 | **Three row-menu items for one idea** (`Tags…`, `Remove all tags (n)`, `Move to tag…`), two opening different dialogs; the menu is already nine rows and scrolls. | `before-row-menu-260-dark.png`, `chat-sidebar.tsx` ~L6433–6480 |
| P6 | **Create cannot be finished from the keyboard.** Enter on an unmatched query never mutates by design (`tag-picker-combobox.tsx` header comment), so a new tag needs a mouse click on the Create row. | same |
| P7 | **Nothing teaches the feature.** Grouping on with no tags: the list is identical to grouping off; a sr-only sentence names the only entry point. Tags with zero chats have no header at all (`groupChatsByTag` emits only occupied buckets), so after v2 drag they are reachable *only* through a dialog. | `chat-tag-groups.ts` L13–36; `ui.chat.tags.discovery` |
| P8 | **"Primary" / "Group under" is a concept the user has to learn** before they can tag (radio group when ≥2 selected). | `before-row-tags-dialog-260-dark.png` |

Note on semantics: per-tag toggles in the picker **already write immediately**
(`useChatTagAssignment` header: "there is no staged draft"); the older
Apply/Cancel language in `sidebar-tags.md` is dead. v3 therefore changes the
*surface*, not the write model — which keeps the optimistic store, revision
precondition, and rollback exactly as shipped.

## 2. Steps before / after

A **step** = one click, chord, or Enter/Esc. **T** = typing the name (counted
once, same before and after). A modal's mandatory *Close* is a step; dismissing
a non-modal popover is not (the next action dismisses it). Derived from code,
not timed.

| Task | Before (mouse) | After (mouse) | After (keyboard, row focused) |
|---|---|---|---|
| Add an existing tag to a chat | right-click, `Tags…`, click tag, **Close** = **4** | right-click, `Tags…`, click tag = **3** | `⌘⇧L`, (T), Enter = **2 + T** |
| Create a new tag and apply it | right-click, `Tags…`, T, click `Create “x”`, **Close** = **4 + T** | right-click, `Tags…`, T, Enter = **3 + T** | `⌘⇧L`, T, Enter = **2 + T** |
| Rename a tag | View options, `Manage tags…`, `Rename`, T, `Save`, **Close** = **5 + T** | double-click header, T, Enter = **2 + T** (unused tag: +1 to expand footer) | focus header, `F2`, T, Enter |
| Delete a tag | View options, `Manage`, `Delete`, confirm, **Close** = **5** | `⋯`, `Delete`, confirm = **3** (tag with 0 chats: **2**, no confirm) | focus header, `Shift+F10`, `Delete`, confirm |
| Reorder a tag by k places | View options, `Manage`, k × chevron, **Close** = **3 + k** | k × (`⋯`, `Move up`) = **2k** ⚠ | focus header, k × `Alt+↑` = **1 + k** |
| Remove one tag from a chat | right-click, `Tags…`, click tag, **Close** = **4** | right-click, `Tags…`, click tag = **3** | `⌘⇧L`, arrow to tag, Enter |
| Remove all tags from a chat | right-click, `Remove all tags (n)` = **2** | **2** (item kept — see D4) | `Shift+F10`, item |
| Make tag X the group a chat sits under (non-drag) | right-click, `Move to tag…`, click tag = **3** | right-click, `Tags…`, click tag, `Show under` = **4** ⚠ | `⌘⇧L`, `⇧Enter` on tag = **2** |
| First-ever use: grouping on, one tag, one chat tagged | View options, switch, `Manage tags…`, T, `Add`, **Close**, right-click, `Tags…`, click tag, **Close** = **9 + T** | View options, switch, right-click, `Tags…`, T, Enter = **5 + T** (create-and-assign in one) | — |
| Drag a chat onto a tag | unchanged (1 gesture) | unchanged; also onto *unused* tags (§4.3) | armed-move equivalent unchanged |

⚠ = a deliberate regression, named so nobody finds it later: mouse-only
reorder of a tag by many places, and the non-drag "make this the group" act,
cost more than today. Reorder is rare and the keyboard path is cheaper; "make
primary" is the long tail of a concept v3 mostly hides (D5), and drag stays the
fast route. Both are listed as open questions (§11).

## 3. Research

Patterns checked 2026-10-21; I take interaction shape, not any product's
chrome or colour.

- **Gmail "Label as"** — a labels *menu* of checkable items with search and
  `Create new`, applying to the selected conversation; `L` opens it (8apps
  Gmail guide, https://www.8apps.co/guides/accelerator-keys/gmail-shortcuts/how-to-open-label-as-menu).
  Multi-toggle without leaving the surface, opened from where the item is.
- **Linear labels** — apply a label from the issue, type a name that does not
  exist and *create it in the same flow*; creation in Settings is the second
  door, not the first (https://linear.app/docs/labels, snippet: "Create a label
  during add label workflow… type the name of the label you want to create").
  The `L` shortcut is from the operator's brief; I did not independently verify
  it on a Linear page.
- **Notion multi-select** — type in the cell, Enter adds (or creates) the
  option directly from the cell; options edited in the property menu
  (secondary source: https://wisechecker.com/add-multi-select-property-options-notion/).
- **Slack sidebar sections** — the closest structural match: *the section
  header is the management surface*. Select a custom section name → `⋯` →
  **Rename** or **Delete section**; remove an item from a section from the item
  (https://slack.com/help/articles/360043207674-Organize-your-sidebar-with-custom-sections,
  fetched).
- **macOS Finder tags** — tags live in the sidebar, drag a file onto a tag to
  assign it; `Control-1…7` add/remove favourite tags, `Control-0` clears; but
  *editing* tags is a separate Settings pane, which is exactly the "leave the
  place you are" pattern the operator rejects
  (https://support.apple.com/guide/mac-help/tag-files-and-folders-mchlp15236/mac,
  fetched; drag-to-sidebar-tag from TidBITS 2013).
- **Todoist** — `%` inside the task field adds/creates a label inline
  (https://www.todoist.com/help/todoist/features/introduction-to-labels-dSo2eE,
  search snippet). Context for the existing composer `/tag` row (§9), not a new
  surface.
- **W3C APG, Menu pattern** (fetched): a menu is *a list of actions*; `Space`
  on a `menuitemcheckbox` is an *optional* toggle-without-closing; Tab does not
  move focus among items. Nothing in it describes a text field inside a menu.

Not researched (named so the gap is visible): GitHub labels, Things.

**What this does to the candidate "submenu with a type-to-filter field".
Rejected, for two measured reasons, not taste:**

1. Radix `MenuContent` answers every printable key inside it with typeahead
   (`@radix-ui/react-menu@2.1.24` `dist/index.mjs` L309–314: `if (!isModifierKey
   && isCharacterKey) handleTypeaheadSearch(event.key)`), which moves focus off
   a field onto a matching item. This repo already hit and documented exactly
   this: `chat-header-identity-menu.tsx`'s header comment ("a search field
   inside a menu is a field the menu keeps taking the cursor out of… `role=menu`
   with a text box in it is also not a thing ARIA describes") and moved that
   picker to a **Popover + the app's own combobox**.
2. `ui/context-menu.tsx` exports no `Sub`/`CheckboxItem` (it exports Root,
   Trigger, Portal, Group, RadioGroup, Content, Item); `dropdown-menu.tsx`
   does. A context-menu submenu would mean a new primitive for a pattern the
   repo has already rejected.

## 4. The v3 model

### D1. One anchored popover for assigning tags; row menu keeps one door

- Row menu: `Tags…` stays (label keeps its ellipsis — APG convention for "opens
  something"), **Move to tag…** is deleted, **Remove all tags (n)** stays (D4).
  Choosing `Tags…` opens a non-modal **`Popover`** anchored to the *row*
  (`PopoverAnchor` with the row box; the installed `@radix-ui/react-popper`
  supports `virtualRef`, `dist/index.mjs` L50–70 — typing to be confirmed at
  implementation). `side="right" align="start"`, flips left, `collisionPadding
  8`; same rule as the row menu, which opens 2px right of its anchor.
- The row menu's `onCloseAutoFocus` already special-cases an open tag surface
  (`if (tagRow) return;`, `chat-sidebar.tsx` ~L6250), so the hand-off from menu
  to popover has a precedent and focus lands in the popover's input.
- Inside: the **existing `TagPickerCombobox` logic** (`aria-activedescendant`,
  `matchingTags`, one roving destination, `TAG_SELECTION_LIMIT`) re-seated in a
  popover instead of a dialog. It is the Gmail/Linear/Notion shape: filter
  input on top, checkable list, `Create “x”` last. Multi-select: toggling does
  **not** close it; Esc, outside click, or Tab leaves (Tab dismisses, as the
  header-identity popover does).
- No Apply/Cancel/Close buttons. No "Primary" chips or "Group under" radios.
- Geometry: min 224px (the row menu's `min-w-56`), max 280px; list max-height
  224px (7 × 32px options, the app's 32px target), scrolls; whole panel
  `max-height: min(360px, var(--radix-popover-content-available-height))`.
  `PopoverContent`'s default `p-4` is overridden to `p-1`. Options are 32px high,
  `text-body-sm`; the input is 32px.
- **Create:** the last list row is `Create “x”` with the helper `Saved for all
  conversations` (existing copy). It appears only when the trimmed query is
  valid and has no case-insensitive exact match (an exact match is shown as the
  ordinary option instead of an error, so a duplicate is *selected*, never
  created). **Enter on a query that matches nothing creates and assigns in one
  write** (the one-keystroke path); with ≥1 partial match Enter toggles the
  active (first) match and `Create` is reached with ↓/End — this keeps v2's
  rule that an ambiguous Enter cannot mutate the shared registry, while closing
  P6 for the case people actually type (a new word).
- **Footer line (aria-live, `text-meta text-ink-dim`):** `Shown under {tag}` /
  `Shown under Untagged`. This one sentence replaces the whole Primary /
  Group-under apparatus (D5). When grouping is *off* the footer instead reads
  `Tags are hidden.` with a `Show groups` text button that flips the View
  switch — the discoverability bridge for P7.

### D2. Group subheaders become the management surface (Slack's model)

Headers stay exactly as shipped (28px, `text-meta`, name + count, whole-header
drop target, `data-tag-drop-target`). Added:

- **`⋯` button**, right of the count: 24px target in the 28px header, revealed
  by the same rule the row acts use (absent from layout at rest, shown on
  hover-intent / `focus-within`) so a header's name never loses width at rest.
  At 220px the header is 195px: padding 16, count ≈16, gap 8 → name has ≈155px
  at rest and ≈123px while `⋯` is revealed (195 − 16 − 16 − 8 − 24 − 8).
  Names truncate (`truncate`, full name in `title`) — never wrap, never push
  the count.
- **`DropdownMenu`** (has `Sub`/radio/checkbox; one chrome, `dropdown-menu.tsx`)
  opened by `⋯`, by right-click on the header, and by `Shift+F10`/`ContextMenu`
  on a focused header (parity with rows). Items: `Rename`, `Move up`, `Move
  down`, separator, `Delete…` (destructive role, `text-danger`, wash on
  highlight). `Move up/down` are `aria-disabled` at the visible boundary with
  the boundary sentence, as the pinned-move items do.
- **Rename inline.** Double-click the name, `F2`, or `Rename`: the name becomes
  an `Input` of the same 28px height in place. Enter commits, Esc cancels,
  blur commits if valid & changed and otherwise reverts. Validation (same
  functions as today: `tagNameIssue`, duplicate against the *store*, not the
  render): errors show in a one-line `role="alert"` row directly under the
  header (`Use 1–24 characters`, `“Untagged” is reserved`, `A tag named “x”
  already exists.`); the input stays open and `aria-invalid`.
- **Move up/down move relative to the neighbour *visible in this section*.**
  Registry order is global but headers are per time-section (only occupied
  buckets render), so a naive swap with the registry neighbour can move a tag
  past tags that are not on screen and look like nothing happened. Implement as
  "reposition just before/after the adjacent visible header's tag" in the
  `tags.replace` desired state. `Alt+↑/↓` on a focused header does the same.
  Drag-to-reorder headers is **rejected**: headers are already drop targets for
  rows (v2 §3.2); a second drag meaning on the same element is exactly the
  ambiguity v2 spent a state machine avoiding.
- **Delete.** With `conversations > 0` the item opens a small anchored
  confirmation (a `Popover` on the header, `role="alertdialog"`, Cancel focused,
  copy `Delete “{name}”?` / `Remove this tag from {count} conversations.
  Conversations are not deleted.` / `Delete tag`) — not a modal. With 0
  conversations it deletes at once and a toast says `Deleted “x”` (a tag's
  assignments cannot be restored by id, so *no Undo is offered*; the confirm is
  the guard where something would be lost).
- **Write path:** unchanged — `replaceCategories(desired)` built from the
  *store* at press time (as `beginDelete` already does, to avoid resubmitting a
  tag removed elsewhere). While a write is pending the header shows the new
  text dimmed with `aria-busy`; on failure the header reverts and the alert row
  reads `Tags were not saved. Try again.` with a Retry text button.
- **Focus stops:** headers are not stops today. They become one stop type in the
  list's arrow ring (`⋯` is the focusable control; name is not). **Risk to flag
  for the coder:** the ring is built from `[data-chat-row]` (`applyRowStop`,
  `keyDown` ~L7696–8100) and the type-to-filter branch tests `target
  .hasAttribute("data-chat-row")`; reusing that attribute for headers would
  change both. Use a distinct attribute and add it to the ring query, then
  prove ↑/↓ across row→header→row in a story.

### D3. A footer where tags live: `+ New tag`, and unused tags as drop slots

A **tag footer** after the last row of the chats region (once, not per time
section), rendered whenever tagging is available and grouping is on:

- `+ New tag` — a 28px quiet row (`text-meta text-ink-dim`, `Plus` icon). Click
  turns it into an `Input` in place (placeholder `Tag name`). Enter creates and
  keeps the field open and empty for the next tag; Esc/blur closes. At 32 tags
  the row becomes the plain sentence `You can have up to 32 tags` (no control).
- `Unused tags (n)` — appears only when some tag has `conversations === 0`
  (these have no header, P7). Collapsed by default; expands to 28px rows with
  the same `⋯` menu and count `0`. A new tag lands here and the group expands
  with a polite announcement (`Created “x”`), which is the visible feedback that
  creation worked.
- **Unused tags are drop targets**, and the group **auto-expands while a row
  drag is armed**. This relaxes v2 §3.2 ("empty categories are not drag targets
  — inserting headers under a captured pointer would move the rows the user is
  aiming at"): the footer is *below every row*, so expanding it cannot shift
  anything above the pointer, and v2's own autoscroll brings it into reach.
  A drop there adds the tag and makes it primary (same rule as an occupied
  header); the chat stays in its own time section and regroups under the tag.
  Highlight = the existing drop role (accent-wash + accent outline).
  Re-prove v2's "no layout shift under the pointer" with a drag-start frame pair.
- Because the footer is at the end of a long list it is not the discovery
  mechanism (D6 is); it is where the *registry* lives for people who go
  looking.

### D4. Row menu: 3 → 2 tag items, not 3 → 1

`Tags…` and `Remove all tags (n)` (only when the row has tags) stay; `Move to
tag…` and its dialog go. The candidate replaced all three; I kept Remove-all
because it is the only 2-step path to an empty row (the popover would make it 3)
and a chat can carry up to 8 tags. `scripts/chat-sidebar-row-menu.test.mjs`
counts items and pins order; it changes from nine rows to eight on a tagged,
unpinned row.

### D5. Primary is mostly invisible

- **First tag added to an untagged chat is primary** (unchanged server rule).
  **A drag/drop makes the dropped tag primary** (unchanged v2 rule).
  **Adding another tag in the popover never changes primary** (v1's "adding a
  secondary tag must not silently regroup"). Removing the primary promotes the
  oldest surviving tag (server rule, unchanged).
- The user sees it in two places only: the live footer `Shown under {tag}`, and,
  with ≥2 tags checked, a `Show under` text button on each *non-primary* checked
  row, revealed on hover / when the option is active. Keyboard: **`⇧Enter` on the
  active option adds it if absent and makes it primary** — this is the pointerless
  twin of drag and replaces `Move to tag…`'s role as WCAG 2.5.7's single-pointer
  alternative (click + `Show under`). The existing armed-keyboard move
  (`move_armed` / `move_cancelled`, `chat-sidebar.tsx` ~L3504–3656) is not
  touched; I did not read its trigger.
- Deleted: the `Group under` radio group, the static `Primary:` note, the
  `selection_status` announcement of "Group under".

### D6. Discoverability (the U2 finding)

1. **First-use empty state**, top of the chats region, shown only while grouping
   is on **and** the registry is empty; gone once a tag exists. Two lines, no
   illustration: `Group chats by tag.` / `Press ⌘⇧L on a chat, or create one
   here.` plus the `+ New tag` row. (The chord cap is printed by
   `KeyboardShortcut` like the other row chords.)
2. **The chord is printed in the row menu next to `Tags…`.**
3. **The popover footer's `Show groups`** (D1) for chats tagged while grouping
   is off.
4. **No third hover act on the row.** The acts cluster is at its measured limit
   (`sidebar-row-space.md` §3 table: hover title box 124/164/204px at 240/280/
   320; **96px with grip** at 240). A `Tag` button costs another 28px. Rejected
   unless the operator wants the trade (§11 Q1).
5. The composer `/tag` row (shipped, uses the same hook) is the third door and
   is untouched.

### D7. View options: just the switch

`Tags` label + `Switch` (unchanged, 40px contract group), the auto-tag-forks
switch and its helper when grouping is on (unchanged). **Deleted: `Manage tags…`
and `No tags yet`** (moves to the D6 empty state). Management exists only while
grouping is on (the headers/footer are the surface). That is a stated product
consequence: with grouping off you can still *assign* (popover) but not
rename/delete/reorder — see §11 Q3.

### D8. Keyboard shortcut

**`⌘⇧L` / `Ctrl+Shift+L` on a focused conversation row opens the Tags popover.**

- Bare `L` (Gmail, Linear) is **impossible**: the list treats any printable key
  on a row as type-to-filter (`chat-sidebar.tsx` ~L8018–8040:
  `event.key.length === 1 … target.hasAttribute("data-chat-row")` →
  `setFilterOpen(true)`), and `chat-regions.ts` L205–222 states the same reason
  for the modified-chord family of row acts (`⌘⇧P` pin, `⌘⇧A` archive).
- Free: `RESERVED_CHORDS` (`shared/keymap/keymap-registry.ts`) lists
  `primary+l` (browser address) but not `primary+shift+l`; a grep of `src/` for
  `shift`+`l` finds only `browser-chord.ts` L72, which is guarded by `!input.shift`;
  the only main-process accelerator found is `CmdOrCtrl+Shift+R` (`index.ts`
  L614). **Not verified:** OS-level or embedded-browser-page bindings; the chord
  is row-focus-scoped so a page cannot see it.
- Implementation notes: add `primary+shift+l` to `RESERVED_CHORDS` *in the same
  change* (the file's own rule); it is **not** a `ChatRowAct` (those find a
  control by data attribute; there is no Tags button on the row) so it gets its
  own predicate beside `chatRowAct`. Remote row: announce the remote sentence
  (D9), open nothing.
- Header chords: `F2` rename, `Alt+↑/↓` move, `Shift+F10`/`ContextMenu` menu —
  none bound in `src/renderer/src/features/chat` (grep for `F2` hit comments
  only); `Alt+↑/↓` is free of `RESERVED_CHORDS` (`primary+alt+up/down` is
  reserved; bare `alt+up/down` is not).

### D9. Bulk

The sidebar has no multi-select (grep of `chat-sidebar.tsx` for
`multiSelect|selectedIds` finds nothing; `shiftKey` appears only in the `F10`
opener). **Not invented.** Drag moves one chat at a time, as shipped.

## 5. States

| State | v3 behaviour |
|---|---|
| **Loading** (registry fetching) | Popover list shows `Loading tags…` in a fixed 3-row-high region (96px) so the panel does not jump; input is disabled but focused so a typed filter is not lost. Footer shows nothing. |
| **Load failed** | `Tags could not be loaded. Try again.` + `Retry` in the list region; never an empty list that reads as "no tags". |
| **Empty (no tags)** | Popover: `Create a tag to get started.` and the input doubles as the create field (typing shows `Create “x”`). List top: D6 empty state. |
| **No matches** | `No tags match “q”.`; Create row below if valid. |
| **At 8 selected** | Unchecked options are `aria-disabled`, drawn in `ink-muted` (not `ink-disabled`), and the footer reads `Choose up to 8 tags` (`selection_limit`) with `8 of 8`. Checked options stay toggleable. |
| **At 32 tags** | Create row replaced by `You can have up to 32 tags`; footer `+ New tag` becomes that sentence. |
| **Name invalid** | `1–24 characters` / `“Untagged” is reserved`: Create row `aria-disabled` with the reason as its description; header rename: alert row (D2). Length counts code points (`Array.from`), as today — a ZWJ emoji sequence counts as several; **unchanged behaviour, noted not fixed**. No `maxlength` (it would silently truncate a paste). |
| **Duplicate** | Popover: the existing tag is shown as the option (selectable). Rename/new-tag field: `A tag named “x” already exists.` (case-insensitive, `toLocaleLowerCase`, as today). |
| **Remote conversation** | `Tags…` is `aria-disabled` with `Tags cannot be changed on a remote conversation.` (title + described-by), the chord announces it, and a tag drag must not arm on a remote row. **Check at implementation** whether `use-chat-tag-drag.ts` already refuses remote rows; today the refusal happens *after* the write attempt (`session_is_remote` 409 → `ui.chat.tags.remote`). |
| **Write failure** | Store already rolls the optimistic row back (`assignSessionTags` catch). Popover: the toggled option flips back and an inline `role="alert"` row `Tags were not saved. Try again.` appears under the list; focus stays on the option; the next press is the retry. |
| **409 `tags_conflict`** | Store refetches sessions; the hook re-seeds selection + revision; a notice row `Tags changed elsewhere. The list now shows their current tags; select again to apply your change.` (existing `tag_dialogs.changed_elsewhere`). No auto-retry. |
| **Registry changed under an open popover** | Existing hook effect drops vanished ids and shows `Some tags changed elsewhere. Review your selection.` |
| **Create succeeded, assign failed** | Existing `assign_created_failed` copy; the tag stays in the list so it can be selected (no duplicate Create). |
| **Light/dark/59 themes** | Roles only (`bg-elevated`, `border-hairline`, `text-ink`, `text-ink-dim`, `bg-accent-wash`, `text-danger`, `bg-danger-wash`); no new role, no hex. |
| **Sidebar 220/260/320** | The popover is anchored to the row but is a *fixed-width panel* (224–280px), not a function of sidebar width; only the header (§D2) and footer rows are sidebar-width surfaces. Frames required at 220/260/320 for header + footer, light & dark. |
| **Long / Unicode names** | One line, `truncate`, full name in `title`/accessible name. 24 CJK glyphs ≈ 24 × 14px ≈ 336px > the 280px popover max, so truncation is expected there, not an edge case — include in frames. |
| **Old backend** | Capability absent ⇒ none of this exists (unchanged: "capability absence is the entire old-backend path"). |

## 6. Keyboard, focus, a11y, and components

| Surface | Radix / component | Contract |
|---|---|---|
| Row `Tags…` popover | `Popover` + `PopoverAnchor` (row box); content is the app combobox (`role="combobox"` input, `role="listbox"` of `role="option" aria-selected`), **not** `role="menu"` | Opens focused in the input. ↑/↓/Home/End move the active option via `aria-activedescendant`; Enter toggles (or creates on zero matches); `⇧Enter` adds + shows under; Backspace on empty query does nothing (no chips to pop); Esc closes → focus returns to the row's own button (the keyboard path of the row menu's own `onCloseAutoFocus`); Tab dismisses. Every toggle announced (`selection_status` reduced to `{count} selected.`). Space types a space in the input (multi-word names). |
| Row menu | existing `ContextMenu` | `Tags…` has the chord cap; `Remove all tags (n)` unchanged. |
| Header `⋯` menu | `DropdownMenu` (+`DropdownMenuSub` unused) | Opens on click, right-click, `Shift+F10`, `Enter/Space` on `⋯`. Items 32px. Esc → returns to the `⋯`/header stop. |
| Inline rename | `Input` in the header slot (evaluate `shared/components/common/inline-edit.tsx`, which already carries tag strings, before writing another) | `aria-label="Rename {name}"`, `aria-invalid`, `aria-describedby` the alert row; IME-safe (`isComposing`/`keyCode 229` guard, as `manage-tags-dialog` does); Esc cancels and returns focus to the header stop. |
| Delete confirm | anchored `Popover`, `role="alertdialog"` | Cancel focused; Esc → header stop. |
| Footer | plain buttons/`Input` | `+ New tag` is a Tab stop *after* the last row; Enter creates and keeps focus. |
| Live region | the sidebar's existing `announcePinMove` channel | One sentence per outcome (assigned, shown under, created, renamed, deleted, error). |

Rules carried from `docs/branding.md`/`AGENTS.md`: focus is `outline`, never
box-shadow; disabled changes colour, never opacity; hover is a colour step;
nothing lifts/scales; sentence case; Escape must not propagate from the popover
to the sidebar or deselect the chat (v1 §5 rule, kept).

## 7. What gets deleted (subtract first)

- **Files:** `chat-session-tags-dialog.tsx` (413 lines), `manage-tags-dialog.tsx`
  (507). `tag-picker-combobox.tsx` (300) is **re-seated, not deleted**: its
  listbox logic is the popover's body; its dialog-specific chip row goes.
- **Sidebar state/mounts:** `tagRow`, `tagMoveMode`, `manageTagsOpen`,
  `tagsInvoker`, `tagsOriginId` (`chat-sidebar.tsx` ~L1405–1406 and the two
  mounts ~L9732–9750); the View menu's `onManageTags` prop and its handler
  (~L9888).
- **Menu:** `Move to tag…`; the `ChatSessionTagsDialog` "move mode".
- **Strings, derived by `rg` over `src/renderer`, `src/shared`, `scripts`:**
  20 keys are referenced *only* by the three dialog files —
  `ui.chat.tags.{search, loading, retry, cancel, clear, new, new_name,
  group_under, rename, delete_title, move_up, move_down, rename_label,
  move_title, move_description, registry_count, reorder_filtered, tag_usage,
  create_pending, renamed_name}` — and 5 have no non-story reference at all
  (`picker_title`, `picker_description`, `manage_description`,
  `apply_deletion_first`, `staged_added`). Also retire with their surfaces:
  `manage`, `manage_title`, `move_menu`, `none_yet`, `ui.chat.tag_dialogs.
  {picker_description, manage_description, close}`. Several of the 20 are still
  wanted *as new keys under the same text* (search placeholder, loading, retry,
  rename label, move up/down, registry count): reuse by keeping the key,
  don't delete-and-re-add. **Final delete list = a coder's `rg` after the
  rewrite**; the number above is the pre-implementation upper bound.
  Shared keys the `/tag` composer row consumes (`selection_count`,
  `create_name`, `create_helper`, `no_matches`, `remove_named`, `primary`…) stay.
- **Tests/stories to rewrite:** `scripts/chat-sidebar-row-menu.test.mjs` (item
  count/order), `chat-sidebar-tags.test.mjs`, `sidebar-tag-picker.test.mjs`,
  `sidebar-tag-drag.test.mjs` (Move-menu cases), and the dialog stories in
  `chat-sidebar-tags.stories.tsx` (1,866 lines: `Picker*`, `Manage*`,
  `MovePicker`, `MoveConflict`, `MoveFailure`, `MoveMenuRoundTrip`,
  `ViewOptions220` assertions on the Manage button).
- **Added (about 14 keys, each needs every `supported` locale):** `Show under`,
  `Shown under {tag}`, `Tags are hidden.`, `Show groups`, `Tag actions: {name}`,
  `Delete…`-confirm description, `Unused tags ({count})`, `+ New tag`,
  empty-state two lines, tag-field placeholder, `Created “{name}”` (exists),
  boundary sentences for header move. Translation by an LLM translator,
  audited by an independent auditor (AGENTS i18n policy).
- **No new dependency.** `Popover`, `DropdownMenu`, `ContextMenu`, `Input`,
  `Switch`, `Button`, `Tooltip` all exist.

## 8. Measured gate

`contrast_pairs.py`, hex from `themes.generated.css` (`localOperatorDark`
L1161–1200, `localOperatorLight` L1202–):

| Pair (role on role) | Dark | Light |
|---|---|---|
| `ink` on `elevated` (popover/menu text) | 11.81:1 | 16.34:1 |
| `ink-dim` on `elevated` (footer/helper) | 5.25:1 | 6.14:1 |
| `ink-dim` on `surface` (group header, `⋯`, count) | 5.70:1 | 5.73:1 |
| `ink-dim` on `row-hover` (hovered header) | 5.26:1 | 5.28:1 |
| `ink`/`ink-dim` on `accent-wash` (highlighted option) | 13.36 / 5.95 | 14.36 / 5.40 |
| `danger` on `elevated` / on `danger-wash` (Delete item) | 5.23 / 6.24 | 5.83 / 4.94 |
| `ink-muted` on `elevated` (at-limit options) | 7.24:1 | 8.78:1 |
| `accent` on `surface` (drop outline) | 6.88:1 | not measured |
| `border-control` on `elevated` (input boundary) | 3.30:1 | 3.92:1 (≥3:1 floor) |
| `ink-disabled` on `elevated` | **1.99:1** | not measured |

`ink-disabled` fails text contrast by design (inactive controls are exempt),
which is *why* at-limit options use `ink-muted` + `aria-disabled`: the reason
for the refusal must stay readable. The other 57 themes are covered only by
`pnpm check-themes`; v3 adds no new fill+border component, so no new `CONTROLS`
row is expected — if the popover list needs its own, add it
(`scripts/contrast-contract.mjs`).

## 9. Decisions table: adopt / adjust / reject

| Candidate | Verdict |
|---|---|
| Row-menu `Tags` submenu, filter field + checkbox items | **Reject** (Radix typeahead steals focus; ARIA; no `Sub`/`CheckboxItem` on ContextMenu). **Adopt the intent** as an anchored popover (D1). |
| Inline `Create "x"` row, multi-select stays open | **Adopt**, with Enter-creates only on zero matches (D1). |
| Replace 3 row items with 1 | **Adjust** → 2 (keep Remove-all) (D4). |
| Primary: explicit vs implicit | **Adjust:** implicit (first-added / last-dropped), one footer sentence, `Show under` + `⇧Enter` only when ≥2 (D5). Radios deleted. |
| Headers as management surface, `⋯`, inline rename, dbl-click | **Adopt** (D2). |
| Drag header to reorder | **Reject** (D2: header is a row drop target). |
| `+ New tag` where tags live, empty state | **Adopt** as footer + first-use state (D3, D6). |
| Manage tags… in View options | **Remove**, not demote to a popover (nothing left for it to manage that headers/footer do not cover) (D7). |
| Free keyboard shortcut | **`⌘⇧L`** (D8). Bare `L` is blocked by type-to-filter. |
| Bulk tagging | **Not invented** (no multi-select exists) (D9). |

## 10. Acceptance checklist

Frames (light + dark; header/footer at 220/260/320; popover at the 600px-wide
app floor and a 600px-tall viewport; before/after pairs vs
`assets/sidebar-tags-v3/before-*`):

- [ ] No `[role=dialog]` opens for assign, create, rename, reorder, move, or
      delete-of-unused. The only confirmation is the anchored `alertdialog`
      for deleting a tag with conversations.
- [ ] Popover: loading, load-failed, empty (no tags), populated, no-matches,
      at-8, at-32, invalid name, duplicate, write failure, 409, remote
      (row item disabled), long and CJK names — each a frame.
- [ ] Header: rest vs hover vs `⋯` open vs inline rename (valid, invalid,
      saving, failed) at 220/260/320; name never wraps; count never moves at
      rest; measured header height stays 28px.
- [ ] Footer: `+ New tag` rest / editing / at-32; `Unused tags` collapsed /
      expanded / auto-expanded during an armed drag; drop on an unused tag
      adds + makes primary; **no rows move when it expands** (frame pair at
      drag start).
- [ ] Empty state shows only with grouping on and zero tags; disappears on
      first create.
- [ ] View options: Tags row is label + switch only; `Manage tags…` and `No tags
      yet` absent; 40px group contract unchanged.
- [ ] Row menu: `Move to tag…` gone; `Tags…` shows `⌘⇧L`; item count/order
      assertion updated.
- [ ] Keyboard-only walk (physical keys, not DOM order): `⌘⇧L` → type → Enter
      creates+assigns; ↑/↓ across row→header→row; `F2` rename; `Alt+↑` move;
      `Shift+F10` header menu; Esc always returns to a real stop, and never
      closes the sidebar or deselects the chat.
- [ ] Real-path proof (not story-only): create → assign → rename → reorder →
      delete against a live core with `session_tags`; an unauthorised/old
      backend shows none of it; remote conversation refused *before* a write;
      409 reproduced with two clients; write failure rolls back.
- [ ] `RESERVED_CHORDS` gains `primary+shift+l` in the same change.
- [ ] `pnpm check-i18n` green with every `supported` locale present for each new key;
      dead keys removed; `check-themes` green.
- [ ] Step-count table (§2) re-measured on the built app and the ⚠ rows
      reported as-is.

## 11. Open questions that are the operator's, not engineering's

1. **A hover `Tag` button on the row, or the menu/chord only?** It would make
   tagging one click from the row, at the measured price of 28px of title width
   on hover (title 124 → 96px at a 240px sidebar when the pin grip is also
   showing). Recommendation: no (menu + `⌘⇧L` + empty state teach it).
2. **Mouse-only reorder of a tag by many places costs 2 steps per place** (today
   3+k total). Reorder is rare and the keyboard path is `1 + k`. Is a slower
   many-place mouse reorder acceptable, or do you want a dedicated drag handle
   on headers (rejected here because headers are drop targets)?
3. **With grouping off, should rename/delete/reorder still be reachable?** v3
   makes management exist only while grouping is on (headers/footer *are* the
   surface; `Manage tags…` is removed). Assigning still works with grouping off.
   Recommendation: yes — turning grouping on is one switch.
